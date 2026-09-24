// Categorize the 58 MEDIUM emails into actionable buckets.
import fs from 'node:fs';

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

const raw = fs.readFileSync('audit-output/onda1-lote09b-emails-cleaned.csv', 'utf8');
const rows = parseCsv(raw);
const medium = rows.filter(r => r.confidence === 'MEDIUM');
console.log(`Total MEDIUM: ${medium.length}`);

const FREE_PROVIDERS = ['gmail.com','hotmail.com','outlook.com','yahoo.','live.','msn.com','aol.com','icloud.com','me.com','protonmail.com','gmx.','orange.fr','wanadoo.fr','laposte.net','sfr.fr','free.fr','libero.it','uol.com.br','bol.com.br','terra.com.br','globo.com'];

const HOTEL_CHAINS = ['fourseasons','marriott','hilton','hyatt','accor','sofitel','mercure','peninsula','mandarin','rosewood','aman','belmond','onefinestay','ritz','intercontinental','ihg','wynn','mgmgrand','venetian','caesars','standardhotels','hoxtonhotels','citizenm','soho','nobu','park-hyatt','grand-hyatt','jw','autograph','sheraton','westin','renaissance','starwood','radisson','kimpton','dolphin','hardrock','melia','barcelo','kempinski'];

const RESV_PLATFORMS = ['tock','sevenrooms','opentable','thefork','resy','yelp','dorchestercollection','michelin','reservebridge','quandoo','superbexperience'];

// Placeholder/junk patterns that should never be used as a real email
const PLACEHOLDER_DOMAINS = ['info.com','mysite.com','url.com','example.com','monsite.com','your-domain','test.com','sustainability-times.com','tpsonline.org.uk'];
const PLACEHOLDER_LOCALS = ['name','your','example','sample','test','demo'];

function isPlaceholder(email) {
  const [local, dom] = (email || '').split('@');
  if (!dom) return false;
  if (PLACEHOLDER_DOMAINS.some(p => dom === p || dom.endsWith('.' + p) || dom.includes(p))) return true;
  if (PLACEHOLDER_LOCALS.includes((local || '').toLowerCase())) return true;
  return false;
}

// Detect "tock", "opentable", etc in localpart (booking platform funnel)
function isPlatformFunnel(email) {
  return /^(tock|sevenrooms|opentable|resy|thefork)inquiries?@/i.test(email || '');
}

function category(email, siteUrl) {
  if (!email) return 'no_email';
  if (isPlaceholder(email)) return 'placeholder';
  if (isPlatformFunnel(email)) return 'platform';
  const dom = email.split('@')[1] || '';
  if (FREE_PROVIDERS.some(p => dom.includes(p))) return 'free_provider';
  if (RESV_PLATFORMS.some(p => dom.includes(p))) return 'platform';
  if (HOTEL_CHAINS.some(p => dom.includes(p))) return 'hotel_chain';
  try {
    const siteHost = new URL(siteUrl).hostname.toLowerCase();
    if (['instagram.com','facebook.com','tiktok.com','x.com','twitter.com'].some(s => siteHost.includes(s))) {
      return 'social_site';
    }
  } catch {}
  return 'group_brand';
}

const buckets = {
  hotel_chain: [], group_brand: [], social_site: [],
  free_provider: [], platform: [], placeholder: [], no_email: [], unclassified: [],
};
for (const r of medium) {
  const cat = category(r.proposed_email, r.site_url);
  buckets[cat]?.push(r) || buckets.unclassified.push(r);
}

const labels = {
  hotel_chain:   '🏨 Hotel/rede (legítimo: reserva via hotel)',
  group_brand:   '🏢 Grupo/marca (pode ser correto — restaurante usa email corporativo)',
  social_site:   '📷 Site é só Instagram/social (e-mail pode ser real da marca)',
  free_provider: '📨 Gmail/Hotmail/etc (suspeito pra fine dining premium)',
  platform:      '🎟️ Plataforma de reserva (NÃO é canal direto — pular)',
  placeholder:   '🚮 Placeholder / lixo (nunca aplicar)',
  unclassified:  '❓ Não categorizado',
};

console.log('');
for (const [cat, items] of Object.entries(buckets)) {
  if (!items.length) continue;
  console.log(`\n========== ${labels[cat] || cat} — ${items.length} casos ==========`);
  items.forEach(r => {
    console.log(`  [${r.restaurant_id}] ${r.name.padEnd(30)} (${(r.city||'').padEnd(15)}) | ${r.proposed_email}`);
    console.log(`     site: ${r.site_url}`);
  });
}

// Save bucket file for the apply step
fs.writeFileSync('audit-output/medium-emails-by-category.json', JSON.stringify({
  generated_at: new Date().toISOString(),
  total: medium.length,
  buckets: Object.fromEntries(Object.entries(buckets).map(([k,v]) => [k, v])),
}, null, 2));
