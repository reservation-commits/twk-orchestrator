// PHASE 2 — READ-ONLY per-establishment completeness audit.
// Computes data_completeness_score (0-100) per restaurant + missing-fields list
// classified into CRITICAL / IMPORTANT / ENRICHMENT.
import fs from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';

const envPath = path.resolve(process.cwd(), '.env.local');
for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// ------------------------------------------------------------------
// Scoring model — sum = 100
// ------------------------------------------------------------------
// CRITICAL (concierge can't operate without these)
//   name                     5
//   address                  4
//   city                     4
//   country                  4
//   place_id                 4    => 21 (identity block)
//   latitude+longitude      10
//   timezone                 4
//   phone (E.164 lookalike)  8
//   contact channel
//     (site|booking|email)  10
//   hours
//     (json OR opening_hours)12
// Total CRITICAL              =  65
//
// IMPORTANT (discovery)
//   price_range_id           5
//   cuisines (via map)       5
//   about (any locale)       5
//   images (≥3 + logo)       8
// Total IMPORTANT             =  23
//
// ENRICHMENT (premium polish + governance)
//   chef_name                2
//   reservation_policy       2
//   awards (michelin|new)    2
//   governance freshness     6
// Total ENRICHMENT            =  12
//
// Grand total                 = 100
// ------------------------------------------------------------------

const WEIGHTS = {
  // critical
  name: 5, address: 4, city: 4, country: 4, place_id: 4,
  coords: 10, timezone: 4, phone: 8, contact_channel: 10, hours: 12,
  // important
  price: 5, cuisines: 5, about: 5, images: 8,
  // enrichment
  chef: 2, reservation_policy: 2, awards: 2, governance: 6,
};
const CRITICAL_FIELDS  = ['name','address','city','country','place_id','coords','timezone','phone','contact_channel','hours'];
const IMPORTANT_FIELDS = ['price','cuisines','about','images'];
const ENRICHMENT_FIELDS= ['chef','reservation_policy','awards','governance'];

const q = (sql, p=[]) => pool.query(sql, p).then(r => r.rows);

console.log('Carregando restaurantes...');
const rows = await q(`
  SELECT
    r.restaurant_id,
    r.name,
    r.city,
    r.country,
    r.country_code,
    r.published,
    r.operational_status,
    r.partner,
    r.address_of_establishment            AS address,
    r.place_id,
    r.latitude,
    r.longitude,
    r.timezone,
    r.telephone_of_the_establishment      AS phone,
    r.email_for_reservations              AS email,
    r.site_url,
    r.booking_url,
    CASE WHEN r.business_hours_json IS NOT NULL
              AND r.business_hours_json::text NOT IN ('null','{}','[]') THEN 1 ELSE 0 END AS hours_json_present,
    (SELECT COUNT(*) FROM public.opening_hours oh WHERE oh.restaurant_id = r.restaurant_id) AS oh_count,
    r.price_range_id,
    (SELECT COUNT(*) FROM public.restaurant_category_map m WHERE m.restaurant_id = r.restaurant_id) AS cuisine_count,
    r.about_pt, r.about_en, r.about_fr, r.about_text,
    -- images_json is an object {cover, logo, slider, gallery}
    -- "gallery" array length is the curatorial photo count
    CASE WHEN r.images_json IS NULL THEN 0
         WHEN jsonb_typeof(r.images_json) <> 'object' THEN 0
         WHEN jsonb_typeof(COALESCE(r.images_json->'gallery','null'::jsonb)) = 'array'
              THEN jsonb_array_length(r.images_json->'gallery')
         ELSE 0 END                                  AS gallery_count,
    CASE WHEN r.images_json IS NULL THEN 0
         WHEN jsonb_typeof(r.images_json) <> 'object' THEN 0
         WHEN (r.images_json ? 'cover')
              AND jsonb_typeof(r.images_json->'cover') = 'object'
              AND COALESCE(r.images_json->'cover'->>'source_url','') <> '' THEN 1
         ELSE 0 END                                  AS has_cover,
    r.logo_url,
    r.chef_name,
    r.reservation_policy,
    r.michelin_id,
    (SELECT COUNT(*) FROM public.restaurant_awards a WHERE a.restaurant_id = r.restaurant_id) AS awards_count,
    r.last_verified_at,
    r.confidence_level
  FROM public.db_restaurants r
`);
console.log(`Total: ${rows.length} restaurantes.`);

function notEmpty(s) { return s !== null && s !== undefined && String(s).trim() !== ''; }

const audited = [];
for (const r of rows) {
  // Per-field presence
  const have = {
    name:            notEmpty(r.name),
    address:         notEmpty(r.address),
    city:            notEmpty(r.city),
    country:         notEmpty(r.country),
    place_id:        notEmpty(r.place_id),
    coords:          r.latitude !== null && r.longitude !== null,
    timezone:        notEmpty(r.timezone),
    phone:           notEmpty(r.phone),
    contact_channel: notEmpty(r.site_url) || notEmpty(r.booking_url) || notEmpty(r.email),
    hours:           Number(r.hours_json_present) === 1 || Number(r.oh_count) >= 1,
    price:           r.price_range_id !== null,
    cuisines:        Number(r.cuisine_count) >= 1,
    about:           notEmpty(r.about_pt) || notEmpty(r.about_en) || notEmpty(r.about_fr) || notEmpty(r.about_text),
    // "Premium gallery": cover OK + at least 3 gallery photos + logo_url
    images:          Number(r.has_cover) === 1 && Number(r.gallery_count) >= 3 && notEmpty(r.logo_url),
    chef:            notEmpty(r.chef_name),
    reservation_policy: notEmpty(r.reservation_policy),
    awards:          Number(r.awards_count) >= 1 || r.michelin_id !== null,
    governance:      r.last_verified_at !== null
                     && (new Date() - new Date(r.last_verified_at)) < 180*24*3600*1000
                     && ['HIGH','MEDIUM'].includes(r.confidence_level || ''),
  };

  let score = 0;
  const critical_missing = [], important_missing = [], enrichment_missing = [];
  for (const f of CRITICAL_FIELDS)   { if (have[f]) score += WEIGHTS[f]; else critical_missing.push(f); }
  for (const f of IMPORTANT_FIELDS)  { if (have[f]) score += WEIGHTS[f]; else important_missing.push(f); }
  for (const f of ENRICHMENT_FIELDS) { if (have[f]) score += WEIGHTS[f]; else enrichment_missing.push(f); }

  audited.push({
    restaurant_id: r.restaurant_id,
    name: r.name,
    city: r.city,
    country: r.country,
    published: r.published,
    operational_status: r.operational_status,
    partner: r.partner,
    score,
    critical_missing: critical_missing.join('|'),
    important_missing: important_missing.join('|'),
    enrichment_missing: enrichment_missing.join('|'),
    critical_count: critical_missing.length,
    important_count: important_missing.length,
    enrichment_count: enrichment_missing.length,
  });
}

// CSV helper
function toCsv(items, columns) {
  const esc = v => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s;
  };
  const head = columns.join(',');
  const body = items.map(it => columns.map(c => esc(it[c])).join(',')).join('\n');
  return head + '\n' + body + '\n';
}

// 1. Full per-establishment audit
fs.writeFileSync(
  'audit-output/phase2-per-establishment.csv',
  toCsv(audited, ['restaurant_id','name','city','country','published','operational_status','partner','score',
    'critical_count','important_count','enrichment_count','critical_missing','important_missing','enrichment_missing'])
);

// 2. Action plan: published first, sorted by impact (critical_count DESC, score ASC)
const actionPlan = audited
  .filter(a => a.published === true)
  .sort((a,b) => (b.critical_count - a.critical_count) || (a.score - b.score));
fs.writeFileSync(
  'audit-output/phase2-action-plan.csv',
  toCsv(actionPlan, ['restaurant_id','name','city','country','score','critical_count','critical_missing','important_missing','enrichment_missing'])
);

// 3. Aggregate stats
const buckets = { '0-20':0, '20-40':0, '40-60':0, '60-80':0, '80-100':0 };
let totalScore = 0, pubScore = 0, pubCount = 0;
for (const a of audited) {
  totalScore += a.score;
  if (a.published) { pubScore += a.score; pubCount++; }
  if (a.score < 20) buckets['0-20']++;
  else if (a.score < 40) buckets['20-40']++;
  else if (a.score < 60) buckets['40-60']++;
  else if (a.score < 80) buckets['60-80']++;
  else buckets['80-100']++;
}

const fieldMissCounts = {}; // for published only
for (const a of actionPlan) {
  for (const f of (a.critical_missing.split('|').filter(Boolean))) fieldMissCounts[f] = (fieldMissCounts[f]||0)+1;
  for (const f of (a.important_missing.split('|').filter(Boolean))) fieldMissCounts[f] = (fieldMissCounts[f]||0)+1;
  for (const f of (a.enrichment_missing.split('|').filter(Boolean))) fieldMissCounts[f] = (fieldMissCounts[f]||0)+1;
}

// Country-level average for published
const byCountry = {};
for (const a of actionPlan) {
  const k = a.country || '(sem país)';
  if (!byCountry[k]) byCountry[k] = { count: 0, sum: 0 };
  byCountry[k].count++; byCountry[k].sum += a.score;
}
const countryRanking = Object.entries(byCountry)
  .map(([country, v]) => ({ country, n: v.count, avg_score: +(v.sum/v.count).toFixed(1) }))
  .filter(x => x.n >= 5)
  .sort((a,b) => a.avg_score - b.avg_score);

const stats = {
  generated_at: new Date().toISOString(),
  total_restaurants: audited.length,
  published_count: pubCount,
  avg_score_all: +(totalScore / audited.length).toFixed(2),
  avg_score_published: +(pubScore / pubCount).toFixed(2),
  score_distribution: buckets,
  fields_missing_among_published_top: Object.entries(fieldMissCounts).sort((a,b)=>b[1]-a[1]).slice(0,20),
  worst_countries_by_avg_score: countryRanking.slice(0, 10),
  best_countries_by_avg_score: countryRanking.slice(-10).reverse(),
};
fs.writeFileSync('audit-output/phase2-stats.json', JSON.stringify(stats, null, 2));

console.log(`Score médio (todos):       ${stats.avg_score_all}`);
console.log(`Score médio (publicados):  ${stats.avg_score_published}`);
console.log('Distribuição:', stats.score_distribution);
console.log('Arquivos:');
console.log('  audit-output/phase2-per-establishment.csv');
console.log('  audit-output/phase2-action-plan.csv');
console.log('  audit-output/phase2-stats.json');

await pool.end();
