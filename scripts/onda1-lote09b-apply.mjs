// Apply the cleaned HIGH-confidence emails to db_restaurants.
// Reads onda1-lote09b-emails-cleaned.csv.
// Each row in own transaction, with governance + audit trail.
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

function parseCsv(text) {
  const lines = text.split('\n').filter(Boolean);
  const head = lines[0].split(',');
  return lines.slice(1).map(line => {
    const out = []; let f = '', q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) { if (c === '"' && line[i+1] === '"') { f += '"'; i++; } else if (c === '"') q = false; else f += c; }
      else if (c === '"') q = true; else if (c === ',') { out.push(f); f = ''; } else f += c;
    } out.push(f);
    const o = {}; head.forEach((h, i) => o[h] = out[i]); return o;
  });
}

const all = parseCsv(fs.readFileSync('audit-output/onda1-lote09b-emails-cleaned.csv', 'utf8'));
const high = all.filter(r => r.confidence === 'HIGH');
console.log(`Total propostas: ${all.length}`);
console.log(`HIGH a aplicar:  ${high.length}`);

let okN = 0, errN = 0, skipN = 0;
const errs = [];

for (const p of high) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Re-check current email so we don't overwrite something added since scraping
    const cur = await client.query(
      `SELECT email_for_reservations FROM public.db_restaurants WHERE restaurant_id = $1 FOR UPDATE`,
      [p.restaurant_id]
    );
    if (!cur.rows.length) { skipN++; await client.query('ROLLBACK'); continue; }
    if (cur.rows[0].email_for_reservations) { skipN++; await client.query('ROLLBACK'); continue; }

    const sourceUrl = p.source_page && p.source_page !== 'home'
      ? p.source_page.replace(/^contact_page:/, '')
      : p.site_url;

    const entry = {
      field: 'email_for_reservations',
      old_value: null,
      new_value: p.proposed_email,
      source: `scrape:${sourceUrl}`,
      verified_at: now,
      confidence: 'HIGH',
      agent: AGENT,
      batch: 'onda1-lote09b',
      method: 'scrape + rerank (same base domain)',
    };
    await client.query(`
      UPDATE public.db_restaurants
         SET email_for_reservations = $2,
             last_verified_at = $3::timestamptz,
             verification_source = COALESCE(verification_source, $4),
             confidence_level = COALESCE(confidence_level, 'HIGH'),
             enrichment_log = enrichment_log || $5::jsonb
       WHERE restaurant_id = $1`,
      [p.restaurant_id, p.proposed_email, now, `scrape:${sourceUrl}`, JSON.stringify([entry])]
    );
    await client.query(`
      INSERT INTO public.restaurant_field_verifications
        (restaurant_id, field_name, value_hash, source, source_kind, verified_at, confidence_level, agent, notes)
      VALUES ($1, 'email_for_reservations', md5($2), $3, 'official_site', $4::timestamptz, 'HIGH', $5, 'onda1-lote09b')`,
      [p.restaurant_id, p.proposed_email, `scrape:${sourceUrl}`, now, AGENT]
    );
    await client.query('COMMIT');
    okN++;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch {}
    errN++;
    if (errs.length < 10) errs.push({ id: p.restaurant_id, email: p.proposed_email, err: e.message });
  } finally {
    client.release();
  }
}

console.log(`\nResultado: ok=${okN} | skip=${skipN} (já tinha email) | err=${errN}`);
if (errs.length) console.log('Erros (amostra):', errs);

fs.writeFileSync('audit-output/onda1-lote09b-apply-results.json', JSON.stringify({
  generated_at: now, total: high.length, ok: okN, skip: skipN, err: errN, errors: errs,
}, null, 2));
await pool.end();
process.exitCode = errN > 0 ? 1 : 0;
