// Cross-check the candidates list against the current DB.
// Detects matches by normalized name + city.
import fs from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';
const envPath = path.resolve(process.cwd(), '.env.local');
for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
}
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

function normalize(s) {
  if (!s) return '';
  return s.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')   // strip accents
    .replace(/[''`"’]/g, '')
    .replace(/[—–-]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[^a-z0-9 ]/g, '')
    .trim();
}

function nameRoot(s) {
  // Drop common qualifiers to make matching more permissive
  const n = normalize(s)
    .replace(/^(restaurant|le|la|les|el|los|the|il|de|du|der|das|die)\s+/, '')
    .replace(/\s+(restaurant|hotel|le|la|les|by|au|aux|by|chez)\s+.*$/, '')
    .replace(/\s+(at|in)\s+.*$/, '');
  return n;
}

const candidates = JSON.parse(fs.readFileSync('audit-output/fase6-candidates-batch1.json','utf8')).candidates;
console.log(`Candidatos a verificar: ${candidates.length}`);

const all = (await pool.query(`SELECT restaurant_id, name, city, country, country_code, published FROM public.db_restaurants`)).rows;
console.log(`Restaurantes no banco: ${all.length}`);

// Build name+city index
const byCity = new Map();
for (const r of all) {
  const cityKey = normalize(r.city);
  if (!byCity.has(cityKey)) byCity.set(cityKey, []);
  byCity.get(cityKey).push({ ...r, _norm: normalize(r.name), _root: nameRoot(r.name) });
}

const absent = [], present = [];
for (const c of candidates) {
  const cityKey = normalize(c.city);
  const candNorm = normalize(c.name);
  const candRoot = nameRoot(c.name);
  let match = null;
  const inCity = byCity.get(cityKey) || [];
  for (const r of inCity) {
    if (r._norm === candNorm || r._root === candRoot) { match = r; break; }
    // Loose: candidate-root contains restaurant-root or vice-versa, with min length 5
    if (candRoot.length >= 5 && r._root.length >= 5) {
      if (candRoot.includes(r._root) || r._root.includes(candRoot)) { match = r; break; }
    }
  }
  if (match) present.push({ ...c, match_id: match.restaurant_id, match_name: match.name, match_published: match.published });
  else absent.push(c);
}

console.log(`\n✅ Já presentes no banco: ${present.length}`);
console.log(`🆕 Ausentes (candidatos a adicionar): ${absent.length}`);

// Group absent by country
const byCountry = {};
for (const c of absent) {
  if (!byCountry[c.country]) byCountry[c.country] = [];
  byCountry[c.country].push(c);
}

console.log('\n=== AUSENTES por país ===');
for (const [country, items] of Object.entries(byCountry).sort((a,b) => b[1].length - a[1].length)) {
  console.log(`\n🌍 ${country} (${items.length})`);
  for (const c of items.slice(0, 25)) console.log(`  • ${c.name.padEnd(45)} (${c.city}) | ${c.tier}`);
  if (items.length > 25) console.log(`  ... e mais ${items.length - 25}`);
}

console.log('\n=== JÁ PRESENTES (amostra) ===');
present.slice(0, 15).forEach(p => console.log(`  ↺ ${p.name.padEnd(35)} (${p.city}) | match_id=${p.match_id} "${p.match_name}" published=${p.match_published}`));

fs.writeFileSync('audit-output/fase6-batch1-results.json', JSON.stringify({
  generated_at: new Date().toISOString(),
  total_candidates: candidates.length,
  present: present.length,
  absent: absent.length,
  absent_list: absent,
  present_list: present,
}, null, 2));

await pool.end();
