// convert_hours.js — converte business_hours_json do formato google_places -> formato nativo
// [{day,intervals:[{open:"HH:MM",close:"HH:MM"}]}]. Determinístico, sem API. Dry-run; --apply grava.
const { Pool } = require('./twk-db-agent/node_modules/pg');
const APPLY = process.argv.includes('--apply');
const pool = new Pool({ connectionString: require('./db-config').CONN, ssl: { rejectUnauthorized: false } });
const q = (s, p) => pool.query(s, p);

const DAYS = ['mon','tue','wed','thu','fri','sat','sun'];
const GDAY = ['sun','mon','tue','wed','thu','fri','sat']; // google: 0=sun
const fmt = t => { const s=String(t).padStart(4,'0'); return s.slice(0,2)+':'+s.slice(2); };

function convert(bh){
  const periods = bh && bh.periods;
  if(!Array.isArray(periods) || periods.length===0) return null;
  // 24/7: um período, sem close, time 0000
  if(periods.length===1 && !periods[0].close && (periods[0].open?.time==='0000' || periods[0].open?.time===undefined)){
    return DAYS.map(d=>({day:d, intervals:[{open:'00:00', close:'23:59'}]}));
  }
  const map = Object.fromEntries(DAYS.map(d=>[d, []]));
  for(const per of periods){
    if(!per.open || per.open.day===undefined) continue;
    const day = GDAY[per.open.day];
    if(!day) continue;
    const open = fmt(per.open.time);
    const close = per.close ? fmt(per.close.time) : '23:59'; // sem close -> fecha tarde (flag)
    map[day].push({open, close});
  }
  return DAYS.map(d=>({day:d, intervals: map[d].sort((a,b)=>a.open.localeCompare(b.open)) }));
}

(async()=>{
  const rows=(await q(`SELECT restaurant_id, name, business_hours_json bh FROM db_restaurants
    WHERE published AND business_hours_json::text LIKE '%google_places%'`)).rows;
  console.log(`${APPLY?'APPLY':'DRY-RUN'} — ${rows.length} linhas google_places para converter\n`);
  let ok=0, skip=0, noClose=0;
  const samples=[];
  for(const r of rows){
    const bh = typeof r.bh==='string'? JSON.parse(r.bh): r.bh;
    const native = convert(bh);
    if(!native){ skip++; continue; }
    const hadNoClose = (bh.periods||[]).some(p=>p.open && !p.close);
    if(hadNoClose) noClose++;
    ok++;
    if(samples.length<3) samples.push({name:r.name, from:bh.periods, to:native});
    if(APPLY){
      await q(`UPDATE db_restaurants SET business_hours_json=$1::jsonb WHERE restaurant_id=$2`,
        [JSON.stringify(native), r.restaurant_id]);
    }
  }
  console.log('Amostras de conversão:');
  samples.forEach(s=>{
    console.log(`\n  ${s.name}`);
    console.log('   google:', JSON.stringify(s.from).slice(0,160));
    console.log('   nativo:', JSON.stringify(s.to).slice(0,260));
  });
  console.log(`\n=== RESUMO ===`);
  console.log(`Convertidas: ${ok} | sem periods (puladas): ${skip} | com período sem 'close' (24h/flag): ${noClose}`);
  console.log(APPLY?`✔ GRAVADO: ${ok}`:'(dry-run — nada gravado; rode com --apply)');
  pool.end();
})().catch(e=>{console.error('ERRO:',e.message);pool.end();});
