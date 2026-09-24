import test from 'node:test';
import assert from 'node:assert/strict';
import { validateValue, scoreRowCompleteness, findDuplicateGroups, auditRows } from '../lib/validator.ts';

test('required field null → critical/required', () => {
  const i = validateValue('name', null, 'r1');
  assert.equal(i?.severity, 'critical');
  assert.equal(i?.rule, 'required');
});
test('recommended field empty → warning/missing', () => {
  const i = validateValue('site_url', '', 'r1');
  assert.equal(i?.rule, 'missing');
  assert.equal(i?.severity, 'warning');
});
test('unknown column, empty value → not flagged', () => {
  assert.equal(validateValue('some_random_col', '', 'r1'), null);
});

test('email: valid passes, invalid flagged as format:email (warning)', () => {
  assert.equal(validateValue('email_for_reservations', 'a@b.com', 'r'), null);
  const i = validateValue('email_for_reservations', 'not-an-email', 'r');
  assert.equal(i?.rule, 'format:email');
  assert.equal(i?.severity, 'warning');
});

test('url: invalid flagged and suggests https://', () => {
  const i = validateValue('site_url', 'example.com', 'r');
  assert.equal(i?.rule, 'format:url');
  assert.equal(i?.suggested, 'https://example.com');
});

test('slug: uppercase/underscore flagged as format:slug (critical)', () => {
  const i = validateValue('slug', 'Bad_Slug', 'r');
  assert.equal(i?.rule, 'format:slug');
  assert.equal(i?.severity, 'critical');
});

// Regression: numeric validators were being fed the stringified value, so EVERY latitude/longitude
// was wrongly flagged invalid. A valid coordinate must pass.
test('latitude/longitude in range are VALID', () => {
  assert.equal(validateValue('latitude', 48.8566, 'r'), null);
  assert.equal(validateValue('longitude', 2.3522, 'r'), null);
});
test('latitude out of range → critical/format:latitude', () => {
  const i = validateValue('latitude', 200, 'r');
  assert.equal(i?.rule, 'format:latitude');
  assert.equal(i?.severity, 'critical');
});

test('min/max length', () => {
  assert.equal(validateValue('name', 'A', 'r')?.rule, 'min_length');
  assert.equal(validateValue('name', 'x'.repeat(201), 'r')?.rule, 'max_length');
  assert.equal(validateValue('name', 'A proper restaurant name', 'r'), null);
});

test('scoreRowCompleteness: full=100, empty={}=0, blanks/empty-arrays count as unfilled', () => {
  assert.equal(scoreRowCompleteness({ name: 'X', city: 'Y', country: 'Z', slug: 'x-y' }), 100);
  assert.equal(scoreRowCompleteness({}), 0);
  assert.equal(scoreRowCompleteness({ name: 'X', photos: [] }), 50);
  const partial = scoreRowCompleteness({ name: 'X', city: '', country: null, slug: 'x' });
  assert.ok(partial > 0 && partial < 100);
});

test('findDuplicateGroups: diacritic + whitespace insensitive grouping', () => {
  const rows = [
    { id: 1, name: 'São Paulo Café' },
    { id: 2, name: 'Sao Paulo Cafe' },
    { id: 3, name: 'Burger King' },
  ];
  const g = findDuplicateGroups(rows, 'id', 'name');
  assert.equal(g.length, 1);
  assert.deepEqual([...g[0].ids].sort(), [1, 2]);
});
test('findDuplicateGroups: distinct names are not grouped', () => {
  assert.equal(findDuplicateGroups([{ id: 1, name: 'Alpha' }, { id: 2, name: 'Omega' }], 'id', 'name').length, 0);
});

test('auditRows: flags required nulls + zero coords; score within 0..100', () => {
  const rows = [
    { id: 1, name: null, latitude: 0, longitude: 0 },
    { id: 2, name: 'Proper Name', latitude: 48.8, longitude: 2.3 },
  ];
  const r = auditRows(rows, 't', 'id');
  assert.ok(r.critical_count >= 1);
  assert.ok(r.consistency_issues.some((c) => c.rule === 'coordinates_zero'));
  assert.ok(r.quality_score >= 0 && r.quality_score <= 100);
});
