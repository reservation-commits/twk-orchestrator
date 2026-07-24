// PHASE 3 — Lot #1: Coordinates for 636 published restaurants.
// READ-ONLY toward the DB. Calls Google Places Details API only.
// Output: CSV of proposals. NO UPDATE executed.
import fs from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';

const envPath = path.resolve(process.cwd(), '.env.local');
for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
}

const API_KEY = process.env.GOOGLE_PLACES_API_KEY;
if (!API_KEY) { console.error('GOOGLE_PLACES_API_KEY ausente'); process.exit(1); }

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const q = (sql, p=[]) => pool.query(sql, p).then(r => r.rows);

const rows = await q(`
  SELECT r.restaurant_id, r.name, r.city, r.country, r.place_id,
         r.address_of_establishment AS address
    FROM public.db_restaurants r
   WHERE r.published = true
     AND r.place_id IS NOT NULL
     AND length(btrim(r.place_id)) > 0
     AND (r.latitude IS NULL OR r.longitude IS NULL)
   ORDER BY r.restaurant_id
`);
console.log(`Alvo: ${rows.length} restaurantes publicados sem coordenadas com place_id.`);

const PLACES_DETAILS = 'https://maps.googleapis.com/maps/api/place/details/json';
const FIELDS = 'geometry,url,place_id,formatted_address,name,business_status';
const DELAY_MS = 120;       // ~8 QPS — gentle and safely under Places default quota
const OUT_DIR = 'audit-output';
fs.mkdirSync(OUT_DIR, { recursive: true });
const proposalsPath = path.join(OUT_DIR, 'phase3-lot01-coordinates-proposals.csv');
const errorsPath    = path.join(OUT_DIR, 'phase3-lot01-coordinates-errors.csv');

// CSV writers (streaming, so partial state survives interruption)
const proposalsHead = [
  'restaurant_id','name','city_db','country_db','place_id_db',
  'place_id_returned','place_id_match',
  'proposed_latitude','proposed_longitude',
  'proposed_google_maps_url',
  'returned_formatted_address',
  'returned_business_status',
  'confidence_level','verified_at','source_url','api_status'
].join(',');
const errorsHead = ['restaurant_id','name','city_db','place_id','api_status','message'].join(',');

const proposalsStream = fs.createWriteStream(proposalsPath);
const errorsStream    = fs.createWriteStream(errorsPath);
proposalsStream.write(proposalsHead + '\n');
errorsStream.write(errorsHead + '\n');

function csvEscape(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s;
}
function csvRow(arr) { return arr.map(csvEscape).join(','); }

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchDetails(placeId) {
  const url = `${PLACES_DETAILS}?place_id=${encodeURIComponent(placeId)}&fields=${FIELDS}&key=${API_KEY}`;
  // retry on OVER_QUERY_LIMIT
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data.status === 'OVER_QUERY_LIMIT') {
      await sleep(2000 * (attempt + 1));
      continue;
    }
    return data;
  }
  throw new Error('OVER_QUERY_LIMIT after retries');
}

let n_ok = 0, n_err = 0, n_high = 0, n_medium = 0, n_low = 0;
const startedAt = Date.now();

for (let i = 0; i < rows.length; i++) {
  const r = rows[i];
  try {
    const data = await fetchDetails(r.place_id);
    if (data.status !== 'OK') {
      n_err++;
      errorsStream.write(csvRow([r.restaurant_id, r.name, r.city, r.place_id, data.status, data.error_message || '']) + '\n');
      if ((i+1) % 25 === 0) console.log(`  [${i+1}/${rows.length}] ok=${n_ok} err=${n_err}`);
      await sleep(DELAY_MS);
      continue;
    }
    const result = data.result || {};
    const loc = result.geometry?.location;
    if (!loc || typeof loc.lat !== 'number' || typeof loc.lng !== 'number') {
      n_err++;
      errorsStream.write(csvRow([r.restaurant_id, r.name, r.city, r.place_id, 'NO_GEOMETRY', '']) + '\n');
      await sleep(DELAY_MS);
      continue;
    }

    const pidReturned = result.place_id || '';
    const pidMatch = pidReturned === r.place_id;
    // Confidence
    let confidence = 'MEDIUM';
    if (pidMatch && (result.business_status === 'OPERATIONAL' || !result.business_status)) {
      confidence = 'HIGH';
      n_high++;
    } else if (pidMatch && result.business_status && result.business_status !== 'OPERATIONAL') {
      confidence = 'CONFLICT';
      n_low++;
    } else if (!pidMatch) {
      confidence = 'CONFLICT';   // Google's canonical place_id differs from ours
      n_low++;
    } else {
      n_medium++;
    }

    proposalsStream.write(csvRow([
      r.restaurant_id, r.name, r.city, r.country, r.place_id,
      pidReturned, pidMatch ? 'yes' : 'no',
      loc.lat, loc.lng,
      result.url || '',
      result.formatted_address || '',
      result.business_status || '',
      confidence,
      new Date().toISOString(),
      `google_places:${r.place_id}`,
      data.status,
    ]) + '\n');
    n_ok++;
  } catch (e) {
    n_err++;
    errorsStream.write(csvRow([r.restaurant_id, r.name, r.city, r.place_id, 'EXCEPTION', e.message]) + '\n');
  }
  if ((i+1) % 25 === 0) {
    const eta = (Date.now() - startedAt) / (i+1) * (rows.length - (i+1)) / 1000;
    console.log(`  [${i+1}/${rows.length}] ok=${n_ok} err=${n_err} high=${n_high} medium=${n_medium} conflict=${n_low} | eta=${eta.toFixed(0)}s`);
  }
  await sleep(DELAY_MS);
}

proposalsStream.end();
errorsStream.end();

fs.writeFileSync(path.join(OUT_DIR, 'phase3-lot01-summary.json'), JSON.stringify({
  generated_at: new Date().toISOString(),
  target_count: rows.length,
  proposals_ok: n_ok,
  errors: n_err,
  confidence: { HIGH: n_high, MEDIUM: n_medium, CONFLICT: n_low },
  elapsed_seconds: Math.round((Date.now() - startedAt) / 1000),
  files: { proposals: proposalsPath, errors: errorsPath },
}, null, 2));

console.log(`\nFinal: propostas=${n_ok}/${rows.length} erros=${n_err}`);
console.log(`Confiança: HIGH=${n_high} MEDIUM=${n_medium} CONFLICT/LOW=${n_low}`);
console.log(`Tempo: ${Math.round((Date.now() - startedAt)/1000)}s`);
console.log(`Arquivos:`);
console.log(`  ${proposalsPath}`);
console.log(`  ${errorsPath}`);
console.log(`  audit-output/phase3-lot01-summary.json`);
await pool.end();
