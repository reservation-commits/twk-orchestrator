import test from 'node:test';
import assert from 'node:assert/strict';
import {
  detectNumericOutliers, detectDateAnomalies, detectPlaceholders,
  detectOverRepetition, detectGeofenceViolations,
} from '../lib/outlier-detector.ts';

test('detectNumericOutliers flags a value beyond 3σ', () => {
  const rows = [1, 1, 1, 1, 1, 1, 1, 1, 1, 100].map((v, i) => ({ id: i, x: v }));
  const o = detectNumericOutliers(rows, 'x', 'id', 3);
  assert.equal(o.length, 1);
  assert.equal(o[0].value, 100);
});
test('detectNumericOutliers: nothing for uniform data or <4 values', () => {
  assert.equal(detectNumericOutliers([{ id: 1, x: 5 }, { id: 2, x: 5 }, { id: 3, x: 5 }, { id: 4, x: 5 }], 'x', 'id').length, 0);
  assert.equal(detectNumericOutliers([{ id: 1, x: 1 }, { id: 2, x: 9 }], 'x', 'id').length, 0);
});

test('detectDateAnomalies: future, pre-minYear and epoch flagged; normal date not', () => {
  const rows = [
    { id: 1, d: '2999-01-01' },
    { id: 2, d: '1980-01-01' },
    { id: 3, d: '1970-01-01' },
    { id: 4, d: '2020-05-05' },
  ];
  const o = detectDateAnomalies(rows, 'd', 'id');
  assert.ok(o.find((x) => x.row_id === 1));
  assert.ok(o.find((x) => x.row_id === 2));
  assert.ok(o.find((x) => x.row_id === 3));
  assert.ok(!o.find((x) => x.row_id === 4));
});

test('detectPlaceholders catches test/lorem/asdf/N-A, ignores real names', () => {
  const rows = [
    { id: 1, x: 'test restaurant' },
    { id: 2, x: 'Lorem ipsum dolor' },
    { id: 3, x: 'asdf' },
    { id: 4, x: 'N/A' },
    { id: 5, x: 'Casa Botín' },
  ];
  const o = detectPlaceholders(rows, 'x', 'id');
  assert.deepEqual(o.map((r) => r.row_id).sort(), [1, 2, 3, 4]);
});

test('detectOverRepetition flags values repeated >= minRepeats', () => {
  const rows = [
    ...Array.from({ length: 6 }, (_, i) => ({ id: i, email: 'shared@x.com' })),
    { id: 99, email: 'unique@x.com' },
  ];
  const o = detectOverRepetition(rows, 'email', 'id', 5);
  assert.equal(o.length, 6);
  assert.ok(!o.find((x) => x.row_id === 99));
});

test('detectGeofenceViolations: point outside the city bbox is flagged', () => {
  const rows = [
    { id: 1, latitude: 48.85, longitude: 2.35, city: 'Paris' },   // inside
    { id: 2, latitude: 40.70, longitude: -74.0, city: 'Paris' },  // NYC, wrong
  ];
  const o = detectGeofenceViolations(rows);
  assert.equal(o.length, 1);
  assert.equal(o[0].row_id, 2);
});
