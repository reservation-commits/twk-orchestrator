// Levanta priceLevel/priceRange (Places API v1) dos publicados sem price_range_id. Dry-run; --apply grava só os priceLevel (autoritativo).
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
  console.log((APPLY?'APPLY':'DRY-RUN')+' — '+rows.length+' publicados sem price_range_id\n');
  let withLevel=0, withRange=0, none=0, wrote=0;
  const rangeRows=[];
  for(const r of rows){
    let d={};
    try{ const {data}=await axios.get('https://places.googleapis.com/v1/places/'+r.place_id,
      {headers:{'X-Goog-Api-Key':KEY,'X-Goog-FieldMask':'priceLevel,priceRange'},timeout:12000}); d=data; }
    catch(e){ console.log('  ! '+r.name+' ERRO '+(e.response?.status||e.code)); await sleep(120); continue; }
    const lvl=LEVEL[d.priceLevel];
    if(lvl){ withLevel++;
      console.log('  [tier '+lvl+'] '+r.name+' ('+r.city+') <- '+d.priceLevel);
      if(APPLY){ const res=await auditedUpdateRow(p,{table:'db_restaurants',pk:'restaurant_id',id:r.restaurant_id,set:'price_range_id=$1',params:[lvl],agent:'price_v1_probe',reason:'priceLevel autoritativo do Places v1: '+d.priceLevel}); wrote+=res.rowCount; }
    } else if(d.priceRange){ withRange++; const sp=d.priceRange.startPrice, ep=d.priceRange.endPrice;
      rangeRows.push({id:r.restaurant_id,name:r.name,city:r.city,country:r.country,sp,ep});
    } else { none++; }
    await sleep(120);
  }
  console.log('\n=== priceLevel (autoritativo): '+withLevel+' | só priceRange: '+withRange+' | nada: '+none+' ===');
  if(rangeRows.length){ console.log('\n--- priceRange (sinal secundário, requer regra) ---');
    rangeRows.forEach(x=>console.log('  '+x.name+' ('+x.city+', '+x.country+'): '+(x.sp?x.sp.units+' '+x.sp.currencyCode:'?')+' - '+(x.ep?x.ep.units+' '+x.ep.currencyCode:'?'))); }
  if(APPLY) console.log('\nGRAVADO (priceLevel): '+wrote);
  p.end();
})().catch(e=>{console.error('ERRO:',e.message);p.end();});
