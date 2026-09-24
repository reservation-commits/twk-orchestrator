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
    COUNT(*) FILTER (WHERE published=true AND latitude IS NOT NULL) AS pub_with_coords,
    COUNT(*) FILTER (WHERE published=true AND latitude IS NULL) AS pub_without_coords
  FROM public.db_restaurants`);
out.sam = await q(`
  SELECT restaurant_id, name, latitude, longitude, localization, email_for_reservations,
         last_verified_at, confidence_level
  FROM public.db_restaurants WHERE restaurant_id='40721'`);
out.sample_log = await q(`
  SELECT restaurant_id, name, jsonb_pretty(enrichment_log) AS log
  FROM public.db_restaurants WHERE restaurant_id='40721'`);
out.bad_emails_cleaned = await q(`
  SELECT restaurant_id, name,
         (SELECT COUNT(*) FROM public.restaurant_field_verifications v
          WHERE v.restaurant_id = r.restaurant_id AND v.field_name='email_for_reservations'
                AND v.notes LIKE 'lot01-D%')::int AS audit_rows,
         email_for_reservations
  FROM public.db_restaurants r WHERE restaurant_id IN ('40721','14504','14480','14408')`);
console.log(JSON.stringify(out, null, 2));
await pool.end();
