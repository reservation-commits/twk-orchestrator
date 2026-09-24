// LOT #03 — Contact bundle: phone + website + price_range_id in one Places API call per row.
// Also auto-handles newly-detected CLOSED_PERMANENTLY / CLOSED_TEMPORARILY (same policy as lot 01).
// Modes:
//   (default)   propose-only: API calls + CSV. No DB writes.
//   --execute   apply UPDATEs with governance.
import fs from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';

const envPath = path.resolve(process.cwd(), '.env.local');
for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
}

const args = process.argv.slice(2);
const mode = args.includes('--execute') ? 'execute' : 'propose';
const API_KEY = process.env.GOOGLE_PLACES_API_KEY;
if (!API_KEY) { console.error('GOOGLE_PLACES_API_KEY ausente'); process.exit(1); }

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const AGENT = 'twk-db-architect';

// Target universe: published rows missing ANY of phone, site, price.
const rows = (await pool.query(`
  SELECT restaurant_id, name, city, country, place_id,
         telephone_of_the_establishment AS cur_phone,
         site_url      AS cur_site,
         email_for_reservations AS cur_email,
         price_range_id AS cur_price
    FROM public.db_restaurants
   WHERE published = true
     AND place_id IS NOT NULL AND length(btrim(place_id))>0
     AND (
       telephone_of_the_establishment IS NULL OR telephone_of_the_establishment = ''
       OR site_url IS NULL OR site_url = ''
       OR price_range_id IS NULL
     )
   ORDER BY restaurant_id
`)).rows;
console.log(`Alvo: ${rows.length} restaurantes publicados com ao menos 1 lacuna entre {phone, site, price}.`);

const PLACES = 'https://maps.googleapis.com/maps/api/place/details/json';
const FIELDS = 'international_phone_number,formatted_phone_number,website,price_level,business_status,place_id';
const DELAY_MS = 120;

const proposalsPath = 'audit-output/phase3-lot03-contact-proposals.csv';
const errorsPath    = 'audit-output/phase3-lot03-contact-errors.csv';
const head = [
  'restaurant_id','name','city','place_id_db','place_id_returned','place_id_match',
  'cur_phone','proposed_phone',
  'cur_site','proposed_site',
  'cur_price','proposed_price_level','proposed_price_range_id',
  'returned_business_status',
  'confidence','verified_at','source','api_status'
].join(',');
const errHead = ['restaurant_id','name','place_id','api_status','message'].join(',');
const propStream = fs.createWriteStream(proposalsPath);  propStream.write(head + '\n');
const errStream  = fs.createWriteStream(errorsPath);     errStream.write(errHead + '\n');
function csvEsc(v){if(v==null)return '';const s=String(v);return /[",\n;]/.test(s)?`"${s.replace(/"/g,'""')}"`:s;}
function csvRow(arr){return arr.map(csvEsc).join(',');}

// Phone normalization: same rule as lot02-PRE — pure E.164 with +
function normalizePhone(raw) {
  if (!raw) return null;
  let s = String(raw).replace(/[\s ​-‏‪-‮⁠﻿]/g, '').replace(/[^\d+]/g, '');
  if (!s.startsWith('+')) s = '+' + s;
  // Must match the CHECK regex: ^\+[0-9 .()\-]{6,30}$
  return /^\+\d{6,29}$/.test(s) ? s : null;
}
function normalizeSite(raw) {
  if (!raw) return null;
  let s = String(raw).trim();
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s.replace(/^\/+/, '');
  return /^https?:\/\//i.test(s) ? s : null;
}
function mapPrice(google_level) {
  if (google_level === null || google_level === undefined) return null;
  // Google 0-4 -> our 1-4 (clamp 0 to 1)
  if (google_level === 0) return 1;
  if (google_level >= 1 && google_level <= 4) return google_level;
  return null;
}

async function fetchDetails(placeId) {
  const url = `${PLACES}?place_id=${encodeURIComponent(placeId)}&fields=${FIELDS}&key=${API_KEY}`;
  for (let i = 0; i < 4; i++) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = await r.json();
    if (d.status === 'OVER_QUERY_LIMIT') { await new Promise(s => setTimeout(s, 2000*(i+1))); continue; }
    return d;
  }
  throw new Error('OVER_QUERY_LIMIT after retries');
}

let n_ok = 0, n_err = 0, n_closed_perm = 0, n_closed_temp = 0;
let n_phone_proposed = 0, n_site_proposed = 0, n_price_proposed = 0;
const t0 = Date.now();
const proposals = [];

for (let i = 0; i < rows.length; i++) {
  const r = rows[i];
  try {
    const d = await fetchDetails(r.place_id);
    if (d.status !== 'OK') {
      n_err++;
      errStream.write(csvRow([r.restaurant_id, r.name, r.place_id, d.status, d.error_message || '']) + '\n');
      await new Promise(s => setTimeout(s, DELAY_MS));
      continue;
    }
    const result = d.result || {};
    const pidReturned = result.place_id || '';
    const pidMatch = pidReturned === r.place_id;
    const business = result.business_status || '';
    const intlPhone = result.international_phone_number || result.formatted_phone_number || null;
    const proposedPhone = !r.cur_phone || r.cur_phone === '' ? normalizePhone(intlPhone) : null;
    const proposedSite  = !r.cur_site || r.cur_site === '' ? normalizeSite(result.website) : null;
    const proposedPrice = r.cur_price === null ? mapPrice(result.price_level) : null;

    let confidence = 'HIGH';
    if (!pidMatch) confidence = 'CONFLICT';
    if (business === 'CLOSED_PERMANENTLY') { confidence = 'CONFLICT'; n_closed_perm++; }
    if (business === 'CLOSED_TEMPORARILY') { confidence = 'CONFLICT'; n_closed_temp++; }

    if (proposedPhone) n_phone_proposed++;
    if (proposedSite) n_site_proposed++;
    if (proposedPrice !== null) n_price_proposed++;

    const row = {
      restaurant_id: r.restaurant_id, name: r.name, city: r.city,
      place_id_db: r.place_id, place_id_returned: pidReturned, place_id_match: pidMatch ? 'yes' : 'no',
      cur_phone: r.cur_phone, proposed_phone: proposedPhone,
      cur_site: r.cur_site, proposed_site: proposedSite,
      cur_price: r.cur_price, proposed_price_level: result.price_level ?? null, proposed_price_range_id: proposedPrice,
      returned_business_status: business,
      confidence, verified_at: new Date().toISOString(),
      source: `google_places:${r.place_id}`, api_status: d.status,
    };
    proposals.push(row);
    propStream.write(csvRow([
      row.restaurant_id, row.name, row.city, row.place_id_db, row.place_id_returned, row.place_id_match,
      row.cur_phone, row.proposed_phone, row.cur_site, row.proposed_site,
      row.cur_price, row.proposed_price_level, row.proposed_price_range_id,
      row.returned_business_status, row.confidence, row.verified_at, row.source, row.api_status,
    ]) + '\n');
    n_ok++;
  } catch (e) {
    n_err++;
    errStream.write(csvRow([r.restaurant_id, r.name, r.place_id, 'EXCEPTION', e.message]) + '\n');
  }
  if ((i+1) % 25 === 0) {
    const eta = (Date.now() - t0) / (i+1) * (rows.length - (i+1)) / 1000;
    console.log(`  [${i+1}/${rows.length}] ok=${n_ok} err=${n_err} | phone+${n_phone_proposed} site+${n_site_proposed} price+${n_price_proposed} | closed_perm=${n_closed_perm} closed_temp=${n_closed_temp} | eta=${eta.toFixed(0)}s`);
  }
  await new Promise(s => setTimeout(s, DELAY_MS));
}
propStream.end(); errStream.end();

fs.writeFileSync('audit-output/phase3-lot03-summary.json', JSON.stringify({
  mode, generated_at: new Date().toISOString(), target_count: rows.length,
  api_ok: n_ok, api_err: n_err,
  proposed: { phone: n_phone_proposed, site: n_site_proposed, price: n_price_proposed },
  closed: { permanent: n_closed_perm, temporary: n_closed_temp },
  elapsed_seconds: Math.round((Date.now() - t0)/1000),
}, null, 2));

console.log(`\nFetch: ${n_ok}/${rows.length} ok | err=${n_err}`);
console.log(`Propostas geradas: phone=${n_phone_proposed} site=${n_site_proposed} price=${n_price_proposed}`);
console.log(`Restaurantes fechados detectados: perm=${n_closed_perm} temp=${n_closed_temp}`);

if (mode === 'propose') {
  console.log('\n>>> PROPOSE: nada gravado. Use --execute para aplicar. <<<');
  await pool.end();
  process.exit(0);
}

// ---------- EXECUTE ----------
console.log('\nAplicando UPDATEs...');
const now = new Date().toISOString();
let okN = 0, errN = 0;
const errSample = [];

for (const p of proposals) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cur = await client.query(
      `SELECT telephone_of_the_establishment, site_url, price_range_id, published, operational_status
       FROM public.db_restaurants WHERE restaurant_id = $1 FOR UPDATE`,
      [p.restaurant_id]
    );
    if (!cur.rows.length) throw new Error('not found');
    const old = cur.rows[0];

    const logEntries = [];
    const closedPerm = p.returned_business_status === 'CLOSED_PERMANENTLY';
    const closedTemp = p.returned_business_status === 'CLOSED_TEMPORARILY';

    if (closedPerm || closedTemp) {
      // Unpublish + status (do NOT touch contact data for these — same policy as lot 01)
      if (old.published === true) {
        logEntries.push({ field: 'published', old_value: true, new_value: false, source: p.source, verified_at: now, confidence: 'CONFLICT', agent: AGENT, batch: 'phase3-lot03', reason: p.returned_business_status });
      }
      const newOp = closedPerm ? 'closed_permanently' : 'temporarily_closed';
      if (old.operational_status !== newOp) {
        logEntries.push({ field: 'operational_status', old_value: old.operational_status, new_value: newOp, source: p.source, verified_at: now, confidence: 'CONFLICT', agent: AGENT, batch: 'phase3-lot03', reason: p.returned_business_status });
      }
      await client.query(`
        UPDATE public.db_restaurants
           SET published = false,
               operational_status = $2,
               operational_status_reason = COALESCE(operational_status_reason, $3),
               last_verified_at = $4::timestamptz,
               verification_source = $5,
               confidence_level = 'CONFLICT',
               enrichment_log = enrichment_log || $6::jsonb
         WHERE restaurant_id = $1`,
        [p.restaurant_id, newOp, `Google Places reportou ${p.returned_business_status} em ${now.slice(0,10)}`, now, p.source, JSON.stringify(logEntries)]);
    } else if (p.confidence === 'CONFLICT') {
      // Non-closed CONFLICT (e.g. place_id changed at Google) — skip, needs human decision
      await client.query('ROLLBACK');
      continue;
    } else {
      // Apply phone / site / price where proposed (COALESCE preserves existing values)
      if (p.proposed_phone && !old.telephone_of_the_establishment) {
        logEntries.push({ field: 'telephone_of_the_establishment', old_value: old.telephone_of_the_establishment, new_value: p.proposed_phone, source: p.source, verified_at: now, confidence: p.confidence, agent: AGENT, batch: 'phase3-lot03' });
      }
      if (p.proposed_site && !old.site_url) {
        logEntries.push({ field: 'site_url', old_value: old.site_url, new_value: p.proposed_site, source: p.source, verified_at: now, confidence: p.confidence, agent: AGENT, batch: 'phase3-lot03' });
      }
      if (p.proposed_price_range_id !== null && p.proposed_price_range_id !== '' && old.price_range_id === null) {
        const pp = parseInt(p.proposed_price_range_id, 10);
        logEntries.push({ field: 'price_range_id', old_value: null, new_value: pp, source: p.source, verified_at: now, confidence: p.confidence, agent: AGENT, batch: 'phase3-lot03' });
      }

      if (logEntries.length === 0) {
        await client.query('ROLLBACK');
        continue;
      }

      const newPriceParam = p.proposed_price_range_id ? parseInt(p.proposed_price_range_id, 10) : null;

      await client.query(`
        UPDATE public.db_restaurants
           SET telephone_of_the_establishment = COALESCE(telephone_of_the_establishment, $2),
               site_url = COALESCE(site_url, $3),
               price_range_id = COALESCE(price_range_id, $4),
               last_verified_at = $5::timestamptz,
               verification_source = COALESCE(verification_source, $6),
               confidence_level = COALESCE(confidence_level, $7),
               enrichment_log = enrichment_log || $8::jsonb
         WHERE restaurant_id = $1`,
        [p.restaurant_id, p.proposed_phone, p.proposed_site, newPriceParam,
         now, p.source, p.confidence, JSON.stringify(logEntries)]);
    }

    for (const entry of logEntries) {
      await client.query(`
        INSERT INTO public.restaurant_field_verifications
          (restaurant_id, field_name, value_hash, source, source_kind, verified_at, confidence_level, agent, notes)
        VALUES ($1, $2, md5($3::text), $4, 'google_places', $5::timestamptz, $6, $7, 'lot03')`,
        [p.restaurant_id, entry.field, String(entry.new_value), p.source, now, entry.confidence, AGENT]);
    }

    await client.query('COMMIT');
    okN++;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch {}
    errN++;
    if (errSample.length < 10) errSample.push({ id: p.restaurant_id, err: e.message });
  } finally {
    client.release();
  }
}

console.log(`\nFinal: ok=${okN} err=${errN}`);
if (errN) console.log('Erros (amostra):', errSample);
fs.writeFileSync('audit-output/phase3-lot03-execute-results.json', JSON.stringify({
  mode: 'execute', generated_at: now, ok: okN, err: errN, err_sample: errSample,
}, null, 2));
await pool.end();
process.exitCode = errN > 0 ? 1 : 0;
