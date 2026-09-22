#!/usr/bin/env node
'use strict';
/**
 * Correção das duas confirmações enviadas por engano em 2026-09-14 10:56 UTC,
 * reserva 4XKE87EE (AI MERCANTI, Veneza — ter 06/10/2026 20:00, 2 pessoas).
 *
 *   1. Gaël Boterf (cliente, fr): desconsiderar a confirmação; a mesa não pode ser confirmada; solução oferecida.
 *   2. AI MERCANTI (restaurante, it): desconsiderar a notificação; nenhuma mesa a reservar.
 *
 * Doutrina (ADR-015): o erro se reconhece em uma frase e não se explica; nada de parceria,
 * garantia ou processo interno; oferecer o que resolve agora.
 *
 *   node correcao-ai-mercanti-2026-09-14.js                                → só previews (padrão)
 *   node correcao-ai-mercanti-2026-09-14.js --apply --aprovacao "<frase>"  → envia (SÓ após aprovação do fundador)
 */
const fs = require('node:fs');
const path = require('node:path');
const B = require('../chave-girada/n8n/_blocos-twk.js');

const RAIZ = path.resolve(__dirname, '..', '..', '..');
const PREV = path.join(__dirname, 'state', 'previews-correcao-ai-mercanti-2026-09-14');
const LEDGER = path.join(__dirname, 'state', 'correcao-ai-mercanti-2026-09-14.jsonl');
fs.mkdirSync(PREV, { recursive: true });

const a = process.argv.slice(2);
const apply = a.includes('--apply');
const aprovacao = (() => { const i = a.indexOf('--aprovacao'); return i >= 0 ? a[i + 1] : null; })();

function cartaCliente() {
  const titulo = 'Votre demande chez Ai Mercanti';
  const html = [
    B.cabeca(titulo, 'Au sujet de la confirmation reçue aujourd\'hui pour le mardi 6 octobre.', 'fr'),
    B.paragrafo('Bonjour Monsieur Boterf,'),
    B.paragrafo('Vous avez reçu aujourd\'hui un e-mail confirmant votre table du mardi 6 octobre chez Ai Mercanti. Il vous a été envoyé par erreur, et je vous prie de nous en excuser : merci de ne pas en tenir compte.'),
    B.cartaoDetalhes([
      B.linha('Réservation', '4XKE87EE'),
      B.linha('Restaurant', 'Ai Mercanti, Venise'),
      B.linha('Date', 'Mardi 6 octobre 2026'),
      B.linha('Heure', '20h00'),
      B.linha('Couverts', '2 personnes', true),
    ].join('\n'), 'Cette réservation ne peut pas être confirmée.'),
    B.paragrafo('Je ne veux pas vous laisser sans solution pour cette soirée. Je peux vous proposer deux adresses vénitiennes du même niveau pour le mardi 6 octobre à 20h00, et suivre la réservation jusqu\'à sa confirmation : il vous suffit de répondre à cet e-mail.'),
    B.paragrafo('Votre autre demande, pour le samedi 10 octobre, reste ouverte : la réponse du restaurant vous parviendra par e-mail dès qu\'elle arrivera.'),
    B.paragrafo('Avec plaisir,<br/>Aria &#183; The World Keys'),
    B.rodape('Écrire à notre concierge sur WhatsApp', '', 'Besoin de quoi que ce soit ?'),
  ].join('\n');
  return { chave: 'cliente-gael', para: 'gaelboterf29@gmail.com', assunto: 'Votre demande 4XKE87EE — Ai Mercanti, mardi 6 octobre', html };
}

function cartaRestaurante() {
  const titulo = 'Richiesta 4XKE87EE';
  const html = [
    B.cabeca(titulo, 'Vi preghiamo di non considerare la notifica di conferma inviata oggi.', 'it'),
    B.paragrafo('Buongiorno,'),
    B.paragrafo('oggi avete ricevuto da The World Keys una notifica di conferma per la richiesta 4XKE87EE. È stata inviata per errore: vi preghiamo di non tenerne conto, e ci scusiamo per l\'inconveniente.'),
    B.cartaoDetalhes([
      B.linha('Richiesta', '4XKE87EE'),
      B.linha('Data', 'Martedì 6 ottobre 2026'),
      B.linha('Ora', '20:00'),
      B.linha('Coperti', '2 persone', true),
    ].join('\n'), 'Prenotazione non confermata · nessun tavolo da riservare'),
    B.paragrafo('Non è necessaria alcuna azione da parte vostra.'),
    B.paragrafo('Cordiali saluti,<br/>Aria &#183; The World Keys'),
    B.rodape('Scrivete al nostro concierge su WhatsApp', '', 'Una domanda?'),
  ].join('\n');
  return { chave: 'restaurante-ai-mercanti', para: 'info_aimercanti@libero.it', assunto: 'AI MERCANTI — richiesta 4XKE87EE: vi preghiamo di non considerare la conferma', html };
}

(async () => {
  const fila = [cartaCliente(), cartaRestaurante()];
  const PROIBIDO = [/partenaire|partner|parceir/i, /garanti/i, /ne pouvons pas promettre|cannot promise/i, /SLA/i, /\b(équipe|team|squadra) (va|will|vi)/i];
  for (const f of fila) {
    const texto = f.html.replace(/<[^>]+>/g, ' ');
    const hit = PROIBIDO.find((re) => re.test(texto));
    if (hit) { console.error(`BLOQUEADO: ${f.chave} contém termo proibido ${hit}`); process.exit(5); }
    fs.writeFileSync(path.join(PREV, `${f.chave}.html`), f.html);
    console.log(`  preview  ${f.chave.padEnd(24)} → ${f.para.replace(/^.*@/, '@').padEnd(12)} ${f.assunto}`);
  }
  if (!apply) { console.log(`\nSÓ PREVIEW — nada enviado. Arquivos em ${PREV}.`); return; }

  if (!aprovacao || aprovacao.length < 10) { console.error('BLOQUEADO: --apply exige --aprovacao "<frase do fundador>"'); process.exit(3); }
  (function env() { const f = path.join(process.env.USERPROFILE || process.env.HOME || '', '.twk', 'regencia.env'); try { for (const l of fs.readFileSync(f, 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim(); } } catch {} })();
  const WEBHOOK = process.env.EMAIL_WEBHOOK_URL || ''; const TOKEN = process.env.EMAIL_WEBHOOK_TOKEN || '';
  if (!WEBHOOK || !TOKEN) { console.error('BLOQUEADO: EMAIL_WEBHOOK_URL/TOKEN ausentes'); process.exit(2); }
  for (const f of fila) {
    const resp = await fetch(WEBHOOK, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` }, body: JSON.stringify({ para: f.para, assunto: f.assunto, html: f.html }) });
    fs.appendFileSync(LEDGER, JSON.stringify({ ts: new Date().toISOString(), chave: f.chave, ref: '4XKE87EE', dominio: f.para.replace(/^.*@/, ''), ok: resp.ok, http: resp.status, aprovacao_ref: aprovacao }) + '\n');
    fs.appendFileSync(path.join(RAIZ, 'orchestrator', 'logs', `audit-${new Date().toISOString().slice(0, 10)}.jsonl`), JSON.stringify({ ts: new Date().toISOString(), trace_id: 'trc-correcao-20260914', agente: 'maestro-atendimento', evento: 'email_correcao', chave: f.chave, ref: '4XKE87EE', ok: resp.ok, http: resp.status, aprovacao_ref: aprovacao }) + '\n');
    console.log(`  ${resp.ok ? 'OK ' : 'FALHA'} ${f.chave} HTTP ${resp.status}`);
    await new Promise((r) => setTimeout(r, 1500));
  }
})().catch((e) => { console.error('ERRO', e.message); process.exit(1); });
