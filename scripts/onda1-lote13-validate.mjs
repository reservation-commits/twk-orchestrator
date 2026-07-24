// LOTE 13 — VALIDATE CONSTRAINT for the 4 NOT VALID checks.
// Each VALIDATE scans the whole table; failure = there's dirty data we missed.
import fs from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';
const envPath = path.resolve(process.cwd(), '.env.local');
for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
}
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const constraints = [
  'db_restaurants_phone_e164ish_chk',
  'db_restaurants_email_format_chk',
  'db_restaurants_site_url_format_chk',
  'db_restaurants_coords_range_chk',
];

const results = [];
for (const c of constraints) {
  const t0 = Date.now();
  try {
    await pool.query(`ALTER TABLE public.db_restaurants VALIDATE CONSTRAINT "${c}"`);
    results.push({ constraint: c, status: 'valid', ms: Date.now() - t0 });
    console.log(`✓ ${c} validada (${Date.now()-t0}ms)`);
  } catch (e) {
    results.push({ constraint: c, status: 'failed', error: e.message, ms: Date.now() - t0 });
    console.log(`✗ ${c} FALHOU: ${e.message}`);
  }
}

// Final state
const after = await pool.query(`
  SELECT conname, convalidated FROM pg_constraint
  WHERE conrelid = 'public.db_restaurants'::regclass
    AND conname = ANY($1::text[])
  ORDER BY conname`, [constraints]);
console.log('\nEstado final:');
after.rows.forEach(r => console.log(' ', r.conname, '=>', r.convalidated ? 'VALID' : 'NOT VALID'));

fs.writeFileSync('audit-output/onda1-lote13-results.json', JSON.stringify({ generated_at: new Date().toISOString(), results, final_state: after.rows }, null, 2));
await pool.end();
process.exitCode = results.every(r => r.status === 'valid') ? 0 : 1;
