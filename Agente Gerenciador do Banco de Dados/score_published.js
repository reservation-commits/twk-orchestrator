const { Pool } = require('./twk-db-agent/node_modules/pg');
const pool = new Pool({ connectionString: require('./db-config').CONN, ssl: { rejectUnauthorized: false } });
const q = (sql, p) => pool.query(sql, p);
const pct = (n, t) => t ? (100 * n / t) : 0;

(async () => {
  try {
    const T = 'db_restaurants';
    const P = +(await q(`SELECT COUNT(*) c FROM ${T} WHERE published`)).rows[0].c;

    // completeness of each core field among published
    const txt = c => `(${c} IS NULL OR ${c}::text='')`;
    const nul = c => `${c} IS NULL`;
    const fields = [
      ['name', txt, 5], ['email_for_reservations', txt, 12], ['telephone_of_the_establishment', txt, 6],
      ['site_url', txt, 6], ['address_of_establishment', txt, 5], ['city', txt, 4], ['country', txt, 4],
      ['latitude', nul, 4], ['coordinates', nul, 3], ['place_id', txt, 3], ['price_range_id', nul, 5],
      ['establishment_type', txt, 5], ['restaurant_category', txt, 5], ['about_text', txt, 6],
      ['city_id', nul, 3], ['country_id', nul, 3], ['timezone', txt, 2], ['country_code', txt, 2],
      ['logo_url', txt, 4], ['images_json', nul, 4], ['michelin_id', nul, 2], ['chef_name', txt, 2],
      ['business_hours_json', nul, 3],
    ];
    const sel = fields.map(([c, f], i) => `COUNT(*) FILTER (WHERE published AND NOT ${f(c)}) f${i}`).join(', ');
    const r = (await q(`SELECT ${sel} FROM ${T}`)).rows[0];

    console.log(`\n=== ESTABELECIMENTOS PUBLICADOS: ${P} ===\n`);
    console.log('Campo'.padEnd(34), 'Preenchido', '  Peso');
    let gained = 0, totalW = 0;
    const rows = fields.map(([c,,w], i) => {
      const filled = +r['f'+i]; const p = pct(filled, P);
      gained += (p/100) * w; totalW += w;
      return { c, p, w };
    });
    rows.sort((a,b)=>a.p-b.p).forEach(({c,p,w}) => {
      const bar = '█'.repeat(Math.round(p/5)).padEnd(20,'░');
      console.log(c.padEnd(34), bar, `${p.toFixed(1)}%`.padStart(6), `(p${w})`);
    });

    // integrity / freshness signals
    const closedPub = +(await q(`SELECT COUNT(*) c FROM ${T} WHERE published AND operational_status IN ('closed_temporarily','closed_permanently')`)).rows[0].c;
    const noGeoPub = +(await q(`SELECT COUNT(*) c FROM ${T} WHERE published AND latitude IS NULL`)).rows[0].c;
    const dupEmail = (await q(`SELECT COALESCE(SUM(c),0) lines FROM (SELECT lower(email_for_reservations) e, COUNT(*) c FROM ${T} WHERE published AND email_for_reservations<>'' AND email_for_reservations IS NOT NULL GROUP BY 1 HAVING COUNT(*)>1) x`)).rows[0].lines;
    const verified = +(await q(`SELECT COUNT(*) c FROM ${T} WHERE published AND last_verified_at IS NOT NULL`)).rows[0].c;

    const completeness = 100 * gained / totalW;
    // integrity penalty
    const integrityScore = 100
      - Math.min(20, pct(closedPub, P) * 4)
      - Math.min(15, pct(noGeoPub, P) * 2)
      - Math.min(10, pct(+dupEmail, P));
    const finalScore = completeness * 0.75 + integrityScore * 0.25;

    console.log(`\n--- Sinais de integridade (publicadas) ---`);
    console.log('Publicadas fechadas (temp/perm):', closedPub);
    console.log('Publicadas sem geolocalização:', noGeoPub);
    console.log('Linhas com email compartilhado:', dupEmail);
    console.log(`Com last_verified_at: ${verified} (${pct(verified,P).toFixed(1)}%)`);

    console.log(`\n========================================`);
    console.log(`Completude (média ponderada): ${completeness.toFixed(1)}%`);
    console.log(`Integridade: ${integrityScore.toFixed(1)}%`);
    console.log(`NOTA FINAL: ${(finalScore/10).toFixed(1)} / 10`);
    console.log(`========================================`);
    pool.end();
  } catch (e) { console.error('ERRO:', e.message); pool.end(); }
})();
