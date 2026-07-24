// Unpublish the 22 publicados without any contact channel (no site, no email, no booking_url).
// Sets published=false, operational_status='unknown', reason + audit trail.
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
const dateStr = now.slice(0, 10);

// Re-query at execution time to make sure we hit exactly the same universe
const targets = (await pool.query(`
  SELECT restaurant_id, name, city, country, published, operational_status, operational_status_reason
  FROM public.db_restaurants
  WHERE published = true
    AND (site_url IS NULL OR site_url = '')
    AND (email_for_reservations IS NULL OR email_for_reservations = '')
    AND (booking_url IS NULL OR booking_url = '')
  ORDER BY restaurant_id`)).rows;
console.log(`Alvo: ${targets.length} publicados sem canal de contato`);

let ok = 0, err = 0;
const errs = [];

for (const r of targets) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const logEntries = [];
    logEntries.push({
      field: 'published',
      old_value: true,
      new_value: false,
      reason: 'Despublicado: sem nenhum canal de contato (site_url, email_for_reservations, booking_url todos vazios). Reservas impossíveis.',
      source: 'human-approved-policy',
      verified_at: now,
      confidence: 'HIGH',
      agent: AGENT,
      batch: 'unpublish-no-contact',
    });
    if (r.operational_status !== 'unknown') {
      logEntries.push({
        field: 'operational_status',
        old_value: r.operational_status,
        new_value: 'unknown',
        reason: 'Sem canal de contato verificável — estado operacional não pode ser confirmado.',
        source: 'human-approved-policy',
        verified_at: now,
        confidence: 'HIGH',
        agent: AGENT,
        batch: 'unpublish-no-contact',
      });
    }
    const newReason = `Despublicado em ${dateStr} — sem canal de contato (site/email/booking_url vazios). Reservas impossíveis.`;
    logEntries.push({
      field: 'operational_status_reason',
      old_value: r.operational_status_reason,
      new_value: newReason,
      source: 'human-approved-policy',
      verified_at: now,
      confidence: 'HIGH',
      agent: AGENT,
      batch: 'unpublish-no-contact',
    });

    await client.query(`
      UPDATE public.db_restaurants
         SET published = false,
             operational_status = 'unknown',
             operational_status_reason = $2,
             last_verified_at = $3::timestamptz,
             verification_source = COALESCE(verification_source, 'unpublish-no-contact'),
             confidence_level = COALESCE(confidence_level, 'HIGH'),
             enrichment_log = enrichment_log || $4::jsonb
       WHERE restaurant_id = $1`,
      [r.restaurant_id, newReason, now, JSON.stringify(logEntries)]);

    for (const f of ['published','operational_status','operational_status_reason']) {
      await client.query(`
        INSERT INTO public.restaurant_field_verifications
          (restaurant_id, field_name, value_hash, source, source_kind, verified_at, confidence_level, agent, notes)
        VALUES ($1, $2, md5($3), 'unpublish-no-contact', 'other', $4::timestamptz, 'HIGH', $5, 'unpublish-no-contact — sem canal de contato')`,
        [r.restaurant_id, f,
         f === 'published' ? 'false' : (f === 'operational_status' ? 'unknown' : 'no_contact'),
         now, AGENT]);
    }

    await client.query('COMMIT');
    ok++;
    console.log(`  ✓ [${r.restaurant_id}] ${r.name} (${r.city})`);
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch {}
    err++;
    errs.push({ id: r.restaurant_id, name: r.name, err: e.message });
    console.log(`  ✗ [${r.restaurant_id}] ${r.name}: ${e.message}`);
  } finally { client.release(); }
}

console.log(`\nResultado: ${ok}/${targets.length} despublicados | ${err} erros`);
fs.writeFileSync('audit-output/unpublish-no-contact-results.json', JSON.stringify({
  generated_at: now, total: targets.length, ok, err, errors: errs,
}, null, 2));
await pool.end();
process.exitCode = err > 0 ? 1 : 0;
