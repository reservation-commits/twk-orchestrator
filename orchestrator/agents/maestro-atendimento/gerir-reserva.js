#!/usr/bin/env node
'use strict';
/**
 * MAESTRO · atendimento — aplica a decisão de um restaurante a uma reserva PELO CAMINHO DA PLATAFORMA
 * (o mesmo que o botão do /r/ usa), nunca por escrita direta em `reservations` (ADR-004).
 *
 *   node gerir-reserva.js <CODIGO>                              → mostra a reserva (somente leitura)
 *   node gerir-reserva.js <CODIGO> accept  --motivo "…"        → aceita
 *   node gerir-reserva.js <CODIGO> decline --motivo "…"        → recusa
 *   node gerir-reserva.js <CODIGO> reschedule HH:MM --motivo "…" → propõe novo horário; a plataforma
 *                                                                 envia ao cliente o e-mail com Accept/Decline
 *
 * Contrato descoberto em 10/09 no bundle do /r/: POST /api/reservations/manage
 *   { reservationCode, action, newTime?, reservation:{id,status,date,time,people,details}, restaurant, user }
 * Guardrails: só age em reserva Pending/In Treatment e não vencida; exige --motivo (texto do restaurante
 * ou referência); grava audit com trace_id; nada de dado pessoal no log (só código e casa).
 */
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.resolve(__dirname, '..', '..', '..');
const LOGS = path.join(RAIZ, 'orchestrator', 'logs');
const SITE = 'https://theworldkeys.com';
const [codigo, acao, ...resto] = process.argv.slice(2);
const val = (n) => { const i = resto.indexOf(n); return i >= 0 && resto[i + 1] ? resto[i + 1] : null; };
const motivo = val('--motivo');
const novoHorario = acao === 'reschedule' ? resto[0] : null;

const hoje = () => new Date().toISOString().slice(0, 10);
const audit = (o) => { try { fs.mkdirSync(LOGS, { recursive: true }); fs.appendFileSync(path.join(LOGS, `audit-${hoje()}.jsonl`), JSON.stringify({ ts: new Date().toISOString(), trace_id: 'trc-atendimento', agente: 'maestro-atendimento', ...o }) + '\n'); } catch {} };

async function lerReserva(code) {
  const html = await (await fetch(`${SITE}/r/${encodeURIComponent(code)}`)).text();
  const i = html.indexOf('initialReservation');
  if (i < 0) throw new Error('página /r/ sem initialReservation — código inválido ou página mudou');
  // O Next serializa o objeto dentro de uma string JS: as aspas chegam escapadas. Desescapa uma
  // janela a partir da chave e extrai o objeto por balanceamento de chaves.
  const BS = String.fromCharCode(92);
  const janela = html.slice(i, i + 20000).split(BS + '"').join('"').split(BS + BS).join(BS);
  const j = janela.indexOf('{');
  let depth = 0, k = j;
  for (; k < janela.length; k++) { const ch = janela[k]; if (ch === '{') depth++; else if (ch === '}') { depth--; if (depth === 0) { k++; break; } } }
  return JSON.parse(janela.slice(j, k));
}

(async () => {
  if (!codigo) { console.error('uso: gerir-reserva.js <CODIGO> [accept|decline|reschedule HH:MM] --motivo "…"'); process.exit(2); }
  const r = await lerReserva(codigo);
  console.log(`reserva ${codigo} · ${r.restaurant?.name} · ${r.date} ${r.time} · ${r.people} pessoa(s) · status ${r.status}`);
  if (!acao) return;

  if (!['accept', 'decline', 'reschedule'].includes(acao)) { console.error('ação inválida'); process.exit(2); }
  if (!motivo || motivo.length < 8) { console.error('BLOQUEADO: --motivo obrigatório (o texto ou a referência da decisão do restaurante)'); process.exit(3); }
  if (!/^(Pending|In Treatment)$/i.test(r.status || '')) { console.error(`BLOQUEADO: reserva em status "${r.status}" — só Pending/In Treatment`); process.exit(3); }
  if (r.date < hoje()) { console.error(`BLOQUEADO: data da mesa (${r.date}) já passou — nada a decidir`); process.exit(3); }
  if (acao === 'reschedule' && !/^\d{2}:\d{2}$/.test(novoHorario || '')) { console.error('reschedule exige HH:MM'); process.exit(2); }

  const corpo = { reservationCode: codigo, action: acao, reservation: { id: r.id, status: r.status, date: r.date, time: r.time, people: r.people, details: r.details }, restaurant: r.restaurant, user: r.user };
  if (novoHorario) corpo.newTime = novoHorario;
  const resp = await fetch(`${SITE}/api/reservations/manage`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo) });
  const j = await resp.json().catch(() => ({}));
  const ok = resp.ok;
  console.log(`${acao}${novoHorario ? ' ' + novoHorario : ''} → HTTP ${resp.status} · status agora: ${j.reservation?.status || '?'} · ${j.message || j.error || ''}`);
  audit({ evento: 'reserva_gerida_pela_plataforma', reservation_code: codigo, restaurante: r.restaurant?.name, acao, novo_horario: novoHorario, ok, http: resp.status, status_resultante: j.reservation?.status || null, motivo });
  if (!ok) process.exit(1);
})().catch((e) => { audit({ evento: 'falha', reservation_code: codigo, acao, erro: e.message }); console.error('ERRO', e.message); process.exit(1); });
