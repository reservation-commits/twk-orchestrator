/**
 * TWK Photo Curator — multi-source capture + AI curation of restaurant photos.
 *
 * Gathers candidate images from VERIFIED sources (official site, Google Places, social,
 * TripAdvisor), gates them by real pixel size, dedups across sources, then classifies each
 * with Claude vision to keep AMBIENCE first (then dishes), dropping people / menus / low-q.
 * Targets >=5 photos: 1 landscape cover + >=4 gallery. Every candidate carries its source
 * + source_url so provenance stays auditable.
 *
 * Engine ported from the proven enrich_photos_v2.js pipeline.
 */
import axios from 'axios';
import * as cheerio from 'cheerio';
import Anthropic from '@anthropic-ai/sdk';
import { getPlaceDetails, getPlacePhotoUrls } from './places';
import { webSearch, findSocialMedia } from './scraper';
import { imageSize, dedupKey, resolutionVariants } from './image-utils';
import { pickCoverIndex } from './photo-select';

export { imageSize, resolutionVariants };

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const VISION_MODEL = 'claude-haiku-4-5-20251001';

export const COVER_MIN_W = 1500;
export const GALLERY_MIN_W = 1100;
export const SOFT_MIN_W = 700; // absolute floor: below this an image is unusable even as gallery
const MAX_FETCH_BYTES = 6 * 1024 * 1024;

export type PhotoSource = 'site' | 'places' | 'instagram' | 'facebook' | 'tripadvisor';
export type PhotoCategory = 'ambiente' | 'prato' | 'pessoa' | 'texto' | 'outro';

export interface RawCandidate { url: string; source: PhotoSource; }
export interface CuratedPhoto {
  source_url: string;
  source: PhotoSource;
  width: number;
  height: number;
  category: PhotoCategory;
  is_cover: boolean;
  alt_text: string;
  quality: 'high' | 'low'; // 'low' = below the ideal pixel bar for its role (cover/gallery)
}

export interface CaptureProgress {
  (ev:
    | { phase: 'source'; source: PhotoSource; status: 'start' | 'done'; found?: number; note?: string }
    | { phase: 'fetch'; fetched: number; total: number }
    | { phase: 'classify'; count: number }
    | { phase: 'note'; message: string }
  ): void;
}

const UA = { 'User-Agent': 'Mozilla/5.0 (compatible; TWK-Bot/1.0)', Accept: 'text/html,image/*,*/*' };
const JUNK = /logo|icon|favicon|sprite|placeholder|avatar|flag|emoji|pixel|badge|button|arrow|gravatar|cookie|loader|spinner|blank|1x1|spacer|wp-content\/plugins|\/icons?\/|social|whatsapp|facebook-icon|instagram-icon|tripadvisor-logo|paypal|visa|mastercard|border|divider|separator|ornament|pattern|texture|\bnav\b|nav-|menu-bg/i;
const IMG_EXT = /\.(jpe?g|png|webp|avif)(\?|$)/i;

const normUrl = (u?: string | null): string | null => {
  if (!u) return null; u = u.trim();
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  try { new URL(u); return u.replace(/\/+$/, ''); } catch { return null; }
};

function pickLargest(ss?: string): string | null {
  if (!ss) return null; let b: string | null = null, bw = -1;
  ss.split(',').forEach((p) => { const [u, w] = p.trim().split(/\s+/); const ww = w ? parseInt(w) : 0; if (u && ww >= bw) { bw = ww; b = u; } });
  return b;
}

export interface FetchedImage { buffer: Buffer; media_type: string; w: number; h: number; }

export async function fetchImage(url: string, minW = GALLERY_MIN_W): Promise<FetchedImage | null> {
  try {
    const r = await axios.get(url, { headers: UA, timeout: 12000, maxRedirects: 4, responseType: 'arraybuffer', validateStatus: () => true, maxContentLength: MAX_FETCH_BYTES });
    if (r.status < 200 || r.status >= 300) return null;
    let ct = String(r.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (ct === 'image/jpg') ct = 'image/jpeg';
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/avif'].includes(ct)) return null;
    const buf = Buffer.from(r.data);
    if (buf.length < 20000 || buf.length > 5 * 1024 * 1024) return null;
    const dim = imageSize(buf);
    if (!dim || !dim.w || dim.w < minW) return null;
    return { buffer: buf, media_type: ct, w: dim.w, h: dim.h };
  } catch { return null; }
}

// "Best source": fetch the largest usable version of an image — try resolution upgrades
// first, fall back to the given URL — and return whichever has the most pixels.
export async function fetchBest(url: string, minW = SOFT_MIN_W): Promise<{ img: FetchedImage; url: string } | null> {
  let best: { img: FetchedImage; url: string } | null = null;
  for (const u of [...resolutionVariants(url), url]) {
    const img = await fetchImage(u, minW);
    if (img && (!best || img.w > best.img.w)) best = { img, url: u };
  }
  return best;
}

async function fetchHtml(u: string): Promise<string | null> {
  try { const { data, status } = await axios.get(u, { headers: UA, timeout: 10000, maxRedirects: 5, validateStatus: () => true }); return status >= 200 && status < 400 && typeof data === 'string' ? data : null; } catch { return null; }
}

function extractImageUrls(html: string, baseUrl: string, limit = 14): string[] {
  const $ = cheerio.load(html);
  const abs = (u?: string) => { if (!u) return null; try { return new URL(u, baseUrl).href.split('#')[0]; } catch { return null; } };
  const raw: (string | null | undefined)[] = [];
  $('meta[property="og:image"],meta[property="og:image:secure_url"],meta[name="twitter:image"]').each((_, el) => { raw.push($(el).attr('content')); });
  $('img').each((_, el) => { const e = $(el); raw.push(e.attr('src'), e.attr('data-src'), e.attr('data-lazy-src'), pickLargest(e.attr('srcset') || e.attr('data-srcset'))); });
  $('source[srcset]').each((_, el) => { raw.push(pickLargest($(el).attr('srcset'))); });
  const seen = new Set<string>(); const out: string[] = [];
  for (const r of raw) { const u = abs(r ?? undefined); if (!u || u.startsWith('data:')) continue; if (/\.svg(\?|$)/i.test(u) || JUNK.test(u) || !IMG_EXT.test(u)) continue; const key = dedupKey(u); if (seen.has(key)) continue; seen.add(key); out.push(u); }
  return out.slice(0, limit);
}

// ── Source gatherers (each returns tagged raw candidate URLs) ────────────────
async function fromWebsite(siteUrl: string | null): Promise<RawCandidate[]> {
  const base = normUrl(siteUrl); if (!base) return [];
  const out: RawCandidate[] = []; const keys = new Set<string>();
  for (const p of ['', '/gallery', '/galerie', '/photos', '/galeria', '/about', '/le-restaurant']) {
    const html = await fetchHtml(base + p); if (!html) continue;
    for (const u of extractImageUrls(html, base + p)) { const k = dedupKey(u); if (!keys.has(k)) { keys.add(k); out.push({ url: u, source: 'site' }); } }
    if (out.length >= 16) break;
  }
  return out;
}

async function fromPlaces(placeId: string | null): Promise<RawCandidate[]> {
  if (!placeId) return [];
  try {
    const details = await getPlaceDetails(placeId);
    const refs = (details.photos ?? []).map((p) => ({ photo_reference: p.photo_reference }));
    return getPlacePhotoUrls(refs, 1600, 10).map((url) => ({ url, source: 'places' as const }));
  } catch { return []; }
}

async function fromSocial(name: string, city: string): Promise<RawCandidate[]> {
  try {
    const social = await findSocialMedia(name, city);
    const out: RawCandidate[] = [];
    for (const [net, profileUrl] of Object.entries(social)) {
      if (!profileUrl) continue;
      const html = await fetchHtml(profileUrl); if (!html) continue;
      const src: PhotoSource = net === 'facebook' ? 'facebook' : 'instagram';
      // social profiles mostly expose og:image only (login wall) — take what we can
      for (const u of extractImageUrls(html, profileUrl, 4)) out.push({ url: u, source: src });
    }
    return out;
  } catch { return []; }
}

async function fromTripAdvisor(name: string, city: string): Promise<RawCandidate[]> {
  try {
    const hits = await webSearch(`${name} ${city} site:tripadvisor.com`, 3);
    const page = hits.find((h) => /tripadvisor\./i.test(h.url));
    if (!page) return [];
    const html = await fetchHtml(page.url); if (!html) return [];
    return extractImageUrls(html, page.url, 12)
      .filter((u) => /media-cdn\.tripadvisor|tacdn\.|dynamic-media/i.test(u))
      .map((url) => ({ url, source: 'tripadvisor' as const }));
  } catch { return []; }
}

// ── Vision classification ────────────────────────────────────────────────────
interface VisionVerdict { i: number; cat: PhotoCategory; hq: boolean; person: boolean; }

async function classify(imgs: FetchedImage[]): Promise<VisionVerdict[]> {
  const content: Anthropic.ContentBlockParam[] = [{ type: 'text', text:
`Você é curador de fotos para um diretório de restaurantes de alto padrão. Para CADA imagem (na ordem), retorne um objeto:
{"i": índice 0-based, "cat": "ambiente"|"prato"|"pessoa"|"texto"|"outro", "hq": true|false, "person": true|false}
- "ambiente" = o ESPAÇO do restaurante (salão, mesas postas, decoração, interior, fachada, terraço, bar)
- "prato" = comida ou bebida servida
- "pessoa" = a foto é principalmente de pessoa(s)
- "texto" = cardápio, menu, palavras, cartaz, logotipo
- "outro" = qualquer outra coisa
- "person": true se aparecer QUALQUER pessoa, rosto, silhueta ou mãos, mesmo pequena ou ao fundo
- "hq": true só se for nítida, profissional e claramente de alta resolução
Responda APENAS o array JSON, nada mais.` }];
  imgs.forEach((im) => content.push({ type: 'image', source: { type: 'base64', media_type: im.media_type as 'image/jpeg', data: im.buffer.toString('base64') } }));
  const msg = await anthropic.messages.create({ model: VISION_MODEL, max_tokens: 900, messages: [{ role: 'user', content }] });
  const text = msg.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
  const m = text.match(/\[[\s\S]*\]/); if (!m) return [];
  try { return JSON.parse(m[0]); } catch { return []; }
}

const basename = (u: string) => { try { return decodeURIComponent(new URL(u).pathname.split('/').pop() || 'image').slice(0, 120); } catch { return 'image'; } };

export interface RestaurantForCapture {
  restaurant_id: string;
  name: string;
  city?: string | null;
  site_url?: string | null;
  place_id?: string | null;
}

export interface CaptureResult {
  photos: CuratedPhoto[];
  cover?: CuratedPhoto;
  gallery: CuratedPhoto[];
  shortfall: boolean;
  bySource: Record<string, number>;
  message: string;
}

/**
 * Capture and curate photos for one restaurant from all verified sources.
 */
export async function capturePhotos(
  r: RestaurantForCapture,
  onProgress: CaptureProgress = () => {},
  signal?: AbortSignal
): Promise<CaptureResult> {
  const city = r.city ?? '';
  const sources: { source: PhotoSource; run: () => Promise<RawCandidate[]> }[] = [
    { source: 'site', run: () => fromWebsite(r.site_url ?? null) },
    { source: 'places', run: () => fromPlaces(r.place_id ?? null) },
    { source: 'instagram', run: () => fromSocial(r.name, city) },
    { source: 'tripadvisor', run: () => fromTripAdvisor(r.name, city) },
  ];

  // 1) Gather candidates from every source (sequentially so the UI can narrate progress).
  const raw: RawCandidate[] = [];
  const keys = new Set<string>();
  for (const s of sources) {
    if (signal?.aborted) break;
    onProgress({ phase: 'source', source: s.source, status: 'start' });
    let found = 0;
    try {
      const cands = await s.run();
      for (const c of cands) { const k = dedupKey(c.url); if (!keys.has(k)) { keys.add(k); raw.push(c); found++; } }
    } catch { /* per-source failure is non-fatal */ }
    onProgress({ phase: 'source', source: s.source, status: 'done', found });
  }

  // 2) Download "best source": for each candidate try a higher-res original first and keep the
  //    largest. Soft floor only (SOFT_MIN_W) — good content below the ideal bar is kept and
  //    flagged 'low' (not dropped), so the user can still use/approve or manually upgrade it.
  const toFetch = raw.slice(0, 28);
  const fetched: { cand: RawCandidate; img: FetchedImage }[] = [];
  let i = 0;
  for (const c of toFetch) {
    if (signal?.aborted) break;
    const best = await fetchBest(c.url, SOFT_MIN_W);
    i++;
    onProgress({ phase: 'fetch', fetched: i, total: toFetch.length });
    if (best) {
      const key = dedupKey(best.url);
      const dup = fetched.find((f) => dedupKey(f.cand.url) === key);
      if (dup) { if (best.img.w > dup.img.w) { dup.img = best.img; dup.cand = { ...dup.cand, url: best.url }; } }
      else fetched.push({ cand: { source: c.source, url: best.url }, img: best.img });
    }
    if (fetched.length >= 14) break;
  }

  if (!fetched.length) {
    return { photos: [], gallery: [], shortfall: true, bySource: {}, message: 'Nenhuma imagem utilizável encontrada nas fontes.' };
  }

  // 3) Vision-classify in one batch.
  onProgress({ phase: 'classify', count: fetched.length });
  const verdicts = await classify(fetched.map((f) => f.img));
  const get = (idx: number) => verdicts.find((v) => v.i === idx) || ({ i: idx, cat: 'outro', hq: false, person: false } as VisionVerdict);

  // 4) Keep ambiente (priority) then prato; never people/menus. Low-res good content is kept
  //    and flagged via `quality` (not dropped) — "best source" instead of AI upscaling.
  type Scored = { cand: RawCandidate; img: FetchedImage; cat: PhotoCategory; hq: boolean };
  const qualified: Scored[] = fetched
    .map((f, idx) => ({ f, v: get(idx) }))
    .filter(({ v }) => (v.cat === 'ambiente' || v.cat === 'prato') && v.person !== true)
    .map(({ f, v }) => ({ cand: f.cand, img: f.img, cat: v.cat, hq: v.hq === true }));

  const ambiente = qualified.filter((q) => q.cat === 'ambiente');
  const prato = qualified.filter((q) => q.cat === 'prato');
  const byWidth = (a: Scored, b: Scored) => b.img.w - a.img.w;

  // Cover: prefer a landscape ≥ COVER_MIN_W (ambiente first); else the largest landscape; else
  // the largest image available — never return no cover when something usable exists.
  // Cover: pure, tested policy (prefers an AMBIENCE landscape — a dish is a poor hero).
  const pref = [...ambiente, ...prato];
  const coverIdx = pickCoverIndex(pref.map((q) => ({ w: q.img.w, h: q.img.h, category: q.cat as 'ambiente' | 'prato' })), COVER_MIN_W);
  const cover = coverIdx >= 0 ? pref[coverIdx] : undefined;

  // Gallery: remaining ambiente then prato, widest first, distinct from cover.
  const ordered = pref.filter((q) => q.cand.url !== cover?.cand.url).sort(byWidth);

  const mk = (q: Scored, isCover: boolean): CuratedPhoto => {
    const bar = isCover ? COVER_MIN_W : GALLERY_MIN_W;
    const quality: 'high' | 'low' = q.hq && q.img.w >= bar ? 'high' : 'low';
    return {
      source_url: q.cand.url, source: q.cand.source, width: q.img.w, height: q.img.h,
      category: q.cat, is_cover: isCover, alt_text: `${r.name}${city ? ' ' + city : ''}`, quality,
    };
  };

  const photos: CuratedPhoto[] = [];
  if (cover) photos.push(mk(cover, true));
  for (const q of ordered) photos.push(mk(q, false));

  const bySource: Record<string, number> = {};
  for (const p of photos) bySource[p.source] = (bySource[p.source] ?? 0) + 1;

  const gallery = photos.filter((p) => !p.is_cover);
  const lowCount = photos.filter((p) => p.quality === 'low').length;
  const shortfall = photos.length < 5;
  const message = shortfall
    ? `Apenas ${photos.length} foto(s) (meta: 5)${lowCount ? ` · ${lowCount} em baixa resolução` : ''}.`
    : `${photos.length} fotos: 1 capa + ${gallery.length} galeria${lowCount ? ` · ${lowCount} otimizável(is) (baixa res)` : ''}.`;

  return { photos, cover: cover ? photos[0] : undefined, gallery, shortfall, bySource, message };
}

export { basename };
