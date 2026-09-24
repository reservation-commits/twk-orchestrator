// Consolidate all batches into a single master list of absent premium candidates.
import fs from 'node:fs';

const files = [
  'audit-output/fase6-batch1-results.json',
  'audit-output/fase6-results-batch2-results.json',
  'audit-output/fase6-results-batch3-results.json',
  'audit-output/fase6-results-batch4-results.json',
  'audit-output/fase6-results-batch5-results.json',
  'audit-output/fase6-results-batch6-results.json',
  'audit-output/fase6-results-batch7-results.json',
  'audit-output/fase6-results-batch8-results.json',
];

const allAbsent = new Map();
let totalRaw = 0;

for (const f of files) {
  if (!fs.existsSync(f)) { console.log(`(skip) ${f} não existe`); continue; }
  const data = JSON.parse(fs.readFileSync(f, 'utf8'));
  const items = data.absent || data.absent_list || [];
  totalRaw += items.length;
  for (const item of items) {
    const key = `${(item.name||'').toLowerCase().trim()}|${(item.city||'').toLowerCase().trim()}|${item.country||''}`;
    if (!allAbsent.has(key)) allAbsent.set(key, item);
  }
}

const unique = [...allAbsent.values()];
console.log(`Total entries (com possíveis duplicatas entre batches): ${totalRaw}`);
console.log(`Total UNIQUE (deduplicado por nome+cidade+país):       ${unique.length}`);

// Group by country
const byCountry = {};
for (const c of unique) {
  if (!byCountry[c.country]) byCountry[c.country] = [];
  byCountry[c.country].push(c);
}

// Group by tier
const byTier = {};
for (const c of unique) {
  const tier = c.tier || 'sem_tier';
  if (!byTier[tier]) byTier[tier] = 0;
  byTier[tier]++;
}

console.log('\n=== TOTAL POR PAÍS ===');
for (const [country, items] of Object.entries(byCountry).sort((a,b) => b[1].length - a[1].length)) {
  console.log(`  ${items.length.toString().padStart(4)} | ${country}`);
}

console.log('\n=== TOTAL POR TIER ===');
for (const [tier, n] of Object.entries(byTier).sort((a,b) => b[1] - a[1])) {
  console.log(`  ${n.toString().padStart(4)} | ${tier}`);
}

// Sub-summary: 3-star and palaces
const threeStars = unique.filter(c => (c.tier || '') === '3_star');
const palaces = unique.filter(c => (c.tier || '') === '$$$$');
console.log(`\n3★ Michelin ausentes:   ${threeStars.length}`);
console.log(`Palaces $$$$ ausentes:  ${palaces.length}`);

fs.writeFileSync('audit-output/fase6-master-absent.json', JSON.stringify({
  generated_at: new Date().toISOString(),
  total_unique_absent: unique.length,
  by_country: Object.fromEntries(Object.entries(byCountry).map(([k,v])=>[k, v.length])),
  by_tier: byTier,
  three_star_list: threeStars,
  palace_list: palaces,
  full_list: unique,
}, null, 2));
console.log(`\n✓ audit-output/fase6-master-absent.json salvo (${unique.length} candidatos)`);
