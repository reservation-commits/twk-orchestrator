// Phase C — DISCOVER step.
// For each candidate in fase6-master-absent.json:
//   1. Google Places Find Place from Text → get place_id
//   2. Place Details → get coords, phone, website, etc.
// Outputs proposals CSV. NO DB writes.
import fs from 'node:fs';
import path from 'node:path';
import tzlookup from 'tz-lookup';

const envPath = path.resolve(process.cwd(), '.env.local');
for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
}
const API_KEY = process.env.GOOGLE_PLACES_API_KEY;
if (!API_KEY) { console.error('GOOGLE_PLACES_API_KEY ausente'); process.exit(1); }

process.on('unhandledRejection', e => console.error('[unhandled]', e?.message || e));
process.on('uncaughtException',  e => console.error('[uncaught]',  e?.message || e));

const FIND_URL    = 'https://maps.googleapis.com/maps/api/place/findplacefromtext/json';
const DETAILS_URL = 'https://maps.googleapis.com/maps/api/place/details/json';
const DELAY = 150;

function normCity(s) {
  return (s || '').toLowerCase().normalize('NFD').replace(/\p{Mn}/gu,'').replace(/[^a-z0-9 ]/g,'').trim();
}

async function findPlace(name, city, country) {
  // Strip parts after em-dash to focus on main name
  const cleanName = name.replace(/\s+—\s+.*$/, '').trim();
  const query = `${cleanName} restaurant ${city} ${country}`;
  const params = new URLSearchParams({
    input: query,
    inputtype: 'textquery',
    fields: 'place_id,formatted_address,geometry,name,business_status',
    key: API_KEY,
  });
  for (let i = 0; i < 4; i++) {
    const r = await fetch(`${FIND_URL}?${params}`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = await r.json();
    if (d.status === 'OVER_QUERY_LIMIT') { await new Promise(s => setTimeout(s, 2000*(i+1))); continue; }
    return d;
  }
  throw new Error('OVER_QUERY_LIMIT');
}

async function placeDetails(placeId) {
  const params = new URLSearchParams({
    place_id: placeId,
    fields: 'name,formatted_address,geometry,international_phone_number,formatted_phone_number,website,url,price_level,business_status,address_components,types',
    key: API_KEY,
  });
  for (let i = 0; i < 4; i++) {
    const r = await fetch(`${DETAILS_URL}?${params}`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = await r.json();
    if (d.status === 'OVER_QUERY_LIMIT') { await new Promise(s => setTimeout(s, 2000*(i+1))); continue; }
    return d;
  }
  throw new Error('OVER_QUERY_LIMIT');
}

const master = JSON.parse(fs.readFileSync('audit-output/fase6-master-absent.json','utf8'));
const candidates = master.full_list || [];
console.log(`Total candidatos: ${candidates.length}`);

// Resume support
const propPath = 'audit-output/fase6-phase-c-proposals.csv';
const errPath  = 'audit-output/fase6-phase-c-errors.csv';
const seen = new Set();
for (const p of [propPath, errPath]) {
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p,'utf8').split('\n').slice(1)) {
    const key = line.split(',').slice(0,3).map(x => x.replace(/^"|"$/g,'')).join('|').toLowerCase();
    if (key.trim()) seen.add(key);
  }
}

const needHeader = !fs.existsSync(propPath);
const propStream = fs.createWriteStream(propPath, { flags: 'a' });
const errStream  = fs.createWriteStream(errPath,  { flags: 'a' });
if (needHeader) {
  propStream.write('candidate_name,city,country,tier,place_id,returned_name,formatted_address,latitude,longitude,phone,website,google_maps_url,price_level,business_status,city_match,timezone\n');
  errStream.write('candidate_name,city,country,reason\n');
}
function csvEsc(v){if(v==null)return '';const s=String(v);return /[",\n;]/.test(s)?`"${s.replace(/"/g,'""')}"`:s;}
function csvRow(arr){return arr.map(csvEsc).join(',');}

let ok = 0, err = 0, t0 = Date.now();
let i = 0;
for (const c of candidates) {
  i++;
  const key = `${c.name}|${c.city}|${c.country}`.toLowerCase();
  if (seen.has(key)) continue;

  try {
    const found = await findPlace(c.name, c.city, c.country);
    if (found.status !== 'OK' || !found.candidates?.length) {
      err++;
      errStream.write(csvRow([c.name, c.city, c.country, `find: ${found.status || 'no_results'}`]) + '\n');
      await new Promise(s => setTimeout(s, DELAY));
      continue;
    }
    const place = found.candidates[0];
    const placeId = place.place_id;

    const det = await placeDetails(placeId);
    if (det.status !== 'OK' || !det.result) {
      err++;
      errStream.write(csvRow([c.name, c.city, c.country, `details: ${det.status}`]) + '\n');
      await new Promise(s => setTimeout(s, DELAY));
      continue;
    }
    const r = det.result;
    const loc = r.geometry?.location;
    if (!loc) {
      err++;
      errStream.write(csvRow([c.name, c.city, c.country, 'no_geometry']) + '\n');
      await new Promise(s => setTimeout(s, DELAY));
      continue;
    }

    // City match sanity
    const formatted = (r.formatted_address || '').toLowerCase();
    const cityMatch = formatted.includes(normCity(c.city)) ? 'yes' : 'no';

    let tz = '';
    try { tz = tzlookup(loc.lat, loc.lng); } catch {}

    propStream.write(csvRow([
      c.name, c.city, c.country, c.tier || '',
      placeId, r.name || '',
      r.formatted_address || '',
      loc.lat, loc.lng,
      r.international_phone_number || r.formatted_phone_number || '',
      r.website || '',
      r.url || '',
      r.price_level ?? '',
      r.business_status || '',
      cityMatch,
      tz,
    ]) + '\n');
    ok++;
  } catch (e) {
    err++;
    errStream.write(csvRow([c.name, c.city, c.country, `EXC: ${e.message}`]) + '\n');
  }
  if (i % 25 === 0) {
    const eta = (Date.now()-t0)/i * (candidates.length-i) / 1000;
    console.log(`  [${i}/${candidates.length}] ok=${ok} err=${err} | eta=${(eta/60).toFixed(1)}min`);
  }
  await new Promise(s => setTimeout(s, DELAY));
}
propStream.end(); errStream.end();

console.log(`\nFinal: ok=${ok} err=${err}`);
fs.writeFileSync('audit-output/fase6-phase-c-summary.json', JSON.stringify({
  generated_at: new Date().toISOString(),
  total: candidates.length, ok, err,
  elapsed_seconds: Math.round((Date.now()-t0)/1000),
}, null, 2));
