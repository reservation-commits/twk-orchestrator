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
  const a = analyzeWriteSql("UPDATE db_restaurants SET a = 1 WHERE id = 2", 'UPDATE');
  assert.equal(a.operation, 'UPDATE');
  assert.equal(a.hasWhere, true);
  assert.equal(a.table, 'db_restaurants');
  assert.equal(a.whereClause, 'id = 2');
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
  assert.throws(() => analyzeWriteSql('DELETE FROM db_restaurants', 'DELETE'));
  assert.throws(() => analyzeWriteSql('UPDATE db_restaurants SET a=1', 'UPDATE'));
});
test('analyzeWriteSql permite full-table só com allowMissingWhere', () => {
  const a = analyzeWriteSql('UPDATE db_restaurants SET a=1', 'UPDATE', { allowMissingWhere: true });
  assert.equal(a.operation, 'UPDATE');
  assert.equal(a.hasWhere, false);
});
test('analyzeWriteSql aceita INSERT sem WHERE', () => {
  const a = analyzeWriteSql("INSERT INTO db_restaurants (a) VALUES (1)", 'INSERT');
  assert.equal(a.operation, 'INSERT');
});
test('analyzeWriteSql rejeita SELECT (não é mutação)', () => {
  assert.throws(() => analyzeWriteSql('SELECT * FROM db_restaurants'));
});

// ── WHERE tautológico vale como sem WHERE ─────────────────────────────────────
test('analyzeWriteSql trata WHERE tautológico como ausência de WHERE', () => {
  assert.throws(() => analyzeWriteSql('UPDATE db_restaurants SET a=1 WHERE 1=1', 'UPDATE'));
  assert.throws(() => analyzeWriteSql('DELETE FROM db_restaurants WHERE true', 'DELETE'));
  assert.throws(() => analyzeWriteSql("UPDATE db_restaurants SET a=1 WHERE '1'='1'", 'UPDATE'));
  assert.throws(() => analyzeWriteSql('DELETE FROM db_restaurants WHERE  1 = 1 ', 'DELETE'));
  assert.throws(() => analyzeWriteSql('DELETE FROM db_restaurants WHERE TRUE', 'DELETE'));
  assert.throws(() => analyzeWriteSql('DELETE FROM db_restaurants WHERE (1=1)', 'DELETE'));
});
test('analyzeWriteSql permite tautologia só com allowMissingWhere (hasWhere=false)', () => {
  const a = analyzeWriteSql('UPDATE db_restaurants SET a=1 WHERE 1=1', 'UPDATE', { allowMissingWhere: true });
  assert.equal(a.hasWhere, false);
});
test('analyzeWriteSql não confunde tautologia com filtro real', () => {
  const a = analyzeWriteSql('UPDATE db_restaurants SET a=1 WHERE 1=1 AND id = 7', 'UPDATE');
  assert.equal(a.hasWhere, true);
});

// ── Allowlist de tabelas mutáveis ─────────────────────────────────────────────
test('analyzeWriteSql bloqueia tabelas de negócio protegidas', () => {
  assert.throws(() => analyzeWriteSql('UPDATE reservations SET status = 1 WHERE id = 2', 'UPDATE'), /protegida/);
  assert.throws(() => analyzeWriteSql('DELETE FROM stripe_webhook_events WHERE id = 1', 'DELETE'), /protegida/);
  assert.throws(() => analyzeWriteSql("INSERT INTO messages (a) VALUES (1)", 'INSERT'), /protegida/);
  assert.throws(() => analyzeWriteSql('UPDATE aria_sessions SET a = 1 WHERE id = 2', 'UPDATE'), /protegida/);
});
test('analyzeWriteSql bloqueia qualquer tabela do schema nextauth', () => {
  assert.throws(() => analyzeWriteSql('DELETE FROM nextauth."User" WHERE id = 1', 'DELETE'), /nextauth/);
  assert.throws(() => analyzeWriteSql('UPDATE nextauth.accounts SET a = 1 WHERE id = 2', 'UPDATE'), /nextauth/);
});
test('analyzeWriteSql bloqueia tabela fora das listas pedindo revisão humana', () => {
  assert.throws(() => analyzeWriteSql('UPDATE tabela_misteriosa SET a = 1 WHERE id = 2', 'UPDATE'), /revisão humana/);
});
test('analyzeWriteSql aceita alvo schema-qualificado e com aspas', () => {
  const a = analyzeWriteSql('UPDATE public.db_restaurants SET a = 1 WHERE id = 2', 'UPDATE');
  assert.equal(a.table, 'public.db_restaurants');
  const b = analyzeWriteSql('UPDATE "public"."db_restaurants" SET a = 1 WHERE id = 2', 'UPDATE');
  assert.equal(b.table, 'public.db_restaurants');
  const c = analyzeWriteSql('DELETE FROM "opening_hours" WHERE id = 1', 'DELETE');
  assert.equal(c.table, 'opening_hours');
});
test('analyzeWriteSql bloqueia tabela protegida mesmo qualificada/citada', () => {
  assert.throws(() => analyzeWriteSql('UPDATE public.reservations SET a = 1 WHERE id = 2', 'UPDATE'), /protegida/);
  assert.throws(() => analyzeWriteSql('DELETE FROM "public"."favorites" WHERE id = 1', 'DELETE'), /protegida/);
});
