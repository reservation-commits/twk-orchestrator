#!/usr/bin/env node
'use strict';
/**
 * Ciclo do cliente — três e-mails que faltavam (auditoria de 10/09), sem depender do site:
 *
 *   vespera     → reserva ACEITA com mesa amanhã: lembrete com endereço, mapa, telefone, "precisa mudar?"
 *   pos-visita  → reserva ACEITA com mesa ontem: "como foi?" — resposta por e-mail (Aria, FLUXO 4) ou WhatsApp
 *   boas-vindas → conta de restaurante criada nas últimas 24h: como responder em um toque + painel
 *
 *   node run.js                       → DRY-RUN de tudo: lista o que sairia, grava previews em state/previews/
 *   node run.js --tarefa vespera      → só uma tarefa
 *   node run.js --apply --aprovacao "<frase do fundador>"   → envia pelo canal do MAESTRO (n8n maestro-email)
 *
 * Guardrails em código: dry-run por padrão · aprovação obrigatória para --apply · ledger próprio (nunca dois
 * envios do mesmo tipo para a mesma reserva/conta) · consentimento consultado (aria_contact_consent, por
 * telefone e por "email:<endereço>") · casas de teste (excluidos-teste.json) fora · máx. 40 envios por execução
 * · e-mail do cliente lido na hora e nunca gravado em estado (só código, casa e domínio) · audit por envio.
 */
const fs = require('node:fs');
const path = require('node:path');
const B = require('../chave-girada/n8n/_blocos-twk.js');

const RAIZ = path.resolve(__dirname, '..', '..', '..');
const STATE = path.join(__dirname, 'state');
const LEDGER = path.join(STATE, 'envios.jsonl');
const LOGS = path.join(RAIZ, 'orchestrator', 'logs');
fs.mkdirSync(path.join(STATE, 'previews'), { recursive: true });

(function env() { const f = path.join(process.env.USERPROFILE || process.env.HOME || '', '.twk', 'regencia.env'); try { for (const l of fs.readFileSync(f, 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim(); } } catch {} })();
const WEBHOOK = process.env.EMAIL_WEBHOOK_URL || '';
const TOKEN = process.env.EMAIL_WEBHOOK_TOKEN || '';

const a = process.argv.slice(2);
const flag = (n) => a.includes(n);
const val = (n) => { const i = a.indexOf(n); return i >= 0 && a[i + 1] ? a[i + 1] : null; };
const apply = flag('--apply');
const aprovacao = val('--aprovacao');
const soTarefa = val('--tarefa');
const MAX = 40;
const hoje = () => new Date().toISOString().slice(0, 10);
const trace = `trc-ciclo-${hoje().replace(/-/g, '')}`;
const audit = (o) => { try { fs.mkdirSync(LOGS, { recursive: true }); fs.appendFileSync(path.join(LOGS, `audit-${hoje()}.jsonl`), JSON.stringify({ ts: new Date().toISOString(), trace_id: trace, agente: 'ciclo-cliente', ...o }) + '\n'); } catch {} };
const lerLedger = () => { try { return fs.readFileSync(LEDGER, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };
const jaEnviado = (ledger, tipo, chave) => ledger.some((e) => e.tipo === tipo && e.chave === chave && e.ok);
const dominio = (e) => String(e || '').replace(/^.*@/, '');
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function envRO() {
  const p = path.join(RAIZ, 'Agente Gerenciador do Banco de Dados', 'twk-db-agent', '.env.readonly.local');
  return Object.fromEntries(fs.readFileSync(p, 'utf8').split(/[\r\n]+/).filter((l) => l && !l.startsWith('#')).map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
}
function excluidos() {
  try { return new Set(JSON.parse(fs.readFileSync(path.join(RAIZ, 'orchestrator', 'state', 'excluidos-teste.json'), 'utf8')).restaurantes.map((r) => String(r.restaurant_id))); } catch { return new Set(); }
}

// ---------- formatação ----------
const fmtData = (iso) => { const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number); return new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, d))); };
const fmtHora = (t) => { const [h, m] = String(t).slice(0, 5).split(':').map(Number); const d = new Date(2000, 0, 1, h, m); return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }).format(d); };
const pessoas = (n) => `${n} ${Number(n) === 1 ? 'guest' : 'guests'}`;
const mapa = (r) => (r.latitude && r.longitude) ? `https://www.google.com/maps/search/?api=1&query=${r.latitude},${r.longitude}` : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${r.name} ${r.city || ''}`)}`;
const primeiroNome = (n) => String(n || '').trim().split(/\s+/)[0] || 'there';

// ---------- templates (padrão TWK) ----------
function emailVespera(x) {
  const titulo = `Tomorrow: your table at ${esc(x.name)}.`;
  const html = B.cabeca(titulo, `A reminder of your reservation at ${esc(x.name)} tomorrow at ${fmtHora(x.reservation_time)}.`) +
    B.paragrafo(`Dear ${esc(primeiroNome(x.customer_name))}, a quick note ahead of tomorrow: your table at <span style="color:#E6C87A;">${esc(x.name)}</span> is confirmed. Here is everything you need.`) +
    B.cartaoNumero('TOMORROW', fmtHora(x.reservation_time), fmtData(x.booking_date)) +
    B.cartaoDetalhes(
      B.linha('GUESTS', pessoas(x.people)) +
      B.linha('ADDRESS', `${esc(x.address_of_establishment || '')}${x.city ? ', ' + esc(x.city) : ''}`) +
      (x.telephone_of_the_establishment ? B.linha('PHONE', esc(x.telephone_of_the_establishment)) : '') +
      B.linha('NOTES', esc(x.booking_details || 'No details.'), true),
      esc(x.reservation_code)) +
    B.botao(mapa(x), 'Open in Google Maps') +
    B.paragrafo(`Running late or need to change something? Update it from your reservations page and the restaurant is notified automatically: <a href="https://theworldkeys.com/users/reservations" style="color:#E6C87A; text-decoration:none;">theworldkeys.com/users/reservations</a>`, '#8F8368', 13) +
    B.rodape('Message our concierge on WhatsApp');
  return { assunto: `Tomorrow at ${x.name} — ${fmtHora(x.reservation_time)}`, html };
}

function emailPosVisita(x) {
  const wa = `https://wa.me/5521967841007?text=${encodeURIComponent(`Review ${x.reservation_code} — ${x.name}`)}`;
  const html = B.cabeca(`How was ${esc(x.name)}?`, `Two quick notes about your evening at ${esc(x.name)} help us — and the next guest.`) +
    B.paragrafo(`Dear ${esc(primeiroNome(x.customer_name))}, we hope your table at <span style="color:#E6C87A;">${esc(x.name)}</span> yesterday was everything you expected. Would you tell us how it went? It takes a minute and it shapes what we recommend next.`) +
    B.cartaoDetalhes(B.linha('RESTAURANT', esc(x.name)) + B.linha('DATE', fmtData(x.booking_date)) + B.linha('GUESTS', pessoas(x.people), true), esc(x.reservation_code)) +
    B.passos('TWO NOTES, ONE LINE', [
      'The restaurant, from 1 to 5.',
      'The World Keys — our service to you — from 1 to 5.',
      'One line about what stood out, good or bad. That is it.',
    ]) +
    B.paragrafo('Simply <span style="color:#F5EFE3;">reply to this e-mail</span> with your notes — our concierge reads every answer — or, if you prefer, send them on WhatsApp:', '#B5AB93', 14) +
    B.botao(wa, 'Rate on WhatsApp') +
    B.rodape('Message our concierge on WhatsApp', 'You receive this because you had a confirmed reservation through The World Keys. Reply "stop" and we will not ask again.');
  return { assunto: `How was ${x.name}?`, html };
}

function emailBoasVindas(x) {
  const html = B.cabeca(`Welcome — ${esc(x.name)} is in your hands.`, `Your restaurant account on The World Keys is ready. Here is how to answer every request in one tap.`) +
    B.paragrafo(`Dear ${esc(primeiroNome(x.user_name))}, the account for <span style="color:#E6C87A;">${esc(x.name)}</span> is active. From now on, every table request reaches your dashboard, and a reply takes one tap — from your phone, wherever you are.`) +
    B.passos('THE THREE THINGS THAT MATTER', [
      'Answer fast: guests choose the restaurants that reply — accept, decline or propose a time, in one tap.',
      'Set your real hours and booking policy on your page, so guests only ask for what you actually serve.',
      'Keep your contact e-mail and phone current — that is where requests arrive when you are away from the dashboard.',
    ]) +
    B.botao('https://manager.theworldkeys.com/log-in', 'Open my dashboard') +
    B.paragrafo('In a week we will send you your first numbers: requests received, answered, and how fast — compared with your city.', '#8F8368', 13) +
    B.rodape('Message our team on WhatsApp');
  return { assunto: `Welcome to The World Keys — ${x.name}`, html };
}

// ---------- consultas (twk_ro) ----------
async function coletar(c) {
  const EX = [...excluidos()];
  const ex = EX.length ? `and r.restaurant_id::text not in (${EX.map((_, i) => '$' + (i + 1)).join(',')})` : '';
  const base = `select s.reservation_code, s.booking_date::text booking_date, s.reservation_time::text reservation_time, s.people, s.booking_details,
        r.restaurant_id::text restaurant_id, r.name, r.city, r.address_of_establishment, r.telephone_of_the_establishment, r.latitude, r.longitude,
        u.email customer_email, u.name customer_name
     from reservations s
     join db_restaurants r on r.restaurant_id = s.restaurant_id
     left join nextauth."User" u on u.id = s.customer_id
    where s.booking_status ilike 'accept%' and s.expired_at is null ${ex}`;
  const vespera = (await c.query(`${base} and s.booking_date = current_date + 1 order by s.reservation_time`, EX)).rows;
  const posVisita = (await c.query(`${base} and s.booking_date = current_date - 1 order by s.reservation_time`, EX)).rows;
  const boasVindas = (await c.query(`select ru.restaurant_id::text restaurant_id, ru.created_at::text created_at, r.name, u.email user_email, u.name user_name
       from restaurant_users ru join db_restaurants r on r.restaurant_id::text = ru.restaurant_id::text left join nextauth."User" u on u.id = ru.user_id
      where ru.created_at >= now() - interval '24 hours' ${ex.replace(/r\.restaurant_id/g, 'ru.restaurant_id')} order by ru.created_at`, EX)).rows;
  const consent = await c.query(`select phone from aria_contact_consent where outbound_opted_out`).catch(() => ({ rows: [] }));
  const optout = new Set(consent.rows.map((x) => String(x.phone).toLowerCase()));
  return { vespera, posVisita, boasVindas, optout };
}

// ---------- execução ----------
(async () => {
  // --amostra: renderiza os três templates com dados fictícios (para aprovação visual), sem tocar o banco.
  if (flag('--amostra')) {
    const r = { reservation_code: 'SAMPLE01', booking_date: hoje(), reservation_time: '20:00:00', people: 2, booking_details: 'Window table, birthday', name: 'GIRARROSTO FIORENTINO', city: 'Rome', address_of_establishment: 'Via Sicilia 46, 00187 Roma', telephone_of_the_establishment: '+39 06 4288 0660', latitude: 41.907, longitude: 12.492, customer_name: 'Lara Yu', user_name: 'Marco Rossi' };
    for (const [nome, fn] of [['vespera', emailVespera], ['pos-visita', emailPosVisita], ['boas-vindas', emailBoasVindas]]) {
      const { assunto, html } = fn(r);
      fs.writeFileSync(path.join(STATE, 'previews', `_amostra-${nome}.html`), html);
      console.log(`amostra ${nome.padEnd(11)} → assunto: ${assunto}`);
    }
    return;
  }
  if (apply && (!aprovacao || aprovacao.length < 10)) { console.error('BLOQUEADO: --apply exige --aprovacao "<frase do fundador>"'); process.exit(3); }
  if (apply && (!WEBHOOK || !TOKEN)) { console.error('EMAIL_WEBHOOK_URL/TOKEN ausentes'); process.exit(2); }
  const { Client } = require(path.join(RAIZ, 'Agente Comercial', 'service', 'node_modules', 'pg'));
  // Sem timeout, um connect() que fica pendurado (TCP aberto, sessão nunca criada — visto em 2026-09-11 sob o
  // Agendador) segura o processo até o limite da tarefa. O watchdog garante saída com falha registrada.
  const watchdog = setTimeout(() => { audit({ evento: 'falha', erro: 'watchdog: 4 min sem concluir' }); console.error('ERRO watchdog: 4 min sem concluir — abortando'); process.exit(4); }, 240000);
  watchdog.unref();
  const c = new Client({ connectionString: envRO().DATABASE_URL_RO, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000, statement_timeout: 50000 });
  await c.connect();
  const dados = await coletar(c);
  await c.end();
  const ledger = lerLedger();

  const fila = [];
  const empurra = (tipo, chave, para, nome, item, gerar) => {
    if (soTarefa && soTarefa !== tipo) return;
    if (!para) { fila.push({ tipo, chave, nome, bloqueio: 'sem e-mail do destinatário' }); return; }
    if (jaEnviado(ledger, tipo, chave)) { fila.push({ tipo, chave, nome, bloqueio: 'já enviado' }); return; }
    if (dados.optout.has(String(para).toLowerCase()) || dados.optout.has('email:' + String(para).toLowerCase())) { fila.push({ tipo, chave, nome, bloqueio: 'opt-out' }); return; }
    const { assunto, html } = gerar(item);
    fila.push({ tipo, chave, nome, para, assunto, html });
  };
  for (const x of dados.vespera) empurra('vespera', x.reservation_code, x.customer_email, x.name, x, emailVespera);
  for (const x of dados.posVisita) empurra('pos-visita', x.reservation_code, x.customer_email, x.name, x, emailPosVisita);
  for (const x of dados.boasVindas) empurra('boas-vindas', `${x.restaurant_id}:${x.created_at.slice(0, 10)}`, x.user_email, x.name, x, emailBoasVindas);

  const prontos = fila.filter((f) => !f.bloqueio).slice(0, MAX);
  console.log(`ciclo do cliente · ${hoje()} · modo ${apply ? 'APPLY' : 'DRY-RUN'}`);
  console.log(`candidatos: véspera ${dados.vespera.length} · pós-visita ${dados.posVisita.length} · boas-vindas ${dados.boasVindas.length} · opt-outs conhecidos ${dados.optout.size}`);
  for (const f of fila) console.log(`  ${f.tipo.padEnd(11)} ${String(f.chave).padEnd(22)} ${String(f.nome).slice(0, 28).padEnd(30)} ${f.bloqueio ? 'BLOQUEADO: ' + f.bloqueio : '→ ' + dominio(f.para) + ' · ' + f.assunto}`);
  for (const f of prontos) fs.writeFileSync(path.join(STATE, 'previews', `${f.tipo}-${String(f.chave).replace(/[^\w]+/g, '_')}.html`), f.html);
  audit({ evento: apply ? 'execucao' : 'dry_run', candidatos: fila.length, prontos: prontos.length, bloqueados: fila.length - prontos.length });
  if (!apply) { console.log(`\nDRY-RUN — ${prontos.length} e-mail(s) sairiam. Previews em ${path.join(STATE, 'previews')}. Nada enviado.`); return; }

  let ok = 0;
  for (const f of prontos) {
    const resp = await fetch(WEBHOOK, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` }, body: JSON.stringify({ para: f.para, assunto: f.assunto, html: f.html }) });
    const sucesso = resp.ok; if (sucesso) ok++;
    fs.appendFileSync(LEDGER, JSON.stringify({ ts: new Date().toISOString(), tipo: f.tipo, chave: f.chave, nome: f.nome, dominio: dominio(f.para), ok: sucesso, http: resp.status, aprovacao_ref: aprovacao }) + '\n');
    audit({ evento: 'email_envio', tipo: f.tipo, chave: f.chave, restaurante: f.nome, destino_dominio: dominio(f.para), ok: sucesso, http: resp.status, aprovacao_ref: aprovacao });
    await new Promise((r) => setTimeout(r, 1500));
  }
  console.log(`\nENVIADOS ${ok}/${prontos.length}. Conferir na caixa (cópia enviada) antes de considerar verificado.`);
})().catch((e) => { audit({ evento: 'falha', erro: e.message }); console.error('ERRO', e.message); process.exit(1); });
