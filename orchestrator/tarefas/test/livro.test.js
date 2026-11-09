'use strict';
/** O contrato do livro: não perder nada. Cada teste é uma pane real ou uma confusão real entre duas pessoas. */
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const store = require('../store.js');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'twk-livro-'));
const T = 'trc-teste-livro';

test('reabrir sem ter gravado o instantâneo: o ledger traz tudo de volta, sem perder etapa nem nota', async () => {
  const dir = tmp();
  const db = store.abrir({ stateDir: dir });
  const a = await db.criar({ titulo: 'Confirmar a mesa do Monak', dono: 'julien', etapas: [{ texto: 'Ligar' }, { texto: 'Registrar' }], notas: 'cliente BASF', cidade: 'Paris' }, 'lucas', T);
  await db.atualizar(a.id, { notas: 'cliente BASF, mesa para 6', prioridade: 'alta' }, 'julien', T);
  // sem gravarAgora: simula a queda do processo logo depois da resposta
  const db2 = store.abrir({ stateDir: dir });
  const t = await db2.obter(a.id);
  assert.equal(t.notas, 'cliente BASF, mesa para 6'); assert.equal(t.prioridade, 'alta'); assert.equal(t.etapas.length, 2); assert.equal(t.cidade, 'Paris');
  assert.equal((await db2.eventos(a.id)).length, 2);
  const b = await db2.criar({ titulo: 'Outro card', dono: 'lucas' }, 'lucas', T);
  assert.notEqual(b.id, a.id, 'id não se repete depois de reabrir');
});

test('tarefas.json cortado pela metade: nunca abre vazio; guarda a prova e reconstrói', async () => {
  const dir = tmp();
  const db = store.abrir({ stateDir: dir });
  const a = await db.criar({ titulo: 'Card que não pode sumir', dono: 'julien', etapas: [{ texto: 'Passo um' }] }, 'lucas', T);
  await db.criar({ titulo: 'Segundo card vivo', dono: 'lucas' }, 'lucas', T);
  db.gravarAgora();
  const bruto = fs.readFileSync(path.join(dir, 'tarefas.json'), 'utf8');
  fs.writeFileSync(path.join(dir, 'tarefas.json'), bruto.slice(0, Math.floor(bruto.length / 2)));

  const db2 = store.abrir({ stateDir: dir });
  assert.equal(await db2.pronto(), true);
  assert.equal((await db2.listar()).length, 2, 'os dois cards voltaram do ledger');
  assert.equal((await db2.obter(a.id)).etapas[0].texto, 'Passo um', 'com etapas');
  const s = db2.saude();
  assert.ok(s.recuperado, 'recuperação é declarada, não silenciosa');
  assert.ok(s.corrompido_em && fs.existsSync(path.join(dir, s.corrompido_em)), 'o arquivo ruim fica guardado como prova');
  assert.ok(Array.isArray(JSON.parse(fs.readFileSync(path.join(dir, 'tarefas.json'), 'utf8'))), 'o instantâneo volta a ser bom na hora');
  // O serviço reinicia: o livro abre normal, mas o aviso não some
  const db3 = store.abrir({ stateDir: dir });
  assert.equal((await db3.listar()).length, 2);
  assert.ok(db3.saude().recuperado, 'recuperação continua avisando depois do reinício');
  assert.equal(fs.readdirSync(dir).filter((f) => f.includes('corrompido')).length, 1, 'reiniciar não gera prova nova');
});

test('instantâneo apagado com o ledger ainda ali: reconstrói, inclusive card da era antiga, e avisa', async () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'eventos.jsonl'), `${JSON.stringify({ ts: '2026-11-04T10:00:00Z', tarefa_id: 'T-20261104-0001', tipo: 'criada', quem: 'admin', trace_id: 't', para: { titulo: 'Card antigo', dono: 'julien', estado: 'todo', vence_em: '2026-11-20' } })}\n${JSON.stringify({ ts: '2026-11-04T11:00:00Z', tarefa_id: 'T-20261104-0001', tipo: 'estado', quem: 'admin', trace_id: 't', mudou: { estado: { de: 'todo', para: 'doing' } } })}\n`);
  const db = store.abrir({ stateDir: dir });
  const [t] = await db.listar();
  assert.equal(t.titulo, 'Card antigo'); assert.equal(t.dono, 'julien'); assert.equal(t.estado, 'doing'); assert.equal(t.recuperada, true);
  assert.equal(db.saude().recuperado, 'ledger');
});

test('reconstrução da era antiga: card concluído e arquivado continua concluído e arquivado', async () => {
  const dir = tmp();
  const ev = [
    { ts: '2026-11-04T10:00:00Z', tarefa_id: 'T-20261104-0001', tipo: 'criada', quem: 'admin', trace_id: 't', para: { titulo: 'Já arquivado', dono: 'julien', estado: 'todo', vence_em: null } },
    { ts: '2026-11-04T11:00:00Z', tarefa_id: 'T-20261104-0001', tipo: 'estado', quem: 'admin', trace_id: 't', mudou: { estado: { de: 'todo', para: 'done' } } },
    { ts: '2026-11-04T12:00:00Z', tarefa_id: 'T-20261104-0001', tipo: 'arquivada', quem: 'admin', trace_id: 't', de: { titulo: 'Já arquivado' } },
  ];
  fs.writeFileSync(path.join(dir, 'eventos.jsonl'), ev.map((e) => JSON.stringify(e)).join('\n') + '\n');
  fs.writeFileSync(path.join(dir, 'tarefas.json'), '{cortado');
  const db = store.abrir({ stateDir: dir });
  assert.equal((await db.listar()).length, 0, 'não volta ao quadro');
  const [t] = await db.listar({ arquivadas: true });
  assert.equal(t.estado, 'done'); assert.equal(t.concluido_em, '2026-11-04T11:00:00Z'); assert.equal(t.arquivada_em, '2026-11-04T12:00:00Z');
});

test('a ordem do quadro não muda ao reiniciar', async () => {
  const dir = tmp();
  const db = store.abrir({ stateDir: dir });
  const a = await db.criar({ titulo: 'Primeiro card', dono: 'lucas' }, 'lucas', T);
  const b = await db.criar({ titulo: 'Segundo card', dono: 'lucas' }, 'lucas', T);
  db.gravarAgora();
  const ordem1 = (await store.abrir({ stateDir: dir }).listar()).map((x) => x.id);
  assert.deepEqual(ordem1, [b.id, a.id], 'mais novo primeiro');
  const db2 = store.abrir({ stateDir: dir }); db2.gravarAgora();
  const db3 = store.abrir({ stateDir: dir }); db3.gravarAgora();
  assert.deepEqual((await store.abrir({ stateDir: dir }).listar()).map((x) => x.id), ordem1, 'igual depois de vários reinícios');
});

test('arquivo ruim, sem ledger e sem cópia: o serviço para e diz por quê; nada é escrito por cima', async () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'tarefas.json'), '{quebrado');
  const db = store.abrir({ stateDir: dir });
  await assert.rejects(db.pronto(), /nada a reconstruir/);
  await assert.rejects(db.criar({ titulo: 'Não pode gravar', dono: 'lucas' }, 'lucas', T), /Livro indisponível/);
  assert.equal(db.copiar('2026-11-05'), null, 'cópia de segurança não copia livro quebrado');
  assert.equal(fs.readFileSync(path.join(dir, 'tarefas.json'), 'utf8'), '{quebrado', 'o original fica intacto');
  // Reiniciar não pode transformar a pane em quadro vazio: continua parado, com o mesmo motivo
  await assert.rejects(store.abrir({ stateDir: dir }).pronto(), /nada a reconstruir/);
});

test('cópia diária: arquivo corrompido não pisa na cópia boa; reconstrução usa a cópia + o que veio depois', async () => {
  const dir = tmp();
  const db = store.abrir({ stateDir: dir });
  const a = await db.criar({ titulo: 'Da cópia de ontem', dono: 'julien' }, 'lucas', T);
  db.copiar('2026-11-04');
  const b = await db.criar({ titulo: 'Depois da cópia', dono: 'lucas' }, 'lucas', T);
  db.gravarAgora();
  fs.writeFileSync(path.join(dir, 'tarefas.json'), 'lixo');
  const db2 = store.abrir({ stateDir: dir });
  assert.match(db2.saude().recuperado, /cópia de 2026-11-04/);
  assert.ok(await db2.obter(a.id)); assert.ok(await db2.obter(b.id));
  const c = db2.copiar('2026-11-05');
  assert.ok(c.arquivos >= 2);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'backups', '2026-11-05', 'tarefas.json'), 'utf8')).length, 2, 'a cópia sai da memória íntegra, nunca do arquivo quebrado');
});

test('linha cortada no fim do ledger (queda no meio da escrita): o resto vale e a contagem denuncia', async () => {
  const dir = tmp();
  const db = store.abrir({ stateDir: dir });
  const a = await db.criar({ titulo: 'Sobrevive à queda', dono: 'lucas' }, 'lucas', T);
  fs.appendFileSync(path.join(dir, 'eventos.jsonl'), '{"seq":99,"tipo":"atualiz');
  const db2 = store.abrir({ stateDir: dir });
  assert.equal((await db2.obter(a.id)).titulo, 'Sobrevive à queda');
  assert.equal(db2.saude().linhas_ilegiveis, 1);
  const depois = await db2.criar({ titulo: 'Depois da queda', dono: 'lucas' }, 'lucas', T);
  // O evento seguinte não pode se colar na linha cortada: se colasse, este card sumiria na próxima abertura
  fs.rmSync(path.join(dir, 'tarefas.json'), { force: true });
  const db3 = store.abrir({ stateDir: dir });
  assert.equal((await db3.obter(depois.id)).titulo, 'Depois da queda');
  assert.equal(db3.saude().linhas_ilegiveis, 1);
});

test('livro de antes da 1.0 (só instantâneo e ledger sem card inteiro) abre igual e ganha ids de etapa', async () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'tarefas.json'), JSON.stringify([{ id: 'T-20261104-0001', titulo: 'Card antigo', dono: 'marlon', estado: 'doing', area: 'Operação', etapas: [{ texto: 'a', feita: true }, { texto: 'b', feita: false }], notas: '', vence_em: null, criado_em: '2026-11-04T10:00:00Z', atualizado_em: '2026-11-04T10:00:00Z', concluido_em: null }]));
  fs.writeFileSync(path.join(dir, 'eventos.jsonl'), `${JSON.stringify({ ts: '2026-11-04T10:00:00Z', tarefa_id: 'T-20261104-0001', tipo: 'criada', quem: 'admin', trace_id: 't', para: { titulo: 'Card antigo', dono: 'marlon' } })}\n`);
  const db = store.abrir({ stateDir: dir });
  const [t] = await db.listar();
  assert.equal(t.id, 'T-20261104-0001'); assert.deepEqual(t.etapas.map((e) => e.id), ['i0', 'i1']);
  const u = await db.atualizar(t.id, { etapas_ops: [{ op: 'marcar', id: 'i1', feita: true }] }, 'lucas', T);
  assert.ok(u.etapas.every((e) => e.feita)); assert.equal(u.versao, 1);
  assert.equal((await db.eventos(t.id)).length, 2, 'histórico antigo preservado');
});

test('ledger completo: toda mudança de todo campo deixa rastro, com de e para', async () => {
  const db = store.abrir({ stateDir: tmp() });
  const t = await db.criar({ titulo: 'Rastro completo', dono: 'lucas' }, 'lucas', T);
  await db.atualizar(t.id, { prioridade: 'alta' }, 'lucas', T);
  await db.atualizar(t.id, { cidade: 'Paris', canal: 'WhatsApp', referencia: 'RES-1' }, 'lucas', T);
  await db.atualizar(t.id, { resultado: 'Cliente confirmado' }, 'lucas', T);
  await db.atualizar(t.id, { aguardando_quem: 'Hotel', cobrar_em: '2026-12-01', repete: 'mensal' }, 'lucas', T);
  const ev = await db.eventos(t.id);
  assert.equal(ev.length, 5);
  assert.deepEqual(ev[1].mudou.prioridade, { de: 'normal', para: 'alta' });
  assert.deepEqual(Object.keys(ev[2].mudou).sort(), ['canal', 'cidade', 'referencia']);
  assert.deepEqual(ev[3].mudou.resultado, { de: '', para: 'Cliente confirmado' });
  assert.deepEqual(Object.keys(ev[4].mudou).sort(), ['aguardando_quem', 'cobrar_em', 'repete']);
  assert.equal(ev[0].depois, undefined, 'a leitura do histórico não carrega o card inteiro');
  assert.ok(ev.every((e) => e.seq > 0));
  assert.equal((await db.atualizar(t.id, { prioridade: 'alta' }, 'lucas', T)).versao, 5, 'nada mudou: nem versão nem evento');
  assert.equal((await db.eventos(t.id)).length, 5);
});

test('duas pessoas: campos diferentes se somam; o mesmo campo vira conflito com o valor atual', async () => {
  const db = store.abrir({ stateDir: tmp() });
  const t = await db.criar({ titulo: 'Card disputado', dono: 'lucas', notas: 'original', etapas: [{ texto: 'x' }, { texto: 'y' }] }, 'lucas', T);
  // Julien muda as notas e o status
  await db.atualizar(t.id, { notas: 'Julien terminou', estado: 'doing' }, 'julien', T, { base: { notas: 'original', estado: 'todo' } });
  // Márlon, com a tela antiga, muda o título: soma
  const soma = await db.atualizar(t.id, { titulo: 'Card disputado (ajustado)' }, 'marlon', T, { base: { titulo: t.titulo } });
  assert.equal(soma.titulo, 'Card disputado (ajustado)'); assert.equal(soma.notas, 'Julien terminou'); assert.equal(soma.estado, 'doing');
  // Márlon, com a tela antiga, muda as notas: conflito, nada se perde
  await assert.rejects(db.atualizar(t.id, { notas: 'do Márlon' }, 'marlon', T, { base: { notas: 'original' } }), (e) => {
    assert.ok(e instanceof store.ErroConflito); assert.deepEqual(e.conflito, ['notas']); assert.equal(e.tarefa.notas, 'Julien terminou'); return true;
  });
  assert.equal((await db.obter(t.id)).notas, 'Julien terminou');
  // mesmo valor que o outro já pôs: não é conflito
  await db.atualizar(t.id, { estado: 'doing' }, 'marlon', T, { base: { estado: 'todo' } });
  // sem base (Claude, API antiga): vale o que chegou por último, como sempre
  assert.equal((await db.atualizar(t.id, { notas: 'pelo Claude' }, 'x via Claude', T)).notas, 'pelo Claude');
});

test('etapas por operação: marcar etapas diferentes em paralelo nunca se atropela', async () => {
  const db = store.abrir({ stateDir: tmp() });
  const t = await db.criar({ titulo: 'Etapas em paralelo', dono: 'lucas', etapas: [{ texto: 'a' }, { texto: 'b' }, { texto: 'c' }] }, 'lucas', T);
  const [e1, e2, e3] = t.etapas.map((e) => e.id);
  await Promise.all([db.atualizar(t.id, { etapas_ops: [{ op: 'marcar', id: e1, feita: true }] }, 'lucas', T), db.atualizar(t.id, { etapas_ops: [{ op: 'marcar', id: e3, feita: true }] }, 'julien', T)]);
  let u = await db.obter(t.id);
  assert.deepEqual(u.etapas.map((e) => e.feita), [true, false, true]);
  u = await db.atualizar(t.id, { etapas_ops: [{ op: 'add', texto: 'nova depois da a', apos: e1 }, { op: 'texto', id: e2, texto: 'b revisada' }, { op: 'del', id: e3 }] }, 'lucas', T);
  assert.deepEqual(u.etapas.map((e) => e.texto), ['a', 'nova depois da a', 'b revisada']);
  u = await db.atualizar(t.id, { etapas_ops: [{ op: 'mover', id: e2, para: 0 }] }, 'lucas', T);
  assert.equal(u.etapas[0].texto, 'b revisada');
  u = await db.atualizar(t.id, { etapas_ops: [{ op: 'marcar', id: 'sumiu', feita: true }] }, 'lucas', T);
  assert.equal(u.etapas.length, 3, 'etapa apagada por outra pessoa não dá erro');
});

test('concluir e reabrir: as etapas voltam como estavam; resultado e arquivo seguem as regras', async () => {
  const db = store.abrir({ stateDir: tmp() });
  const t = await db.criar({ titulo: 'Concluir e voltar', dono: 'lucas', etapas: [{ texto: 'a', feita: true }, { texto: 'b' }] }, 'lucas', T);
  const d = await db.atualizar(t.id, { estado: 'done', resultado: 'feito' }, 'lucas', T);
  assert.ok(d.etapas.every((e) => e.feita)); assert.ok(d.concluido_em);
  const v = await db.atualizar(t.id, { estado: 'doing' }, 'lucas', T);
  assert.deepEqual(v.etapas.map((e) => e.feita), [true, false], 'voltar atrás desfaz o que o concluir marcou'); assert.equal(v.concluido_em, null);
  const w = await db.atualizar(t.id, { estado: 'wait', aguardando_quem: 'Hotel Lutetia', cobrar_em: '2026-12-01' }, 'lucas', T);
  assert.equal(w.aguardando_quem, 'Hotel Lutetia');
  const f = await db.atualizar(t.id, { estado: 'doing' }, 'lucas', T);
  assert.equal(f.cobrar_em, null, 'sair de Aguardando limpa a cobrança'); assert.equal(f.aguardando_quem, '');
});

test('datas impossíveis e etapas ruins são recusadas com mensagem legível', async () => {
  const db = store.abrir({ stateDir: tmp() });
  await assert.rejects(db.criar({ titulo: 'Data absurda', dono: 'lucas', vence_em: '2026-13-45' }, 'lucas', T), /Data inválida/);
  await assert.rejects(db.criar({ titulo: 'Fevereiro 30', dono: 'lucas', vence_em: '2026-02-30' }, 'lucas', T), /Data inválida/);
  await assert.rejects(db.criar({ titulo: 'Etapa nula', dono: 'lucas', etapas: [null] }, 'lucas', T), /Etapa inválida/);
  await assert.rejects(db.criar({ titulo: 'Cobrança ruim', dono: 'lucas', cobrar_em: 'amanhã' }, 'lucas', T), /cobrança/);
  await assert.rejects(db.criar({ titulo: 'Repetição ruim', dono: 'lucas', repete: 'às vezes' }, 'lucas', T), /Repetição/);
});

test('recorrência: concluir cria a próxima, uma vez só, sem marcar etapa nem copiar resultado', async () => {
  const db = store.abrir({ stateDir: tmp() });
  const t = await db.criar({ titulo: 'Rever a fila toda segunda', dono: 'lucas', vence_em: store.hoje(), repete: 'semanal', etapas: [{ texto: 'Ler a fila' }], notas: 'guia' }, 'lucas', T);
  const d = await db.atualizar(t.id, { estado: 'done', resultado: 'fila zerada' }, 'lucas', T);
  assert.ok(d.proxima_id);
  const n = await db.obter(d.proxima_id);
  assert.equal(n.estado, 'todo'); assert.equal(n.resultado, ''); assert.equal(n.etapas[0].feita, false); assert.equal(n.notas, 'guia'); assert.equal(n.repete, 'semanal');
  assert.equal(n.vence_em, store.nucleo.somarDias(store.hoje(), 7)); assert.deepEqual(n.origem, { tipo: 'recorrencia', ref: t.id });
  await db.atualizar(t.id, { estado: 'doing' }, 'lucas', T);
  await db.atualizar(t.id, { estado: 'done' }, 'lucas', T);
  assert.equal((await db.listar()).length, 2, 'reabrir e concluir de novo não duplica');
});

test('comentário: fica no card e no ledger, com menção; o histórico nunca perde', async () => {
  const dir = tmp();
  const db = store.abrir({ stateDir: dir });
  const t = await db.criar({ titulo: 'Card comentado', dono: 'lucas' }, 'lucas', T);
  await assert.rejects(db.comentar(t.id, '   ', 'lucas', T), /Escreva/);
  const c = await db.comentar(t.id, 'Falei com o concierge, @Julien confirma o carro', 'lucas', T);
  assert.equal(c.comentarios.length, 1); assert.equal(c.comentarios[0].quem, 'lucas');
  const ev = (await db.eventos(t.id)).at(-1);
  assert.equal(ev.tipo, 'comentario'); assert.deepEqual(ev.mencoes, ['julien']);
  const db2 = store.abrir({ stateDir: dir });
  assert.equal((await db2.obter(t.id)).comentarios[0].texto, c.comentarios[0].texto);
  assert.equal(await db.comentar('T-20000101-0001', 'nada', 'lucas', T), null);
});

test('quem está ouvindo recebe cada mudança com a sequência, em ordem', async () => {
  const db = store.abrir({ stateDir: tmp() });
  const visto = [];
  const sair = db.assinar((m) => visto.push(m));
  const t = await db.criar({ titulo: 'Ao vivo', dono: 'lucas', estado: 'todo' }, 'lucas', T);
  await db.atualizar(t.id, { estado: 'doing' }, 'julien', T);
  await db.excluir(t.id, 'julien', T, 'cancelado pelo hotel');
  sair();
  assert.deepEqual(visto.map((m) => m.tipo), ['criada', 'estado', 'excluida']);
  assert.ok(visto[0].seq < visto[1].seq && visto[1].seq < visto[2].seq);
  assert.equal(visto[1].tarefa.estado, 'doing'); assert.equal(visto[2].tarefa, null); assert.equal(await db.ultimoSeq(), visto[2].seq);
});

test('resumo: arquivar não apaga produtividade; no prazo, ciclo, cobrar e parados', () => {
  const dia = '2026-11-05';
  const r = store.resumo([
    { estado: 'done', dono: 'lucas', vence_em: '2026-11-04', criado_em: '2026-11-01T10:00:00Z', concluido_em: '2026-11-03T10:00:00Z', arquivada_em: '2026-11-04T10:00:00Z', etapas: [] },
    { estado: 'done', dono: 'lucas', vence_em: '2026-11-01', criado_em: '2026-10-30T10:00:00Z', concluido_em: '2026-11-04T10:00:00Z', etapas: [] },
    { estado: 'wait', dono: 'julien', vence_em: null, cobrar_em: dia, atualizado_em: '2026-10-20T10:00:00Z', etapas: [] },
    { estado: 'wait', dono: 'julien', vence_em: null, cobrar_em: '2026-12-01', atualizado_em: '2026-11-04T10:00:00Z', etapas: [] },
  ], dia);
  assert.equal(r.concluidas_7d, 2, 'a arquivada conta'); assert.equal(r.no_prazo_30d_pct, 50); assert.equal(r.ciclo_mediano_dias, 5);
  assert.equal(r.cobrar, 1); assert.equal(r.paradas_7d, 1); assert.equal(r.abertas, 2);
});
