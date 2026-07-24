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
out.gaps_now = await q(`
  SELECT
    COUNT(*) FILTER (WHERE published=true) AS published,
    COUNT(*) FILTER (WHERE published=true AND (telephone_of_the_establishment IS NULL OR telephone_of_the_establishment='')) AS pub_no_phone,
    COUNT(*) FILTER (WHERE published=true AND (site_url IS NULL OR site_url='')) AS pub_no_site,
    COUNT(*) FILTER (WHERE published=true AND price_range_id IS NULL) AS pub_no_price,
    COUNT(*) FILTER (WHERE published=true AND (site_url IS NULL OR site_url='') AND (email_for_reservations IS NULL OR email_for_reservations='') AND (booking_url IS NULL OR booking_url='')) AS pub_no_contact_channel,
    COUNT(*) FILTER (WHERE published=true AND latitude IS NULL) AS pub_no_coords,
    COUNT(*) FILTER (WHERE published=true AND timezone IS NULL) AS pub_no_tz
  FROM public.db_restaurants`);

out.lot03_changes = await q(`
  SELECT COUNT(*)::int AS n,
         COUNT(*) FILTER (WHERE field_name='telephone_of_the_establishment')::int AS phone,
         COUNT(*) FILTER (WHERE field_name='site_url')::int AS site,
         COUNT(*) FILTER (WHERE field_name='price_range_id')::int AS price,
         COUNT(*) FILTER (WHERE field_name='published')::int AS unpublished,
         COUNT(*) FILTER (WHERE field_name='operational_status')::int AS op_status
  FROM public.restaurant_field_verifications WHERE notes='lot03'`);

out.unpublished_lot03 = await q(`
  SELECT restaurant_id, name, city, operational_status, operational_status_reason
  FROM public.db_restaurants
  WHERE confidence_level='CONFLICT' AND published=false
    AND last_verified_at::date = CURRENT_DATE
  ORDER BY restaurant_id`);

console.log(JSON.stringify(out, null, 2));
await pool.end();
