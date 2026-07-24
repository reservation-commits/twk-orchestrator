// DRY-RUN: roda cada migration dentro de BEGIN ... ROLLBACK.
// Nada é gravado. Captura o tempo de execução e qualquer erro.
import fs from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';

const envPath = path.resolve(process.cwd(), '.env.local');
for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// Files in order
const dir = 'audit-output/migrations';
const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort();

// Strip leading BEGIN; / trailing COMMIT; (case-insensitive, on lines by themselves)
// and strip the DOWN block (everything after the standalone "-- DOWN" marker section).
function prepareSql(raw) {
  // Cut off the "DOWN" reversal block — only execute the forward path.
  // The DOWN section in our files starts with `-- DOWN` inside a comment header.
  const downMarker = /\n-- =+\s*\n-- DOWN/i;
  const sliced = raw.split(downMarker)[0];

  return sliced
    .replace(/^\s*BEGIN\s*;\s*$/gim, '-- BEGIN stripped for dry-run')
    .replace(/^\s*COMMIT\s*;\s*$/gim, '-- COMMIT stripped for dry-run');
}

const results = [];
for (const file of files) {
  const fullPath = path.join(dir, file);
  const raw = fs.readFileSync(fullPath, 'utf8');
  const sql = prepareSql(raw);

  const client = await pool.connect();
  const t0 = Date.now();
  let outcome = { file, status: 'ok', error: null, ms: 0, notices: [] };

  // Capture NOTICE messages (some migrations emit them deliberately)
  client.on('notice', n => outcome.notices.push(n.message));

  try {
    await client.query('BEGIN');
    // Set a safety guard: timeout per statement
    await client.query("SET LOCAL statement_timeout = '60s'");
    await client.query(sql);
    // Always rollback — this is a simulation
    await client.query('ROLLBACK');
    outcome.ms = Date.now() - t0;
    console.log(`OK    ${file}  (${outcome.ms}ms)`);
    if (outcome.notices.length) {
      for (const n of outcome.notices) console.log(`        notice: ${n}`);
    }
  } catch (e) {
    outcome.status = 'fail';
    outcome.error = { message: e.message, code: e.code, position: e.position, where: e.where };
    outcome.ms = Date.now() - t0;
    try { await client.query('ROLLBACK'); } catch {}
    console.log(`FAIL  ${file}  (${outcome.ms}ms): ${e.message}`);
  } finally {
    client.release();
    results.push(outcome);
  }
}

fs.writeFileSync('audit-output/dry-run-results.json', JSON.stringify(results, null, 2));
const allOk = results.every(r => r.status === 'ok');
console.log(`\nResumo: ${results.filter(r=>r.status==='ok').length}/${results.length} OK`);
console.log(allOk ? 'TODAS as migrations passaram no dry-run.' : 'Alguma migration FALHOU — não executar.');
await pool.end();
process.exitCode = allOk ? 0 : 1;
