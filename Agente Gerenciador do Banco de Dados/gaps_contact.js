const { Pool } = require('./twk-db-agent/node_modules/pg');
const pool = new Pool({ connectionString: require('./db-config').CONN, ssl: { rejectUnauthorized: false } });
const q = (sql, p) => pool.query(sql, p);

(async () => {
  try {
    const T = 'db_restaurants';
    const noPhone = (await q(`SELECT restaurant_id, name, city, country, site_url, place_id
      FROM ${T} WHERE published AND (telephone_of_the_establishment IS NULL OR telephone_of_the_establishment='')
      ORDER BY country, city`)).rows;
    const noSite = (await q(`SELECT restaurant_id, name, city, country, telephone_of_the_establishment tel, place_id
      FROM ${T} WHERE published AND (site_url IS NULL OR site_url='')
      ORDER BY country, city`)).rows;

    console.log(`\n### SEM TELEFONE (publicadas): ${noPhone.length}`);
    noPhone.forEach(r => console.log(`  [${r.restaurant_id}] ${r.name} — ${r.city}, ${r.country} | site:${r.site_url?'sim':'NÃO'} | place_id:${r.place_id?'sim':'NÃO'}`));
    console.log(`\n### SEM SITE (publicadas): ${noSite.length}`);
    noSite.forEach(r => console.log(`  [${r.restaurant_id}] ${r.name} — ${r.city}, ${r.country} | tel:${r.tel?'sim':'NÃO'} | place_id:${r.place_id?'sim':'NÃO'}`));
    pool.end();
  } catch (e) { console.error('ERRO:', e.message); pool.end(); }
})();
