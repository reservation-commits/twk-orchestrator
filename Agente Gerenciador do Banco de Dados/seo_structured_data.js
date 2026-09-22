/*
 * Batch-generate schema.org Restaurant JSON-LD into db_restaurants.structured_data_json for
 * every PUBLISHED restaurant. Deterministic (no LLM). Mirrors lib/seo.ts buildRestaurantSchema.
 * Default = DRY RUN (no writes, shows sample + coverage). Pass --apply to write.
 */
const { Pool } = require('./twk-db-agent/node_modules/pg');
const pool = new Pool({ connectionString: require('./db-config').CONN, ssl: { rejectUnauthorized: false } });
const { auditedUpdateRow } = require('./db-audited'); // escrita auditada (2026-09-21)
const q = (s, p) => pool.query(s, p).then((r) => r.rows);
const APPLY = process.argv.includes('--apply');

const SITE = 'https://theworldkeys.com';
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const day = (w) => `https://schema.org/${DAYS[((Math.trunc(w) % 7) + 7) % 7]}`;
const hhmm = (t) => String(t ?? '').slice(0, 5);
const pageUrl = (r) => r.url_page_twk || `${SITE}/hospitality/${r.slug || ''}/`;
const imgs = (ij) => { if (!ij || typeof ij !== 'object') return []; const a = [ij.slider?.[0]?.source_url ?? ij.cover?.source_url, ...(ij.slider || []).map((s) => s?.source_url)]; return [...new Set(a.filter(Boolean))].slice(0, 6); };
const cuisines = (c) => !c ? [] : [...new Set(c.split(/[|,]/).map((s) => s.trim()).filter((s) => s && !/^\*?michelin/i.test(s) && !/^\$+$/.test(s)))];

function build(r, hours, awards) {
  const s = { '@context': 'https://schema.org', '@type': 'Restaurant', '@id': pageUrl(r) + '#restaurant', name: r.name, url: pageUrl(r) };
  if (r.about_text) s.description = r.about_text;
  const im = imgs(r.images_json); if (im.length) s.image = im.length === 1 ? im[0] : im;
  if (r.telephone_of_the_establishment) s.telephone = r.telephone_of_the_establishment;
  const ad = { '@type': 'PostalAddress' };
  if (r.address_of_establishment) ad.streetAddress = r.address_of_establishment;
  if (r.city) ad.addressLocality = r.city;
  if (r.country_code) ad.addressCountry = r.country_code; else if (r.country) ad.addressCountry = r.country;
  s.address = ad;
  if (r.latitude != null && r.longitude != null) s.geo = { '@type': 'GeoCoordinates', latitude: +r.latitude, longitude: +r.longitude };
  const cu = cuisines(r.restaurant_category); if (cu.length) s.servesCuisine = cu;
  if (r.price_range_id != null) { const n = Math.min(4, Math.max(1, +r.price_range_id)); if (!Number.isNaN(n)) s.priceRange = '$'.repeat(n); }
  if (hours && hours.length) s.openingHoursSpecification = hours.map((h) => ({ '@type': 'OpeningHoursSpecification', dayOfWeek: day(+h.weekday), opens: hhmm(h.open_time), closes: hhmm(h.close_time) }));
  if (awards && awards.length) s.award = [...new Set(awards)];
  s.acceptsReservations = true;
  return s;
}

(async () => {
  console.log(`Modo: ${APPLY ? 'APPLY (grava)' : 'DRY RUN (sem escrita)'}\n`);

  const rows = await q(`SELECT restaurant_id, name, slug, url_page_twk, about_text, images_json,
      telephone_of_the_establishment, address_of_establishment, city, country, country_code,
      latitude, longitude, restaurant_category, price_range_id
    FROM db_restaurants WHERE published ORDER BY name`);
  console.log('Publicados:', rows.length);

  // opening_hours + awards for all in one pass each
  const hoursMap = {};
  for (const h of await q(`SELECT restaurant_id, weekday, open_time, close_time FROM opening_hours ORDER BY restaurant_id, weekday`)) {
    (hoursMap[h.restaurant_id] ||= []).push(h);
  }
  const awardsMap = {};
  try {
    for (const a of await q(`SELECT * FROM restaurant_awards`)) {
      let name = null; for (const k of ['name', 'title', 'award', 'award_name', 'distinction', 'label']) if (a[k]) { name = String(a[k]); break; }
      if (name) (awardsMap[a.restaurant_id] ||= []).push(name);
    }
  } catch { /* table optional */ }

  const built = rows.map((r) => ({ id: r.restaurant_id, schema: build(r, hoursMap[r.restaurant_id], awardsMap[r.restaurant_id]) }));
  const avgFields = Math.round(built.reduce((a, b) => a + Object.keys(b.schema).filter((k) => !k.startsWith('@')).length, 0) / built.length);
  console.log('Média de campos por schema:', avgFields, '(site emitia 3)');
  console.log('\nAmostra (primeiro):'); console.log(JSON.stringify(built[0].schema, null, 1).slice(0, 700));

  if (!APPLY) { console.log('\nDRY RUN — rode com --apply para gravar.'); await pool.end(); return; }

  // DDL é operação HUMANA (ADR-013): este script já fez ALTER TABLE por conta própria.
  // Agora só verifica que a coluna existe (migration 0003_structured_data_json.sql) e aborta se não.
  const col = await q(`SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='db_restaurants' AND column_name='structured_data_json'`);
  if (!col.length) { console.error('ABORTADO: coluna structured_data_json não existe — rode a migration 0003 (humana) antes.'); await pool.end(); process.exit(3); }

  // Escrita auditada por linha (old_data + agent_audit_log na mesma transação), em vez de uma
  // transação gigante sem trilha. Cada linha é atômica; um erro no meio não desfaz as anteriores
  // (idempotente: rodar de novo regrava o mesmo schema).
  let n = 0;
  for (const b of built) {
    await auditedUpdateRow(pool, {
      table: 'db_restaurants', pk: 'restaurant_id', id: b.id,
      set: 'structured_data_json = $1::jsonb', params: [JSON.stringify(b.schema)],
      agent: 'seo_structured_data', reason: 'JSON-LD schema.org Restaurant gerado deterministicamente',
    });
    if (++n % 500 === 0) console.log(`  ...${n}/${built.length}`);
  }

  const filled = (await q(`SELECT COUNT(*) c FROM db_restaurants WHERE published AND structured_data_json IS NOT NULL`))[0].c;
  console.log(`\nGravados: ${n} | publicados com structured_data_json: ${filled}`);
  await pool.end();
})().catch((e) => { console.error('ERRO:', e.message); pool.end(); process.exit(1); });
