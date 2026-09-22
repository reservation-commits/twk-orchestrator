// price_fill.js — preenche price_range_id dos publicados via Places v1.
// Regra: priceLevel (autoritativo) -> mapa; priceRange SEM endPrice (banda aberta no topo) -> tier 4.
// priceRange limitado e "nada" NÃO são gravados (vão para busca web). Dry-run; --apply grava.
const fs=require('fs'),path=require('path');
const {Pool}=require('./twk-db-agent/node_modules/pg');
const axios=require('./twk-db-agent/node_modules/axios');
const env=fs.readFileSync(path.join('twk-db-agent','.env.local'),'utf8');
const KEY=(env.match(/GOOGLE_PLACES_API_KEY=(.+)/)||[])[1].trim();
const APPLY=process.argv.includes('--apply');
const p=new Pool({connectionString:require('./db-config').CONN,ssl:{rejectUnauthorized:false}});
const { auditedUpdateRow } = require('./db-audited'); // escrita auditada (2026-09-21)
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const LEVEL={PRICE_LEVEL_INEXPENSIVE:1,PRICE_LEVEL_MODERATE:2,PRICE_LEVEL_EXPENSIVE:3,PRICE_LEVEL_VERY_EXPENSIVE:4};

(async()=>{
  const rows=(await p.query(`SELECT restaurant_id,name,city,country,place_id FROM db_restaurants WHERE published AND price_range_id IS NULL AND place_id<>'' ORDER BY country,city`)).rows;
  console.log((APPLY?'APPLY':'DRY-RUN')+' — '+rows.length+' linhas\n');
  let tier4=0,byLevel=0,wrote=0; const bounded=[],none=[];
  for(const r of rows){
    let d={};
    try{ const {data}=await axios.get('https://places.googleapis.com/v1/places/'+r.place_id,
      {headers:{'X-Goog-Api-Key':KEY,'X-Goog-FieldMask':'priceLevel,priceRange'},timeout:12000}); d=data; }
    catch(e){ none.push({...r,err:true}); await sleep(110); continue; }
    let tier=null, why='';
    if(LEVEL[d.priceLevel]){ tier=LEVEL[d.priceLevel]; why=d.priceLevel; byLevel++; }
    else if(d.priceRange && !d.priceRange.endPrice && d.priceRange.startPrice){ tier=4; why='banda aberta no topo ('+d.priceRange.startPrice.units+' '+d.priceRange.startPrice.currencyCode+')'; tier4++; }
    else if(d.priceRange){ bounded.push({...r,sp:d.priceRange.startPrice,ep:d.priceRange.endPrice}); continue; }
    else { none.push(r); continue; }
    if(APPLY && tier){ const res=await auditedUpdateRow(p,{table:'db_restaurants',pk:'restaurant_id',id:r.restaurant_id,set:'price_range_id=$1, verification_source=$2',params:[tier,'places_v1_pricerange'],agent:'price_fill',reason:'faixa de preco via Places v1: '+why}); wrote+=res.rowCount; }
    await sleep(110);
  }
  console.log('Tier 4 por banda-aberta: '+tier4+' | por priceLevel: '+byLevel);
  console.log('Para BUSCA WEB -> faixa limitada: '+bounded.length+' | sem dado: '+none.length);
  console.log('\n--- FAIXA LIMITADA (web) ---');
  bounded.forEach(x=>console.log('  ['+x.restaurant_id+'] '+x.name+' — '+x.city+', '+x.country+'  '+(x.sp?x.sp.units+x.sp.currencyCode:'?')+'-'+(x.ep?x.ep.units+x.ep.currencyCode:'?')));
  console.log('\n--- SEM DADO (web) ---');
  none.forEach(x=>console.log('  ['+x.restaurant_id+'] '+x.name+' — '+x.city+', '+x.country+(x.err?' (erro api)':'')));
  if(APPLY) console.log('\n✔ GRAVADO: '+wrote);
  p.end();
})().catch(e=>{console.error('ERRO:',e.message);p.end();});
