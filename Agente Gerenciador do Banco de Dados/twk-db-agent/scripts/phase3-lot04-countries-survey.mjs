// LOT04 SURVEY — read-only. Categorize every distinct country value:
//   - canonical (alias=canonical, just backfill country_code)
//   - rename (alias != canonical, update both)
//   - unmapped (no entry in country_name_aliases — needs human decision)
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

// 1. Universe: distinct country values + counts (published focus, but include all)
const dist = await q(`
  SELECT country,
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE published)::int AS published_n,
         COUNT(country_code) FILTER (WHERE country_code IS NOT NULL)::int AS already_has_code
  FROM public.db_restaurants
  GROUP BY country ORDER BY total DESC`);

// 2. Alias table
const aliases = await q(`SELECT alias, canonical, iso_alpha_2, notes FROM public.country_name_aliases ORDER BY alias`);
const aliasByKey = new Map(aliases.map(a => [a.alias, a]));

// 3. Categorize
const categorized = { canonical_match: [], rename: [], unmapped: [], null_country: [] };
for (const row of dist) {
  if (row.country === null || row.country === '') {
    categorized.null_country.push(row);
    continue;
  }
  const a = aliasByKey.get(row.country);
  if (!a) categorized.unmapped.push(row);
  else if (a.alias === a.canonical) categorized.canonical_match.push({ ...row, code: a.iso_alpha_2 });
  else categorized.rename.push({ ...row, canonical: a.canonical, code: a.iso_alpha_2, notes: a.notes });
}

console.log(`Total distinct country values: ${dist.length}`);
console.log(`  canonical_match (só backfill country_code): ${categorized.canonical_match.length} grupos`);
console.log(`  rename (mudar country + setar code):        ${categorized.rename.length} grupos`);
console.log(`  unmapped (decisão humana):                  ${categorized.unmapped.length} grupos`);
console.log(`  null/empty country:                         ${categorized.null_country.length} grupos`);

console.log('\n=== RENAME (alias -> canonical) ===');
categorized.rename.sort((a,b)=>b.total-a.total).forEach(r => {
  console.log(`  ${r.total.toString().padStart(4)} | ${(r.country+'').padEnd(20)} -> ${r.canonical.padEnd(22)} | ${r.code} | ${r.notes||''}`);
});

console.log('\n=== UNMAPPED (precisam decisão) ===');
categorized.unmapped.sort((a,b)=>b.total-a.total).forEach(r => {
  console.log(`  ${r.total.toString().padStart(4)} | ${r.country}`);
});

console.log('\n=== CANONICAL_MATCH (top 10 — só backfill country_code) ===');
categorized.canonical_match.sort((a,b)=>b.total-a.total).slice(0,10).forEach(r => {
  console.log(`  ${r.total.toString().padStart(4)} | ${(r.country+'').padEnd(20)} | ${r.code}`);
});

const total_to_update = categorized.canonical_match.reduce((s,r)=>s+r.total,0)
                      + categorized.rename.reduce((s,r)=>s+r.total,0);
console.log(`\nTotal de registros que serão atualizados: ${total_to_update}`);
console.log(`Total em UNMAPPED (não tocados): ${categorized.unmapped.reduce((s,r)=>s+r.total,0)}`);

fs.writeFileSync('audit-output/phase3-lot04-survey.json', JSON.stringify(categorized, null, 2));
await pool.end();
