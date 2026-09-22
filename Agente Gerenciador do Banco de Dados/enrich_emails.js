/*
 * enrich_emails.js — Harvest verified reservation emails for published TWK restaurants.
 *
 * Strategy (confirmed with user):
 *   - Source the official site (site_url; fall back to Google Places website via place_id).
 *   - Scrape homepage + contact/reservation subpages (multilingual), decoding Cloudflare
 *     email-protection and [at]/[dot] obfuscation.
 *   - Accept emails on the official registrable domain (confidence "high"). If none, accept
 *     free-mail (gmail/etc.) found on the official contact page (confidence "medium" if the
 *     local-part looks reservation-related, else "low"). Reject 3rd-party booking platforms
 *     and asset/false-positive matches.
 *   - Write directly to email_for_reservations, recording verification_source / confidence_level
 *     / last_verified_at, and append a full audit entry (incl. all candidates) to enrichment_log.
 *   - The UPDATE only touches rows whose email is still empty -> idempotent & re-runnable.
 *
 * Flags:
 *   --limit N      process at most N restaurants (pilot)
 *   --offset N     skip first N (default 0)
 *   --dry          do NOT write to DB; just print/CSV what would be written
 *   --concurrency  parallel workers (default 6)
 */

const fs = require('fs');
const path = require('path');
const axios = require('./twk-db-agent/node_modules/axios');
const cheerio = require('./twk-db-agent/node_modules/cheerio');
const { Pool } = require('./twk-db-agent/node_modules/pg');

// ---- config ----
const argv = process.argv.slice(2);
const getFlag = (name) => argv.includes(`--${name}`);
const getVal = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
};
const LIMIT = parseInt(getVal('limit', '0'), 10) || 0;
const OFFSET = parseInt(getVal('offset', '0'), 10) || 0;
const DRY = getFlag('dry');
const CONCURRENCY = parseInt(getVal('concurrency', '6'), 10) || 6;
const PLACES_KEY = (() => {
  try {
    const env = fs.readFileSync(path.join(__dirname, 'twk-db-agent', '.env.local'), 'utf8');
    const m = env.match(/GOOGLE_PLACES_API_KEY=(.+)/);
    return m ? m[1].trim() : null;
  } catch { return null; }
})();

const pool = new Pool({
  connectionString: require('./db-config').CONN,
  ssl: { rejectUnauthorized: false },
  max: CONCURRENCY + 2,
});

const UA = 'Mozilla/5.0 (compatible; TWK-Bot/1.0; +https://theworldkeys.com)';

// ---- email helpers ----
const FREE_MAIL = new Set([
  'gmail.com', 'googlemail.com', 'hotmail.com', 'hotmail.fr', 'hotmail.co.uk', 'hotmail.it', 'hotmail.es',
  'outlook.com', 'outlook.fr', 'outlook.es', 'live.com', 'live.fr', 'yahoo.com', 'yahoo.fr', 'yahoo.co.uk',
  'yahoo.es', 'yahoo.it', 'icloud.com', 'me.com', 'gmx.de', 'gmx.net', 'gmx.com', 'web.de', 'orange.fr',
  'wanadoo.fr', 'free.fr', 'sfr.fr', 'laposte.net', 'libero.it', 'virgilio.it', 'alice.it', 'mail.ru',
  'yandex.ru', 'yandex.com', 'qq.com', '163.com', '126.com', 'naver.com', 'protonmail.com', 'proton.me',
  'aol.com', 'aol.fr', 'gmx.fr', 't-online.de', 'bluewin.ch',
]);

// 3rd-party platforms / infra domains we must never store as the restaurant's email
const REJECT_DOMAIN_SUBSTR = [
  'opentable', 'thefork', 'lafourchette', 'sevenrooms', 'resy.com', 'tripadvisor', 'formitable',
  'guestplan', 'quandoo', 'bookatable', 'yelp.', 'zomato', 'wix.com', 'squarespace', 'godaddy',
  'wordpress', 'sentry.', 'sentry.io', 'cloudflare', 'googleapis', 'gstatic', 'schema.org', 'w3.org',
  'example.com', 'domain.com', 'yourdomain', 'email.com', 'company.com', 'sentry-next', 'wixpress',
  'guestonline', 'zenchef', 'theforkmanager', 'deliveroo', 'ubereats', 'justeat', 'mailchimp',
  'list-manage', 'cdn.', 'jsdelivr', 'unpkg', 'fontawesome', 'gravatar',
];
// reject local parts that are clearly placeholders / system
const REJECT_LOCAL_SUBSTR = ['example', 'sentry', 'no-reply', 'noreply', 'donotreply', 'wixpress', 'postmaster', 'abuse', 'webmaster@2x'];
// asset extensions that leak into regex matches
const ASSET_EXT = /\.(png|jpe?g|gif|svg|webp|css|js|ico|woff2?|ttf|eot|mp4|pdf)$/i;

const RESERV_WORDS = ['reservation', 'reservations', 'reserv', 'reserva', 'reservas', 'reserver', 'reservieren',
  'booking', 'book', 'prenota', 'prenotazioni', 'rezerv', 'boekingen'];
const CONTACT_WORDS = ['contact', 'contacto', 'contatti', 'contato', 'kontakt', 'info', 'hello', 'hallo',
  'bonjour', 'enquiries', 'enquiry', 'welcome', 'reception'];

function localPartScore(local) {
  const l = local.toLowerCase();
  if (RESERV_WORDS.some((w) => l.includes(w))) return 3;
  if (CONTACT_WORDS.some((w) => l.includes(w))) return 2;
  return 1;
}

// multi-part TLDs for registrable-domain extraction
const MULTI_TLD = new Set(['co.uk', 'com.br', 'com.au', 'co.jp', 'co.nz', 'com.mx', 'co.kr', 'com.tr',
  'com.sg', 'com.hk', 'co.za', 'com.ar', 'com.co', 'co.il', 'com.cy']);
function registrableDomain(host) {
  if (!host) return '';
  host = host.toLowerCase().replace(/^www\./, '');
  const parts = host.split('.');
  if (parts.length <= 2) return host;
  const last2 = parts.slice(-2).join('.');
  if (MULTI_TLD.has(last2)) return parts.slice(-3).join('.');
  return last2;
}

function decodeCfEmail(hex) {
  try {
    const r = parseInt(hex.substr(0, 2), 16);
    let email = '';
    for (let i = 2; i < hex.length; i += 2) {
      email += String.fromCharCode(parseInt(hex.substr(i, 2), 16) ^ r);
    }
    return email;
  } catch { return ''; }
}

function deobfuscate(text) {
  return text
    .replace(/&#64;|&commat;/gi, '@')
    .replace(/&#46;/gi, '.')
    .replace(/\s*[\[\(\{]\s*at\s*[\]\)\}]\s*/gi, '@')
    .replace(/\s+at\s+(?=[a-z0-9.\-]+\.[a-z]{2,})/gi, '@') // "info at restaurant.com"
    .replace(/\s*[\[\(\{]\s*dot\s*[\]\)\}]\s*/gi, '.')
    .replace(/\s+dot\s+/gi, '.')
    .replace(/\s*[\[\(\{]\s*arroba\s*[\]\)\}]\s*/gi, '@');
}

const EMAIL_RE = /([a-zA-Z0-9._%+\-]+)@([a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/g;

function extractEmails(html) {
  const found = new Map(); // email -> true
  const $ = cheerio.load(html);

  // 1) Cloudflare protected
  $('[data-cfemail]').each((_, el) => {
    const dec = decodeCfEmail($(el).attr('data-cfemail') || '');
    if (dec) found.set(dec.toLowerCase(), true);
  });
  $('a[href*="/cdn-cgi/l/email-protection#"]').each((_, el) => {
    const href = $(el).attr('href') || '';
    const hex = href.split('#')[1];
    if (hex) { const dec = decodeCfEmail(hex); if (dec) found.set(dec.toLowerCase(), true); }
  });

  // 2) mailto: links (highest signal)
  $('a[href^="mailto:"]').each((_, el) => {
    const href = $(el).attr('href') || '';
    const addr = decodeURIComponent(href.replace(/^mailto:/i, '').split('?')[0]).trim();
    if (addr.includes('@')) found.set(addr.toLowerCase(), true);
  });

  // 3) regex over de-obfuscated visible text + raw html
  const text = deobfuscate($('body').text() + ' ' + html);
  let m;
  while ((m = EMAIL_RE.exec(text)) !== null) {
    found.set(m[0].toLowerCase(), true);
  }

  return [...found.keys()];
}

function validCandidate(email) {
  if (!email || email.length > 100) return false;
  if (ASSET_EXT.test(email)) return false;
  const [local, domain] = email.split('@');
  if (!local || !domain || !domain.includes('.')) return false;
  if (/[^a-z0-9._%+\-]/i.test(local)) return false;
  if (REJECT_LOCAL_SUBSTR.some((w) => local.toLowerCase().includes(w))) return false;
  if (REJECT_DOMAIN_SUBSTR.some((w) => domain.toLowerCase().includes(w))) return false;
  if (/\.(png|jpg)$/i.test(domain)) return false;
  return true;
}

// ---- fetching ----
async function fetchHtml(url) {
  try {
    const { data } = await axios.get(url, {
      headers: { 'User-Agent': UA, Accept: 'text/html,*/*' },
      timeout: 12000, maxRedirects: 5, validateStatus: (s) => s >= 200 && s < 400,
    });
    return typeof data === 'string' ? data : '';
  } catch { return ''; }
}

function normalizeUrl(raw) {
  if (!raw) return null;
  let u = raw.trim();
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u.replace(/^\/+/, '');
  try { return new URL(u); } catch { return null; }
}

function subpageLinks(html, base) {
  const $ = cheerio.load(html);
  const links = new Set();
  const wantWords = [...RESERV_WORDS, ...CONTACT_WORDS, 'contact', 'reserv', 'impressum',
    'nous-contacter', 'contactez', 'mentions-legales', 'about', 'about-us'];
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') || '';
    const text = ($(el).text() || '').toLowerCase();
    const hrefL = href.toLowerCase();
    if (wantWords.some((w) => hrefL.includes(w) || text.includes(w))) {
      try {
        const abs = new URL(href, base.href);
        if (abs.hostname === base.hostname && /^https?:/.test(abs.protocol)) {
          links.add(abs.href.split('#')[0]);
        }
      } catch { /* skip */ }
    }
  });
  return [...links].slice(0, 4);
}

async function placesWebsite(placeId) {
  if (!PLACES_KEY || !placeId) return null;
  try {
    const { data } = await axios.get('https://maps.googleapis.com/maps/api/place/details/json', {
      params: { place_id: placeId, fields: 'website', key: PLACES_KEY }, timeout: 10000,
    });
    return data.result?.website || null;
  } catch { return null; }
}

// ---- per-restaurant pipeline ----
async function harvest(row) {
  let siteUrl = (row.site_url || '').trim();
  let usedPlaces = false;
  if (!siteUrl && row.place_id) {
    siteUrl = (await placesWebsite(row.place_id)) || '';
    usedPlaces = true;
  }
  const base = normalizeUrl(siteUrl);
  if (!base) return { status: 'no_site', candidates: [] };

  const seen = new Set();
  const candidates = new Map(); // email -> source url

  async function scan(url) {
    if (seen.has(url) || seen.size > 6) return;
    seen.add(url);
    const html = await fetchHtml(url);
    if (!html) return;
    for (const e of extractEmails(html)) {
      if (validCandidate(e) && !candidates.has(e)) candidates.set(e, url);
    }
    return html;
  }

  const homeHtml = await scan(base.href);
  if (homeHtml) {
    for (const link of subpageLinks(homeHtml, base)) await scan(link);
  }

  // also probe common contact paths if nothing yet
  if (candidates.size === 0) {
    for (const p of ['/contact', '/contact-us', '/contacto', '/kontakt', '/reservations', '/reservas', '/impressum']) {
      await scan(new URL(p, base.href).href);
      if (candidates.size > 0) break;
    }
  }

  const officialDomain = registrableDomain(base.hostname);
  const all = [...candidates.entries()].map(([email, source]) => {
    const dom = registrableDomain(email.split('@')[1]);
    const isOfficial = dom === officialDomain;
    const isFree = FREE_MAIL.has(email.split('@')[1].toLowerCase());
    return { email, source, isOfficial, isFree, score: localPartScore(email.split('@')[0]) };
  });

  // pick: official-domain first (by local-part score), then free-mail
  const official = all.filter((c) => c.isOfficial).sort((a, b) => b.score - a.score);
  const free = all.filter((c) => !c.isOfficial && c.isFree).sort((a, b) => b.score - a.score);

  let pick = null, confidence = null;
  if (official.length) {
    pick = official[0];
    confidence = 'high';
  } else if (free.length) {
    pick = free[0];
    confidence = free[0].score >= 3 ? 'medium' : 'low';
  }

  return {
    status: pick ? 'found' : (all.length ? 'only_rejected' : 'no_email'),
    siteUrl: base.href, usedPlaces, officialDomain,
    pick, confidence, candidates: all,
  };
}

// ---- writer ----
async function writeResult(row, res) {
  const logEntry = JSON.stringify([{
    field: 'email_for_reservations',
    value: res.pick.email,
    method: res.usedPlaces ? 'places_site+scrape' : 'site_scrape',
    source_url: res.pick.source,
    site_url: res.siteUrl,
    official_domain: res.officialDomain,
    confidence: res.confidence,
    all_candidates: res.candidates.map((c) => c.email),
    at: new Date().toISOString(),
  }]);
  await pool.query(
    `UPDATE db_restaurants
       SET email_for_reservations = $1,
           verification_source = $2,
           confidence_level = $3,
           last_verified_at = now(),
           enrichment_log = COALESCE(enrichment_log, '[]'::jsonb) || $4::jsonb
     WHERE restaurant_id = $5
       AND (email_for_reservations IS NULL OR email_for_reservations = '')`,
    [res.pick.email, res.pick.source, res.confidence.toUpperCase(), logEntry, row.restaurant_id]
  );
}

// ---- main ----
(async () => {
  const limitSql = LIMIT ? `LIMIT ${LIMIT} OFFSET ${OFFSET}` : (OFFSET ? `OFFSET ${OFFSET}` : '');
  const { rows } = await pool.query(
    `SELECT restaurant_id, name, city, country, site_url, place_id
       FROM db_restaurants
      WHERE (email_for_reservations IS NULL OR email_for_reservations = '')
        AND published = true
      ORDER BY name ${limitSql}`
  );

  console.log(`Processando ${rows.length} restaurantes | DRY=${DRY} | concurrency=${CONCURRENCY}\n`);
  const csvPath = path.join(__dirname, `email_results_${Date.now()}.csv`);
  const csv = fs.createWriteStream(csvPath);
  csv.write('restaurant_id,name,city,country,status,confidence,email,source\n');
  const esc = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;

  const stats = { found: 0, high: 0, medium: 0, low: 0, no_email: 0, only_rejected: 0, no_site: 0, written: 0, errors: 0 };
  let idx = 0;
  const queue = [...rows];

  async function worker(wid) {
    while (queue.length) {
      const row = queue.shift();
      const n = ++idx;
      try {
        const res = await harvest(row);
        stats[res.status] = (stats[res.status] || 0) + 1;
        if (res.status === 'found') {
          stats[res.confidence]++;
          if (!DRY) { await writeResult(row, res); stats.written++; }
          console.log(`[${n}/${rows.length}] ✓ ${row.name} (${row.city}) -> ${res.pick.email} [${res.confidence}]`);
          csv.write([esc(row.restaurant_id), esc(row.name), esc(row.city), esc(row.country), 'found', res.confidence, esc(res.pick.email), esc(res.pick.source)].join(',') + '\n');
        } else {
          console.log(`[${n}/${rows.length}] · ${row.name} (${row.city}) -> ${res.status}`);
          csv.write([esc(row.restaurant_id), esc(row.name), esc(row.city), esc(row.country), res.status, '', '', ''].join(',') + '\n');
        }
      } catch (e) {
        stats.errors++;
        console.log(`[${n}/${rows.length}] ✗ ${row.name} -> ERROR ${e.message}`);
        csv.write([esc(row.restaurant_id), esc(row.name), esc(row.city), esc(row.country), 'error', '', '', esc(e.message)].join(',') + '\n');
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, (_, i) => worker(i)));
  csv.end();

  console.log('\n──────── RESUMO ────────');
  console.log(`Encontrados:     ${stats.found}  (high=${stats.high} medium=${stats.medium} low=${stats.low})`);
  console.log(`Gravados no DB:  ${DRY ? '0 (dry-run)' : stats.written}`);
  console.log(`Sem email:       ${stats.no_email}`);
  console.log(`Só rejeitados:   ${stats.only_rejected}`);
  console.log(`Sem site:        ${stats.no_site}`);
  console.log(`Erros:           ${stats.errors}`);
  console.log(`CSV: ${csvPath}`);
  await pool.end();
})();
