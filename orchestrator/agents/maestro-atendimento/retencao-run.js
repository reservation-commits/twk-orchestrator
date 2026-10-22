#!/usr/bin/env node
'use strict';
/**
 * Retenção antes da exclusão — o runner (ADR-018, 2026-10-22). Roda todo dia nas rotinas hospedadas e à mão.
 *
 *   node retencao-run.js            → DRY-RUN: casos, motivo, decisão e preview das cartas (nada sai, nada muda)
 *   node retencao-run.js --apply    → executa: manda a carta (uma por casa), executa a exclusão no prazo ou a pedido,
 *                                     registra a decisão de ficar; tudo com ledger e auditoria
 *
 * Fontes: escalações REMOCAO_LISTAGEM abertas (Aria, FLUXO 7) + casos já em andamento (state/retencao/<rid>.json).
 * A mensagem original da casa é lida de aria_messages (chat "email:<remetente>"); as respostas à carta também.
 * Execução = o mesmo caminho do ADR-016: SQL de despublicação pela porta única (reversível, backup) → cartas do
 * exclusao.js (casa + clientes com pedido vivo) → registro de opt-out → escalação fechada com nota.
 * Ficar = registro "listed" (o evento mais novo vence) + escalação fechada + pendência de correção quando houver.
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const B = require('../chave-girada/n8n/_blocos-twk.js');
const registro = require('../registro-optout/registro');
const { comClienteRo } = require('../_lib/conectar');
const R = require('./retencao');
const exclusao = require('./exclusao');

const RAIZ = path.resolve(__dirname, '..', '..', '..');
const HOSPEDADO = process.env.TWK_STATE_ROOT ? path.resolve(process.env.TWK_STATE_ROOT) : null;
const STATE = HOSPEDADO ? path.join(HOSPEDADO, 'agents', 'maestro-atendimento') : path.join(__dirname, 'state');
const CASOS = path.join(STATE, 'retencao');
const PREV = path.join(STATE, 'retencao-cartas');
const LEDGER = path.join(STATE, 'retencao.jsonl');
const LOGS = HOSPEDADO ? path.join(HOSPEDADO, 'logs') : path.join(RAIZ, 'orchestrator', 'logs');
const SQL_DIR = HOSPEDADO ? path.join(HOSPEDADO, 'sql') : path.join(RAIZ, 'orchestrator', 'state');
for (const d of [CASOS, PREV, SQL_DIR]) fs.mkdirSync(d, { recursive: true });

(function env() {
  const f = path.join(process.env.USERPROFILE || process.env.HOME || '', '.twk', 'regencia.env');
  try { for (const l of fs.readFileSync(f, 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim(); } } catch {}
})();
const WEBHOOK = process.env.EMAIL_WEBHOOK_URL || '';
const TOKEN = process.env.EMAIL_WEBHOOK_TOKEN || '';
const APROVACAO = 'ADR-018 (fundador, chat 2026-10-22): retenção antes da exclusão — uma carta, decisão da casa ou prazo de 48 h, exclusão autônoma pelo MAESTRO';

const apply = process.argv.includes('--apply');
const agora = new Date();
const hoje = agora.toISOString().slice(0, 10);
const trace = `trc-retencao-${hoje.replace(/-/g, '')}`;
const audit = (o) => { try { fs.mkdirSync(LOGS, { recursive: true }); fs.appendFileSync(path.join(LOGS, `audit-${hoje}.jsonl`), JSON.stringify({ ts: new Date().toISOString(), trace_id: trace, agente: 'maestro-atendimento', ...o }) + '\n'); } catch {} };
const ledger = (o) => fs.appendFileSync(LEDGER, JSON.stringify({ ts: new Date().toISOString(), trace_id: trace, ...o }) + '\n');
const lerCaso = (rid) => { try { return JSON.parse(fs.readFileSync(path.join(CASOS, `${rid}.json`), 'utf8')); } catch { return null; } };
const gravarCaso = (c) => fs.writeFileSync(path.join(CASOS, `${c.rid}.json`), JSON.stringify(c, null, 1), 'utf8');
const mascara = (e) => String(e || '').replace(/^.*@/, '@');

function node(script, args, rotulo) {
  const r = spawnSync(process.execPath, [script, ...args], { cwd: RAIZ, encoding: 'utf8', timeout: 240_000, env: process.env });
  const saida = `${r.stdout || ''}\n${r.stderr || ''}`;
  if (r.status !== 0) throw new Error(`${rotulo} saiu com ${r.status}: ${saida.split(/\r?\n/).filter(Boolean).slice(-3).join(' | ').slice(0, 300)}`);
  return saida;
}

/** Executa um .sql pela porta única (reversível, backup, autônomo — ADR-017). */
function portaUnica(sqlPath, rotulo) {
  return node(path.join(RAIZ, 'orchestrator', 'agents', 'dba-escrita', 'executar.js'), ['--sql', sqlPath, '--apply', '--autonomo'], rotulo);
}

function sqlFecharEscalacao(id, nota) {
  const f = path.join(SQL_DIR, `retencao-fecha-escalacao-${id}-${hoje}.sql`);
  fs.writeFileSync(f, `-- Retenção antes da exclusão (ADR-018) — fecha a escalação ${id} com nota · ${trace}
-- backup: public.aria_escalations where id = ${Number(id)}
begin;
update public.aria_escalations set status = 'resolved', resolved_at = now(), resolved_by = 'MAESTRO', resolution_note = '${String(nota).replace(/'/g, "''").replace(/;/g, ',')}' where id = ${Number(id)} and status = 'open';
commit;
`, 'utf8');
  return f;
}

async function coletar() {
  return comClienteRo(async (c) => {
    const esc = (await c.query(`SELECT id, created_at, phone, summary FROM public.aria_escalations WHERE status = 'open' AND tag = 'REMOCAO_LISTAGEM' ORDER BY created_at`)).rows;
    const casos = [];
    for (const e of esc) {
      const m = String(e.summary).match(/restaurant_id\s*[:#]?\s*(\d+)/i);
      const remetente = String(e.phone || '').includes('@') ? String(e.phone).trim().toLowerCase() : null;
      let texto = '';
      if (remetente) {
        const r = await c.query(`SELECT content FROM public.aria_messages WHERE chat_id = $1 AND direction = 'inbound' AND created_at <= $2 + interval '5 minutes' ORDER BY created_at DESC LIMIT 1`, [`email:${remetente}`, e.created_at]);
        texto = r.rows[0]?.content || '';
      }
      casos.push({ escalacao: e.id, criada: e.created_at, rid: m ? m[1] : null, remetente, texto, resumo: e.summary });
    }
    // Casos em andamento sem escalação aberta (ex.: escalação fechada à mão) continuam pelo arquivo de estado.
    const emAndamento = fs.readdirSync(CASOS).filter((f) => f.endsWith('.json')).map((f) => lerCaso(f.slice(0, -5))).filter((x) => x && ['carta_enviada', 'executar', 'reter'].includes(x.status));
    for (const x of emAndamento) if (!casos.some((k) => k.rid === x.rid)) casos.push({ escalacao: x.escalacao, criada: x.criada, rid: x.rid, remetente: x.remetente, texto: x.texto, resumo: x.resumo, soEstado: true });
    for (const k of casos) {
      if (!k.rid) continue;
      k.dossie = await exclusao.dossie(c, k.rid);
      k.respostas = k.remetente ? (await c.query(`SELECT content AS texto, created_at AS em FROM public.aria_messages WHERE chat_id = $1 AND direction = 'inbound' AND created_at > $2 ORDER BY created_at`, [`email:${k.remetente}`, k.criada])).rows : [];
    }
    return casos;
  });
}

function montarHtml(carta) {
  return [
    B.cabeca(carta.titulo, carta.paragrafos[1].replace(/<[^>]+>/g, '').slice(0, 110), carta.idioma),
    ...carta.paragrafos.map((p) => B.paragrafo(p)),
    B.paragrafo(carta.fecho),
    B.rodape(carta.rodapeWa, '', carta.rodapePrefixo),
  ].join('\n');
}

async function enviarCarta(k, caso, carta) {
  const html = montarHtml(carta);
  const ruins = R.termosProibidos(html);
  if (ruins.length) throw new Error(`carta com termo proibido: ${ruins.join(', ')}`);
  fs.writeFileSync(path.join(PREV, `${k.rid}-${hoje}.html`), html, 'utf8');
  if (!apply) return { ok: null, preview: true };
  const resp = await fetch(WEBHOOK, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` }, body: JSON.stringify({ para: k.remetente, assunto: carta.assunto, html }) });
  return { ok: resp.ok, http: resp.status };
}

(async () => {
  if (apply && (!WEBHOOK || !TOKEN)) { console.error('BLOQUEADO: EMAIL_WEBHOOK_URL/TOKEN ausentes'); process.exit(2); }
  const casos = await coletar();
  console.log(`retenção antes da exclusão · ${hoje} · ${apply ? 'APPLY' : 'DRY-RUN'} · ${casos.length} caso(s)`);
  let reg = null;
  try { reg = await registro.carregarAuto(); } catch (e) { console.error('registro de opt-out ilegível — nada é executado (fail-closed):', e.message); process.exit(3); }
  let falhas = 0;

  for (const k of casos) {
    const rotulo = `${k.dossie ? k.dossie.casa.name : '?'} (${k.rid || 'sem restaurant_id'})`;
    if (!k.rid) { console.log(`  ! escalação ${k.escalacao}: sem restaurant_id no resumo — fica para o MAESTRO identificar à mão`); audit({ evento: 'retencao_sem_rid', escalacao: k.escalacao }); continue; }
    if (!k.remetente) { console.log(`  ! ${rotulo}: escalação ${k.escalacao} sem e-mail do remetente — sem canal para a carta; execução direta no prazo`); }
    const caso = lerCaso(k.rid) || { rid: k.rid, escalacao: k.escalacao, criada: k.criada, remetente: k.remetente, texto: k.texto, resumo: k.resumo, status: 'novo' };
    const anterior = registro.estado(k.rid, reg);
    const jaPedido = !!(anterior && anterior.status === 'opted_out' && new Date(anterior.requested_at).getTime() < new Date(k.criada).getTime() - 3_600_000) || (lerCaso(k.rid) || {}).status === 'executado';
    const avaliacao = R.avaliarMotivo({ texto: k.texto || k.resumo, assunto: '', jaPedido });
    if (!k.remetente && caso.status === 'novo') avaliacao.retencao = false;
    const decisao = R.decidir({ estado: caso, avaliacao, respostas: k.respostas || [], agora });
    const idioma = exclusao.idiomaProvavel(k.texto || '') || idiomaDoPais(k.dossie.casa.country);
    console.log(`\n  ${rotulo} · ${k.dossie.casa.city} · pedidos ${k.dossie.hist.total} (aceitos ${k.dossie.hist.aceitos}) · vivos ${k.dossie.vivas.length} · remetente ${mascara(k.remetente)} · idioma ${idioma}`);
    console.log(`    motivo: ${avaliacao.motivo} (${avaliacao.porque}) · estado: ${caso.status} · decisão: ${decisao.acao} — ${decisao.porque}`);

    try {
      if (decisao.acao === 'enviar_carta') {
        const prazo = R.prazoExecucao(agora);
        const carta = R.cartaRetencao({ idioma, motivo: avaliacao.motivo, dossie: k.dossie, prazo });
        const r = await enviarCarta(k, caso, carta);
        console.log(`    carta: "${carta.assunto}" · prazo ${prazo.toISOString().slice(0, 16)}Z · ${r.preview ? 'preview gravado' : r.ok ? `ENVIADA HTTP ${r.http}` : `FALHA HTTP ${r.http}`}`);
        if (apply && r.ok) {
          Object.assign(caso, { status: 'carta_enviada', motivo: avaliacao.motivo, idioma, carta_enviada_em: agora.toISOString(), prazo: prazo.toISOString(), assunto: carta.assunto });
          gravarCaso(caso);
          // Registro (ADR-010): o pedido fica registrado e reconhecido; nenhum contato comercial até a decisão.
          registro.registrar({ restaurant_id: k.rid, status: 'opted_out', do_not_relist: true, scope: ['reservations', 'outreach'], requested_at: new Date(k.criada).toISOString(), requested_by: `email:${k.remetente}`, evidence_ref: `aria_escalations:${k.escalacao}`, legal_basis: 'pedido do próprio estabelecimento', trace_id: trace, sla_ack_at: agora.toISOString(), notes: `retenção (ADR-018): carta enviada, prazo ${prazo.toISOString().slice(0, 10)}, motivo ${avaliacao.motivo}` });
          ledger({ rid: k.rid, nome: k.dossie.casa.name, acao: 'carta_enviada', motivo: avaliacao.motivo, idioma, dominio: mascara(k.remetente), prazo: prazo.toISOString(), http: r.http });
          audit({ evento: 'retencao_carta', rid: k.rid, motivo: avaliacao.motivo, idioma, prazo: prazo.toISOString() });
        } else if (apply) { falhas++; ledger({ rid: k.rid, acao: 'carta_falhou', http: r.http }); audit({ evento: 'retencao_carta_falhou', rid: k.rid, http: r.http }); }
      } else if (decisao.acao === 'executar') {
        const motivoTexto = `Pedido de remoção do próprio estabelecimento (escalação ${k.escalacao}, ${String(k.criada).slice(0, 10)}). Motivo avaliado: ${avaliacao.motivo}. ${decisao.porque}. Retenção: ${caso.status === 'novo' ? 'não tentada' : 'carta enviada em ' + String(caso.carta_enviada_em).slice(0, 10)}.`;
        if (!apply) { console.log(`    execução (dry-run): despublicar pela porta única → cartas do exclusao.js → fechar escalação ${k.escalacao}`); continue; }
        const saida1 = node(path.join(__dirname, 'exclusao.js'), ['--restaurante', k.rid, '--motivo', motivoTexto], 'exclusao.js (dry-run)');
        const m = saida1.match(/SQL gravado em (.+\.sql)/);
        if (!m) throw new Error('exclusao.js não gravou o SQL de despublicação');
        portaUnica(m[1].trim(), 'executar.js (despublicação)');
        node(path.join(__dirname, 'exclusao.js'), ['--restaurante', k.rid, '--motivo', motivoTexto, '--apply', '--aprovacao', APROVACAO], 'exclusao.js (--apply)');
        if (k.escalacao) portaUnica(sqlFecharEscalacao(k.escalacao, `executado em ${hoje} pelo MAESTRO (ADR-018): ${decisao.porque}. Despublicada pela porta única, cartas enviadas, opt-out registrado. A página pode continuar respondendo até o front filtrar published.`), 'executar.js (escalação)');
        Object.assign(caso, { status: 'executado', executado_em: new Date().toISOString(), motivo: avaliacao.motivo, decisao: decisao.porque });
        gravarCaso(caso);
        ledger({ rid: k.rid, nome: k.dossie.casa.name, acao: 'executado', porque: decisao.porque, motivo: avaliacao.motivo });
        audit({ evento: 'retencao_executada', rid: k.rid, porque: decisao.porque });
        console.log(`    EXECUTADO: despublicada, cartas enviadas, registro gravado, escalação ${k.escalacao} fechada`);
      } else if (decisao.acao === 'reter') {
        if (!apply) { console.log('    retenção (dry-run): registrar "listed", fechar escalação, abrir pendência de correção se houver'); continue; }
        registro.registrar({ restaurant_id: k.rid, status: 'listed', do_not_relist: false, scope: ['listing'], requested_at: new Date().toISOString(), requested_by: `email:${k.remetente}`, evidence_ref: `aria_messages:email:${mascara(k.remetente)}`, trace_id: trace, notes: `a casa respondeu que fica (ADR-018) após a carta de ${String(caso.carta_enviada_em).slice(0, 10)}; motivo original ${caso.motivo || avaliacao.motivo}` });
        if (k.escalacao) portaUnica(sqlFecharEscalacao(k.escalacao, `a casa decidiu FICAR após a carta de retenção de ${String(caso.carta_enviada_em).slice(0, 10)} (ADR-018). Motivo original: ${caso.motivo || avaliacao.motivo}. ${caso.motivo === 'dados_errados' ? 'Pendência: corrigir os dados que a casa apontar (DBA, porta única).' : ''}`), 'executar.js (escalação)');
        Object.assign(caso, { status: 'retida', retida_em: new Date().toISOString() });
        gravarCaso(caso);
        ledger({ rid: k.rid, nome: k.dossie.casa.name, acao: 'retida', motivo: caso.motivo || avaliacao.motivo });
        audit({ evento: 'retencao_sucesso', rid: k.rid, motivo: caso.motivo || avaliacao.motivo });
        console.log('    RETIDA: a casa fica; registro atualizado, escalação fechada');
      } else {
        console.log(`    ${decisao.acao}: ${decisao.porque}${caso.prazo ? ` (prazo ${String(caso.prazo).slice(0, 16)}Z)` : ''}`);
      }
    } catch (e) {
      falhas++;
      console.error(`    FALHA em ${rotulo}: ${e.message}`);
      ledger({ rid: k.rid, acao: 'falha', erro: e.message.slice(0, 300) });
      audit({ evento: 'retencao_falha', rid: k.rid, erro: e.message.slice(0, 300) });
    }
  }
  if (!apply) console.log('\nDRY-RUN — nada enviado, nada alterado. Previews em', path.relative(RAIZ, PREV));
  process.exitCode = falhas ? 1 : 0;
})().catch((e) => { console.error('FALHA:', e.message); process.exit(2); });

function idiomaDoPais(pais) {
  const m = { France: 'fr', Belgium: 'fr', Switzerland: 'fr', Monaco: 'fr', Spain: 'es', Mexico: 'es', Argentina: 'es', Colombia: 'es', Chile: 'es', Peru: 'es', Italy: 'it', Portugal: 'pt', Brazil: 'pt', Germany: 'de', Austria: 'de' };
  return m[pais] || 'en';
}
