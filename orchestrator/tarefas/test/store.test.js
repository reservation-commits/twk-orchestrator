'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const store = require('../store.js');

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'twk-tarefas-test-')); }

test('normalizar: exige título e dono válidos, aplica padrões', () => {
  assert.throws(() => store.normalizar({ titulo: 'x', dono: 'marlon' }), /título/);
  assert.throws(() => store.normalizar({ titulo: 'Ligar para a casa', dono: 'fulano' }), /Márlon, Lucas ou Julien/);
  assert.throws(() => store.normalizar({ titulo: 'Ligar para a casa' }), /assuma/);
  assert.throws(() => store.normalizar({ titulo: 'Ligar', dono: 'lucas', vence_em: '03/11/2026' }), /Data inválida/);
  const t = store.normalizar({ titulo: '  Ligar   para a casa ', dono: 'lucas', etapas: [{ texto: ' a ' }, { texto: '' }] });
  assert.equal(t.titulo, 'Ligar para a casa');
  assert.equal(t.area, 'Operação'); assert.equal(t.estado, 'todo'); assert.equal(t.vence_em, null);
  assert.deepEqual(t.etapas.map(({ texto, feita }) => ({ texto, feita })), [{ texto: 'a', feita: false }]);
  assert.ok(t.etapas[0].id, 'toda etapa tem id estável: marcar etapas diferentes nunca entra em conflito');
});

test('motor de arquivo: criar, atualizar, concluir marca etapas, excluir deixa evento', async () => {
  const dir = tmp();
  const db = store.abrir({ stateDir: dir });
  const t = await db.criar({ titulo: 'Responder o hotel', dono: 'julien', area: 'Chauffeur', vence_em: '2026-11-05', etapas: [{ texto: 'Conferir' }, { texto: 'Responder' }] }, 'marlon', 'trc-teste-000001');
  assert.match(t.id, /^T-\d{8}-0001$/);
  assert.equal(t.criado_por, 'marlon');
  const t2 = await db.criar({ titulo: 'Outra tarefa', dono: 'lucas' }, 'lucas', 'trc-teste-000001');
  assert.match(t2.id, /-0002$/);

  const u = await db.atualizar(t.id, { estado: 'done' }, 'julien', 'trc-teste-000001');
  assert.equal(u.estado, 'done'); assert.ok(u.concluido_em);
  assert.ok(u.etapas.every((e) => e.feita), 'concluir marca todas as etapas');
  const volta = await db.atualizar(t.id, { estado: 'doing' }, 'julien', 'trc-teste-000001');
  assert.equal(volta.concluido_em, null);

  assert.equal(await db.atualizar('T-20000101-9999', { estado: 'done' }, 'x', 'trc-teste-000001'), null);
  await assert.rejects(db.atualizar(t.id, { dono: 'ninguem' }, 'x', 'trc-teste-000001'), /Márlon/);

  // excluir: só antes de concluir, sempre com motivo; concluída se arquiva (03/11)
  await assert.rejects(db.excluir(t.id, 'marlon', 'trc-teste-000001'), /motivo/);
  await assert.rejects(db.excluir(t.id, 'marlon', 'trc-teste-000001', 'ok'), /motivo/);
  assert.equal(await db.excluir(t.id, 'marlon', 'trc-teste-000001', 'duplicada da T-… de ontem'), true);
  assert.equal(await db.obter(t.id), null);
  const ev = await db.eventos(t.id);
  assert.deepEqual(ev.map((e) => e.tipo), ['criada', 'estado', 'estado', 'excluida']);
  assert.equal(ev.at(-1).motivo, 'duplicada da T-… de ontem'); assert.equal(ev.at(-1).de.titulo, t.titulo, 'o ledger guarda a tarefa inteira');
  const feita = await db.criar({ titulo: 'Fechar com o Monak', dono: 'lucas', estado: 'done', prioridade: 'alta', cidade: 'Paris', canal: 'WhatsApp', referencia: 'reserva ABCD1234', resultado: 'mesa confirmada' }, 'lucas', 'trc-teste-000002');
  assert.equal(feita.prioridade, 'alta'); assert.equal(feita.canal, 'WhatsApp'); assert.equal(feita.arquivada_em, null);
  await assert.rejects(db.criar({ titulo: 'x y z', dono: 'lucas', canal: 'Pombo' }, 'lucas', 't'), /Canal/);
  await assert.rejects(db.criar({ titulo: 'x y z', dono: 'lucas', prioridade: 'urgentíssima' }, 'lucas', 't'), /Prioridade/);
  await assert.rejects(db.excluir(feita.id, 'lucas', 'trc-teste-000002', 'quero apagar'), /arquive/);
  const aberta = await db.criar({ titulo: 'Ainda aberta', dono: 'lucas' }, 'lucas', 'trc-teste-000003');
  await assert.rejects(db.arquivar(aberta.id, 'lucas', 'trc-teste-000003'), /concluída/);
  const arq = await db.arquivar(feita.id, 'lucas', 'trc-teste-000002');
  assert.ok(arq.arquivada_em);
  assert.ok(!(await db.listar()).some((x) => x.id === feita.id), 'arquivada sai do quadro');
  assert.ok((await db.listar({ arquivadas: true })).some((x) => x.id === feita.id), 'mas fica no arquivo');
  assert.equal((await db.listar({ arquivadas: 'todas' })).length, 3);
  assert.ok(feita.id !== t.id && feita.id !== t2.id && aberta.id !== t.id, 'id de tarefa excluída nunca é reaproveitado (o ledger aponta para ele)');
  assert.match(feita.id, /-0003$/); assert.match(aberta.id, /-0004$/);
  const reaberta = await db.atualizar(feita.id, { estado: 'doing' }, 'lucas', 'trc-teste-000002');
  assert.equal(reaberta.arquivada_em, null, 'voltar de concluída desarquiva');
  assert.deepEqual((await db.eventos(feita.id)).map((e) => e.tipo), ['criada', 'arquivada', 'estado']);
  assert.ok(ev.every((e) => e.trace_id === 'trc-teste-000001' && e.quem));

  // reabrir do disco preserva
  const db2 = store.abrir({ stateDir: dir });
  assert.equal((await db2.listar()).length, 3, 't2, feita (reaberta) e aberta; a excluída não volta');
});

test('sugestões: gravar, decidir, reler', async () => {
  const db = store.abrir({ stateDir: tmp() });
  await db.sugestoesGravar([{ id: 's-abc', titulo: 'Fazer x', porque: 'y' }]);
  const d = await db.sugestaoDecidir('s-abc', 'assumida', 'lucas', 'trc-teste-000002', 'T-20261103-0001');
  assert.equal(d.decisao, 'assumida'); assert.equal(d.tarefa_id, 'T-20261103-0001');
  assert.equal(await db.sugestaoDecidir('s-nao', 'descartada', 'lucas', 'trc-teste-000002'), null);
  const s = await db.sugestoesLer();
  assert.equal(s.itens[0].decidida_por, 'lucas');
});

test('resumo: abertas, atrasadas, hoje, por pessoa', () => {
  const r = store.resumo([
    { estado: 'todo', dono: 'marlon', vence_em: '2026-11-01', etapas: [] },
    { estado: 'doing', dono: 'lucas', vence_em: '2026-11-03', etapas: [] },
    { estado: 'done', dono: 'julien', vence_em: '2026-10-30', concluido_em: '2026-11-02T10:00:00Z', etapas: [] },
    { estado: 'wait', dono: 'julien', vence_em: null, etapas: [] },
  ], '2026-11-03');
  assert.equal(r.abertas, 3); assert.equal(r.atrasadas, 1); assert.equal(r.hoje, 1); assert.equal(r.concluidas_7d, 1);
  assert.equal(r.por_pessoa.marlon.atrasadas, 1); assert.equal(r.por_pessoa.julien.abertas, 1);
  assert.equal(r.mais_antiga_atrasada, '2026-11-01');
});
