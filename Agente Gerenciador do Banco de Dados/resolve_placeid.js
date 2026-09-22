// Re-resolve place_id ERRADO via Text Search e mostra proposta (dry-run; --apply grava).
const fs=require('fs'),path=require('path');
const { Pool } = require('./twk-db-agent/node_modules/pg');
const axios = require('./twk-db-agent/node_modules/axios');
const env=fs.readFileSync(path.join(__dirname,'twk-db-agent','.env.local'),'utf8');
const KEY=(env.match(/GOOGLE_PLACES_API_KEY=(.+)/)||[])[1].trim();
const APPLY=process.argv.includes('--apply');
const pool=new Pool({connectionString:require('./db-config').CONN,ssl:{rejectUnauthorized:false}});
const q=(s,p)=>pool.query(s,p);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const norm=s=>(s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9]/g,'');

// ids identificados como place_id errado no diagnóstico
const TARGETS=['28155','10492','32882']; // APROVADOS: Imperial, Opéra Plage, Al Rimal

async function textSearch(query){
  const {data}=await axios.get('https://maps.googleapis.com/maps/api/place/textsearch/json',
    {params:{query,type:'restaurant',key:KEY},timeout:12000});
  return data.results||[];
}
async function details(placeId){
  const {data}=await axios.get('https://maps.googleapis.com/maps/api/place/details/json',
    {params:{place_id:placeId,fields:'name,formatted_address,geometry,formatted_phone_number,international_phone_number,website,business_status,types',key:KEY},timeout:12000});
  return data.result||{};
}

(async()=>{
  const rows=(await q(`SELECT restaurant_id,name,city,country,place_id,latitude,longitude,
      telephone_of_the_establishment tel,site_url FROM db_restaurants
    WHERE restaurant_id = ANY($1)`,[TARGETS])).rows;
  for(const r of rows){
    const cands=await textSearch(`${r.name} ${r.city} ${r.country}`);
    // melhor candidato restaurante por similaridade de nome
    const nq=norm(r.name);
    let best=null,bestScore=0;
    for(const c of cands.slice(0,5)){
      const nc=norm(c.name);
      let score=0;
      if(nc===nq)score=100; else if(nc.includes(nq)||nq.includes(nc))score=80;
      else { const a=new Set(nq.match(/.{1,3}/g)||[]); let hit=0; (nc.match(/.{1,3}/g)||[]).forEach(t=>a.has(t)&&hit++); score=hit*5; }
      if((c.types||[]).includes('restaurant')||(c.types||[]).includes('food'))score+=10;
      if(score>bestScore){bestScore=score;best=c;}
    }
    console.log(`\n[${r.restaurant_id}] ${r.name} — ${r.city}, ${r.country}`);
    console.log(`  place_id atual: ${r.place_id}`);
    if(!best){console.log('  Nenhum candidato.');await sleep(300);continue;}
    const d=await details(best.place_id);
    const phone=d.international_phone_number||d.formatted_phone_number||'';
    console.log(`  CANDIDATO: "${best.name}" (score ${bestScore})`);
    console.log(`    endereço: ${d.formatted_address||best.formatted_address}`);
    console.log(`    novo place_id: ${best.place_id} ${best.place_id===r.place_id?'(IGUAL — sem mudança)':''}`);
    console.log(`    tel: ${phone||'(vazio)'} | site: ${d.website||'(vazio)'} | bstat: ${d.business_status||'?'}`);
    console.log(`    coords: ${best.geometry?.location?.lat},${best.geometry?.location?.lng}  (atual ${r.latitude},${r.longitude})`);
    const goodMatch = best.place_id!==r.place_id; // alvos já aprovados manualmente
    console.log(`    -> ${goodMatch?'PROPÕE CORRIGIR':'NÃO corrige automaticamente (revisar)'}`);

    if(APPLY && goodMatch){
      const sets=['place_id=$1'],vals=[best.place_id];
      if((!r.tel)&&phone){sets.push(`telephone_of_the_establishment=$${vals.length+1}`);vals.push(phone);}
      if((!r.site_url)&&d.website){sets.push(`site_url=$${vals.length+1}`);vals.push(d.website);}
      if(d.geometry?.location){sets.push(`latitude=$${vals.length+1}`);vals.push(d.geometry.location.lat);
        sets.push(`longitude=$${vals.length+1}`);vals.push(d.geometry.location.lng);
        sets.push(`coordinates=ST_SetSRID(ST_MakePoint($${vals.length+1},$${vals.length+2}),4326)`);vals.push(d.geometry.location.lng,d.geometry.location.lat);}
      sets.push('last_verified_at=now()'); sets.push(`verification_source='places_textsearch_reresolve'`);
      vals.push(r.restaurant_id);
      await q(`UPDATE db_restaurants SET ${sets.join(', ')} WHERE restaurant_id=$${vals.length}`,vals);
      console.log(`    ✔ GRAVADO`);
    }
    await sleep(300);
  }
  console.log(`\n${APPLY?'APPLY concluído':'DRY-RUN — nada gravado (rode com --apply)'}`);
  pool.end();
})().catch(e=>{console.error('ERRO:',e.message);pool.end();});
