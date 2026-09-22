const { Pool } = require('./twk-db-agent/node_modules/pg');
const pool = new Pool({ connectionString: require('./db-config').CONN, ssl: { rejectUnauthorized: false } });

const q = (sql, p) => pool.query(sql, p);
const pct = (n, total) => total ? `${(100 * n / total).toFixed(1)}%` : '—';

(async () => {
  try {
    const T = 'db_restaurants';
    const tot = (await q(`SELECT COUNT(*) c, COUNT(*) FILTER (WHERE published) p FROM ${T}`)).rows[0];
    const N = +tot.c, P = +tot.p;
    console.log('================ AUDITORIA db_restaurants ================');
    console.log(`Total de linhas: ${N}  |  publicadas: ${P}  |  não publicadas: ${N - P}\n`);

    // --- missing fields: overall + among published ---
    const emptyText = (col) => `COUNT(*) FILTER (WHERE ${col} IS NULL OR ${col}::text = '')`;
    const emptyNull = (col) => `COUNT(*) FILTER (WHERE ${col} IS NULL)`;
    const fields = [
      ['email_for_reservations', emptyText], ['telephone_of_the_establishment', emptyText],
      ['site_url', emptyText], ['address_of_establishment', emptyText], ['city', emptyText],
      ['country', emptyText], ['latitude', emptyNull], ['longitude', emptyNull],
      ['coordinates', emptyNull], ['place_id', emptyText], ['price_range_id', emptyNull],
      ['establishment_type', emptyText], ['restaurant_category', emptyText],
      ['city_id', emptyNull], ['country_id', emptyNull], ['michelin_id', emptyNull],
      ['about_text', emptyText], ['business_hours_json', emptyNull], ['logo_url', emptyText],
      ['images_json', emptyNull], ['chef_name', emptyText], ['timezone', emptyText],
      ['country_code', emptyText],
    ];
    const selOverall = fields.map(([c, f], i) => `${f(c)} AS f${i}`).join(', ');
    const selPub = fields.map(([c, f], i) => `${f(c)} FILTER (WHERE published) AS f${i}`).join(', ');
    // emptyText with FILTER published needs combining; redo with explicit
    const ov = (await q(`SELECT ${selOverall} FROM ${T}`)).rows[0];
    const pubRows = (await q(`SELECT ${fields.map(([c,f],i)=>{
      const cond = f===emptyText ? `(${c} IS NULL OR ${c}::text='')` : `${c} IS NULL`;
      return `COUNT(*) FILTER (WHERE published AND ${cond}) AS f${i}`;
    }).join(', ')} FROM ${T}`)).rows[0];

    console.log('───── Campos faltantes (vazios/nulos) ─────');
    console.log('campo'.padEnd(34), 'TOTAL'.padStart(12), 'PUBLICADAS'.padStart(14));
    fields.forEach(([c], i) => {
      console.log(c.padEnd(34), `${ov['f'+i]} (${pct(ov['f'+i],N)})`.padStart(12),
        `${pubRows['f'+i]} (${pct(pubRows['f'+i],P)})`.padStart(14));
    });

    // --- consistency / validity ---
    console.log('\n───── Inconsistências ─────');
    const coordMismatch = (await q(`SELECT COUNT(*) c FROM ${T} WHERE (latitude IS NOT NULL AND coordinates IS NULL) OR (latitude IS NULL AND coordinates IS NOT NULL)`)).rows[0].c;
    console.log('lat/long presente mas coordinates ausente (ou vice-versa):', coordMismatch);
    const noGeoButPub = (await q(`SELECT COUNT(*) c FROM ${T} WHERE published AND (latitude IS NULL OR longitude IS NULL)`)).rows[0].c;
    console.log('publicadas sem geolocalização:', noGeoButPub);

    // --- duplicates ---
    console.log('\n───── Duplicatas ─────');
    const dupEmail = (await q(`SELECT COUNT(*) grupos, COALESCE(SUM(c),0) linhas FROM (SELECT lower(email_for_reservations) e, COUNT(*) c FROM ${T} WHERE email_for_reservations<>'' AND email_for_reservations IS NOT NULL GROUP BY 1 HAVING COUNT(*)>1) x`)).rows[0];
    console.log(`emails compartilhados por >1 estabelecimento: ${dupEmail.grupos} emails cobrindo ${dupEmail.linhas} linhas`);
    const dupPlace = (await q(`SELECT COUNT(*) c FROM (SELECT place_id FROM ${T} WHERE place_id IS NOT NULL AND place_id<>'' GROUP BY 1 HAVING COUNT(*)>1) x`)).rows[0].c;
    console.log('place_id duplicados:', dupPlace);
    const dupNameCity = (await q(`SELECT COUNT(*) c FROM (SELECT lower(name) n, lower(city) ci, COUNT(*) k FROM ${T} GROUP BY 1,2 HAVING COUNT(*)>1) x`)).rows[0].c;
    console.log('possíveis duplicatas (mesmo nome+cidade):', dupNameCity);
    const dupSlug = (await q(`SELECT COUNT(*) c FROM (SELECT slug FROM ${T} WHERE slug IS NOT NULL GROUP BY 1 HAVING COUNT(*)>1) x`)).rows[0].c;
    console.log('slugs duplicados (deve ser 0):', dupSlug);

    // --- distributions ---
    console.log('\n───── Distribuições ─────');
    const opstat = (await q(`SELECT operational_status s, COUNT(*) c FROM ${T} GROUP BY 1 ORDER BY c DESC`)).rows;
    console.log('operational_status:', opstat.map(r => `${r.s}=${r.c}`).join(', '));
    const conf = (await q(`SELECT COALESCE(confidence_level,'(nulo)') l, COUNT(*) c FROM ${T} GROUP BY 1 ORDER BY c DESC`)).rows;
    console.log('confidence_level:', conf.map(r => `${r.l}=${r.c}`).join(', '));
    const verified = (await q(`SELECT COUNT(*) c FROM ${T} WHERE last_verified_at IS NOT NULL`)).rows[0].c;
    console.log(`com last_verified_at: ${verified} (${pct(verified,N)})`);

    // --- top countries with most published-but-incomplete ---
    console.log('\n───── Publicadas incompletas por país (faltando email/telefone/site/geo) ─────');
    const incPub = (await q(`
      SELECT country, COUNT(*) c FROM ${T}
      WHERE published AND (
        email_for_reservations IS NULL OR email_for_reservations='' OR
        telephone_of_the_establishment IS NULL OR telephone_of_the_establishment='' OR
        site_url IS NULL OR site_url='' OR latitude IS NULL)
      GROUP BY country ORDER BY c DESC LIMIT 12`)).rows;
    incPub.forEach(r => console.log('  ', String(r.c).padStart(5), r.country));

    pool.end();
  } catch (e) { console.error('ERRO:', e.message); pool.end(); }
})();
