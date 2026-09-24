// Free email audit — classifies emails by quality without any paid API.
// Categories:
//   - empty         : NULL or empty
//   - invalid       : doesn't pass regex (should be 0 after our cleanup)
//   - generic       : info@, contact@, reservation@, hello@ — generic but useful
//   - personal      : something@domain (might be a person)
//   - mismatch      : email domain differs from site_url domain (suspicious)
//   - match         : email domain matches site_url domain (high confidence)
//   - no_site       : can't verify (no site)
//   - free_provider : @gmail.com, @hotmail.com, @yahoo.com (suspicious for a fine dining restaurant)
import fs from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';

const envPath = path.resolve(process.cwd(), '.env.local');
for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
}
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const FREE_PROVIDERS = new Set([
  'gmail.com','googlemail.com','yahoo.com','yahoo.fr','yahoo.it','yahoo.co.uk','yahoo.co.jp',
  'hotmail.com','hotmail.fr','hotmail.it','outlook.com','outlook.fr',
  'live.com','live.fr','msn.com','aol.com','icloud.com','me.com','mac.com',
  'protonmail.com','proton.me','gmx.com','gmx.de','gmx.fr','mail.com',
  'orange.fr','wanadoo.fr','laposte.net','sfr.fr','free.fr','libero.it','tin.it',
  'uol.com.br','bol.com.br','terra.com.br','globo.com','ig.com.br',
]);

const GENERIC_PREFIXES = new Set([
  'info','contact','contato','reservation','reservations','reservas','reserva',
  'hello','hi','bonjour','ciao','hola','ola','olá','salam',
  'office','admin','enquiries','enquiry','book','booking','bookings',
  'restaurant','team','staff','welcome','event','events','catering',
  'sales','press','marketing','communications','communication',
]);

const rows = (await pool.query(`
  SELECT restaurant_id, name, city, country, published, operational_status,
         email_for_reservations AS email, site_url, booking_url
  FROM public.db_restaurants`)).rows;

function hostOf(url) {
  if (!url) return null;
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./,''); } catch { return null; }
}
function baseDomain(host) {
  if (!host) return null;
  const parts = host.split('.');
  if (parts.length <= 2) return host;
  // crude TLD-aware: keep last 2 unless penultimate is co/com/org/etc combined with country
  const last2 = parts.slice(-2).join('.');
  const last3 = parts.slice(-3).join('.');
  const ccTld = /^(co|com|org|gov|edu|ac|net)\.[a-z]{2}$/i;
  if (ccTld.test(last2)) return last3;
  return last2;
}

const stats = {
  total: rows.length,
  published_total: 0,
  by_category: {
    empty: 0, invalid: 0, free_provider: 0, mismatch: 0, no_site: 0,
    match: 0, match_generic: 0, match_personal: 0,
    different_subdomain: 0,
  },
  by_category_published: {
    empty: 0, invalid: 0, free_provider: 0, mismatch: 0, no_site: 0,
    match: 0, match_generic: 0, match_personal: 0,
    different_subdomain: 0,
  },
  has_any_contact: 0,        // published with at least one of: email/site/booking
  no_contact_at_all: 0,
  examples: { mismatch: [], free_provider: [], no_site_no_email: [], match_personal: [] },
};

const detailed = [];

for (const r of rows) {
  if (r.published) stats.published_total++;
  const email = (r.email || '').trim();
  let category;
  const local = email.split('@')[0]?.toLowerCase() || '';
  const dom = email.split('@')[1]?.toLowerCase() || '';
  const siteHost = hostOf(r.site_url);

  if (!email) category = 'empty';
  else if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) category = 'invalid';
  else if (FREE_PROVIDERS.has(dom)) category = 'free_provider';
  else if (!siteHost) category = 'no_site';
  else {
    const emailBase = baseDomain(dom);
    const siteBase  = baseDomain(siteHost);
    if (emailBase === siteBase) {
      // Same base domain — check generic vs personal local-part
      category = GENERIC_PREFIXES.has(local) ? 'match_generic' : 'match_personal';
    } else {
      category = 'mismatch';
    }
  }
  stats.by_category[category]++;
  if (r.published) stats.by_category_published[category]++;

  if (r.published) {
    const anyContact = email || r.site_url || r.booking_url;
    if (anyContact) stats.has_any_contact++;
    else stats.no_contact_at_all++;

    if (category === 'mismatch' && stats.examples.mismatch.length < 8)
      stats.examples.mismatch.push({ id: r.restaurant_id, name: r.name, email, site: r.site_url });
    if (category === 'free_provider' && stats.examples.free_provider.length < 8)
      stats.examples.free_provider.push({ id: r.restaurant_id, name: r.name, email });
    if (!email && !r.site_url && !r.booking_url && stats.examples.no_site_no_email.length < 8)
      stats.examples.no_site_no_email.push({ id: r.restaurant_id, name: r.name, city: r.city });
    if (category === 'match_personal' && stats.examples.match_personal.length < 5)
      stats.examples.match_personal.push({ id: r.restaurant_id, name: r.name, email, site: r.site_url });
  }

  detailed.push({ id: r.restaurant_id, name: r.name, city: r.city, published: r.published,
    email, site_url: r.site_url, category });
}

fs.writeFileSync('audit-output/email-audit-detailed.csv',
  'restaurant_id,name,city,published,email,site_url,category\n' +
  detailed.map(d => [d.id, JSON.stringify(d.name), JSON.stringify(d.city||''), d.published,
    JSON.stringify(d.email||''), JSON.stringify(d.site_url||''), d.category].join(',')).join('\n'));

fs.writeFileSync('audit-output/email-audit-stats.json', JSON.stringify(stats, null, 2));

console.log('\n===== AUDITORIA DE E-MAILS =====');
console.log(`Total restaurantes:      ${stats.total}`);
console.log(`Publicados:              ${stats.published_total}`);
console.log(`Publicados com algum canal de contato (email|site|booking): ${stats.has_any_contact}`);
console.log(`Publicados SEM nenhum canal de contato:                      ${stats.no_contact_at_all}`);
console.log('\n=== Categorias entre PUBLICADOS ===');
const c = stats.by_category_published;
const pct = (n) => `${(100*n/stats.published_total).toFixed(1)}%`;
console.log(`  ✅ MATCH (mesma base do site, prefixo genérico): ${c.match_generic} ${pct(c.match_generic)}`);
console.log(`  ✅ MATCH (mesma base do site, parece pessoal):    ${c.match_personal} ${pct(c.match_personal)}`);
console.log(`  ⚠️  MISMATCH (domínio diferente do site):         ${c.mismatch} ${pct(c.mismatch)}`);
console.log(`  ⚠️  PROVEDOR GRATUITO (gmail/hotmail/…):           ${c.free_provider} ${pct(c.free_provider)}`);
console.log(`  ❓ SEM SITE pra comparar:                          ${c.no_site} ${pct(c.no_site)}`);
console.log(`  ❌ VAZIO (sem email):                              ${c.empty} ${pct(c.empty)}`);
console.log(`  ❌ INVÁLIDO (não passa regex):                     ${c.invalid} ${pct(c.invalid)}`);

console.log('\n=== Exemplos MISMATCH (suspeitos) ===');
stats.examples.mismatch.forEach(e => console.log(`  [${e.id}] ${e.name.padEnd(25)} | ${e.email} ≠ ${e.site}`));
console.log('\n=== Exemplos PROVEDOR GRATUITO (suspeitos) ===');
stats.examples.free_provider.forEach(e => console.log(`  [${e.id}] ${e.name.padEnd(25)} | ${e.email}`));
console.log('\n=== Publicados SEM nenhum canal de contato (amostra) ===');
stats.examples.no_site_no_email.forEach(e => console.log(`  [${e.id}] ${e.name.padEnd(25)} | ${e.city}`));

await pool.end();
