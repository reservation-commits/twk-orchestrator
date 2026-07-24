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

const r = await q(`
  SELECT
    COUNT(*) FILTER (WHERE published=true) AS publicados,
    -- Email
    COUNT(*) FILTER (WHERE published=true AND (email_for_reservations IS NULL OR email_for_reservations='')) AS sem_email,
    -- Phone
    COUNT(*) FILTER (WHERE published=true AND (telephone_of_the_establishment IS NULL OR telephone_of_the_establishment='')) AS sem_phone,
    -- Site
    COUNT(*) FILTER (WHERE published=true AND (site_url IS NULL OR site_url='')) AS sem_site,
    -- Booking
    COUNT(*) FILTER (WHERE published=true AND (booking_url IS NULL OR booking_url='')) AS sem_booking,
    -- Price
    COUNT(*) FILTER (WHERE published=true AND price_range_id IS NULL) AS sem_price,
    -- Hours: structured json OR rows in opening_hours
    COUNT(*) FILTER (WHERE published=true
      AND (business_hours_json IS NULL OR business_hours_json::text IN ('null','{}'))
      AND NOT EXISTS (SELECT 1 FROM public.opening_hours oh WHERE oh.restaurant_id=public.db_restaurants.restaurant_id)
    ) AS sem_hours,
    -- About
    COUNT(*) FILTER (WHERE published=true
      AND COALESCE(about_text,'')='' AND COALESCE(about_pt,'')=''
      AND COALESCE(about_en,'')='' AND COALESCE(about_fr,'')='') AS sem_about,
    -- Cuisines
    COUNT(*) FILTER (WHERE published=true
      AND NOT EXISTS (SELECT 1 FROM public.restaurant_category_map m WHERE m.restaurant_id=public.db_restaurants.restaurant_id)) AS sem_cuisine,
    -- Images
    COUNT(*) FILTER (WHERE published=true
      AND (images_json IS NULL OR images_json::text IN ('null','{}'))) AS sem_imagem,
    -- Logo
    COUNT(*) FILTER (WHERE published=true AND (logo_url IS NULL OR logo_url='')) AS sem_logo,
    -- ISO country code
    COUNT(*) FILTER (WHERE published=true AND country_code IS NULL) AS sem_iso,
    -- Chef
    COUNT(*) FILTER (WHERE published=true AND (chef_name IS NULL OR chef_name='')) AS sem_chef,
    -- Reservation policy
    COUNT(*) FILTER (WHERE published=true AND (reservation_policy IS NULL OR reservation_policy='')) AS sem_reservation_policy,
    -- Governance freshness
    COUNT(*) FILTER (WHERE published=true
      AND last_verified_at > NOW() - INTERVAL '180 days'
      AND confidence_level IN ('HIGH','MEDIUM')) AS gov_ok,
    -- Awards
    COUNT(*) FILTER (WHERE published=true
      AND EXISTS (SELECT 1 FROM public.restaurant_awards a WHERE a.restaurant_id=public.db_restaurants.restaurant_id)) AS com_award
  FROM public.db_restaurants`);

const x = r[0];
const t = parseInt(x.publicados);
function pct(n) { return ((100*parseInt(n)/t).toFixed(1) + '%').padStart(7); }
function show(label, weight, gap) {
  const fill = ((parseInt(t)-parseInt(gap))/t * 100).toFixed(1);
  const lost = (weight * parseInt(gap)/t).toFixed(2);
  console.log(`  ${label.padEnd(28)} | peso ${String(weight).padStart(2)} | falta em ${pct(gap)} (${gap}/${t}) | -${lost} pts/100`);
}

console.log(`Total publicados: ${t}\n`);
console.log('=== LACUNAS por campo (ordenadas por impacto no score) ===\n');
show('Hours estruturados', 12, x.sem_hours);
show('Email', 8, x.sem_email);
show('Imagens (galeria)', 8, x.sem_imagem);
show('Chef', 2, x.sem_chef);
show('About (qualquer idioma)', 5, x.sem_about);
show('Cuisines mapeadas', 5, x.sem_cuisine);
show('Reservation policy', 2, x.sem_reservation_policy);
show('Price range', 5, x.sem_price);
show('Phone', 8, x.sem_phone);
show('Site oficial', 6, x.sem_site);
show('ISO country code', 3, x.sem_iso);
show('Logo URL', 4, x.sem_logo);
show('Awards', 2, x.com_award);
show('Governance fresca', 6, t - parseInt(x.gov_ok));

await pool.end();
