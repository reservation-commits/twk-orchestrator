/**
 * Pure image/URL helpers — no DB, no network, no SDK deps, so they are unit-testable in
 * isolation (Node's built-in test runner) and safe to import anywhere.
 */

// Decode pixel dimensions from an image buffer header (jpeg/png/webp/gif). Returns null if
// the format is unknown or the header is truncated.
export function imageSize(buf: Buffer): { w: number; h: number } | null {
  if (!buf || buf.length < 24) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return { w: buf.readUInt16LE(6), h: buf.readUInt16LE(8) };
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42) {
    const fmt = buf.toString('ascii', 12, 16);
    try {
      if (fmt === 'VP8 ') return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
      if (fmt === 'VP8L') { const b0 = buf[21], b1 = buf[22], b2 = buf[23], b3 = buf[24]; return { w: 1 + (((b1 & 0x3f) << 8) | b0), h: 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)) }; }
      if (fmt === 'VP8X') return { w: 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16)), h: 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16)) };
    } catch { return null; }
    return null;
  }
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let off = 2;
    while (off < buf.length - 9) {
      if (buf[off] !== 0xff) { off++; continue; }
      let marker = buf[off + 1];
      while (marker === 0xff && off + 1 < buf.length) { off++; marker = buf[off + 1]; }
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) { try { return { h: buf.readUInt16BE(off + 5), w: buf.readUInt16BE(off + 7) }; } catch { return null; } }
      if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { off += 2; continue; }
      try { off += 2 + buf.readUInt16BE(off + 2); } catch { return null; }
    }
  }
  return null;
}

// Collapse resized/variant URLs to one key so duplicates across sources merge.
export function dedupKey(url: string): string {
  let u = url.split('?')[0].toLowerCase();
  u = u.replace(/-\d{2,4}x\d{2,4}(?=\.[a-z]+$)/, '');
  u = u.replace(/-scaled(?=\.[a-z]+$)/, '');
  u = u.replace(/@\d+x(?=\.[a-z]+$)/, '');
  u = u.replace(/[._-](large|medium|small|thumb|thumbnail|mobile|desktop|\d{3,4}w)(?=\.[a-z]+$)/, '');
  u = u.replace(/\/(thumbs?|cache|resized?|styles)\//, '/');
  return u;
}

// Build higher-resolution URL candidates from a (usually resized) image URL. WordPress/CMS
// serve `name-1024x683.jpg` / `name-scaled.jpg` / `name@2x.jpg` while the original `name.jpg`
// is typically larger. Returns de-suffixed variants to try (original-intent first).
export function resolutionVariants(url: string): string[] {
  const [path, qs] = url.split('?');
  const q = qs ? '?' + qs : '';
  const stripped = path
    .replace(/-\d{2,4}x\d{2,4}(?=\.[a-z]+$)/i, '')
    .replace(/-scaled(?=\.[a-z]+$)/i, '')
    .replace(/@\d+x(?=\.[a-z]+$)/i, '')
    .replace(/[._-](large|medium|small|thumb|thumbnail|mobile|desktop)(?=\.[a-z]+$)/i, '');
  return stripped !== path ? [stripped + q] : [];
}
