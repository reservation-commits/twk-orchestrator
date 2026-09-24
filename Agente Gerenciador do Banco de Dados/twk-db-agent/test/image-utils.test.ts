import test from 'node:test';
import assert from 'node:assert/strict';
import { imageSize, dedupKey, resolutionVariants } from '../lib/image-utils.ts';

function png(w: number, h: number): Buffer {
  const b = Buffer.alloc(24);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  b.writeUInt32BE(13, 8);
  b.write('IHDR', 12, 'ascii');
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return b;
}
function gif(w: number, h: number): Buffer {
  const b = Buffer.alloc(24);
  b.write('GIF89a', 0, 'ascii');
  b.writeUInt16LE(w, 6);
  b.writeUInt16LE(h, 8);
  return b;
}

test('imageSize reads PNG dimensions', () => {
  assert.deepEqual(imageSize(png(1600, 900)), { w: 1600, h: 900 });
});
test('imageSize reads GIF dimensions', () => {
  assert.deepEqual(imageSize(gif(640, 480)), { w: 640, h: 480 });
});
test('imageSize returns null for garbage/short buffers', () => {
  assert.equal(imageSize(Buffer.from([1, 2, 3])), null);
  assert.equal(imageSize(Buffer.alloc(40)), null);
});

test('dedupKey collapses resized variants to one key', () => {
  const orig = dedupKey('https://x.com/a/photo.jpg');
  assert.equal(dedupKey('https://x.com/a/photo-1024x683.jpg'), orig);
  assert.equal(dedupKey('https://x.com/a/photo-scaled.jpg'), orig);
  assert.equal(dedupKey('https://x.com/a/photo.jpg?v=2'), orig);
});
test('dedupKey keeps genuinely different images distinct', () => {
  assert.notEqual(dedupKey('https://x.com/a.jpg'), dedupKey('https://x.com/b.jpg'));
});

test('resolutionVariants proposes the de-suffixed original, largest-intent first', () => {
  assert.deepEqual(resolutionVariants('https://x.com/p-1024x683.jpg'), ['https://x.com/p.jpg']);
  assert.deepEqual(resolutionVariants('https://x.com/p-scaled.jpg'), ['https://x.com/p.jpg']);
});
test('resolutionVariants returns nothing when there is no resize suffix', () => {
  assert.deepEqual(resolutionVariants('https://x.com/p.jpg'), []);
});
