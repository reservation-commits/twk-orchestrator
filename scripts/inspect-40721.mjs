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
  SELECT restaurant_id, name, city, country,
         email_for_reservations,
         length(email_for_reservations) AS email_len,
         telephone_of_the_establishment,
         site_url,
         place_id, latitude, longitude, localization
  FROM public.db_restaurants WHERE restaurant_id='40721'`);
console.log(JSON.stringify(r.rows[0], null, 2));

// Show all rows where the email check would fail
const all = await pool.query(`
  SELECT restaurant_id, name, email_for_reservations
  FROM public.db_restaurants
  WHERE email_for_reservations IS NOT NULL
    AND email_for_reservations <> ''
    AND email_for_reservations !~* '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$'
  LIMIT 30`);
console.log('Total invalid emails in DB:', all.rowCount);
all.rows.forEach(row => console.log(' ', row.restaurant_id, '|', row.name, '|', JSON.stringify(row.email_for_reservations)));

await pool.end();
