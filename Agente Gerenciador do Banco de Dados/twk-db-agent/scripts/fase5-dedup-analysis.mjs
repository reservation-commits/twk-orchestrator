// FASE 5 — Read-only analysis of duplicate place_id groups.
// For each group: compare records, compute completeness, pick "keep" candidate.
// Output a structured proposal that the user can approve.
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

// 1. Identify duplicate groups
const groups = await q(`
  SELECT place_id, array_agg(restaurant_id) AS ids, COUNT(*)::int AS n
  FROM public.db_restaurants
  WHERE place_id IS NOT NULL AND length(btrim(place_id))>0
  GROUP BY place_id HAVING COUNT(*)>1
  ORDER BY place_id`);
console.log(`Grupos duplicados: ${groups.length}`);

// 2. For each group, load full rows and analyze
function notEmpty(v) {
  if (v === null || v === undefined) return false;
  if (typeof v === 'string') return v.trim().length > 0;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'object') return Object.keys(v).length > 0;
  return true;
}

// Fields that count toward completeness (weighted)
const FIELDS = {
  // Core identity
  name: 5, slug: 3, address_of_establishment: 4,
  city: 4, country: 4, country_code: 3, place_id: 4,
  latitude: 5, longitude: 5, timezone: 4,
  // Reservation
  telephone_of_the_establishment: 8,
  email_for_reservations: 8,
  site_url: 6,
  booking_url: 6,
  business_hours_json: 10,
  // Classification
  price_range_id: 4, restaurant_category: 3,
  establishment_type: 3, michelin_id: 3,
  // Premium
  chef_name: 2, reservation_policy: 2,
  about_text: 3, about_pt: 2, about_en: 2,
  // Media
  logo_url: 4, images_json: 5,
  // Comercial
  partner: 1, negotiation_status: 1, partnership_start_date: 1,
  // Operational
  operational_status: 1, published: 2,
  // Governance
  last_verified_at: 3, confidence_level: 2,
};

function score(row) {
  let s = 0, total = 0;
  const present = [], missing = [];
  for (const [field, weight] of Object.entries(FIELDS)) {
    total += weight;
    if (notEmpty(row[field])) { s += weight; present.push(field); }
    else missing.push(field);
  }
  return { score: s, total, pct: +(100*s/total).toFixed(1), present, missing };
}

const proposals = [];

for (const g of groups) {
  const rows = await q(`
    SELECT * FROM public.db_restaurants WHERE restaurant_id = ANY($1::varchar[])
    ORDER BY restaurant_id`, [g.ids]);

  const ranked = rows.map(r => ({ row: r, sc: score(r) }))
    // Higher score first; tiebreak: published > unpublished, then most recent created_date
    .sort((a, b) => {
      if (b.sc.score !== a.sc.score) return b.sc.score - a.sc.score;
      if ((b.row.published ? 1 : 0) !== (a.row.published ? 1 : 0)) return (b.row.published ? 1 : 0) - (a.row.published ? 1 : 0);
      const at = a.row.created_date ? new Date(a.row.created_date).getTime() : 0;
      const bt = b.row.created_date ? new Date(b.row.created_date).getTime() : 0;
      return bt - at;
    });

  const keep = ranked[0];
  const losers = ranked.slice(1);

  // Compute which fields the losers have that keep doesn't (merge candidates)
  const fieldsToCopy = [];
  for (const field of Object.keys(FIELDS)) {
    if (notEmpty(keep.row[field])) continue;
    for (const l of losers) {
      if (notEmpty(l.row[field])) {
        fieldsToCopy.push({ field, from_loser_id: l.row.restaurant_id, value: l.row[field] });
        break;
      }
    }
  }

  // Also check for divergent values that aren't merge candidates but signal conflict
  const conflicts = [];
  for (const field of Object.keys(FIELDS)) {
    if (!notEmpty(keep.row[field])) continue;
    for (const l of losers) {
      if (notEmpty(l.row[field])) {
        const kv = JSON.stringify(keep.row[field]);
        const lv = JSON.stringify(l.row[field]);
        if (kv !== lv && ['name','address_of_establishment','city','country'].includes(field)) {
          conflicts.push({ field, keep_value: keep.row[field], loser_id: l.row.restaurant_id, loser_value: l.row[field] });
        }
      }
    }
  }

  proposals.push({
    place_id: g.place_id,
    n: g.n,
    keep: { id: keep.row.restaurant_id, name: keep.row.name, city: keep.row.city,
            score: keep.sc.score, pct: keep.sc.pct,
            published: keep.row.published, op_status: keep.row.operational_status },
    losers: losers.map(l => ({ id: l.row.restaurant_id, name: l.row.name, city: l.row.city,
              score: l.sc.score, pct: l.sc.pct,
              published: l.row.published, op_status: l.row.operational_status })),
    fields_to_copy: fieldsToCopy.map(f => ({ field: f.field, from: f.from_loser_id, value: f.value })),
    name_conflicts: conflicts,
  });
}

fs.writeFileSync('audit-output/fase5-dedup-analysis.json', JSON.stringify(proposals, null, 2));

console.log('\n========== PROPOSTA DEDUP ==========');
proposals.forEach((p, i) => {
  console.log(`\n--- Grupo ${i+1}/${proposals.length} — place_id ${p.place_id} ---`);
  console.log(`  ✅ MANTER: [${p.keep.id}] "${p.keep.name}" (${p.keep.city}) | score=${p.keep.score} (${p.keep.pct}%) | published=${p.keep.published} | op=${p.keep.op_status}`);
  p.losers.forEach(l => {
    console.log(`  🗑️  REMOVER: [${l.id}] "${l.name}" (${l.city}) | score=${l.score} (${l.pct}%) | published=${l.published} | op=${l.op_status}`);
  });
  if (p.fields_to_copy.length) {
    console.log(`  📋 Copiar para o KEEP antes de remover:`);
    p.fields_to_copy.forEach(f => {
      let preview = JSON.stringify(f.value);
      if (preview.length > 70) preview = preview.slice(0, 70) + '...';
      console.log(`     • ${f.field.padEnd(30)} ← do [${f.from}] = ${preview}`);
    });
  }
  if (p.name_conflicts.length) {
    console.log(`  ⚠️  CONFLITOS de nome/endereço (não vamos copiar):`);
    p.name_conflicts.forEach(c => {
      console.log(`     • ${c.field}: keep="${c.keep_value}" vs [${c.loser_id}]="${c.loser_value}"`);
    });
  }
});

await pool.end();
