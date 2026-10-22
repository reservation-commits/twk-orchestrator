'use strict';
/**
 * Registro de Opt-out de Listagem — fonte interina (JSONL append-only) até a
 * migração `listing_consent` ser executada pelo fundador (ADR-010).
 *
 * Nunca apaga: mudança de estado = novo evento. Estado atual = último evento por restaurant_id.
 * Fail-closed: se o arquivo não puder ser lido, `carregar()` lança — quem consome
 * (Guardião, CLAVIS) deve tratar como "sem registro = sem contato".
 */
const fs = require('node:fs');
const path = require('node:path');

// A1 (2026-10-22): na Central hospedada o arquivo interino vive no volume (TWK_STATE_ROOT/listing-consent.jsonl),
// sincronizado pelo push-state.ps1; a tabela listing_consent continua sendo a fonte única quando o banco responde.
const ARQUIVO_PADRAO = process.env.TWK_STATE_ROOT
  ? path.join(path.resolve(process.env.TWK_STATE_ROOT), 'listing-consent.jsonl')
  : path.resolve(__dirname, '..', '..', 'state', 'listing-consent.jsonl');
const STATUS = new Set(['listed', 'correction_requested', 'opted_out', 'claimed']);
const SCOPES = new Set(['listing', 'reservations', 'outreach']);

function validar(e) {
  const erros = [];
  if (!e.restaurant_id || typeof e.restaurant_id !== 'string') erros.push('restaurant_id obrigatório (string)');
  if (!STATUS.has(e.status)) erros.push(`status inválido: ${e.status}`);
  if (typeof e.do_not_relist !== 'boolean') erros.push('do_not_relist obrigatório (boolean)');
  if (!Array.isArray(e.scope) || !e.scope.length || e.scope.some((s) => !SCOPES.has(s))) erros.push('scope inválido');
  if (!e.requested_at || Number.isNaN(Date.parse(e.requested_at))) erros.push('requested_at inválido');
  if (!e.requested_by) erros.push('requested_by obrigatório (referência, ex.: email:<endereço> ou click:<token>)');
  if (!e.evidence_ref) erros.push('evidence_ref obrigatório (ex.: gmail:<id>)');
  if (!e.trace_id) erros.push('trace_id obrigatório');
  if (e.status === 'opted_out' && !e.legal_basis) erros.push('legal_basis obrigatório para opted_out');
  return erros;
}

function carregar(arquivo = ARQUIVO_PADRAO) {
  if (!fs.existsSync(arquivo)) throw new Error(`registro de opt-out ausente: ${arquivo} (fail-closed)`);
  const linhas = fs.readFileSync(arquivo, 'utf8').split(/\r?\n/).filter(Boolean);
  const eventos = linhas.map((l, i) => { try { return JSON.parse(l); } catch { throw new Error(`linha ${i + 1} inválida no registro`); } });
  const atual = new Map();
  for (const e of eventos) atual.set(e.restaurant_id, e); // último evento vence
  return { eventos, atual };
}

function estado(restaurantId, reg) {
  return reg.atual.get(String(restaurantId)) || null;
}

/** Bloqueia contato ao restaurante? (Guardião/CLAVIS consultam isto.) */
function bloqueiaContato(restaurantId, reg, escopo = 'reservations') {
  const e = estado(restaurantId, reg);
  if (!e) return { bloqueado: false };
  if (e.status === 'opted_out' || e.do_not_relist) return { bloqueado: true, motivo: `registro: ${e.status}${e.do_not_relist ? ' + do_not_relist' : ''}` };
  if (e.status === 'correction_requested' && e.scope.includes(escopo)) return { bloqueado: true, motivo: `registro: correction_requested (${escopo})` };
  return { bloqueado: false };
}

function registrar(evento, arquivo = ARQUIVO_PADRAO) {
  const erros = validar(evento);
  if (erros.length) throw new Error('evento inválido: ' + erros.join('; '));
  const linha = JSON.stringify({ ...evento, registered_at: new Date().toISOString() });
  fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  fs.appendFileSync(arquivo, linha + '\n', 'utf8');
  return linha;
}

/**
 * Fonte única (ADR-010): a tabela `public.listing_consent` é a verdade desde 2026-09-02.
 * O JSONL vira fallback para quando o banco não estiver acessível — e isso fica dito no `fonte`.
 * Fail-closed: se NENHUMA das duas responder, lança (quem consome não contata ninguém).
 */
async function carregarAuto(arquivo = ARQUIVO_PADRAO) {
  const erros = [];
  let banco = null;
  let arq = null;
  try {
    const db = require('../guardiao-reserva/db.js');
    const rows = await db.comCliente(async (c) =>
      (await c.query('SELECT restaurant_id, status, do_not_relist, scope, requested_at, requested_by, legal_basis, evidence_ref, sla_ack_at, sla_done_at, notes, trace_id, registered_at FROM public.v_listing_consent_atual')).rows);
    const iso = (v) => (v instanceof Date ? v.toISOString() : v);
    banco = new Map();
    for (const e of rows) banco.set(String(e.restaurant_id), { ...e, restaurant_id: String(e.restaurant_id), requested_at: iso(e.requested_at), registered_at: iso(e.registered_at) });
  } catch (e) { erros.push(`banco: ${e.message}`); }
  try { arq = carregar(arquivo); } catch (e) { erros.push(`arquivo: ${e.message}`); }

  if (!banco && !arq) throw new Error(`registro de opt-out indisponível (fail-closed) — ${erros.join(' | ')}`);
  if (!banco) return { ...arq, so_no_arquivo: [...arq.atual.keys()], fonte: `arquivo interino (${path.basename(arquivo)}) — banco indisponível: ${erros[0]}` };

  // União (incidente de 14/09): a tabela estava vazia e o banco "vencia", apagando da vista de Guardião, enviar.js
  // e Regência todo opt-out gravado só no arquivo. Evento mais recente vence; nenhum evento do arquivo some.
  const atual = new Map(banco);
  const soNoArquivo = [];
  if (arq) {
    for (const [id, e] of arq.atual) {
      const b = banco.get(String(id));
      if (!b) { atual.set(String(id), e); soNoArquivo.push(String(id)); continue; }
      if (Date.parse(e.registered_at || e.requested_at) > Date.parse(b.registered_at || b.requested_at)) { atual.set(String(id), e); soNoArquivo.push(String(id)); }
    }
  }
  const avisos = [soNoArquivo.length ? `${soNoArquivo.length} evento(s) ainda só no arquivo: ${soNoArquivo.join(', ')}` : '', arq ? '' : `arquivo ilegível: ${erros.find((x) => x.startsWith('arquivo')) || ''}`].filter(Boolean);
  return { eventos: [...atual.values()], atual, so_no_arquivo: soNoArquivo, fonte: `banco (v_listing_consent_atual)${avisos.length ? ' + ' + avisos.join(' · ') : ''}` };
}

function resumo(reg) {
  const c = { listed: 0, correction_requested: 0, opted_out: 0, claimed: 0, do_not_relist: 0, sla_ack_aberto: 0, sla_done_aberto: 0 };
  for (const e of reg.atual.values()) {
    c[e.status] = (c[e.status] || 0) + 1;
    if (e.do_not_relist) c.do_not_relist++;
    if (!e.sla_ack_at) c.sla_ack_aberto++;
    if (!e.sla_done_at && e.status !== 'listed') c.sla_done_aberto++;
  }
  return c;
}

module.exports = { ARQUIVO_PADRAO, validar, carregar, carregarAuto, estado, bloqueiaContato, registrar, resumo };
