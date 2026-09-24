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
out.coords_status = await q(`
  SELECT
    COUNT(*) FILTER (WHERE published=true) AS published,
    COUNT(*) FILTER (WHERE published=true AND latitude IS NOT NULL AND longitude IS NOT NULL) AS pub_with_coords,
    COUNT(*) FILTER (WHERE published=true AND latitude IS NULL) AS pub_without_coords
  FROM public.db_restaurants`);
out.gov_status = await q(`
  SELECT
    COUNT(*) FILTER (WHERE last_verified_at IS NOT NULL) AS with_verified_at,
    COUNT(*) FILTER (WHERE confidence_level = 'HIGH') AS high,
    COUNT(*) FILTER (WHERE confidence_level = 'CONFLICT') AS conflict
  FROM public.db_restaurants`);
out.localization_filled = await q(`
  SELECT COUNT(*) AS n FROM public.db_restaurants WHERE localization IS NOT NULL`);
out.verifications_inserted = await q(`
  SELECT COUNT(*) AS n, COUNT(DISTINCT restaurant_id) AS distinct_restaurants
  FROM public.restaurant_field_verifications WHERE notes LIKE 'lot01%'`);
out.unpublished_recently = await q(`
  SELECT restaurant_id, name, operational_status, operational_status_reason
  FROM public.db_restaurants
  WHERE published = false
    AND confidence_level = 'CONFLICT'
  ORDER BY restaurant_id`);
out.sam_state = await q(`
  SELECT restaurant_id, name, latitude, longitude, localization, last_verified_at, confidence_level
  FROM public.db_restaurants WHERE restaurant_id='40721'`);
console.log(JSON.stringify(out, null, 2));
await pool.end();
