#!/usr/bin/env node
'use strict';
/**
 * Observador do teste ponta a ponta do cadastro (item 1 do plano de 08/09).
 * Tira uma foto do estado: candidaturas, contas e execuções recentes dos workflows de e-mail
 * do cadastro no n8n. Rodar antes e depois de cada passo do teste; a comparação diz o que o
 * sistema fez sozinho (ou deixou de fazer). Somente leitura.
 *
 *   node observar-cadastro.js
 */
const fs = require('node:fs');
const path = require('node:path');
const RAIZ = path.resolve(__dirname, '..', '..', '..');

function envDe(rel) {
  const p = path.join(RAIZ, rel);
  return Object.fromEntries(fs.readFileSync(p, 'utf8').split(/[\r\n]+/).filter((l) => l && !l.startsWith('#')).map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
}

const FLUXOS = {
  pMm1Qg3FEZY0THzH: 'send-token (convite/senha)',
  k5bNbCQSzGd1u3ZK: 'listing-otp (código da listagem)',
  TkC4zLu3uA6B01Ii: 'confirmação de solicitação',
  '1pc2qJX4kYkBni3s': 'reset-password',
};

(async () => {
  console.log('FOTO ·', new Date().toISOString(), '\n');

  // ---- banco (twk_ro): candidaturas + contas — horários convertidos no SQL, nunca pelo driver
  const { Client } = (() => { for (const p of [["Agente Gerenciador do Banco de Dados","twk-db-agent","node_modules","pg"],["Agente de Suporte e Concierge","node_modules","pg"],["Agente Comercial","service","node_modules","pg"],["orchestrator","command-center","node_modules","pg"]]) { try { return require(path.join(RAIZ, ...p)); } catch {} } throw new Error("biblioteca pg não encontrada em nenhum agente — rode npm install na Aria"); })();
  const c = new Client({ connectionString: envDe('Agente Gerenciador do Banco de Dados/twk-db-agent/.env.readonly.local').DATABASE_URL_RO, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const cand = await c.query(`select restaurant_name, full_name, status,
      to_char(created_at, 'MM-DD HH24:MI') criado_utc,
      to_char(expires_at, 'MM-DD HH24:MI') expira_utc,
      completed_at is not null concluido, listing_email_status
    from restaurant_invitations order by created_at desc limit 6`);
  console.log('CANDIDATURAS (mais novas primeiro):');
  for (const x of cand.rows) console.log(`  ${x.restaurant_name} · ${x.full_name} · ${x.status}${x.concluido ? ' · CONCLUÍDA' : ''} · criada ${x.criado_utc}Z · expira ${x.expira_utc || '—'}Z · listagem=${x.listing_email_status}`);
  const contas = await c.query(`select count(*)::int n from restaurant_users`);
  console.log(`\nCONTAS em restaurant_users: ${contas.rows[0].n}  (2 = linha de base 08/09: Le Julien interna + teste BOTECO; Marlon Food excluido)`);
  await c.end();

  // ---- n8n: execuções dos fluxos do cadastro na última hora
  const key = envDe('Agente Gerenciador do Banco de Dados/twk-db-agent/.env.n8n.local').N8N_API_KEY;
  const H = { 'X-N8N-API-KEY': key, accept: 'application/json' };
  const corte = Date.now() - 3600e3;
  console.log('\nEXECUÇÕES n8n na última hora (fluxos do cadastro):');
  let alguma = false;
  for (const [id, nome] of Object.entries(FLUXOS)) {
    const j = await (await fetch(`https://theworldkeys-n8n.xis4ee.easypanel.host/api/v1/executions?workflowId=${id}&limit=10`, { headers: H })).json();
    for (const e of (j.data || []).filter((x) => Date.parse(x.startedAt) >= corte)) { console.log(`  ${e.startedAt} · ${nome} · ${e.status}`); alguma = true; }
  }
  if (!alguma) console.log('  (nenhuma)');
  console.log('\nO e-mail que o candidato recebeu (ou não) eu leio na caixa — pedir na conversa.');
})().catch((e) => { console.error('ERRO', e.message); process.exit(1); });
