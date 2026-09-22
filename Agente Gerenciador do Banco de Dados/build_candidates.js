/*
 * build_candidates.js — Source NEW high-end French restaurants with COMPLETE data, ready to register.
 * Only rows with ALL required fields are written:
 *   name, address, city, country, establishment_type, restaurant_category, site_url,
 *   email_for_reservations, telephone (E.164), latitude, longitude, price_range_id, rating.
 * Dedups against existing db_restaurants (place_id + normalized name). Pilot via --target N.
 */
const fs = require('fs');
const path = require('path');
const axios = require('./twk-db-agent/node_modules/axios');
const { Pool } = require('./twk-db-agent/node_modules/pg');
const { harvestEmail } = require('./email_harvest');

const argv = process.argv.slice(2);
const getVal = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const TARGET = parseInt(getVal('target', '50'), 10);
const CONCURRENCY = parseInt(getVal('concurrency', '5'), 10);
const OUT = getVal('out', `candidates_FR_${Date.now()}.csv`);
const MIN_RATING = parseFloat(getVal('minrating', '4.5'));
const MIN_REVIEWS = parseInt(getVal('minreviews', '100'), 10);

const KEY = (() => {
  const env = fs.readFileSync(path.join(__dirname, 'twk-db-agent', '.env.local'), 'utf8');
  return env.match(/GOOGLE_PLACES_API_KEY=(.+)/)[1].trim();
})();
const PLACES = 'https://maps.googleapis.com/maps/api/place';
const pool = new Pool({ connectionString: require('./db-config').CONN, ssl: { rejectUnauthorized: false } });

// European gastronomic regions -> France first, then expand by country to reach target.
const REGIONS = [
  { country: 'France', cuisine: 'French', accept: /france/i,
    cities: ['Paris','Lyon','Nice','Cannes','Antibes','Saint-Tropez','Menton','Èze','Mougins','Bordeaux','Strasbourg','Colmar','Marseille','Aix-en-Provence','Avignon','Biarritz','Reims','Annecy','Megève','Courchevel','Valence','Roanne','Chagny','Toulouse','Nantes','Lille','Honfleur','Deauville','Saint-Émilion','Beaune','Montpellier','Cannes','Saint-Jean-Cap-Ferrat','Chamonix','Vonnas','Èze-sur-Mer'],
    q: (c) => [`restaurant gastronomique ${c}`, `restaurant étoilé Michelin ${c}`, `fine dining ${c} France`] },
  { country: 'Spain', cuisine: 'Spanish', accept: /spain|espa[ñn]a/i,
    cities: ['San Sebastián','Barcelona','Madrid','Valencia','Bilbao','Girona','Marbella','Málaga','Sevilla','Valladolid','Tenerife','Cáceres','Dénia','Larrabetzu','Roses'],
    q: (c) => [`restaurante con estrella Michelin ${c}`, `alta cocina ${c}`, `fine dining ${c} Spain`] },
  { country: 'Italy', cuisine: 'Italian', accept: /ital(y|ia)/i,
    cities: ['Milan','Rome','Modena','Florence','Naples','Turin','Bologna','Venice','Verona','Rimini','Bergamo','Alba','Senigallia','Brusaporto','Rubano'],
    q: (c) => [`ristorante stellato Michelin ${c}`, `alta cucina ${c}`, `fine dining ${c} Italy`] },
  { country: 'Portugal', cuisine: 'Portuguese', accept: /portugal/i,
    cities: ['Lisbon','Porto','Lagos','Cascais','Guimarães','Albufeira','Funchal','Vila Nova de Gaia'],
    q: (c) => [`restaurante estrela Michelin ${c}`, `alta gastronomia ${c}`, `fine dining ${c} Portugal`] },
  { country: 'United Kingdom', cuisine: 'British', accept: /united kingdom|england|scotland|wales|uk\b/i,
    cities: ['London','Edinburgh','Manchester','Birmingham','Bray','Oxford','Cartmel','Aughton'],
    q: (c) => [`Michelin star restaurant ${c}`, `fine dining ${c}`, `best gourmet restaurant ${c} UK`] },
  { country: 'Germany', cuisine: 'German', accept: /germany|deutschland/i,
    cities: ['Berlin','Munich','Hamburg','Frankfurt','Cologne','Düsseldorf','Baiersbronn','Stuttgart'],
    q: (c) => [`Sterne Restaurant Michelin ${c}`, `fine dining ${c}`, `Gourmet Restaurant ${c}`] },
  { country: 'Belgium', cuisine: 'Belgian', accept: /belgium|belgi[eq]/i,
    cities: ['Brussels','Antwerp','Ghent','Bruges'],
    q: (c) => [`Michelin star restaurant ${c}`, `fine dining ${c} Belgium`, `gastronomique ${c}`] },
  { country: 'Netherlands', cuisine: 'Dutch', accept: /netherlands|nederland/i,
    cities: ['Amsterdam','Rotterdam','The Hague','Utrecht'],
    q: (c) => [`Michelin star restaurant ${c}`, `fine dining ${c} Netherlands`, `gourmet restaurant ${c}`] },
  { country: 'Switzerland', cuisine: 'Swiss', accept: /switzerland|schweiz|suisse/i,
    cities: ['Zurich','Geneva','Basel','Lausanne','Crans-Montana','Vufflens-le-Château'],
    q: (c) => [`Michelin star restaurant ${c}`, `fine dining ${c} Switzerland`, `gastronomique ${c}`] },
  { country: 'Austria', cuisine: 'Austrian', accept: /austria|österreich/i,
    cities: ['Vienna','Salzburg','Linz'],
    q: (c) => [`Sterne Restaurant Michelin ${c}`, `fine dining ${c} Austria`, `Gourmet Restaurant ${c}`] },
  { country: 'Denmark', cuisine: 'Danish', accept: /denmark|danmark/i,
    cities: ['Copenhagen','Aarhus'],
    q: (c) => [`Michelin star restaurant ${c}`, `fine dining ${c} Denmark`, `gourmet restaurant ${c}`] },
  { country: 'Greece', cuisine: 'Greek', accept: /greece|ελλάδα|hellas/i,
    cities: ['Athens','Thessaloniki','Mykonos','Santorini'],
    q: (c) => [`Michelin star restaurant ${c}`, `fine dining ${c} Greece`, `gourmet restaurant ${c}`] },
];

const norm = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

function cityFromAddress(addr, fallback) {
  if (!addr) return fallback;
  const parts = addr.split(',').map(s => s.trim()).filter(Boolean);
  if (parts.length < 2) return fallback;
  parts.pop(); // drop country (last component)
  // the component that holds the city is the one carrying a postal code
  const postalRe = /\d{4}-\d{3}|[A-Za-z]{1,2}\d[A-Za-z\d]?\s*\d[A-Za-z]{2}|\d{4,5}/;
  let cand = [...parts].reverse().find(p => postalRe.test(p)) || parts[parts.length - 1];
  cand = cand
    .replace(/\d{4}-\d{3}/g, ' ')                                  // PT postal (1200-289)
    .replace(/[A-Za-z]{1,2}\d[A-Za-z\d]?\s*\d[A-Za-z]{2}/g, ' ')   // UK postcode
    .replace(/\b\d{4,5}\b/g, ' ')                                  // FR/ES/IT/DE postal
    .replace(/\s+[A-Z]{2}\b/g, ' ')                                // IT province code (Milano MI)
    .replace(/\s+cedex.*$/i, '')
    .replace(/\s+/g, ' ').trim();
  if (cand.includes('/')) cand = cand.split('/').pop().trim();     // "Donostia / San Sebastián"
  return cand || fallback;
}
function cleanName(raw) {
  let n = (raw || '').split('|')[0].trim();
  n = n.replace(/,\s*(le\s+|la\s+|l['’]\s*)?(restaurant|brasserie|bistrot?|table|maison)\b[^,]*$/i, '').trim();
  n = n.replace(/\s+restaurant\s+à\s+.+$/i, '').trim();
  n = n.replace(/\s*[-–—]\s*restaurant\s*$/i, '').trim();
  n = n.replace(/[\s,–—-]+$/, '').trim();
  return n;
}

async function textSearch(query, pageToken) {
  const params = { query, type: 'restaurant', key: KEY };
  if (pageToken) params.pagetoken = pageToken;
  const { data } = await axios.get(`${PLACES}/textsearch/json`, { params, timeout: 12000 });
  if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') throw new Error(`Places: ${data.status}`);
  return data;
}
async function details(placeId) {
  const fields = ['name', 'formatted_address', 'geometry', 'formatted_phone_number',
    'international_phone_number', 'website', 'price_level', 'rating', 'user_ratings_total',
    'types', 'editorial_summary'].join(',');
  const { data } = await axios.get(`${PLACES}/details/json`, { params: { place_id: placeId, fields, key: KEY }, timeout: 12000 });
  if (data.status !== 'OK') throw new Error(`Details: ${data.status}`);
  return data.result;
}

function detectCuisine(text, baselineCuisine) {
  const t = (text || '').toLowerCase();
  const tags = new Set();
  if (/sushi|japanese|japonais|izakaya|sashimi|omakase/.test(t)) { tags.add('Asian'); tags.add('Japanese'); }
  if (/italian|italien|trattoria|osteria|pizz|pasta/.test(t)) { tags.add('Italian'); }
  if (/seafood|fruits de mer|poisson|fish|oyster|huîtres|marisco|pesce/.test(t)) { tags.add('Sea food'); }
  if (/steak|grill|viande|beef|carne/.test(t)) { tags.add('Steakhouse'); }
  if (/mediterran|provenç|provencal|mediterrán/.test(t)) { tags.add('Mediterranean'); }
  tags.add('European');
  if (baselineCuisine) tags.add(baselineCuisine);
  return [...tags];
}
function buildCategory(priceId, cuisines, michelin) {
  const sym = '$'.repeat(priceId);
  const parts = [];
  if (michelin) parts.push('*Michelin');
  parts.push(sym);
  parts.push(...cuisines);
  return `${parts.join('|')}, Vegetarian friendly`;
}

(async () => {
  // dedup sets
  const ex = await pool.query(`SELECT name, city, place_id FROM db_restaurants`);
  const dupNames = new Set(ex.rows.map(r => norm(r.name) + '|' + norm(r.city)));
  const dupNamesLoose = new Set(ex.rows.map(r => norm(r.name)));
  const dupPlace = new Set(ex.rows.filter(r => r.place_id).map(r => r.place_id));
  console.log(`Dedup: ${ex.rows.length} existentes carregados.\n`);

  const cols = ['name','establishment_type','restaurant_category','address_of_establishment','city','country',
    'telephone_of_the_establishment','email_for_reservations','site_url','latitude','longitude','price_range_id',
    'place_id','google_rating','google_reviews','email_confidence','email_source'];
  const esc = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
  const out = fs.createWriteStream(path.join(__dirname, OUT));
  out.write(cols.join(',') + '\n');

  const results = [];
  const skipped = { noemail: 0, nophone: 0, nosite: 0, lowprice: 0 };
  const runPlace = new Set();              // dedup within this run (across regions/cities)
  const runName = new Set();
  let processed = 0, stop = false;

  // gather unique candidates for one region
  async function gatherRegion(region) {
    const cands = new Map();
    for (const city of region.cities) {
      for (const q of region.q(city)) {
        let token, pages = 0;
        do {
          let data;
          try { data = await textSearch(q, token); } catch { break; }
          for (const r of (data.results || [])) {
            if ((r.rating || 0) < MIN_RATING) continue;
            if ((r.user_ratings_total || 0) < MIN_REVIEWS) continue;
            if (dupPlace.has(r.place_id) || runPlace.has(r.place_id)) continue;
            if (dupNamesLoose.has(norm(r.name)) || runName.has(norm(r.name))) continue;
            if (!region.accept.test(r.formatted_address || '')) continue;
            if (!cands.has(r.place_id)) cands.set(r.place_id, { region, r });
          }
          token = data.next_page_token; pages++;
          if (token && pages < 2) await new Promise(s => setTimeout(s, 2000)); else token = null;
        } while (token);
      }
      if (stop) break;
      process.stdout.write(`  [${region.country}] coletados ${cands.size} (até ${city})        \r`);
    }
    return [...cands.values()];
  }

  // process a candidate list, appending complete rows until target reached
  async function processList(list) {
    async function worker() {
      while (list.length && !stop) {
        const { region, r } = list.shift();
        processed++;
        try {
          const d = await details(r.place_id);
          if (runPlace.has(r.place_id) || runName.has(norm(d.name))) continue;
          const website = d.website;
          if (!website) { skipped.nosite++; continue; }
          const phone = d.international_phone_number;
          if (!phone || !/^\+/.test(phone)) { skipped.nophone++; continue; }
          let pl = d.price_level;
          if (pl != null && pl < 3) { skipped.lowprice++; continue; }
          const priceId = (pl != null && pl >= 1) ? pl : 4;
          const em = await harvestEmail(website);
          if (!em) { skipped.noemail++; continue; }
          const txt = `${d.name} ${d.editorial_summary?.overview || ''}`;
          const michelin = /michelin|étoile|etoile|estrela|stellato|stern/i.test(txt);
          const cuisines = detectCuisine(txt, region.cuisine);
          const row = {
            name: cleanName(d.name),
            establishment_type: 'Restaurant',
            restaurant_category: buildCategory(priceId, cuisines, michelin),
            address_of_establishment: d.formatted_address,
            city: cityFromAddress(d.formatted_address, region.cities[0]),
            country: region.country,
            telephone_of_the_establishment: phone,
            email_for_reservations: em.email,
            site_url: website,
            latitude: d.geometry?.location?.lat,
            longitude: d.geometry?.location?.lng,
            price_range_id: priceId,
            place_id: r.place_id,
            google_rating: d.rating,
            google_reviews: d.user_ratings_total,
            email_confidence: em.confidence,
            email_source: em.source,
          };
          runPlace.add(r.place_id); runName.add(norm(d.name));
          results.push(row);
          out.write(cols.map(c => esc(row[c])).join(',') + '\n');
          console.log(`[${results.length}/${TARGET}] ✓ ${row.name} (${row.city}, ${region.country}) — ${em.email} [${em.confidence}] ${d.rating}★`);
          if (results.length >= TARGET) stop = true;
        } catch { /* skip on error */ }
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  }

  for (const region of REGIONS) {
    if (stop) break;
    console.log(`\n=== Região: ${region.country} ===`);
    const list = await gatherRegion(region);
    console.log(`\n  ${list.length} candidatos únicos — processando...`);
    await processList(list);
    console.log(`  Subtotal acumulado: ${results.length}/${TARGET}`);
  }
  out.end();

  console.log('\n──────── RESUMO ────────');
  console.log(`Completos no CSV:   ${results.length}`);
  console.log(`Candidatos vistos:  ${processed}`);
  console.log(`Descartados — sem email: ${skipped.noemail}, sem site: ${skipped.nosite}, sem telefone+: ${skipped.nophone}, preço baixo: ${skipped.lowprice}`);
  // breakdown by country
  const byCountry = {};
  results.forEach(r => { byCountry[r.country] = (byCountry[r.country] || 0) + 1; });
  console.log('Por país:', JSON.stringify(byCountry));
  console.log(`CSV: ${path.join(__dirname, OUT)}`);
  await pool.end();
})();
