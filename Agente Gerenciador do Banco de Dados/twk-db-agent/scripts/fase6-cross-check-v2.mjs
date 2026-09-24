import fs from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';
const envPath = path.resolve(process.cwd(), '.env.local');
for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
}
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  statement_timeout: 15000,
  query_timeout: 15000,
  max: 2,
});

function normalize(s) {
  if (!s) return '';
  return s.toLowerCase()
    .normalize('NFD')
    .replace(/\p{Mn}/gu, '')
    .replace(/[''`"’]/gu, '')
    .replace(/[—–\-]/g, ' ')
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function nameRoot(s) {
  const n = normalize(s)
    .replace(/^(restaurant|le|la|les|el|los|the|il|de|du|der|das|die)\s+/, '')
    .replace(/\s+(restaurant|hotel|le|la|les|by|au|aux|chez)\s+.*$/, '')
    .replace(/\s+(at|in)\s+.*$/, '');
  return n;
}

const batchFile = process.argv[2] || 'audit-output/fase6-candidates-batch1.json';
const candidates = JSON.parse(fs.readFileSync(batchFile,'utf8')).candidates;
console.log(`Batch: ${batchFile}`);
console.log(`Candidatos: ${candidates.length}`);

const start = Date.now();
let result;
try {
  result = await pool.query(`SELECT restaurant_id, name, city, published FROM public.db_restaurants`);
  console.log(`SQL OK em ${Date.now()-start}ms — linhas: ${result.rows.length}`);
} catch (e) {
  console.error('SQL FAIL:', e.message);
  process.exit(1);
}

const byCity = new Map();
for (const r of result.rows) {
  const key = normalize(r.city);
  if (!byCity.has(key)) byCity.set(key, []);
  byCity.get(key).push({ ...r, _norm: normalize(r.name), _root: nameRoot(r.name) });
}

const absent = [], present = [];
for (const c of candidates) {
  const cityKey = normalize(c.city);
  const candNorm = normalize(c.name);
  const candRoot = nameRoot(c.name);
  const inCity = byCity.get(cityKey) || [];
  let match = null;
  for (const r of inCity) {
    if (r._norm === candNorm || r._root === candRoot) { match = r; break; }
    if (candRoot.length >= 5 && r._root.length >= 5) {
      if (candRoot.includes(r._root) || r._root.includes(candRoot)) { match = r; break; }
    }
  }
  if (match) present.push({ ...c, match_id: match.restaurant_id, match_name: match.name, match_published: match.published });
  else absent.push(c);
}

console.log(`Já presentes: ${present.length}`);
console.log(`AUSENTES (a adicionar): ${absent.length}`);

const byCountry = {};
for (const c of absent) {
  if (!byCountry[c.country]) byCountry[c.country] = [];
  byCountry[c.country].push(c);
}
console.log('\n=== AUSENTES por país ===');
for (const [country, items] of Object.entries(byCountry).sort((a,b) => b[1].length - a[1].length)) {
  console.log(`\n🌍 ${country} (${items.length})`);
  for (const c of items) console.log(`  • ${c.name.padEnd(45).slice(0,45)} (${c.city.padEnd(25).slice(0,25)}) | ${c.tier}`);
}

console.log('\n=== JÁ PRESENTES no banco ===');
present.forEach(p => console.log(`  ↺ ${p.name.padEnd(35).slice(0,35)} (${p.city.padEnd(15).slice(0,15)}) → match: "${p.match_name}" pub=${p.match_published}`));

const outFile = batchFile.replace('candidates','results').replace('.json','-results.json');
fs.writeFileSync(outFile, JSON.stringify({
  generated_at: new Date().toISOString(),
  total_candidates: candidates.length,
  present_count: present.length,
  absent_count: absent.length,
  absent: absent,
  present: present,
}, null, 2));
console.log(`\n✓ ${outFile} salvo`);
await pool.end();
