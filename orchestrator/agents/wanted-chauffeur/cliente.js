'use strict';
/**
 * Mensagens ao CLIENTE do Wanted Chauffeur pela Cloud API da Meta (Fase 2, 19/11/2026).
 *
 * Dois templates (docs/notificacoes/templates-meta-wc-cliente-2026-11-19.md): `wc_ride_confirmed` quando o Julien
 * confirma, e `wc_ride_reminder` na véspera (8:00 PM Paris) e duas horas antes. Em francês ou inglês, pelo idioma da
 * página que o cliente usou. O número que envia é o de WC_WA_PHONE_NUMBER_ID (o da TWK, igual ao da Aria, ou um número
 * só da marca na mesma conta de negócios).
 *
 * Travas (fail-closed, cada uma registrada como evento `aviso` na reserva, para o painel mostrar):
 *   sem_canal        WC_WA_TOKEN / WC_WA_PHONE_NUMBER_ID / nome do template ausentes → nada sai
 *   sem_whatsapp     a reserva não tem WhatsApp
 *   nao_contatar     o número ou o nome está em chauffeur_nao_contatar
 *   <tipo>_falhou    a Meta recusou (motivo sem telefone)
 * Cada mensagem sai UMA vez por reserva (evento `confirmacao_cliente`, `lembrete_vespera`, `lembrete_2h`).
 *
 * Nenhum prazo, nenhuma promessa fora do que está confirmado por escrito (ADR-015).
 */
const { PRODUTO_NOME, RE_HORA } = require('./reservas.js');

const GRAPH = process.env.WHATSAPP_GRAPH_VERSION || 'v21.0';

function config(env = process.env) {
  const v = (k) => String(env[k] || '').trim();
  return {
    token: v('WC_WA_TOKEN'), phoneId: v('WC_WA_PHONE_NUMBER_ID'),
    templateConfirmada: v('WC_TEMPLATE_CONFIRMED'), templateLembrete: v('WC_TEMPLATE_REMINDER'),
    graph: v('WHATSAPP_GRAPH_VERSION') || GRAPH,
  };
}
function ligado(cfg) { return !!(cfg.token && cfg.phoneId); }
function statusLinha(cfg) {
  if (!ligado(cfg)) return 'off (sem WC_WA_TOKEN / WC_WA_PHONE_NUMBER_ID)';
  const faltam = [!cfg.templateConfirmada && 'WC_TEMPLATE_CONFIRMED', !cfg.templateLembrete && 'WC_TEMPLATE_REMINDER'].filter(Boolean);
  return faltam.length ? `on, mas sem ${faltam.join(' e ')}` : 'on';
}

// ---------------------------------------------------------------- datas em Paris
/** Deslocamento de Europe/Paris em minutos num instante (UTC+60 no inverno, +120 no verão). */
function deslocamentoParis(ms) {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Paris', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(ms));
  const o = Object.fromEntries(p.map((x) => [x.type, x.value]));
  return Math.round((Date.UTC(+o.year, +o.month - 1, +o.day, +o.hour % 24, +o.minute) - ms) / 60_000);
}
/** "2026-11-24" + "9:00 PM" (hora de Paris) → instante em ms. null se faltar data ou hora. */
function instanteParis(data, hora) {
  const m = RE_HORA.exec(hora || ''); if (!m || !/^\d{4}-\d{2}-\d{2}$/.test(data || '')) return null;
  let hh = Number(m[1]) % 12; if (m[2] === 'PM') hh += 12;
  const mm = Number(hora.slice(hora.indexOf(':') + 1, hora.indexOf(':') + 3));
  const [y, mo, d] = data.split('-').map(Number);
  const palpite = Date.UTC(y, mo - 1, d, hh, mm);
  return palpite - deslocamentoParis(palpite) * 60_000;
}
function hojeParis(ms) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms)); }
function horaParis(ms) { return Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Paris', hour12: false, hour: '2-digit' }).format(new Date(ms))) % 24; }
function amanhaParis(ms) { return hojeParis(ms + 36 * 3_600_000 - (horaParis(ms) * 3_600_000)); }

/** Data por extenso, no idioma do cliente: "Mardi 24 novembre 2026" · "Tuesday, 24 November 2026". */
function dataExtenso(iso, idioma) {
  const d = new Date(iso + 'T12:00:00Z');
  if (idioma === 'fr') {
    const j = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'][d.getUTCDay()];
    const m = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'][d.getUTCMonth()];
    return `${j[0].toUpperCase()}${j.slice(1)} ${d.getUTCDate()} ${m} ${d.getUTCFullYear()}`;
  }
  const j = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d.getUTCDay()];
  const m = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][d.getUTCMonth()];
  return `${j}, ${d.getUTCDate()} ${m} ${d.getUTCFullYear()}`;
}
const idiomaDe = (r) => (r.idioma === 'fr' ? 'fr' : 'en');
const limparParam = (s) => String(s == null ? '' : s).replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim() || '—';
const montante = (r) => `${Math.round((r.valor_cent || 0) / 100)} €${r.produto === 'soiree' ? (r.idioma === 'fr' ? ' + dîner' : ' + dinner') : ''}`;
const missao = (r) => `${PRODUTO_NOME[r.produto] || r.produto}${r.horas ? ` ${r.horas} h` : ''}`;

/** Parâmetros na ordem do contrato (meta-templates.mjs: VARIAVEIS). */
function paramsConfirmada(r) {
  const id = idiomaDe(r);
  return [missao(r), r.data ? dataExtenso(r.data, id) : (id === 'fr' ? 'date à préciser' : 'date to be set'), r.hora || '—', r.nome, r.partida, montante(r), r.codigo].map(limparParam);
}
function paramsLembrete(r, quando) {
  const id = idiomaDe(r);
  const q = quando === 'vespera' ? (id === 'fr' ? 'demain' : 'tomorrow') : (id === 'fr' ? 'dans deux heures' : 'in two hours');
  return [q, missao(r), r.hora || '—', r.nome, r.partida, r.codigo].map(limparParam);
}

async function enviarTemplate(cfg, { to, template, locale, bodyParams, fetchImpl = globalThis.fetch }) {
  const r = await fetchImpl(`https://graph.facebook.com/${cfg.graph}/${cfg.phoneId}/messages`, {
    method: 'POST', headers: { authorization: `Bearer ${cfg.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to: to.replace(/^\+/, ''), type: 'template', template: { name: template, language: { code: locale }, components: [{ type: 'body', parameters: bodyParams.map((t) => ({ type: 'text', text: t })) }] } }),
    signal: AbortSignal.timeout(20000),
  });
  let j = null; try { j = await r.json(); } catch { /* sem corpo */ }
  if (!r.ok) return { ok: false, motivo: `HTTP ${r.status}${j && j.error ? ` ${j.error.code || ''} ${String(j.error.message || '').slice(0, 100)}` : ''}`.trim() };
  return { ok: true, id: j && j.messages && j.messages[0] && j.messages[0].id || null };
}

/**
 * Manda uma das mensagens ao cliente, uma vez por reserva. `tipo`: confirmacao_cliente | lembrete_vespera | lembrete_2h.
 * Devolve { enviado, motivo }. Nunca lança: toda saída vira evento na reserva.
 */
async function enviar({ store, reserva, tipo, env = process.env, fetchImpl = globalThis.fetch, log = () => {} }) {
  const cfg = config(env);
  const r = reserva.avisos ? reserva : await store.obter(reserva.codigo);
  if (!r) return { enviado: false, motivo: 'reserva não encontrada' };
  if (r.avisos.includes(tipo)) return { enviado: false, motivo: 'já enviada' };
  const registrar = async (valor, nota) => { try { await store.evento({ codigo: r.codigo, tipo: 'aviso', valor, nota: nota ? String(nota).replace(/(\+|\b0)\d(?:[ .-]?\d){8,}/g, '…').slice(0, 200) : null, por: 'central' }); } catch { /* registro */ } }; // mascara telefone (+33… / 06…), não códigos de erro
  const template = tipo === 'confirmacao_cliente' ? cfg.templateConfirmada : cfg.templateLembrete;
  if (!ligado(cfg) || !template) { if (!r.avisos.includes('sem_canal')) await registrar('sem_canal', statusLinha(cfg)); log(`[cliente] ${r.codigo}: ${tipo} não saiu (${statusLinha(cfg)})`); return { enviado: false, motivo: 'sem_canal' }; }
  if (!r.whatsapp) { if (!r.avisos.includes('sem_whatsapp')) await registrar('sem_whatsapp'); return { enviado: false, motivo: 'sem_whatsapp' }; }
  if (await store.naoContatar.bloqueado({ whatsapp: r.whatsapp, nome: r.nome })) { if (!r.avisos.includes('nao_contatar')) await registrar('nao_contatar'); log(`[cliente] ${r.codigo}: ${tipo} não saiu (não contatar)`); return { enviado: false, motivo: 'nao_contatar' }; }
  const locale = idiomaDe(r);
  const bodyParams = tipo === 'confirmacao_cliente' ? paramsConfirmada(r) : paramsLembrete(r, tipo === 'lembrete_vespera' ? 'vespera' : '2h');
  let e;
  try { e = await enviarTemplate(cfg, { to: r.whatsapp, template, locale, bodyParams, fetchImpl }); }
  catch (err) { e = { ok: false, motivo: String(err && err.message || err).slice(0, 120) }; }
  if (!e.ok) { await registrar(`${tipo}_falhou`, e.motivo); log(`[cliente] ${r.codigo}: ${tipo} recusada pela Meta (${e.motivo})`); return { enviado: false, motivo: e.motivo }; }
  await registrar(tipo, `${template}/${locale}${e.id ? ' ' + e.id : ''}`);
  log(`[cliente] ${r.codigo}: ${tipo} enviada (${template}/${locale})`);
  return { enviado: true, id: e.id };
}

module.exports = { config, ligado, statusLinha, enviar, enviarTemplate, paramsConfirmada, paramsLembrete, dataExtenso, instanteParis, deslocamentoParis, hojeParis, horaParis, amanhaParis };
