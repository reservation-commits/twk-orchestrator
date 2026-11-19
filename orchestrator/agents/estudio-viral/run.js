'use strict';
/**
 * Estúdio Viral — a rodada do dia (19/11/2026, pedido do Márlon: « scripts realmente poderosos, ferramentas de IA que criam
 * posts, vídeos e textos, com verificação atual de novidades »).
 *
 *   veille (web) → pacote (modelo) → medida (wc.js da skill) → correção (modelo, 1 vez) → poda → grava → avisa o Julien
 *
 * Uso:
 *   node run.js                       rodada completa (exige ANTHROPIC_API_KEY)
 *   node run.js --dia 2026-11-20      para outro dia
 *   node run.js --sem-veille          pula a pesquisa na web (só calendário + Olheiro)
 *   node run.js --fixture <pacote.json>   sem modelo: mede, grava e renderiza um pacote pronto (testes e pacote escrito à mão)
 *   node run.js --relato              grava também o relato ao MAESTRO (contracts/relato.schema.json)
 *   node run.js --avisar              manda ao Julien, pela Aria, UMA linha com o link da página (exige ARIA_TEAM_ALERT_SECRET,
 *                                     CHAUFFEUR_CONFIRMA_URL e segredo do link); sem isso, só grava
 *
 * Estado (TWK_STATE_ROOT/agents/estudio-viral/ ou ./state): veille-<dia>.json, pacote-<dia>.json, pacote-<dia>.md, relato-<dia>.json.
 * Falhar alto: sem modelo e sem fixture → erro; pacote sem nenhum Reel aprovado → status "bloqueada", nunca "ok".
 * Nada aqui publica, comenta ou manda DM: o Julien lê, filma e publica.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const contexto = require('./contexto.js');
const llmMod = require('./llm.js');
const veilleMod = require('./veille.js');
const pacoteMod = require('./pacote.js');
const render = require('./render.js');

const HOSPEDADO = process.env.TWK_STATE_ROOT ? path.resolve(process.env.TWK_STATE_ROOT) : null;
const STATE = process.env.ESTUDIO_STATE_DIR ? path.resolve(process.env.ESTUDIO_STATE_DIR) : HOSPEDADO ? path.join(HOSPEDADO, 'agents', 'estudio-viral') : path.join(__dirname, 'state');

function parse(argv) { const f = {}; for (let i = 0; i < argv.length; i++) { const a = argv[i]; if (a.startsWith('--')) { const k = a.slice(2); const p = argv[i + 1]; if (p === undefined || p.startsWith('--')) f[k] = true; else { f[k] = p; i++; } } } return f; }

/** Link assinado da página do Julien: /studio/<dia>?t=<hmac>. Mesmo segredo do link de confirmar (CHAUFFEUR_CONFIRMA_SECRET ou CENTER_TOKEN). */
function token(dia, env = process.env) { const s = String(env.CHAUFFEUR_CONFIRMA_SECRET || env.CENTER_TOKEN || '').trim(); if (!s) return null; return crypto.createHmac('sha256', s).update(`studio:${dia}`).digest('base64url').slice(0, 16); }
function tokenValido(dia, t, env = process.env) { const e = token(dia, env); if (!e || !t || String(t).length !== e.length) return false; return crypto.timingSafeEqual(Buffer.from(e), Buffer.from(String(t))); }
function link(dia, env = process.env) { const base = String(env.CHAUFFEUR_CONFIRMA_URL || '').trim().replace(/\/+$/, ''); const t = token(dia, env); return base && t ? `${base}/studio/${dia}?t=${t}` : null; }

function relato({ dia, status, pacote, verificacao, veille, lacunas, removidos, modelo }) {
  const ts = new Date().toISOString();
  const rel = { agente: 'estudio-viral', ts, trace_id: `trc-estudio-${dia.replace(/-/g, '')}`, status, kpis: {}, achados: [], acoes_autonomas: [], aprovacoes_pendentes: [], cobertura: { fontes: [], lacunas: [...lacunas] } };
  rel.kpis = { reels_aprovados: pacote ? (pacote.reels || []).length : 0, reels_removidos: removidos.length, avisos: verificacao ? verificacao.problemas.filter((p) => p.tipo === 'aviso').length : 0, novidades_com_fonte: veille ? veille.novidades.length : 0 };
  rel.cobertura.fontes.push('skill Wanted Chauffeur Studio (voz, travas, fórmulas, medida)', 'calendário de Toulouse (donnees/calendario.json)');
  if (veille) rel.cobertura.fontes.push(`pesquisa web do modelo (${veille.buscas || 0} buscas, ${veille.novidades.length} itens com fonte)`);
  if (modelo) rel.cobertura.fontes.push(`modelo ${modelo}`);
  if (pacote) rel.acoes_autonomas.push({ acao: 'pacote de conteúdo do dia escrito e medido (brouillon; o Julien aprova e publica)', n: (pacote.reels || []).length, evidencia: `agents/estudio-viral/pacote-${dia}.json` });
  if (removidos.length) rel.achados.push({ chave: 'estudio.reel_bloqueado', severidade: 'media', autonomia: 'autonomo_com_log', dono: 'Márlon', fonte: 'estudio-viral', titulo: `${removidos.length} peça(s) do pacote barrada(s) pelas travas e removida(s)`, evidencia: verificacao.problemas.filter((p) => p.tipo === 'bloqueia').slice(0, 6).map((p) => `${p.reel}: ${p.detalhe}`).join(' | '), acao_proposta: 'ler o pacote-<dia>.json; se a trava errou, ajustar garde-fous.json na skill' });
  if (status === 'bloqueada') rel.achados.push({ chave: 'estudio.sem_pacote', severidade: 'alta', autonomia: 'requer_aprovacao_humana', dono: 'Márlon', fonte: 'estudio-viral', titulo: 'O Estúdio não entregou pacote hoje', evidencia: lacunas.join(' | ').slice(0, 300), acao_proposta: 'ver o log da rotina estudio-viral na Central' });
  return rel;
}

async function rodar({ argv = process.argv.slice(2), env = process.env, llm = null, avisarImpl = null, log = console.log, stateDir = STATE } = {}) {
  const f = parse(argv);
  const dia = typeof f.dia === 'string' ? f.dia : contexto.diaParis();
  fs.mkdirSync(stateDir, { recursive: true });
  const ctx = contexto.carregar({ dia, stateRoot: env.TWK_STATE_ROOT || null, stateDir });
  const wc = ctx.skill.wc;
  const lacunas = []; if (ctx.olheiro.lacuna) lacunas.push(ctx.olheiro.lacuna);
  let veille = null; let pacote = null; let verificacao = null; let removidos = []; let modelo = null; let status = 'ok';

  if (typeof f.fixture === 'string') {
    pacote = JSON.parse(fs.readFileSync(path.resolve(f.fixture), 'utf8'));
    pacote.date = pacote.date || dia;
    lacunas.push('pacote vindo de arquivo (--fixture): o modelo não escreveu nada hoje');
  } else {
    llm = llm || llmMod.criar(env);
    if (!llm.disponivel) throw new Error('ANTHROPIC_API_KEY ausente e nenhum --fixture: o Estúdio não tem como escrever o pacote');
    modelo = llm.modelo;
    if (!f['sem-veille']) {
      try { veille = await veilleMod.pesquisar({ llm, dia, calendario: ctx.calendario }); fs.writeFileSync(path.join(stateDir, `veille-${dia}.json`), JSON.stringify(veille, null, 1)); log(`[estudio] veille: ${veille.novidades.length} novidade(s) com fonte, ${veille.buscas || 0} busca(s)`); }
      catch (e) { lacunas.push(`veille falhou: ${e.message}`); log(`[estudio] veille falhou: ${e.message}`); }
    } else lacunas.push('veille pulada (--sem-veille)');
    pacote = await pacoteMod.gerar({ llm, ctx, veille });
    log(`[estudio] pacote escrito pelo modelo (${(pacote.reels || []).length} Reels)`);
  }

  verificacao = pacoteMod.verificar(pacote, wc);
  if (!verificacao.ok && llm && llm.disponivel && typeof f.fixture !== 'string') {
    log(`[estudio] ${verificacao.bloqueados.length} peça(s) bloqueada(s): pedindo correção ao modelo`);
    try { pacote = await pacoteMod.gerar({ llm, ctx, veille, correcoes: pacoteMod.textoCorrecoes(pacote, verificacao) }); verificacao = pacoteMod.verificar(pacote, wc); }
    catch (e) { lacunas.push(`correção falhou: ${e.message}`); }
  }
  if (!verificacao.ok) { const p = pacoteMod.podar(pacote, verificacao); pacote = p.pacote; removidos = p.removidos; }
  if (!(pacote.reels || []).length) { status = 'bloqueada'; lacunas.push('nenhum Reel passou pelas travas'); }
  else if (removidos.length || lacunas.length) status = 'parcial';

  const saida = { ...pacote, _verificacao: { ok: verificacao.ok, removidos, problemas: verificacao.problemas, medidas: verificacao.medidas }, _lacunas: lacunas, _gerado_em: new Date().toISOString(), _modelo: pacote._modelo || modelo || null };
  fs.writeFileSync(path.join(stateDir, `pacote-${dia}.json`), JSON.stringify(saida, null, 1));
  const md = render.markdownFr(pacote, { medidas: verificacao.medidas, problemas: verificacao.problemas, veille });
  fs.writeFileSync(path.join(stateDir, `pacote-${dia}.md`), md);
  log(`[estudio] ${status}: ${(pacote.reels || []).length} Reel(s) aprovados${removidos.length ? `, removidos ${removidos.join(', ')}` : ''}; ${verificacao.problemas.filter((p) => p.tipo === 'aviso').length} aviso(s) → ${path.join(stateDir, `pacote-${dia}.md`)}`);

  let aviso = null;
  if (f.avisar) {
    const url = link(dia, env);
    if (!url) { lacunas.push('sem link assinado (CHAUFFEUR_CONFIRMA_URL + segredo): o Julien não foi avisado'); }
    else if (status === 'bloqueada') { lacunas.push('pacote bloqueado: nenhum aviso ao Julien'); }
    else {
      const avisar = require(path.join(__dirname, '..', 'wanted-chauffeur', 'avisar.js'));
      const cfg = avisar.config(env);
      aviso = await avisar.avisarEquipe({ ariaUrl: cfg.ariaUrl, segredo: cfg.segredo, para: cfg.julien, sistema: 'estudio', evento: `estudio:${dia}`, situacao: `Le pack vidéo du jour est prêt (${(pacote.reels || []).length} Reels à filmer) : ${url}`, ...(avisarImpl ? { fetchImpl: avisarImpl } : {}) });
      log(`[estudio] aviso ao Julien: ${aviso.desfecho}`);
      if (!aviso.ok) lacunas.push(`aviso ao Julien falhou: ${aviso.desfecho}`);
    }
  }
  if (f.relato) { const rel = relato({ dia, status, pacote, verificacao, veille, lacunas, removidos, modelo: saida._modelo }); fs.writeFileSync(path.join(stateDir, `relato-${dia}.json`), JSON.stringify(rel, null, 1)); fs.writeFileSync(path.join(stateDir, 'estudio-viral.json'), JSON.stringify(rel, null, 1)); }
  return { dia, status, pacote, verificacao, removidos, lacunas, veille, aviso, arquivos: { json: path.join(stateDir, `pacote-${dia}.json`), md: path.join(stateDir, `pacote-${dia}.md`) } };
}

module.exports = { rodar, relato, token, tokenValido, link, STATE };
if (require.main === module) {
  rodar().then((r) => { if (r.status === 'bloqueada') process.exit(2); }).catch((e) => { console.error(`[estudio] ERRO: ${e.message}`); process.exit(1); });
}
