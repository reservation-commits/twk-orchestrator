// Re-filter MEDIUM chef proposals to separate likely-real names from regex garbage.
import fs from 'node:fs';
const csv = fs.readFileSync('audit-output/onda1-lote07b-chef-michelin-proposals.csv','utf8');
const lines = csv.split('\n').filter(Boolean);
const head = lines[0].split(',');
const rows = lines.slice(1).map(line => {
  const out=[]; let f='', q=false;
  for (let i=0;i<line.length;i++) { const c=line[i];
    if (q) { if (c==='"' && line[i+1]==='"') { f+='"'; i++; } else if (c==='"') q=false; else f+=c; }
    else if (c==='"') q=true; else if (c===',') { out.push(f); f=''; } else f+=c;
  } out.push(f);
  const o={}; head.forEach((h,i)=>o[h]=out[i]); return o;
});

// Words that, if they appear, signal regex pulled menu/UI text instead of a name.
// These reject the WHOLE entry if found ANYWHERE in the name.
const HARD_GARBAGE = new Set([
  'Menu','Menus','Carte','Plat','Plats','Contacter','Bienvenue','Réservation','Reservation','Reservas','Reservations',
  'Vous','Nous','Notre','Nos','Votre','Mentions','Coffrets','Cadeaux','Booking','Cookies',
  'Restaurant','Hotel','Hôtel','Resort','Welcome','Service','Page','Site','Email','Phone','Tel','Tél',
  'Sommelier','Sommelière','Sommeliere','Chef','Chefs','Patron','Owner','Founder','Team','Equipe','Equipa','L\'équipe',
  'Today','Tonight','Lunch','Dinner','Breakfast','Brunch',
]);

// Tail-only garbage: strip if appears at the end of the name, then re-classify.
// e.g. "Frédéric Vardon Un" -> strip "Un" -> "Frédéric Vardon"
const TRAILING_STRIP = new Set([
  'Un','Une','Una','Uno','Le','La','Les','El','La','Los','Las','Du','De','Di','Da','Do',
  'Hailed','Was','Is','Has','Have','Had','Et','And','Or','Que','Qui','Como','As','Y','E',
]);

function stripTrailingGarbage(name) {
  let parts = name.split(/\s+/);
  while (parts.length > 2 && TRAILING_STRIP.has(parts[parts.length - 1])) parts.pop();
  return parts.join(' ');
}

function looksLikeRealName(rawName) {
  const name = stripTrailingGarbage(rawName);
  const parts = name.split(/\s+/);
  if (parts.length < 2 || parts.length > 4) return false;
  for (const p of parts) {
    if (HARD_GARBAGE.has(p)) return false;
    if (p.length < 2) return false;
    if (!/[aeiouyàâäéèêëíïîóòôöúùûüãõñçAEIOUYÀÂÄÉÈÊËÍÏÎÓÒÔÖÚÙÛÜÃÕÑÇ]/u.test(p)) return false;
    // Reject words with lowercase→Uppercase mid-word (concatenated garbage)
    // Exception: McKinnon, MacDonald, O'Brien-like — handled separately
    if (/[a-zà-ÿ][A-ZÀ-Ý]/.test(p) && !/^(Mc|Mac|O[''])/.test(p)) return false;
  }
  // Check for duplicated name ("Daniel Gallacher Daniel Gallacher")
  if (parts.length === 4 && parts[0] === parts[2] && parts[1] === parts[3]) return false;
  return true;
}

function cleanName(rawName) {
  return stripTrailingGarbage(rawName);
}

// Re-clean each proposal: strip trailing garbage and re-classify
for (const r of rows) {
  if (r.proposed_chef) r.proposed_chef = cleanName(r.proposed_chef);
}
const real = rows.filter(r => r.proposed_chef && looksLikeRealName(r.proposed_chef));
const trash = rows.filter(r => r.proposed_chef && !looksLikeRealName(r.proposed_chef));

console.log(`Total MEDIUM proposals: ${rows.filter(r=>r.confidence==='MEDIUM').length}`);
console.log(`Prováveis reais:        ${real.length}`);
console.log(`Lixo regex:             ${trash.length}`);

const cols = ['restaurant_id','name','city','country','award','proposed_chef','occurrences'];
fs.writeFileSync('audit-output/onda1-lote07b-chef-real.csv',
  cols.join(',') + '\n' + real.map(r => cols.map(c => {
    const v = r[c] || '';
    return /[",\n;]/.test(v) ? `"${v.replace(/"/g,'""')}"` : v;
  }).join(',')).join('\n') + '\n');

console.log('\n=== TODOS os ' + real.length + ' PROVÁVEIS REAIS ===');
real.forEach(r => {
  const award = r.award === '1' ? '★   ' : r.award === '2' ? '★★  ' : r.award === '3' ? '★★★ ' : 'guia';
  console.log(`  [${r.restaurant_id}] ${award} ${r.name.padEnd(28).slice(0,28)} (${(r.city || '').padEnd(15).slice(0,15)}) → ${r.proposed_chef} (${r.occurrences}x)`);
});

console.log('\n=== TODOS os ' + trash.length + ' REJEITADOS ===');
trash.forEach(r => console.log(`  [${r.restaurant_id}] ${r.name.padEnd(28).slice(0,28)} → ${r.proposed_chef}`));
