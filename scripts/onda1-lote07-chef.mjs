// LOTE 07 — Scrape chef name from official websites of publicados without chef.
// Strategy:
//   1. JSON-LD schema.org — look for Person with role chef, or Restaurant.employee
//   2. Open Graph / meta tags
//   3. Text patterns: "Chef X", "Chef de cuisine X", "Chef Executif X", "Notre chef X", "Head Chef X"
// Confidence:
//   HIGH — JSON-LD match with structured role
//   MEDIUM — text pattern with surrounding context
//   Skip the rest
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
const limit = parseInt(args.find(a => a.startsWith('--limit='))?.split('=')[1] || '0', 10) || null;

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const AGENT = 'twk-db-architect';

process.on('unhandledRejection', e => console.error('[unhandled]', e?.message || e));
process.on('uncaughtException',  e => console.error('[uncaught]',  e?.message || e));

async function fetchSite(url) {
  return axios.get(url, {
    timeout: 12000, maxRedirects: 5, validateStatus: () => true,
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; TWK-Curator/1.0)',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'en,pt,fr,it,es;q=0.8',
    },
  });
}

// Patterns to detect chef in text — multilingual
const CHEF_PATTERNS = [
  // "Chef NAME" — match Title-Cased name of 1-3 words after "Chef" or "Chef de cuisine" or "chef executif"
  /(?:Executive Chef|Head Chef|Chef de Cuisine|Chef Exécutif|Chef Executivo|Chefe Executivo|Chef|Chef Patron|Chef-Owner|Chef-Patron)\s*:?\s+([A-ZÀ-Ý][\p{L}'\-]{1,20}(?:\s+[A-ZÀ-Ý][\p{L}'\-]{1,25}){1,3})/gu,
  // "by/par/von NAME, chef"
  /(?:by|par|von)\s+([A-ZÀ-Ý][\p{L}'\-]{1,20}(?:\s+[A-ZÀ-Ý][\p{L}'\-]{1,25}){1,3})\s*[,.]?\s*(?:Chef|head\s+chef|executive\s+chef)/gu,
  // "NAME is our chef" / "NAME is the chef"
  /([A-ZÀ-Ý][\p{L}'\-]{1,20}(?:\s+[A-ZÀ-Ý][\p{L}'\-]{1,25}){1,3})\s+is\s+(?:our|the)\s+(?:executive\s+|head\s+)?chef/gu,
];

const CHEF_STOPWORDS = new Set([
  'Chef','Cuisine','Restaurant','Kitchen','Cocina','Cuisine','Cozinha',
  'House','Maison','Family','La','Le','Les','El','Os','Os','The','And','Of',
  'Wine','Bar','Hotel','Resort','Group','Team','Membership','Club','Office',
  'Welcome','About','Contact','Reservation','Menu','Booking','Story','Vision',
]);

function cleanName(raw) {
  if (!raw) return null;
  let s = raw.replace(/\s+/g, ' ').trim();
  // Strip trailing punctuation
  s = s.replace(/[.,;:!?\s]+$/, '');
  if (s.length < 4 || s.length > 60) return null;
  // Reject single word
  const parts = s.split(/\s+/);
  if (parts.length < 2) return null;
  // Reject if any part is a stopword (likely false positive)
  if (parts.some(p => CHEF_STOPWORDS.has(p))) return null;
  // Must be at least 2 Title-Cased parts
  if (!parts.every(p => /^[A-ZÀ-Ý]/u.test(p))) return null;
  return s;
}

function parseJsonLd($) {
  const candidates = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const txt = $(el).contents().text();
    if (!txt) return;
    try {
      const data = JSON.parse(txt);
      const items = Array.isArray(data) ? data : (data['@graph'] ? data['@graph'] : [data]);
      for (const it of items) {
        if (!it || typeof it !== 'object') continue;
        const t = it['@type'];
        // Look for Restaurant.employee or chef role
        if (t === 'Restaurant' || t === 'FoodEstablishment' || (Array.isArray(t) && t.includes('Restaurant'))) {
          // employee can be Person or array
          for (const key of ['employee','chef','founder','member']) {
            const v = it[key];
            if (!v) continue;
            const arr = Array.isArray(v) ? v : [v];
            for (const p of arr) {
              if (!p) continue;
              if (typeof p === 'string') candidates.push({ name: p, src: `jsonld.${key}` });
              else if (p.name) candidates.push({ name: p.name, src: `jsonld.${key}`, jobTitle: p.jobTitle });
            }
          }
        }
        if (t === 'Person' && (it.jobTitle || '').toLowerCase().includes('chef')) {
          candidates.push({ name: it.name, src: 'jsonld.person', jobTitle: it.jobTitle });
        }
      }
    } catch {}
  });
  return candidates;
}

async function scrapeChef(siteUrl) {
  let r;
  try { r = await fetchSite(siteUrl); } catch (e) { return { error: `fetch: ${e.code || e.message}` }; }
  if (!r || r.status !== 200 || typeof r.data !== 'string') return { error: `HTTP ${r?.status || 'no'}` };
  let html = r.data; if (html.length > 2_000_000) html = html.slice(0, 2_000_000);
  let $;
  try { $ = cheerio.load(html); } catch { return { error: 'cheerio' }; }

  // 1. JSON-LD
  const ldCandidates = parseJsonLd($);
  for (const c of ldCandidates) {
    const clean = cleanName(c.name);
    if (clean) return { name: clean, confidence: 'HIGH', method: c.src, jobTitle: c.jobTitle };
  }

  // 2. Text patterns
  try { $('script, style, noscript').remove(); } catch {}
  let text;
  try { text = $('body').text().replace(/\s+/g, ' '); } catch { text = ''; }
  if (text.length > 300_000) text = text.slice(0, 300_000);

  const found = new Map();   // name -> count
  for (const re of CHEF_PATTERNS) {
    let m;
    while ((m = re.exec(text)) !== null) {
      const clean = cleanName(m[1]);
      if (clean) found.set(clean, (found.get(clean) || 0) + 1);
    }
  }
  if (found.size === 0) return { error: 'no chef found' };
  const sorted = [...found.entries()].sort((a,b) => b[1]-a[1]);
  return { name: sorted[0][0], confidence: sorted[0][1] >= 2 ? 'MEDIUM' : 'MEDIUM', method: 'text-pattern', occurrences: sorted[0][1] };
}

let sql = `
  SELECT restaurant_id, name, city, country, site_url
  FROM public.db_restaurants
  WHERE published = true
    AND (chef_name IS NULL OR chef_name = '')
    AND site_url IS NOT NULL AND site_url <> ''
  ORDER BY restaurant_id`;
if (limit) sql += ` LIMIT ${limit}`;
const rows = (await pool.query(sql)).rows;
console.log(`Alvo: ${rows.length} publicados sem chef com site_url.`);

const propPath = 'audit-output/onda1-lote07-chef-proposals.csv';
const errPath  = 'audit-output/onda1-lote07-chef-errors.csv';
const propStream = fs.createWriteStream(propPath);
const errStream  = fs.createWriteStream(errPath);
propStream.write('restaurant_id,name,city,country,site_url,proposed_chef,confidence,method,occurrences,jobTitle\n');
errStream.write('restaurant_id,name,site_url,reason\n');
function csvEsc(v){if(v==null)return '';const s=String(v);return /[",\n;]/.test(s)?`"${s.replace(/"/g,'""')}"`:s;}
function csvRow(arr){return arr.map(csvEsc).join(',');}

let n_ok = 0, n_err = 0, n_high = 0, n_medium = 0;
const proposals = [];
const t0 = Date.now();

for (let i = 0; i < rows.length; i++) {
  const r = rows[i];
  try {
    const res = await Promise.race([
      scrapeChef(r.site_url),
      new Promise(rs => setTimeout(() => rs({ error: 'overall_timeout' }), 22000)),
    ]);
    if (res.error) {
      n_err++;
      errStream.write(csvRow([r.restaurant_id, r.name, r.site_url, res.error]) + '\n');
    } else {
      n_ok++;
      if (res.confidence === 'HIGH') n_high++; else n_medium++;
      propStream.write(csvRow([r.restaurant_id, r.name, r.city, r.country, r.site_url, res.name, res.confidence, res.method, res.occurrences || '', res.jobTitle || '']) + '\n');
      proposals.push({ ...r, ...res });
    }
  } catch (e) {
    n_err++;
    errStream.write(csvRow([r.restaurant_id, r.name, r.site_url, `EXC: ${e.message}`]) + '\n');
  }
  if ((i+1) % 50 === 0) {
    const eta = (Date.now()-t0)/(i+1) * (rows.length-(i+1)) / 1000;
    console.log(`  [${i+1}/${rows.length}] ok=${n_ok} err=${n_err} high=${n_high} medium=${n_medium} | eta=${(eta/60).toFixed(1)}min`);
  }
  await new Promise(s => setTimeout(s, 250));
}
propStream.end(); errStream.end();

fs.writeFileSync('audit-output/onda1-lote07-summary.json', JSON.stringify({
  mode, generated_at: new Date().toISOString(), target_count: rows.length,
  found: n_ok, errors: n_err, confidence: { HIGH: n_high, MEDIUM: n_medium },
  elapsed_seconds: Math.round((Date.now()-t0)/1000),
}, null, 2));

console.log(`\nFinal: encontrados=${n_ok}/${rows.length} | erros=${n_err}`);
console.log(`Confiança: HIGH=${n_high} MEDIUM=${n_medium}`);

if (mode === 'propose') {
  console.log('\n>>> PROPOSE: nada gravado. <<<');
  await pool.end();
  process.exit(0);
}
await pool.end();
