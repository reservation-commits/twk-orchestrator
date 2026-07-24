// PHASE 0 — READ-ONLY DATABASE AUDIT
// No INSERT/UPDATE/DELETE/ALTER. SELECT only.
import fs from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';

// Manual .env.local loader (project doesn't use dotenv)
const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
  }
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 4,
  statement_timeout: 60_000,
  query_timeout: 60_000,
});

// Hard guardrail: refuse anything that isn't SELECT/SHOW/EXPLAIN
async function safeQuery(sql, params) {
  const head = sql.trim().slice(0, 12).toUpperCase();
  if (!head.startsWith('SELECT') && !head.startsWith('SHOW') && !head.startsWith('WITH') && !head.startsWith('EXPLAIN')) {
    throw new Error(`Refusing non-read query: ${head}`);
  }
  return pool.query(sql, params);
}

const report = {
  meta: { generated_at: new Date().toISOString(), mode: 'READ-ONLY' },
  connection: {},
  schemas: [],
  tables: [],
  candidate_main_table: null,
  column_completeness: {},
  duplicates: {},
  consistency: {},
  enums_taxonomies: {},
};

try {
  // ---- 1. Connection test ----
  const ver = await safeQuery('SELECT version() AS v, current_database() AS db, current_user AS u');
  report.connection = {
    ok: true,
    database: ver.rows[0].db,
    user: ver.rows[0].u,
    version: ver.rows[0].v.split(' ').slice(0, 2).join(' '),
  };

  // ---- 2. Schemas & tables ----
  const tables = await safeQuery(`
    SELECT table_schema, table_name
    FROM information_schema.tables
    WHERE table_schema NOT IN ('pg_catalog','information_schema')
      AND table_type='BASE TABLE'
    ORDER BY table_schema, table_name
  `);
  report.schemas = [...new Set(tables.rows.map(r => r.table_schema))];

  for (const t of tables.rows) {
    const qname = `"${t.table_schema}"."${t.table_name}"`;
    const cols = await safeQuery(`
      SELECT column_name, data_type, udt_name, is_nullable, column_default, character_maximum_length
      FROM information_schema.columns
      WHERE table_schema=$1 AND table_name=$2
      ORDER BY ordinal_position
    `, [t.table_schema, t.table_name]);

    let rowCount = null;
    try {
      const c = await safeQuery(`SELECT COUNT(*)::int AS n FROM ${qname}`);
      rowCount = c.rows[0].n;
    } catch (e) { rowCount = `err:${e.code || e.message}`; }

    report.tables.push({
      schema: t.table_schema,
      name: t.table_name,
      qname,
      row_count: rowCount,
      column_count: cols.rows.length,
      columns: cols.rows,
    });
  }

  // ---- 3. Pick candidate main table (heuristic) ----
  const namesToTry = ['db_restaurants', 'restaurants', 'establishments', 'places', 'venues', 'restaurant', 'partners'];
  let main = null;
  for (const nm of namesToTry) {
    main = report.tables.find(t => t.schema === 'public' && t.name.toLowerCase() === nm);
    if (main) break;
  }
  report.candidate_main_table = main ? { schema: main.schema, name: main.name, row_count: main.row_count } : null;

  // ---- 4. Column completeness for main table ----
  if (main && typeof main.row_count === 'number' && main.row_count > 0) {
    const total = main.row_count;
    const completeness = [];
    for (const col of main.columns) {
      const cname = `"${col.column_name}"`;
      const dt = col.data_type;
      let nullsExpr = `${cname} IS NULL`;
      // Treat empty strings / empty arrays / empty jsonb as missing too
      if (['text','character varying','character'].includes(dt)) {
        nullsExpr = `(${cname} IS NULL OR length(btrim(${cname}))=0)`;
      } else if (dt === 'ARRAY') {
        nullsExpr = `(${cname} IS NULL OR array_length(${cname},1) IS NULL)`;
      } else if (dt === 'jsonb' || dt === 'json') {
        nullsExpr = `(${cname} IS NULL OR ${cname}::text IN ('null','{}','[]'))`;
      }
      try {
        const r = await safeQuery(`SELECT SUM(CASE WHEN ${nullsExpr} THEN 1 ELSE 0 END)::int AS miss FROM ${main.qname}`);
        const miss = r.rows[0].miss || 0;
        completeness.push({
          column: col.column_name,
          data_type: dt,
          nullable: col.is_nullable,
          missing: miss,
          present: total - miss,
          pct_complete: +(100 * (total - miss) / total).toFixed(2),
        });
      } catch (e) {
        completeness.push({ column: col.column_name, error: e.message });
      }
    }
    report.column_completeness = { table: main.name, total_rows: total, columns: completeness };
  }

  // ---- 5. Duplicates ----
  if (main && typeof main.row_count === 'number' && main.row_count > 0) {
    const colNames = main.columns.map(c => c.column_name);
    const dupChecks = [];
    const tryDup = async (cols, label) => {
      if (!cols.every(c => colNames.includes(c))) return;
      const select = cols.map(c => `"${c}"`).join(', ');
      try {
        const r = await safeQuery(`
          SELECT ${select}, COUNT(*)::int AS n FROM ${main.qname}
          WHERE ${cols.map(c => `"${c}" IS NOT NULL`).join(' AND ')}
          GROUP BY ${select} HAVING COUNT(*)>1
          ORDER BY n DESC LIMIT 25
        `);
        dupChecks.push({ key: label, duplicate_groups: r.rows.length, sample: r.rows.slice(0, 10) });
      } catch (e) {
        dupChecks.push({ key: label, error: e.message });
      }
    };
    await tryDup(['google_place_id'], 'google_place_id');
    await tryDup(['place_id'], 'place_id');
    await tryDup(['slug'], 'slug');
    await tryDup(['name','city'], 'name+city');
    await tryDup(['name','address'], 'name+address');
    report.duplicates = { table: main.name, checks: dupChecks };
  }

  // ---- 6. Consistency checks ----
  if (main) {
    const colNames = main.columns.map(c => c.column_name);
    const C = {};
    const tryQ = async (label, sql) => {
      try { const r = await safeQuery(sql); C[label] = r.rows[0]; }
      catch (e) { C[label] = { error: e.message }; }
    };
    if (colNames.includes('latitude') && colNames.includes('longitude')) {
      await tryQ('coords_missing_or_bad', `
        SELECT
          SUM(CASE WHEN latitude IS NULL OR longitude IS NULL THEN 1 ELSE 0 END)::int AS missing_coords,
          SUM(CASE WHEN latitude=0 AND longitude=0 THEN 1 ELSE 0 END)::int AS zero_coords,
          SUM(CASE WHEN latitude NOT BETWEEN -90 AND 90 OR longitude NOT BETWEEN -180 AND 180 THEN 1 ELSE 0 END)::int AS out_of_range
        FROM ${main.qname}`);
    }
    if (colNames.includes('phone')) {
      await tryQ('phone_format', `
        SELECT
          SUM(CASE WHEN phone IS NULL OR length(btrim(phone))=0 THEN 1 ELSE 0 END)::int AS missing,
          SUM(CASE WHEN phone IS NOT NULL AND phone !~ '^\\+[0-9 .()\\-]{6,}$' THEN 1 ELSE 0 END)::int AS not_e164ish
        FROM ${main.qname}`);
    }
    if (colNames.includes('website')) {
      await tryQ('website_format', `
        SELECT
          SUM(CASE WHEN website IS NULL OR length(btrim(website))=0 THEN 1 ELSE 0 END)::int AS missing,
          SUM(CASE WHEN website IS NOT NULL AND website !~* '^https?://' THEN 1 ELSE 0 END)::int AS not_url
        FROM ${main.qname}`);
    }
    if (colNames.includes('email')) {
      await tryQ('email_format', `
        SELECT
          SUM(CASE WHEN email IS NULL OR length(btrim(email))=0 THEN 1 ELSE 0 END)::int AS missing,
          SUM(CASE WHEN email IS NOT NULL AND email !~* '^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$' THEN 1 ELSE 0 END)::int AS not_email
        FROM ${main.qname}`);
    }
    if (colNames.includes('city')) {
      await tryQ('city_distribution', `
        SELECT city, COUNT(*)::int AS n FROM ${main.qname}
        GROUP BY city ORDER BY n DESC LIMIT 20`);
    }
    if (colNames.includes('country')) {
      await tryQ('country_distribution', `
        SELECT country, COUNT(*)::int AS n FROM ${main.qname}
        GROUP BY country ORDER BY n DESC LIMIT 20`);
    }
    if (colNames.includes('status')) {
      await tryQ('status_distribution', `
        SELECT status, COUNT(*)::int AS n FROM ${main.qname}
        GROUP BY status ORDER BY n DESC`);
    }
    if (colNames.includes('michelin_stars')) {
      await tryQ('michelin_distribution', `
        SELECT michelin_stars, COUNT(*)::int AS n FROM ${main.qname}
        GROUP BY michelin_stars ORDER BY michelin_stars NULLS LAST`);
    }
    if (colNames.includes('price_tier') || colNames.includes('price_level')) {
      const c = colNames.includes('price_tier') ? 'price_tier' : 'price_level';
      await tryQ('price_distribution', `
        SELECT ${c}, COUNT(*)::int AS n FROM ${main.qname}
        GROUP BY ${c} ORDER BY n DESC LIMIT 30`);
    }
    report.consistency = { table: main.name, checks: C };
  }

  // ---- 7. Output ----
  const outDir = path.resolve(process.cwd(), 'audit-output');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, 'phase0-audit.json');
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2));
  console.log(`OK -> ${outFile}`);
  console.log(`Tables: ${report.tables.length} | Main table: ${report.candidate_main_table?.name} (${report.candidate_main_table?.row_count} rows)`);
} catch (err) {
  report.connection.ok = false;
  report.connection.error = err.message;
  const outDir = path.resolve(process.cwd(), 'audit-output');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'phase0-audit.json'), JSON.stringify(report, null, 2));
  console.error('FAIL:', err.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
