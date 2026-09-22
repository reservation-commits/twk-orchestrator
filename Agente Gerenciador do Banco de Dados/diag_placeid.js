const fs=require('fs'),path=require('path');
const { Pool } = require('./twk-db-agent/node_modules/pg');
const axios = require('./twk-db-agent/node_modules/axios');
const env=fs.readFileSync(path.join(__dirname,'twk-db-agent','.env.local'),'utf8');
const KEY=(env.match(/GOOGLE_PLACES_API_KEY=(.+)/)||[])[1].trim();
const pool=new Pool({connectionString:require('./db-config').CONN,ssl:{rejectUnauthorized:false}});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const norm=s=>(s||'').toLowerCase().replace(/[^a-z0-9]/g,'');
(async()=>{
  const rows=(await pool.query(`SELECT restaurant_id,name,city,country,place_id,
      telephone_of_the_establishment tel,site_url FROM db_restaurants
    WHERE published AND place_id<>'' AND (telephone_of_the_establishment IS NULL OR telephone_of_the_establishment=''
      OR site_url IS NULL OR site_url='') ORDER BY country,city`)).rows;
  let stale=0,ok=0;
  for(const r of rows){
    let d;
    try{ const {data}=await axios.get('https://maps.googleapis.com/maps/api/place/details/json',
      {params:{place_id:r.place_id,fields:'name,formatted_phone_number,international_phone_number,website,business_status',key:KEY},timeout:12000}); d=data; }
    catch(e){ console.log(`  ! ${r.name}: ${e.message}`); await sleep(120); continue; }
    const rn=d.result?.name||'';
    const match = norm(rn).includes(norm(r.name).slice(0,8)) || norm(r.name).includes(norm(rn).slice(0,8));
    const phone=d.result?.international_phone_number||d.result?.formatted_phone_number||'';
    const site=d.result?.website||'';
    const flag = match?'ok':'STALE?';
    if(match)ok++; else stale++;
    console.log(`  [${flag}] DB="${r.name}" -> Places="${rn}" status=${d.status} bstat=${d.result?.business_status||'?'} ${phone?'TEL':'  '} ${site?'SITE':'    '}`);
    await sleep(120);
  }
  console.log(`\nplace_id batendo com o nome: ${ok} | possivelmente errado: ${stale}`);
  pool.end();
})().catch(e=>{console.error(e.message);pool.end();});
