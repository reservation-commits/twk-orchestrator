const fs = require('fs'); const path = require('path');
const { Pool } = require('./twk-db-agent/node_modules/pg');
const axios = require('./twk-db-agent/node_modules/axios');
const env = fs.readFileSync(path.join(__dirname,'twk-db-agent','.env.local'),'utf8');
const KEY = (env.match(/GOOGLE_PLACES_API_KEY=(.+)/)||[])[1].trim();
const pool = new Pool({ connectionString: require('./db-config').CONN, ssl:{rejectUnauthorized:false} });
(async () => {
  // pick 3 published rows that ALREADY have phone+site
  const rows = (await pool.query(`SELECT restaurant_id,name,place_id,telephone_of_the_establishment tel,site_url
    FROM db_restaurants WHERE published AND telephone_of_the_establishment<>'' AND site_url<>'' AND place_id<>'' LIMIT 3`)).rows;
  for (const r of rows) {
    const { data } = await axios.get('https://maps.googleapis.com/maps/api/place/details/json',
      { params:{ place_id:r.place_id, fields:'name,formatted_phone_number,international_phone_number,website', key:KEY }, timeout:12000 });
    console.log(`\n${r.name} [${r.restaurant_id}]`);
    console.log(`  DB    tel=${r.tel} | site=${r.site_url}`);
    console.log(`  Places status=${data.status}`);
    console.log(`  Places phone=${data.result?.international_phone_number||data.result?.formatted_phone_number||'(vazio)'} | website=${data.result?.website||'(vazio)'}`);
  }
  pool.end();
})().catch(e=>{console.error(e.message);pool.end();});
