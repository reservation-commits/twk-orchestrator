const { Pool } = require('./twk-db-agent/node_modules/pg');
const pool = new Pool({ connectionString: require('./db-config').CONN, ssl: { rejectUnauthorized: false } });

(async () => {
  const client = await pool.connect();
  try {
    const base = 'https://theworldkeys.com/hospitality/';
    const logEntry = JSON.stringify([{
      field: 'url_page_twk',
      action: 'backfilled_from_slug',
      pattern: base + '{slug}/',
      at: new Date().toISOString(),
    }]);

    const before = +(await client.query(`SELECT COUNT(*) c FROM db_restaurants WHERE published AND url_page_twk IS NOT NULL AND url_page_twk<>''`)).rows[0].c;

    await client.query('BEGIN');
    const res = await client.query(
      `UPDATE db_restaurants
         SET url_page_twk = $1 || slug || '/',
             enrichment_log = COALESCE(enrichment_log,'[]'::jsonb) || $2::jsonb
       WHERE published
         AND (url_page_twk IS NULL OR url_page_twk = '')
         AND slug IS NOT NULL AND slug <> ''
       RETURNING restaurant_id`,
      [base, logEntry]
    );
    await client.query('COMMIT');

    const after = +(await client.query(`SELECT COUNT(*) c FROM db_restaurants WHERE published AND url_page_twk IS NOT NULL AND url_page_twk<>''`)).rows[0].c;
    const total = +(await client.query(`SELECT COUNT(*) c FROM db_restaurants WHERE published`)).rows[0].c;
    const stillEmpty = +(await client.query(`SELECT COUNT(*) c FROM db_restaurants WHERE published AND (url_page_twk IS NULL OR url_page_twk='')`)).rows[0].c;

    console.log(`Linhas atualizadas: ${res.rowCount}`);
    console.log(`url_page_twk preenchidas (publicados): ${before} -> ${after} de ${total}`);
    console.log(`Publicados ainda sem url_page_twk: ${stillEmpty}`);

    const c = (await client.query(`SELECT name, slug, url_page_twk FROM db_restaurants WHERE slug='contraste-milano'`)).rows[0];
    console.log('\nContraste agora:', JSON.stringify(c));

    console.log('\nAmostra de recém-preenchidos:');
    (await client.query(`SELECT name, url_page_twk FROM db_restaurants WHERE published AND restaurant_id = ANY($1) LIMIT 5`, [res.rows.map(r=>r.restaurant_id)])).rows
      .forEach(r => console.log('  ', String(r.name).slice(0,28).padEnd(29), r.url_page_twk));
  } catch (e) {
    await client.query('ROLLBACK').catch(()=>{});
    console.error('ERRO (rollback):', e.message);
  } finally {
    client.release(); pool.end();
  }
})();
