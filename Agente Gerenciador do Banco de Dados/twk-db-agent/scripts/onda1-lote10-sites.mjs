// LOTE 10 — Find official websites for publicados without site.
// Uses Brave Search API. Filters out aggregators (TripAdvisor, OpenTable, etc.)
// Modes: (default) propose, --execute apply UPDATEs
import fs from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';
import axios from 'axios';

const envPath = path.resolve(process.cwd(), '.env.local');
for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
}

const args = process.argv.slice(2);
const mode = args.includes('--execute') ? 'execute' : 'propose';
const BRAVE_KEY = process.env.BRAVE_SEARCH_API_KEY;
if (!BRAVE_KEY) { console.error('BRAVE_SEARCH_API_KEY ausente'); process.exit(1); }

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const AGENT = 'twk-db-architect';

const BLACKLIST_HOSTS = [
  'tripadvisor', 'yelp', 'opentable', 'thefork', 'lafourchette',
  'google.com', 'maps.google', 'facebook.com', 'instagram.com', 'tiktok.com',
  'youtube.com', 'twitter.com', 'x.com', 'pinterest', 'linkedin',
  'wikipedia.org', 'theworldkeys.com', 'restaurantguru', 'sluurpy',
  'thefork.fr', 'thefork.com', 'gault-millau', 'guide.michelin.com',
  'theworlds50best.com', 'foursquare', 'zomato', 'happycow',
];

function looksLikeAggregator(host) {
  const h = host.toLowerCase();
  return BLACKLIST_HOSTS.some(b => h.includes(b));
}

async function search(name, city, country) {
  const q = `"${name}" ${city} ${country} restaurant`;
  const r = await axios.get('https://api.search.brave.com/res/v1/web/search', {
    params: { q, count: 10, country: 'all' },
    headers: { 'X-Subscription-Token': BRAVE_KEY, 'Accept': 'application/json' },
    timeout: 15000,
    validateStatus: () => true,
  });
  if (r.status !== 200) return { error: `Brave HTTP ${r.status}`, data: r.data };
  const results = r.data?.web?.results || [];

  for (const item of results) {
    try {
      const u = new URL(item.url);
      const host = u.hostname;
      if (looksLikeAggregator(host)) continue;
      // Heuristic: title or url should mention the name
      const nameKey = name.toLowerCase().replace(/[^a-z0-9]/g, '');
      const haystack = (item.title + ' ' + item.url + ' ' + (item.description || '')).toLowerCase().replace(/[^a-z0-9]/g, '');
      const titleHasName = haystack.includes(nameKey);
      return {
        proposed_site: `https://${host}${u.pathname.replace(/\/+$/,'') || ''}` || u.origin + '/',
        full_url: item.url,
        title: item.title,
        host,
        description: item.description,
        confidence: titleHasName ? 'HIGH' : 'MEDIUM',
      };
    } catch {}
  }
  return { error: 'no clean result' };
}

const rows = (await pool.query(`
  SELECT restaurant_id, name, city, country
  FROM public.db_restaurants
  WHERE published = true
    AND (site_url IS NULL OR site_url = '')
  ORDER BY restaurant_id`)).rows;
console.log(`Alvo: ${rows.length} publicados sem site.`);

const outDir = 'audit-output';
fs.mkdirSync(outDir, { recursive: true });
const propPath = path.join(outDir, 'onda1-lote10-sites-proposals.csv');
const errPath = path.join(outDir, 'onda1-lote10-sites-errors.csv');
const propStream = fs.createWriteStream(propPath);
const errStream = fs.createWriteStream(errPath);
propStream.write('restaurant_id,name,city,country,proposed_site,full_url,host,title,confidence\n');
errStream.write('restaurant_id,name,city,reason,detail\n');
function csvEsc(v){if(v==null)return '';const s=String(v);return /[",\n;]/.test(s)?`"${s.replace(/"/g,'""')}"`:s;}
function csvRow(arr){return arr.map(csvEsc).join(',');}

let n_ok = 0, n_err = 0, n_high = 0, n_medium = 0;
const proposals = [];

for (let i = 0; i < rows.length; i++) {
  const r = rows[i];
  try {
    const res = await search(r.name, r.city || '', r.country || '');
    if (res.error) {
      n_err++;
      errStream.write(csvRow([r.restaurant_id, r.name, r.city, res.error, '']) + '\n');
    } else {
      n_ok++;
      if (res.confidence === 'HIGH') n_high++; else n_medium++;
      propStream.write(csvRow([r.restaurant_id, r.name, r.city, r.country, res.full_url, res.full_url, res.host, res.title, res.confidence]) + '\n');
      proposals.push({ ...r, ...res });
    }
  } catch (e) {
    n_err++;
    errStream.write(csvRow([r.restaurant_id, r.name, r.city, 'EXCEPTION', e.message]) + '\n');
  }
  // Brave rate limit: ~1 QPS on free tier
  await new Promise(s => setTimeout(s, 1100));
  console.log(`  [${i+1}/${rows.length}] ${r.name.slice(0,30).padEnd(30)} | ok=${n_ok} err=${n_err}`);
}
propStream.end(); errStream.end();

fs.writeFileSync(path.join(outDir, 'onda1-lote10-summary.json'), JSON.stringify({
  mode, generated_at: new Date().toISOString(), target_count: rows.length,
  found: n_ok, errors: n_err, confidence: { HIGH: n_high, MEDIUM: n_medium },
}, null, 2));
console.log(`\nFinal: encontrados=${n_ok}/${rows.length} | erros=${n_err}`);
console.log(`Confiança: HIGH=${n_high} MEDIUM=${n_medium}`);

if (mode === 'propose') {
  console.log('\n>>> PROPOSE: nada gravado. Use --execute para aplicar. <<<');
  await pool.end();
  process.exit(0);
}

// ---------- EXECUTE ----------
console.log('\nAplicando UPDATEs...');
const now = new Date().toISOString();
let okN = 0, errN = 0;
for (const p of proposals) {
  if (p.confidence !== 'HIGH') continue;   // Only auto-apply HIGH
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const entry = { field:'site_url', old_value:null, new_value:p.full_url,
      source: `brave_search:${p.host}`, verified_at: now, confidence: 'HIGH',
      agent: AGENT, batch: 'onda1-lote10', title: p.title };
    await client.query(`
      UPDATE public.db_restaurants
         SET site_url = COALESCE(site_url, $2),
             last_verified_at = $3::timestamptz,
             verification_source = COALESCE(verification_source, $4),
             confidence_level = COALESCE(confidence_level, 'HIGH'),
             enrichment_log = enrichment_log || $5::jsonb
       WHERE restaurant_id = $1`,
      [p.restaurant_id, p.full_url, now, `brave_search:${p.host}`, JSON.stringify([entry])]);
    await client.query(`
      INSERT INTO public.restaurant_field_verifications
        (restaurant_id, field_name, value_hash, source, source_kind, verified_at, confidence_level, agent, notes)
      VALUES ($1, 'site_url', md5($2), $3, 'other', $4::timestamptz, 'HIGH', $5, 'onda1-lote10 — brave_search')`,
      [p.restaurant_id, p.full_url, `brave_search:${p.host}`, now, AGENT]);
    await client.query('COMMIT');
    okN++;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch {}
    errN++;
    console.log(`FAIL ${p.restaurant_id} -> ${e.message}`);
  } finally { client.release(); }
}
console.log(`\nApply: ok=${okN} err=${errN}`);
await pool.end();
process.exitCode = errN > 0 ? 1 : 0;
