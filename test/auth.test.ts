import test from 'node:test';
import assert from 'node:assert/strict';
import { makeSessionToken, isValidSession, timingSafeEqualStr } from '../lib/auth.ts';

test('token válido passa na verificação (roundtrip)', async () => {
  const token = await makeSessionToken('segredo-forte');
  assert.equal(await isValidSession(token, 'segredo-forte'), true);
});
test('token com segredo errado é rejeitado', async () => {
  const token = await makeSessionToken('segredo-a');
  assert.equal(await isValidSession(token, 'segredo-b'), false);
});
test('token adulterado é rejeitado', async () => {
  const token = await makeSessionToken('s');
  const [exp, sig] = token.split('.');
  const flipped = sig.slice(0, -1) + (sig.endsWith('0') ? '1' : '0');
  assert.equal(await isValidSession(`${exp}.${flipped}`, 's'), false);
});
test('expiração adulterada invalida a assinatura', async () => {
  const token = await makeSessionToken('s');
  const [, sig] = token.split('.');
  const farFuture = Date.now() + 999 * 24 * 3600 * 1000;
  assert.equal(await isValidSession(`${farFuture}.${sig}`, 's'), false);
});
test('lixo e vazio são rejeitados', async () => {
  assert.equal(await isValidSession(undefined, 's'), false);
  assert.equal(await isValidSession('', 's'), false);
  assert.equal(await isValidSession('abc', 's'), false);
  assert.equal(await isValidSession('123456', 's'), false);
});
test('timingSafeEqualStr compara corretamente', () => {
  assert.equal(timingSafeEqualStr('abc', 'abc'), true);
  assert.equal(timingSafeEqualStr('abc', 'abd'), false);
  assert.equal(timingSafeEqualStr('abc', 'abcd'), false);
});
