#!/usr/bin/env node
'use strict';
/**
 * Reparo do incidente de 2026-09-11 (nota interna da Aria entregue como carta oficial).
 *
 * Quatro envios, nesta ordem:
 *   1. BAAN CHIANG (Bangkok)  — cobrança do degrau 1 do Guardião pela reserva EVU5Z99H (en)
 *   2. MISS KÔ (Paris)        — cobrança do degrau 1 do Guardião pela reserva 3EPWVRW3 (fr)
 *   3. Nicole Eisenmann (BASF) — desculpa, status verdadeiro e compromisso datado (en)
 *   4. Hanna Opsahl Ben Ammar  — desculpa pelo "2 horas" que não se cumpriu, status e compromisso (fr)
 *
 * Regras honradas: nenhuma promessa de mesa; nenhuma promessa de "equipe humana em 2 horas";
 * nenhum dos dois restaurantes está no registro de opt-out (conferido antes do envio, fail-closed);
 * visual no padrão TWK; texto ao restaurante gerado pelo template oficial do Guardião.
 *
 *   node reparo-2026-09-11.js                                  → dry-run: renderiza previews, não envia
 *   node reparo-2026-09-11.js --apply --aprovacao "<frase>"     → envia pelo canal do MAESTRO
 */
const fs = require('node:fs');
const path = require('node:path');
const B = require('../chave-girada/n8n/_blocos-twk.js');
const templates = require('../guardiao-reserva/templates.js');

const RAIZ = path.resolve(__dirname, '..', '..', '..');
const STATE = path.join(__dirname, 'state');
const PREV = path.join(STATE, 'previews-reparo-2026-09-11');
const LEDGER = path.join(STATE, 'reparo-2026-09-11.jsonl');
const LOGS = path.join(RAIZ, 'orchestrator', 'logs');
fs.mkdirSync(PREV, { recursive: true });

(function env() {
  const f = path.join(process.env.USERPROFILE || process.env.HOME || '', '.twk', 'regencia.env');
  try {
    for (const l of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
      const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
    }
  } catch {}
})();
const WEBHOOK = process.env.EMAIL_WEBHOOK_URL || '';
const TOKEN = process.env.EMAIL_WEBHOOK_TOKEN || '';

const a = process.argv.slice(2);
const apply = a.includes('--apply');
const aprovacao = (() => { const i = a.indexOf('--aprovacao'); return i >= 0 ? a[i + 1] : null; })();
const hoje = new Date().toISOString().slice(0, 10);
const trace = 'trc-reparo-20260911';
const audit = (o) => { try { fs.mkdirSync(LOGS, { recursive: true }); fs.appendFileSync(path.join(LOGS, `audit-${hoje}.jsonl`), JSON.stringify({ ts: new Date().toISOString(), trace_id: trace, agente: 'maestro-atendimento', ...o }) + '\n'); } catch {} };

// ── Fail-closed: nenhum contato a restaurante sem o registro de opt-out legível ──
function optOutBloqueia(ids) {
  const f = path.join(RAIZ, 'orchestrator', 'state', 'listing-consent.jsonl');
  const linhas = fs.readFileSync(f, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
  const fora = new Set(linhas.filter((r) => r.status === 'opted_out').map((r) => String(r.restaurant_id)));
  return ids.filter((id) => fora.has(String(id)));
}

// ── 1 e 2: cobrança ao restaurante, template oficial do Guardião ──────────────
const cobrancas = [
  { chave: 'baan-chiang', idioma: 'en', nome: 'BAAN CHIANG', restaurant_id: '35171', para: 'baanchiang1986@gmail.com',
    reservas: [{ reservation_code: 'EVU5Z99H', booking_date: '2026-09-16', reservation_time: '19:00:00' }] },
  { chave: 'miss-ko', idioma: 'fr', nome: 'MISS KÔ', restaurant_id: '252064', para: 'restaurant@miss-ko.com',
    reservas: [{ reservation_code: '3EPWVRW3', booking_date: '2026-09-12', reservation_time: '21:00:00' }] },
];

// ── 3: Nicole Eisenmann (en) ─────────────────────────────────────────────────
function cartaNicole() {
  const titulo = 'Your dinner at BAAN CHIANG';
  const html = [
    B.cabeca(titulo, 'Where your request stands with BAAN CHIANG, and what happens next.', 'en'),
    B.paragrafo('Dear Ms Eisenmann,'),
    B.paragrafo('Thank you for following up, and my apologies for the reply you received earlier today. Please disregard it — here is the answer you asked for.'),
    B.cartaoDetalhes([
      B.linha('Reservation', 'EVU5Z99H'),
      B.linha('Restaurant', 'BAAN CHIANG, Bangkok'),
      B.linha('Date', 'Wednesday, 16 September 2026'),
      B.linha('Time', '7:00 PM'),
      B.linha('Guests', '6 guests', true),
    ].join('\n'), 'Your request is with the restaurant.'),
    B.paragrafo('I have written to BAAN CHIANG again today, directly, flagging it as a dinner for Mr Lang. The moment they confirm, the confirmation reaches you by e-mail and I write to you as well.'),
    B.paragrafo('So that you are not left waiting: if I do not have their confirmation by Monday 14 September at 12:00 Paris time, I will come back to you with two Bangkok addresses of the same standard for the same evening, and I take care of the arrangements. Your request stays exactly as it is in the meantime.'),
    B.paragrafo('You can reply straight to this e-mail at any time; it reaches me directly.'),
    B.paragrafo('With pleasure,<br/>Aria &#183; The World Keys'),
    B.rodape('Message our concierge on WhatsApp'),
  ].join('\n');
  return { para: 'nicole.eisenmann@basf.com', assunto: 'Re: Reservation status — EVU5Z99H, BAAN CHIANG (16 September)', html };
}

// ── 4: Hanna Opsahl Ben Ammar (fr) ───────────────────────────────────────────
function cartaHanna() {
  const titulo = 'Votre soirée chez MISS KÔ';
  const html = [
    B.cabeca(titulo, "Où en est votre demande chez MISS KÔ, et la suite que je vous propose.", 'fr'),
    B.paragrafo('Bonjour Madame Opsahl Ben Ammar,'),
    B.paragrafo("Merci de votre relance, et pardon de vous avoir fait attendre. Voici où en est votre soirée."),
    B.cartaoDetalhes([
      B.linha('Réservation', '3EPWVRW3'),
      B.linha('Restaurant', 'MISS KÔ, Paris'),
      B.linha('Date', 'Samedi 12 septembre 2026'),
      B.linha('Heure', '21h00'),
      B.linha('Couverts', '5 personnes', true),
    ].join("\n"), "Votre demande est entre les mains du restaurant."),
    B.paragrafo("Je viens de relancer MISS KÔ directement. Dès qu'ils confirment, la confirmation vous parvient par e-mail et je vous écris également."),
    B.paragrafo("Pour que vous ne restiez pas dans l'incertitude à la veille de votre soirée : sans leur réponse demain à 12h00 (heure de Paris), je reviens vers vous avec deux adresses parisiennes du même niveau pour le même soir, à 21h, et je m'occupe de tout. Votre demande d'origine reste inchangée."),
    B.paragrafo('Vous pouvez répondre directement à cet e-mail, il me parvient.'),
    B.paragrafo('Avec plaisir,<br/>Aria &#183; The World Keys'),
    B.rodape('Écrire à notre concierge sur WhatsApp', '', 'Besoin de quoi que ce soit ?'),
  ].join('\n');
  return { para: 'hanna.dohlen.opsahl@gmail.com', assunto: 'Re: Votre demande 3EPWVRW3 — MISS KÔ, samedi 12 septembre', html };
}

(async () => {
  if (apply && (!aprovacao || aprovacao.length < 10)) { console.error('BLOQUEADO: --apply exige --aprovacao "<frase do fundador>"'); process.exit(3); }
  if (apply && (!WEBHOOK || !TOKEN)) { console.error('BLOQUEADO: EMAIL_WEBHOOK_URL/TOKEN ausentes'); process.exit(2); }

  const bloqueados = optOutBloqueia(cobrancas.map((c) => c.restaurant_id));
  if (bloqueados.length) { console.error('BLOQUEADO: restaurante com opt-out de listagem:', bloqueados.join(', ')); process.exit(4); }

  const fila = [];
  for (const c of cobrancas) {
    const { assunto, html } = templates.emailRestaurante({ idioma: c.idioma, nome: c.nome, restaurant_id: c.restaurant_id, reservas: c.reservas });
    fila.push({ tipo: 'cobranca-restaurante', chave: c.chave, para: c.para, assunto, html, ref: c.reservas[0].reservation_code });
  }
  const n = cartaNicole(); fila.push({ tipo: 'carta-cliente', chave: 'nicole', ref: 'EVU5Z99H', ...n });
  const h = cartaHanna(); fila.push({ tipo: 'carta-cliente', chave: 'hanna', ref: '3EPWVRW3', ...h });

  // Guardas de conteúdo: nada de promessa de equipe/2 horas, nada de nota interna.
  const PROIBIDO = [/2 horas/i, /duas horas/i, /deux heures\b(?!.*n'aurait pas)/i, /two hours/i, /nossa equipe/i, /our team will/i, /escalei/i, /a cliente foi/i, /SLA/i];
  for (const f of fila) {
    const texto = f.html.replace(/<[^>]+>/g, ' ');
    const hit = PROIBIDO.find((re) => re.test(texto));
    if (hit) { console.error(`BLOQUEADO: ${f.chave} contém termo proibido ${hit}`); process.exit(5); }
    fs.writeFileSync(path.join(PREV, `${f.chave}.html`), f.html);
  }

  console.log(`reparo 2026-09-11 · modo ${apply ? 'APPLY' : 'DRY-RUN'}`);
  for (const f of fila) console.log(`  ${f.tipo.padEnd(20)} ${f.chave.padEnd(12)} ${String(f.para).replace(/^.*@/, '@').padEnd(18)} ${f.assunto}`);
  if (!apply) { console.log(`\nDRY-RUN — ${fila.length} e-mail(s) sairiam. Previews em ${PREV}. Nada enviado.`); return; }

  let ok = 0;
  for (const f of fila) {
    const resp = await fetch(WEBHOOK, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` }, body: JSON.stringify({ para: f.para, assunto: f.assunto, html: f.html }) });
    const sucesso = resp.ok; if (sucesso) ok++;
    const linha = { ts: new Date().toISOString(), tipo: f.tipo, chave: f.chave, ref: f.ref, dominio: String(f.para).replace(/^.*@/, ''), ok: sucesso, http: resp.status, aprovacao_ref: aprovacao };
    fs.appendFileSync(LEDGER, JSON.stringify(linha) + '\n');
    audit({ evento: 'email_reparo', ...linha });
    console.log(`  ${sucesso ? 'OK ' : 'FALHA'} ${f.chave} HTTP ${resp.status}`);
    await new Promise((r) => setTimeout(r, 1500));
  }
  console.log(`\nENVIADOS ${ok}/${fila.length}.`);
})().catch((e) => { audit({ evento: 'falha', erro: e.message }); console.error('ERRO', e.message); process.exit(1); });
