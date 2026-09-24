// PHASE 3 — Apply Lot #01.
// Behavior:
//   - HIGH (628): update latitude, longitude, localization + governance stamps
//   - CONFLICT (8): published=false + operational_status mapping + governance stamps
// Modes:
//   --dry-run [N]    run on first N HIGH rows + all CONFLICT, ROLLBACK at the end
//   --execute        real run, COMMIT per row, independent transactions
//
// Provenance for every change:
//   enrichment_log (jsonb array) ||= one entry per field changed
//   restaurant_field_verifications: one row per field changed
//   last_verified_at = now, verification_source = google_places:<place_id>, confidence_level = HIGH|CONFLICT
import fs from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';

const envPath = path.resolve(process.cwd(), '.env.local');
for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
}

const args = process.argv.slice(2);
const mode = args.includes('--execute') ? 'execute' : 'dry-run';
const dryN = (() => {
  const idx = args.indexOf('--dry-run');
  if (idx === -1) return 0;
  const next = args[idx+1];
  return /^\d+$/.test(next || '') ? parseInt(next, 10) : 5;
})();

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// ---------- CSV parser (RFC-4180-ish) ----------
function parseCsv(text) {
  const rows = [];
  let i = 0, field = '', row = [], inQ = false;
  while (i < text.length) {
    const c = text[i];
    if (inQ) {
      if (c === '"' && text[i+1] === '"') { field += '"'; i += 2; continue; }
      if (c === '"') { inQ = false; i++; continue; }
      field += c; i++; continue;
    }
    if (c === '"') { inQ = true; i++; continue; }
    if (c === ',') { row.push(field); field = ''; i++; continue; }
    if (c === '\n' || c === '\r') {
      if (field !== '' || row.length) { row.push(field); rows.push(row); row = []; field = ''; }
      // Eat \r\n
      if (c === '\r' && text[i+1] === '\n') i++;
      i++; continue;
    }
    field += c; i++;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) return [];
  const headers = rows[0];
  return rows.slice(1).filter(r => r.length === headers.length).map(r => {
    const o = {};
    for (let j = 0; j < headers.length; j++) o[headers[j]] = r[j];
    return o;
  });
}

const csvText = fs.readFileSync('audit-output/phase3-lot01-coordinates-proposals.csv', 'utf8');
const all = parseCsv(csvText);
console.log(`Carregadas ${all.length} propostas do CSV.`);

const highs = all.filter(r => r.confidence_level === 'HIGH');
const conflicts = all.filter(r => r.confidence_level === 'CONFLICT');
console.log(`HIGH: ${highs.length} | CONFLICT: ${conflicts.length}`);

// Map closed status from Google business_status
function statusFor(returned) {
  if (returned === 'CLOSED_PERMANENTLY') return 'closed_permanently';
  if (returned === 'CLOSED_TEMPORARILY') return 'temporarily_closed';
  return null;
}

const AGENT = 'twk-db-architect';

// ---------- Apply ONE HIGH proposal in its own transaction ----------
async function applyHigh(row, simulate) {
  const client = await pool.connect();
  const restaurant_id = row.restaurant_id;
  const lat = parseFloat(row.proposed_latitude);
  const lng = parseFloat(row.proposed_longitude);
  const gmaps = row.proposed_google_maps_url || null;
  const source = row.source_url || `google_places:${row.place_id_db}`;
  const now = new Date().toISOString();

  try {
    await client.query('BEGIN');

    // Fetch current values for old_value provenance
    const cur = await client.query(
      `SELECT latitude, longitude, localization FROM public.db_restaurants WHERE restaurant_id = $1 FOR UPDATE`,
      [restaurant_id]
    );
    if (!cur.rows.length) {
      throw new Error('restaurant_id not found');
    }
    const old = cur.rows[0];

    const logEntries = [];
    if (lat !== null && !isNaN(lat) && old.latitude === null) {
      logEntries.push({ field: 'latitude', old_value: null, new_value: lat, source, verified_at: now, confidence: 'HIGH', agent: AGENT, batch: 'phase3-lot01' });
    }
    if (lng !== null && !isNaN(lng) && old.longitude === null) {
      logEntries.push({ field: 'longitude', old_value: null, new_value: lng, source, verified_at: now, confidence: 'HIGH', agent: AGENT, batch: 'phase3-lot01' });
    }
    if (gmaps && !old.localization) {
      logEntries.push({ field: 'localization', old_value: null, new_value: gmaps, source, verified_at: now, confidence: 'HIGH', agent: AGENT, batch: 'phase3-lot01' });
    }

    await client.query(`
      UPDATE public.db_restaurants
         SET latitude = COALESCE(latitude, $2),
             longitude = COALESCE(longitude, $3),
             localization = COALESCE(localization, $4),
             last_verified_at = $5::timestamptz,
             verification_source = $6,
             confidence_level = 'HIGH',
             enrichment_log = enrichment_log || $7::jsonb
       WHERE restaurant_id = $1`,
      [restaurant_id, lat, lng, gmaps, now, source, JSON.stringify(logEntries)]
    );

    for (const entry of logEntries) {
      await client.query(`
        INSERT INTO public.restaurant_field_verifications
          (restaurant_id, field_name, value_hash, source, source_kind, verified_at, confidence_level, agent, notes)
        VALUES ($1, $2, md5($3::text), $4, 'google_places', $5::timestamptz, 'HIGH', $6, $7)`,
        [restaurant_id, entry.field, String(entry.new_value), source, now, AGENT, 'lot01']
      );
    }

    if (simulate) await client.query('ROLLBACK');
    else await client.query('COMMIT');
    return { restaurant_id, status: 'ok', fields_changed: logEntries.length };
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch {}
    return { restaurant_id, status: 'error', error: e.message };
  } finally {
    client.release();
  }
}

// ---------- Apply ONE CONFLICT proposal: unpublish + operational_status ----------
async function applyConflict(row, simulate) {
  const client = await pool.connect();
  const restaurant_id = row.restaurant_id;
  const opStatus = statusFor(row.returned_business_status);
  const source = row.source_url || `google_places:${row.place_id_db}`;
  const now = new Date().toISOString();

  try {
    await client.query('BEGIN');

    const cur = await client.query(
      `SELECT published, operational_status FROM public.db_restaurants WHERE restaurant_id = $1 FOR UPDATE`,
      [restaurant_id]
    );
    if (!cur.rows.length) throw new Error('restaurant_id not found');
    const old = cur.rows[0];

    const logEntries = [];
    if (old.published === true) {
      logEntries.push({ field: 'published', old_value: true, new_value: false, source, verified_at: now, confidence: 'CONFLICT', agent: AGENT, batch: 'phase3-lot01', reason: row.returned_business_status });
    }
    if (opStatus && old.operational_status !== opStatus) {
      logEntries.push({ field: 'operational_status', old_value: old.operational_status, new_value: opStatus, source, verified_at: now, confidence: 'CONFLICT', agent: AGENT, batch: 'phase3-lot01', reason: row.returned_business_status });
    }

    await client.query(`
      UPDATE public.db_restaurants
         SET published = false,
             operational_status = COALESCE($2, operational_status),
             operational_status_reason = COALESCE(operational_status_reason, $3),
             last_verified_at = $4::timestamptz,
             verification_source = $5,
             confidence_level = 'CONFLICT',
             enrichment_log = enrichment_log || $6::jsonb
       WHERE restaurant_id = $1`,
      [restaurant_id, opStatus, `Google Places reportou ${row.returned_business_status} em ${now.slice(0,10)}`, now, source, JSON.stringify(logEntries)]
    );

    for (const entry of logEntries) {
      await client.query(`
        INSERT INTO public.restaurant_field_verifications
          (restaurant_id, field_name, value_hash, source, source_kind, verified_at, confidence_level, agent, notes)
        VALUES ($1, $2, md5($3::text), $4, 'google_places', $5::timestamptz, 'CONFLICT', $6, $7)`,
        [restaurant_id, entry.field, String(entry.new_value), source, now, AGENT, `lot01 — ${row.returned_business_status}`]
      );
    }

    if (simulate) await client.query('ROLLBACK');
    else await client.query('COMMIT');
    return { restaurant_id, status: 'ok', fields_changed: logEntries.length, op_status: opStatus };
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch {}
    return { restaurant_id, status: 'error', error: e.message };
  } finally {
    client.release();
  }
}

// ---------- Driver ----------
const simulate = mode === 'dry-run';
const targets = simulate ? highs.slice(0, dryN) : highs;
console.log(`\nModo: ${mode.toUpperCase()} | HIGH a processar: ${targets.length} | CONFLICT: ${conflicts.length}`);

const results = { high: [], conflict: [] };
let okH = 0, errH = 0, okC = 0, errC = 0;

for (let i = 0; i < targets.length; i++) {
  const res = await applyHigh(targets[i], simulate);
  results.high.push(res);
  if (res.status === 'ok') okH++; else errH++;
  if ((i+1) % 50 === 0 || i+1 === targets.length) {
    console.log(`  HIGH [${i+1}/${targets.length}] ok=${okH} err=${errH}`);
  }
}

for (let i = 0; i < conflicts.length; i++) {
  const res = await applyConflict(conflicts[i], simulate);
  results.conflict.push(res);
  if (res.status === 'ok') okC++; else errC++;
}
console.log(`  CONFLICT [${conflicts.length}/${conflicts.length}] ok=${okC} err=${errC}`);

const outFile = `audit-output/phase3-lot01-${mode}-results.json`;
fs.writeFileSync(outFile, JSON.stringify({ mode, generated_at: new Date().toISOString(), summary: { high_ok: okH, high_err: errH, conflict_ok: okC, conflict_err: errC }, ...results }, null, 2));
console.log(`\nFinal: HIGH ok=${okH} err=${errH} | CONFLICT ok=${okC} err=${errC}`);
console.log(`Detalhe -> ${outFile}`);
if (simulate) console.log(`\n>>> SIMULAÇÃO: tudo foi ROLLBACK. Nada gravado. <<<`);
await pool.end();
process.exitCode = (errH + errC) > 0 ? 1 : 0;
