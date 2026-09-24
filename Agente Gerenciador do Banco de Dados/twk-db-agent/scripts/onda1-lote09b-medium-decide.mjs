// Apply confirmable MEDIUM emails + unpublish unconfirmable ones.
// Lists below are the result of human review of the categorization.
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

// ---------------------------------------------------------------------
// APPLY — emails that can be confirmed as belonging to the restaurant
// ---------------------------------------------------------------------
const APPLY = new Set([
  // 🏨 Hotel/rede
  '11357','29910','57199',  // 21793 LA BARBACANE foi neutralizado no dedup, pulo
  // 🏢 Grupo/marca limpos
  '10468','107786','10965','13067','14586','14594','15998','16029',
  '17795','19078','19527','19535','19650','21528','21686','21766',
  '22060','22078','270775','42439','42987','88992','98657',
  // 📷 Social legítimos (hotel/cultural)
  '19354','21726',
  // 📨 Gmail/Hotmail/Yahoo — todos confirmados na contact page do próprio site
  '12638','19065','21742','21776','22378','70821','71770','75300','77084','88902','95426',
]);

// ---------------------------------------------------------------------
// UNPUBLISH — emails that CANNOT be confirmed (wrong restaurant, placeholder, personal, PR…)
// ---------------------------------------------------------------------
const UNPUBLISH_REASONS = {
  // 🏢 Suspeitos do grupo (e-mail aponta pro restaurante errado ou pessoa não-restaurante)
  '15916': 'Nobu Chicago: e-mail apontando para Atlantis Dubai (`atp-nobu@atlantisdubai.com`). Não confirmável.',
  '16061': 'Nobu Tokyo: e-mail apontando para Atlantis Dubai (`atp-nobu@atlantisdubai.com`). Não confirmável.',
  '21722': 'LE VENTRE DE L\'ARCHITECTE: e-mail pessoal de provedor antigo (`albange@club-internet.fr`). Não confirmável.',
  '70432': 'OLIVA Lagos: e-mail pessoal russo (`andreiburduh@mail.ru`) num restaurante português. Não confirmável.',
  '86583': 'BIRDS Moscow: padrão de e-mail suspeito (`7777-111hello@354group.com`). Não confirmável.',
  '86923': 'L\'ESQUISSE Annecy: e-mail hotmail pessoal (`magasetph@hotmail.fr`). Não confirmável.',
  '91235': 'L\'IMPE Nîmes: e-mail de agência de PR (`clara@pascalevenot.fr`), não do restaurante. Não confirmável.',
  '96526': 'SALT Indianapolis: site cadastrado é `.dk` (Dinamarca) e e-mail é dinamarquês. Cadastro provavelmente errado.',
  '292553': 'LES JARDINS DU PRESBOURG: e-mail de imprensa (`presse@beaumarly.com`), não de reserva. Não confirmável.',
  // 📷 Social com e-mail pessoal
  '14293': 'CICCIO Bonifacio: site é só Instagram + e-mail hotmail pessoal (`gerald.larrieu@hotmail.fr`). Não confirmável.',
  // 🎟️ Plataforma de reserva (não é canal direto)
  '15350': 'O YA Boston: único e-mail encontrado é da plataforma Tock (`tockinquiries@cushmanconcepts.com`), não da casa. Não confirmável.',
  // 🚮 Placeholder/lixo
  '16980': 'Hünkar Istanbul: e-mail placeholder (`contact@info.com`). Não confirmável.',
  '20785': 'GOGO FLAMINGO Toulouse: e-mail placeholder de template (`exemple@monsite.com`). Não confirmável.',
  '21605': 'L\'EVEIL DES SENS Strasbourg: e-mail de organização não-relacionada (`service@tpsonline.org.uk`). Não confirmável.',
  '29963': 'HAYES STREET GRILL San Francisco: e-mail placeholder (`name@url.com`). Não confirmável.',
  '42295': 'HANKOOK Frankfurt: e-mail de domínio não-relacionado (`contact_us@sustainability-times.com`). Não confirmável.',
  '47697': 'ARUNDEL TAVERN Gold Coast: e-mail placeholder (`info@mysite.com`). Não confirmável.',
};

// ---------------------------------------------------------------------
// Read scraped proposals for apply step
// ---------------------------------------------------------------------
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

const csv = fs.readFileSync('audit-output/onda1-lote09b-emails-cleaned.csv', 'utf8');
const all = parseCsv(csv);
const toApply = all.filter(r => APPLY.has(r.restaurant_id));
console.log(`A aplicar:    ${toApply.length} (de ${APPLY.size} esperados)`);
console.log(`A despublicar: ${Object.keys(UNPUBLISH_REASONS).length}`);

// ---------------------------------------------------------------------
// PART A — Apply emails
// ---------------------------------------------------------------------
let okApply = 0, errApply = 0, skipApply = 0;
console.log('\n=== APLICANDO E-MAILS ===');
for (const p of toApply) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cur = await client.query(
      `SELECT email_for_reservations, published FROM public.db_restaurants WHERE restaurant_id=$1 FOR UPDATE`,
      [p.restaurant_id]);
    if (!cur.rows.length) { skipApply++; await client.query('ROLLBACK'); continue; }
    if (cur.rows[0].email_for_reservations) { skipApply++; await client.query('ROLLBACK'); continue; }

    const sourceUrl = p.source_page && p.source_page !== 'home'
      ? p.source_page.replace(/^contact_page:/, '') : p.site_url;
    const entry = {
      field: 'email_for_reservations', old_value: null, new_value: p.proposed_email,
      source: `scrape:${sourceUrl}`, verified_at: now, confidence: 'MEDIUM',
      agent: AGENT, batch: 'onda1-lote09b-medium-decide',
      reason: 'Revisão humana: e-mail considerado confirmável (mesma marca/grupo, ou gmail da própria casa).',
    };
    await client.query(`
      UPDATE public.db_restaurants
         SET email_for_reservations = $2,
             last_verified_at = $3::timestamptz,
             verification_source = COALESCE(verification_source, $4),
             confidence_level = COALESCE(confidence_level, 'MEDIUM'),
             enrichment_log = enrichment_log || $5::jsonb
       WHERE restaurant_id = $1`,
      [p.restaurant_id, p.proposed_email, now, `scrape:${sourceUrl}`, JSON.stringify([entry])]);
    await client.query(`
      INSERT INTO public.restaurant_field_verifications
        (restaurant_id, field_name, value_hash, source, source_kind, verified_at, confidence_level, agent, notes)
      VALUES ($1, 'email_for_reservations', md5($2), $3, 'official_site', $4::timestamptz, 'MEDIUM', $5, 'onda1-lote09b-medium — humano aprovou')`,
      [p.restaurant_id, p.proposed_email, `scrape:${sourceUrl}`, now, AGENT]);
    await client.query('COMMIT');
    okApply++;
    console.log(`  ✓ [${p.restaurant_id}] ${p.name.padEnd(30)} → ${p.proposed_email}`);
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch {}
    errApply++;
    console.log(`  ✗ [${p.restaurant_id}] ${e.message}`);
  } finally { client.release(); }
}
console.log(`Apply: ok=${okApply} skip=${skipApply} err=${errApply}`);

// ---------------------------------------------------------------------
// PART B — Unpublish unconfirmable ones
// ---------------------------------------------------------------------
let okUnp = 0, errUnp = 0;
console.log('\n=== DESPUBLICANDO (e-mails impossíveis de confirmar) ===');
for (const [rid, reason] of Object.entries(UNPUBLISH_REASONS)) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cur = await client.query(
      `SELECT restaurant_id, name, city, published, operational_status, operational_status_reason
       FROM public.db_restaurants WHERE restaurant_id = $1 FOR UPDATE`, [rid]);
    if (!cur.rows.length) { console.log(`  ⏭ [${rid}] não encontrado`); await client.query('ROLLBACK'); continue; }
    const r = cur.rows[0];
    if (r.published === false) { console.log(`  ⏭ [${rid}] já está despublicado`); await client.query('ROLLBACK'); continue; }

    const fullReason = `Despublicado em ${dateStr} — ${reason}`;
    const logEntries = [
      { field: 'published', old_value: true, new_value: false,
        reason, source: 'human-approved-policy', verified_at: now,
        confidence: 'HIGH', agent: AGENT, batch: 'unpublish-unconfirmable-email' },
      { field: 'operational_status', old_value: r.operational_status, new_value: 'unknown',
        reason: 'Sem e-mail confirmável.', source: 'human-approved-policy', verified_at: now,
        confidence: 'HIGH', agent: AGENT, batch: 'unpublish-unconfirmable-email' },
      { field: 'operational_status_reason', old_value: r.operational_status_reason, new_value: fullReason,
        source: 'human-approved-policy', verified_at: now,
        confidence: 'HIGH', agent: AGENT, batch: 'unpublish-unconfirmable-email' },
    ];

    await client.query(`
      UPDATE public.db_restaurants
         SET published = false,
             operational_status = 'unknown',
             operational_status_reason = $2,
             last_verified_at = $3::timestamptz,
             verification_source = COALESCE(verification_source, 'unpublish-unconfirmable-email'),
             confidence_level = COALESCE(confidence_level, 'HIGH'),
             enrichment_log = enrichment_log || $4::jsonb
       WHERE restaurant_id = $1`,
      [rid, fullReason, now, JSON.stringify(logEntries)]);

    for (const f of ['published','operational_status','operational_status_reason']) {
      await client.query(`
        INSERT INTO public.restaurant_field_verifications
          (restaurant_id, field_name, value_hash, source, source_kind, verified_at, confidence_level, agent, notes)
        VALUES ($1, $2, md5($3), 'unpublish-unconfirmable-email', 'other', $4::timestamptz, 'HIGH', $5, 'sem email confirmavel')`,
        [rid, f, f === 'published' ? 'false' : (f === 'operational_status' ? 'unknown' : 'no_confirmable_email'),
         now, AGENT]);
    }

    await client.query('COMMIT');
    okUnp++;
    console.log(`  ✓ [${rid}] ${r.name} (${r.city}) — ${reason.slice(0, 60)}...`);
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch {}
    errUnp++;
    console.log(`  ✗ [${rid}]: ${e.message}`);
  } finally { client.release(); }
}
console.log(`Unpublish: ok=${okUnp} err=${errUnp}`);

fs.writeFileSync('audit-output/onda1-lote09b-medium-decide-results.json', JSON.stringify({
  generated_at: now,
  apply: { total: toApply.length, ok: okApply, skip: skipApply, err: errApply },
  unpublish: { total: Object.keys(UNPUBLISH_REASONS).length, ok: okUnp, err: errUnp },
}, null, 2));

await pool.end();
process.exitCode = (errApply + errUnp) > 0 ? 1 : 0;
