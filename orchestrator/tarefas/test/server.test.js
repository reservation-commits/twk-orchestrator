'use strict';
/** Fumaça ponta a ponta do servidor em modo desenvolvimento, com estado temporário e sem modelo. */
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'twk-tarefas-srv-'));
process.env.STATE_DIR = dir;
process.env.NODE_ENV = 'development';
process.env.TAREFAS_SEM_BANCO = '1'; // nenhum teste toca no banco real
process.env.CENTER_TOKEN = 'chave-da-central-de-teste';
process.env.COMPROMISSOS_PATH = path.join(dir, 'nao-existe.jsonl');
process.env.CENTRAL_STATE_DIR = path.join(dir, 'central-vazia');
delete process.env.ANTHROPIC_API_KEY;
delete process.env.TAREFAS_DATABASE_URL;
const { server } = require('../server.js');

let base = ''; let cookie = '';
async function call(metodo, rota, corpo, extra) {
  const r = await fetch(base + rota, { method: metodo, headers: { 'content-type': 'application/json', 'x-requested-with': 'fetch', cookie, ...(extra || {}) }, body: corpo ? JSON.stringify(corpo) : undefined });
  const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
  let j = null; try { j = await r.json(); } catch { /* vazio */ }
  return { status: r.status, j };
}

test.before(async () => { await new Promise((ok) => server.listen(0, '127.0.0.1', ok)); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => server.close());

test('health aberto; API fechada sem sessão; relato com chave da Central', async () => {
  const anon = await call('GET', '/health'); assert.equal(anon.status, 200); assert.equal(anon.j.operacional, true);
  assert.equal(anon.j.durabilidade, undefined, 'sem login, /health não expõe caminhos nem contagens');
  // durabilidade: com a chave (ou sessão) o /health diz onde o estado vive, se é volume e quanto há no livro; a cópia diária existe
  const h = await call('GET', '/health', null, { 'x-center-key': 'chave-da-central-de-teste' });
  assert.equal(h.j.durabilidade.state_dir, dir); assert.equal(h.j.durabilidade.motor, 'arquivo'); assert.equal(typeof h.j.durabilidade.tarefas, 'number');
  assert.ok(fs.existsSync(path.join(dir, 'estado-desde.txt')), 'marca de primeira escrita gravada');
  const { copiaDeSeguranca } = require('../server.js');
  const c = copiaDeSeguranca(); assert.ok(c && c.dia); assert.ok(fs.existsSync(path.join(dir, 'backups', c.dia)));
  assert.equal((await call('GET', '/api/tarefas')).status, 401);
  assert.equal((await call('GET', '/api/relato')).status, 401);
  const r = await call('GET', '/api/relato', null, { 'x-center-key': 'chave-da-central-de-teste' });
  assert.equal(r.status, 200); assert.equal(r.j.agente, 'planejador'); assert.equal(typeof r.j.kpis.tarefas_abertas, 'number');
});

test('login, criação, atualização, eventos, exclusão, auditoria', async () => {
  assert.equal((await call('POST', '/api/login', { usuario: 'marlon', senha: 'errada' })).status, 401);
  const l = await call('POST', '/api/login', { usuario: 'marlon', senha: 'twk' }); assert.equal(l.status, 200); assert.ok(cookie.startsWith('twk_tarefas='));
  const eu = await call('GET', '/api/eu'); assert.equal(eu.j.usuario.id, 'marlon'); assert.equal(eu.j.pessoas.length, 3);

  // mutação sem o cabeçalho de origem é recusada
  const semHeader = await fetch(base + '/api/tarefas', { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: '{}' });
  assert.equal(semHeader.status, 403);

  assert.equal((await call('POST', '/api/tarefas', { titulo: 'x' })).status, 400);
  const c = await call('POST', '/api/tarefas', { titulo: 'Confirmar os 4 jantares com motorista', dono: 'julien', area: 'Chauffeur', vence_em: '2026-11-05', etapas: [{ texto: 'Conferir horários' }] });
  assert.equal(c.status, 201); const id = c.j.tarefa.id; assert.equal(c.j.tarefa.criado_por, 'marlon');
  const semDono = await call('POST', '/api/tarefas', { titulo: 'Tarefa sem dono explícito' }); assert.equal(semDono.j.tarefa.dono, 'marlon', 'sem dono = quem escreveu');

  const u = await call('PATCH', `/api/tarefas/${id}`, { estado: 'doing', etapas: [{ texto: 'Conferir horários', feita: true }, { texto: 'Responder', feita: false }] });
  assert.equal(u.status, 200); assert.equal(u.j.tarefa.estado, 'doing');
  assert.equal((await call('PATCH', `/api/tarefas/${id}`, { estado: 'inventado' })).status, 400);
  assert.equal((await call('PATCH', '/api/tarefas/T-20000101-0001', { estado: 'done' })).status, 404);

  const lista = await call('GET', '/api/tarefas'); assert.equal(lista.j.tarefas.length, 2); assert.equal(lista.j.resumo.abertas, 2);
  const ev = await call('GET', `/api/tarefas/${id}/eventos`); assert.deepEqual(ev.j.eventos.map((e) => e.tipo), ['criada', 'estado']);
  assert.equal((await call('DELETE', `/api/tarefas/${id}`)).status, 400, 'excluir sem motivo não passa');
  assert.equal((await call('DELETE', `/api/tarefas/${id}`, { motivo: 'pedido cancelado pelo hotel' })).status, 200);
  assert.equal((await call('DELETE', `/api/tarefas/${id}`, { motivo: 'pedido cancelado pelo hotel' })).status, 404);
  // concluída: não se exclui, arquiva-se; o arquivo é consultável e some do quadro
  const feita = (await call('POST', '/api/tarefas', { titulo: 'Confirmar a mesa do Monak', dono: 'lucas', estado: 'done', referencia: 'reserva QWER1234', cidade: 'Paris', resultado: 'mesa confirmada para 4' })).j.tarefa;
  assert.equal((await call('DELETE', `/api/tarefas/${feita.id}`, { motivo: 'não quero mais ver' })).status, 400);
  const arq = await call('POST', `/api/tarefas/${feita.id}/arquivar`, {}); assert.equal(arq.status, 200); assert.ok(arq.j.tarefa.arquivada_em);
  const quadro = await call('GET', '/api/tarefas'); assert.ok(!quadro.j.tarefas.some((t) => t.id === feita.id)); assert.equal(quadro.j.arquivadas, 1);
  const busca = await call('GET', '/api/arquivo?q=qwer'); assert.equal(busca.j.total, 1); assert.equal(busca.j.tarefas[0].id, feita.id);
  assert.equal((await call('GET', '/api/arquivo?q=inexistente')).j.total, 0);
  assert.equal((await call('POST', `/api/tarefas/${feita.id}/desarquivar`, {})).j.tarefa.arquivada_em, null);
  const rel = await call('GET', '/api/relato', null, { 'x-center-key': 'chave-da-central-de-teste' }); assert.equal(typeof rel.j.kpis.tarefas_arquivadas, 'number');
  const euDepois = await call('GET', '/api/eu'); assert.deepEqual(euDepois.j.prioridades, ['alta', 'normal', 'baixa']); assert.ok(euDepois.j.canais.includes('WhatsApp'));

  const audit = fs.readFileSync(path.join(dir, 'logs', `audit-${require('../store.js').hoje()}.jsonl`), 'utf8'); // o dia é o de Paris, não o de UTC
  assert.match(audit, /"tipo":"login"/); assert.match(audit, /"tipo":"tarefa_criada"/); assert.match(audit, /"tipo":"tarefa_excluida"/);
});

test('planejar sem modelo devolve proposta da heurística; sugestões sem fontes devolvem lista vazia e lacunas', async () => {
  const p = await call('POST', '/api/planejar', { texto: 'Responder os 4 hotéis de Paris que pediram chauffeur até sexta, Julien cuida' });
  assert.equal(p.status, 200); assert.equal(p.j.proposta.dono, 'julien'); assert.equal(p.j.proposta.area, 'Chauffeur'); assert.ok(p.j.proposta.etapas.length >= 2);
  assert.equal((await call('POST', '/api/planejar', { texto: 'oi' })).status, 400);
  const s = await call('GET', '/api/sugestoes?atualizar=1');
  assert.equal(s.status, 200); assert.ok(Array.isArray(s.j.itens)); assert.ok(s.j.cobertura.some((c) => c.fonte === 'compromissos' && c.ok === false));
  assert.equal((await call('POST', '/api/sugestoes/s-000000000000/assumir', { dono: 'lucas' })).status, 404);
});

test('sugestão de compromisso vencido vira tarefa ao assumir', async () => {
  const f = path.join(dir, 'compromissos.jsonl');
  fs.writeFileSync(f, JSON.stringify({ id: 'CMP-TESTE', status: 'aberto', vence_em: '2026-09-21', dono: 'MAESTRO', tipo: 'carta_cliente', o_que: 'Escrever à cliente da reserva XPTO. Sem resposta anterior.' }) + '\n');
  process.env.COMPROMISSOS_PATH = f;
  const s = await call('GET', '/api/sugestoes?atualizar=1');
  const item = s.j.itens.find((x) => x.chave === 'compromisso:CMP-TESTE');
  assert.ok(item, 'sugestão nasce do compromisso vencido'); assert.equal(item.prioridade_fixa, true); assert.equal(item.area, 'Clientes');
  const a = await call('POST', `/api/sugestoes/${item.id}/assumir`, { dono: 'lucas' });
  assert.equal(a.status, 201); assert.equal(a.j.tarefa.dono, 'lucas'); assert.equal(a.j.tarefa.origem.tipo, 'sugestao'); assert.match(a.j.tarefa.notas, /Fonte: compromissos/);
  const depois = await call('GET', '/api/sugestoes?atualizar=1');
  assert.ok(!depois.j.itens.some((x) => x.id === item.id), 'assumida não volta'); assert.equal(depois.j.decididas, 1);
  const rel = await call('GET', '/api/relato'); assert.equal(rel.j.kpis.lucas_abertas, 1);
});
