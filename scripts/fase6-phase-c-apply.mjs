// Phase C — APPLY step.
// Inserts 429 new restaurants into db_restaurants with full provenance.
// Awards (1/2/3 stars) go to restaurant_awards table.
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
const currentYear = new Date().getFullYear();

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

function slugify(s) {
  return (s || '').toLowerCase().normalize('NFD').replace(/\p{Mn}/gu,'')
    .replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0, 80);
}

function priceLevel(googleLevel) {
  const n = parseInt(googleLevel, 10);
  if (isNaN(n)) return null;
  if (n === 0) return 1;
  if (n >= 1 && n <= 4) return n;
  return null;
}

function awardMap(tier) {
  if (tier === '1_star') return { code: 'michelin_star', level: 1 };
  if (tier === '2_star') return { code: 'michelin_star', level: 2 };
  if (tier === '3_star') return { code: 'michelin_star', level: 3 };
  if (tier === 'Bib Gourmand') return { code: 'michelin_bib_gourmand', level: null };
  return null;
}

function normalizePhone(raw) {
  if (!raw) return null;
  let s = String(raw).replace(/[\s ​-‏‪-‮⁠﻿]/g,'').replace(/[^\d+]/g,'');
  if (!s.startsWith('+')) return null;
  return /^\+\d{6,29}$/.test(s) ? s : null;
}

function normalizeSite(raw) {
  if (!raw) return null;
  let s = String(raw).trim();
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s.replace(/^\/+/,'');
  return /^https?:\/\//i.test(s) ? s : null;
}

function statusFromGoogle(s) {
  if (s === 'CLOSED_PERMANENTLY') return 'closed_permanently';
  if (s === 'CLOSED_TEMPORARILY') return 'temporarily_closed';
  return 'active';
}

const proposals = parseCsv(fs.readFileSync('audit-output/fase6-phase-c-proposals.csv','utf8'));
console.log(`Propostas a aplicar: ${proposals.length}`);

// Get max restaurant_id (numeric) to know where to start
const maxR = (await pool.query(`
  SELECT COALESCE(MAX(CASE WHEN restaurant_id ~ '^[0-9]+$' THEN restaurant_id::bigint END), 0)::bigint AS max_id
  FROM public.db_restaurants`)).rows[0].max_id;
console.log(`Max restaurant_id atual: ${maxR}`);
let nextId = Number(maxR) + 1;

// Load country_code lookup
const countryAliases = await pool.query(`SELECT alias, canonical, iso_alpha_2 FROM public.country_name_aliases`);
const cMap = new Map(countryAliases.rows.map(r => [r.alias.toLowerCase(), { canonical: r.canonical, code: r.iso_alpha_2 }]));

let okN = 0, errN = 0, skippedDupN = 0;
const errs = [];
const insertedIds = [];

for (const p of proposals) {
  if (!p.place_id) { errN++; continue; }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Skip if place_id already exists in DB (sanity)
    const exists = await client.query(
      `SELECT restaurant_id FROM public.db_restaurants WHERE place_id = $1`, [p.place_id]);
    if (exists.rows.length) { skippedDupN++; await client.query('ROLLBACK'); continue; }

    const restaurantId = String(nextId);
    nextId++;

    const lat = parseFloat(p.latitude);
    const lng = parseFloat(p.longitude);
    if (isNaN(lat) || isNaN(lng)) { errN++; await client.query('ROLLBACK'); continue; }

    const phone = normalizePhone(p.phone);
    const site = normalizeSite(p.website);
    const gmapsUrl = normalizeSite(p.google_maps_url);
    const opStatus = statusFromGoogle(p.business_status);
    const isPublished = opStatus === 'active';
    const priceRangeId = priceLevel(p.price_level);
    const slug = slugify(`${p.candidate_name}-${p.city}`);
    const tzStr = p.timezone || null;

    // Country code lookup
    const ca = cMap.get((p.country || '').toLowerCase());
    const countryCanonical = ca?.canonical || p.country;
    const countryCode = ca?.code || null;

    const insertLog = [{
      field: 'meta',
      action: 'insert_from_fase6',
      tier: p.tier,
      place_id: p.place_id,
      source: `google_places:${p.place_id}`,
      verified_at: now,
      confidence: 'HIGH',
      agent: AGENT,
      batch: 'fase6-phase-c',
      reason: `Cadastro novo via Phase 6 (sourcing premium europeu). Curado da lista mestra.`,
    }];

    await client.query(`
      INSERT INTO public.db_restaurants (
        restaurant_id, name, slug, city, country, country_code,
        place_id, latitude, longitude,
        address_of_establishment,
        telephone_of_the_establishment, site_url, localization,
        price_range_id,
        timezone, operational_status, operational_status_reason,
        published, partner,
        created_date, last_verified_at, verification_source, confidence_level,
        enrichment_log
      ) VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9,
        $10,
        $11, $12, $13,
        $14,
        $15, $16, $17,
        $18, false,
        $19::timestamptz, $19::timestamptz, $20, 'HIGH',
        $21::jsonb
      )`,
      [
        restaurantId, p.candidate_name, slug, p.city, countryCanonical, countryCode,
        p.place_id, lat, lng,
        p.formatted_address || null,
        phone, site, gmapsUrl,
        priceRangeId,
        tzStr, opStatus,
          opStatus === 'closed_permanently' ? `Google Places reportou CLOSED_PERMANENTLY em ${now.slice(0,10)}` :
          opStatus === 'temporarily_closed' ? `Google Places reportou CLOSED_TEMPORARILY em ${now.slice(0,10)}` : null,
        isPublished,
        now, `google_places:${p.place_id}`,
        JSON.stringify(insertLog),
      ]);

    // Insert award if Michelin tier
    const award = awardMap(p.tier);
    if (award) {
      await client.query(`
        INSERT INTO public.restaurant_awards
          (restaurant_id, award_code, level, year, source_url, verified_at, confidence_level, notes)
        VALUES ($1, $2, $3, $4, $5, $6::timestamptz, 'HIGH', $7)`,
        [restaurantId, award.code, award.level, currentYear,
         `google_places:${p.place_id}`, now,
         `Cadastrado via Phase 6 sourcing. Tier original: ${p.tier}.`]);
    }

    // Audit trail
    const fields = ['name','place_id','latitude','longitude','timezone','operational_status','published'];
    if (phone) fields.push('telephone_of_the_establishment');
    if (site) fields.push('site_url');
    if (gmapsUrl) fields.push('localization');
    if (priceRangeId) fields.push('price_range_id');
    if (countryCode) fields.push('country_code');
    for (const f of fields) {
      await client.query(`
        INSERT INTO public.restaurant_field_verifications
          (restaurant_id, field_name, value_hash, source, source_kind, verified_at, confidence_level, agent, notes)
        VALUES ($1, $2, md5($3::text), $4, 'google_places', $5::timestamptz, 'HIGH', $6, 'fase6-phase-c — cadastro inicial')`,
        [restaurantId, f, 'new_record', `google_places:${p.place_id}`, now, AGENT]);
    }

    await client.query('COMMIT');
    okN++;
    insertedIds.push(restaurantId);
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch {}
    errN++;
    if (errs.length < 15) errs.push({ name: p.candidate_name, city: p.city, err: e.message });
  } finally { client.release(); }
  if ((okN + errN + skippedDupN) % 50 === 0) {
    console.log(`  [${okN+errN+skippedDupN}/${proposals.length}] inseridos=${okN} dup=${skippedDupN} err=${errN}`);
  }
}

console.log(`\nFinal: inseridos=${okN} | duplicatas(skip)=${skippedDupN} | err=${errN}`);
if (errs.length) console.log('Erros (amostra):', errs);

fs.writeFileSync('audit-output/fase6-phase-c-apply-results.json', JSON.stringify({
  generated_at: now,
  total: proposals.length,
  inserted: okN,
  duplicates_skipped: skippedDupN,
  errors: errN,
  err_sample: errs,
  inserted_ids: insertedIds,
}, null, 2));
await pool.end();
process.exitCode = errN > 0 ? 1 : 0;
