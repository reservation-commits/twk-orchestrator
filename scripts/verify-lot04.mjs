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
out.coverage = await q(`
  SELECT
    COUNT(*) AS total,
    COUNT(country_code) AS with_code,
    COUNT(*) FILTER (WHERE country IS NOT NULL AND country_code IS NULL) AS country_no_code,
    COUNT(*) FILTER (WHERE country IS NULL) AS no_country
  FROM public.db_restaurants`);

out.distinct_now = await q(`
  SELECT country, country_code, COUNT(*)::int AS n
  FROM public.db_restaurants
  GROUP BY country, country_code
  ORDER BY n DESC LIMIT 30`);

out.lot04_changes = await q(`
  SELECT field_name, COUNT(*)::int AS n
  FROM public.restaurant_field_verifications WHERE notes='lot04'
  GROUP BY field_name`);

out.bad_country = await q(`
  SELECT country, country_code, COUNT(*)::int AS n
  FROM public.db_restaurants
  WHERE country IS NOT NULL AND country_code IS NULL
  GROUP BY country, country_code ORDER BY n DESC`);

console.log(JSON.stringify(out, null, 2));
await pool.end();
