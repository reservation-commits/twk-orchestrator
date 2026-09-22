const fs=require('fs'),path=require('path');
const { Pool } = require('./twk-db-agent/node_modules/pg');
const axios = require('./twk-db-agent/node_modules/axios');
const env=fs.readFileSync(path.join(__dirname,'twk-db-agent','.env.local'),'utf8');
const KEY=(env.match(/GOOGLE_PLACES_API_KEY=(.+)/)||[])[1].trim();
const pool=new Pool({connectionString:require('./db-config').CONN,ssl:{rejectUnauthorized:false}});
const { auditedUpdateRow } = require('./db-audited');
const PLACE_ID='ChIJbaco8qLazRIR8kZN9VPvbzY'; // Plage de l'Opéra (aprovado)
const APPLY=process.argv.includes('--apply');
(async()=>{
  const {data}=await axios.get('https://maps.googleapis.com/maps/api/place/details/json',
    {params:{place_id:PLACE_ID,fields:'name,formatted_address,geometry,formatted_phone_number,international_phone_number,website,business_status',key:KEY},timeout:12000});
  const d=data.result||{};
  const phone=d.international_phone_number||d.formatted_phone_number||'';
  console.log(`Place: "${d.name}" — ${d.formatted_address}`);
  console.log(`tel=${phone} | site=${d.website} | coords=${d.geometry?.location?.lat},${d.geometry?.location?.lng} | bstat=${d.business_status}`);
  // sanity: precisa ser o "Plage de l'Opéra" / site operaplage
  const okName=/op[ée]ra/i.test(d.name||'') || /operaplage/i.test(d.website||'');
  if(!okName){console.log('ABORTADO: candidato não confere com OPÉRA PLAGE');pool.end();return;}
  if(APPLY){
    const lat=d.geometry.location.lat,lng=d.geometry.location.lng;
    // Escrita auditada (2026-09-21): old_data + agent_audit_log na mesma transação.
    const res = await auditedUpdateRow(pool, {
      table: 'db_restaurants', pk: 'restaurant_id', id: '10492',
      set: `place_id=$1, telephone_of_the_establishment=$2, site_url=$3, latitude=$4::float8, longitude=$5::float8,
            coordinates=ST_SetSRID(ST_MakePoint($5::float8,$4::float8),4326),
            last_verified_at=now(), verification_source='places_textsearch_reresolve'`,
      params: [PLACE_ID, phone, d.website, lat, lng],
      agent: 'fix_opera', reason: 're-resolucao do place_id do Opera Plage (aprovado)',
    });
    console.log(res.rowCount ? '✔ OPÉRA PLAGE regravado corretamente (auditado).' : 'nada gravado: restaurante 10492 não encontrado');
  } else console.log('(dry-run — rode com --apply)');
  pool.end();
})().catch(e=>{console.error('ERRO:',e.message);pool.end();});
