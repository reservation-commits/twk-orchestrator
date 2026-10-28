'use strict';
// Sentinela × rotinas hospedadas (27/10/2026): a fonte é o rotinas.json da Central, não o log do notebook.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { avaliar } = require('../../../agents/sentinela-silencio/rotinaCentral.js');

const agora = new Date('2026-10-28T02:00:00Z');
const f = { chave: 'retencao', tipo: 'rotina_central', job: 'retencao', tolerancia_horas: 30, severidade: 'alta' };
const rodada = (jobs, dia = '2026-10-27') => ({ dia, rodou_em: `${dia}T08:00:10.000Z`, ok: jobs.every((j) => j.ok), jobs });

test('job que falhou vira achado com o erro e a ação de reexecução', () => {
  const r = avaliar(f, rodada([{ job: 'retencao', ok: false, exit: 2, tentativas: 3, log: 'logs/tarefas/retencao-20261027.log', erro: 'FALHA: operator does not exist: timestamp with time zone <= interval' }]), agora);
  assert.equal(r.tipo, 'achado');
  assert.match(r.evidencia, /FALHOU em 2026-10-27 \(3 tentativa/);
  assert.match(r.evidencia, /operator does not exist/);
  assert.match(r.acao, /"so":"retencao"/);
});

test('job ok é fonte viva, com o modo', () => {
  const r = avaliar(f, rodada([{ job: 'retencao', ok: true, exit: 0, modo: 'real' }]), agora);
  assert.equal(r.tipo, 'ok');
  assert.match(r.texto, /ok em 2026-10-27 \(real\)/);
});

test('rodada velha além da tolerância é achado, mesmo com o job ok', () => {
  const r = avaliar(f, rodada([{ job: 'retencao', ok: true }], '2026-10-25'), agora);
  assert.equal(r.tipo, 'achado');
  assert.match(r.evidencia, /há 6\dh \(tolerância 30h\)/);
});

test('sem rodada ou sem o job é lacuna, nunca "ok" silencioso', () => {
  assert.equal(avaliar(f, null, agora).tipo, 'lacuna');
  const r = avaliar(f, rodada([{ job: 'zelador', ok: true }]), agora);
  assert.equal(r.tipo, 'lacuna');
  assert.match(r.texto, /não aparece na última rodada \(zelador\)/);
});

test('vigia com achado crítico (exit 1) continua ok e diz isso', () => {
  const r = avaliar({ ...f, chave: 'sentinela', job: 'sentinela' }, rodada([{ job: 'sentinela', ok: true, exit: 1, achados_criticos: true }]), agora);
  assert.equal(r.tipo, 'ok');
  assert.match(r.texto, /achado crítico/);
});
