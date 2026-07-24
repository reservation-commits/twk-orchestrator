// Re-rank scraped emails with stricter filters. No re-scraping, no API.
// Outputs a cleaner CSV with only TRULY high-confidence picks.
import fs from 'node:fs';

const BAD_LOCAL = new Set([
  'unsubscribe','no-reply','noreply','donotreply','postmaster','webmaster',
  'officer','privacy','concierge','careers','career','job','jobs','recruiting','recruitment','recruiter','hr',
  'press','marketing','communications','communication','media',
  'legal','compliance','dpo','dpa','rgpd','gdpr',
  'support','helpdesk','help','tech','it','admin','sysadmin',
  'sales','accounts','accounting','finance','billing','invoice',
  'eventos','events','catering','wedding','weddings',
  // Hotel-chain non-reservation patterns
  'historian','ambassador','myaccount','guest','reception','helpdesk','newsletter',
  // Common typo/junk
  'coporate','example','your-email','test','tests','demo','sample',
]);

const VALID_TLDS = new Set([
  // gTLDs
  'com','net','org','info','biz','name','pro','app','co','dev','tech','xyz','site','online','store','restaurant','rest','io','ai','me','tv','cc','asia',
  // ccTLDs (relevant to our DB)
  'fr','it','de','es','pt','uk','co.uk','com.br','br','us','ca','mx','ar','jp','kr','cn','tw','hk','sg','th','my','id','ph','vn','in','ru','tr','pl','nl','be','ch','at','dk','se','no','fi','gr','cz','hu','ro','bg','sk','si','hr','rs','ua','ba','lt','lv','ee','ie','lu','mt','cy','is','li','mc','va','sm','ad','je','gg','im','gi','ax','fo','sj',
  'eg','ma','tn','ng','ke','tz','za','et','ma','sn','dz','ly',
  'ae','sa','qa','om','kw','bh','jo','lb','sy','il','iq','ir','ye',
  'au','nz','fj','pf','nc','ws','to','ck','nu','tv',
  'mv','lk','bd','pk','np','bt','mn','kp',
  'gt','sv','hn','ni','cr','pa','bz','cu','do','ht','jm','tt','bb','bs','ai','ag','ms','tc','vc','vg','vi','gd','dm','lc','kn','an','aw','bq','sx','cw','co','ec','pe','bo','py','uy','ve','sr','gy','gf',
  'mu','sc','re','yt','km','dj','er','so','ss','sd','td','cf','cm','ga','gq','st','ao','cd','cg','rw','bi','mw','zm','zw','mz','bw','sz','ls','na',
]);

function localContainsBad(local) {
  // Split on .  _ -  digits to catch composed locals like "privacy.officer", "my-officer"
  const parts = local.split(/[._\-0-9]+/).filter(Boolean);
  if (parts.some(p => BAD_LOCAL.has(p))) return true;
  // Substring check for high-signal bad words
  if (/officer|privacy|unsubscribe|noreply|no-reply|webmaster|postmaster/.test(local)) return true;
  return false;
}

function isValidEmail(email) {
  if (!email || typeof email !== 'string') return false;
  if (email.length > 80) return false;
  if (email.includes('..')) return false;
  if (/[<>'"\s]/.test(email)) return false;
  const m = email.toLowerCase().match(/^([a-z0-9._%+\-]+)@([a-z0-9.\-]+)$/);
  if (!m) return false;
  const [, local, domain] = m;
  if (!local || !domain) return false;
  if (BAD_LOCAL.has(local)) return false;
  if (localContainsBad(local)) return false;
  if (local.length > 40) return false;
  const parts = domain.split('.');
  if (parts.length < 2) return false;
  const tldCandidate = parts[parts.length - 1];
  // Stop short: TLD must be 2-6 chars, all letters
  if (tldCandidate.length < 2 || tldCandidate.length > 6) return false;
  if (!/^[a-z]+$/.test(tldCandidate)) return false;
  // Try last-2 first (e.g. co.uk), else just TLD
  const last2 = parts.slice(-2).join('.');
  if (!VALID_TLDS.has(last2) && !VALID_TLDS.has(tldCandidate)) return false;
  return true;
}

function baseDomain(host) {
  if (!host) return null;
  host = host.toLowerCase().replace(/^www\./, '');
  const parts = host.split('.');
  if (parts.length <= 2) return host;
  const last2 = parts.slice(-2).join('.');
  const last3 = parts.slice(-3).join('.');
  if (/^(co|com|org|gov|edu|ac|net)\.[a-z]{2}$/i.test(last2)) return last3;
  return last2;
}
function hostOf(url) { try { return new URL(url).hostname.toLowerCase(); } catch { return null; } }

const RESV_LOCALS = new Set([
  'reservation','reservations','reservas','reserva','reservierung',
  'booking','bookings','book','table','tables',
  'contact','contato',
  'info','infos','hello','bonjour','restaurant','restaurante','dining',
]);

function rank(email, siteUrl) {
  const [local, dom] = email.split('@');
  const siteBase = baseDomain(hostOf(siteUrl));
  const emailBase = baseDomain(dom);
  let s = 0;
  if (emailBase === siteBase) s += 100;
  if (RESV_LOCALS.has(local)) s += 40;          // exact match
  // sub-word check — "central.reservas", "geral.contacto" should boost
  const parts = local.split(/[._\-0-9]+/).filter(Boolean);
  if (parts.some(p => RESV_LOCALS.has(p))) s += 35;
  if (/reserv/.test(local)) s += 25;            // anywhere "reserv*"
  if (/contact|contato|contacto/.test(local)) s += 18;
  if (/^info|^infos\./.test(local)) s += 12;
  if (/book/.test(local)) s += 12;
  if (local.length <= 12) s += 5;
  return s;
}

// Parse CSV
function parseCsv(text) {
  const lines = text.split('\n').filter(Boolean);
  const head = lines[0].split(',');
  return lines.slice(1).map(line => {
    const out = []; let f='', q=false;
    for (let i=0; i<line.length; i++) {
      const c = line[i];
      if (q) { if (c==='"' && line[i+1]==='"') { f+='"'; i++; } else if (c==='"') q=false; else f+=c; }
      else if (c==='"') q=true; else if (c===',') { out.push(f); f=''; } else f+=c;
    } out.push(f);
    const o = {};
    head.forEach((h,i) => o[h] = out[i]);
    return o;
  });
}

const csv = fs.readFileSync('audit-output/onda1-lote09b-emails-proposals.csv','utf8');
const rows = parseCsv(csv);
console.log(`Carregadas ${rows.length} propostas originais.`);

const cleaned = [];
let n_high = 0, n_medium = 0, n_dropped = 0;

for (const r of rows) {
  const candidates = new Set();
  if (r.proposed_email) candidates.add(r.proposed_email.toLowerCase());
  if (r.other_emails) {
    for (const e of r.other_emails.split('|')) {
      const clean = (e || '').toLowerCase().trim();
      if (clean) candidates.add(clean);
    }
  }
  const valid = [...candidates].filter(isValidEmail);
  if (!valid.length) { n_dropped++; continue; }
  valid.sort((a,b) => rank(b, r.site_url) - rank(a, r.site_url));
  const best = valid[0];
  const bestScore = rank(best, r.site_url);
  const sameDomain = baseDomain(best.split('@')[1]) === baseDomain(hostOf(r.site_url));
  const confidence = sameDomain ? (bestScore >= 120 ? 'HIGH' : 'HIGH') : 'MEDIUM';
  if (confidence === 'HIGH') n_high++; else n_medium++;
  cleaned.push({
    restaurant_id: r.restaurant_id, name: r.name, city: r.city, country: r.country,
    site_url: r.site_url, original_proposed: r.proposed_email,
    proposed_email: best, confidence,
    source_page: r.source_page,
    same_domain_as_site: sameDomain ? 'yes' : 'no',
    valid_candidates: valid.slice(0, 4).join('|'),
  });
}

function csvEsc(v){if(v==null)return '';const s=String(v);return /[",\n;]/.test(s)?`"${s.replace(/"/g,'""')}"`:s;}
const cols = ['restaurant_id','name','city','country','site_url','original_proposed','proposed_email','confidence','same_domain_as_site','source_page','valid_candidates'];
fs.writeFileSync('audit-output/onda1-lote09b-emails-cleaned.csv',
  cols.join(',') + '\n' + cleaned.map(c => cols.map(k => csvEsc(c[k])).join(',')).join('\n') + '\n');

console.log(`\nApós re-filtragem:`);
console.log(`  HIGH (mesmo domínio do site):   ${n_high}`);
console.log(`  MEDIUM (domínio diferente):     ${n_medium}`);
console.log(`  Descartados (sem candidato válido): ${n_dropped}`);
console.log(`\nArquivo: audit-output/onda1-lote09b-emails-cleaned.csv`);

console.log('\n=== 15 HIGH amostra (mesmo domínio do site) ===');
cleaned.filter(c => c.confidence === 'HIGH').slice(0,15).forEach(c =>
  console.log(`  [${c.restaurant_id}] ${c.name.padEnd(28)} | ${c.proposed_email}${c.original_proposed!==c.proposed_email?` (era: ${c.original_proposed})`:''}`));
console.log('\n=== 10 MEDIUM amostra ===');
cleaned.filter(c => c.confidence === 'MEDIUM').slice(0,10).forEach(c =>
  console.log(`  [${c.restaurant_id}] ${c.name.padEnd(28)} | ${c.proposed_email} ≠ ${hostOf(c.site_url)}`));
