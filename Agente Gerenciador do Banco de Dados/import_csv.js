/*
 * import_csv.js — Import candidates_EU_534_final.csv into db_restaurants as published=true.
 * Safety: re-dedups against current DB by place_id; generates UUID restaurant_id + unique slug;
 * populates PostGIS coordinates; records provenance (verification_source/confidence_level/
 * last_verified_at/enrichment_log). Per-row insert with try/catch so one bad row never aborts
 * the rest; re-runnable (existing place_ids are skipped). Use --dry to preview without writing.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('./twk-db-agent/node_modules/pg');

const DRY = process.argv.includes('--dry');
const IN = path.join(__dirname, 'candidates_EU_534_final.csv');
const pool = new Pool({ connectionString: require('./db-config').CONN, ssl: { rejectUnauthorized: false } });

function parseCSV(text) {
  const rows = []; let row = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) { const c = text[i];
    if (inQ) { if (c === '"') { if (text[i+1] === '"') { field += '"'; i++; } else inQ = false; } else field += c; }
    else { if (c === '"') inQ = true; else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (c === '\r') {} else field += c; } }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.length > 1);
}
const slugify = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);

(async () => {
  const rows = parseCSV(fs.readFileSync(IN, 'utf8'));
  const header = rows[0]; const ix = {}; header.forEach((h, i) => ix[h] = i);
  const data = rows.slice(1);

  // fresh dedup state
  const ex = await pool.query(`SELECT place_id, slug FROM db_restaurants`);
  const existingPlace = new Set(ex.rows.filter(r => r.place_id).map(r => r.place_id));
  const slugs = new Set(ex.rows.filter(r => r.slug).map(r => r.slug));
  console.log(`Carregado: ${existingPlace.size} place_id e ${slugs.size} slugs existentes.`);
  console.log(`CSV: ${data.length} linhas | DRY=${DRY}\n`);

  function uniqueSlug(name, city) {
    let base = slugify(`${name}-${city}`) || slugify(name) || 'restaurant';
    let s = base, n = 2;
    while (slugs.has(s)) s = `${base}-${n++}`;
    slugs.add(s);
    return s;
  }

  const INSERT = `INSERT INTO db_restaurants
    (restaurant_id,name,establishment_type,restaurant_category,address_of_establishment,city,country,
     telephone_of_the_establishment,email_for_reservations,site_url,latitude,longitude,price_range_id,
     place_id,slug,published,operational_status,partner,created_date,last_verified_at,
     verification_source,confidence_level,enrichment_log,coordinates)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::float8,$12::float8,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23::jsonb,
            ST_SetSRID(ST_MakePoint($12::float8,$11::float8),4326))`;

  let inserted = 0, skippedDup = 0, failed = 0;
  for (const r of data) {
    const placeId = r[ix['place_id']] || null;
    if (placeId && existingPlace.has(placeId)) { skippedDup++; continue; }

    const name = r[ix['name']];
    const city = r[ix['city']];
    const lat = parseFloat(r[ix['latitude']]);
    const lng = parseFloat(r[ix['longitude']]);
    const priceId = parseInt(r[ix['price_range_id']], 10) || null;
    const slug = uniqueSlug(name, city);
    const id = crypto.randomUUID();
    const log = JSON.stringify([{
      field: 'import', method: 'google_places+site_scrape',
      email_source: r[ix['email_source']], email_confidence: r[ix['email_confidence']],
      google_rating: r[ix['google_rating']], google_reviews: r[ix['google_reviews']],
      batch: 'candidates_EU_534_final', at: new Date().toISOString(),
    }]);
    const params = [
      id, name, r[ix['establishment_type']], r[ix['restaurant_category']], r[ix['address_of_establishment']],
      city, r[ix['country']], r[ix['telephone_of_the_establishment']], r[ix['email_for_reservations']],
      r[ix['site_url']], lat, lng, priceId, placeId, slug, true, 'active', false,
      new Date(), new Date(), r[ix['email_source']] || null, (r[ix['email_confidence']] || null), log,
    ];

    if (DRY) { inserted++; if (inserted <= 3) console.log('DRY insert:', name, '|', city, '|', slug); continue; }
    try {
      await pool.query(INSERT, params);
      if (placeId) existingPlace.add(placeId);
      inserted++;
      if (inserted % 50 === 0) console.log(`  ...${inserted} inseridos`);
    } catch (e) {
      failed++;
      console.log(`  ✗ ${name} (${city}): ${e.message}`);
    }
  }

  console.log('\n──────── RESUMO IMPORT ────────');
  console.log(`Inseridos:        ${inserted}${DRY ? ' (dry-run)' : ''}`);
  console.log(`Pulados (place_id já existe): ${skippedDup}`);
  console.log(`Falhas:           ${failed}`);
  await pool.end();
})();
