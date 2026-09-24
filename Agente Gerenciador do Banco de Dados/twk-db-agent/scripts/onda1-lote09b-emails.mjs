// LOTE 09b — Scrape emails from official websites of publicados without email.
// Strategy:
//   1. Fetch homepage, extract emails
//   2. If none on homepage, follow links matching contact|reservation|réservation|contato|kontakt|reserv
//      (max 1 extra page per restaurant)
//   3. Prefer emails where domain matches site, with reservation-related prefix
// Modes: (default) propose, --execute apply UPDATEs
import fs from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';
import axios from 'axios';
import * as cheerio from 'cheerio';

const envPath = path.resolve(process.cwd(), '.env.local');
for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
}

const args = process.argv.slice(2);
const mode = args.includes('--execute') ? 'execute' : 'propose';
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const AGENT = 'twk-db-architect';

process.on('unhandledRejection', e => console.error('[unhandled]', e?.message || e));
process.on('uncaughtException',  e => console.error('[uncaught]',  e?.message || e));

const EMAIL_REGEX = /[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/gi;
const RESERVATION_PREFIXES = ['reservation','reservations','reservas','reserva','reservierung','book','bookings','booking','contact','contato','info','hello','bonjour','restaurant','table'];
const BAD_LOCAL = new Set(['no-reply','noreply','donotreply','postmaster','webmaster','admin','support@sentry','support@cloudflare']);
const BAD_DOMAINS = ['sentry.io','cloudflare.com','wixpress.com','example.com','domain.com','your-domain','test.com','squarespace.com','wix.com','godaddy.com'];
const LINK_HINTS_RE = /(contact|réservation|reservation|reservations|reservas|reserva|contato|kontakt|book)/i;

async function fetchSite(url) {
  return axios.get(url, {
    timeout: 12000, maxRedirects: 5, validateStatus: () => true,
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; TWK-Curator/1.0)',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'en,pt,fr;q=0.8',
    },
  });
}

function baseDomain(host) {
  if (!host) return null;
  host = host.toLowerCase().replace(/^www\./,'');
  const parts = host.split('.');
  if (parts.length <= 2) return host;
  const last2 = parts.slice(-2).join('.');
  const last3 = parts.slice(-3).join('.');
  return /^(co|com|org|gov|edu|ac|net)\.[a-z]{2}$/i.test(last2) ? last3 : last2;
}
function hostOf(url) { try { return new URL(url).hostname.toLowerCase(); } catch { return null; } }

function extractEmails($, html) {
  const set = new Set();
  // mailto: hrefs
  $('a[href^="mailto:"]').each((_, el) => {
    const v = ($(el).attr('href') || '').replace(/^mailto:/i,'').split('?')[0].trim().toLowerCase();
    if (v) set.add(v);
  });
  // body text + raw html (catches obfuscated [at] sometimes)
  let text;
  try { text = $('body').text(); } catch { text = html; }
  // strip cloudflare obfuscation
  const cleaned = (text || '').replace(/\[at\]/gi,'@').replace(/\(at\)/gi,'@').replace(/\s+at\s+/gi,'@').replace(/\[dot\]/gi,'.').replace(/\(dot\)/gi,'.');
  const m = cleaned.match(EMAIL_REGEX) || [];
  for (const e of m) set.add(e.toLowerCase());
  return [...set].filter(e => {
    // sanity
    if (e.length < 5 || e.length > 100) return false;
    if (e.includes('..')) return false;
    if (e.endsWith('.png') || e.endsWith('.jpg') || e.endsWith('.svg') || e.endsWith('.webp')) return false;
    const [local, dom] = e.split('@');
    if (BAD_LOCAL.has(local)) return false;
    if (BAD_DOMAINS.some(b => dom.includes(b))) return false;
    return true;
  });
}

async function pickEmailForRestaurant(siteUrl) {
  // 1. Homepage
  let r;
  try { r = await fetchSite(siteUrl); } catch (e) { return { error: `home_fetch: ${e.code || e.message}` }; }
  if (!r || r.status !== 200 || typeof r.data !== 'string') return { error: `home_status: ${r?.status || 'no'}` };
  let html = r.data; if (html.length > 2_000_000) html = html.slice(0,2_000_000);
  let $; try { $ = cheerio.load(html); } catch { return { error: 'cheerio_home' }; }

  let emails = extractEmails($, html);
  let from = 'home';

  // 2. If none, follow first link matching contact/reservation in same base domain
  if (!emails.length) {
    const siteBase = baseDomain(hostOf(siteUrl));
    let targetHref = null;
    $('a[href]').each((_, el) => {
      if (targetHref) return;
      const href = $(el).attr('href');
      const txt = $(el).text() || '';
      if (!href) return;
      if (LINK_HINTS_RE.test(href) || LINK_HINTS_RE.test(txt)) {
        let abs;
        try { abs = new URL(href, siteUrl).toString(); } catch { return; }
        const absHost = hostOf(abs);
        if (absHost && baseDomain(absHost) === siteBase) { targetHref = abs; }
      }
    });
    if (targetHref) {
      try {
        const r2 = await fetchSite(targetHref);
        if (r2 && r2.status === 200 && typeof r2.data === 'string') {
          let html2 = r2.data; if (html2.length > 2_000_000) html2 = html2.slice(0,2_000_000);
          const $2 = cheerio.load(html2);
          emails = extractEmails($2, html2);
          from = `contact_page:${targetHref}`;
        }
      } catch {}
    }
  }

  if (!emails.length) return { error: 'no_email_found' };

  // Pick best one
  const siteBase = baseDomain(hostOf(siteUrl));
  function rank(e) {
    const [local, dom] = e.split('@');
    let s = 0;
    if (baseDomain(dom) === siteBase) s += 100;       // domain match strongly preferred
    if (RESERVATION_PREFIXES.includes(local)) s += 30;
    if (local.includes('reserv') || local.includes('contact') || local.includes('book')) s += 20;
    if (local.length <= 12) s += 5;                   // short local-part = generic
    return s;
  }
  const best = emails.slice().sort((a,b) => rank(b)-rank(a))[0];
  const bestRank = rank(best);

  let confidence;
  if (baseDomain(best.split('@')[1]) === siteBase) {
    confidence = bestRank >= 130 ? 'HIGH' : (bestRank >= 100 ? 'HIGH' : 'MEDIUM');
  } else {
    confidence = 'MEDIUM';   // different domain — needs review
  }

  return { email: best, confidence, source_page: from, all_emails: emails.slice(0, 5) };
}

const rows = (await pool.query(`
  SELECT restaurant_id, name, city, country, site_url
  FROM public.db_restaurants
  WHERE published = true
    AND (email_for_reservations IS NULL OR email_for_reservations = '')
    AND site_url IS NOT NULL AND site_url <> ''
  ORDER BY restaurant_id`)).rows;
console.log(`Alvo: ${rows.length} publicados sem email com site_url.`);

const propPath = 'audit-output/onda1-lote09b-emails-proposals.csv';
const errPath  = 'audit-output/onda1-lote09b-emails-errors.csv';
const propStream = fs.createWriteStream(propPath);
const errStream  = fs.createWriteStream(errPath);
propStream.write('restaurant_id,name,city,country,site_url,proposed_email,confidence,source_page,other_emails\n');
errStream.write('restaurant_id,name,site_url,reason\n');
function csvEsc(v){if(v==null)return '';const s=String(v);return /[",\n;]/.test(s)?`"${s.replace(/"/g,'""')}"`:s;}
function csvRow(arr){return arr.map(csvEsc).join(',');}

let n_ok = 0, n_err = 0, n_high = 0, n_medium = 0;
const proposals = [];
const t0 = Date.now();

for (let i = 0; i < rows.length; i++) {
  const r = rows[i];
  try {
    const res = await Promise.race([
      pickEmailForRestaurant(r.site_url),
      new Promise(rs => setTimeout(() => rs({ error: 'overall_timeout' }), 25000)),
    ]);
    if (res.error) {
      n_err++;
      errStream.write(csvRow([r.restaurant_id, r.name, r.site_url, res.error]) + '\n');
    } else {
      n_ok++;
      if (res.confidence === 'HIGH') n_high++; else n_medium++;
      propStream.write(csvRow([r.restaurant_id, r.name, r.city, r.country, r.site_url, res.email, res.confidence, res.source_page, (res.all_emails||[]).join('|')]) + '\n');
      proposals.push({ ...r, ...res });
    }
  } catch (e) {
    n_err++;
    errStream.write(csvRow([r.restaurant_id, r.name, r.site_url, `EXC: ${e.message}`]) + '\n');
  }
  if ((i+1) % 25 === 0) {
    const eta = (Date.now()-t0)/(i+1) * (rows.length-(i+1)) / 1000;
    console.log(`  [${i+1}/${rows.length}] ok=${n_ok} err=${n_err} high=${n_high} medium=${n_medium} | eta=${eta.toFixed(0)}s`);
  }
  await new Promise(s => setTimeout(s, 350));   // gentle pace
}
propStream.end(); errStream.end();

fs.writeFileSync('audit-output/onda1-lote09b-summary.json', JSON.stringify({
  mode, generated_at: new Date().toISOString(), target_count: rows.length,
  found: n_ok, errors: n_err, confidence: { HIGH: n_high, MEDIUM: n_medium },
  elapsed_seconds: Math.round((Date.now()-t0)/1000),
}, null, 2));
console.log(`\nFinal: encontrados=${n_ok}/${rows.length} | erros=${n_err}`);
console.log(`Confiança: HIGH=${n_high} MEDIUM=${n_medium}`);

if (mode === 'propose') {
  console.log('\n>>> PROPOSE: nada gravado. Use --execute. <<<');
  await pool.end();
  process.exit(0);
}

// ---------- EXECUTE — only HIGH confidence ----------
console.log('\nAplicando UPDATEs (apenas HIGH)...');
const now = new Date().toISOString();
let okN = 0, errN = 0, skipped = 0;
for (const p of proposals) {
  if (p.confidence !== 'HIGH') { skipped++; continue; }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const entry = { field:'email_for_reservations', old_value:null, new_value:p.email,
      source: `scrape:${p.source_page === 'home' ? p.site_url : p.source_page}`,
      verified_at: now, confidence: 'HIGH', agent: AGENT, batch: 'onda1-lote09b' };
    await client.query(`
      UPDATE public.db_restaurants
         SET email_for_reservations = COALESCE(email_for_reservations, $2),
             last_verified_at = $3::timestamptz,
             verification_source = COALESCE(verification_source, $4),
             confidence_level = COALESCE(confidence_level, 'HIGH'),
             enrichment_log = enrichment_log || $5::jsonb
       WHERE restaurant_id = $1`,
      [p.restaurant_id, p.email, now, entry.source, JSON.stringify([entry])]);
    await client.query(`
      INSERT INTO public.restaurant_field_verifications
        (restaurant_id, field_name, value_hash, source, source_kind, verified_at, confidence_level, agent, notes)
      VALUES ($1, 'email_for_reservations', md5($2), $3, 'official_site', $4::timestamptz, 'HIGH', $5, 'onda1-lote09b')`,
      [p.restaurant_id, p.email, entry.source, now, AGENT]);
    await client.query('COMMIT');
    okN++;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch {}
    errN++;
  } finally { client.release(); }
}
console.log(`\nApply: ok=${okN} skipped=${skipped} (MEDIUM aguarda revisão) err=${errN}`);
await pool.end();
process.exitCode = errN > 0 ? 1 : 0;
