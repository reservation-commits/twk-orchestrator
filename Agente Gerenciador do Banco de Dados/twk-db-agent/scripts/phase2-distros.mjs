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
out.image_distribution = await q(`
  SELECT
    CASE
      WHEN images_json IS NULL THEN 'null'
      WHEN jsonb_typeof(images_json) <> 'array' THEN 'not_array'
      WHEN jsonb_array_length(images_json) = 0 THEN '0'
      WHEN jsonb_array_length(images_json) BETWEEN 1 AND 2 THEN '1-2'
      WHEN jsonb_array_length(images_json) BETWEEN 3 AND 5 THEN '3-5'
      WHEN jsonb_array_length(images_json) BETWEEN 6 AND 10 THEN '6-10'
      ELSE '11+'
    END AS bucket,
    COUNT(*)::int AS n,
    SUM(CASE WHEN published THEN 1 ELSE 0 END)::int AS n_published
  FROM public.db_restaurants
  GROUP BY bucket ORDER BY 1`);

out.has_logo_distribution = await q(`
  SELECT
    (logo_url IS NOT NULL AND length(btrim(logo_url))>0) AS has_logo,
    COUNT(*)::int AS n,
    SUM(CASE WHEN published THEN 1 ELSE 0 END)::int AS n_published
  FROM public.db_restaurants
  GROUP BY 1`);

out.about_text_filled = await q(`
  SELECT
    SUM(CASE WHEN about_text IS NOT NULL AND length(btrim(about_text))>0 THEN 1 ELSE 0 END)::int AS with_text,
    SUM(CASE WHEN about_pt IS NOT NULL AND length(btrim(about_pt))>0 THEN 1 ELSE 0 END)::int AS with_pt,
    SUM(CASE WHEN about_en IS NOT NULL AND length(btrim(about_en))>0 THEN 1 ELSE 0 END)::int AS with_en,
    SUM(CASE WHEN about_fr IS NOT NULL AND length(btrim(about_fr))>0 THEN 1 ELSE 0 END)::int AS with_fr,
    COUNT(*)::int AS total
  FROM public.db_restaurants WHERE published=true`);

out.score_published_above_60 = await q(`SELECT COUNT(*)::int AS n FROM public.db_restaurants WHERE published=true`);

console.log(JSON.stringify(out, null, 2));
await pool.end();
