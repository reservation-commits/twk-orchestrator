import test from 'node:test';
import assert from 'node:assert/strict';
import { safeIdent, safeColumn, safeOrderDir, isSafeIdent, analyzeWriteSql } from '../lib/sql-guard.ts';

// ── Identificadores ───────────────────────────────────────────────────────────
test('safeIdent aceita e cita identificador simples', () => {
  assert.equal(safeIdent('db_restaurants'), '"db_restaurants"');
});
test('safeIdent aceita schema.tabela', () => {
  assert.equal(safeIdent('public.db_restaurants'), '"public"."db_restaurants"');
});
test('safeIdent rejeita injeção clássica', () => {
  assert.throws(() => safeIdent('db_restaurants; DROP TABLE x--'));
  assert.throws(() => safeIdent('a"b'));
  assert.throws(() => safeIdent('tab le'));
  assert.throws(() => safeIdent('a.b.c'));
  assert.throws(() => safeIdent(''));
  assert.throws(() => safeIdent('1abc'));
});
test('safeColumn rejeita qualificação e caracteres perigosos', () => {
  assert.equal(safeColumn('email_for_reservations'), '"email_for_reservations"');
  assert.throws(() => safeColumn('a.b'));
  assert.throws(() => safeColumn("email' OR 1=1"));
});
test('safeOrderDir normaliza para ASC/DESC', () => {
  assert.equal(safeOrderDir('desc'), 'DESC');
  assert.equal(safeOrderDir('DESC'), 'DESC');
  assert.equal(safeOrderDir('asc'), 'ASC');
  assert.equal(safeOrderDir('; DROP'), 'ASC');
});
test('isSafeIdent é consistente com safeIdent', () => {
  assert.equal(isSafeIdent('ok_name'), true);
  assert.equal(isSafeIdent('bad;name'), false);
});

// ── Statements de escrita ─────────────────────────────────────────────────────
test('analyzeWriteSql aceita UPDATE com WHERE e operação correta', () => {
  const a = analyzeWriteSql("UPDATE t SET a = 1 WHERE id = 2", 'UPDATE');
  assert.equal(a.operation, 'UPDATE');
  assert.equal(a.hasWhere, true);
});
test('analyzeWriteSql bloqueia múltiplos statements', () => {
  assert.throws(() => analyzeWriteSql('DELETE FROM t WHERE id=1; DROP TABLE t', 'DELETE'));
});
test('analyzeWriteSql bloqueia DDL disfarçado', () => {
  assert.throws(() => analyzeWriteSql('DROP TABLE db_restaurants', 'DELETE'));
  assert.throws(() => analyzeWriteSql('TRUNCATE db_restaurants', 'DELETE'));
});
test('analyzeWriteSql bloqueia operação declarada divergente', () => {
  assert.throws(() => analyzeWriteSql('DELETE FROM t WHERE id=1', 'UPDATE'));
});
test('analyzeWriteSql exige WHERE em UPDATE/DELETE por padrão', () => {
  assert.throws(() => analyzeWriteSql('DELETE FROM t', 'DELETE'));
  assert.throws(() => analyzeWriteSql('UPDATE t SET a=1', 'UPDATE'));
});
test('analyzeWriteSql permite full-table só com allowMissingWhere', () => {
  const a = analyzeWriteSql('UPDATE t SET a=1', 'UPDATE', { allowMissingWhere: true });
  assert.equal(a.operation, 'UPDATE');
  assert.equal(a.hasWhere, false);
});
test('analyzeWriteSql aceita INSERT sem WHERE', () => {
  const a = analyzeWriteSql("INSERT INTO t (a) VALUES (1)", 'INSERT');
  assert.equal(a.operation, 'INSERT');
});
test('analyzeWriteSql rejeita SELECT (não é mutação)', () => {
  assert.throws(() => analyzeWriteSql('SELECT * FROM t'));
});
