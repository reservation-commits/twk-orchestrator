import fs from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';
const envPath = path.resolve(process.cwd(), '.env.local');
for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
}
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const r = await pool.query(`
  SELECT restaurant_id, name,
         jsonb_typeof(images_json) AS tp,
         jsonb_object_keys(images_json) AS k
  FROM public.db_restaurants
  WHERE images_json IS NOT NULL AND jsonb_typeof(images_json) = 'object'
  LIMIT 30`);
console.log('Keys observed:', [...new Set(r.rows.map(x => x.k))]);

const sample = await pool.query(`
  SELECT restaurant_id, images_json
  FROM public.db_restaurants
  WHERE images_json IS NOT NULL LIMIT 3`);
for (const row of sample.rows) {
  console.log('id', row.restaurant_id, ':', JSON.stringify(row.images_json).slice(0, 400));
}

const arr = await pool.query(`
  SELECT
    SUM(CASE WHEN images_json ? 'gallery' THEN 1 ELSE 0 END)::int AS with_gallery_key,
    SUM(CASE WHEN images_json ? 'hero' THEN 1 ELSE 0 END)::int AS with_hero_key,
    COUNT(*)::int AS total_with_json
  FROM public.db_restaurants WHERE images_json IS NOT NULL`);
console.log('Aggregate:', arr.rows[0]);

await pool.end();
