// Apply the 1 chef already found in the earlier limited run.
import fs from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';
const envPath = path.resolve(process.cwd(), '.env.local');
for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
}
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const AGENT = 'twk-db-architect';
const now = new Date().toISOString();

const proposalsPath = 'audit-output/onda1-lote07-chef-proposals.csv';
if (!fs.existsSync(proposalsPath)) { console.log('No proposals file'); process.exit(0); }
const lines = fs.readFileSync(proposalsPath,'utf8').split('\n').filter(Boolean);
const head = lines[0].split(',');
const rows = lines.slice(1).map(line => {
  const out = []; let f='', q=false;
  for (let i=0;i<line.length;i++) { const c=line[i];
    if (q) { if (c==='"' && line[i+1]==='"') { f+='"'; i++; } else if (c==='"') q=false; else f+=c; }
    else if (c==='"') q=true; else if (c===',') { out.push(f); f=''; } else f+=c;
  } out.push(f);
  const o = {}; head.forEach((h,i)=>o[h]=out[i]); return o;
});

// Only apply MEDIUM ones (we don't have HIGH here) — but for this single MEDIUM ("Christophe Bachi" from L'ECRIN PLAGE),
// flag it as MEDIUM confidence (single-occurrence text pattern).
console.log(`Found ${rows.length} proposals to apply (all MEDIUM, single text-pattern matches)`);

let ok = 0, err = 0;
for (const p of rows) {
  if (!p.proposed_chef) continue;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const entry = {
      field: 'chef_name', old_value: null, new_value: p.proposed_chef,
      source: `scrape:${p.site_url}`, verified_at: now, confidence: p.confidence,
      agent: AGENT, batch: 'onda1-lote07-single', method: p.method,
      reason: 'Encontrado durante teste de scraping (lote 07 abortado por baixo ROI no universo amplo)',
    };
    await client.query(`
      UPDATE public.db_restaurants
         SET chef_name = COALESCE(chef_name, $2),
             enrichment_log = enrichment_log || $3::jsonb
       WHERE restaurant_id = $1`,
      [p.restaurant_id, p.proposed_chef, JSON.stringify([entry])]);
    await client.query(`
      INSERT INTO public.restaurant_field_verifications
        (restaurant_id, field_name, value_hash, source, source_kind, verified_at, confidence_level, agent, notes)
      VALUES ($1, 'chef_name', md5($2), $3, 'official_site', $4::timestamptz, $5, $6, 'onda1-lote07 — single early hit')`,
      [p.restaurant_id, p.proposed_chef, `scrape:${p.site_url}`, now, p.confidence, AGENT]);
    await client.query('COMMIT');
    ok++;
    console.log(`✓ ${p.restaurant_id} ${p.name}: chef="${p.proposed_chef}" (${p.confidence})`);
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch {}
    err++;
    console.log(`✗ ${p.restaurant_id}: ${e.message}`);
  } finally { client.release(); }
}
console.log(`\nAplicados: ${ok}, erros: ${err}`);
await pool.end();
