import test from 'node:test';
import assert from 'node:assert/strict';
import { heroUrl, hasHero, imageUrls, ImagesJsonSchema } from '../types/contract.ts';

test('heroUrl: slider[0] WINS over cover (the invariant behind the cover bug)', () => {
  const ij = { cover: { source_url: 'COVER' }, slider: [{ source_url: 'SLIDER0' }, { source_url: 'S1' }] };
  assert.equal(heroUrl(ij), 'SLIDER0');
});
test('heroUrl: falls back to cover when slider is empty/absent', () => {
  assert.equal(heroUrl({ cover: { source_url: 'COVER' } }), 'COVER');
  assert.equal(heroUrl({ cover: { source_url: 'COVER' }, slider: [] }), 'COVER');
});
test('heroUrl: null for empty / missing source_url / non-objects', () => {
  assert.equal(heroUrl(null), null);
  assert.equal(heroUrl(undefined), null);
  assert.equal(heroUrl({}), null);
  assert.equal(heroUrl('nope'), null);
});
test('hasHero reflects heroUrl', () => {
  assert.equal(hasHero({ slider: [{ source_url: 'x' }] }), true);
  assert.equal(hasHero({}), false);
});

test('imageUrls: hero first, deduped, capped', () => {
  const ij = { cover: { source_url: 'C' }, slider: [{ source_url: 'A' }, { source_url: 'B' }, { source_url: 'A' }] };
  assert.deepEqual(imageUrls(ij), ['A', 'B']); // hero=A (slider[0]) first; dup A removed; C not in slider
  assert.equal(imageUrls({ slider: Array.from({ length: 10 }, (_, i) => ({ source_url: 's' + i })) }).length, 6);
});

test('ImagesJsonSchema accepts real + legacy shapes, tolerates extra keys', () => {
  assert.equal(ImagesJsonSchema.safeParse({ logo: null, cover: { source_url: 'x' }, slider: [{ source_url: 'y', type: 'legacy', file_name: 'z' }] }).success, true);
  assert.equal(ImagesJsonSchema.safeParse({}).success, true);
});
test('ImagesJsonSchema rejects a slider item without source_url', () => {
  assert.equal(ImagesJsonSchema.safeParse({ slider: [{ alt_text: 'no url' }] }).success, false);
});
