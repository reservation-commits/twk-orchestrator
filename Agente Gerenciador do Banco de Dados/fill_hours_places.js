// fill_hours_places.js — preenche business_hours_json (formato NATIVO) das publicadas
// sem horário real, buscando opening_hours no Google Place Details. Dry-run; --apply grava.
const fs=require('fs'),path=require('path');
const { Pool } = require('./twk-db-agent/node_modules/pg');
const axios = require('./twk-db-agent/node_modules/axios');
const env=fs.readFileSync(path.join(__dirname,'twk-db-agent','.env.local'),'utf8');
const KEY=(env.match(/GOOGLE_PLACES_API_KEY=(.+)/)||[])[1].trim();
const APPLY=process.argv.includes('--apply');
const pool=new Pool({connectionString:require('./db-config').CONN,ssl:{rejectUnauthorized:false}});
const q=(s,p)=>pool.query(s,p);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

const DAYS=['mon','tue','wed','thu','fri','sat','sun'];
const GDAY=['sun','mon','tue','wed','thu','fri','sat'];
const fmt=t=>{const s=String(t).padStart(4,'0');return s.slice(0,2)+':'+s.slice(2);};
function convert(periods){
  if(!Array.isArray(periods)||periods.length===0)return null;
  if(periods.length===1 && !periods[0].close && (periods[0].open?.time==='0000'||periods[0].open?.time===undefined))
    return DAYS.map(d=>({day:d,intervals:[{open:'00:00',close:'23:59'}]}));
  const map=Object.fromEntries(DAYS.map(d=>[d,[]]));
  for(const per of periods){
    if(!per.open||per.open.day===undefined)continue;
    const day=GDAY[per.open.day]; if(!day)continue;
    map[day].push({open:fmt(per.open.time),close:per.close?fmt(per.close.time):'23:59'});
  }
  const native=DAYS.map(d=>({day:d,intervals:map[d].sort((a,b)=>a.open.localeCompare(b.open))}));
  return native.some(x=>x.intervals.length)?native:null; // descarta se vazio total
}
async function placeHours(placeId){
  const {data}=await axios.get('https://maps.googleapis.com/maps/api/place/details/json',
    {params:{place_id:placeId,fields:'opening_hours',key:KEY},timeout:12000});
  if(data.status!=='OK')return {status:data.status,periods:null};
  return {status:'OK',periods:data.result?.opening_hours?.periods||null};
}

(async()=>{
  // publicadas sem horário REAL (null ou esqueleto vazio), com place_id
  const rows=(await q(`SELECT restaurant_id,name,place_id FROM db_restaurants
    WHERE published AND place_id IS NOT NULL AND place_id<>''
      AND (business_hours_json IS NULL OR business_hours_json::text !~ '[0-9]{2}:[0-9]{2}')
    ORDER BY name`)).rows;
  console.log(`${APPLY?'APPLY':'DRY-RUN'} — ${rows.length} publicadas sem horário real para consultar no Places\n`);
  let filled=0,noHours=0,apiErr=0;
  for(const r of rows){
    let res; try{ res=await placeHours(r.place_id); }catch(e){ apiErr++; await sleep(150); continue; }
    if(res.status!=='OK'){ apiErr++; await sleep(150); continue; }
    const native=convert(res.periods);
    if(!native){ noHours++; await sleep(120); continue; }
    filled++;
    if(filled<=3) console.log(`  ex [${r.restaurant_id}] ${r.name}: ${JSON.stringify(native).slice(0,180)}`);
    if(APPLY) await q(`UPDATE db_restaurants SET business_hours_json=$1::jsonb, last_verified_at=now() WHERE restaurant_id=$2`,[JSON.stringify(native),r.restaurant_id]);
    await sleep(120);
  }
  console.log(`\n=== RESUMO ===\nConsultadas: ${rows.length} | com horário no Places: ${filled} | sem horário: ${noHours} | erros API: ${apiErr}`);
  console.log(APPLY?`✔ GRAVADO: ${filled}`:'(dry-run — nada gravado; rode com --apply)');
  pool.end();
})().catch(e=>{console.error('ERRO:',e.message);pool.end();});
