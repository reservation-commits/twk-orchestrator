#!/usr/bin/env node
'use strict';
/**
 * Medidor de autonomia (08/10/2026) — lê orchestrator/logs/audit-*.jsonl e responde:
 * de cada 100 ações da frota, quantas pararam num humano?
 *
 *   node orchestrator/medidor-autonomia/medir.js [--dias 30] [--json]
 *
 * Grava orchestrator/state/autonomia.json e orchestrator/logs/autonomia/AAAA-MM-DD.md.
 * Zero LLM, zero banco. Método declarado abaixo (classificar); linha que não se enquadra
 * é "ignorada" e contada, nunca somada em silêncio.
 *
 * Classes:
 *   autonoma  — ação executada por política/ADR sem toque humano
 *   humana    — ação que só aconteceu (ou só parou) porque um humano aprovou/decidiu/bloqueou
 *   aviso     — mensagem ao fundador (despacho) — não é ação, é ruído a reduzir
 *   falha     — execução que falhou (nem autônoma nem humana; é dívida)
 *   trava     — bloqueio de guardrail (hook); fora do denominador porque a suíte de testes dos hooks também grava
 *   ignorada  — telemetria (tool_use, subagent_stop, dry-run, leituras)
 */
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.resolve(__dirname, '..', '..');
const DIR_LOGS = path.join(RAIZ, 'orchestrator', 'logs');
const ARQ_STATE = path.join(RAIZ, 'orchestrator', 'state', 'autonomia.json');

const AUTONOMAS_SIMPLES = new Set(['resposta_cliente_enviada', 'resposta_restaurante_enviada', 'exclusao_carta', 'email_reparo', 'email_confirmacao_remocao', 'regencia_ciclo', 'reparo_executado']);
const HUMANAS_SIMPLES = new Set(['aprovacao_solicitada', 'aprovacao_adr', 'execucao_bloqueada', 'escrita_bloqueada', 'lote_concluido', 'n8n_templates_aplicados', 'n8n_cta_notificacao_aplicado', 'n8n_workflow_agendado', 'n8n_workflow_desativado', 'email_teste', 'teste_fluxo3_accept']);

/** @returns {{classe:'autonoma'|'humana'|'aviso'|'falha'|'ignorada', motivo:string}} */
function classificar(o) {
  const ev = o.evento;
  if (!ev) return { classe: 'ignorada', motivo: 'sem evento' };
  if (ev === 'tool_use' || ev === 'subagent_stop' || ev === 'registro_optout_lido' || ev === 'dry_run' || ev === 'resolvidas_fora_ignoradas') return { classe: 'ignorada', motivo: ev };
  if (ev === 'despacho_email') return { classe: 'aviso', motivo: 'despacho ao fundador' };
  // O hook guard-sql.ps1 grava sem marcar teste; a suíte test-guards.ps1 produz 15 bloqueios por rodada da Porta.
  // Por isso o bloqueio é classe própria (trava), fora do denominador, e contado à parte.
  if (ev === 'guardrail_block') return { classe: 'trava', motivo: String(o.motivo || '').slice(0, 60) };
  if (ev === 'falha' || ev === 'escrita_falhou') return { classe: 'falha', motivo: `${o.agente || '?'}: ${String(o.erro || '').slice(0, 60)}` };
  if (ev === 'politica_avaliada') return (o.decisao === 'autonomo' || o.decisao === 'autonomo_com_log') ? { classe: 'autonoma', motivo: `política ${o.politica}` } : { classe: 'humana', motivo: `política: ${o.decisao} (${o.politica || 'sem política'})` };
  if (ev === 'execucao') return o.modo === 'dry-run' ? { classe: 'ignorada', motivo: 'dry-run' } : { classe: 'autonoma', motivo: `execução ${o.modo || ''}`.trim() };
  if (ev === 'sql_escrita') return o.modo === 'autonomo' ? { classe: 'autonoma', motivo: 'escrita reversível (ADR-017)' } : { classe: 'humana', motivo: 'escrita com frase do fundador' };
  if (ev === 'email_envio') return o.aprovacao_ref ? { classe: 'humana', motivo: 'envio aprovado pelo fundador' } : { classe: 'autonoma', motivo: 'envio por política' };
  if (AUTONOMAS_SIMPLES.has(ev)) return { classe: 'autonoma', motivo: ev };
  if (HUMANAS_SIMPLES.has(ev)) return { classe: 'humana', motivo: ev };
  return { classe: 'ignorada', motivo: `evento não classificado: ${ev}` };
}

function lerLinhas(dir = DIR_LOGS) {
  const out = [];
  const arqs = fs.readdirSync(dir).filter((f) => /^audit-\d{4}-\d{2}-\d{2}\.jsonl$/.test(f)).sort();
  for (const f of arqs) {
    for (const l of fs.readFileSync(path.join(dir, f), 'utf8').split(/\r?\n/)) {
      if (!l.trim()) continue;
      try { const o = JSON.parse(l); if (!o.ts) o.ts = f.slice(6, 16) + 'T00:00:00Z'; out.push(o); } catch { out.push({ evento: '__ilegivel__', ts: f.slice(6, 16) + 'T00:00:00Z' }); }
    }
  }
  return out;
}

function medir(linhas, { dias = 30, agora = new Date() } = {}) {
  const desde = new Date(agora.getTime() - dias * 86400_000);
  const tot = { autonoma: 0, humana: 0, aviso: 0, falha: 0, trava: 0, ignorada: 0, ilegivel: 0 };
  const motivosHumanos = {}; const porAgente = {}; const porSemana = {};
  for (const o of linhas) {
    if (o.evento === '__ilegivel__') { tot.ilegivel++; continue; }
    const ts = new Date(o.ts);
    if (isNaN(ts) || ts < desde || ts > agora) continue;
    const { classe, motivo } = classificar(o);
    tot[classe]++;
    if (classe === 'humana') motivosHumanos[motivo] = (motivosHumanos[motivo] || 0) + 1;
    if (classe === 'autonoma' || classe === 'humana') {
      const ag = o.agente || 'sem_agente';
      porAgente[ag] = porAgente[ag] || { autonoma: 0, humana: 0 };
      porAgente[ag][classe]++;
      const sem = semanaISO(ts);
      porSemana[sem] = porSemana[sem] || { autonoma: 0, humana: 0 };
      porSemana[sem][classe]++;
    }
  }
  const acoes = tot.autonoma + tot.humana;
  const taxa = acoes ? Math.round((tot.autonoma / acoes) * 1000) / 10 : null;
  return {
    medido_em: agora.toISOString(), dias, desde: desde.toISOString().slice(0, 10),
    metodo: 'orchestrator/medidor-autonomia/medir.js::classificar — ações = autônomas + humanas; avisos, falhas e telemetria ficam fora do denominador',
    acoes, taxa_autonomia_pct: taxa, meta_pct: 98, contagens: tot,
    paradas_humanas: Object.entries(motivosHumanos).sort((a, b) => b[1] - a[1]).map(([motivo, n]) => ({ motivo, n })),
    por_agente: Object.fromEntries(Object.entries(porAgente).map(([a, v]) => [a, { ...v, taxa_pct: (v.autonoma + v.humana) ? Math.round((v.autonoma / (v.autonoma + v.humana)) * 1000) / 10 : null }])),
    por_semana: Object.fromEntries(Object.entries(porSemana).sort()),
    lacunas: [
      tot.ignorada ? `${tot.ignorada} linhas de telemetria fora do cálculo (esperado)` : null,
      tot.ilegivel ? `${tot.ilegivel} linhas ilegíveis no audit` : null,
      tot.trava ? `${tot.trava} bloqueios de guardrail fora do denominador: a suíte test-guards.ps1 gera 15 por rodada da Porta e o hook não marca teste — bloqueio real exige leitura do comando` : null,
      !acoes ? 'nenhuma ação classificável no período — taxa indefinida' : null,
      'aprovações dadas em chat sem linha no audit não aparecem aqui: a taxa real é MENOR ou igual à medida',
    ].filter(Boolean),
  };
}

function semanaISO(d) {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dia = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - dia);
  const ano = t.getUTCFullYear(); const n = Math.ceil((((t - Date.UTC(ano, 0, 1)) / 86400_000) + 1) / 7);
  return `${ano}-W${String(n).padStart(2, '0')}`;
}

function relatorioMd(m) {
  const l = [`# Autonomia da frota · ${m.medido_em.slice(0, 10)} · últimos ${m.dias} dias`, '',
    `**Taxa de autonomia: ${m.taxa_autonomia_pct === null ? 'indefinida' : m.taxa_autonomia_pct + '%'}** (meta ${m.meta_pct}%) · ações ${m.acoes} = autônomas ${m.contagens.autonoma} + humanas ${m.contagens.humana} · avisos ao fundador ${m.contagens.aviso} · falhas ${m.contagens.falha} · travas de guardrail ${m.contagens.trava}`, '',
    '## Onde o humano foi acionado', '', '| Motivo | n |', '|---|---|', ...m.paradas_humanas.map((p) => `| ${p.motivo} | ${p.n} |`), '',
    '## Por agente', '', '| Agente | autônomas | humanas | taxa |', '|---|---|---|---|', ...Object.entries(m.por_agente).map(([a, v]) => `| ${a} | ${v.autonoma} | ${v.humana} | ${v.taxa_pct ?? '—'}% |`), '',
    '## Por semana', '', '| Semana | autônomas | humanas |', '|---|---|---|', ...Object.entries(m.por_semana).map(([s, v]) => `| ${s} | ${v.autonoma} | ${v.humana} |`), '',
    '## Lacunas', '', ...m.lacunas.map((x) => `- ${x}`), '', `Método: ${m.metodo}`];
  return l.join('\n');
}

module.exports = { classificar, medir, lerLinhas, relatorioMd, semanaISO };

if (require.main === module) {
  const a = process.argv.slice(2);
  const dias = a.includes('--dias') ? Number(a[a.indexOf('--dias') + 1]) : 30;
  const m = medir(lerLinhas(), { dias });
  fs.mkdirSync(path.dirname(ARQ_STATE), { recursive: true });
  fs.writeFileSync(ARQ_STATE, JSON.stringify(m, null, 2), 'utf8');
  const dirRel = path.join(DIR_LOGS, 'autonomia'); fs.mkdirSync(dirRel, { recursive: true });
  const arqRel = path.join(dirRel, `${m.medido_em.slice(0, 10)}.md`);
  fs.writeFileSync(arqRel, relatorioMd(m), 'utf8');
  if (a.includes('--json')) console.log(JSON.stringify(m, null, 2));
  else console.log(relatorioMd(m));
  console.log(`\n→ ${path.relative(process.cwd(), ARQ_STATE)} · ${path.relative(process.cwd(), arqRel)}`);
}
