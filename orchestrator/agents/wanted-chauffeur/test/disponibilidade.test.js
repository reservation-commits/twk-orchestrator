'use strict';
/** Disponibilidade (agenda.js): corridas confirmadas com folga, virada da meia-noite, bloqueios, antecedência, horizonte, conferência. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const R = require('../reservas.js');
const A = require('../agenda.js');

const AGORA = Date.parse('2026-11-22T13:00:00Z'); // domingo 22/11, 2:00 PM em Paris
const novo = () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'twk-dispo-')); return { dir, store: R.abrirArquivo({ dir, agora: () => AGORA }) }; };
const mk = (o) => R.validar({ produto: 'game', data: '2026-11-24', hora: '9:00 PM', nome: 'Léa Martin', ...o }, { exigirPessoa: true }).reserva;
const faixa = (d) => d.ocupado.map(([a, b]) => `${A.minParaHora(a)}-${b >= 1440 ? '24h' : A.minParaHora(b)}`);

test('corrida confirmada ocupa a duração do produto com 30 min de folga, e o que passa da meia-noite vai para o dia seguinte', async () => {
  const { dir, store } = novo();
  await store.criar(mk({ codigo: 'WTD-T-AAAA' })); await store.evento({ codigo: 'WTD-T-AAAA', tipo: 'status', valor: 'confirmado' });
  await store.criar(mk({ codigo: 'WTD-T-BBBB', data: '2026-11-25', hora: '10:00 AM', produto: 'transfer' })); // só pedido: não ocupa
  const o = await A.ocupacao({ store, dir, de: '2026-11-23', dias: 3, agora: AGORA });
  assert.equal(o.fuso, 'Europe/Paris'); assert.equal(o.hoje, '2026-11-22'); assert.equal(o.folga_min, 30); assert.equal(o.duracoes_min.game, 180);
  assert.deepEqual(o.dias.map((d) => d.data), ['2026-11-23', '2026-11-24', '2026-11-25']);
  assert.deepEqual(faixa(o.dias[0]), []);
  assert.deepEqual(faixa(o.dias[1]), ['8:30 PM-24h']);
  assert.deepEqual(faixa(o.dias[2]), ['12:00 AM-12:30 AM'], 'pedido sem resposta não ocupa a agenda');
  assert.equal(A.livre(o, '2026-11-24', A.horaParaMin('5:00 PM'), 90), true, 'transfer 5:00–6:30 PM cabe');
  assert.equal(A.livre(o, '2026-11-24', A.horaParaMin('7:30 PM'), 90), false, 'transfer 7:30–9:00 PM encosta na folga');
  assert.equal(A.livre(o, '2026-11-23', A.horaParaMin('11:00 PM'), 180), true);
  assert.equal(A.livre(o, '2026-11-24', A.horaParaMin('1:00 AM'), 60), true);
  // resposta pública não leva código nem nome
  assert.ok(!JSON.stringify(o).includes('WTD-') && !JSON.stringify(o).includes('Léa'));
  const interno = await A.ocupacao({ store, dir, de: '2026-11-24', dias: 1, agora: AGORA, interno: true });
  assert.equal(interno.dias[0].detalhes[0].codigo, 'WTD-T-AAAA');
});

test('bloqueios: dia inteiro, vários dias e faixa de horário; validação; remoção; o motivo não sai na resposta pública', async () => {
  const { dir, store } = novo();
  assert.equal(A.adicionarBloqueio(dir, { data: '26/11/2026' }).status, 400);
  assert.equal(A.adicionarBloqueio(dir, { data: '2026-11-26', de: '2:00 PM' }).status, 400, 'de sem ate');
  assert.equal(A.adicionarBloqueio(dir, { data: '2026-11-26', de: '6:00 PM', ate: '2:00 PM' }).status, 400);
  assert.equal(A.adicionarBloqueio(dir, { data: '2026-11-26', ate_data: '2026-11-27', de: '2:00 PM', ate: '6:00 PM' }).status, 400, 'faixa só num dia');
  assert.equal(A.adicionarBloqueio(dir, { data: '2026-11-26', de: '14:00', ate: '18:00' }).status, 400, 'hora em 24 h é recusada');
  const dia = A.adicionarBloqueio(dir, { data: '2026-11-26', motivo: 'garage' }); assert.equal(dia.status, 201); assert.match(dia.bloqueio.id, /^BLQ-[0-9a-f]{8}$/);
  assert.equal(A.adicionarBloqueio(dir, { data: '2026-11-28', ate_data: '2026-11-29' }).status, 201);
  assert.equal(A.adicionarBloqueio(dir, { data: '2026-11-27', de: '2:00 PM', ate: '6:00 PM', motivo: 'dentiste' }).status, 201);
  const o = await A.ocupacao({ store, dir, de: '2026-11-26', dias: 4, agora: AGORA });
  assert.deepEqual(o.dias.map((d) => d.fechado), [true, false, true, true]);
  assert.deepEqual(faixa(o.dias[1]), ['2:00 PM-6:00 PM']);
  assert.ok(!JSON.stringify(o).includes('garage') && !JSON.stringify(o).includes('dentiste'));
  assert.equal(A.lerBloqueios(dir).length, 3);
  assert.equal(A.removerBloqueio(dir, dia.bloqueio.id).status, 200);
  assert.equal(A.removerBloqueio(dir, dia.bloqueio.id).status, 404);
  assert.equal((await A.ocupacao({ store, dir, de: '2026-11-26', dias: 1, agora: AGORA })).dias[0].fechado, false);
});

test('hoje: nada antes de agora + 2 h; passado e além do horizonte ficam fechados', async () => {
  const { dir, store } = novo();
  const o = await A.ocupacao({ store, dir, de: '2026-11-21', dias: 3, agora: AGORA, env: { CHAUFFEUR_HORIZONTE_DIAS: '1' } });
  assert.equal(o.dias[0].fechado, true, 'ontem');
  assert.deepEqual(faixa(o.dias[1]), ['12:00 AM-4:00 PM'], 'hoje: 2:00 PM + 2 h');
  assert.equal(o.dias[2].fechado, false, 'amanhã, dentro do horizonte de 1 dia');
  const o2 = await A.ocupacao({ store, dir, de: '2026-11-24', dias: 1, agora: AGORA, env: { CHAUFFEUR_HORIZONTE_DIAS: '1' } });
  assert.equal(o2.dias[0].fechado, true, 'depois do horizonte');
  // às 11:00 PM de hoje, o resto do dia acaba e o começo de amanhã também
  const tarde = Date.parse('2026-11-22T22:00:00Z');
  const o3 = await A.ocupacao({ store, dir, de: '2026-11-22', dias: 2, agora: tarde });
  assert.equal(o3.dias[0].fechado, true); assert.deepEqual(faixa(o3.dias[1]), ['12:00 AM-1:00 AM']);
});

test('conferir: o servidor barra horário ocupado, dia fechado, antecedência, passado e horizonte; o resto passa', async () => {
  const { dir, store } = novo();
  await store.criar(mk({ codigo: 'WTD-T-AAAA' })); await store.evento({ codigo: 'WTD-T-AAAA', tipo: 'status', valor: 'confirmado' });
  A.adicionarBloqueio(dir, { data: '2026-11-26' });
  const c = (o) => A.conferir({ store, dir, reserva: { produto: 'transfer', ...o }, agora: AGORA });
  assert.equal((await c({ data: '2026-11-24', hora: '8:00 PM' })).motivo, 'ocupado');
  assert.equal((await c({ data: '2026-11-26', hora: '8:00 PM' })).motivo, 'dia_fechado');
  assert.equal((await c({ data: '2026-11-22', hora: '3:00 PM' })).motivo, 'antecedencia');
  assert.equal((await c({ data: '2026-11-21', hora: '3:00 PM' })).motivo, 'passado');
  assert.equal((await c({ data: '2027-06-01', hora: '3:00 PM' })).motivo, 'horizonte');
  assert.equal(await c({ data: '2026-11-24', hora: '5:00 PM' }), null);
  assert.equal(await c({ data: '2026-11-22', hora: '4:00 PM' }), null, 'exatamente 2 h depois de agora passa');
  assert.equal(await c({}), null, 'sem data e hora não confere (rota antiga)');
  // mise à disposition de 4 h às 5:00 PM encosta na Game Night das 9:00 PM
  assert.equal((await c({ produto: 'mad', horas: 4, data: '2026-11-24', hora: '5:00 PM' })).motivo, 'ocupado');
});

test('config: durações, folga e antecedência ajustáveis pelo ambiente, com limites', () => {
  const cfg = A.config({ CHAUFFEUR_FOLGA_MIN: '45', CHAUFFEUR_ANTECEDENCIA_MIN: 'abc', CHAUFFEUR_DURACOES: 'transfer=60, game=999, uber=30' });
  assert.equal(cfg.folga, 45); assert.equal(cfg.antecedencia, 120); assert.equal(cfg.duracoes.transfer, 60); assert.equal(cfg.duracoes.game, 180);
  assert.equal(A.duracao('mad', 3, cfg), 180); assert.equal(A.duracao('mad', null, cfg), 120);
});
