#!/usr/bin/env node
'use strict';
/**
 * Lê a execução do workflow agendado no n8n (sequência Lagos) e grava o LEDGER + auditoria com o que saiu de verdade.
 * "Se não está no log, não aconteceu": o ledger só é escrito a partir da execução, nunca antes.
 *
 *   node registrar-execucao-n8n.js --workflow <id> --toque 1            → lê a última execução, mostra, NÃO grava
 *   node registrar-execucao-n8n.js --workflow <id> --toque 1 --gravar   → grava no ledger (idempotente por casa+campanha+toque)
 */
const fs = require('node:fs');
const path = require('node:path');
const RAIZ = path.resolve(__dirname, '..', '..', '..');
const LEDGER = path.join(RAIZ, 'orchestrator', 'state', 'envios-fundadores-2026-08.csv');
const LOGS = path.join(RAIZ, 'orchestrator', 'logs');
const MANIFESTO = path.join(RAIZ, 'orchestrator', 'state', 'lagos', 'emails', 'sequencia-manifesto.csv');
const N8N = 'https://theworldkeys-n8n.xis4ee.easypanel.host';
const CAMPANHA = 'lagos_sequencia_2026_09';
const envN8n = Object.fromEntries(fs.readFileSync(path.join(RAIZ, 'Agente Gerenciador do Banco de Dados', 'twk-db-agent', '.env.n8n.local'), 'utf8').split(/[\r\n]+/).filter((l) => l && !l.startsWith('#')).map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const H = { 'X-N8N-API-KEY': envN8n.N8N_API_KEY, accept: 'application/json' };
const a = process.argv.slice(2);
const val = (n, d = null) => { const i = a.indexOf(n); return i >= 0 && a[i + 1] ? a[i + 1] : d; };
const wfId = val('--workflow'); const toque = `T${val('--toque', '1')}`; const gravar = a.includes('--gravar');
const hoje = () => new Date().toISOString().slice(0, 10);
const audit = (o) => { try { fs.appendFileSync(path.join(LOGS, `audit-${hoje()}.jsonl`), JSON.stringify({ ts: new Date().toISOString(), trace_id: 'trc-lagos-20260916', agente: 'chave-girada', campanha: CAMPANHA, toque, ...o }) + '\n'); } catch {} };

(async () => {
  if (!wfId) { console.error('--workflow <id> obrigatório'); process.exit(2); }
  const ex = await (await fetch(`${N8N}/api/v1/executions?workflowId=${wfId}&limit=5`, { headers: H })).json();
  const lista = ex.data || [];
  if (!lista.length) { console.log('nenhuma execução ainda.'); return; }
  const e = lista[0];
  const full = await (await fetch(`${N8N}/api/v1/executions/${e.id}?includeData=true`, { headers: H })).json();
  console.log(`execução ${e.id} · ${e.startedAt} → ${e.stoppedAt || '…'} · status ${e.status}`);
  const run = (full.data && full.data.resultData && full.data.resultData.runData) || {};
  const erro = full.data && full.data.resultData && full.data.resultData.error;
  if (erro) console.log('ERRO na execução:', (erro.message || JSON.stringify(erro)).slice(0, 300));
  const resumo = ((run['Resumo'] || [])[0] || {}).data; const itens = resumo && resumo.main && resumo.main[0] ? resumo.main[0].map((i) => i.json) : [];
  const corpos = ((run['Corpos + trava de data'] || [])[0] || {}).data; const c0 = corpos && corpos.main && corpos.main[0] && corpos.main[0][0] && corpos.main[0][0].json;
  if (c0 && c0.skip) console.log('trava de data acionada:', c0.motivo);
  console.log(`itens no Resumo: ${itens.length}`);
  for (const i of itens) console.log(`  ${i.ok ? '✓' : '✗'} ${i.nome} (${i.rid}) → *@${i.dominio}${i.ok ? '' : ' · ' + JSON.stringify(i.resposta).slice(0, 120)}`);
  if (!gravar) { console.log('\n(sem --gravar: ledger não alterado)'); return; }
  const nomes = Object.fromEntries(fs.readFileSync(MANIFESTO, 'utf8').split(/\r?\n/).slice(1).filter(Boolean).map((l) => l.split(';')).map((c) => [c[2], c[3]]));
  const ledger = fs.readFileSync(LEDGER, 'utf8').split(/\r?\n/).slice(1).filter(Boolean).map((l) => l.split(';'));
  let n = 0;
  for (const i of itens.filter((x) => x.ok)) {
    if (ledger.some((l) => l[0] === String(i.rid) && l[2] === CAMPANHA && l[3] === toque && l[4] !== '0')) continue;
    const linha = [i.rid, nomes[i.rid] || i.nome, CAMPANHA, toque, 1, 'email', `*@${i.dominio}`, 'pt', `n8n-exec-${e.id}`, String(e.startedAt).slice(0, 10), 'n8n-agendado', 'fundador, chat 2026-09-16 (agendamento)', 'trc-lagos-20260916', '', '', '', '', `sequência Lagos ${toque} via workflow ${wfId}`].join(';');
    fs.appendFileSync(LEDGER, '\n' + linha); n++;
  }
  audit({ evento: 'ledger_registrado_de_execucao', workflowId: wfId, execucao: e.id, ok: itens.filter((x) => x.ok).length, falhas: itens.filter((x) => !x.ok).length, gravados: n });
  console.log(`\nledger: ${n} linha(s) gravada(s). Agora: conferir 1 mensagem na pasta Enviados e desativar o workflow.`);
})().catch((err) => { console.error('ERRO', err.message); process.exit(1); });
