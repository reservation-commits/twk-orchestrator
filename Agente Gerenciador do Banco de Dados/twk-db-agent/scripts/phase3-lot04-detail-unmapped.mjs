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

for (const c of ['West Indies', 'Central America', 'Quebec']) {
  const rows = await q(`
    SELECT city, COUNT(*)::int AS n
    FROM public.db_restaurants WHERE country=$1
    GROUP BY city ORDER BY n DESC`, [c]);
  console.log(`=== ${c} (${rows.reduce((s,r)=>s+r.n,0)} registros) ===`);
  rows.forEach(r => console.log(' ', r.n.toString().padStart(3), '|', r.city));
  console.log();
}

await pool.end();
