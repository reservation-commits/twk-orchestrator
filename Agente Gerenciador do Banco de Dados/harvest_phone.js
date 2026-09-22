// harvest_phone.js — preenche telephone de publicadas raspando o site oficial.
// Prioriza links tel:, valida contra o código de discagem do país. Dry-run; --apply grava.
const { Pool } = require('./twk-db-agent/node_modules/pg');
const axios = require('./twk-db-agent/node_modules/axios');
const cheerio = require('./twk-db-agent/node_modules/cheerio');

const APPLY = process.argv.includes('--apply');
const UA = 'Mozilla/5.0 (compatible; TWK-Bot/1.0; +https://theworldkeys.com)';
const pool = new Pool({ connectionString: require('./db-config').CONN, ssl: { rejectUnauthorized: false } });
const q = (s, p) => pool.query(s, p);
const sleep = ms => new Promise(r => setTimeout(r, ms));

// código de discagem por país (apenas os presentes no conjunto)
const CC = { 'Australia':'61','Austria':'43','Belgium':'32','Brazil':'55','Costa Rica':'506','France':'33',
  'Mexico':'52','Norway':'47','Portugal':'351','South Africa':'27','Spain':'34','Sweden':'46',
  'United Arab Emirates':'971','United Kingdom':'44','United States':'1' };

const CONTACT_PATHS = ['/contact','/contact-us','/contacto','/contatti','/contato','/kontakt','/nous-contacter','/reservations','/reservation','/reserver','/reservar','/book','/info'];

function normalizeUrl(raw){ if(!raw) return null; let u=raw.trim(); if(!/^https?:\/\//i.test(u)) u='https://'+u.replace(/^\/+/,''); try{ return new URL(u);}catch{ return null; } }
async function fetchHtml(url){ try{ const {data}=await axios.get(url,{headers:{'User-Agent':UA,Accept:'text/html,*/*'},timeout:12000,maxRedirects:5,validateStatus:s=>s>=200&&s<400}); return typeof data==='string'?data:''; }catch{ return ''; } }

function digits(s){ return (s||'').replace(/[^\d+]/g,''); }
// retorna número E.164-ish validado contra o país, ou null
function normalizePhone(raw, country){
  const cc = CC[country];
  let d = (raw||'').replace(/[^\d+]/g,'');
  if(!d) return null;
  // remove 00 internacional -> +
  d = d.replace(/^00/, '+');
  if(d.startsWith('+')){
    const num = d.slice(1);
    if(num.length<7 || num.length>15) return null;
    if(cc && !num.startsWith(cc)) return null; // país não bate -> rejeita (provável widget de outro país)
    return '+'+num;
  }
  // formato nacional: tira zero-tronco inicial e prefixa o país
  if(!cc) return null;
  let nat = d.replace(/^0+/, '');
  if(nat.length<6 || nat.length>13) return null;
  return '+'+cc+nat;
}

function collectTelHrefs(html){
  const $=cheerio.load(html); const out=[];
  $('a[href^="tel:"]').each((_,el)=>{ const h=$(el).attr('href')||''; const v=decodeURIComponent(h.replace(/^tel:/i,'')).trim(); if(v) out.push(v); });
  return out;
}
function subpageLinks(html, base){
  const $=cheerio.load(html); const links=new Set();
  const want=['contact','contacto','contatti','contato','kontakt','reserv','book','prenota','info','impressum'];
  $('a[href]').each((_,el)=>{ const href=$(el).attr('href')||''; const text=($(el).text()||'').toLowerCase(); const hl=href.toLowerCase();
    if(want.some(w=>hl.includes(w)||text.includes(w))){ try{ const abs=new URL(href,base.href); if(abs.hostname===base.hostname&&/^https?:/.test(abs.protocol)) links.add(abs.href.split('#')[0]); }catch{} } });
  return [...links].slice(0,4);
}

async function harvestPhone(siteUrl, country){
  const base=normalizeUrl(siteUrl); if(!base) return null;
  const seen=new Set(); const tels=new Map(); // phone -> source
  async function scan(url){ if(seen.has(url)||seen.size>7) return null; seen.add(url); const html=await fetchHtml(url); if(!html) return null;
    for(const raw of collectTelHrefs(html)){ const p=normalizePhone(raw,country); if(p&&!tels.has(p)) tels.set(p,url); } return html; }
  const home=await scan(base.href);
  if(home) for(const l of subpageLinks(home,base)) { await scan(l); }
  if(tels.size===0) for(const p of CONTACT_PATHS){ await scan(new URL(p,base.href).href); if(tels.size>0) break; }
  if(tels.size===0) return null;
  // escolhe: se houver só um, ótimo; se vários, o mais frequente/primeiro com país batendo
  const list=[...tels.entries()];
  return { phone:list[0][0], source:list[0][1], count:list.length, all:list.map(x=>x[0]) };
}

(async()=>{
  const rows=(await q(`SELECT restaurant_id,name,city,country,site_url FROM db_restaurants
    WHERE published AND (telephone_of_the_establishment IS NULL OR telephone_of_the_establishment='')
      AND site_url IS NOT NULL AND site_url<>'' ORDER BY country,city`)).rows;
  console.log(`${APPLY?'APPLY':'DRY-RUN'} — ${rows.length} linhas com site para raspar\n`);
  let found=0, wrote=0, ambiguous=0;
  for(const r of rows){
    let res=null;
    try{ res=await harvestPhone(r.site_url, r.country); }catch(e){ console.log(`  ! ${r.name}: ${e.message}`); }
    if(!res){ console.log(`  ✗ [${r.restaurant_id}] ${r.name} (${r.city}, ${r.country}) — nada`); await sleep(200); continue; }
    found++;
    const multi = res.count>1 ? ` [${res.count} números: ${res.all.join(', ')}]` : '';
    if(res.count>1) ambiguous++;
    console.log(`  ✓ [${r.restaurant_id}] ${r.name} (${r.city}, ${r.country}) -> ${res.phone}${multi}`);
    if(APPLY){
      await q(`UPDATE db_restaurants SET telephone_of_the_establishment=$1, last_verified_at=now(),
        verification_source='site_scrape_tel' WHERE restaurant_id=$2`,[res.phone,r.restaurant_id]);
      wrote++;
    }
    await sleep(250);
  }
  console.log(`\n=== RESUMO ===\nTelefone encontrado: ${found}/${rows.length} (${ambiguous} com múltiplos candidatos — revisar)`);
  console.log(APPLY?`GRAVADO: ${wrote}`:'(dry-run — nada gravado)');
  pool.end();
})().catch(e=>{console.error('ERRO:',e.message);pool.end();});
