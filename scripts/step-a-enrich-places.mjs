// Step A — Enrich the 915 newly-added publicados via Google Places Details:
//   opening_hours → business_hours_json
//   editorial_summary → about_text
//   address_components → country_code
// One UPDATE per restaurant with governance.
import fs from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';

const envPath = path.resolve(process.cwd(), '.env.local');
for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
}
const API_KEY = process.env.GOOGLE_PLACES_API_KEY;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const AGENT = 'twk-db-architect';
const now = new Date().toISOString();
const DELAY = 130;

process.on('unhandledRejection', e => console.error('[unhandled]', e?.message || e));
process.on('uncaughtException',  e => console.error('[uncaught]',  e?.message || e));

const PLACES = 'https://maps.googleapis.com/maps/api/place/details/json';

async function fetchDetails(placeId) {
  const url = `${PLACES}?place_id=${encodeURIComponent(placeId)}&fields=opening_hours,editorial_summary,address_components&key=${API_KEY}`;
  for (let i = 0; i < 4; i++) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = await r.json();
    if (d.status === 'OVER_QUERY_LIMIT') { await new Promise(s => setTimeout(s, 2000*(i+1))); continue; }
    return d;
  }
  throw new Error('OVER_QUERY_LIMIT');
}

const targets = (await pool.query(`
  SELECT restaurant_id, name, place_id, business_hours_json, about_text, country_code
  FROM public.db_restaurants
  WHERE published = true
    AND place_id IS NOT NULL AND length(btrim(place_id))>0
    AND (
      business_hours_json IS NULL OR business_hours_json::text IN ('null','{}')
      OR (about_text IS NULL OR about_text='')
      OR country_code IS NULL
    )
  ORDER BY restaurant_id`)).rows;
console.log(`Alvos: ${targets.length}`);

let ok = 0, err = 0, hoursAdded = 0, aboutAdded = 0, isoAdded = 0;
const t0 = Date.now();

for (let i = 0; i < targets.length; i++) {
  const r = targets[i];
  try {
    const data = await fetchDetails(r.place_id);
    if (data.status !== 'OK') {
      err++;
      await new Promise(s => setTimeout(s, DELAY));
      continue;
    }
    const result = data.result || {};

    // 1. opening_hours
    let newHours = null;
    if (result.opening_hours && (!r.business_hours_json || r.business_hours_json === null)) {
      const oh = result.opening_hours;
      newHours = {
        source: 'google_places',
        verified_at: now,
        open_now: oh.open_now ?? null,
        weekday_text: oh.weekday_text || [],
        periods: oh.periods || [],
      };
    }

    // 2. editorial_summary
    let newAbout = null;
    if (result.editorial_summary?.overview && !r.about_text) {
      newAbout = result.editorial_summary.overview.trim();
    }

    // 3. country_code from address_components
    let newIso = null;
    if (!r.country_code && Array.isArray(result.address_components)) {
      const countryComp = result.address_components.find(c => c.types?.includes('country'));
      if (countryComp?.short_name && /^[A-Z]{2}$/.test(countryComp.short_name)) {
        newIso = countryComp.short_name;
      }
    }

    if (!newHours && !newAbout && !newIso) {
      await new Promise(s => setTimeout(s, DELAY));
      continue;
    }

    // Apply UPDATE
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const logEntries = [];
      if (newHours) {
        logEntries.push({ field:'business_hours_json', old_value:null, new_value:'<json>',
          source:`google_places:${r.place_id}`, verified_at:now, confidence:'HIGH', agent:AGENT, batch:'step-a' });
        hoursAdded++;
      }
      if (newAbout) {
        logEntries.push({ field:'about_text', old_value:null, new_value:newAbout.slice(0,80)+'...',
          source:`google_places:${r.place_id}`, verified_at:now, confidence:'HIGH', agent:AGENT, batch:'step-a' });
        aboutAdded++;
      }
      if (newIso) {
        logEntries.push({ field:'country_code', old_value:null, new_value:newIso,
          source:`google_places:${r.place_id}`, verified_at:now, confidence:'HIGH', agent:AGENT, batch:'step-a' });
        isoAdded++;
      }

      await client.query(`
        UPDATE public.db_restaurants
           SET business_hours_json = COALESCE(business_hours_json, $2::jsonb),
               about_text = COALESCE(about_text, $3),
               country_code = COALESCE(country_code, $4),
               last_verified_at = $5::timestamptz,
               enrichment_log = enrichment_log || $6::jsonb
         WHERE restaurant_id = $1`,
        [r.restaurant_id, newHours ? JSON.stringify(newHours) : null, newAbout, newIso,
         now, JSON.stringify(logEntries)]);

      for (const e of logEntries) {
        await client.query(`
          INSERT INTO public.restaurant_field_verifications
            (restaurant_id, field_name, value_hash, source, source_kind, verified_at, confidence_level, agent, notes)
          VALUES ($1, $2, md5($3::text), $4, 'google_places', $5::timestamptz, 'HIGH', $6, 'step-a')`,
          [r.restaurant_id, e.field, String(e.new_value), e.source, now, AGENT]);
      }
      await client.query('COMMIT');
      ok++;
    } catch (e) {
      await client.query('ROLLBACK');
      err++;
    } finally { client.release(); }
  } catch (e) {
    err++;
  }
  if ((i+1) % 50 === 0) {
    const eta = (Date.now()-t0)/(i+1) * (targets.length-(i+1)) / 1000;
    console.log(`  [${i+1}/${targets.length}] ok=${ok} err=${err} | hours=${hoursAdded} about=${aboutAdded} iso=${isoAdded} | eta=${(eta/60).toFixed(1)}min`);
  }
  await new Promise(s => setTimeout(s, DELAY));
}

console.log(`\nFinal: ok=${ok} err=${err}`);
console.log(`Hours adicionados:  ${hoursAdded}`);
console.log(`About adicionados:  ${aboutAdded}`);
console.log(`ISO codes adicionados: ${isoAdded}`);
fs.writeFileSync('audit-output/step-a-results.json', JSON.stringify({
  generated_at: now, total: targets.length, ok, err,
  hours_added: hoursAdded, about_added: aboutAdded, iso_added: isoAdded,
}, null, 2));
await pool.end();
