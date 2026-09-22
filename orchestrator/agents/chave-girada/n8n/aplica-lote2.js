#!/usr/bin/env node
'use strict';
/**
 * Aplica o lote 2 nos 4 workflows (7 nós). SÓ com aprovação do fundador registrada:
 *   node aplica-lote2.js --aprovacao "<frase do fundador>"
 * Backup completo de cada workflow antes do PUT; releitura depois; nunca muda destinatário nem assunto.
 */
const fs = require('node:fs');
const path = require('node:path');
const RAIZ = path.resolve(__dirname, '..', '..', '..', '..');
const L2 = path.join(__dirname, 'lote2');
const BKP = path.join(RAIZ, 'docs/notificacoes/backup-n8n');
const env = Object.fromEntries(fs.readFileSync(path.join(RAIZ, 'Agente Gerenciador do Banco de Dados/twk-db-agent/.env.n8n.local'), 'utf8').split(/[\r\n]+/).filter((l) => l && !l.startsWith('#')).map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const base = 'https://theworldkeys-n8n.xis4ee.easypanel.host';
const H = { 'X-N8N-API-KEY': env.N8N_API_KEY, accept: 'application/json', 'content-type': 'application/json' };
const a = process.argv.slice(2); const i = a.indexOf('--aprovacao'); const aprovacao = i >= 0 ? a[i + 1] : null;
if (!aprovacao || aprovacao.length < 10) { console.error('BLOQUEADO: --aprovacao "<frase do fundador>" obrigatória'); process.exit(3); }

const PLANO = {
  '8sKe89Lz5Vzpy3a5': { 'Confirmado - Cliente': 'reag-confirmado-cliente.html', 'Confirmado - Estabelecimento': 'reag-confirmado-estabelecimento.html', 'Recusado - Cliente': 'reag-recusado-cliente.html', 'Recusado - Estabelecimento': 'reag-recusado-estabelecimento.html' },
  '1pc2qJX4kYkBni3s': { 'Send a message': 'reset-senha-cliente.html' },
  '6ONkRN-zDsy0qpvXBn6NH': { 'Send a message': 'candidatura-recebida.html' },
  'TkC4zLu3uA6B01Ii': { 'Send a message': 'candidatura-aprovada.html' },
};
const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 15);
const audit = (o) => { try { fs.appendFileSync(path.join(RAIZ, 'orchestrator/logs', `audit-${new Date().toISOString().slice(0, 10)}.jsonl`), JSON.stringify({ ts: new Date().toISOString(), trace_id: 'trc-templates-lote2', agente: 'maestro', ...o }) + '\n'); } catch {} };

(async () => {
  for (const [id, nos] of Object.entries(PLANO)) {
    const w = await (await fetch(`${base}/api/v1/workflows/${id}`, { headers: H })).json();
    fs.writeFileSync(path.join(BKP, `${id}-antes-lote2-${ts}.json`), JSON.stringify(w, null, 1));
    let trocados = 0;
    for (const n of w.nodes || []) {
      const arq = nos[n.name]; if (!arq) continue;
      const novo = fs.readFileSync(path.join(L2, arq), 'utf8');
      if (!novo.startsWith('=') || !novo.includes('#0B0A08')) throw new Error(`${arq} inválido`);
      if (id === '1pc2qJX4kYkBni3s' && !novo.includes("resetUrl.replace(/=([0-9A-Fa-f]{2})/g, '=3D$1')")) throw new Error('reset sem compensação QP — abortando');
      console.log(`${w.name} · [${n.name}] ${String(n.parameters.message || '').length} -> ${novo.length} bytes`);
      n.parameters.message = novo; trocados++;
    }
    if (trocados !== Object.keys(nos).length) throw new Error(`${id}: esperava ${Object.keys(nos).length} nós, troquei ${trocados} — abortando sem PUT`);
    // A API pública só aceita estas chaves em settings; workflows antigos carregam outras (ex.: callerPolicy) e o PUT dá 400.
    const PERMITIDAS = ['saveExecutionProgress', 'saveManualExecutions', 'saveDataErrorExecution', 'saveDataSuccessExecution', 'executionTimeout', 'errorWorkflow', 'timezone', 'executionOrder'];
    const settings = Object.fromEntries(Object.entries(w.settings || {}).filter(([k]) => PERMITIDAS.includes(k)));
    const r = await fetch(`${base}/api/v1/workflows/${id}`, { method: 'PUT', headers: H, body: JSON.stringify({ name: w.name, nodes: w.nodes, connections: w.connections, settings }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`PUT ${id} falhou: HTTP ${r.status} ${JSON.stringify(j).slice(0, 200)}`);
    const w2 = await (await fetch(`${base}/api/v1/workflows/${id}`, { headers: H })).json();
    const ok = (w2.nodes || []).filter((n) => nos[n.name] && String(n.parameters.message || '').includes('#0B0A08')).length;
    console.log(`  PUT ok · ativo=${w2.active} · releitura ${ok}/${Object.keys(nos).length}`);
    audit({ evento: 'n8n_templates_aplicados', workflow: id, nome: w.name, nos: Object.keys(nos), backup: `${id}-antes-lote2-${ts}.json`, aprovacao_ref: aprovacao, ok: ok === Object.keys(nos).length });
  }
})().catch((e) => { console.error('ERRO', e.message); process.exit(1); });
