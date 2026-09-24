import fs from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';
const envPath = path.resolve(process.cwd(), '.env.local');
for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
}
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const s = (await pool.query(`
  SELECT
    COUNT(*) FILTER (WHERE published=true) AS publicados,
    COUNT(*) FILTER (WHERE published=true AND country='France') AS fr,
    COUNT(*) FILTER (WHERE published=true AND country_code='FR') AS fr_iso
  FROM public.db_restaurants`)).rows[0];
console.log(`Publicados agora: ${s.publicados}`);
console.log(`Publicados na França (country=France): ${s.fr}`);
console.log(`Publicados na França (country_code=FR): ${s.fr_iso}`);

console.log('\n=== Top 20 cidades publicadas ===');
const cities = (await pool.query(`
  SELECT city, country, COUNT(*)::int AS n FROM public.db_restaurants
  WHERE published=true GROUP BY city, country ORDER BY n DESC LIMIT 20`)).rows;
cities.forEach(c => console.log(`  ${c.n.toString().padStart(4)} | ${c.city || 'NULL'}, ${c.country}`));

console.log('\n=== Top 15 países publicados ===');
const countries = (await pool.query(`
  SELECT country, COUNT(*)::int AS n FROM public.db_restaurants
  WHERE published=true GROUP BY country ORDER BY n DESC LIMIT 15`)).rows;
countries.forEach(c => console.log(`  ${c.n.toString().padStart(4)} | ${c.country}`));

await pool.end();
