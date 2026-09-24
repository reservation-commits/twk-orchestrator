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

out.bad_phones = await q(`
  SELECT COUNT(*)::int AS n
  FROM public.db_restaurants
  WHERE telephone_of_the_establishment IS NOT NULL
    AND telephone_of_the_establishment <> ''
    AND telephone_of_the_establishment !~ '^\\+[0-9 .()\\-]{6,30}$'`);

out.bad_phones_sample = await q(`
  SELECT restaurant_id, name, telephone_of_the_establishment
  FROM public.db_restaurants
  WHERE telephone_of_the_establishment IS NOT NULL
    AND telephone_of_the_establishment <> ''
    AND telephone_of_the_establishment !~ '^\\+[0-9 .()\\-]{6,30}$'
  LIMIT 30`);

out.bad_sites = await q(`
  SELECT COUNT(*)::int AS n
  FROM public.db_restaurants
  WHERE site_url IS NOT NULL
    AND site_url <> ''
    AND site_url !~* '^https?://'`);

out.bad_sites_sample = await q(`
  SELECT restaurant_id, name, site_url
  FROM public.db_restaurants
  WHERE site_url IS NOT NULL
    AND site_url <> ''
    AND site_url !~* '^https?://'
  LIMIT 30`);

out.bad_emails = await q(`
  SELECT COUNT(*)::int AS n
  FROM public.db_restaurants
  WHERE email_for_reservations IS NOT NULL
    AND email_for_reservations <> ''
    AND email_for_reservations !~* '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$'`);

out.bad_coords = await q(`
  SELECT COUNT(*)::int AS n
  FROM public.db_restaurants
  WHERE NOT (
    (latitude IS NULL AND longitude IS NULL)
    OR (latitude BETWEEN -90 AND 90 AND longitude BETWEEN -180 AND 180
        AND NOT (latitude = 0 AND longitude = 0))
  )`);

console.log(JSON.stringify(out, null, 2));
await pool.end();
