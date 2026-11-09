'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const auth = require('../auth.js');

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'twk-auth-test-')); }

test('hash e conferência de senha', () => {
  const h = auth.hashSenha('segredo');
  assert.match(h, /^scrypt:[0-9a-f]{24}:[0-9a-f]{64}$/, 'sem cifrão: o EasyPanel engole $palavra em variáveis de ambiente');
  assert.equal(auth.conferirSenha('segredo', h), true);
  assert.equal(auth.conferirSenha('outra', h), false);
  assert.equal(auth.conferirSenha('segredo', 'lixo'), false);
  assert.equal(auth.conferirSenha('segredo', h.replace(/:/g, '$')), true, 'formato antigo com $ continua aceito');
});

test('produção sem usuários ou sem segredo = não operacional', () => {
  const a = auth.criar({ stateDir: tmp(), isProd: true, segredo: 'x'.repeat(32) });
  assert.equal(a.operacional, false);
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'usuarios.json'), JSON.stringify([{ id: 'marlon', senha: auth.hashSenha('abc') }]));
  const b = auth.criar({ stateDir: dir, isProd: true, segredo: '' });
  assert.equal(b.operacional, false);
  const c = auth.criar({ stateDir: dir, isProd: true, segredo: 'x'.repeat(32) });
  assert.equal(c.operacional, true);
  assert.deepEqual(c.usuarios, [{ id: 'marlon', nome: 'Márlon' }]);
});

test('um login só: admin entra, mas não está entre as pessoas que assumem tarefa', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'usuarios.json'), JSON.stringify([{ id: 'admin', senha: auth.hashSenha('chave-do-fundador') }]));
  const a = auth.criar({ stateDir: dir, isProd: true, segredo: 'x'.repeat(32) });
  assert.equal(a.operacional, true);
  assert.deepEqual(a.usuarios, [{ id: 'admin', nome: 'Admin' }]);
  assert.equal(a.entrar('admin', 'chave-do-fundador').usuario.nome, 'Admin');
  assert.equal(auth.PESSOAS.admin, undefined, 'admin nunca é dono de tarefa');
});

test('usuário fora do trio ou senha em claro são ignorados', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'usuarios.json'), JSON.stringify([{ id: 'fulano', senha: auth.hashSenha('a') }, { id: 'lucas', senha: 'em-claro' }]));
  assert.throws(() => auth.criar({ stateDir: dir, isProd: true, segredo: 'x'.repeat(32) }), /Nenhum usuário válido/);
});

test('desenvolvimento: trio com senha twk; sessão assinada e expirada', () => {
  const a = auth.criar({ stateDir: tmp(), isProd: false, segredo: '' });
  assert.equal(a.operacional, true);
  assert.equal(a.entrar('julien', 'errada'), null);
  const s = a.entrar('Julien', 'twk');
  assert.equal(s.usuario.id, 'julien');
  const req = { headers: { cookie: `outro=1; twk_tarefas=${encodeURIComponent(s.token)}` } };
  assert.deepEqual(a.sessaoDe(req), { id: 'julien', nome: 'Julien', trocar: false });
  const [corpo] = s.token.split('.');
  assert.equal(a.sessaoDe({ headers: { cookie: `twk_tarefas=${corpo}.assinatura-falsa` } }), null);
  assert.equal(a._abrirToken(`${Buffer.from(JSON.stringify({ id: 'julien', exp: Date.now() - 1 })).toString('base64url')}.x`), null);
  assert.match(a.cookie('t', true), /HttpOnly; SameSite=Lax; Max-Age=\d+; Secure$/);
});
