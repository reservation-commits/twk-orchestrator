/*
 * Photo enrichment v3 — strict: real pixel-size gate, no people, aggressive dedup, vision-classified.
 * Cover must be landscape & >=1500px wide; gallery images >=1100px wide; reject any image with a person,
 * menus/text, low quality. Priority: AMBIENTE; else PRATO; else NULL. Canonical images_json shape.
 * Default = PILOT (--limit N, no write). --apply processes ALL remaining (idempotent / resumable).
 */
const fs = require('fs');
const path = require('path');
const axios = require('./twk-db-agent/node_modules/axios');
const cheerio = require('./twk-db-agent/node_modules/cheerio');
const _sdk = require('./twk-db-agent/node_modules/@anthropic-ai/sdk');
const Anthropic = _sdk.default || _sdk;
const { Pool } = require('./twk-db-agent/node_modules/pg');
const { auditedUpdateRow } = require('./db-audited'); // escrita auditada (2026-09-21)

const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const LIMIT = (() => { const i = argv.indexOf('--limit'); return i >= 0 ? parseInt(argv[i + 1], 10) : 12; })();
const CONCURRENCY = 3;
const COVER_MIN_W = 1500, GALLERY_MIN_W = 1100;
process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', String((e && e.message) || e).slice(0, 120)));
process.on('uncaughtException', (e) => console.error('[uncaughtException]', String((e && e.message) || e).slice(0, 120)));

const env = fs.readFileSync(path.join(__dirname, 'twk-db-agent', '.env.local'), 'utf8');
const anthropic = new Anthropic({ apiKey: env.match(/ANTHROPIC_API_KEY=(.+)/)[1].trim() });
const VISION_MODEL = 'claude-haiku-4-5-20251001';
const pool = new Pool({ connectionString: require('./db-config').CONN, ssl: { rejectUnauthorized: false } });
const UA = { 'User-Agent': 'Mozilla/5.0 (compatible; TWK-Bot/1.0)', Accept: 'text/html,*/*', Connection: 'close' };

const JUNK = /logo|icon|favicon|sprite|placeholder|avatar|flag|emoji|pixel|badge|button|arrow|gravatar|cookie|loader|spinner|blank|1x1|spacer|wp-content\/plugins|\/icons?\/|social|whatsapp|facebook|instagram|tripadvisor|thefork|opentable|paypal|visa|mastercard|border|divider|separator|ornament|pattern|texture|repsol|guia-|\bnav\b|nav-|menu-bg/i;
const IMG_EXT = /\.(jpe?g|png|webp)(\?|$)/i;
const normUrl = (u) => { if (!u) return null; u = u.trim(); if (!/^https?:\/\//i.test(u)) u = 'https://' + u; try { new URL(u); return u.replace(/\/+$/, ''); } catch { return null; } };
async function fetchHtml(u) { try { const { data, status } = await axios.get(u, { headers: UA, timeout: 10000, maxRedirects: 5, validateStatus: () => true }); return status >= 200 && status < 400 && typeof data === 'string' ? data : null; } catch { return null; } }
function pickLargest(ss) { if (!ss) return null; let b = null, bw = -1; ss.split(',').forEach((p) => { const [u, w] = p.trim().split(/\s+/); const ww = w ? parseInt(w) : 0; if (u && ww >= bw) { bw = ww; b = u; } }); return b; }

function dedupKey(url) {
  let u = url.split('?')[0].toLowerCase();
  u = u.replace(/-\d{2,4}x\d{2,4}(?=\.[a-z]+$)/, '');
  u = u.replace(/-scaled(?=\.[a-z]+$)/, '');
  u = u.replace(/@\d+x(?=\.[a-z]+$)/, '');
  u = u.replace(/[._-](large|medium|small|thumb|thumbnail|mobile|desktop|\d{3,4}w)(?=\.[a-z]+$)/, '');
  u = u.replace(/\/(thumbs?|cache|resized?|styles)\//, '/');
  return u;
}

// Parse pixel dimensions from a full image buffer (jpeg/png/webp/gif).
function imageSize(buf) {
  if (!buf || buf.length < 24) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return { w: buf.readUInt16LE(6), h: buf.readUInt16LE(8) };
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42) {
    const fmt = buf.toString('ascii', 12, 16);
    try {
      if (fmt === 'VP8 ') return { w: buf.readUInt16LE(26) & 0x3FFF, h: buf.readUInt16LE(28) & 0x3FFF };
      if (fmt === 'VP8L') { const b0 = buf[21], b1 = buf[22], b2 = buf[23], b3 = buf[24]; return { w: 1 + (((b1 & 0x3F) << 8) | b0), h: 1 + (((b3 & 0x0F) << 10) | (b2 << 2) | ((b1 & 0xC0) >> 6)) }; }
      if (fmt === 'VP8X') return { w: 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16)), h: 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16)) };
    } catch { return null; }
    return null;
  }
  if (buf[0] === 0xFF && buf[1] === 0xD8) {
    let off = 2;
    while (off < buf.length - 9) {
      if (buf[off] !== 0xFF) { off++; continue; }
      let marker = buf[off + 1];
      while (marker === 0xFF && off + 1 < buf.length) { off++; marker = buf[off + 1]; }
      if (marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC) { try { return { h: buf.readUInt16BE(off + 5), w: buf.readUInt16BE(off + 7) }; } catch { return null; } }
      if (marker === 0xD8 || marker === 0xD9 || marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) { off += 2; continue; }
      try { off += 2 + buf.readUInt16BE(off + 2); } catch { return null; }
    }
  }
  return null;
}

async function fetchImage(url) {
  try {
    const r = await axios.get(url, { headers: UA, timeout: 12000, maxRedirects: 4, responseType: 'arraybuffer', validateStatus: () => true, maxContentLength: 6 * 1024 * 1024 });
    if (r.status < 200 || r.status >= 300) return null;
    let ct = String(r.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (ct === 'image/jpg') ct = 'image/jpeg';
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(ct)) return null;
    const buf = Buffer.from(r.data);
    if (buf.length < 20000 || buf.length > 5 * 1024 * 1024) return null;
    const dim = imageSize(buf);
    if (!dim || !dim.w || dim.w < GALLERY_MIN_W) return null;        // hard pixel-size gate
    return { media_type: ct, data: buf.toString('base64'), w: dim.w, h: dim.h };
  } catch { return null; }
}

function candidates(html, baseUrl) {
  const $ = cheerio.load(html);
  const abs = (u) => { try { return new URL(u, baseUrl).href.split('#')[0]; } catch { return null; } };
  const raw = [];
  $('meta[property="og:image"],meta[property="og:image:secure_url"],meta[name="twitter:image"]').each((_, el) => raw.push($(el).attr('content')));
  $('img').each((_, el) => { const e = $(el); raw.push(e.attr('src'), e.attr('data-src'), e.attr('data-lazy-src'), pickLargest(e.attr('srcset') || e.attr('data-srcset'))); });
  $('source[srcset]').each((_, el) => raw.push(pickLargest($(el).attr('srcset'))));
  const seen = new Set(); const out = [];
  for (const r of raw) { const u = abs(r); if (!u || u.startsWith('data:')) continue; if (/\.svg(\?|$)/i.test(u) || JUNK.test(u) || !IMG_EXT.test(u)) continue; const key = dedupKey(u); if (seen.has(key)) continue; seen.add(key); out.push(u); }
  return out.slice(0, 14);
}

async function classify(imgs) {
  const content = [{ type: 'text', text:
`Você é curador de fotos para um diretório de restaurantes de alto padrão. Para CADA imagem (na ordem), retorne um objeto:
{"i": índice 0-based, "cat": "ambiente"|"prato"|"pessoa"|"texto"|"outro", "hq": true|false, "person": true|false}
- "ambiente" = o ESPAÇO do restaurante (salão, mesas postas, decoração, interior, fachada, terraço)
- "prato" = comida ou bebida servida
- "pessoa" = a foto é principalmente de pessoa(s)
- "texto" = cardápio, menu, palavras, cartaz, logotipo
- "outro" = qualquer outra coisa
- "person": true se aparecer QUALQUER pessoa, rosto, silhueta ou mãos, mesmo pequena ou ao fundo
- "hq": true só se for nítida, profissional e claramente de alta resolução
Responda APENAS o array JSON, nada mais.` }];
  imgs.forEach((im) => content.push({ type: 'image', source: { type: 'base64', media_type: im.media_type, data: im.data } }));
  const msg = await anthropic.messages.create({ model: VISION_MODEL, max_tokens: 700, messages: [{ role: 'user', content }] });
  const text = msg.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
  const m = text.match(/\[[\s\S]*\]/); if (!m) return [];
  try { return JSON.parse(m[0]); } catch { return []; }
}

const basename = (u) => { try { return decodeURIComponent(new URL(u).pathname.split('/').pop() || 'image').slice(0, 120); } catch { return 'image'; } };
const item = (u, name) => ({ id: null, alt_text: name || '', filename: basename(u), source_url: u });

(async () => {
  const where = `published AND images_json IS NULL AND site_url IS NOT NULL AND site_url <> ''`;
  const total = (await pool.query(`SELECT COUNT(*)::int c FROM db_restaurants WHERE ${where}`)).rows[0].c;
  const rows = (await pool.query(`SELECT restaurant_id, name, city, site_url FROM db_restaurants WHERE ${where} ORDER BY (partner) DESC, name ${APPLY ? '' : `LIMIT ${LIMIT}`}`)).rows;
  console.log(`Candidatos: ${total} | processando: ${rows.length} | modo: ${APPLY ? 'APPLY' : 'PILOTO'} | capa>=${COVER_MIN_W}px paisagem\n`);

  const tally = { ambiente: 0, prato: 0, null: 0, err: 0 };
  const queue = [...rows]; let done = 0;
  async function worker() {
    while (queue.length) {
      const r = queue.shift(); done++;
      const base = normUrl(r.site_url); if (!base) { tally.null++; continue; }
      try {
        let cands = [];
        const keys = new Set();
        for (const p of ['', '/gallery', '/galerie', '/photos', '/galeria']) {
          const html = await fetchHtml(base + p); if (!html) continue;
          for (const u of candidates(html, base + p)) { const k = dedupKey(u); if (!keys.has(k)) { keys.add(k); cands.push(u); } }
          if (cands.length >= 12) break;
        }
        cands = cands.slice(0, 14);
        const imgs = []; const meta = [];
        for (const u of cands) { const im = await fetchImage(u); if (im) { imgs.push(im); meta.push({ url: u, w: im.w, h: im.h }); } if (imgs.length >= 6) break; }
        if (!imgs.length) { tally.null++; if (!APPLY) console.log(`  ∅ ${r.name} (${r.city}) — nenhuma imagem em alta resolução`); continue; }
        const cls = await classify(imgs);
        const get = (i) => cls.find((c) => c.i === i) || {};
        const okIdx = (cat) => meta.map((m, i) => ({ ...m, i })).filter((m) => { const c = get(m.i); return c.cat === cat && c.hq === true && c.person !== true; });
        let chosen = okIdx('ambiente'); let kind = 'AMBIENTE';
        if (!chosen.length) { chosen = okIdx('prato'); kind = 'prato'; }
        if (!chosen.length) { tally.null++; if (!APPLY) console.log(`  ∅ ${r.name} (${r.city}) — sem ambiente/prato qualificado`); continue; }
        // cover: landscape & >=1500px, widest
        const coverPool = chosen.filter((m) => m.w >= COVER_MIN_W && m.w >= m.h).sort((a, b) => b.w - a.w);
        if (!coverPool.length) { tally.null++; if (!APPLY) console.log(`  ∅ ${r.name} (${r.city}) — sem capa em alta resolução/paisagem (melhor: ${Math.max(...chosen.map((m) => m.w))}px)`); continue; }
        const cover = coverPool[0];
        const gallery = chosen.filter((m) => m.url !== cover.url && m.w >= GALLERY_MIN_W).sort((a, b) => b.w - a.w).slice(0, 6);
        if (kind === 'AMBIENTE') tally.ambiente++; else tally.prato++;
        const imagesJson = { logo: null, cover: item(cover.url, r.name), slider: gallery.map((m) => item(m.url, r.name)) };
        if (!APPLY) {
          console.log(`  ✓ ${r.name} (${r.city}) — ${kind} · capa ${cover.w}x${cover.h} + ${gallery.length} galeria`);
          console.log(`      capa: ${cover.url.slice(0, 95)}`);
        } else {
          // Escrita auditada: old_data + agent_audit_log na mesma transação; `images_json IS NULL`
          // continua como condição (idempotente/retomável) — se já tiver foto, não grava nem audita.
          await auditedUpdateRow(pool, {
            table: 'db_restaurants', pk: 'restaurant_id', id: r.restaurant_id,
            set: `images_json=$1::jsonb, last_verified_at=now(), enrichment_log=COALESCE(enrichment_log,'[]'::jsonb)||$2::jsonb`,
            params: [JSON.stringify(imagesJson), JSON.stringify([{ field: 'images_json', action: 'vision_scrape', kind, cover_w: cover.w, count: gallery.length + 1, source: base, at: new Date().toISOString() }])],
            extraWhere: 'images_json IS NULL',
            agent: 'enrich_photos_v2', reason: `fotos por visao (${kind}, capa ${cover.w}px, ${gallery.length + 1} imagens)`,
          });
          if ((tally.ambiente + tally.prato) % 25 === 0) console.log(`  ...${tally.ambiente + tally.prato} gravados (${done}/${rows.length} vistos)`);
        }
      } catch (e) { tally.err++; if (!APPLY) console.log(`  ⚠ ${r.name}: ${String((e && e.message) || e).slice(0, 80)}`); }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  console.log(`\n──────── RESUMO ────────`);
  console.log(`Ambiente: ${tally.ambiente} | Prato: ${tally.prato} | NULL (sem qualificado): ${tally.null} | erros: ${tally.err}`);
  console.log(`${APPLY ? 'Gravados' : 'Qualificados'}: ${tally.ambiente + tally.prato}/${rows.length}`);
  await pool.end();
})();
