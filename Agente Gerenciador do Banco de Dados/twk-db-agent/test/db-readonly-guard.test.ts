import test from 'node:test';
import assert from 'node:assert/strict';
import { queryReadOnly } from '../lib/db.ts';

// Estes testes exercitam APENAS os caminhos de rejeição do guard, que lançam
// ANTES de qualquer conexão com o banco — rodam sem DATABASE_URL.

test('queryReadOnly rejeita mutação direta', async () => {
  await assert.rejects(() => queryReadOnly('DELETE FROM t WHERE 1=1'), /somente leitura/);
});
test('queryReadOnly rejeita stacked statements', async () => {
  await assert.rejects(() => queryReadOnly('SELECT 1; DROP TABLE x'), /Múltiplos statements/);
});
test('queryReadOnly rejeita keyword de escrita embutida', async () => {
  await assert.rejects(() => queryReadOnly('SELECT * FROM t WHERE id IN (DELETE FROM x RETURNING id)'), /palavra-chave de escrita/);
});
test('queryReadOnly rejeita CTE com escrita', async () => {
  await assert.rejects(() => queryReadOnly('WITH d AS (DELETE FROM t RETURNING *) SELECT * FROM d'), /palavra-chave de escrita/);
});
test('queryReadOnly rejeita SELECT FOR UPDATE e COPY', async () => {
  await assert.rejects(() => queryReadOnly('SELECT * FROM t FOR UPDATE'), /palavra-chave de escrita/);
  await assert.rejects(() => queryReadOnly('COPY t TO STDOUT'), /somente leitura/);
});
