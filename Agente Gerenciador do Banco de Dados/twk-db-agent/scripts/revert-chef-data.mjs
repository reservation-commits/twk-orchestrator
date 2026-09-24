// Revert all chef_name values applied in this session.
// Reason: human decision (chef data is volatile, defasagem risk > benefit).
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

// Find every restaurant with chef_name filled
const rows = (await pool.query(`
  SELECT restaurant_id, name, chef_name
  FROM public.db_restaurants
  WHERE chef_name IS NOT NULL AND chef_name <> ''
  ORDER BY restaurant_id`)).rows;
console.log(`Restaurantes com chef_name preenchido: ${rows.length}`);
rows.forEach(r => console.log(`  [${r.restaurant_id}] ${r.name} | chef="${r.chef_name}"`));

if (!rows.length) { console.log('Nada a reverter.'); await pool.end(); process.exit(0); }

let ok = 0, err = 0;
for (const r of rows) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const entry = {
      field: 'chef_name',
      old_value: r.chef_name,
      new_value: null,
      reason: 'Decisão humana: chef é dado volátil (chef troca de restaurante). Sem processo de re-verificação, preferimos não ter o dado a ter dado defasado. Conteúdo preservado neste log.',
      source: 'human-approved-revert',
      verified_at: now,
      confidence: 'HIGH',
      agent: AGENT,
      batch: 'revert-chef-data',
    };
    await client.query(`
      UPDATE public.db_restaurants
         SET chef_name = NULL,
             chef_bio = NULL,
             enrichment_log = enrichment_log || $2::jsonb
       WHERE restaurant_id = $1`,
      [r.restaurant_id, JSON.stringify([entry])]);
    await client.query(`
      INSERT INTO public.restaurant_field_verifications
        (restaurant_id, field_name, value_hash, source, source_kind, verified_at, confidence_level, agent, notes)
      VALUES ($1, 'chef_name', md5('NULL'), 'human-approved-revert', 'other', $2::timestamptz, 'HIGH', $3, 'revert-chef-data — dado volátil')`,
      [r.restaurant_id, now, AGENT]);
    await client.query('COMMIT');
    ok++;
    console.log(`  ✓ ${r.restaurant_id} ${r.name}`);
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch {}
    err++;
    console.log(`  ✗ ${r.restaurant_id}: ${e.message}`);
  } finally { client.release(); }
}
console.log(`\nRevertidos: ${ok}/${rows.length} | erros: ${err}`);
await pool.end();
process.exitCode = err > 0 ? 1 : 0;
