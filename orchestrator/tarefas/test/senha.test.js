'use strict';
/** Um login por pessoa: senha provisória, troca obrigatória, revogação das sessões antigas, "esqueci a senha" e o script. */
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const authMod = require('../auth.js');
const { montar } = require('../logins.cjs');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'twk-senha-'));
const SEGREDO = 'segredo-de-teste-com-mais-de-32-caracteres';
const PROVISORIA = 'abcd-efgh-jkmn-pqrs';
const ADMIN = 'senha-do-admin-longa';
const usuarios = (julienHash) => JSON.stringify([{ id: 'admin', nome: 'Admin', senha: authMod.hashSenha(ADMIN) }, { id: 'julien', nome: 'Julien', senha: julienHash || authMod.hashSenha(PROVISORIA), trocar: true }]);
const req = (token) => ({ headers: { cookie: `twk_tarefas=${encodeURIComponent(token)}` } });

function comUsuarios(valor, fn) {
  const antes = process.env.TAREFAS_USUARIOS;
  process.env.TAREFAS_USUARIOS = valor;
  try { return fn(); } finally { if (antes === undefined) delete process.env.TAREFAS_USUARIOS; else process.env.TAREFAS_USUARIOS = antes; }
}

test('senha provisória: entra, mas precisa trocar; a troca encerra a sessão antiga e vale depois de reiniciar', async () => {
  const dir = tmp();
  const valor = usuarios();
  const a = comUsuarios(valor, () => authMod.criar({ stateDir: dir, isProd: true, segredo: SEGREDO }));
  const s1 = await a.entrarAsync('julien', PROVISORIA);
  assert.equal(s1.usuario.trocar, true);
  assert.equal(a.sessaoDe(req(s1.token)).trocar, true);
  assert.equal((await a.entrarAsync('admin', ADMIN)).usuario.trocar, false, 'admin sem marca de provisória');

  assert.equal((await a.trocarSenha('julien', 'errada', 'uma frase bem longa')).senha_atual, true);
  assert.match((await a.trocarSenha('julien', PROVISORIA, 'curta')).erro, /10 caracteres/);
  assert.match((await a.trocarSenha('julien', PROVISORIA, 'julien-123456')).erro, /nome de usuário/);
  assert.match((await a.trocarSenha('julien', PROVISORIA, PROVISORIA)).erro, /diferente/);
  assert.match((await a.trocarSenha('julien', PROVISORIA, 'aaaaaaaaaaaa')).erro, /fácil/);
  const conector = a.token({ t: 'acesso', sub: 'julien', nome: 'Julien' }, 1);
  assert.ok(a.abrir(conector), 'token do conector carrega a marca da senha');

  const nova = 'jantar no monak às 8';
  const s2 = await a.trocarSenha('julien', PROVISORIA, nova);
  assert.ok(s2.token); assert.equal(s2.usuario.trocar, false);
  assert.equal(a.sessaoDe(req(s1.token)), null, 'a sessão da senha provisória acabou');
  assert.equal(a.abrir(conector), null, 'o Claude conectado com a senha anterior é desconectado');
  assert.equal(a.sessaoDe(req(s2.token)).trocar, false);
  assert.equal(await a.entrarAsync('julien', PROVISORIA), null, 'a provisória não vale mais');
  assert.ok(fs.readFileSync(path.join(dir, 'senhas.json'), 'utf8').includes('scrypt:'), 'só o hash vai para o volume');
  assert.ok(!fs.readFileSync(path.join(dir, 'senhas.json'), 'utf8').includes(nova), 'a senha nunca é gravada');

  const b = comUsuarios(valor, () => authMod.criar({ stateDir: dir, isProd: true, segredo: SEGREDO }));
  assert.equal((await b.entrarAsync('julien', nova)).usuario.trocar, false, 'depois de reiniciar, vale a senha escolhida');
  assert.ok(b.sessaoDe(req(s2.token)), 'e a sessão dela continua');
});

test('esqueci a senha: provisória nova na variável derruba a escolhida e pede a troca de novo', async () => {
  const dir = tmp();
  const a = comUsuarios(usuarios(), () => authMod.criar({ stateDir: dir, isProd: true, segredo: SEGREDO }));
  const s = await a.trocarSenha('julien', PROVISORIA, 'uma senha minha boa');
  const outra = 'zzzz-yyyy-xxxx-wwww';
  const b = comUsuarios(usuarios(authMod.hashSenha(outra)), () => authMod.criar({ stateDir: dir, isProd: true, segredo: SEGREDO }));
  assert.equal(await b.entrarAsync('julien', 'uma senha minha boa'), null);
  assert.equal((await b.entrarAsync('julien', outra)).usuario.trocar, true);
  assert.equal(b.sessaoDe(req(s.token)), null, 'sessão da senha esquecida não vale mais');
});

test('sessão e conector de antes desta versão (sem marca) seguem válidos até vencer', () => {
  const a = comUsuarios(usuarios(), () => authMod.criar({ stateDir: tmp(), isProd: true, segredo: SEGREDO }));
  const assinar = (pl) => { const c = Buffer.from(JSON.stringify(pl)).toString('base64url'); return `${c}.${crypto.createHmac('sha256', SEGREDO).update(c).digest('base64url')}`; };
  assert.ok(a.sessaoDe(req(assinar({ id: 'admin', nome: 'Admin', exp: Date.now() + 864e5 }))), 'o fundador não é deslogado pelo deploy');
  assert.ok(a.abrir(assinar({ t: 'refresh', sub: 'admin', nome: 'Admin', exp: Date.now() + 864e5 })), 'nem o Claude dele');
});

test('script de logins: mantém o admin, gera provisórias que conferem, recusa valor estragado', () => {
  const adminLinha = { id: 'admin', nome: 'Admin', senha: authMod.hashSenha(ADMIN) };
  let n = 0;
  const { lista, provisorias } = montar(JSON.stringify([adminLinha]), ['marlon', 'lucas', 'julien'], () => `prov-${++n}-senha-x`);
  assert.deepEqual(lista.map((u) => u.id), ['admin', 'marlon', 'lucas', 'julien']);
  assert.deepEqual(lista[0], adminLinha, 'o admin sai idêntico');
  for (const u of lista.slice(1)) { assert.equal(u.trocar, true); assert.match(u.senha, authMod.FORMATO_HASH); assert.ok(authMod.conferirSenha(provisorias[u.id], u.senha)); }
  assert.ok(!JSON.stringify(lista).includes('$'), 'sem cifrão: o EasyPanel engole');
  const de = montar(JSON.stringify(lista), ['lucas'], () => 'outra-provisoria-1');
  assert.deepEqual(de.lista.find((u) => u.id === 'marlon'), lista.find((u) => u.id === 'marlon'), 'quem não foi escolhido fica igual');
  assert.ok(authMod.conferirSenha('outra-provisoria-1', de.lista.find((u) => u.id === 'lucas').senha));
  assert.throws(() => montar('[{"id":"admin"', []), /JSON válido/);
  assert.throws(() => montar('[{"id":"fulano","senha":"x"}]', []), /desconhecido/);
  assert.throws(() => montar('[{"id":"admin","senha":"scrypt:abc"}]', []), /formato/);
  assert.throws(() => montar('', ['admin']), /Márlon, Lucas e Julien/);
  const s = require('../logins.cjs').senhaProvisoria();
  assert.match(s, /^[a-z2-9]{4}(-[a-z2-9]{4}){3}$/); assert.ok(!/[01ilo]/.test(s), 'sem letras que se confundem');
  assert.equal(authMod.problemaNaSenha(s, { id: 'julien' }), null, 'a provisória passa nas próprias regras');
});

test('script: lê o Ambiente inteiro copiado, troca só a linha certa e devolve o resto byte a byte', () => {
  const { lerFonte, escreverFonte, jsonAscii } = require('../logins.cjs');
  const adminLinha = { id: 'admin', nome: 'Admin', senha: authMod.hashSenha(ADMIN) };
  const ambiente = ['NODE_ENV=production', 'TAREFAS_SECRET=um-segredo-com-é-e-$$', `TAREFAS_USUARIOS=${JSON.stringify([adminLinha])}`, 'CENTER_URL=https://exemplo', ''].join('\r\n');
  const f = lerFonte(ambiente);
  assert.equal(f.modo, 'ambiente'); assert.equal(f.eol, '\r\n');
  const { lista } = montar(f.valor, ['marlon', 'lucas', 'julien'], () => 'provisoria-de-teste');
  const saida = escreverFonte(f, lista);
  const linhas = saida.split('\r\n');
  assert.deepEqual([linhas[0], linhas[1], linhas[3], linhas[4]], ['NODE_ENV=production', 'TAREFAS_SECRET=um-segredo-com-é-e-$$', 'CENTER_URL=https://exemplo', ''], 'as outras linhas saem idênticas, inclusive acento e cifrão');
  assert.ok(/^TAREFAS_USUARIOS=\[/.test(linhas[2]) && /^[\x20-\x7e]+$/.test(linhas[2]), 'a linha nova é só ASCII: nenhuma cópia estraga o "á" de Márlon');
  assert.equal(JSON.parse(lerFonte(saida).valor)[1].nome, 'Márlon');
  assert.equal(jsonAscii({ n: 'Márlon' }), '{"n":"M\\u00e1rlon"}');
  // Só a linha, só o valor, com aspas, com quebra de linha no meio do hash (cópia de terminal cortada)
  assert.equal(lerFonte(`TAREFAS_USUARIOS=${JSON.stringify([adminLinha])}`).modo, 'linha');
  assert.equal(lerFonte(JSON.stringify([adminLinha])).modo, 'linha');
  assert.equal(lerFonte(`TAREFAS_USUARIOS='${JSON.stringify([adminLinha])}'`).aspas, "'");
  const quebrado = JSON.stringify([adminLinha]).replace(/(scrypt:[0-9a-f]{10})/, '$1\n');
  assert.equal(montar(lerFonte(quebrado).valor, []).lista[0].senha, adminLinha.senha, 'quebra de linha no meio do hash é consertada');
  // Ambiente sem a linha: ela é acrescentada antes da última linha vazia
  const semLinha = lerFonte('NODE_ENV=production\nTAREFAS_SECRET=x\n');
  assert.equal(semLinha.i, -1); assert.match(escreverFonte(semLinha, lista), /^NODE_ENV=production\nTAREFAS_SECRET=x\nTAREFAS_USUARIOS=\[.*\]\n$/s);
  assert.throws(() => lerFonte(''), /Não há nada copiado/);
  assert.throws(() => lerFonte('um texto qualquer que copiei antes'), /não é o Ambiente/);
});

test('servidor: cópia com quebra de linha ou espaço no hash ainda vale; login estragado não some em silêncio', () => {
  const h = authMod.hashSenha('uma-senha-qualquer-1');
  const valor = `'[{"id":"admin","senha":"${h.slice(0, 20)}\n${h.slice(20)}"},{"id":"lucas","senha":"${h.slice(0, 30)} ${h.slice(30)}"},{"id":"julien","senha":"scrypt:cortado"},{"id":"fulano","senha":"${h}"}]'`;
  const a = comUsuarios(valor, () => authMod.criar({ stateDir: tmp(), isProd: true, segredo: SEGREDO }));
  assert.deepEqual(a.usuarios.map((u) => u.id), ['admin', 'lucas'], 'quebra de linha e espaço no meio do hash são consertados');
  assert.deepEqual(a.ignorados.map((x) => x.id), ['julien', 'fulano']);
  assert.match(a.ignorados[0].motivo, /formato/);
  assert.ok(a.entrar('lucas', 'uma-senha-qualquer-1'));
});

test('login repetido na variável é recusado com mensagem clara', () => {
  const h = authMod.hashSenha('qualquer-coisa-12');
  assert.throws(() => comUsuarios(JSON.stringify([{ id: 'lucas', senha: h }, { id: 'lucas', senha: h }]), () => authMod.criar({ stateDir: tmp(), isProd: true, segredo: SEGREDO })), /mais de uma vez: lucas/);
});

// ---------------------------------------------------------------- de ponta a ponta, pela API
test('pela API: provisória só deixa trocar a senha; depois, o app abre normal; o Claude espera a troca', async (t) => {
  const dir = tmp();
  Object.assign(process.env, { STATE_DIR: dir, NODE_ENV: 'development', TAREFAS_SEM_BANCO: '1', TAREFAS_SECRET: SEGREDO, CENTER_TOKEN: 'chave-teste', TAREFAS_USUARIOS: usuarios(), COMPROMISSOS_PATH: path.join(dir, 'x.jsonl'), CENTRAL_STATE_DIR: path.join(dir, 'c') });
  delete process.env.ANTHROPIC_API_KEY; delete process.env.TAREFAS_DATABASE_URL; delete process.env.CENTER_URL;
  const { server } = require('../server.js');
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  t.after(() => { server.close(); server.closeAllConnections?.(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const chamar = async (m, rota, corpo, cookie, extra) => { const r = await fetch(base + rota, { method: m, redirect: 'manual', headers: { 'content-type': 'application/json', 'x-requested-with': 'fetch', ...(cookie ? { cookie } : {}), ...(extra || {}) }, body: corpo ? (typeof corpo === 'string' ? corpo : JSON.stringify(corpo)) : undefined }); const sc = r.headers.get('set-cookie'); let j = null; try { j = await r.clone().json(); } catch { /* html */ } return { status: r.status, j, cookie: sc ? sc.split(';')[0] : null, texto: await r.text() }; };

  // O Claude não recebe acesso com a senha provisória
  const reg = await chamar('POST', '/oauth/register', { redirect_uris: ['https://claude.ai/api/mcp/auth_callback'], client_name: 'Claude' });
  const desafio = crypto.createHash('sha256').update('v'.repeat(43)).digest('base64url');
  const form = new URLSearchParams({ client_id: reg.j.client_id, redirect_uri: 'https://claude.ai/api/mcp/auth_callback', response_type: 'code', code_challenge: desafio, code_challenge_method: 'S256', usuario: 'julien', senha: PROVISORIA }).toString();
  const oa = await chamar('POST', '/oauth/authorize', form, null, { 'content-type': 'application/x-www-form-urlencoded' });
  assert.equal(oa.status, 403); assert.match(oa.texto, /senha provisória/);

  const h = (await chamar('GET', '/health')).j;
  assert.equal(h.logins, 2); assert.equal(h.logins_ignorados, undefined); assert.equal(h.alerta, false);
  const l = await chamar('POST', '/api/login', { usuario: 'julien', senha: PROVISORIA });
  assert.equal(l.status, 200); assert.equal(l.j.usuario.trocar, true);
  const c1 = l.cookie;
  assert.equal((await chamar('GET', '/api/eu', null, c1)).j.usuario.trocar, true);
  const bloqueado = await chamar('GET', '/api/tarefas', null, c1);
  assert.equal(bloqueado.status, 403); assert.equal(bloqueado.j.trocar_senha, true);
  assert.equal((await chamar('POST', '/api/tarefas', { titulo: 'Não pode', dono: 'julien' }, c1)).status, 403);
  assert.equal((await chamar('GET', '/api/relato', null, c1)).status, 401);

  const fraca = await chamar('POST', '/api/senha', { atual: PROVISORIA, nova: 'curta' }, c1);
  assert.equal(fraca.status, 400); assert.equal(fraca.j.senha_atual, false);
  const ok = await chamar('POST', '/api/senha', { atual: PROVISORIA, nova: 'reserva das oito horas' }, c1);
  assert.equal(ok.status, 200); assert.equal(ok.j.usuario.trocar, false); assert.ok(ok.cookie);
  assert.equal((await chamar('GET', '/api/eu', null, c1)).j.usuario, null, 'cookie da provisória não vale mais');
  assert.equal((await chamar('GET', '/api/tarefas', null, ok.cookie)).status, 200);
  assert.equal((await chamar('POST', '/api/login', { usuario: 'julien', senha: PROVISORIA })).status, 401);
  assert.equal((await chamar('POST', '/api/login', { usuario: 'julien', senha: 'reserva das oito horas' })).status, 200);
  assert.equal((await chamar('POST', '/api/login', { usuario: 'admin', senha: ADMIN })).j.usuario.trocar, false);
  const audit = fs.readFileSync(path.join(dir, 'logs', `audit-${require('../store.js').hoje()}.jsonl`), 'utf8');
  assert.match(audit, /"tipo":"senha_trocada"/); assert.ok(!audit.includes('reserva das oito horas'), 'a senha nunca vai para a auditoria');

  // Adivinhar a senha atual pela troca tem o mesmo freio do login
  const outro = { 'x-forwarded-for': '203.0.113.200' };
  const st = [];
  for (let i = 0; i < 10; i++) st.push((await chamar('POST', '/api/senha', { atual: `chute-${i}`, nova: 'qualquer coisa longa' }, ok.cookie, outro)).status);
  assert.deepEqual(st.slice(0, 8), Array(8).fill(400)); assert.equal(st[9], 429);
});
