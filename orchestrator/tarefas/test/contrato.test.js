'use strict';
/**
 * O contrato do livro, o MESMO teste nos dois motores. Antes o motor Postgres tinha 0% de cobertura e divergia do de
 * arquivo em silêncio (formato dos eventos, sugestões que nunca saíam, descartada que nunca voltava).
 *
 * Postgres aqui é de verdade, embutido (PGlite, devDependency): roda sql/001-plan.sql e fala SQL real, sem servidor.
 * Sem o pacote, o teste aparece como PULADO, com o motivo: checagem que não rodou é achado, não "ok".
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const store = require('../store.js');

const T = 'trc-teste-contrato';

function carregarPglite() {
  const caminhos = [process.env.COMPASSO_PGLITE, '@electric-sql/pglite'].filter(Boolean);
  return caminhos.reduce((achado, c) => achado || import(c.startsWith('@') ? c : `file://${path.resolve(c).replace(/\\/g, '/')}`).catch(() => null), null);
}

/** Pool no formato do pacote pg, em cima do PGlite. */
function poolDe(pg) {
  const query = async (sql, params) => { const r = await pg.query(sql, params); return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length }; };
  return { query, connect: async () => ({ query, release() {} }) };
}

async function bancoNovo(PGlite) {
  const pg = new PGlite();
  const ddl = fs.readFileSync(path.join(__dirname, '..', 'sql', '001-plan.sql'), 'utf8').split('-- Papel do app')[0].replace(/^BEGIN;/m, '');
  await pg.exec(ddl);
  return store.abrir({ pool: poolDe(pg) });
}

async function contrato(db) {
  // criar: id, versão, etapas com id, evento com formato único
  const t = await db.criar({ titulo: 'Confirmar a mesa do Monak', dono: 'julien', vence_em: '2026-12-01', etapas: [{ texto: 'Ligar' }, { texto: 'Registrar' }], notas: 'original', cidade: 'Paris' }, 'lucas', T);
  assert.match(t.id, /^T-\d{8}-0001$/); assert.equal(t.versao, 1); assert.ok(t.etapas[0].id); assert.equal(t.criado_por, 'lucas');
  const outro = await db.criar({ titulo: 'Segundo card', dono: 'lucas' }, 'lucas', T);
  assert.match(outro.id, /-0002$/);
  assert.equal((await db.obter(t.id)).cidade, 'Paris');
  assert.equal((await db.listar()).length, 2);

  // ledger: todo campo, formato igual nos dois motores
  await db.atualizar(t.id, { prioridade: 'alta', referencia: 'RES-1' }, 'julien', T);
  let ev = await db.eventos(t.id);
  assert.deepEqual(ev.map((e) => e.tipo), ['criada', 'atualizada']);
  assert.deepEqual(ev[1].mudou.prioridade, { de: 'normal', para: 'alta' }, 'detalhe aberto no evento, em qualquer motor');
  assert.equal(ev[1].quem, 'julien'); assert.equal(ev[1].trace_id, T); assert.ok(ev[1].seq > ev[0].seq); assert.ok(!Number.isNaN(Date.parse(ev[1].ts)));
  assert.equal(await db.ultimoSeq(), ev[1].seq);

  // conflito
  await db.atualizar(t.id, { notas: 'do Julien' }, 'julien', T, { base: { notas: 'original' } });
  await assert.rejects(db.atualizar(t.id, { notas: 'do Márlon' }, 'marlon', T, { base: { notas: 'original' } }), (e) => e instanceof store.ErroConflito && e.tarefa.notas === 'do Julien');
  assert.equal((await db.atualizar(t.id, { titulo: 'Confirmar a mesa' }, 'marlon', T, { base: { titulo: 'Confirmar a mesa do Monak' } })).notas, 'do Julien');

  // etapas por operação, em paralelo
  const [e1, e2] = t.etapas.map((e) => e.id);
  await Promise.all([db.atualizar(t.id, { etapas_ops: [{ op: 'marcar', id: e1, feita: true }] }, 'lucas', T), db.atualizar(t.id, { etapas_ops: [{ op: 'marcar', id: e2, feita: true }] }, 'julien', T)]);
  assert.deepEqual((await db.obter(t.id)).etapas.map((e) => e.feita), [true, true]);

  // comentário e menção
  const c = await db.comentar(t.id, 'Falei com o concierge, @lucas confirma', 'julien', T);
  assert.equal(c.comentarios.length, 1);
  ev = await db.eventos(t.id);
  assert.deepEqual(ev.at(-1).mencoes, ['lucas']); assert.equal(ev.at(-1).tipo, 'comentario');

  // concluir, reabrir, arquivar, desarquivar
  const v = await db.criar({ titulo: 'Card a concluir', dono: 'lucas', etapas: [{ texto: 'a', feita: true }, { texto: 'b' }] }, 'lucas', T);
  assert.ok((await db.atualizar(v.id, { estado: 'done', resultado: 'ok' }, 'lucas', T)).concluido_em);
  assert.deepEqual((await db.atualizar(v.id, { estado: 'doing' }, 'lucas', T)).etapas.map((e) => e.feita), [true, false]);
  await db.atualizar(v.id, { estado: 'done' }, 'lucas', T);
  assert.ok((await db.arquivar(v.id, 'lucas', T)).arquivada_em);
  assert.ok(!(await db.listar()).some((x) => x.id === v.id)); assert.equal((await db.listar({ arquivadas: true })).length, 1); assert.equal((await db.listar({ arquivadas: 'todas' })).length, 3);
  assert.equal((await db.desarquivar(v.id, 'lucas', T)).arquivada_em, null);
  await assert.rejects(db.excluir(v.id, 'lucas', T, 'quero apagar'), /arquive/);

  // recorrência
  const r = await db.criar({ titulo: 'Rever a fila', dono: 'lucas', repete: 'semanal', vence_em: store.hoje() }, 'lucas', T);
  const rd = await db.atualizar(r.id, { estado: 'done' }, 'lucas', T);
  assert.ok(rd.proxima_id); assert.equal((await db.obter(rd.proxima_id)).estado, 'todo');

  // excluir: motivo, some do quadro, id não volta, evento guarda o card inteiro
  await assert.rejects(db.excluir(outro.id, 'lucas', T, 'ok'), /motivo/);
  assert.equal(await db.excluir(outro.id, 'lucas', T, 'duplicada de outra'), true);
  assert.equal(await db.obter(outro.id), null); assert.equal(await db.excluir(outro.id, 'lucas', T, 'de novo agora'), false);
  ev = await db.eventos(outro.id);
  assert.equal(ev.at(-1).motivo, 'duplicada de outra'); assert.equal(ev.at(-1).de.titulo, 'Segundo card');
  const novo = await db.criar({ titulo: 'Depois da exclusão', dono: 'lucas' }, 'lucas', T);
  assert.notEqual(novo.id, outro.id);

  // sugestões: a lista é substituída; o que saiu da fonte sai daqui; decisão persiste; geração vazia conta
  await db.sugestoesGravar([{ id: 's-aaaaaaaaaaaa', titulo: 'Fazer x', porque: 'y', chave: 'k:x' }, { id: 's-bbbbbbbbbbbb', titulo: 'Fazer z', porque: 'y', chave: 'k:z' }], { marco_zero: '2026-11-03' });
  let s = await db.sugestoesLer();
  assert.equal(s.itens.length, 2); assert.equal(s.marco_zero, '2026-11-03'); assert.ok(s.geradas_em);
  const d = await db.sugestaoDecidir('s-aaaaaaaaaaaa', 'assumida', 'lucas', T, t.id);
  assert.equal(d.decisao, 'assumida'); assert.equal(d.tarefa_id, t.id);
  assert.equal(await db.sugestaoDecidir('s-naoexiste000', 'descartada', 'lucas', T), null);
  await db.sugestoesGravar([{ id: 's-aaaaaaaaaaaa', titulo: 'Fazer x', porque: 'y', chave: 'k:x', decisao: 'assumida', tarefa_id: t.id }], {});
  s = await db.sugestoesLer();
  assert.deepEqual(s.itens.map((i) => i.id), ['s-aaaaaaaaaaaa'], 'o que saiu da fonte não fica para sempre'); assert.equal(s.itens[0].decisao, 'assumida');
  await db.sugestoesGravar([{ id: 's-aaaaaaaaaaaa', titulo: 'Fazer x', porque: 'y', chave: 'k:x' }], {});
  assert.equal((await db.sugestoesLer()).itens[0].decisao, undefined, 'a decisão que a geração tirou (descartada venceu) não ressuscita');
  await db.sugestoesGravar([], {});
  s = await db.sugestoesLer();
  assert.equal(s.itens.length, 0); assert.ok(s.geradas_em, 'geração sem itens registra a hora: não regenera a cada leitura');

  // conversas
  await db.conversaGravar({ quem: 'lucas', canal: 'app', papel: 'pessoa', texto: 'oi' });
  await db.conversaGravar({ quem: 'julien', canal: 'mcp', papel: 'planejador', texto: 'tchau' });
  assert.equal((await db.conversaLer({ quem: 'lucas' })).length, 1); assert.equal((await db.conversaLer({})).length, 2);
}

test('contrato do livro: motor de arquivo', async () => {
  const db = store.abrir({ stateDir: fs.mkdtempSync(path.join(os.tmpdir(), 'twk-contrato-')) });
  await contrato(db);
});

test('contrato do livro: motor Postgres (SQL real, via PGlite)', async (t) => {
  const mod = await carregarPglite();
  if (!mod) { t.skip('PGlite não instalado: rode npm install nesta pasta para validar o motor Postgres'); return; }
  const db = await bancoNovo(mod.PGlite);
  await contrato(db);
});
