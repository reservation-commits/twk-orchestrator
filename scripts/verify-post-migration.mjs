// READ-ONLY: verify post-migration state.
import fs from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';

const envPath = path.resolve(process.cwd(), '.env.local');
for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const q = (sql, p=[]) => pool.query(sql, p).then(r => r.rows);

const out = {};

// 1. Row count of db_restaurants — must remain 2207
out.row_count = await q(`SELECT COUNT(*)::int AS n FROM public.db_restaurants`);

// 2. New columns present on db_restaurants
const expectedNewCols = [
  'last_verified_at','verification_source','confidence_level','enrichment_log',
  'timezone','operational_status','operational_status_reason',
  'chef_name','chef_bio','reservation_policy','avg_meal_duration_minutes',
  'party_size_min','party_size_max','accepts_walkins','booking_url','dress_code',
  'dietary_tags','ambience_tags','good_for','tasting_menu_available','tasting_menu_price_min','tasting_menu_currency',
  'about_pt','about_en','about_fr','about_primary_locale',
  'country_code'
];
out.new_columns_present = await q(`
  SELECT column_name, data_type
  FROM information_schema.columns
  WHERE table_schema='public' AND table_name='db_restaurants'
    AND column_name = ANY($1::text[])
  ORDER BY column_name`, [expectedNewCols]);
out.new_columns_missing = expectedNewCols.filter(c => !out.new_columns_present.some(x => x.column_name === c));

// 3. Zombie columns must be GONE
const droppedCols = ['identity_proof','sales_representative','traded_currency','internal_notes','total_reservation'];
out.zombie_check = await q(`
  SELECT column_name FROM information_schema.columns
  WHERE table_schema='public' AND table_name='db_restaurants'
    AND column_name = ANY($1::text[])`, [droppedCols]);

// 4. localization preserved + new CHECK exists
out.localization_present = await q(`
  SELECT column_name, data_type FROM information_schema.columns
  WHERE table_schema='public' AND table_name='db_restaurants' AND column_name='localization'`);
out.localization_check = await q(`
  SELECT conname FROM pg_constraint
  WHERE conname = 'db_restaurants_localization_gmaps_chk'`);

// 5. partner is boolean now
out.partner_type = await q(`
  SELECT data_type FROM information_schema.columns
  WHERE table_schema='public' AND table_name='db_restaurants' AND column_name='partner'`);
out.partner_distribution = await q(`
  SELECT partner, COUNT(*)::int AS n FROM public.db_restaurants GROUP BY partner ORDER BY n DESC`);

// 6. negotiation_status is enum
out.negotiation_status_type = await q(`
  SELECT data_type, udt_name FROM information_schema.columns
  WHERE table_schema='public' AND table_name='db_restaurants' AND column_name='negotiation_status'`);

// 7. New tables exist with expected rows
out.new_tables = await q(`
  SELECT n.nspname AS schema, c.relname AS name,
         (SELECT reltuples::bigint FROM pg_class WHERE oid = c.oid) AS approx_rows
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public'
    AND c.relname IN ('restaurant_field_verifications','restaurant_awards','award_types','country_name_aliases','v_restaurant_latest_awards')
  ORDER BY c.relname`);

out.award_types_count = await q(`SELECT COUNT(*)::int AS n FROM public.award_types`);
out.country_aliases_count = await q(`SELECT COUNT(*)::int AS n FROM public.country_name_aliases`);

// 8. Constraint inventory on db_restaurants
out.constraints_on_db_restaurants = await q(`
  SELECT conname, contype, convalidated FROM pg_constraint
  WHERE conrelid = 'public.db_restaurants'::regclass
    AND contype IN ('c','u')
  ORDER BY conname`);

// 9. Indexes on db_restaurants
out.indexes_on_db_restaurants = await q(`
  SELECT indexname FROM pg_indexes
  WHERE schemaname='public' AND tablename='db_restaurants'
  ORDER BY indexname`);

// 10. Default operational_status applied
out.operational_status_distribution = await q(`
  SELECT operational_status, COUNT(*)::int AS n FROM public.db_restaurants
  GROUP BY operational_status`);

fs.writeFileSync('audit-output/post-migration-verify.json', JSON.stringify(out, null, 2));
console.log('OK -> audit-output/post-migration-verify.json');
console.log(`Linhas em db_restaurants: ${out.row_count[0].n} (esperado: 2207)`);
console.log(`Novas colunas presentes: ${out.new_columns_present.length}/${expectedNewCols.length}`);
console.log(`Colunas zumbi restantes: ${out.zombie_check.length} (esperado: 0)`);
console.log(`Tipo de partner: ${out.partner_type[0]?.data_type}`);
console.log(`Tipo de negotiation_status: ${out.negotiation_status_type[0]?.udt_name}`);
console.log(`Novas tabelas/views: ${out.new_tables.length}/5`);
console.log(`award_types pré-cadastrados: ${out.award_types_count[0].n}`);
console.log(`country_name_aliases pré-cadastrados: ${out.country_aliases_count[0].n}`);
await pool.end();
