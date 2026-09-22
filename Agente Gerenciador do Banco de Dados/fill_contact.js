// Preenche telephone/site_url de publicadas via Google Place Details (API legada).
// Dry-run por padrão; passe --apply para gravar.
const fs = require('fs');
const path = require('path');
const { Pool } = require('./twk-db-agent/node_modules/pg');
const axios = require('./twk-db-agent/node_modules/axios');

const env = fs.readFileSync(path.join(__dirname, 'twk-db-agent', '.env.local'), 'utf8');
const KEY = (env.match(/GOOGLE_PLACES_API_KEY=(.+)/) || [])[1].trim();
const APPLY = process.argv.includes('--apply');

const pool = new Pool({ connectionString: require('./db-config').CONN, ssl: { rejectUnauthorized: false } });
const q = (sql, p) => pool.query(sql, p);
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function details(placeId) {
  const fields = 'name,formatted_phone_number,international_phone_number,website,business_status';
  const { data } = await axios.get('https://maps.googleapis.com/maps/api/place/details/json', {
    params: { place_id: placeId, fields, key: KEY }, timeout: 12000,
  });
  return { status: data.status, r: data.result || {} };
}

(async () => {
  try {
    const T = 'db_restaurants';
    const rows = (await q(`SELECT restaurant_id, name, city, country, place_id,
        telephone_of_the_establishment tel, site_url
      FROM ${T} WHERE published AND place_id IS NOT NULL AND place_id<>'' AND (
        telephone_of_the_establishment IS NULL OR telephone_of_the_establishment='' OR
        site_url IS NULL OR site_url='') ORDER BY country, city`)).rows;

    console.log(`${APPLY ? 'APPLY' : 'DRY-RUN'} — ${rows.length} linhas para consultar no Places\n`);
    let phoneFound = 0, siteFound = 0, phoneWrote = 0, siteWrote = 0, apiErr = 0;

    for (const row of rows) {
      let res;
      try { res = await details(row.place_id); }
      catch (e) { console.log(`  ! API erro [${row.restaurant_id}] ${row.name}: ${e.message}`); apiErr++; await sleep(200); continue; }
      if (res.status !== 'OK') { console.log(`  ! ${res.status} [${row.restaurant_id}] ${row.name}`); apiErr++; await sleep(200); continue; }

      const needPhone = !row.tel;
      const needSite = !row.site_url;
      const phone = res.r.international_phone_number || res.r.formatted_phone_number || null;
      const site = res.r.website || null;
      const sets = [], vals = [], log = [];

      if (needPhone && phone) { phoneFound++; sets.push(`telephone_of_the_establishment=$${vals.length+1}`); vals.push(phone); log.push(`tel="${phone}"`); }
      if (needSite && site) { siteFound++; sets.push(`site_url=$${vals.length+1}`); vals.push(site); log.push(`site="${site}"`); }

      const flags = [];
      if (needPhone) flags.push(phone ? `TEL✓ ${phone}` : 'tel✗');
      if (needSite) flags.push(site ? `SITE✓ ${site}` : 'site✗');
      console.log(`  [${row.restaurant_id}] ${row.name} (${row.city}) — ${flags.join(' | ')}`);

      if (APPLY && sets.length) {
        vals.push(row.restaurant_id);
        await q(`UPDATE ${T} SET ${sets.join(', ')}, last_verified_at=now(),
          verification_source='google_places_details' WHERE restaurant_id=$${vals.length}`, vals);
        if (needPhone && phone) phoneWrote++;
        if (needSite && site) siteWrote++;
      }
      await sleep(150);
    }

    console.log(`\n=== RESUMO ===`);
    console.log(`Telefone encontrado no Places: ${phoneFound}`);
    console.log(`Site encontrado no Places: ${siteFound}`);
    console.log(`Erros de API: ${apiErr}`);
    if (APPLY) console.log(`GRAVADO -> telefones: ${phoneWrote}, sites: ${siteWrote}`);
    else console.log(`(dry-run — nada gravado; rode com --apply para gravar)`);
    pool.end();
  } catch (e) { console.error('ERRO:', e.message); pool.end(); }
})();
