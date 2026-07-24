import test from 'node:test';
import assert from 'node:assert/strict';
import { pickCoverIndex, type CoverItem } from '../lib/photo-select.ts';

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
