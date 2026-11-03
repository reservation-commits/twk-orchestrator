'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const sugestoes = require('../sugestoes.js');

const CHAVE = 'chave-da-central-de-teste';
const ontem = new Date(Date.now() - 864e5).toISOString().slice(0, 10);

// Uma Central de mentira: mesmas rotas, mesmo cabeçalho X-Center-Key, mesmos campos de resposta.
function centralFalsa(filas, { semCompromissos = false } = {}) {
  const srv = http.createServer((req, res) => {
    const envia = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    if ((req.headers['x-center-key'] || '') !== CHAVE) return envia(401, { error: 'nao autorizado' });
    if (req.url === '/api/actions') return envia(200, { acoes: filas.acoes || [] });
    if (req.url === '/api/approvals') return envia(200, { aprovacoes: filas.aprovacoes || [] });
    if (req.url === '/api/perguntas') return envia(200, { items: filas.perguntas || [] });
    if (req.url === '/api/compromissos' && !semCompromissos) return envia(200, { items: filas.compromissos || [] });
    envia(404, { error: 'rota desconhecida' });
  });
  return new Promise((ok) => srv.listen(0, '127.0.0.1', () => ok({ url: `http://127.0.0.1:${srv.address().port}/`, fechar: () => srv.close() })));
}
const vazio = () => fs.mkdtempSync(path.join(os.tmpdir(), 'twk-sug-'));

test('com CENTER_URL as quatro filas vêm da API da Central e a cobertura diz "api"', async () => {
  const c = await centralFalsa({
    acoes: [{ id: 'A1', status: 'aberta', severidade: 'critica', agente: 'suporte', titulo: 'Aria sem responder', criado_em: '2026-09-13T09:00:00Z', detalhe: 'x' }, { id: 'A2', status: 'resolvida', severidade: 'critica' }],
    aprovacoes: [{ id: 'P1', status: 'pendente' }, { id: 'P2', status: 'negada' }],
    perguntas: [{ id: 'Q1', status: 'aberta', criado_em: '2026-10-01T10:00:00Z' }],
    compromissos: [{ id: 'C-1', status: 'aberto', vence_em: ontem, tipo: 'cliente', o_que: 'Voltar ao cliente com alternativas. Detalhe', dono: 'Aria' }, { id: 'C-2', status: 'fechado', vence_em: ontem, o_que: 'y', dono: 'z' }],
  });
  try {
    const ctx = { centerUrl: c.url, centerToken: CHAVE, centralStateDir: vazio(), compromissosPath: path.join(vazio(), 'nao-existe.jsonl') };
    const g = await sugestoes.gerar(ctx, []);
    const cob = Object.fromEntries(g.cobertura.map((x) => [x.fonte, x]));
    assert.equal(cob.compromissos.ok, true); assert.equal(cob.compromissos.origem, 'api');
    assert.equal(cob.acoes.ok, true); assert.equal(cob.acoes.origem, 'api');
    assert.equal(cob.central.ok, true); assert.equal(cob.central.origem, 'api'); assert.equal(cob.central.lacuna, null);
    const chaves = g.itens.map((s) => s.chave);
    assert.ok(chaves.includes('compromisso:C-1')); assert.ok(!chaves.includes('compromisso:C-2'));
    assert.ok(chaves.includes('acao:A1')); assert.ok(!chaves.includes('acao:A2'));
    assert.ok(chaves.includes('central:perguntas')); assert.ok(chaves.includes('central:aprovacoes'));
    const comp = g.itens.find((s) => s.chave === 'compromisso:C-1');
    assert.equal(comp.titulo, 'Voltar ao cliente com alternativas');
    assert.equal(comp.prioridade_fixa, true);
    assert.equal(comp.fonte, 'compromissos.jsonl (Central)');
    assert.equal(g.itens.find((s) => s.chave === 'central:perguntas').titulo, 'Responder a pergunta aberta na Central');
    assert.equal(g.itens[0].prioridade_fixa, true, 'prioridade fixa vem primeiro');
  } finally { c.fechar(); }
});

test('chave errada = lacuna explícita, nunca "ok" silencioso; sem arquivo no disco, zero sugestões da fonte', async () => {
  const c = await centralFalsa({ acoes: [{ id: 'A1', status: 'aberta', severidade: 'critica' }] });
  try {
    const r = await sugestoes.deAcoes({ centerUrl: c.url, centerToken: 'errada', centralStateDir: vazio() });
    assert.equal(r.ok, false);
    assert.match(r.lacuna, /401/);
    assert.deepEqual(r.itens, []);
  } finally { c.fechar(); }
});

test('Central antiga sem /api/compromissos: a lacuna diz isso e o disco serve de reserva quando existe', async () => {
  const c = await centralFalsa({}, { semCompromissos: true });
  try {
    const semArquivo = await sugestoes.deCompromissos({ centerUrl: c.url, centerToken: CHAVE, compromissosPath: path.join(vazio(), 'x.jsonl') });
    assert.equal(semArquivo.ok, false);
    assert.match(semArquivo.lacuna, /ainda não serve \/api\/compromissos/);
    const dir = vazio();
    const f = path.join(dir, 'compromissos.jsonl');
    fs.writeFileSync(f, JSON.stringify({ id: 'C-9', status: 'aberto', vence_em: ontem, tipo: 'produto', o_que: 'Publicar a aba de serviços', dono: 'Lucas' }) + '\n');
    const comArquivo = await sugestoes.deCompromissos({ centerUrl: c.url, centerToken: CHAVE, compromissosPath: f });
    assert.equal(comArquivo.ok, true);
    assert.equal(comArquivo.origem, 'arquivo');
    assert.equal(comArquivo.itens[0].fonte, 'compromissos.jsonl');
    assert.equal(comArquivo.itens[0].area, 'Site');
  } finally { c.fechar(); }
});

test('sem CENTER_URL lê só do disco; Central fora do ar vira lacuna com motivo e não derruba as outras fontes', async () => {
  const dir = vazio();
  fs.writeFileSync(path.join(dir, 'perguntas.jsonl'), JSON.stringify({ id: 'Q1', status: 'aberta', criado_em: '2026-10-20T08:00:00Z' }) + '\n');
  const soDisco = await sugestoes.dePerguntasEAprovacoes({ centralStateDir: dir });
  assert.equal(soDisco.ok, true);
  assert.equal(soDisco.origem, 'arquivo');
  assert.equal(soDisco.perguntas, 1);
  assert.match(soDisco.lacuna, /arquivo ausente/, 'aprovações sem arquivo = parcial declarado');
  const fora = await sugestoes.gerar({ centerUrl: 'http://127.0.0.1:1/', centerToken: CHAVE, centralStateDir: dir, compromissosPath: path.join(dir, 'nao.jsonl'), timeoutMs: 1500 }, []);
  const cob = Object.fromEntries(fora.cobertura.map((x) => [x.fonte, x]));
  assert.equal(cob.compromissos.ok, false);
  assert.ok(cob.compromissos.lacuna, 'lacuna preenchida');
  assert.equal(cob.central.ok, true, 'perguntas do disco seguem valendo quando a API cai');
  assert.equal(cob.central.origem, 'arquivo');
});
