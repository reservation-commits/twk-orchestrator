// Migrate legacy michelin_id (4 buckets) to the new restaurant_awards table.
// Source of truth for these 423 records is the existing curated data.
// We mark confidence as MEDIUM since the legacy data has no source URL —
// just a curator's classification that we now formalize.
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
const currentYear = new Date().getFullYear();

// Map legacy michelin_id to new award_code + level
// From restaurant_michelin table earlier:
//   id=2 stars=1 → 1 Star
//   id=3 stars=2 → 2 Stars
//   id=4 stars=3 → 3 Stars
//   id=5 stars=0 → Michelin Guide (no star)
const MAP = {
  2: { award_code: 'michelin_star', level: 1, name: '1 Michelin Star' },
  3: { award_code: 'michelin_star', level: 2, name: '2 Michelin Stars' },
  4: { award_code: 'michelin_star', level: 3, name: '3 Michelin Stars' },
  5: { award_code: 'michelin_guide_listed', level: null, name: 'Michelin Guide (sem estrela)' },
};

const rows = (await pool.query(`
  SELECT restaurant_id, name, city, michelin_id
  FROM public.db_restaurants
  WHERE michelin_id IS NOT NULL
  ORDER BY michelin_id, restaurant_id`)).rows;
console.log(`Restaurantes com michelin_id: ${rows.length}`);

let okN = 0, errN = 0, skipN = 0;
const errs = [];

for (const r of rows) {
  const mapping = MAP[r.michelin_id];
  if (!mapping) { skipN++; continue; }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Check if already exists (idempotent)
    const existing = await client.query(`
      SELECT 1 FROM public.restaurant_awards
      WHERE restaurant_id=$1 AND award_code=$2 AND year=$3
      LIMIT 1`,
      [r.restaurant_id, mapping.award_code, currentYear]);
    if (existing.rows.length) { skipN++; await client.query('ROLLBACK'); continue; }

    await client.query(`
      INSERT INTO public.restaurant_awards
        (restaurant_id, award_code, level, year, source_url, verified_at, confidence_level, notes)
      VALUES ($1, $2, $3, $4, $5, $6::timestamptz, $7, $8)`,
      [
        r.restaurant_id,
        mapping.award_code,
        mapping.level,
        currentYear,
        'legacy:michelin_id', // not a real URL — flagged as legacy
        now,
        'MEDIUM',  // legacy data, no fresh source URL — needs Michelin scrape to upgrade to HIGH
        `Migrado de michelin_id=${r.michelin_id} (${mapping.name}). Sem URL de fonte original.`,
      ]);

    const entry = {
      field: 'restaurant_awards',
      action: 'insert_from_legacy',
      award_code: mapping.award_code, level: mapping.level, year: currentYear,
      source: 'legacy:michelin_id', verified_at: now, confidence: 'MEDIUM',
      agent: AGENT, batch: 'migrate-michelin-legacy',
      reason: `Curadoria legada (michelin_id=${r.michelin_id}). Aguarda verificação contra guide.michelin.com pra subir confiança.`,
    };
    await client.query(`
      UPDATE public.db_restaurants
         SET enrichment_log = enrichment_log || $2::jsonb
       WHERE restaurant_id = $1`,
      [r.restaurant_id, JSON.stringify([entry])]);

    await client.query(`
      INSERT INTO public.restaurant_field_verifications
        (restaurant_id, field_name, value_hash, source, source_kind, verified_at, confidence_level, agent, notes)
      VALUES ($1, 'award:michelin', md5($2), 'legacy:michelin_id', 'other', $3::timestamptz, 'MEDIUM', $4, 'migrate-michelin-legacy')`,
      [r.restaurant_id, `${mapping.award_code}/level=${mapping.level}`, now, AGENT]);

    await client.query('COMMIT');
    okN++;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch {}
    errN++;
    if (errs.length < 10) errs.push({ id: r.restaurant_id, name: r.name, err: e.message });
  } finally { client.release(); }
}

console.log(`\nResultado: ok=${okN} | skip (já existia)=${skipN} | err=${errN}`);
if (errs.length) console.log('Erros (amostra):', errs);

const counts = await pool.query(`
  SELECT award_code, level, COUNT(*)::int AS n
  FROM public.restaurant_awards
  GROUP BY award_code, level
  ORDER BY award_code, level NULLS FIRST`);
console.log('\nEstado da tabela restaurant_awards:');
counts.rows.forEach(c => console.log(`  ${c.award_code} (level=${c.level}): ${c.n}`));

fs.writeFileSync('audit-output/migrate-michelin-legacy-results.json', JSON.stringify({
  generated_at: now, total: rows.length, applied: okN, skipped: skipN, errors: errN, err_sample: errs,
  final_counts: counts.rows,
}, null, 2));
await pool.end();
process.exitCode = errN > 0 ? 1 : 0;
