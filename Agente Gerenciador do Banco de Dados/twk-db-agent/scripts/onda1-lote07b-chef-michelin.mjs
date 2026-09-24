// LOTE 07b — Chef scraping FOCUSED on restaurants with Michelin awards.
// Designed to be re-run safely (skips already-processed IDs from previous CSVs).
// Auto-applies HIGH on the fly (--execute) — no separate apply step.
import fs from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';
import axios from 'axios';
import * as cheerio from 'cheerio';

const envPath = path.resolve(process.cwd(), '.env.local');
for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
}

const args = process.argv.slice(2);
const apply = args.includes('--execute');
const limit = parseInt(args.find(a => a.startsWith('--limit='))?.split('=')[1] || '0', 10) || null;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const AGENT = 'twk-db-architect';

process.on('unhandledRejection', e => console.error('[unhandled]', e?.message || e));
process.on('uncaughtException',  e => console.error('[uncaught]',  e?.message || e));

const CHEF_PATTERNS = [
  /(?:Executive Chef|Head Chef|Chef de Cuisine|Chef Exécutif|Chef Executivo|Chefe Executivo|Chef Patron|Chef-Owner|Chef-Patron|Chef de cocina|Chef)\s*:?\s+([A-ZÀ-Ý][\p{L}'\-]{1,20}(?:\s+[A-ZÀ-Ý][\p{L}'\-]{1,25}){1,3})/gu,
  /(?:by|par|von|de)\s+([A-ZÀ-Ý][\p{L}'\-]{1,20}(?:\s+[A-ZÀ-Ý][\p{L}'\-]{1,25}){1,3})\s*[,.]?\s*(?:Chef|head\s+chef|executive\s+chef)/gu,
];
const STOPS = new Set([
  'Chef','Cuisine','Restaurant','Kitchen','Cocina','Cozinha',
  'House','Maison','Family','La','Le','Les','El','Os','The','And','Of',
  'Wine','Bar','Hotel','Resort','Group','Team','Membership','Club',
  'Welcome','About','Contact','Reservation','Menu','Booking','Story','Vision',
  'Star','Stars','Michelin','Guide','Bib','Gourmand','Awards','Award',
  'Chef-Owner','Chef-Patron','Patron','Owner','Founder',
]);

function cleanName(raw) {
  if (!raw) return null;
  let s = raw.replace(/\s+/g, ' ').trim().replace(/[.,;:!?\s]+$/, '');
  if (s.length < 4 || s.length > 60) return null;
  const parts = s.split(/\s+/);
  if (parts.length < 2 || parts.length > 4) return null;
  if (parts.some(p => STOPS.has(p))) return null;
  if (!parts.every(p => /^[A-ZÀ-Ý]/u.test(p))) return null;
  return s;
}

function parseJsonLd($) {
  const out = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const txt = $(el).contents().text(); if (!txt) return;
      const data = JSON.parse(txt);
      const items = Array.isArray(data) ? data : (data['@graph'] ? data['@graph'] : [data]);
      for (const it of items) {
        if (!it || typeof it !== 'object') continue;
        const t = it['@type'];
        if (t === 'Restaurant' || t === 'FoodEstablishment' || (Array.isArray(t) && t.includes('Restaurant'))) {
          for (const key of ['employee','chef','founder','member']) {
            const v = it[key]; if (!v) continue;
            const arr = Array.isArray(v) ? v : [v];
            for (const p of arr) {
              if (!p) continue;
              if (typeof p === 'string') out.push({ name: p, src: `jsonld.${key}` });
              else if (p.name) out.push({ name: p.name, src: `jsonld.${key}`, jobTitle: p.jobTitle });
            }
          }
        }
        if (t === 'Person' && (it.jobTitle || '').toLowerCase().includes('chef')) {
          out.push({ name: it.name, src: 'jsonld.person', jobTitle: it.jobTitle });
        }
      }
    } catch {}
  });
  return out;
}

async function fetchSite(url) {
  return axios.get(url, {
    timeout: 12000, maxRedirects: 5, validateStatus: () => true,
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TWK-Curator/1.0)', 'Accept': 'text/html', 'Accept-Language': 'en,pt,fr,it;q=0.8' },
  });
}

async function scrape(siteUrl) {
  let r;
  try { r = await fetchSite(siteUrl); } catch (e) { return { error: `fetch: ${e.code || e.message}` }; }
  if (!r || r.status !== 200 || typeof r.data !== 'string') return { error: `HTTP ${r?.status || 'no'}` };
  let html = r.data; if (html.length > 1_500_000) html = html.slice(0, 1_500_000);
  let $;
  try { $ = cheerio.load(html); } catch { return { error: 'cheerio' }; }
  for (const c of parseJsonLd($)) {
    const clean = cleanName(c.name);
    if (clean) return { name: clean, confidence: 'HIGH', method: c.src, jobTitle: c.jobTitle };
  }
  try { $('script, style, noscript').remove(); } catch {}
  let text;
  try { text = $('body').text().replace(/\s+/g, ' '); } catch { text = ''; }
  if (text.length > 250_000) text = text.slice(0, 250_000);
  const found = new Map();
  for (const re of CHEF_PATTERNS) {
    let m; while ((m = re.exec(text)) !== null) {
      const clean = cleanName(m[1]);
      if (clean) found.set(clean, (found.get(clean) || 0) + 1);
    }
  }
  if (!found.size) return { error: 'no chef found' };
  const sorted = [...found.entries()].sort((a,b) => b[1]-a[1]);
  return { name: sorted[0][0], confidence: 'MEDIUM', method: 'text-pattern', occurrences: sorted[0][1] };
}

// Universe: published + has Michelin award + no chef_name + has site_url
const rowsRaw = (await pool.query(`
  SELECT DISTINCT r.restaurant_id, r.name, r.city, r.country, r.site_url,
         (SELECT MAX(CASE award_code
                       WHEN 'michelin_star' THEN level::text
                       ELSE award_code END)
          FROM public.restaurant_awards a WHERE a.restaurant_id = r.restaurant_id) AS award
  FROM public.db_restaurants r
  JOIN public.restaurant_awards a ON a.restaurant_id = r.restaurant_id
  WHERE r.published = true
    AND (r.chef_name IS NULL OR r.chef_name = '')
    AND r.site_url IS NOT NULL AND r.site_url <> ''
  ORDER BY r.restaurant_id`)).rows;

// Resume: skip already-processed IDs from PROPOSALS or ERRORS CSV
const propPath = 'audit-output/onda1-lote07b-chef-michelin-proposals.csv';
const errPath  = 'audit-output/onda1-lote07b-chef-michelin-errors.csv';
const seen = new Set();
for (const p of [propPath, errPath]) {
  if (!fs.existsSync(p)) continue;
  const txt = fs.readFileSync(p, 'utf8');
  for (const line of txt.split('\n').slice(1)) {
    const id = line.split(',')[0]; if (id) seen.add(id);
  }
}
const rows = rowsRaw.filter(r => !seen.has(r.restaurant_id));
const targets = limit ? rows.slice(0, limit) : rows;
console.log(`Universo Michelin sem chef com site: ${rowsRaw.length} | já processados: ${seen.size} | a fazer agora: ${targets.length}`);

const needHeader = !fs.existsSync(propPath);
const propStream = fs.createWriteStream(propPath, { flags: 'a' });
const errStream  = fs.createWriteStream(errPath,  { flags: 'a' });
if (needHeader) {
  propStream.write('restaurant_id,name,city,country,site_url,award,proposed_chef,confidence,method,occurrences,jobTitle,applied\n');
  errStream.write('restaurant_id,name,site_url,reason\n');
}
function csvEsc(v){if(v==null)return '';const s=String(v);return /[",\n;]/.test(s)?`"${s.replace(/"/g,'""')}"`:s;}
function csvRow(arr){return arr.map(csvEsc).join(',');}

const now = new Date().toISOString();
let n_ok = 0, n_err = 0, n_high = 0, n_medium = 0, n_applied = 0;
const t0 = Date.now();

async function applyHigh(p, res) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const entry = {
      field: 'chef_name', old_value: null, new_value: res.name,
      source: `scrape:${p.site_url}`, verified_at: now, confidence: 'HIGH',
      agent: AGENT, batch: 'onda1-lote07b', method: res.method,
      jobTitle: res.jobTitle || undefined,
    };
    await client.query(`
      UPDATE public.db_restaurants
         SET chef_name = COALESCE(chef_name, $2),
             last_verified_at = $3::timestamptz,
             verification_source = COALESCE(verification_source, $4),
             confidence_level = COALESCE(confidence_level, 'HIGH'),
             enrichment_log = enrichment_log || $5::jsonb
       WHERE restaurant_id = $1`,
      [p.restaurant_id, res.name, now, `scrape:${p.site_url}`, JSON.stringify([entry])]);
    await client.query(`
      INSERT INTO public.restaurant_field_verifications
        (restaurant_id, field_name, value_hash, source, source_kind, verified_at, confidence_level, agent, notes)
      VALUES ($1, 'chef_name', md5($2), $3, 'official_site', $4::timestamptz, 'HIGH', $5, 'onda1-lote07b')`,
      [p.restaurant_id, res.name, `scrape:${p.site_url}`, now, AGENT]);
    await client.query('COMMIT');
    return true;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch {}
    return false;
  } finally { client.release(); }
}

for (let i = 0; i < targets.length; i++) {
  const r = targets[i];
  try {
    const res = await Promise.race([
      scrape(r.site_url),
      new Promise(rs => setTimeout(() => rs({ error: 'overall_timeout' }), 20000)),
    ]);
    if (res.error) {
      n_err++;
      errStream.write(csvRow([r.restaurant_id, r.name, r.site_url, res.error]) + '\n');
    } else {
      n_ok++;
      let applied = '';
      if (res.confidence === 'HIGH') { n_high++; if (apply) { const ok = await applyHigh(r, res); applied = ok ? 'yes' : 'fail'; if (ok) n_applied++; } }
      else n_medium++;
      propStream.write(csvRow([r.restaurant_id, r.name, r.city, r.country, r.site_url, r.award, res.name, res.confidence, res.method, res.occurrences || '', res.jobTitle || '', applied]) + '\n');
    }
  } catch (e) {
    n_err++;
    errStream.write(csvRow([r.restaurant_id, r.name, r.site_url, `EXC: ${e.message}`]) + '\n');
  }
  if ((i+1) % 25 === 0 || i === targets.length - 1) {
    const eta = targets.length > i+1 ? ((Date.now()-t0)/(i+1) * (targets.length-(i+1)) / 1000).toFixed(0) : 0;
    console.log(`  [${i+1}/${targets.length}] ok=${n_ok} err=${n_err} high=${n_high} medium=${n_medium} applied=${n_applied} eta=${eta}s`);
  }
  await new Promise(s => setTimeout(s, 250));
}
propStream.end(); errStream.end();

console.log(`\nResultado: ok=${n_ok}/${targets.length} | erros=${n_err} | HIGH=${n_high} | MEDIUM=${n_medium} | aplicados=${n_applied}`);
await pool.end();
