// LOT04 EXECUTE — country standardization (Blocks A + B + C all recommended).
//   Block A: already-mapped aliases (auto).
//   Block B: insert 23 new aliases into country_name_aliases.
//   Block C1: West Indies -> France/FR (editorial).
//   Block C2: Quebec -> Canada/CA (editorial).
//   Block C3: Central America 2 records -> verify via Places API, per-record UPDATE.
import fs from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';

const envPath = path.resolve(process.cwd(), '.env.local');
for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
}
const API_KEY = process.env.GOOGLE_PLACES_API_KEY;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const AGENT = 'twk-db-architect';
const now = new Date().toISOString();

// =========================================================
// STEP 1 — Insert new aliases (Block B + C1 + C2)
// =========================================================
const NEW_ALIASES = [
  // Block B — countries already canonically named
  ['Sweden',           'Sweden',           'SE', null],
  ['Switzerland',      'Switzerland',      'CH', null],
  ['Russia',           'Russia',           'RU', null],
  ['Belgium',          'Belgium',          'BE', null],
  ['South Africa',     'South Africa',     'ZA', null],
  ['Qatar',            'Qatar',            'QA', null],
  ['Monaco',           'Monaco',           'MC', null],
  ['Egypt',            'Egypt',            'EG', null],
  ['Norway',           'Norway',           'NO', null],
  ['Tunisia',          'Tunisia',          'TN', null],
  ['Denmark',          'Denmark',          'DK', null],
  ['Maldives',         'Maldives',         'MV', null],
  ['French Polynesia', 'French Polynesia', 'PF', null],
  ['Ireland',          'Ireland',          'IE', null],
  ['Luxembourg',       'Luxembourg',       'LU', null],
  // Block B — variants/typos
  ['Israël',           'Israel',           'IL', 'Versão francesa com trema'],
  ['Usa',              'United States',    'US', 'Variante de USA (case)'],
  ['Brasil',           'Brazil',           'BR', 'Versão portuguesa'],
  ['South korea',      'South Korea',      'KR', 'Correção de capitalização'],
  ['Morroco',          'Morocco',          'MA', 'TYPO corrigido: Morroco -> Morocco'],
  ['United Kingdom',   'United Kingdom',   'GB', 'Auto-referência canônica'],
  // Block C1 — editorial decision: West Indies (French overseas territories) -> France
  ['West Indies',      'France',           'FR', 'Editorial: territórios franceses de ultramar (Saint Barths, Saint-Martin, Guadeloupe). Padronizado como France/FR.'],
  // Block C2 — editorial decision: Quebec (province) -> Canada
  ['Quebec',           'Canada',           'CA', 'Editorial: Quebec é província canadense. Padronizado como Canada/CA.'],
];

console.log('STEP 1 — Inserindo', NEW_ALIASES.length, 'novos aliases...');
{
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const [alias, canonical, code, notes] of NEW_ALIASES) {
      await client.query(
        `INSERT INTO public.country_name_aliases (alias, canonical, iso_alpha_2, notes)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (alias) DO NOTHING`,
        [alias, canonical, code, notes]
      );
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK'); console.error('FAIL inserting aliases:', e.message); process.exit(1);
  } finally {
    client.release();
  }
}

// =========================================================
// STEP 2 — Central America (Block C3): per-record API lookup
// =========================================================
async function placeCountry(placeId) {
  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${encodeURIComponent(placeId)}&fields=address_components,formatted_address&key=${API_KEY}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const d = await r.json();
  if (d.status !== 'OK') throw new Error(`Places status: ${d.status}`);
  const comp = (d.result?.address_components || []).find(c => c.types?.includes('country'));
  return { long_name: comp?.long_name, short_name: comp?.short_name, formatted: d.result?.formatted_address };
}

const ca = (await pool.query(`
  SELECT restaurant_id, name, city, country, place_id
  FROM public.db_restaurants WHERE country='Central America'`)).rows;
console.log(`\nSTEP 2 — Central America: ${ca.length} registros para verificar via Places API.`);
const caResolutions = [];
for (const r of ca) {
  if (!r.place_id) {
    caResolutions.push({ id: r.restaurant_id, name: r.name, error: 'no place_id' });
    continue;
  }
  try {
    const res = await placeCountry(r.place_id);
    console.log(`  [${r.restaurant_id}] ${r.name} (${r.city}) -> ${res.long_name} (${res.short_name}) | ${res.formatted}`);
    caResolutions.push({ id: r.restaurant_id, name: r.name, city: r.city,
      true_country: res.long_name, true_code: res.short_name, formatted: res.formatted });
  } catch (e) {
    caResolutions.push({ id: r.restaurant_id, name: r.name, error: e.message });
  }
}

// =========================================================
// STEP 3 — Bulk apply: for each restaurant whose country matches alias
// =========================================================
console.log('\nSTEP 3 — Aplicando padronização em todos os registros...');
const aliases = (await pool.query(`SELECT alias, canonical, iso_alpha_2 FROM public.country_name_aliases`)).rows;
const aliasMap = new Map(aliases.map(a => [a.alias, a]));

const rows = (await pool.query(`
  SELECT restaurant_id, country, country_code FROM public.db_restaurants
  WHERE country IS NOT NULL`)).rows;
console.log(`Total rows with country: ${rows.length}`);

let okN = 0, errN = 0, skippedN = 0;
const errSample = [];

for (const r of rows) {
  // Central America records: use per-record resolution
  let canonical, code, source;
  if (r.country === 'Central America') {
    const reso = caResolutions.find(x => x.id === r.restaurant_id);
    if (!reso || reso.error) { skippedN++; continue; }
    canonical = reso.true_country;
    code = reso.true_code;
    source = `google_places:${r.restaurant_id}`;
  } else {
    const a = aliasMap.get(r.country);
    if (!a) { skippedN++; continue; }
    canonical = a.canonical;
    code = a.iso_alpha_2;
    source = 'country_name_aliases';
  }

  // Skip rows already aligned (idempotent)
  if (r.country === canonical && r.country_code === code) { skippedN++; continue; }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const logEntries = [];
    if (r.country !== canonical) {
      logEntries.push({ field: 'country', old_value: r.country, new_value: canonical, source, verified_at: now, confidence: 'HIGH', agent: AGENT, batch: 'phase3-lot04' });
    }
    if (r.country_code !== code) {
      logEntries.push({ field: 'country_code', old_value: r.country_code, new_value: code, source, verified_at: now, confidence: 'HIGH', agent: AGENT, batch: 'phase3-lot04' });
    }
    await client.query(`
      UPDATE public.db_restaurants
         SET country = $2,
             country_code = $3,
             enrichment_log = enrichment_log || $4::jsonb
       WHERE restaurant_id = $1`,
      [r.restaurant_id, canonical, code, JSON.stringify(logEntries)]
    );
    for (const e of logEntries) {
      await client.query(`
        INSERT INTO public.restaurant_field_verifications
          (restaurant_id, field_name, value_hash, source, source_kind, verified_at, confidence_level, agent, notes)
        VALUES ($1, $2, md5($3), $4, $5, $6::timestamptz, 'HIGH', $7, 'lot04')`,
        [r.restaurant_id, e.field, String(e.new_value), source,
         source.startsWith('google_places') ? 'google_places' : 'other', now, AGENT]);
    }
    await client.query('COMMIT');
    okN++;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch {}
    errN++;
    if (errSample.length < 10) errSample.push({ id: r.restaurant_id, err: e.message });
  } finally {
    client.release();
  }
  if ((okN + errN) % 250 === 0) console.log(`  [${okN+errN}/...] ok=${okN} err=${errN} skipped=${skippedN}`);
}

console.log(`\nFinal: ok=${okN} err=${errN} skipped=${skippedN}`);
if (errN) console.log('Erros:', errSample);

fs.writeFileSync('audit-output/phase3-lot04-results.json', JSON.stringify({
  generated_at: now,
  aliases_inserted: NEW_ALIASES.length,
  central_america_resolutions: caResolutions,
  apply: { ok: okN, err: errN, skipped: skippedN, err_sample: errSample },
}, null, 2));
await pool.end();
process.exitCode = errN > 0 ? 1 : 0;
