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
out.tz_coverage = await q(`
  SELECT
    COUNT(*) FILTER (WHERE published=true) AS published,
    COUNT(*) FILTER (WHERE published=true AND timezone IS NOT NULL) AS pub_with_tz,
    COUNT(*) FILTER (WHERE published=true AND timezone IS NULL) AS pub_without_tz,
    COUNT(*) FILTER (WHERE timezone IS NOT NULL) AS total_with_tz
  FROM public.db_restaurants`);

out.top_timezones = await q(`
  SELECT timezone, COUNT(*)::int AS n
  FROM public.db_restaurants
  WHERE timezone IS NOT NULL
  GROUP BY timezone ORDER BY n DESC LIMIT 15`);

out.dirty_fields_remaining = await q(`
  SELECT
    (SELECT COUNT(*)::int FROM public.db_restaurants
       WHERE telephone_of_the_establishment IS NOT NULL
         AND telephone_of_the_establishment <> ''
         AND telephone_of_the_establishment !~ '^\\+[0-9 .()\\-]{6,30}$') AS bad_phones,
    (SELECT COUNT(*)::int FROM public.db_restaurants
       WHERE site_url IS NOT NULL AND site_url <> ''
         AND site_url !~* '^https?://') AS bad_sites,
    (SELECT COUNT(*)::int FROM public.db_restaurants
       WHERE email_for_reservations IS NOT NULL
         AND email_for_reservations <> ''
         AND email_for_reservations !~* '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$') AS bad_emails`);

out.governance_summary = await q(`
  SELECT
    COUNT(*) FILTER (WHERE last_verified_at IS NOT NULL) AS with_verified_at,
    COUNT(*) FILTER (WHERE confidence_level='HIGH') AS high,
    COUNT(*) FILTER (WHERE confidence_level='CONFLICT') AS conflict
  FROM public.db_restaurants`);

out.verifications_total = await q(`
  SELECT COUNT(*)::int AS n,
         COUNT(*) FILTER (WHERE notes LIKE 'lot01%')::int AS lot01,
         COUNT(*) FILTER (WHERE notes LIKE 'lot02%')::int AS lot02
  FROM public.restaurant_field_verifications`);

console.log(JSON.stringify(out, null, 2));
await pool.end();
