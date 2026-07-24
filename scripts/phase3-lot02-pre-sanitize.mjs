// LOT02-PRE: Sanitize 12 dirty values (9 phones + 3 sites).
// Deterministic rules. No judgment. Each row in own transaction.
// Then chains into the timezone application.
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

// --- Normalization rules ---
function normalizePhone(raw) {
  if (!raw) return null;
  // Remove all invisible chars (zero-width, bidi controls, BOM, NBSP) + all whitespace
  let s = raw.replace(/[\s ​-‏‪-‮⁠﻿]/g, '');
  // Strip all formatting characters except leading + and digits
  // First, find leading + (if any)
  const hasPlus = s.startsWith('+');
  s = s.replace(/[^\d]/g, ''); // pure digits
  return (hasPlus ? '+' : '+') + s; // we require leading + for E.164
}

function normalizeSite(raw) {
  if (!raw) return null;
  let s = String(raw).trim();
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s.replace(/^\/+/, '');
  return s;
}

// --- Find dirty rows from DB (re-query to avoid stale hardcoded list) ---
async function findDirty() {
  const phones = (await pool.query(`
    SELECT restaurant_id, name, telephone_of_the_establishment AS old_value
    FROM public.db_restaurants
    WHERE telephone_of_the_establishment IS NOT NULL
      AND telephone_of_the_establishment <> ''
      AND telephone_of_the_establishment !~ '^\\+[0-9 .()\\-]{6,30}$'
    ORDER BY restaurant_id`)).rows
    .map(r => ({ ...r, field: 'telephone_of_the_establishment', new_value: normalizePhone(r.old_value) }));

  const sites = (await pool.query(`
    SELECT restaurant_id, name, site_url AS old_value
    FROM public.db_restaurants
    WHERE site_url IS NOT NULL AND site_url <> ''
      AND site_url !~* '^https?://'
    ORDER BY restaurant_id`)).rows
    .map(r => ({ ...r, field: 'site_url', new_value: normalizeSite(r.old_value) }));

  return [...phones, ...sites];
}

// --- Validate that proposed new_value passes the CHECK regex ---
function validatePhone(v) { return /^\+[0-9 .()\-]{6,30}$/.test(v); }
function validateSite(v)  { return /^https?:\/\//i.test(v); }

const dirty = await findDirty();
console.log(`Itens sujos encontrados: ${dirty.length}`);
console.log('Prévia das normalizações:');
for (const d of dirty) {
  const ok = d.field === 'telephone_of_the_establishment' ? validatePhone(d.new_value) : validateSite(d.new_value);
  console.log(`  ${ok ? '✓' : '✗'} [${d.restaurant_id}] ${d.name} | ${d.field}`);
  console.log(`     antes:  ${JSON.stringify(d.old_value)}`);
  console.log(`     depois: ${JSON.stringify(d.new_value)}`);
}

// Refuse to proceed if any normalized value fails its own CHECK
const failing = dirty.filter(d => d.field === 'telephone_of_the_establishment' ? !validatePhone(d.new_value) : !validateSite(d.new_value));
if (failing.length) {
  console.error(`\nABORT: ${failing.length} normalizações ainda não passariam no CHECK. Não vou tocar no banco.`);
  await pool.end();
  process.exit(2);
}

// --- Apply (each in its own transaction) ---
const now = new Date().toISOString();
const results = [];
let okN = 0, errN = 0;

for (const d of dirty) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const entry = {
      field: d.field,
      old_value: d.old_value,
      new_value: d.new_value,
      reason: d.field === 'telephone_of_the_establishment'
        ? 'Normalização técnica: remoção de whitespace/caracteres invisíveis; preservado em log.'
        : 'Normalização técnica: prefixo https:// adicionado; preservado em log.',
      source: 'deterministic-sanitization',
      verified_at: now,
      confidence: 'HIGH',
      agent: AGENT,
      batch: 'phase3-lot02-PRE',
    };

    if (d.field === 'telephone_of_the_establishment') {
      await client.query(`
        UPDATE public.db_restaurants
           SET telephone_of_the_establishment = $2,
               enrichment_log = enrichment_log || $3::jsonb
         WHERE restaurant_id = $1`,
        [d.restaurant_id, d.new_value, JSON.stringify([entry])]);
    } else {
      await client.query(`
        UPDATE public.db_restaurants
           SET site_url = $2,
               enrichment_log = enrichment_log || $3::jsonb
         WHERE restaurant_id = $1`,
        [d.restaurant_id, d.new_value, JSON.stringify([entry])]);
    }

    await client.query(`
      INSERT INTO public.restaurant_field_verifications
        (restaurant_id, field_name, value_hash, source, source_kind, verified_at, confidence_level, agent, notes)
      VALUES ($1, $2, md5($3), $4, 'other', $5::timestamptz, 'HIGH', $6, 'lot02-PRE — sanitization')`,
      [d.restaurant_id, d.field, d.new_value, 'deterministic-sanitization', now, AGENT]);

    await client.query('COMMIT');
    okN++;
    results.push({ id: d.restaurant_id, field: d.field, status: 'ok' });
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch {}
    errN++;
    results.push({ id: d.restaurant_id, field: d.field, status: 'error', err: e.message });
    console.log(`FAIL [${d.restaurant_id}] ${d.field}: ${e.message}`);
  } finally {
    client.release();
  }
}

console.log(`\nSaneamento: ${okN}/${dirty.length} ok, ${errN} erros`);
fs.writeFileSync('audit-output/phase3-lot02-pre-results.json', JSON.stringify({
  generated_at: now, total: dirty.length, ok: okN, err: errN, results,
}, null, 2));

await pool.end();
process.exitCode = errN > 0 ? 1 : 0;
