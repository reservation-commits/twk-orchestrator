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

const out = await q(`
  SELECT
    COUNT(*) FILTER (WHERE published=true) AS publicados,
    COUNT(*) FILTER (WHERE published=true AND latitude IS NOT NULL) AS com_coords,
    COUNT(*) FILTER (WHERE published=true AND timezone IS NOT NULL) AS com_tz,
    COUNT(*) FILTER (WHERE published=true AND country_code IS NOT NULL) AS com_iso,
    COUNT(*) FILTER (WHERE published=true AND (telephone_of_the_establishment IS NULL OR telephone_of_the_establishment='')) AS sem_phone,
    COUNT(*) FILTER (WHERE published=true AND (email_for_reservations IS NULL OR email_for_reservations='')) AS sem_email,
    COUNT(*) FILTER (WHERE published=true AND (site_url IS NULL OR site_url='')) AS sem_site,
    COUNT(*) FILTER (WHERE published=true AND price_range_id IS NULL) AS sem_price,
    COUNT(*) FILTER (WHERE published=true AND (site_url IS NULL OR site_url='') AND (email_for_reservations IS NULL OR email_for_reservations='') AND (booking_url IS NULL OR booking_url='')) AS sem_canal,
    COUNT(*) FILTER (WHERE published=true AND (operational_status='unknown')) AS status_unknown,
    (SELECT COUNT(*) FROM public.restaurant_awards) AS total_awards,
    (SELECT COUNT(DISTINCT restaurant_id) FROM public.restaurant_awards) AS rest_com_award,
    (SELECT COUNT(*) FROM public.restaurant_field_verifications) AS audit_lines,
    (SELECT COUNT(*)::int FROM (
       SELECT place_id FROM public.db_restaurants
       WHERE place_id IS NOT NULL GROUP BY place_id HAVING COUNT(*)>1
     ) x) AS dup_remaining_groups
  FROM public.db_restaurants`);
console.log(JSON.stringify(out[0], null, 2));

// 22 sem nenhum canal de contato
const noContact = await q(`
  SELECT restaurant_id, name, city, country
  FROM public.db_restaurants
  WHERE published=true
    AND (site_url IS NULL OR site_url='')
    AND (email_for_reservations IS NULL OR email_for_reservations='')
    AND (booking_url IS NULL OR booking_url='')
  ORDER BY restaurant_id`);
console.log('\n22 publicados SEM canal de contato:');
noContact.forEach(r => console.log(`  [${r.restaurant_id}] ${r.name.padEnd(30)} | ${r.city}, ${r.country}`));

// 3 dedup groups remaining
const dup = await q(`
  SELECT place_id, array_agg(restaurant_id || ' (' || name || ')') AS pares
  FROM public.db_restaurants WHERE place_id IS NOT NULL
  GROUP BY place_id HAVING COUNT(*)>1`);
console.log('\nGrupos duplicados pendentes:');
dup.forEach(d => console.log(`  ${d.place_id}: ${d.pares.join(' | ')}`));

await pool.end();
