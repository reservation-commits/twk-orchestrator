'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const R = require('../../whatsapp-regras.js');

test('mascarar: telefone mostra país e últimos 4; e-mail mostra 1ª letra e domínio; nunca o identificador inteiro', () => {
  assert.equal(R.mascarar('5521967841007'), '+55 ••• 1007');
  assert.equal(R.mascarar('+33612345678'), '+33 ••• 5678');
  assert.equal(R.mascarar('971501234567'), '+971 ••• 4567', 'Emirados: código de 3 dígitos');
  assert.equal(R.mascarar('66812345678'), '+66 ••• 5678', 'Tailândia');
  assert.equal(R.mascarar('12125551234'), '+1 ••• 1234', 'América do Norte');
  assert.equal(R.mascarar('351912345678'), '+351 ••• 5678', 'Portugal');
  assert.equal(R.mascarar('email:judith@gmail.com'), 'j•••@gmail.com');
  assert.equal(R.mascarar(''), '—');
  assert.equal(R.mascarar('123'), '•••');
  assert.ok(!R.mascarar('5521967841007').includes('96784'));
});

test('primeiroNome: só o primeiro nome', () => {
  assert.equal(R.primeiroNome('Fhei Caraan Gutierrez'), 'Fhei');
  assert.equal(R.primeiroNome(null), '');
});

test('agregarFunil: total, enviados, desfechos com os 3 motivos mais comuns e eventos sem sufixo de idioma', () => {
  const f = R.agregarFunil([
    { evento: 'pending_nudge', desfecho: 'sem_opt_in', motivo: 'não marcado', n: 90 },
    { evento: 'pending_nudge_en', desfecho: 'enviado', motivo: null, n: 10 },
    { evento: 'pedido_recebido:estabelecimento', desfecho: 'sem_destinatario', motivo: 'nenhum número', n: 60 },
    { evento: 'pedido_recebido:estabelecimento', desfecho: 'sem_destinatario', motivo: 'lista de bloqueio', n: 40 },
    { evento: 'pedido_recebido:estabelecimento', desfecho: 'enviado', motivo: null, n: 10 },
  ]);
  assert.equal(f.total, 210);
  assert.equal(f.enviados, 20);
  assert.equal(f.pct_enviados, 9.5);
  assert.equal(f.desfechos[0].desfecho, 'sem_destinatario');
  assert.equal(f.desfechos[0].motivos[0].motivo, 'nenhum número');
  const nudge = f.eventos.find((e) => e.evento === 'pending_nudge');
  assert.equal(nudge.total, 100);
  assert.equal(nudge.enviados, 10);
  assert.equal(nudge.pct, 10);
});

test('linhaDoTempo: 14 dias sempre, dias sem dado valem zero, ordem crescente', () => {
  const hoje = new Date('2026-10-22T15:00:00Z');
  const t = R.linhaDoTempo([{ dia: '2026-10-22', recebidas: 3, respondidas: 1, tentativas: 10, enviados: 2, falhas: 1 }], 14, hoje);
  assert.equal(t.length, 14);
  assert.equal(t[0].dia, '2026-10-09');
  assert.equal(t[13].dia, '2026-10-22');
  assert.equal(t[13].recebidas, 3);
  assert.equal(t[12].recebidas, 0);
});

test('resumoEntregas: por template com taxa de leitura e de falha', () => {
  const r = R.resumoEntregas([{ template: 'twk_venue_new_request', status: 'read', n: 5 }, { template: 'twk_venue_new_request', status: 'failed', n: 5 }, { template: 'twk_ops_alert', status: 'read', n: 2 }]);
  assert.equal(r[0].template, 'twk_venue_new_request');
  assert.equal(r[0].pct_lidas, 50);
  assert.equal(r[0].pct_falhas, 50);
  assert.equal(r[1].pct_lidas, 100);
});

test('duracao: legível em s, min, h e d', () => {
  assert.equal(R.duracao(12), '12 s');
  assert.equal(R.duracao(250), '4 min');
  assert.equal(R.duracao(7800), '2 h 10');
  assert.equal(R.duracao(3 * 86400), '3 d');
  assert.equal(R.duracao(null), '—');
});
