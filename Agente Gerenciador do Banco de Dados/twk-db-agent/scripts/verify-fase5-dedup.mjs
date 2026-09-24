import fs from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';
const envPath = path.resolve(process.cwd(), '.env.local');
for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
}
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const q = (sql) => pool.query(sql).then(r => r.rows);

const out = {};
out.dup_groups_remaining = await q(`
  SELECT place_id, COUNT(*)::int AS n FROM public.db_restaurants
  WHERE place_id IS NOT NULL GROUP BY place_id HAVING COUNT(*)>1`);
out.neutralized_today = await q(`
  SELECT restaurant_id, name, published, operational_status, operational_status_reason
  FROM public.db_restaurants
  WHERE operational_status_reason LIKE 'Duplicata mesclada%'
  ORDER BY restaurant_id`);
out.published_total = await q(`SELECT COUNT(*)::int AS n FROM public.db_restaurants WHERE published=true`);
console.log(JSON.stringify(out, null, 2));
await pool.end();
