/* email_harvest.js — reusable: scrape a site's official reservation email.
 * Exports harvestEmail(siteUrl) -> { email, source, confidence } | null
 * Same acceptance rules validated in enrich_emails.js. */
const axios = require('./twk-db-agent/node_modules/axios');
const cheerio = require('./twk-db-agent/node_modules/cheerio');

const UA = 'Mozilla/5.0 (compatible; TWK-Bot/1.0; +https://theworldkeys.com)';

const FREE_MAIL = new Set(['gmail.com','googlemail.com','hotmail.com','hotmail.fr','hotmail.co.uk','hotmail.it','hotmail.es','outlook.com','outlook.fr','outlook.es','live.com','live.fr','yahoo.com','yahoo.fr','yahoo.co.uk','yahoo.es','yahoo.it','icloud.com','me.com','gmx.de','gmx.net','gmx.com','web.de','orange.fr','wanadoo.fr','free.fr','sfr.fr','laposte.net','libero.it','virgilio.it','alice.it','mail.ru','yandex.ru','yandex.com','qq.com','163.com','126.com','naver.com','protonmail.com','proton.me','aol.com','aol.fr','gmx.fr','t-online.de','bluewin.ch']);
const REJECT_DOMAIN_SUBSTR = ['opentable','thefork','lafourchette','sevenrooms','resy.com','tripadvisor','formitable','guestplan','quandoo','bookatable','yelp.','zomato','wix.com','squarespace','godaddy','wordpress','sentry.','cloudflare','googleapis','gstatic','schema.org','w3.org','example.com','domain.com','yourdomain','email.com','company.com','wixpress','guestonline','zenchef','theforkmanager','deliveroo','ubereats','justeat','mailchimp','list-manage','cdn.','jsdelivr','unpkg','fontawesome','gravatar'];
const REJECT_LOCAL_SUBSTR = ['example','sentry','no-reply','noreply','donotreply','wixpress','postmaster','abuse'];
// non-reservation departments — never use as reservation email
const REJECT_DEPT = /^(press|presse|prensa|media|job|jobs|career|careers|recruit|recruitment|marketing|hr|rh|newsletter|sales|invoice|billing|accounts|admin|webmaster|cv|stage|comptabilite|compta)/i;
const ASSET_EXT = /\.(png|jpe?g|gif|svg|webp|css|js|ico|woff2?|ttf|eot|mp4|pdf)$/i;
const RESERV_WORDS = ['reservation','reservations','reserv','reserva','reservas','reserver','reservieren','booking','book','prenota','prenotazioni','rezerv','boekingen','resa'];
const CONTACT_WORDS = ['contact','contacto','contatti','contato','kontakt','info','hello','hallo','bonjour','enquiries','enquiry','welcome','reception'];
const MULTI_TLD = new Set(['co.uk','com.br','com.au','co.jp','co.nz','com.mx','co.kr','com.tr','com.sg','com.hk','co.za','com.ar','com.co','co.il','com.cy']);

function registrableDomain(host){ if(!host) return ''; host=host.toLowerCase().replace(/^www\./,''); const p=host.split('.'); if(p.length<=2) return host; const l2=p.slice(-2).join('.'); if(MULTI_TLD.has(l2)) return p.slice(-3).join('.'); return l2; }
function localPartScore(local){ const l=local.toLowerCase(); if(RESERV_WORDS.some(w=>l.includes(w))) return 3; if(CONTACT_WORDS.some(w=>l.includes(w))) return 2; return 1; }
function decodeCfEmail(hex){ try{ const r=parseInt(hex.substr(0,2),16); let e=''; for(let i=2;i<hex.length;i+=2) e+=String.fromCharCode(parseInt(hex.substr(i,2),16)^r); return e; }catch{ return ''; } }
function deobfuscate(t){ return t.replace(/&#64;|&commat;/gi,'@').replace(/&#46;/gi,'.').replace(/\s*[\[\(\{]\s*at\s*[\]\)\}]\s*/gi,'@').replace(/\s+at\s+(?=[a-z0-9.\-]+\.[a-z]{2,})/gi,'@').replace(/\s*[\[\(\{]\s*dot\s*[\]\)\}]\s*/gi,'.').replace(/\s+dot\s+/gi,'.').replace(/\s*[\[\(\{]\s*arroba\s*[\]\)\}]\s*/gi,'@'); }
const EMAIL_RE=/([a-zA-Z0-9._%+\-]+)@([a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/g;

function extractEmails(html){
  const found=new Map(); const $=cheerio.load(html);
  $('[data-cfemail]').each((_,el)=>{ const d=decodeCfEmail($(el).attr('data-cfemail')||''); if(d) found.set(d.toLowerCase(),true); });
  $('a[href*="/cdn-cgi/l/email-protection#"]').each((_,el)=>{ const h=$(el).attr('href')||''; const hex=h.split('#')[1]; if(hex){ const d=decodeCfEmail(hex); if(d) found.set(d.toLowerCase(),true);} });
  $('a[href^="mailto:"]').each((_,el)=>{ const h=$(el).attr('href')||''; const a=decodeURIComponent(h.replace(/^mailto:/i,'').split('?')[0]).trim(); if(a.includes('@')) found.set(a.toLowerCase(),true); });
  const text=deobfuscate($('body').text()+' '+html); let m;
  while((m=EMAIL_RE.exec(text))!==null) found.set(m[0].toLowerCase(),true);
  return [...found.keys()];
}
function sanitizeEmail(email){
  let e = (email || '').toLowerCase().trim();
  e = e.replace(/^\d{2,}(?=[a-z])/, '');           // strip phone digits glued before local part
  const w = e.search(/www\./); if (w > 0) e = e.slice(0, w); // cut concatenated url
  const m = e.match(/[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/); // keep first clean email token
  if (m) e = m[0];
  e = e.replace(/[._\-]+$/, '');                   // trailing junk
  return e;
}
function validCandidate(email){
  if(!email||email.length>100) return false; if(ASSET_EXT.test(email)) return false;
  const [local,domain]=email.split('@'); if(!local||!domain||!domain.includes('.')) return false;
  if(/[^a-z0-9._%+\-]/i.test(local)) return false;
  if(REJECT_LOCAL_SUBSTR.some(w=>local.toLowerCase().includes(w))) return false;
  if(REJECT_DEPT.test(local)) return false;
  if(REJECT_DOMAIN_SUBSTR.some(w=>domain.toLowerCase().includes(w))) return false;
  if(/\.(png|jpg)$/i.test(domain)) return false;
  return true;
}
async function fetchHtml(url){ try{ const {data}=await axios.get(url,{headers:{'User-Agent':UA,Accept:'text/html,*/*'},timeout:12000,maxRedirects:5,validateStatus:s=>s>=200&&s<400}); return typeof data==='string'?data:''; }catch{ return ''; } }
function normalizeUrl(raw){ if(!raw) return null; let u=raw.trim(); if(!/^https?:\/\//i.test(u)) u='https://'+u.replace(/^\/+/,''); try{ return new URL(u);}catch{ return null; } }
function subpageLinks(html,base){ const $=cheerio.load(html); const links=new Set(); const want=[...RESERV_WORDS,...CONTACT_WORDS,'impressum','nous-contacter','contactez','mentions-legales','about'];
  $('a[href]').each((_,el)=>{ const href=$(el).attr('href')||''; const text=($(el).text()||'').toLowerCase(); const hl=href.toLowerCase();
    if(want.some(w=>hl.includes(w)||text.includes(w))){ try{ const abs=new URL(href,base.href); if(abs.hostname===base.hostname&&/^https?:/.test(abs.protocol)) links.add(abs.href.split('#')[0]); }catch{} } });
  return [...links].slice(0,4); }

async function harvestEmail(siteUrl){
  const base=normalizeUrl(siteUrl); if(!base) return null;
  const seen=new Set(); const cands=new Map();
  async function scan(url){ if(seen.has(url)||seen.size>6) return null; seen.add(url); const html=await fetchHtml(url); if(!html) return null;
    for(const e0 of extractEmails(html)){ const e=sanitizeEmail(e0); if(validCandidate(e)&&!cands.has(e)) cands.set(e,url); } return html; }
  const home=await scan(base.href);
  if(home) for(const l of subpageLinks(home,base)) await scan(l);
  if(cands.size===0) for(const p of ['/contact','/contact-us','/contacto','/reservations','/reservation','/reserver','/impressum']){ await scan(new URL(p,base.href).href); if(cands.size>0) break; }
  const official=registrableDomain(base.hostname);
  const all=[...cands.entries()].map(([email,source])=>{ const dom=registrableDomain(email.split('@')[1]); return {email,source,isOfficial:dom===official,isFree:FREE_MAIL.has(email.split('@')[1].toLowerCase()),score:localPartScore(email.split('@')[0])}; });
  const off=all.filter(c=>c.isOfficial).sort((a,b)=>b.score-a.score);
  const free=all.filter(c=>!c.isOfficial&&c.isFree).sort((a,b)=>b.score-a.score);
  if(off.length) return {email:off[0].email,source:off[0].source,confidence:'HIGH'};
  if(free.length) return {email:free[0].email,source:free[0].source,confidence:free[0].score>=3?'MEDIUM':'LOW'};
  return null;
}
module.exports = { harvestEmail, registrableDomain, sanitizeEmail };
