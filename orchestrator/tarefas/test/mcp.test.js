'use strict';
/** Conector MCP ponta a ponta: metadados OAuth, registro, login, PKCE, token, refresh, ferramentas; e o histórico do chat. */
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'twk-tarefas-mcp-'));
process.env.STATE_DIR = dir;
process.env.NODE_ENV = 'development';
process.env.CENTER_TOKEN = 'chave-da-central-de-teste';
process.env.COMPROMISSOS_PATH = path.join(dir, 'nao-existe.jsonl');
process.env.CENTRAL_STATE_DIR = path.join(dir, 'central-vazia');
delete process.env.ANTHROPIC_API_KEY;
delete process.env.TAREFAS_DATABASE_URL;
delete process.env.TAREFAS_URL;
delete process.env.CENTER_URL;
const { server } = require('../server.js');

let base = '';
const REDIRECT = 'https://claude.ai/api/mcp/auth_callback';
let client_id = ''; let access = ''; let refresh = ''; let tarefaId = '';

async function pegar(rota, extra) { const r = await fetch(base + rota, { redirect: 'manual', ...(extra || {}) }); let j = null; try { j = await r.clone().json(); } catch { /* não é JSON */ } return { status: r.status, j, h: r.headers, texto: await r.text() }; }
async function form(rota, campos, extra) { return pegar(rota, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(campos).toString(), ...(extra || {}) }); }
async function rpc(msg, token) { const r = await fetch(base + '/mcp', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(msg) }); let j = null; try { j = await r.json(); } catch { /* 202 */ } return { status: r.status, j, h: r.headers }; }
const chamar = (name, args, token = access) => rpc({ jsonrpc: '2.0', id: Math.floor(Math.random() * 1e6), method: 'tools/call', params: { name, arguments: args } }, token);
function pkce() { const v = crypto.randomBytes(32).toString('base64url'); return { v, c: crypto.createHash('sha256').update(v).digest('base64url') }; }
async function autorizar(challenge, senha = 'twk', usuario = 'marlon') {
  return form('/oauth/authorize', { client_id, redirect_uri: REDIRECT, response_type: 'code', state: 'xyz', code_challenge: challenge, code_challenge_method: 'S256', scope: 'tarefas', usuario, senha });
}

test.before(async () => { await new Promise((ok) => server.listen(0, '127.0.0.1', ok)); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => server.close());

test('metadados OAuth e 401 com resource_metadata antes de qualquer token', async () => {
  const pr = await pegar('/.well-known/oauth-protected-resource');
  assert.equal(pr.status, 200); assert.equal(pr.j.resource, base + '/mcp'); assert.deepEqual(pr.j.authorization_servers, [base]);
  const as = await pegar('/.well-known/oauth-authorization-server/mcp');
  assert.equal(as.j.issuer, base); assert.equal(as.j.token_endpoint, base + '/oauth/token'); assert.deepEqual(as.j.code_challenge_methods_supported, ['S256']);
  const sem = await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
  assert.equal(sem.status, 401);
  assert.match(sem.h.get('www-authenticate'), /resource_metadata="http:\/\/127\.0\.0\.1:\d+\/\.well-known\/oauth-protected-resource"/);
  const h = await pegar('/health'); assert.equal(h.j.mcp.rota, '/mcp'); assert.ok(h.j.mcp.ferramentas >= 8);
});

test('registro dinâmico: https ou localhost; nunca http remoto', async () => {
  const ruim = await pegar('/oauth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ redirect_uris: ['http://evil.example/cb'], client_name: 'x' }) });
  assert.equal(ruim.status, 400); assert.equal(ruim.j.error, 'invalid_redirect_uri');
  const local = await pegar('/oauth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ redirect_uris: ['http://localhost:51234/callback'], client_name: 'Claude Code' }) });
  assert.equal(local.status, 201);
  const ok = await pegar('/oauth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ redirect_uris: [REDIRECT], client_name: 'Claude', token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'] }) });
  assert.equal(ok.status, 201); assert.match(ok.j.client_id, /^c_[0-9a-f]{32}$/); assert.equal(ok.j.token_endpoint_auth_method, 'none');
  client_id = ok.j.client_id;
  assert.ok(fs.existsSync(path.join(dir, 'oauth-clients.json')), 'clientes persistidos no volume');
});

test('tela de login: cliente desconhecido e redirect errado dão página de erro (nunca redirecionam)', async () => {
  const q = (o) => '/oauth/authorize?' + new URLSearchParams(o).toString();
  assert.equal((await pegar(q({ client_id: 'c_nao', redirect_uri: REDIRECT, response_type: 'code', code_challenge: 'a', code_challenge_method: 'S256' }))).status, 400);
  assert.equal((await pegar(q({ client_id, redirect_uri: 'https://outro.example/cb', response_type: 'code', code_challenge: 'a', code_challenge_method: 'S256' }))).status, 400);
  const semPkce = await pegar(q({ client_id, redirect_uri: REDIRECT, response_type: 'code', state: 's1' }));
  assert.equal(semPkce.status, 302); assert.match(semPkce.h.get('location'), /error=invalid_request/); assert.match(semPkce.h.get('location'), /state=s1/);
  const pag = await pegar(q({ client_id, redirect_uri: REDIRECT, response_type: 'code', state: 's1', code_challenge: 'abc', code_challenge_method: 'S256' }));
  assert.equal(pag.status, 200); assert.match(pag.texto, /Autorizar/); assert.match(pag.texto, /Claude/); assert.match(pag.texto, /name="senha"/);
});

test('senha errada = 401 na própria tela; certa = código no redirect_uri; PKCE errado queima o código', async () => {
  const p1 = pkce();
  const errada = await autorizar(p1.c, 'nada');
  assert.equal(errada.status, 401); assert.match(errada.texto, /não conferem/);
  const certa = await autorizar(p1.c);
  assert.equal(certa.status, 302);
  const loc = new URL(certa.h.get('location'));
  assert.equal(loc.origin + loc.pathname, REDIRECT); assert.equal(loc.searchParams.get('state'), 'xyz');
  const code = loc.searchParams.get('code'); assert.ok(code && code.length > 20);
  const mau = await form('/oauth/token', { grant_type: 'authorization_code', code, client_id, redirect_uri: REDIRECT, code_verifier: 'verificador-errado' });
  assert.equal(mau.status, 400); assert.equal(mau.j.error, 'invalid_grant');
  const denovo = await form('/oauth/token', { grant_type: 'authorization_code', code, client_id, redirect_uri: REDIRECT, code_verifier: p1.v });
  assert.equal(denovo.status, 400, 'código é de uso único, mesmo após falha');
});

test('troca do código por tokens, refresh, e o Claude age em nome de quem autorizou', async () => {
  const p = pkce();
  const code = new URL((await autorizar(p.c)).h.get('location')).searchParams.get('code');
  const tk = await form('/oauth/token', { grant_type: 'authorization_code', code, client_id, redirect_uri: REDIRECT, code_verifier: p.v });
  assert.equal(tk.status, 200); assert.equal(tk.j.token_type, 'Bearer'); assert.ok(tk.j.access_token && tk.j.refresh_token); assert.equal(tk.j.expires_in, 86400);
  access = tk.j.access_token; refresh = tk.j.refresh_token;
  const naoRefresh = await rpc({ jsonrpc: '2.0', id: 1, method: 'ping' }, refresh);
  assert.equal(naoRefresh.status, 401, 'refresh_token não serve como acesso');
  const rf = await form('/oauth/token', { grant_type: 'refresh_token', refresh_token: refresh, client_id });
  assert.equal(rf.status, 200); assert.ok(rf.j.access_token !== access);
  assert.equal((await form('/oauth/token', { grant_type: 'refresh_token', refresh_token: 'lixo' })).j.error, 'invalid_grant');
  assert.equal((await form('/oauth/token', { grant_type: 'password' })).j.error, 'unsupported_grant_type');
});

test('MCP: initialize, notificação 202, tools/list, GET 405', async () => {
  const init = await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'teste', version: '0' } } }, access);
  assert.equal(init.status, 200); assert.equal(init.j.result.protocolVersion, '2025-03-26'); assert.equal(init.j.result.serverInfo.name, 'compasso-tarefas'); assert.match(init.j.result.instructions, /Márlon, Lucas e Julien/);
  const desconhecida = await rpc({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '1999-01-01' } }, access);
  assert.equal(desconhecida.j.result.protocolVersion, '2025-06-18');
  assert.equal((await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' }, access)).status, 202);
  const lista = await rpc({ jsonrpc: '2.0', id: 3, method: 'tools/list' }, access);
  const nomes = lista.j.result.tools.map((t) => t.name);
  for (const n of ['resumo', 'listar_tarefas', 'ver_tarefa', 'criar_tarefa', 'atualizar_tarefa', 'planejar', 'sugestoes', 'assumir_sugestao']) assert.ok(nomes.includes(n), n);
  assert.deepEqual(lista.j.result.tools.find((t) => t.name === 'criar_tarefa').inputSchema.required, ['titulo', 'dono', 'etapas']);
  assert.equal((await rpc({ jsonrpc: '2.0', id: 4, method: 'nada/aqui' }, access)).j.error.code, -32601);
  const get = await fetch(base + '/mcp', { headers: { authorization: `Bearer ${access}` } }); assert.equal(get.status, 405);
});

test('criar_tarefa exige dono; cria com etapas; listar, ver, atualizar; o livro registra "via Claude" e origem mcp', async () => {
  const semDono = await chamar('criar_tarefa', { titulo: 'Ligar para o Monak', etapas: ['Ligar'] });
  assert.equal(semDono.j.result.isError, true); assert.match(semDono.j.result.content[0].text, /Márlon, Lucas ou Julien/);
  const ok = await chamar('criar_tarefa', { titulo: 'Confirmar os 4 hotéis de Paris para o chauffeur', dono: 'julien', area: 'Chauffeur', etapas: ['Listar os pedidos abertos', 'Ligar para cada hotel', 'Registrar a resposta no card'], notas: 'pedido do CEO' });
  assert.equal(ok.j.result.isError, undefined); assert.match(ok.j.result.content[0].text, /^Criado T-\d{8}-\d{4} em "A fazer" para Julien, com 3 etapas/);
  tarefaId = ok.j.result.structuredContent.id;
  assert.equal(ok.j.result.structuredContent.vence_em, null, 'sem prazo no pedido, sem prazo no card');
  const lista = await chamar('listar_tarefas', { dono: 'julien' });
  assert.match(lista.j.result.content[0].text, new RegExp(tarefaId));
  const upd = await chamar('atualizar_tarefa', { id: tarefaId, etapas_feitas: [1, 2], estado: 'doing' });
  assert.deepEqual(upd.j.result.structuredContent.etapas.map((e) => e.feita), [true, true, false]); assert.equal(upd.j.result.structuredContent.estado, 'doing');
  assert.equal((await chamar('atualizar_tarefa', { id: tarefaId, etapas_feitas: [9] })).j.result.isError, true);
  assert.equal((await chamar('ver_tarefa', { id: 'T-20000101-0001' })).j.result.isError, true);
  const ver = await chamar('ver_tarefa', { id: tarefaId });
  assert.match(ver.j.result.content[0].text, /criada \(marlon via Claude\)/);
  const resumo = await chamar('resumo', {});
  assert.match(resumo.j.result.content[0].text, /Julien: 1 abertas/);
  // pela API do app, a tarefa existe, com origem mcp e autor "via Claude"
  const login = await fetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-requested-with': 'fetch' }, body: JSON.stringify({ usuario: 'marlon', senha: 'twk' }) });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const t = (await (await fetch(base + '/api/tarefas', { headers: { cookie } })).json()).tarefas.find((x) => x.id === tarefaId);
  assert.equal(t.origem.tipo, 'mcp'); assert.equal(t.criado_por, 'marlon via Claude');
  const ev = (await (await fetch(base + `/api/tarefas/${tarefaId}/eventos`, { headers: { cookie } })).json()).eventos;
  assert.ok(ev.every((e) => e.quem === 'marlon via Claude'));
});

test('planejar pelo MCP não grava card, mas entra no histórico; sugestões respondem sem fontes', async () => {
  const p = await chamar('planejar', { texto: 'Responder os hotéis da Riviera até sexta, Lucas cuida' });
  assert.match(p.j.result.content[0].text, /Proposta \(não gravada\)/); assert.match(p.j.result.content[0].text, /Quem: Lucas/);
  const s = await chamar('sugestoes', {});
  assert.equal(s.j.result.isError, undefined); assert.ok(Array.isArray(s.j.result.structuredContent.itens));
  assert.equal((await chamar('assumir_sugestao', { id: 's-000000000000', dono: 'lucas' })).j.result.isError, true);
});

test('histórico do chat: mensagem, proposta e card ligados; cada pessoa vê o seu; admin vê tudo', async () => {
  const sess = async (usuario) => { const l = await fetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-requested-with': 'fetch' }, body: JSON.stringify({ usuario, senha: 'twk' }) }); return l.headers.get('set-cookie').split(';')[0]; };
  const cm = await sess('marlon');
  const api = (c, m, rota, corpo) => fetch(base + rota, { method: m, headers: { 'content-type': 'application/json', 'x-requested-with': 'fetch', cookie: c }, body: corpo ? JSON.stringify(corpo) : undefined }).then((r) => r.json());
  const prop = await api(cm, 'POST', '/api/planejar', { texto: 'Fechar o cardápio da Soirée com o Monak até amanhã' });
  assert.match(prop.conversa_id, /^c-[0-9a-f]{12}$/);
  const criado = await api(cm, 'POST', '/api/tarefas', { titulo: prop.proposta.titulo, dono: 'marlon', etapas: prop.proposta.etapas.map((e) => ({ texto: e })), origem: { tipo: 'chat', ref: prop.conversa_id } });
  const hist = (await api(cm, 'GET', '/api/chat')).mensagens;
  const minhas = hist.filter((m) => m.canal === 'app');
  assert.equal(minhas.at(-3).papel, 'pessoa'); assert.match(minhas.at(-3).texto, /Soirée/);
  assert.equal(minhas.at(-2).id, prop.conversa_id); assert.equal(minhas.at(-2).proposta.titulo, prop.proposta.titulo);
  assert.equal(minhas.at(-1).tarefa_id, criado.tarefa.id); assert.equal(minhas.at(-1).proposta_ref, prop.conversa_id);
  assert.ok(hist.some((m) => m.canal === 'mcp' && m.papel === 'pessoa' && /Riviera/.test(m.texto)), 'o que o Claude pediu pelo MCP em nome de Márlon aparece na conversa dele');
  assert.ok(hist.some((m) => m.canal === 'mcp' && m.tarefa_id === tarefaId), 'card criado pelo Claude aparece no histórico');
  const cl = await sess('lucas');
  assert.equal((await api(cl, 'GET', '/api/chat')).mensagens.length, 0, 'Lucas não vê a conversa de Márlon');
  assert.ok(fs.readFileSync(path.join(dir, 'conversas.jsonl'), 'utf8').split('\n').filter(Boolean).length >= 6);
});
