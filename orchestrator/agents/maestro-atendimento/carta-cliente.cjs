#!/usr/bin/env node
'use strict';
/**
 * Carta avulsa do MAESTRO a um cliente, pelo e-mail do pedido (ADR-016: atendimento ponta a ponta).
 *
 *   node carta-cliente.cjs --reserva <código> --carta <arquivo.json>                      → dry-run: preview em state/cartas/
 *   node carta-cliente.cjs --reserva <código> --carta <arquivo.json> --apply --aprovacao "…" → envia pelo canal do MAESTRO (n8n)
 *
 * arquivo.json: { "idioma": "en", "assunto": "…", "titulo": "…", "paragrafos": ["…", "…"], "fecho": "…",
 *                "rodapeWa": "Message our concierge on WhatsApp", "rodapePrefixo": "Any questions?" }
 *
 * Regras (ADR-015): a carta passa pela mesma porta de saída da Aria (outboundGate, em texto) antes de sair; o
 * destinatário é o e-mail da conta ligada ao pedido (nunca um endereço digitado à mão); uma carta por reserva e
 * assunto no ledger (não se escreve duas vezes a mesma coisa). O e-mail nunca é impresso inteiro: só o domínio.
 */
const fs = require('node:fs');
const path = require('node:path');
const B = require('../chave-girada/n8n/_blocos-twk.js');
const { comClienteRo } = require('../_lib/conectar');

const RAIZ = path.resolve(__dirname, '..', '..', '..');
const STATE = path.join(__dirname, 'state');
const PREV = path.join(STATE, 'cartas');
const LEDGER = path.join(STATE, 'cartas.jsonl');
const LOGS = path.join(RAIZ, 'orchestrator', 'logs');
fs.mkdirSync(PREV, { recursive: true });

(function env() {
  const f = path.join(process.env.USERPROFILE || process.env.HOME || '', '.twk', 'regencia.env');
  try { for (const l of fs.readFileSync(f, 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim(); } } catch {}
})();
const WEBHOOK = process.env.EMAIL_WEBHOOK_URL || '';
const TOKEN = process.env.EMAIL_WEBHOOK_TOKEN || '';

const a = process.argv.slice(2);
const val = (n) => { const i = a.indexOf(n); return i >= 0 ? a[i + 1] : null; };
const apply = a.includes('--apply');
const codigo = val('--reserva');
const arquivo = val('--carta');
const aprovacao = val('--aprovacao');
if (!codigo || !arquivo) { console.error('uso: --reserva <código> --carta <arquivo.json> [--apply --aprovacao "…"]'); process.exit(2); }
if (apply && (!aprovacao || aprovacao.length < 10)) { console.error('BLOQUEADO: --apply exige --aprovacao "<referência>"'); process.exit(3); }
if (apply && (!WEBHOOK || !TOKEN)) { console.error('BLOQUEADO: EMAIL_WEBHOOK_URL/TOKEN ausentes'); process.exit(2); }

const hoje = new Date().toISOString().slice(0, 10);
const trace = `trc-carta-${codigo}-${hoje.replace(/-/g, '')}`;
const audit = (o) => { try { fs.mkdirSync(LOGS, { recursive: true }); fs.appendFileSync(path.join(LOGS, `audit-${hoje}.jsonl`), JSON.stringify({ ts: new Date().toISOString(), trace_id: trace, agente: 'maestro-atendimento', ...o }) + '\n'); } catch {} };

// Porta de saída (compilada da Aria): a mesma régua dos dois canais.
function portao(texto) {
  try {
    const { outboundGate } = require(path.join(RAIZ, 'Agente de Suporte e Concierge', 'dist', 'format.js'));
    return outboundGate(texto);
  } catch (e) { return { ok: false, motivo: `porta de saída indisponível (${e.message}) — compile a Aria (npm run build)` }; }
}

(async () => {
  const carta = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  const r = await comClienteRo(async (c) => (await c.query(
    `SELECT r.reservation_code, r.booking_date::date::text AS data, r.reservation_time::text AS hora, r.people, r.booking_status, r.expired_at,
            u.email, u.name, d.name AS restaurante, d.city
       FROM public.reservations r
       LEFT JOIN nextauth."User" u ON u.id = r.customer_id
       JOIN public.db_restaurants d ON d.restaurant_id = r.restaurant_id
      WHERE r.reservation_code = $1`, [codigo])).rows[0]);
  if (!r) throw new Error(`reserva ${codigo} não encontrada`);
  if (!r.email || !r.email.includes('@')) throw new Error(`reserva ${codigo} sem e-mail de cliente — não há canal`);
  const dominio = r.email.replace(/^.*@/, '');
  const ledger = fs.existsSync(LEDGER) ? fs.readFileSync(LEDGER, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l)) : [];
  if (ledger.some((l) => l.ok && l.reserva === codigo && l.assunto === carta.assunto)) throw new Error('já enviada (ledger): mesma reserva e assunto');

  const texto = [carta.titulo, ...carta.paragrafos, carta.fecho].join('\n\n').replace(/<[^>]+>/g, '');
  const p = portao(texto);
  if (!p.ok) throw new Error(`carta barrada pela porta de saída: ${p.motivo}`);

  const html = [
    B.cabeca(carta.titulo, carta.paragrafos[0].replace(/<[^>]+>/g, '').slice(0, 110), carta.idioma || 'en'),
    ...carta.paragrafos.map((x) => B.paragrafo(x)),
    B.paragrafo(carta.fecho),
    B.rodape(carta.rodapeWa || 'Message our concierge on WhatsApp', '', carta.rodapePrefixo || 'Any questions?'),
  ].join('\n');
  const preview = path.join(PREV, `${codigo}-${hoje}.html`);
  fs.writeFileSync(preview, html, 'utf8');

  console.log(`reserva ${codigo} · ${r.restaurante} (${r.city}) · ${r.data} ${String(r.hora).slice(0, 5)} · ${r.people}p · ${r.booking_status}${r.expired_at ? ' (expirada)' : ''}`);
  console.log(`cliente ${r.name || '?'} <@${dominio}> · idioma ${carta.idioma} · assunto: ${carta.assunto}`);
  console.log(`porta de saída: ok · preview: ${path.relative(RAIZ, preview)}`);
  if (!apply) { console.log('DRY-RUN — nada enviado.'); audit({ evento: 'carta_dry_run', reserva: codigo, dominio }); return; }

  const resp = await fetch(WEBHOOK, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` }, body: JSON.stringify({ para: r.email, assunto: carta.assunto, html }) });
  const linha = { ts: new Date().toISOString(), reserva: codigo, restaurante: r.restaurante, idioma: carta.idioma, assunto: carta.assunto, dominio, ok: resp.ok, http: resp.status, aprovacao_ref: aprovacao, trace_id: trace };
  fs.appendFileSync(LEDGER, JSON.stringify(linha) + '\n');
  audit({ evento: 'carta_cliente', ...linha });
  console.log(`${resp.ok ? 'ENVIADA' : 'FALHA'} HTTP ${resp.status}`);
  if (!resp.ok) process.exit(1);
})().catch((e) => { console.error('FALHA:', e.message); process.exit(1); });
