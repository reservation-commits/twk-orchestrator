// LOTE 09 — Scrape phones from official websites of publicados without phone.
// Strategy:
//   1. tel: href in <a> tags (HIGH confidence)
//   2. Body text matching international phone pattern (MEDIUM confidence — flagged)
// Modes: (default) propose, --execute apply UPDATEs
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
const mode = args.includes('--execute') ? 'execute' : 'propose';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const AGENT = 'twk-db-architect';

// Survive unhandled rejections/exceptions (some restaurant sites do weird things)
process.on('unhandledRejection', (err) => {
  console.error('[unhandled rejection]', err?.message || err);
});
process.on('uncaughtException', (err) => {
  console.error('[uncaught exception]', err?.message || err);
});

function normalizePhone(raw) {
  if (!raw) return null;
  let s = String(raw).replace(/[\s ​-‏‪-‮⁠﻿]/g, '').replace(/[^\d+]/g, '');
  if (!s.startsWith('+')) return null;  // Only accept already-international format
  return /^\+\d{8,15}$/.test(s) ? s : null;
}

// Patterns we accept in body text (international format with + prefix)
const INTL_REGEX = /\+\d{1,3}[\s.\-()]?\d{1,4}[\s.\-()]?\d{2,4}[\s.\-()]?\d{2,4}[\s.\-()]?\d{2,4}/g;

async function fetchSite(url) {
  return axios.get(url, {
    timeout: 12000,
    maxRedirects: 5,
    validateStatus: () => true,
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; TWK-Curator/1.0; +https://theworldkeys.com/bot)',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'en,pt,fr;q=0.8',
    },
  });
}

async function scrapePhones(siteUrl) {
  let r;
  try { r = await fetchSite(siteUrl); }
  catch (e) { return { error: `fetch: ${e.message || e.code || 'unknown'}` }; }
  if (!r || r.status !== 200 || !r.data || typeof r.data !== 'string') {
    return { error: `HTTP ${r?.status || 'no_response'}` };
  }
  // Cap HTML at 2MB to avoid pathological pages
  const html = r.data.length > 2_000_000 ? r.data.slice(0, 2_000_000) : r.data;
  let $;
  try { $ = cheerio.load(html); }
  catch (e) { return { error: `cheerio: ${e.message}` }; }
  try { $('script, style, noscript').remove(); } catch {}

  // Strategy 1: tel: href
  const telSet = new Set();
  $('a[href^="tel:"]').each((_, el) => {
    const v = $(el).attr('href') || '';
    const num = v.replace(/^tel:/i, '').trim();
    const norm = normalizePhone(num);
    if (norm) telSet.add(norm);
  });
  if (telSet.size === 1) {
    return { phone: [...telSet][0], confidence: 'HIGH', method: 'tel-href-unique' };
  }
  if (telSet.size > 1) {
    // Multiple tel hrefs — pick most repeated, but mark MEDIUM
    return { phone: [...telSet][0], confidence: 'MEDIUM', method: 'tel-href-multiple', candidates: [...telSet] };
  }

  // Strategy 2: body text regex
  let text;
  try { text = $('body').text().replace(/\s+/g, ' '); } catch { text = ''; }
  // Cap text to first 200KB
  if (text.length > 200_000) text = text.slice(0, 200_000);
  const matches = (text.match(INTL_REGEX) || []).map(m => normalizePhone(m)).filter(Boolean);
  const counts = {};
  for (const m of matches) counts[m] = (counts[m] || 0) + 1;
  const sorted = Object.entries(counts).sort((a,b) => b[1]-a[1]);
  if (sorted.length === 1) {
    return { phone: sorted[0][0], confidence: 'MEDIUM', method: 'body-regex-unique' };
  }
  if (sorted.length > 1) {
    return { phone: sorted[0][0], confidence: 'MEDIUM', method: 'body-regex-multiple', candidates: sorted.slice(0,5).map(x=>x[0]) };
  }
  return { error: 'no phone found' };
}

const rows = (await pool.query(`
  SELECT restaurant_id, name, city, country, site_url
  FROM public.db_restaurants
  WHERE published = true
    AND (telephone_of_the_establishment IS NULL OR telephone_of_the_establishment = '')
    AND site_url IS NOT NULL AND site_url <> ''
  ORDER BY restaurant_id`)).rows;
console.log(`Alvo: ${rows.length} publicados sem phone E com site_url.`);

const outDir = 'audit-output';
fs.mkdirSync(outDir, { recursive: true });
const propPath = path.join(outDir, 'onda1-lote09-phones-proposals.csv');
const errPath = path.join(outDir, 'onda1-lote09-phones-errors.csv');
const propStream = fs.createWriteStream(propPath);
const errStream = fs.createWriteStream(errPath);
propStream.write('restaurant_id,name,city,country,site_url,proposed_phone,confidence,method,candidates\n');
errStream.write('restaurant_id,name,site_url,reason\n');
function csvEsc(v){if(v==null)return '';const s=String(v);return /[",\n;]/.test(s)?`"${s.replace(/"/g,'""')}"`:s;}
function csvRow(arr){return arr.map(csvEsc).join(',');}

let n_ok = 0, n_err = 0, n_high = 0, n_medium = 0;
const proposals = [];

// Resume support: skip rows already in CSV from a previous partial run
const seen = new Set();
const resumePath = propPath;
if (fs.existsSync(resumePath)) {
  // Don't read it here — we'll create stream fresh. (Note: this rerun starts fresh.)
}

for (let i = 0; i < rows.length; i++) {
  const r = rows[i];
  try {
    // Race: scrape with a hard 20s overall timeout
    const res = await Promise.race([
      scrapePhones(r.site_url),
      new Promise(resolve => setTimeout(() => resolve({ error: 'overall_timeout' }), 20000)),
    ]);
    if (res.error) {
      n_err++;
      errStream.write(csvRow([r.restaurant_id, r.name, r.site_url, res.error]) + '\n');
    } else {
      n_ok++;
      if (res.confidence === 'HIGH') n_high++; else n_medium++;
      propStream.write(csvRow([r.restaurant_id, r.name, r.city, r.country, r.site_url, res.phone, res.confidence, res.method, (res.candidates||[]).join('|')]) + '\n');
      proposals.push({ ...r, ...res });
    }
  } catch (e) {
    n_err++;
    errStream.write(csvRow([r.restaurant_id, r.name, r.site_url, `EXC: ${e.message}`]) + '\n');
  }
  console.log(`  [${i+1}/${rows.length}] ${r.name.slice(0,30).padEnd(30)} | ok=${n_ok} err=${n_err}`);
  await new Promise(s => setTimeout(s, 500));  // gentle pace
}
propStream.end(); errStream.end();

fs.writeFileSync(path.join(outDir, 'onda1-lote09-summary.json'), JSON.stringify({
  mode, generated_at: new Date().toISOString(), target_count: rows.length,
  found: n_ok, errors: n_err, confidence: { HIGH: n_high, MEDIUM: n_medium },
}, null, 2));
console.log(`\nFinal: encontrados=${n_ok}/${rows.length} | erros=${n_err}`);
console.log(`Confiança: HIGH=${n_high} MEDIUM=${n_medium}`);

if (mode === 'propose') {
  console.log('\n>>> PROPOSE: nada gravado. Use --execute. <<<');
  await pool.end();
  process.exit(0);
}

// ---------- EXECUTE — only HIGH confidence ----------
console.log('\nAplicando UPDATEs (apenas HIGH)...');
const now = new Date().toISOString();
let okN = 0, errN = 0, skipped = 0;
for (const p of proposals) {
  if (p.confidence !== 'HIGH') { skipped++; continue; }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const entry = { field:'telephone_of_the_establishment', old_value:null, new_value:p.phone,
      source: `scrape:${p.site_url}`, verified_at: now, confidence: 'HIGH',
      agent: AGENT, batch: 'onda1-lote09', method: p.method };
    await client.query(`
      UPDATE public.db_restaurants
         SET telephone_of_the_establishment = COALESCE(telephone_of_the_establishment, $2),
             last_verified_at = $3::timestamptz,
             verification_source = COALESCE(verification_source, $4),
             confidence_level = COALESCE(confidence_level, 'HIGH'),
             enrichment_log = enrichment_log || $5::jsonb
       WHERE restaurant_id = $1`,
      [p.restaurant_id, p.phone, now, `scrape:${p.site_url}`, JSON.stringify([entry])]);
    await client.query(`
      INSERT INTO public.restaurant_field_verifications
        (restaurant_id, field_name, value_hash, source, source_kind, verified_at, confidence_level, agent, notes)
      VALUES ($1, 'telephone_of_the_establishment', md5($2), $3, 'official_site', $4::timestamptz, 'HIGH', $5, 'onda1-lote09')`,
      [p.restaurant_id, p.phone, `scrape:${p.site_url}`, now, AGENT]);
    await client.query('COMMIT');
    okN++;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch {}
    errN++;
    console.log(`FAIL ${p.restaurant_id} -> ${e.message}`);
  } finally { client.release(); }
}
console.log(`\nApply: ok=${okN} skipped=${skipped} (MEDIUM aguarda revisão) err=${errN}`);
await pool.end();
process.exitCode = errN > 0 ? 1 : 0;
