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
out.totals = await q(`
  SELECT
    COUNT(*) FILTER (WHERE published=true) AS publicados,
    COUNT(*) FILTER (WHERE published=true AND verification_source LIKE 'google_places:%' AND last_verified_at::date = CURRENT_DATE) AS novos_hoje,
    COUNT(*) AS total
  FROM public.db_restaurants`);

out.fase6_inserts = await q(`
  SELECT
    COUNT(*) AS inseridos_fase6,
    COUNT(*) FILTER (WHERE published=true) AS publicados,
    COUNT(*) FILTER (WHERE operational_status='closed_permanently') AS fechados_permanente,
    COUNT(*) FILTER (WHERE operational_status='temporarily_closed') AS fechados_temp
  FROM public.db_restaurants
  WHERE enrichment_log::text LIKE '%fase6-phase-c%'`);

out.awards_inseridos = await q(`
  SELECT award_code, level, COUNT(*)::int AS n
  FROM public.restaurant_awards
  WHERE notes LIKE 'Cadastrado via Phase 6%'
  GROUP BY award_code, level ORDER BY award_code, level`);

out.top_cidades_novas = await q(`
  SELECT city, country, COUNT(*)::int AS n FROM public.db_restaurants
  WHERE enrichment_log::text LIKE '%fase6-phase-c%' AND published=true
  GROUP BY city, country ORDER BY n DESC LIMIT 10`);

out.amostra_3stars_inseridos = await q(`
  SELECT r.name, r.city, r.country, r.published, r.operational_status
  FROM public.db_restaurants r
  JOIN public.restaurant_awards a ON a.restaurant_id = r.restaurant_id
  WHERE a.notes LIKE 'Cadastrado via Phase 6%' AND a.level = 3
  ORDER BY r.name LIMIT 15`);

console.log(JSON.stringify(out, null, 2));
await pool.end();
