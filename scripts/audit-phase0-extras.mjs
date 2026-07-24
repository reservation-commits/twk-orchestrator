// Read-only complementary audit: distributions, related tables, status fields
import fs from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';

const envPath = path.resolve(process.cwd(), '.env.local');
for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const out = {};
const q = (sql, params=[]) => pool.query(sql, params).then(r => r.rows);

try {
  out.cities_top = await q(`SELECT city, country, COUNT(*)::int AS n FROM public.db_restaurants GROUP BY city, country ORDER BY n DESC NULLS LAST LIMIT 25`);
  out.countries_top = await q(`SELECT country, COUNT(*)::int AS n FROM public.db_restaurants GROUP BY country ORDER BY n DESC NULLS LAST LIMIT 25`);
  out.published_dist = await q(`SELECT published, COUNT(*)::int AS n FROM public.db_restaurants GROUP BY published`);
  out.partner_dist = await q(`SELECT partner, COUNT(*)::int AS n FROM public.db_restaurants GROUP BY partner ORDER BY n DESC LIMIT 20`);
  out.estab_type_dist = await q(`SELECT establishment_type, COUNT(*)::int AS n FROM public.db_restaurants GROUP BY establishment_type ORDER BY n DESC LIMIT 20`);
  out.negotiation_status_dist = await q(`SELECT negotiation_status, COUNT(*)::int AS n FROM public.db_restaurants GROUP BY negotiation_status ORDER BY n DESC LIMIT 20`);
  out.michelin_via_join = await q(`
    SELECT m.id, m.name AS title, m.stars, COUNT(r.restaurant_id)::int AS n
    FROM public.restaurant_michelin m
    LEFT JOIN public.db_restaurants r ON r.michelin_id = m.id
    GROUP BY m.id, m.name, m.stars ORDER BY m.id`);
  out.price_range = await q(`SELECT * FROM public.restaurant_price_range ORDER BY id`);
  out.restaurant_categories_count = await q(`SELECT COUNT(*)::int AS n FROM public.restaurant_categories`);
  out.restaurant_categories_sample = await q(`SELECT id, name FROM public.restaurant_categories ORDER BY id LIMIT 30`);
  out.cities_table_size = await q(`SELECT COUNT(*)::int AS n FROM public.cities`);
  out.cities_sample = await q(`SELECT * FROM public.cities ORDER BY id LIMIT 5`);
  out.countries_table_size = await q(`SELECT COUNT(*)::int AS n FROM public.countries`);
  out.opening_hours_size = await q(`SELECT COUNT(*)::int AS n, COUNT(DISTINCT restaurant_id)::int AS distinct_restaurants FROM public.opening_hours`);
  out.opening_hours_columns = await q(`SELECT column_name, data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='opening_hours' ORDER BY ordinal_position`);
  out.opening_hours_sample = await q(`SELECT * FROM public.opening_hours LIMIT 3`);
  out.restaurant_category_map_size = await q(`SELECT COUNT(*)::int AS n, COUNT(DISTINCT restaurant_id)::int AS distinct_restaurants FROM public.restaurant_category_map`);
  out.establishment_type_map_size = await q(`SELECT COUNT(*)::int AS n, COUNT(DISTINCT restaurant_id)::int AS distinct_restaurants FROM public.establishment_type_map`);
  out.restaurants_published_with_no_coords = await q(`SELECT COUNT(*)::int AS n FROM public.db_restaurants WHERE published=true AND (latitude IS NULL OR longitude IS NULL)`);
  out.restaurants_published_with_no_hours = await q(`SELECT COUNT(*)::int AS n FROM public.db_restaurants WHERE published=true AND business_hours_json IS NULL`);
  out.restaurants_published_with_no_phone = await q(`SELECT COUNT(*)::int AS n FROM public.db_restaurants WHERE published=true AND (telephone_of_the_establishment IS NULL OR length(btrim(telephone_of_the_establishment))=0)`);
  out.restaurants_published_with_no_email = await q(`SELECT COUNT(*)::int AS n FROM public.db_restaurants WHERE published=true AND (email_for_reservations IS NULL OR length(btrim(email_for_reservations))=0)`);
  out.restaurants_published_with_no_site = await q(`SELECT COUNT(*)::int AS n FROM public.db_restaurants WHERE published=true AND (site_url IS NULL OR length(btrim(site_url))=0)`);
  out.restaurants_published_with_no_place_id = await q(`SELECT COUNT(*)::int AS n FROM public.db_restaurants WHERE published=true AND (place_id IS NULL OR length(btrim(place_id))=0)`);
  out.restaurants_published_total = await q(`SELECT COUNT(*)::int AS n FROM public.db_restaurants WHERE published=true`);
  out.backup_relationship = await q(`
    SELECT
      (SELECT COUNT(*)::int FROM public.db_restaurants_backup) AS backup_rows,
      (SELECT COUNT(*)::int FROM public.db_restaurants) AS current_rows,
      (SELECT COUNT(*)::int FROM public.db_restaurants_backup b WHERE NOT EXISTS (SELECT 1 FROM public.db_restaurants r WHERE r.restaurant_id::text=b.restaurant_id::text)) AS in_backup_not_in_current`);
  out.duplicate_place_id_examples = await q(`
    SELECT place_id, array_agg(name) AS names, array_agg(restaurant_id) AS ids, array_agg(city) AS cities
    FROM public.db_restaurants WHERE place_id IS NOT NULL
    GROUP BY place_id HAVING COUNT(*)>1 ORDER BY place_id LIMIT 15`);

  fs.writeFileSync('audit-output/phase0-extras.json', JSON.stringify(out, null, 2));
  console.log('OK -> audit-output/phase0-extras.json');
} catch (e) {
  console.error('FAIL:', e.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
