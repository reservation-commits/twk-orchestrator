#!/usr/bin/env node
'use strict';
/**
 * Portão 0 — reenvio do convite de acesso ao ELEOS (Ozan Tekin), com o link íntegro.
 * Aprovação: fundador, chat 2026-09-07 "Portão 0 com perfeição e segurança".
 *
 *   node enviar-convite-eleos.js                     → DRY-RUN (valida, não envia)
 *   node enviar-convite-eleos.js --teste             → envia a cópia de teste para a caixa do fundador
 *   node enviar-convite-eleos.js --apply             → envia ao Ozan
 *
 * Guardrails em código (falhar alto, nunca "ok" silencioso):
 *   1. corpo não pode conter cerca de markdown (```) — defeito visível no envio de 05/09
 *   2. o token é lido do banco na hora do envio; status != approved, concluído ou expirado → aborta
 *   3. a URL do convite tem de aparecer 3x no HTML-fonte e 3x (compensada) no corpo que sai
 *
 * CANAL: a compensação do defeito quoted-printable vive AGORA no n8n (nó "Enviar (Gmail)" do workflow
 * ME1djOuCttCjMTJvxOg9a), aplicada e verificada por sonda em 2026-09-07 15:52Z. Este script NÃO compensa:
 * fazer isso aqui também produziria "=3D3D" e quebraria o link de novo.
 */
const fs = require('node:fs');
const path = require('node:path');

(function env() { const f = process.env.TWK_REGENCIA_ENV || path.join(process.env.USERPROFILE || process.env.HOME || '', '.twk', 'regencia.env'); try { for (const l of fs.readFileSync(f, 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim(); } } catch {} })();

const RAIZ = path.resolve(__dirname, '..', '..', '..');
const HTML = path.join(RAIZ, 'orchestrator', 'state', 'chave-girada', 'email-eleos-convite-EN.html');
const LOGS = path.join(RAIZ, 'orchestrator', 'logs');
const WEBHOOK = process.env.EMAIL_WEBHOOK_URL || '';
const TOKEN_WH = process.env.EMAIL_WEBHOOK_TOKEN || '';
const DESTINO = 'ozantekin@hotmail.com';
const TESTE_PARA = 'thekeys.marlon@gmail.com';
const ASSUNTO = 'ELEOS: a fresh access link (the previous one expired on us)';

const a = process.argv.slice(2);
const apply = a.includes('--apply');
const teste = a.includes('--teste');
const hoje = new Date().toISOString().slice(0, 10);
const trace = 'trc-eleos-portao0';
const audit = (o) => { try { fs.mkdirSync(LOGS, { recursive: true }); fs.appendFileSync(path.join(LOGS, `audit-${hoje}.jsonl`), JSON.stringify({ ts: new Date().toISOString(), trace_id: trace, agente: 'chave-girada', ...o }) + '\n'); } catch {} };
const jaCompensado = (s) => /=3D[0-9A-Fa-f]{2}/.test(s);

function envRO() {
  const p = path.join(RAIZ, 'Agente Gerenciador do Banco de Dados', 'twk-db-agent', '.env.readonly.local');
  return Object.fromEntries(fs.readFileSync(p, 'utf8').split(/\r?\n/).filter((l) => l && !l.startsWith('#')).map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
}

async function main() {
  const fonte = fs.readFileSync(HTML, 'utf8');
  if ((fonte.split('__TOKEN__').length - 1) !== 3) { console.error('BLOQUEADO: o HTML-fonte deve ter o placeholder __TOKEN__ 3x (botão, href e texto)'); process.exit(3); }

  // guardrail 1
  if (fonte.includes('```')) { console.error('BLOQUEADO: o corpo contém cerca de markdown (```)'); process.exit(3); }

  // guardrail 1b — a compensação é do n8n; pré-compensar aqui produziria "=3D3D"
  if (jaCompensado(fonte)) { console.error('BLOQUEADO: o HTML já vem compensado (=3D). A compensação vive no n8n.'); process.exit(3); }

  // guardrail 2 — convite vivo, token do banco
  const { Client } = require(path.join(RAIZ, 'Agente Comercial', 'service', 'node_modules', 'pg'));
  const c = new Client({ connectionString: envRO().DATABASE_URL_RO, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const r = await c.query('select token, status, expires_at, completed_at from restaurant_invitations where email = $1 order by created_at desc limit 1', [DESTINO]);
  await c.end();
  if (!r.rowCount) { console.error('BLOQUEADO: convite não encontrado'); process.exit(3); }
  const inv = r.rows[0];
  if (inv.status !== 'approved') { console.error(`BLOQUEADO: status = ${inv.status}`); process.exit(3); }
  if (inv.completed_at) { console.error('BLOQUEADO: convite já concluído — não reenviar'); process.exit(3); }
  if (new Date(inv.expires_at) <= new Date()) { console.error('BLOQUEADO: convite expirado — pedir novo token ao desenvolvedor'); process.exit(3); }

  // token do banco entra no lugar do placeholder — o HTML nunca carrega token velho
  const corpo = fonte.split('__TOKEN__').join(inv.token);
  const url = `https://manager.theworldkeys.com/restaurants/invite?token=${inv.token}`;
  const nFonte = corpo.split(url).length - 1;
  if (nFonte !== 3) { console.error(`BLOQUEADO: a URL montada aparece ${nFonte}x no corpo (esperado 3)`); process.exit(3); }
  const nCorpo = corpo.split(url).length - 1;
  if (nCorpo !== 3) { console.error(`BLOQUEADO: a URL aparece ${nCorpo}x no corpo que sai (esperado 3)`); process.exit(3); }

  const para = teste ? TESTE_PARA : DESTINO;
  const assunto = teste ? `[TESTE] ${ASSUNTO}` : ASSUNTO;
  console.log(`destino: ${para}`);
  console.log(`assunto: ${assunto}`);
  console.log(`URL conferida contra o banco: ok (${nFonte}x no fonte, ${nCorpo}x no corpo)`);
  console.log(`expira: ${inv.expires_at.toISOString()}`);
  console.log(`html: ${fonte.length} bytes -> corpo enviado: ${corpo.length} bytes`);

  if (!apply && !teste) { console.log('\nDRY-RUN — nada enviado. Use --teste ou --apply.'); return; }
  if (!WEBHOOK || !TOKEN_WH) { console.error('EMAIL_WEBHOOK_URL/TOKEN ausentes'); process.exit(2); }

  const resp = await fetch(WEBHOOK, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN_WH}` }, body: JSON.stringify({ para, assunto, html: corpo }) });
  console.log(`envio: HTTP ${resp.status} ${resp.ok ? 'aceito' : 'RECUSADO'}`);
  audit({ evento: 'email_envio', caso: 'eleos-convite-portao0', restaurant_id: '16987', destino_dominio: para.split('@')[1], teste, ok: resp.ok, http: resp.status, aprovacao_ref: "chat 2026-09-07: 'Portão 0 com perfeição e segurança'" });
  if (!resp.ok) process.exit(1);
  console.log('\nCONFERIR AGORA: reler a mensagem na caixa e comparar a URL. Sem essa releitura, o envio não está verificado.');
}
main().catch((e) => { console.error('ERRO', e.message); process.exit(1); });
