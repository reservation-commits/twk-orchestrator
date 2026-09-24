// LOTE 09 APPLY — RECOMENDADO:
//   - Apply 5 HIGH clean phones
//   - Apply 3 HIGH phones AFTER sanitizing "+CC0" -> "+CC" (FR/ES/IT/UK/DE pattern)
//   - SKIP 2 suspects: CASA (wrong site), BOUILLABAISSE (incomplete number)
//   - SKIP 2 MEDIUM (ANDIA, BOUILLABAISSE — flagged for human review)
//   - REVERT 2 wrong sites: CASA (12104), Lutetia (294134) — site_url back to NULL
// Free: uses only data already in CSV, no API calls.
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

// "+CC0..." correction — strip the redundant national-prefix 0 right after these country codes
const STRIP_ZERO_AFTER_CC = new Set(['+33','+34','+39','+44','+49','+32','+31','+41','+43','+30','+36']);
function maybeStripExtraZero(phone) {
  for (const cc of STRIP_ZERO_AFTER_CC) {
    if (phone.startsWith(cc + '0')) return cc + phone.slice(cc.length + 1);
  }
  return phone;
}

// IDs to skip entirely (per LOT09_RECOMENDADO decision)
const SKIP_IDS = new Set(['12104', '10514', '251656']);   // CASA (wrong site), BOUILLABAISSE (incomplete), ANDIA (mismatch)

// IDs whose site is wrong — revert
const REVERT_SITES = ['12104', '294134'];   // CASA -> Colombian restaurant; Lutetia -> paris.fr

// Read proposals CSV
function parseCsv(text) {
  const lines = text.split('\n').filter(Boolean);
  const head = lines[0].split(',');
  return lines.slice(1).map(line => {
    const out = []; let f='', q=false;
    for (let i=0; i<line.length; i++) {
      const c = line[i];
      if (q) { if (c==='"' && line[i+1]==='"') { f+='"'; i++; } else if (c==='"') q=false; else f+=c; }
      else if (c==='"') q=true; else if (c===',') { out.push(f); f=''; } else f+=c;
    } out.push(f);
    const o = {};
    head.forEach((h,i) => o[h]=out[i]);
    return o;
  });
}

const csv = fs.readFileSync('audit-output/onda1-lote09-phones-proposals.csv','utf8');
const all = parseCsv(csv);
console.log(`Carregadas ${all.length} propostas do CSV`);

// =============================
// PART A — Apply phones
// =============================
const toApply = [];
for (const p of all) {
  if (SKIP_IDS.has(p.restaurant_id)) continue;
  if (p.confidence !== 'HIGH') continue;
  const original = p.proposed_phone;
  const sanitized = maybeStripExtraZero(original);
  toApply.push({ ...p, original_phone: original, final_phone: sanitized, sanitized: sanitized !== original });
}

console.log('\nTelefones a aplicar:');
toApply.forEach(p => {
  console.log(`  [${p.restaurant_id}] ${p.name.padEnd(20)} | ${p.original_phone}` + (p.sanitized ? ` → ${p.final_phone} (0 extra removido)` : ''));
});

let okN = 0, errN = 0;
for (const p of toApply) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const entry = {
      field: 'telephone_of_the_establishment',
      old_value: null,
      new_value: p.final_phone,
      source: `scrape:${p.site_url}`,
      verified_at: now,
      confidence: 'HIGH',
      agent: AGENT,
      batch: 'onda1-lote09',
      method: p.method,
      raw_scraped: p.sanitized ? p.original_phone : undefined,
    };
    await client.query(`
      UPDATE public.db_restaurants
         SET telephone_of_the_establishment = COALESCE(telephone_of_the_establishment, $2),
             last_verified_at = $3::timestamptz,
             verification_source = COALESCE(verification_source, $4),
             confidence_level = COALESCE(confidence_level, 'HIGH'),
             enrichment_log = enrichment_log || $5::jsonb
       WHERE restaurant_id = $1`,
      [p.restaurant_id, p.final_phone, now, `scrape:${p.site_url}`, JSON.stringify([entry])]);
    await client.query(`
      INSERT INTO public.restaurant_field_verifications
        (restaurant_id, field_name, value_hash, source, source_kind, verified_at, confidence_level, agent, notes)
      VALUES ($1, 'telephone_of_the_establishment', md5($2), $3, 'official_site', $4::timestamptz, 'HIGH', $5, $6)`,
      [p.restaurant_id, p.final_phone, `scrape:${p.site_url}`, now, AGENT,
       p.sanitized ? 'onda1-lote09 + zero-strip' : 'onda1-lote09']);
    await client.query('COMMIT');
    okN++;
    console.log(`  ✓ ${p.restaurant_id} ${p.name}`);
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch {}
    errN++;
    console.log(`  ✗ ${p.restaurant_id} ${p.name}: ${e.message}`);
  } finally { client.release(); }
}
console.log(`\nTelefones aplicados: ${okN}/${toApply.length} | erros: ${errN}`);

// =============================
// PART B — Revert 2 wrong sites
// =============================
console.log('\nRevertendo 2 sites errados (CASA, Lutetia)...');
let revOk = 0, revErr = 0;
for (const rid of REVERT_SITES) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cur = await client.query(
      `SELECT restaurant_id, name, site_url FROM public.db_restaurants WHERE restaurant_id=$1`, [rid]);
    if (!cur.rows.length) { revErr++; continue; }
    const old = cur.rows[0];
    const entry = {
      field: 'site_url',
      old_value: old.site_url,
      new_value: null,
      reason: rid === '12104'
        ? 'Site identificado como restaurante diferente (Colômbia, restaurante-casa.com). Lote 03 trouxe URL errada do Google Places.'
        : 'Site é paris.fr (prefeitura de Paris), não o restaurante Lutetia. Lote 03 trouxe URL errada.',
      source: 'human-approved-revert',
      verified_at: now,
      confidence: 'HIGH',
      agent: AGENT,
      batch: 'onda1-lote09-revert',
    };
    await client.query(`
      UPDATE public.db_restaurants
         SET site_url = NULL,
             enrichment_log = enrichment_log || $2::jsonb
       WHERE restaurant_id = $1`,
      [rid, JSON.stringify([entry])]);
    await client.query(`
      INSERT INTO public.restaurant_field_verifications
        (restaurant_id, field_name, value_hash, source, source_kind, verified_at, confidence_level, agent, notes)
      VALUES ($1, 'site_url', md5('NULL'), 'human-approved-revert', 'other', $2::timestamptz, 'HIGH', $3, 'onda1-lote09 — revert wrong site')`,
      [rid, now, AGENT]);
    await client.query('COMMIT');
    revOk++;
    console.log(`  ✓ ${rid} ${old.name} (era: ${old.site_url})`);
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch {}
    revErr++;
    console.log(`  ✗ ${rid}: ${e.message}`);
  } finally { client.release(); }
}
console.log(`\nSites revertidos: ${revOk}/${REVERT_SITES.length}`);

fs.writeFileSync('audit-output/onda1-lote09-apply-results.json', JSON.stringify({
  generated_at: now,
  phones: { applied: okN, errors: errN, total: toApply.length },
  sites_reverted: { ok: revOk, errors: revErr },
  skipped: [...SKIP_IDS],
}, null, 2));
await pool.end();
process.exitCode = (errN + revErr) > 0 ? 1 : 0;
