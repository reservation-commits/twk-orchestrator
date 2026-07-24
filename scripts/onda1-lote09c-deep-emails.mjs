// LOTE 09c — Deep email scraping for 388 publicados sem email.
// Strategy:
//   1. Try homepage with rotated user-agent.
//   2. Try 10 common contact/reservation paths.
//   3. Aggregate emails, filter via our shared rules.
// At the end: produce PROPOSALS CSV with confidence + cleaned rerank.
//
// Note: does NOT apply yet. User reviews then runs apply step.
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

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
process.on('unhandledRejection', e => console.error('[unhandled]', e?.message || e));
process.on('uncaughtException',  e => console.error('[uncaught]',  e?.message || e));

const USER_AGENTS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_2_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
];

const CONTACT_PATHS = [
  '/', '/contact', '/contact-us', '/contato', '/contacto', '/kontakt', '/contacts',
  '/reservations', '/reservation', '/reservas', '/reserve', '/reserver', '/réservation',
  '/book', '/booking', '/about', '/info',
  '/fr/contact', '/en/contact', '/pt/contato', '/it/contatti', '/es/contacto',
  '/fr/reservation', '/en/reservation',
];

const EMAIL_REGEX = /[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,6}/gi;

const HARD_GARBAGE_LOCAL = new Set([
  'unsubscribe','noreply','no-reply','donotreply','postmaster','webmaster',
  'officer','privacy','careers','career','job','jobs','recruiting','recruitment','hr',
  'press','marketing','media','legal','compliance','dpo','dpa','rgpd','gdpr',
  'sentry','support@sentry','support@cloudflare','example','your-email','test',
  'historian','ambassador','myaccount','reception','helpdesk','newsletter','sample',
]);
const PLACEHOLDER_DOMS = ['info.com','mysite.com','url.com','example.com','monsite.com','your-domain','test.com','sustainability-times.com','tpsonline.org.uk','sentry.io','cloudflare.com','wixpress.com','squarespace.com'];
const VALID_TLDS = new Set([
  'com','net','org','info','biz','co','dev','io','ai','me','tv','cc','asia','app','tech','xyz','site','online','store','restaurant','rest',
  'fr','it','de','es','pt','uk','us','ca','mx','ar','jp','kr','cn','tw','hk','sg','th','my','id','ph','vn','in','ru','tr','pl','nl','be','ch','at','dk','se','no','fi','gr','cz','hu','ro','bg','sk','si','hr','rs','ua','ie','lu','mc','mt','cy','is',
  'eg','ma','tn','ke','tz','za','sn','dz','ly','ng','et','ng',
  'ae','sa','qa','om','kw','bh','jo','lb','il','iq','ir',
  'au','nz','fj','pf','nc',
  'mv','lk','bd','pk','np','mn',
  'cr','pa','bz','cu','do','ht','jm','tt','bb','bs','co','ec','pe','bo','py','uy','ve','sr','gy',
  'mu','sc','re','yt','ao','rw','mw','zm','zw','mz','bw','sz','na',
  'br','com.br',
]);

function looksValid(email) {
  if (!email || email.length > 80) return false;
  if (email.includes('..')) return false;
  const m = email.toLowerCase().match(/^([a-z0-9._%+\-]+)@([a-z0-9.\-]+)$/);
  if (!m) return false;
  const [, local, dom] = m;
  if (HARD_GARBAGE_LOCAL.has(local)) return false;
  if (/officer|privacy|unsubscribe|noreply|no-reply|webmaster|postmaster|historian|ambassador|myaccount/.test(local)) return false;
  if (PLACEHOLDER_DOMS.some(p => dom.includes(p))) return false;
  // Skip placeholder local names
  if (/^(your|sample|test|demo|name|info|fake)$/.test(local)) return false;
  // Reject image-like extensions
  if (/\.(png|jpg|jpeg|webp|svg|gif|pdf)$/.test(email)) return false;
  const parts = dom.split('.');
  const tld = parts[parts.length-1];
  if (tld.length < 2 || tld.length > 6) return false;
  if (!/^[a-z]+$/.test(tld)) return false;
  const last2 = parts.slice(-2).join('.');
  if (!VALID_TLDS.has(last2) && !VALID_TLDS.has(tld)) return false;
  return true;
}

function baseDomain(host) {
  if (!host) return null;
  host = host.toLowerCase().replace(/^www\./,'');
  const parts = host.split('.');
  if (parts.length <= 2) return host;
  const last2 = parts.slice(-2).join('.');
  const last3 = parts.slice(-3).join('.');
  if (/^(co|com|org|gov|edu|ac|net)\.[a-z]{2}$/i.test(last2)) return last3;
  return last2;
}
function hostOf(url) { try { return new URL(url).hostname.toLowerCase(); } catch { return null; } }

const RESV_LOCALS = new Set(['reservation','reservations','reservas','reserva','reservierung','booking','bookings','book','table','tables','contact','contato','info','infos','hello','bonjour','restaurant','restaurante','dining']);

function rank(email, siteUrl) {
  const [local, dom] = email.split('@');
  const siteBase = baseDomain(hostOf(siteUrl));
  const emailBase = baseDomain(dom);
  let s = 0;
  if (emailBase === siteBase) s += 100;
  if (RESV_LOCALS.has(local)) s += 40;
  const parts = local.split(/[._\-0-9]+/).filter(Boolean);
  if (parts.some(p => RESV_LOCALS.has(p))) s += 35;
  if (/reserv|book/.test(local)) s += 20;
  if (/contact|contato|contacto/.test(local)) s += 18;
  if (/^info/.test(local)) s += 12;
  if (local.length <= 12) s += 5;
  return s;
}

async function fetchPath(siteUrl, p, uaIndex) {
  try {
    const base = new URL(siteUrl);
    base.pathname = p; base.search = '';
    return await axios.get(base.toString(), {
      timeout: 10000, maxRedirects: 5, validateStatus: () => true,
      headers: { 'User-Agent': USER_AGENTS[uaIndex % USER_AGENTS.length],
        'Accept': 'text/html,application/xhtml+xml', 'Accept-Language': 'en,pt,fr,it,es;q=0.8',
        'Referer': siteUrl, 'Cache-Control': 'no-cache' },
    });
  } catch (e) {
    return { status: 0, error: e.code || e.message };
  }
}

function extractEmails(html) {
  const set = new Set();
  // mailto:
  let m;
  const mailtoRe = /mailto:([^"'\s>?&]+)/gi;
  while ((m = mailtoRe.exec(html)) !== null) {
    const e = m[1].trim().toLowerCase();
    if (looksValid(e)) set.add(e);
  }
  // body text — also de-obfuscate common patterns
  const cleaned = html.replace(/\[at\]/gi, '@').replace(/\(at\)/gi, '@')
    .replace(/\s+at\s+/gi, '@').replace(/\[dot\]/gi, '.').replace(/\(dot\)/gi, '.');
  while ((m = EMAIL_REGEX.exec(cleaned)) !== null) {
    const e = m[0].toLowerCase();
    if (looksValid(e)) set.add(e);
  }
  return [...set];
}

async function scrapeDeep(siteUrl, restaurant) {
  let emails = new Set();
  // Try a sequence of paths until we hit several or exhausted
  for (let i = 0; i < CONTACT_PATHS.length; i++) {
    const r = await fetchPath(siteUrl, CONTACT_PATHS[i], i);
    if (r.status === 200 && typeof r.data === 'string') {
      const html = r.data.length > 1_000_000 ? r.data.slice(0, 1_000_000) : r.data;
      for (const e of extractEmails(html)) emails.add(e);
      if (emails.size >= 5) break;
    }
    // small pause between paths
    await new Promise(s => setTimeout(s, 80));
    if (i >= 4 && !emails.size) {} // continue beyond 5 paths even if nothing yet
  }
  if (!emails.size) return { error: 'no_email_found' };
  // Rank
  const ranked = [...emails].sort((a,b) => rank(b, siteUrl) - rank(a, siteUrl));
  const best = ranked[0];
  const sameDom = baseDomain(best.split('@')[1]) === baseDomain(hostOf(siteUrl));
  return { email: best, all: ranked.slice(0,5), confidence: sameDom ? 'HIGH' : 'MEDIUM' };
}

const rows = (await pool.query(`
  SELECT restaurant_id, name, city, country, site_url
  FROM public.db_restaurants
  WHERE published = true
    AND (email_for_reservations IS NULL OR email_for_reservations = '')
    AND site_url IS NOT NULL AND site_url <> ''
  ORDER BY restaurant_id`)).rows;
console.log(`Alvo: ${rows.length} publicados sem email com site_url`);

const propPath = 'audit-output/onda1-lote09c-deep-proposals.csv';
const errPath  = 'audit-output/onda1-lote09c-deep-errors.csv';
const propStream = fs.createWriteStream(propPath);
const errStream  = fs.createWriteStream(errPath);
propStream.write('restaurant_id,name,city,country,site_url,proposed_email,confidence,other_emails\n');
errStream.write('restaurant_id,name,site_url,reason\n');
function csvEsc(v){if(v==null)return '';const s=String(v);return /[",\n;]/.test(s)?`"${s.replace(/"/g,'""')}"`:s;}
function csvRow(arr){return arr.map(csvEsc).join(',');}

let n_ok = 0, n_err = 0, n_high = 0, n_medium = 0;
const t0 = Date.now();

for (let i = 0; i < rows.length; i++) {
  const r = rows[i];
  try {
    const res = await Promise.race([
      scrapeDeep(r.site_url, r),
      new Promise(rs => setTimeout(() => rs({ error: 'overall_timeout' }), 60000)),
    ]);
    if (res.error) {
      n_err++;
      errStream.write(csvRow([r.restaurant_id, r.name, r.site_url, res.error]) + '\n');
    } else {
      n_ok++;
      if (res.confidence === 'HIGH') n_high++; else n_medium++;
      propStream.write(csvRow([r.restaurant_id, r.name, r.city, r.country, r.site_url, res.email, res.confidence, (res.all||[]).join('|')]) + '\n');
    }
  } catch (e) {
    n_err++;
    errStream.write(csvRow([r.restaurant_id, r.name, r.site_url, `EXC: ${e.message}`]) + '\n');
  }
  if ((i+1) % 25 === 0) {
    const eta = (Date.now()-t0)/(i+1) * (rows.length-(i+1)) / 1000;
    console.log(`  [${i+1}/${rows.length}] ok=${n_ok} (high=${n_high} med=${n_medium}) err=${n_err} | eta=${(eta/60).toFixed(1)}min`);
  }
  // Light pace between sites
  await new Promise(s => setTimeout(s, 150));
}
propStream.end(); errStream.end();

console.log(`\nFinal: encontrados=${n_ok}/${rows.length} (HIGH=${n_high} MEDIUM=${n_medium}) | erros=${n_err}`);
fs.writeFileSync('audit-output/onda1-lote09c-summary.json', JSON.stringify({
  generated_at: new Date().toISOString(),
  target_count: rows.length,
  found: n_ok, errors: n_err, confidence: { HIGH: n_high, MEDIUM: n_medium },
  elapsed_seconds: Math.round((Date.now()-t0)/1000),
}, null, 2));
await pool.end();
