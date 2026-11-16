#!/usr/bin/env node
'use strict';
/**
 * Olheiro do Instagram — o agente que lê a conta do @wantedchauffeur todo dia, sozinho, e só lê.
 *
 *   node run.js                       → coleta, grava estado, resumo e diário; imprime o resumo
 *   node run.js --relato              → idem + relato ao MAESTRO (relato-<dia>.json, contrato relato.schema.json)
 *   node run.js --fixture <arq.json>  → mesma rodada, lendo respostas gravadas em vez da Meta (ensaio, testes)
 *   node run.js --json                → imprime o resumo em JSON
 *   node run.js --comentarios         → vigia curta (a Central roda a cada 5 min): relê comentários que mudaram e pede
 *                                       à Aria o aviso ao Julien no WhatsApp para pedido de reserva sem resposta há 30 min
 *     OLHEIRO_ARIA_URL (ou AGENT_ARIA_URL) · ARIA_TEAM_ALERT_SECRET · OLHEIRO_AVISAR (padrão julien)
 *     OLHEIRO_LIMITE_RESERVA_MIN (padrão 30)
 *
 * Configuração (ambiente; na máquina local, também ~/.twk/instagram.env):
 *   IG_ACCESS_TOKEN   chave da conta (nunca no repositório, nunca no log)
 *   IG_USER_ID        id da conta profissional na API
 *   IG_LOGIN          instagram (padrão) | facebook  — facebook libera contas de referência
 *   IG_API_VERSION    padrão v24.0
 *   IG_CONCORRENTES   contas de referência separadas por vírgula (só com IG_LOGIN=facebook)
 *   IG_TOKEN_EXPIRA_EM AAAA-MM-DD: a chave do login do Instagram vence em 60 dias; o relato avisa 10 dias antes
 *   IG_MAX_POSTS      padrão 100
 *
 * Saídas (TWK_STATE_ROOT/agents/olheiro-instagram na Central; ./state na máquina local):
 *   estado.json · resumo.json · journal.jsonl (formato da skill Wanted Chauffeur Studio) · relato-<dia>.json
 * Entrada da pessoa: anotacoes.json (pilier, personnage, ville, ecran por post), gravado pela Central.
 *
 * Saída do processo: 0 leu (ou não tem chave: o relato diz) · 2 falhou (o relato diz por quê).
 */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { criarCliente, ErroMeta } = require('./api');
const { coletar, coletarComentarios } = require('./coletar');
const cerebro = require('./cerebro');

const HOSPEDADO = process.env.TWK_STATE_ROOT ? path.resolve(process.env.TWK_STATE_ROOT) : null;
const STATE = process.env.OLHEIRO_STATE_DIR ? path.resolve(process.env.OLHEIRO_STATE_DIR) : HOSPEDADO ? path.join(HOSPEDADO, 'agents', 'olheiro-instagram') : path.join(__dirname, 'state');

function lerEnvLocal() {
  const f = path.join(os.homedir(), '.twk', 'instagram.env');
  const out = {};
  try { for (const l of fs.readFileSync(f, 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/); if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, ''); } } catch { /* sem arquivo local */ }
  return out;
}
function config(env = process.env) {
  const local = env === process.env && !HOSPEDADO ? lerEnvLocal() : {};
  const v = (k) => env[k] || local[k] || '';
  return { token: v('IG_ACCESS_TOKEN'), userId: v('IG_USER_ID'), login: v('IG_LOGIN') || 'instagram', versao: v('IG_API_VERSION') || 'v24.0', concorrentes: v('IG_CONCORRENTES').split(',').map((s) => s.trim()).filter(Boolean), tokenExpiraEm: /^\d{4}-\d{2}-\d{2}$/.test(v('IG_TOKEN_EXPIRA_EM')) ? v('IG_TOKEN_EXPIRA_EM') : null, maxPosts: Number(v('IG_MAX_POSTS')) || 100,
    // Aviso ao Julien pela Aria (14/11): rota /webhook/alerta-equipe da Aria, segredo próprio, NOME de quem recebe.
    // mesmo endereço padrão que a Regência usa para a Aria (coletores.js)
    ariaUrl: (v('OLHEIRO_ARIA_URL') || v('AGENT_ARIA_URL') || 'https://theworldkeys-aria-whatsapp-agent.xis4ee.easypanel.host').replace(/\/+$/, ''), ariaSegredo: v('ARIA_TEAM_ALERT_SECRET'), avisar: (v('OLHEIRO_AVISAR') || 'julien').toLowerCase(),
    // idioma do aviso: fr (padrão, template twk_team_alert) ou pt (template twk_ops_alert)
    avisoIdioma: v('OLHEIRO_AVISO_IDIOMA') === 'pt' ? 'pt' : 'fr' };
}

/** Uma rodada por vez: a vigia (a cada poucos minutos) e a leitura diária gravam o mesmo estado. */
async function comTrava(fn, { esperarMs = 0 } = {}) {
  fs.mkdirSync(STATE, { recursive: true });
  const trava = path.join(STATE, '.olheiro.lock');
  const limite = Date.now() + esperarMs;
  for (;;) {
    try { fs.closeSync(fs.openSync(trava, 'wx')); break; } catch {
      try { if (Date.now() - fs.statSync(trava).mtimeMs > 20 * 60_000) { fs.unlinkSync(trava); continue; } } catch { continue; }
      if (Date.now() >= limite) return { ocupado: true };
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  try { return await fn(); } finally { try { fs.unlinkSync(trava); } catch { /* já saiu */ } }
}

/** Pede à Aria o aviso no WhatsApp. Devolve true quando a Aria enviou (ou já tinha enviado este mesmo aviso). */
async function pedirAviso(cfg, grupo, avisarImpl) {
  const crypto = require('node:crypto');
  const evento = `ig-reserva:${grupo.post}:${crypto.createHash('sha1').update(grupo.comentarios.slice().sort().join(',')).digest('hex').slice(0, 12)}`;
  const r = await avisarImpl(`${cfg.ariaUrl}/webhook/alerta-equipe`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-aria-secret': cfg.ariaSegredo },
    body: JSON.stringify({ destinatario: cfg.avisar, sistema: 'Instagram @wantedchauffeur', situacao: cerebro.textoAviso(grupo, cfg.avisoIdioma), evento }),
    signal: AbortSignal.timeout(20000),
  });
  let j = null; try { j = await r.json(); } catch { /* sem corpo */ }
  return { ok: r.ok && j && j.ok === true, status: r.status, desfecho: (j && (j.desfecho || j.motivo)) || `HTTP ${r.status}` };
}

/**
 * Vigia de comentários (--comentarios): lê só os comentários que mudaram e avisa o Julien, pela Aria, de cada
 * post com pedido de reserva sem resposta há 30 min. Um aviso por pedido, nunca dois.
 */
async function vigiar({ cfg, fetchImpl, avisarImpl, agora, log }) {
  const anterior = lerJson(path.join(STATE, 'estado.json'), {});
  const cli = criarCliente({ ...cfg, fetchImpl });
  const vigia = await coletarComentarios(cli, anterior, { agora });
  const estado = cerebro.aplicarVigia(anterior, vigia, agora);
  const grupos = cerebro.pedidosParaAvisar(estado, agora);
  const avisos = [];
  for (const g of grupos) {
    if (!cfg.ariaUrl || !cfg.ariaSegredo) { estado.ultima_vigia.lacunas.push('aviso ao Julien desligado: falta ARIA_TEAM_ALERT_SECRET na Central (o mesmo valor de TEAM_ALERT_SECRET na Aria)'); break; }
    let r;
    try { r = await pedirAviso(cfg, g, avisarImpl || globalThis.fetch); } catch (e) { r = { ok: false, desfecho: String(e && e.message || e).slice(0, 120) }; }
    avisos.push({ post: g.post, comentarios: g.comentarios.length, ok: r.ok, desfecho: r.desfecho });
    if (r.ok) for (const id of g.comentarios) estado.alertas_reserva[id] = { em: new Date(agora).toISOString(), post: g.post, para: cfg.avisar };
    else estado.ultima_vigia.lacunas.push(`aviso ao Julien do post ${g.post} não saiu (${r.desfecho}); tenta de novo na próxima vigia`);
  }
  estado.ultima_vigia.avisos = avisos;
  gravar(path.join(STATE, 'estado.json'), JSON.stringify(estado));
  const anotacoes = lerJson(path.join(STATE, 'anotacoes.json'), {});
  const r = cerebro.resumo(estado, { anotacoes, agora });
  r.lacunas = [...r.lacunas, ...estado.ultima_vigia.lacunas];
  gravar(path.join(STATE, 'resumo.json'), JSON.stringify(r, null, 1));
  log(`Vigia de comentários · ${vigia.relidos.length} post(s) relido(s) · ${vigia.chamadas} chamada(s) · ${avisos.filter((a) => a.ok).length} aviso(s) ao ${cfg.avisar}${avisos.some((a) => !a.ok) ? ` · ${avisos.filter((a) => !a.ok).length} aviso(s) NÃO saíram` : ''}`);
  for (const l of estado.ultima_vigia.lacunas) log(`  [lacuna] ${l}`);
  return { codigo: avisos.some((a) => !a.ok) ? 1 : 0, status: 'ok', avisos, resumo: r };
}

const lerJson = (f, padrao) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return padrao; } };
function gravar(f, conteudo) { fs.mkdirSync(path.dirname(f), { recursive: true }); const tmp = `${f}.${process.pid}.tmp`; fs.writeFileSync(tmp, conteudo, 'utf8'); fs.renameSync(tmp, f); }

/** fetch que responde a partir de um arquivo: { "rotas": { "<caminho>[?metric=x|?breakdown=y]": resposta } }. */
function fetchDeFixture(arquivo) {
  const rotas = JSON.parse(fs.readFileSync(arquivo, 'utf8')).rotas || {};
  return async (url) => {
    const u = new URL(url);
    const caminho = u.pathname.replace(/^\/v\d+\.\d+\//, '');
    const chaves = [u.searchParams.get('metric') && `${caminho}?metric=${u.searchParams.get('metric')}`, u.searchParams.get('breakdown') && `${caminho}?breakdown=${u.searchParams.get('breakdown')}`, caminho].filter(Boolean);
    const k = chaves.find((x) => rotas[x] !== undefined);
    const corpo = k ? rotas[k] : { error: { code: 100, message: `fixture sem a rota ${chaves[0]}` } };
    return { ok: !corpo.error, status: corpo.error ? 400 : 200, json: async () => corpo };
  };
}

async function rodar({ argv = process.argv.slice(2), env = process.env, fetchImpl, avisarImpl, agora = Date.now(), log = console.log } = {}) {
  const flag = (n) => argv.includes(n);
  const valor = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
  const cfg = config(env);
  const fixture = valor('--fixture');
  if (fixture) { cfg.token = cfg.token || 'fixture'; cfg.userId = cfg.userId || 'fixture-user'; }
  if (flag('--comentarios')) {
    if (!cfg.token || !cfg.userId) { log('Vigia de comentários: sem chave do Instagram, nada a fazer.'); return { codigo: 0, status: 'sem_credencial' }; }
    try {
      const x = await comTrava(() => vigiar({ cfg, fetchImpl: fixture ? fetchDeFixture(fixture) : fetchImpl, avisarImpl, agora, log }));
      if (x.ocupado) { log('Vigia de comentários: a leitura diária está rodando; fica para a próxima.'); return { codigo: 0, status: 'ocupado' }; }
      return x;
    } catch (e) {
      const credencial = e instanceof ErroMeta && e.credencial;
      log(`Vigia de comentários · ${credencial ? 'sem_credencial' : 'falhou'}: ${String(e && e.message || e)}`);
      return { codigo: credencial ? 0 : 2, status: credencial ? 'sem_credencial' : 'falhou', erro: String(e && e.message || e) };
    }
  }
  const anterior = lerJson(path.join(STATE, 'estado.json'), {});
  const anotacoes = lerJson(path.join(STATE, 'anotacoes.json'), {});
  const dia = new Date(agora).toISOString().slice(0, 10);
  let status = 'ok'; let erro = null; let r = null; let codigo = 0;

  if (!cfg.token || !cfg.userId) {
    status = 'sem_credencial';
    erro = `faltam ${[!cfg.token && 'IG_ACCESS_TOKEN', !cfg.userId && 'IG_USER_ID'].filter(Boolean).join(' e ')}`;
  } else {
    const feito = await comTrava(async () => {
      try {
        // relido dentro da trava: a vigia pode ter gravado avisos e comentários desde o início desta função
        const atual = lerJson(path.join(STATE, 'estado.json'), anterior);
        const cli = criarCliente({ ...cfg, fetchImpl: fixture ? fetchDeFixture(fixture) : fetchImpl });
        const coleta = await coletar(cli, atual, { agora, maxPosts: cfg.maxPosts, concorrentes: cfg.concorrentes });
        const estado = cerebro.estadoNovo(atual, coleta, agora);
        r = cerebro.resumo(estado, { anotacoes, agora });
        gravar(path.join(STATE, 'estado.json'), JSON.stringify(estado));
        gravar(path.join(STATE, 'resumo.json'), JSON.stringify(r, null, 1));
        gravar(path.join(STATE, 'journal.jsonl'), cerebro.diario(estado, anotacoes).map((l) => JSON.stringify(l)).join('\n') + '\n');
      } catch (e) {
        status = e instanceof ErroMeta && e.credencial ? 'sem_credencial' : 'falhou';
        erro = String(e && e.message || e);
        codigo = status === 'falhou' ? 2 : 0;
      }
    }, { esperarMs: 120_000 });
    if (feito && feito.ocupado) { status = 'falhou'; erro = 'a vigia de comentários segurou a trava por mais de 2 min'; codigo = 2; }
  }

  if (flag('--relato')) {
    const rel = cerebro.relato(r, { status, erro, tokenExpiraEm: cfg.tokenExpiraEm, agora });
    gravar(path.join(STATE, `relato-${dia}.json`), JSON.stringify(rel, null, 1));
  }
  if (flag('--json')) log(JSON.stringify(r || { status, erro }));
  else if (r) {
    const n = r.numeros;
    log(`Olheiro do Instagram · @${r.conta.username} · ${dia}`);
    log(`  seguidores ${n.seguidores ?? '—'} (${n.seguidores_7d === null ? 'sem base de 7 dias' : `${n.seguidores_7d >= 0 ? '+' : ''}${n.seguidores_7d} em 7 dias`}) · ${n.posts_30d} posts em 30 dias · mediana de visualizações dos Reels ${n.mediana_views_reels_30d ?? '—'}`);
    log(`  comentários esperando resposta: ${n.comentarios_esperando} (${n.pedidos_reserva_esperando} pedem reserva ou preço)`);
    for (const a of r.alertas) log(`  ALERTA ${a.tipo}: ${a.post || a.dia} · ${a.multiplo ? `${a.multiplo}×` : `+${a.ganho}`} · ${a.sugestao}`);
    for (const l of r.lacunas) log(`  [lacuna] ${l}`);
    log(`  diário: ${r.diario_posts} posts em ${path.join(STATE, 'journal.jsonl')}`);
  } else log(`Olheiro do Instagram · ${status}: ${erro}`);
  return { codigo, status, erro, resumo: r };
}

if (require.main === module) {
  rodar().then((x) => { process.exitCode = x.codigo; }).catch((e) => { console.error('FALHA:', e.message); process.exitCode = 2; });
}

module.exports = { rodar, config, fetchDeFixture, STATE };
