import test from 'node:test';
import assert from 'node:assert/strict';
import { pickCoverIndex, composeSelection, type CoverItem } from '../lib/photo-select.ts';

test('prefers a landscape AMBIENCE over larger dishes (the 1800 Floga case)', () => {
  const items: CoverItem[] = [
    { w: 1680, h: 900, category: 'prato' },
    { w: 1680, h: 900, category: 'prato' },
    { w: 1680, h: 900, category: 'prato' },
    { w: 1680, h: 900, category: 'prato' },
    { w: 1600, h: 1067, category: 'ambiente' },
  ];
  assert.equal(pickCoverIndex(items), 4);
});

test('falls back to the largest landscape dish when there is no ambience', () => {
  const items: CoverItem[] = [
    { w: 1200, h: 700, category: 'prato' },
    { w: 1800, h: 1000, category: 'prato' },
  ];
  assert.equal(pickCoverIndex(items), 1);
});

test('a proper-resolution dish beats a sub-threshold ambience (quality guard)', () => {
  const items: CoverItem[] = [
    { w: 1800, h: 1000, category: 'prato' },   // >= minW
    { w: 1000, h: 600, category: 'ambiente' }, // < minW
  ];
  assert.equal(pickCoverIndex(items, 1500), 0);
});

test('below minW, the largest landscape ambience still wins', () => {
  const items: CoverItem[] = [
    { w: 1000, h: 600, category: 'prato' },
    { w: 900, h: 600, category: 'ambiente' },
  ];
  assert.equal(pickCoverIndex(items, 1500), 1);
});

test('empty list returns -1', () => {
  assert.equal(pickCoverIndex([]), -1);
});

// ── composeSelection: máx. 2 pratos, mín. 3 ambientes ─────────────────────────
test('composeSelection: só pratos → recomenda apenas 2 e sinaliza falta de ambientes', () => {
  const c = composeSelection(['prato', 'prato', 'prato', 'prato', 'prato']);
  assert.deepEqual(c.recommended, [true, true, false, false, false]);
  assert.equal(c.dishes, 2);
  assert.equal(c.ambience, 0);
  assert.equal(c.ambienceShortfall, true);
});

test('composeSelection: mix saudável 3 ambientes + 2 pratos → tudo recomendado', () => {
  const c = composeSelection(['ambiente', 'ambiente', 'ambiente', 'prato', 'prato']);
  assert.deepEqual(c.recommended, [true, true, true, true, true]);
  assert.equal(c.ambienceShortfall, false);
});

test('composeSelection: 3º prato fica de fora mesmo com ambientes de sobra', () => {
  const c = composeSelection(['ambiente', 'prato', 'ambiente', 'prato', 'ambiente', 'prato']);
  assert.deepEqual(c.recommended, [true, true, true, true, true, false]);
  assert.equal(c.dishes, 2);
  assert.equal(c.ambience, 3);
});

test('composeSelection: ambientes nunca são cortados', () => {
  const c = composeSelection(['ambiente', 'ambiente', 'ambiente', 'ambiente', 'ambiente', 'ambiente']);
  assert.equal(c.recommended.every(Boolean), true);
  assert.equal(c.ambience, 6);
});

test('composeSelection: capa-prato consome o orçamento de pratos', () => {
  // ordem de publicação: capa primeiro — se a capa é prato, sobra 1 prato p/ galeria
  const c = composeSelection(['prato', 'ambiente', 'prato', 'prato']);
  assert.deepEqual(c.recommended, [true, true, true, false]);
});

test('composeSelection: limites customizados via opts', () => {
  const c = composeSelection(['prato', 'prato', 'prato'], { maxDishes: 1, minAmbience: 2 });
  assert.deepEqual(c.recommended, [true, false, false]);
  assert.equal(c.ambienceShortfall, true);
});

test('composeSelection: lista vazia', () => {
  const c = composeSelection([]);
  assert.deepEqual(c.recommended, []);
  assert.equal(c.ambienceShortfall, true);
});
