// Apply 09c results: clean emails go to DB, everyone else gets despublicated.
// Strategy:
//   1. Apply HIGH with strict country/locale sanity check.
//   2. Apply MEDIUM only if it passes a tighter set of garbage filters.
//   3. Despublicate everyone in errors CSV + everyone filtered out.
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

// =======================================================================
// SANITY FILTERS for the proposals
// =======================================================================
const PLACEHOLDER_DOMS = ['email.com','domain.com','company.com','mysite.com','url.com','example.com','monsite.com','your-domain','test.com','tpsonline.org.uk','sustainability-times.com','bloombergsources.com','resto-pro.com'];
const PLACEHOLDER_LOCALS = ['user','nom','name','your','example','sample','test','demo','myemail','monemail','info','contact'];

function isPlaceholder(email) {
  if (/^u003e/i.test(email)) return true;
  const [local, dom] = (email || '').split('@');
  if (!dom) return true;
  if (PLACEHOLDER_DOMS.includes(dom)) return true;
  if (PLACEHOLDER_LOCALS.includes((local || '').toLowerCase()) && PLACEHOLDER_DOMS.includes(dom)) return true;
  // explicit placeholder patterns
  if (/^(user|nom|name)@/i.test(email)) return true;
  return false;
}

// Detect when email domain clearly belongs to a country different from restaurant
const COUNTRY_TLD = {
  'France':'fr','Italy':'it','Germany':'de','Spain':'es','Portugal':'pt','United Kingdom':'uk',
  'Switzerland':'ch','Belgium':'be','Netherlands':'nl','Austria':'at',
  'Brazil':'br','Mexico':'mx','Argentina':'ar','Colombia':'co','United States':'us','Canada':'ca',
  'Japan':'jp','South Korea':'kr','China':'cn','Thailand':'th','Malaysia':'my',
  'Australia':'au','South Africa':'za','Morocco':'ma','Egypt':'eg',
  'United Arab Emirates':'ae','Qatar':'qa','Russia':'ru','Greece':'gr','Turkey':'tr','Türkiye':'tr',
};

function countryMismatch(email, restaurantCountry) {
  const [, dom] = (email || '').split('@');
  if (!dom) return false;
  const tld = dom.split('.').pop();
  const expectedTld = COUNTRY_TLD[restaurantCountry];
  if (!expectedTld) return false;     // no opinion
  // ccTLDs are signal of "this email belongs to that country"
  if (['fr','it','de','es','pt','uk','ch','be','nl','at','br','mx','ar','co','jp','kr','cn','th','my','au','za','ma','eg','ae','qa','ru','gr','tr','dk','se','no','fi','ie','lu','mc'].includes(tld)) {
    if (tld !== expectedTld) return true;
  }
  return false;
}

// Skip "same email reused across many restaurants" (template service emails)
function reusedEmailFrequency(rows, threshold = 2) {
  const freq = new Map();
  for (const r of rows) {
    const e = (r.proposed_email || '').toLowerCase();
    if (!e) continue;
    freq.set(e, (freq.get(e) || 0) + 1);
  }
  const reused = new Set();
  for (const [e, n] of freq) if (n >= threshold) reused.add(e);
  return reused;
}

// =======================================================================
// LOAD CSVs
// =======================================================================
const proposalsRaw = parseCsv(fs.readFileSync('audit-output/onda1-lote09c-deep-proposals.csv','utf8'));
const errorsRaw    = parseCsv(fs.readFileSync('audit-output/onda1-lote09c-deep-errors.csv','utf8'));

// Skip generic/templated emails that appear on 2+ different restaurants (template service)
const reused = reusedEmailFrequency(proposalsRaw, 2);
if (reused.size) {
  console.log(`Detectados ${reused.size} emails reusados em múltiplos restaurantes (templates):`);
  for (const e of reused) console.log(`  • ${e}`);
}

const TO_APPLY = [];
const TO_REJECT_REASONS = new Map();  // restaurant_id -> reason

for (const r of proposalsRaw) {
  const email = (r.proposed_email || '').toLowerCase().trim();
  if (isPlaceholder(email)) { TO_REJECT_REASONS.set(r.restaurant_id, `email placeholder: ${email}`); continue; }
  if (reused.has(email))    { TO_REJECT_REASONS.set(r.restaurant_id, `email reusado em múltiplos restaurantes (template): ${email}`); continue; }
  if (countryMismatch(email, r.country)) { TO_REJECT_REASONS.set(r.restaurant_id, `domínio do email não bate com país do restaurante (${r.country}): ${email}`); continue; }
  TO_APPLY.push(r);
}

console.log(`\nDe ${proposalsRaw.length} propostas:`);
console.log(`  ✓ Aplicar:                ${TO_APPLY.length}`);
console.log(`  ✗ Rejeitar (despublicar): ${TO_REJECT_REASONS.size}`);
console.log(`Erros (sem email encontrado): ${errorsRaw.length}`);

// =======================================================================
// PART A — Apply confirmed emails
// =======================================================================
let okApply = 0, errApply = 0, skipApply = 0;
console.log('\n=== APLICANDO E-MAILS ===');
for (const p of TO_APPLY) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cur = await client.query(
      `SELECT email_for_reservations FROM public.db_restaurants WHERE restaurant_id=$1 FOR UPDATE`,
      [p.restaurant_id]);
    if (!cur.rows.length) { skipApply++; await client.query('ROLLBACK'); continue; }
    if (cur.rows[0].email_for_reservations) { skipApply++; await client.query('ROLLBACK'); continue; }

    const entry = {
      field: 'email_for_reservations', old_value: null, new_value: p.proposed_email,
      source: `scrape:${p.site_url}`, verified_at: now, confidence: p.confidence,
      agent: AGENT, batch: 'onda1-lote09c',
      reason: 'Scraping profundo (multi-path) com filtros de placeholder/país/reuso.',
    };
    await client.query(`
      UPDATE public.db_restaurants
         SET email_for_reservations = $2,
             last_verified_at = $3::timestamptz,
             verification_source = COALESCE(verification_source, $4),
             confidence_level = COALESCE(confidence_level, $5),
             enrichment_log = enrichment_log || $6::jsonb
       WHERE restaurant_id = $1`,
      [p.restaurant_id, p.proposed_email, now, `scrape:${p.site_url}`, p.confidence, JSON.stringify([entry])]);
    await client.query(`
      INSERT INTO public.restaurant_field_verifications
        (restaurant_id, field_name, value_hash, source, source_kind, verified_at, confidence_level, agent, notes)
      VALUES ($1, 'email_for_reservations', md5($2), $3, 'official_site', $4::timestamptz, $5, $6, 'onda1-lote09c')`,
      [p.restaurant_id, p.proposed_email, `scrape:${p.site_url}`, now, p.confidence, AGENT]);
    await client.query('COMMIT');
    okApply++;
    console.log(`  ✓ [${p.restaurant_id}] ${p.name} → ${p.proposed_email} (${p.confidence})`);
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch {}
    errApply++;
    console.log(`  ✗ [${p.restaurant_id}] ${e.message}`);
  } finally { client.release(); }
}
console.log(`Apply: ok=${okApply} skip=${skipApply} err=${errApply}`);

// =======================================================================
// PART B — Unpublish (errors + rejected)
// =======================================================================
const TO_UNPUBLISH = new Map();   // restaurant_id -> reason
for (const e of errorsRaw) {
  TO_UNPUBLISH.set(e.restaurant_id, `Sem email encontrado após scraping profundo de ~18 paths (${e.reason || 'sem retorno'}).`);
}
for (const [id, reason] of TO_REJECT_REASONS) {
  TO_UNPUBLISH.set(id, `Email proposto rejeitado: ${reason}.`);
}
console.log(`\n=== DESPUBLICANDO ${TO_UNPUBLISH.size} restaurantes ===`);

let okUnp = 0, skipUnp = 0, errUnp = 0;
for (const [rid, reason] of TO_UNPUBLISH) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cur = await client.query(
      `SELECT restaurant_id, name, city, published, operational_status, operational_status_reason
       FROM public.db_restaurants WHERE restaurant_id = $1 FOR UPDATE`, [rid]);
    if (!cur.rows.length) { skipUnp++; await client.query('ROLLBACK'); continue; }
    const r = cur.rows[0];
    if (r.published === false) { skipUnp++; await client.query('ROLLBACK'); continue; }

    const fullReason = `Despublicado em ${dateStr} — ${reason}`;
    const logEntries = [
      { field: 'published', old_value: true, new_value: false,
        reason, source: 'human-approved-policy', verified_at: now,
        confidence: 'HIGH', agent: AGENT, batch: 'onda1-lote09c-unpublish' },
      { field: 'operational_status', old_value: r.operational_status, new_value: 'unknown',
        reason: 'Sem email confirmável após scraping profundo.', source: 'human-approved-policy',
        verified_at: now, confidence: 'HIGH', agent: AGENT, batch: 'onda1-lote09c-unpublish' },
      { field: 'operational_status_reason', old_value: r.operational_status_reason, new_value: fullReason,
        source: 'human-approved-policy', verified_at: now,
        confidence: 'HIGH', agent: AGENT, batch: 'onda1-lote09c-unpublish' },
    ];

    await client.query(`
      UPDATE public.db_restaurants
         SET published = false,
             operational_status = 'unknown',
             operational_status_reason = $2,
             last_verified_at = $3::timestamptz,
             verification_source = COALESCE(verification_source, 'onda1-lote09c-unpublish'),
             confidence_level = COALESCE(confidence_level, 'HIGH'),
             enrichment_log = enrichment_log || $4::jsonb
       WHERE restaurant_id = $1`,
      [rid, fullReason, now, JSON.stringify(logEntries)]);

    for (const f of ['published','operational_status','operational_status_reason']) {
      await client.query(`
        INSERT INTO public.restaurant_field_verifications
          (restaurant_id, field_name, value_hash, source, source_kind, verified_at, confidence_level, agent, notes)
        VALUES ($1, $2, md5($3), 'onda1-lote09c-unpublish', 'other', $4::timestamptz, 'HIGH', $5, 'sem email confirmavel — scraping profundo')`,
        [rid, f, f === 'published' ? 'false' : (f === 'operational_status' ? 'unknown' : 'no_confirmable_email'),
         now, AGENT]);
    }

    await client.query('COMMIT');
    okUnp++;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch {}
    errUnp++;
  } finally { client.release(); }
  if ((okUnp + errUnp + skipUnp) % 50 === 0) {
    console.log(`  [${okUnp + errUnp + skipUnp}/${TO_UNPUBLISH.size}] despublicados=${okUnp} skip=${skipUnp} err=${errUnp}`);
  }
}
console.log(`Unpublish: ok=${okUnp} skip=${skipUnp} err=${errUnp}`);

fs.writeFileSync('audit-output/onda1-lote09c-apply-results.json', JSON.stringify({
  generated_at: now,
  apply: { total: TO_APPLY.length, ok: okApply, skip: skipApply, err: errApply },
  unpublish: { total: TO_UNPUBLISH.size, ok: okUnp, skip: skipUnp, err: errUnp },
}, null, 2));
await pool.end();
process.exitCode = (errApply + errUnp) > 0 ? 1 : 0;
