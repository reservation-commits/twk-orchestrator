import test from 'node:test';
import assert from 'node:assert/strict';
import { assertPublicUrl, isPublicUrl, SsrfBlockedError } from '../lib/net-guard.ts';

test('bloqueia scheme não-http', async () => {
  await assert.rejects(() => assertPublicUrl('file:///etc/passwd'), SsrfBlockedError);
  await assert.rejects(() => assertPublicUrl('ftp://example.com/x'), SsrfBlockedError);
});
test('bloqueia localhost e loopback', async () => {
  await assert.rejects(() => assertPublicUrl('http://localhost:3000/admin'), SsrfBlockedError);
  await assert.rejects(() => assertPublicUrl('http://127.0.0.1/x'), SsrfBlockedError);
  await assert.rejects(() => assertPublicUrl('http://[::1]/x'), SsrfBlockedError);
});
test('bloqueia metadata e faixas privadas', async () => {
  await assert.rejects(() => assertPublicUrl('http://169.254.169.254/latest/meta-data/'), SsrfBlockedError);
  await assert.rejects(() => assertPublicUrl('http://10.0.0.1/x'), SsrfBlockedError);
  await assert.rejects(() => assertPublicUrl('http://172.16.0.1/x'), SsrfBlockedError);
  await assert.rejects(() => assertPublicUrl('http://192.168.1.1/x'), SsrfBlockedError);
  await assert.rejects(() => assertPublicUrl('http://metadata.google.internal/'), SsrfBlockedError);
});
test('bloqueia URL malformada', async () => {
  await assert.rejects(() => assertPublicUrl('não é url'), SsrfBlockedError);
});
test('aceita IP público direto (sem DNS)', async () => {
  const url = await assertPublicUrl('http://93.184.216.34/');
  assert.equal(url.hostname, '93.184.216.34');
});
test('isPublicUrl retorna boolean sem lançar', async () => {
  assert.equal(await isPublicUrl('http://127.0.0.1/'), false);
  assert.equal(await isPublicUrl('http://93.184.216.34/'), true);
});
