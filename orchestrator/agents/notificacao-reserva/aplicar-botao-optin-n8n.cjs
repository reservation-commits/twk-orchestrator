#!/usr/bin/env node
'use strict';
/**
 * Botão de opt-in de WhatsApp no e-mail "solicitação enviada" (plano C2, 2026-10-22).
 *
 *   node aplicar-botao-optin-n8n.cjs            → DRY-RUN: mostra o que mudaria no fluxo "1 - nova reserva (site novo)"
 *   node aplicar-botao-optin-n8n.cjs --apply    → grava o fluxo no n8n pela API (mudança de configuração em produção:
 *                                                  só com o "pode aplicar" do fundador registrado no chat)
 *
 * FATO (22/10, API do n8n): o fluxo ativo "1 - nova reserva (site novo)" (id ztI9ws9F6BAGJSGr, atualizado em 09/09)
 * manda ao cliente o e-mail "Solicitação Enviada Usuário" com o botão "Follow my request" (link para a conta) e o
 * rodapé genérico do concierge. O botão de opt-in da v20 (docs/notificacoes/templates/familia/
 * wf1-solicitacao-enviada-cliente.v20-proposta.html, linhas 66-76) NUNCA entrou no fluxo. É por isso que, 17 dias
 * depois da v20, nenhum cliente tem opt-in: a Aria espera a primeira mensagem que o botão provocaria.
 *
 * O que muda: logo após o bloco do botão "Follow my request", entra o bloco da v20 (botão "Receive updates on
 * WhatsApp" com a mensagem pronta e o código da reserva, e a frase de explicação). Nada é removido.
 * Medição: aria_contact_consent (tipo='cliente') — a Sentinela já vigia (wa_optin_clientes). O rastreio de clique
 * pelo /go depende da decisão pendente CMP-20260918-RASTREIO-CTA; por isso o link é direto.
 */
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.resolve(__dirname, '..', '..', '..');
const WORKFLOW = '1 - nova reserva (site novo)';
const NO = 'Solicitação Enviada Usuário';
const PROPOSTA = path.join(RAIZ, 'docs', 'notificacoes', 'templates', 'familia', 'wf1-solicitacao-enviada-cliente.v20-proposta.html');

function envN8n() {
  const f = path.join(RAIZ, 'Agente Gerenciador do Banco de Dados', 'twk-db-agent', '.env.n8n.local');
  const env = Object.fromEntries(fs.readFileSync(f, 'utf8').split(/\r?\n/).filter((l) => l && !l.startsWith('#') && l.includes('=')).map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')]; }));
  if (!env.N8N_API_KEY) throw new Error('N8N_API_KEY ausente em ' + f);
  return { url: (env.N8N_URL || env.N8N_BASE_URL || 'https://theworldkeys-n8n.xis4ee.easypanel.host').replace(/\/$/, ''), H: { 'X-N8N-API-KEY': env.N8N_API_KEY, accept: 'application/json', 'content-type': 'application/json' } };
}

/** O bloco da v20: do comentário "v20 (2026-10-05)" até a frase de explicação (inclusive). */
function blocoV20() {
  const html = fs.readFileSync(PROPOSTA, 'utf8');
  const ini = html.indexOf('<!-- v20 (2026-10-05)');
  const fimMarca = 'You can stop at any time.</p></td></tr>';
  const fim = html.indexOf(fimMarca, ini);
  if (ini < 0 || fim < 0) throw new Error('bloco v20 não encontrado na proposta');
  return html.slice(ini, fim + fimMarca.length);
}

(async () => {
  const apply = process.argv.includes('--apply');
  const { url, H } = envN8n();
  const lista = await (await fetch(`${url}/api/v1/workflows?limit=250`, { headers: H })).json();
  const w = (lista.data || []).find((x) => x.name === WORKFLOW);
  if (!w) throw new Error(`fluxo "${WORKFLOW}" não encontrado`);
  const d = await (await fetch(`${url}/api/v1/workflows/${w.id}`, { headers: H })).json();
  const no = d.nodes.find((n) => n.name === NO);
  if (!no) throw new Error(`nó "${NO}" não encontrado`);
  const msg = String(no.parameters.message || '');
  if (/Receive updates on WhatsApp/.test(msg)) { console.log('já aplicado: o e-mail tem o botão de opt-in. Nada a fazer.'); return; }
  const ancora = 'Follow my request</a>';
  const i = msg.indexOf(ancora);
  if (i < 0) throw new Error('âncora "Follow my request" não encontrada no e-mail');
  // fecha o <tr> do botão existente: </td> </tr></table> </td> </tr>
  const fimLinha = msg.indexOf('</tr>', msg.indexOf('</table>', i)) + '</tr>'.length;
  const bloco = blocoV20();
  const novo = msg.slice(0, fimLinha) + '\n' + bloco + '\n' + msg.slice(fimLinha);
  console.log(`fluxo ${w.id} · ativo=${d.active} · atualizado ${d.updatedAt}`);
  console.log(`nó "${NO}": mensagem ${msg.length} → ${novo.length} chars (+${novo.length - msg.length}); botão inserido após "Follow my request"`);
  console.log('trecho inserido (início):', bloco.replace(/\s+/g, ' ').slice(0, 160) + ' …');
  if (!apply) { console.log('\nDRY-RUN — nada gravado. Para aplicar (com o "pode aplicar" do fundador): --apply'); return; }

  no.parameters.message = novo;
  const corpo = { name: d.name, nodes: d.nodes, connections: d.connections, settings: d.settings || {}, staticData: d.staticData ?? null };
  const r = await fetch(`${url}/api/v1/workflows/${w.id}`, { method: 'PUT', headers: H, body: JSON.stringify(corpo) });
  if (!r.ok) throw new Error(`PUT falhou: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
  const conf = await (await fetch(`${url}/api/v1/workflows/${w.id}`, { headers: H })).json();
  const ok = /Receive updates on WhatsApp/.test(String(conf.nodes.find((n) => n.name === NO).parameters.message || ''));
  const audit = path.join(RAIZ, 'orchestrator', 'logs', `audit-${new Date().toISOString().slice(0, 10)}.jsonl`);
  fs.appendFileSync(audit, JSON.stringify({ ts: new Date().toISOString(), trace_id: 'trc-optin-botao-20261022', agente: 'orquestrador', evento: 'n8n_workflow_alterado', workflow: w.id, no: NO, mudanca: 'botão de opt-in de WhatsApp (v20) inserido', conferido: ok }) + '\n');
  console.log(ok ? 'APLICADO e conferido: o e-mail passa a trazer o botão de opt-in.' : 'ATENÇÃO: gravou, mas a releitura não encontrou o botão — conferir no n8n.');
})().catch((e) => { console.error('FALHA:', e.message); process.exit(2); });
