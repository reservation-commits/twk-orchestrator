// LOT01-D: clean 4 corrupted emails. Preserve content in audit log.
// Also apply coords for SAM's (40721) which failed before due to the email CHECK.
import fs from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';

const envPath = path.resolve(process.cwd(), '.env.local');
for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const AGENT = 'twk-db-architect';
const now = new Date().toISOString();

// Read SAM's coords from the lot01 CSV
function csvField(line, i) {
  // RFC-4180-ish split for header[0]==restaurant_id specifically
  const out = []; let f = '', q = false;
  for (let k = 0; k < line.length; k++) {
    const c = line[k];
    if (q) {
      if (c === '"' && line[k+1] === '"') { f += '"'; k++; }
      else if (c === '"') q = false;
      else f += c;
    } else if (c === '"') q = true;
    else if (c === ',') { out.push(f); f = ''; }
    else f += c;
  }
  out.push(f);
  return out[i];
}
const csv = fs.readFileSync('audit-output/phase3-lot01-coordinates-proposals.csv', 'utf8').split(/\r?\n/);
const header = csv[0].split(',');
const idxId = header.indexOf('restaurant_id');
const idxLat = header.indexOf('proposed_latitude');
const idxLng = header.indexOf('proposed_longitude');
const idxGm  = header.indexOf('proposed_google_maps_url');
const samLine = csv.find(l => l.startsWith('40721,'));
const samFields = samLine.split(',');
const samLat = parseFloat(samFields[idxLat]);
const samLng = parseFloat(samFields[idxLng]);
const samGmaps = samFields[idxGm];

// Need exact match on raw email value to apply UPDATE without re-triggering CHECK?
// Actually we ARE updating email to NULL — that's allowed. The CHECK only
// blocks if the new value is invalid. NULL is allowed by the constraint.

const targets = [
  { id: '40721', applyCoords: true },
  { id: '14504', applyCoords: false },
  { id: '14480', applyCoords: false },
  { id: '14408', applyCoords: false },
];

const results = [];
for (const t of targets) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cur = await client.query(
      `SELECT restaurant_id, name, email_for_reservations, latitude, longitude, localization
         FROM public.db_restaurants WHERE restaurant_id = $1 FOR UPDATE`,
      [t.id]
    );
    if (!cur.rows.length) throw new Error('not found');
    const old = cur.rows[0];

    const logEntries = [];
    // Email cleanup entry — preserves the corrupted content
    logEntries.push({
      field: 'email_for_reservations',
      old_value: old.email_for_reservations,
      new_value: null,
      reason: 'Conteúdo não corresponde a formato de e-mail; movido para auditoria.',
      source: 'human-approved-cleanup',
      verified_at: now,
      confidence: 'HIGH',
      agent: AGENT,
      batch: 'phase3-lot01-D',
    });

    if (t.applyCoords) {
      // SAM's also gets coords + localization
      if (old.latitude === null) {
        logEntries.push({ field:'latitude', old_value:null, new_value:samLat, source:`google_places:ChIJmdg7C7o6UDARapMlbFtrFcc`, verified_at:now, confidence:'HIGH', agent:AGENT, batch:'phase3-lot01-D' });
      }
      if (old.longitude === null) {
        logEntries.push({ field:'longitude', old_value:null, new_value:samLng, source:`google_places:ChIJmdg7C7o6UDARapMlbFtrFcc`, verified_at:now, confidence:'HIGH', agent:AGENT, batch:'phase3-lot01-D' });
      }
      if (!old.localization && samGmaps) {
        logEntries.push({ field:'localization', old_value:null, new_value:samGmaps, source:`google_places:ChIJmdg7C7o6UDARapMlbFtrFcc`, verified_at:now, confidence:'HIGH', agent:AGENT, batch:'phase3-lot01-D' });
      }

      await client.query(`
        UPDATE public.db_restaurants
           SET email_for_reservations = NULL,
               latitude  = COALESCE(latitude, $2),
               longitude = COALESCE(longitude, $3),
               localization = COALESCE(localization, $4),
               last_verified_at = $5::timestamptz,
               verification_source = 'google_places:ChIJmdg7C7o6UDARapMlbFtrFcc',
               confidence_level = 'HIGH',
               enrichment_log = enrichment_log || $6::jsonb
         WHERE restaurant_id = $1`,
        [t.id, samLat, samLng, samGmaps, now, JSON.stringify(logEntries)]
      );
    } else {
      await client.query(`
        UPDATE public.db_restaurants
           SET email_for_reservations = NULL,
               enrichment_log = enrichment_log || $2::jsonb
         WHERE restaurant_id = $1`,
        [t.id, JSON.stringify(logEntries)]
      );
    }

    for (const entry of logEntries) {
      await client.query(`
        INSERT INTO public.restaurant_field_verifications
          (restaurant_id, field_name, value_hash, source, source_kind, verified_at, confidence_level, agent, notes)
        VALUES ($1, $2, md5($3::text), $4, $5, $6::timestamptz, $7, $8, $9)`,
        [
          t.id,
          entry.field,
          entry.new_value === null ? 'NULL' : String(entry.new_value),
          entry.source,
          entry.source === 'human-approved-cleanup' ? 'other' : 'google_places',
          now,
          'HIGH',
          AGENT,
          'lot01-D — email cleanup' + (t.applyCoords ? ' + coords' : ''),
        ]
      );
    }

    await client.query('COMMIT');
    results.push({ id: t.id, name: old.name, status: 'ok', fields_changed: logEntries.length });
    console.log(`OK ${t.id} ${old.name} (${logEntries.length} campos)`);
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch {}
    results.push({ id: t.id, status: 'error', error: e.message });
    console.log(`FAIL ${t.id} -> ${e.message}`);
  } finally {
    client.release();
  }
}

fs.writeFileSync('audit-output/phase3-lot01-d-results.json', JSON.stringify({ generated_at: now, results }, null, 2));
console.log(`\nResultado: ${results.filter(r=>r.status==='ok').length}/${results.length}`);
await pool.end();
process.exitCode = results.every(r => r.status === 'ok') ? 0 : 1;
