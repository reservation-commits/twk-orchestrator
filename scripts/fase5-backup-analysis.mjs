// READ-ONLY: analyze the 9,971 records in db_restaurants_backup that don't exist
// in db_restaurants. Categorize by signal so user can decide policy.
import fs from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';
const envPath = path.resolve(process.cwd(), '.env.local');
for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
}
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const q = (sql, p) => pool.query(sql, p).then(r => r.rows);

const out = {};

// 1. Backup table schema (what columns exist)
out.backup_cols = await q(`
  SELECT column_name, data_type FROM information_schema.columns
  WHERE table_schema='public' AND table_name='db_restaurants_backup'
  ORDER BY ordinal_position`);

// 2. Counts
out.counts = await q(`
  SELECT
    (SELECT COUNT(*)::int FROM public.db_restaurants_backup) AS backup_total,
    (SELECT COUNT(*)::int FROM public.db_restaurants) AS current_total,
    (SELECT COUNT(*)::int FROM public.db_restaurants_backup b
       WHERE NOT EXISTS (SELECT 1 FROM public.db_restaurants r WHERE r.restaurant_id::text=b.restaurant_id::text))
    AS orphans`);

// 3. Cross-check: are any orphans actually in current under DIFFERENT id (same name+city)?
// NOTE: backup pre-dates place_id, so only name+city matching is possible.
out.orphans_with_match_in_current = await q(`
  WITH orphans AS (
    SELECT b.* FROM public.db_restaurants_backup b
    WHERE NOT EXISTS (SELECT 1 FROM public.db_restaurants r WHERE r.restaurant_id::text=b.restaurant_id::text)
  )
  SELECT
    SUM(CASE WHEN EXISTS (SELECT 1 FROM public.db_restaurants r WHERE LOWER(r.name)=LOWER(o.name) AND LOWER(COALESCE(r.city,''))=LOWER(COALESCE(o.city,''))) THEN 1 ELSE 0 END)::int AS by_name_city,
    COUNT(*)::int AS total_orphans
  FROM orphans o`);

// 4. Distribution by signals in the backup itself
out.by_status_signals = await q(`
  WITH orphans AS (
    SELECT b.* FROM public.db_restaurants_backup b
    WHERE NOT EXISTS (SELECT 1 FROM public.db_restaurants r WHERE r.restaurant_id::text=b.restaurant_id::text)
  )
  SELECT
    SUM(CASE WHEN latitude IS NULL THEN 1 ELSE 0 END)::int AS no_coords,
    SUM(CASE WHEN site_url IS NULL OR site_url='' THEN 1 ELSE 0 END)::int AS no_site,
    SUM(CASE WHEN telephone_of_the_establishment IS NULL OR telephone_of_the_establishment='' THEN 1 ELSE 0 END)::int AS no_phone,
    SUM(CASE WHEN email_for_reservations IS NULL OR email_for_reservations='' THEN 1 ELSE 0 END)::int AS no_email,
    SUM(CASE WHEN images_json IS NULL THEN 1 ELSE 0 END)::int AS no_images,
    COUNT(*)::int AS total
  FROM orphans`);

// 5. Top cities/countries in orphans
out.top_countries = await q(`
  SELECT country, COUNT(*)::int AS n FROM public.db_restaurants_backup b
  WHERE NOT EXISTS (SELECT 1 FROM public.db_restaurants r WHERE r.restaurant_id::text=b.restaurant_id::text)
  GROUP BY country ORDER BY n DESC NULLS LAST LIMIT 15`);
out.top_cities = await q(`
  SELECT city, country, COUNT(*)::int AS n FROM public.db_restaurants_backup b
  WHERE NOT EXISTS (SELECT 1 FROM public.db_restaurants r WHERE r.restaurant_id::text=b.restaurant_id::text)
  GROUP BY city, country ORDER BY n DESC NULLS LAST LIMIT 15`);

// 6. Created date distribution (when were they cadastrados?)
out.by_year = await q(`
  SELECT EXTRACT(YEAR FROM created_date)::int AS year, COUNT(*)::int AS n
  FROM public.db_restaurants_backup b
  WHERE NOT EXISTS (SELECT 1 FROM public.db_restaurants r WHERE r.restaurant_id::text=b.restaurant_id::text)
    AND created_date IS NOT NULL
  GROUP BY year ORDER BY year`);

// 7. Sample of orphans WITH coords + name + site (most "rescuable")
out.rescuable_sample = await q(`
  SELECT restaurant_id, name, city, country, site_url, latitude, longitude,
         CASE WHEN length(COALESCE(about_text,''))>0 THEN 'sim' ELSE 'não' END AS has_about
  FROM public.db_restaurants_backup b
  WHERE NOT EXISTS (SELECT 1 FROM public.db_restaurants r WHERE r.restaurant_id::text=b.restaurant_id::text)
    AND latitude IS NOT NULL AND longitude IS NOT NULL
    AND name IS NOT NULL AND length(btrim(name))>0
    AND city IS NOT NULL
    AND site_url IS NOT NULL AND length(btrim(site_url))>0
  ORDER BY created_date DESC NULLS LAST
  LIMIT 15`);

// 8. Sample of orphans LIKELY junk (no coords, no contact)
out.junk_sample = await q(`
  SELECT restaurant_id, name, city, country, created_date
  FROM public.db_restaurants_backup b
  WHERE NOT EXISTS (SELECT 1 FROM public.db_restaurants r WHERE r.restaurant_id::text=b.restaurant_id::text)
    AND latitude IS NULL
    AND (telephone_of_the_establishment IS NULL OR telephone_of_the_establishment='')
    AND (site_url IS NULL OR site_url='')
  LIMIT 15`);

// 9. Orphans whose name+city EXISTS in current — "lost duplicates"
out.lost_duplicates = await q(`
  SELECT b.restaurant_id AS backup_id, b.name AS backup_name, b.city AS backup_city,
         r.restaurant_id AS current_id, r.name AS current_name, r.city AS current_city
  FROM public.db_restaurants_backup b
  JOIN public.db_restaurants r
    ON LOWER(r.name)=LOWER(b.name) AND LOWER(COALESCE(r.city,''))=LOWER(COALESCE(b.city,''))
  WHERE NOT EXISTS (SELECT 1 FROM public.db_restaurants r2 WHERE r2.restaurant_id::text=b.restaurant_id::text)
    AND b.name IS NOT NULL AND length(btrim(b.name))>0
  ORDER BY b.created_date DESC NULLS LAST
  LIMIT 15`);

fs.writeFileSync('audit-output/fase5-backup-analysis.json', JSON.stringify(out, null, 2));

console.log('\n========== BACKUP ÓRFÃO ANALYSIS ==========');
console.log(`Backup total:   ${out.counts[0].backup_total}`);
console.log(`Current total:  ${out.counts[0].current_total}`);
console.log(`Órfãos:         ${out.counts[0].orphans}`);
console.log();
console.log('=== Sinais de qualidade nos órfãos ===');
const s = out.by_status_signals[0];
console.log(`  sem coordenadas: ${s.no_coords} (${(100*s.no_coords/s.total).toFixed(1)}%)`);
console.log(`  sem site:        ${s.no_site} (${(100*s.no_site/s.total).toFixed(1)}%)`);
console.log(`  sem telefone:    ${s.no_phone} (${(100*s.no_phone/s.total).toFixed(1)}%)`);
console.log(`  sem email:       ${s.no_email} (${(100*s.no_email/s.total).toFixed(1)}%)`);
console.log(`  sem imagens:     ${s.no_images} (${(100*s.no_images/s.total).toFixed(1)}%)`);
console.log();
console.log(`=== Cross-match com o atual (por nome+cidade) ===`);
const cm = out.orphans_with_match_in_current[0];
console.log(`  por nome+cidade: ${cm.by_name_city} órfãos têm match no atual (provável re-cadastro)`);
console.log();
console.log(`=== Lost duplicates (nome+cidade já está no atual) ===`);
out.lost_duplicates.slice(0, 5).forEach(d => console.log(`  • backup[${d.backup_id}] "${d.backup_name}" (${d.backup_city}) ↔ current[${d.current_id}] "${d.current_name}" (${d.current_city})`));
console.log();
console.log('=== Top países dos órfãos ===');
out.top_countries.forEach(c => console.log(`  ${(c.n+'').padStart(5)} | ${c.country || '(NULL)'}`));
console.log();
console.log('=== Cadastros por ano ===');
out.by_year.forEach(y => console.log(`  ${y.year}: ${y.n}`));

await pool.end();
