// LOT #02 — Backfill timezone via lat/lng (offline, no API).
// Two-pass:
//   - Pass 1: build proposals CSV (read-only).
//   - Pass 2: apply on --execute (in-transaction per row, with governance).
import fs from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';
import tzlookup from 'tz-lookup';

const envPath = path.resolve(process.cwd(), '.env.local');
for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
}

const args = process.argv.slice(2);
const mode = args.includes('--execute') ? 'execute'
           : args.includes('--apply-dry') ? 'apply-dry'
           : 'propose';

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const AGENT = 'twk-db-architect';

// Target: anyone (published or not) with coords and without timezone, currently active or unknown
const rows = (await pool.query(`
  SELECT restaurant_id, name, city, country, latitude, longitude
    FROM public.db_restaurants
   WHERE latitude IS NOT NULL AND longitude IS NOT NULL
     AND timezone IS NULL
   ORDER BY restaurant_id
`)).rows;
console.log(`Alvo (coords + sem timezone): ${rows.length} restaurantes`);

// Build proposals
const proposals = [];
let n_high = 0, n_skip = 0;
for (const r of rows) {
  try {
    const tz = tzlookup(Number(r.latitude), Number(r.longitude));
    proposals.push({ restaurant_id: r.restaurant_id, name: r.name, city: r.city, country: r.country,
      latitude: r.latitude, longitude: r.longitude, timezone: tz, confidence: 'HIGH' });
    n_high++;
  } catch (e) {
    proposals.push({ restaurant_id: r.restaurant_id, name: r.name, city: r.city, country: r.country,
      latitude: r.latitude, longitude: r.longitude, timezone: null, confidence: 'ERROR', error: e.message });
    n_skip++;
  }
}

// Sanity: distribution of timezones (top 25)
const tzCount = {};
for (const p of proposals) if (p.timezone) tzCount[p.timezone] = (tzCount[p.timezone]||0)+1;
const topTz = Object.entries(tzCount).sort((a,b)=>b[1]-a[1]).slice(0, 25);

// Write CSV
function csvEsc(v){if(v==null)return '';const s=String(v);return /[",\n;]/.test(s)?`"${s.replace(/"/g,'""')}"`:s;}
const cols = ['restaurant_id','name','city','country','latitude','longitude','timezone','confidence','error'];
fs.writeFileSync('audit-output/phase3-lot02-timezone-proposals.csv',
  cols.join(',') + '\n' +
  proposals.map(p => cols.map(c => csvEsc(p[c])).join(',')).join('\n') + '\n'
);

fs.writeFileSync('audit-output/phase3-lot02-summary.json', JSON.stringify({
  mode, generated_at: new Date().toISOString(), target_count: rows.length,
  proposals_ok: n_high, lookup_errors: n_skip,
  top_25_timezones: topTz,
}, null, 2));

console.log(`Propostas geradas: ${n_high} (ok) + ${n_skip} (erro)`);
console.log(`Top 5 fusos: ${topTz.slice(0,5).map(([t,n])=>`${t}=${n}`).join(', ')}`);

if (mode === 'propose') {
  console.log('\n>>> Modo PROPOSE: nada gravado. Use --apply-dry para simular ou --execute para gravar. <<<');
  await pool.end();
  process.exit(0);
}

// --------- APPLY (dry-run via ROLLBACK or real via COMMIT) ---------
const simulate = mode === 'apply-dry';
console.log(`\nModo ${mode.toUpperCase()} — aplicando ${n_high} updates...`);

let okN = 0, errN = 0;
const now = new Date().toISOString();
const errSample = [];

for (let i = 0; i < proposals.length; i++) {
  const p = proposals[i];
  if (!p.timezone) continue;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const entry = {
      field: 'timezone', old_value: null, new_value: p.timezone,
      source: `tz-lookup-offline:lat=${p.latitude},lng=${p.longitude}`,
      verified_at: now, confidence: 'HIGH', agent: AGENT, batch: 'phase3-lot02',
    };
    await client.query(`
      UPDATE public.db_restaurants
         SET timezone = COALESCE(timezone, $2),
             last_verified_at = $3::timestamptz,
             verification_source = COALESCE(verification_source, $4),
             confidence_level = COALESCE(confidence_level, 'HIGH'),
             enrichment_log = enrichment_log || $5::jsonb
       WHERE restaurant_id = $1`,
      [p.restaurant_id, p.timezone, now, entry.source, JSON.stringify([entry])]
    );
    await client.query(`
      INSERT INTO public.restaurant_field_verifications
        (restaurant_id, field_name, value_hash, source, source_kind, verified_at, confidence_level, agent, notes)
      VALUES ($1, 'timezone', md5($2), $3, 'other', $4::timestamptz, 'HIGH', $5, 'lot02 — offline tz-lookup')`,
      [p.restaurant_id, p.timezone, entry.source, now, AGENT]
    );
    if (simulate) await client.query('ROLLBACK');
    else await client.query('COMMIT');
    okN++;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch {}
    errN++;
    if (errSample.length < 10) errSample.push({ id: p.restaurant_id, err: e.message });
  } finally {
    client.release();
  }
  if ((i+1) % 250 === 0) console.log(`  [${i+1}/${proposals.length}] ok=${okN} err=${errN}`);
}

console.log(`\nFinal: ok=${okN} err=${errN}`);
if (errN) console.log('Erros (amostra):', errSample);
fs.writeFileSync(`audit-output/phase3-lot02-${mode}-results.json`, JSON.stringify({
  mode, generated_at: now, ok: okN, err: errN, err_sample: errSample,
}, null, 2));

if (simulate) console.log('\n>>> SIMULAÇÃO: tudo ROLLBACK. Nada gravado. <<<');
await pool.end();
process.exitCode = errN > 0 ? 1 : 0;
