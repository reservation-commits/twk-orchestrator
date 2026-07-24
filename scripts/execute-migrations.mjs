// EXECUTE migrations for real (BEGIN ... COMMIT). Stop on first failure.
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

const dir = 'audit-output/migrations';
const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort();

// Cut off the DOWN reversal block — only execute the forward path.
function prepareSql(raw) {
  const downMarker = /\n-- =+\s*\n-- DOWN/i;
  return raw.split(downMarker)[0];
}

const results = [];
let anyFailed = false;

for (const file of files) {
  if (anyFailed) {
    results.push({ file, status: 'skipped' });
    console.log(`SKIP  ${file}  (previous migration failed)`);
    continue;
  }

  const fullPath = path.join(dir, file);
  const raw = fs.readFileSync(fullPath, 'utf8');
  const sql = prepareSql(raw);

  const client = await pool.connect();
  const t0 = Date.now();
  const outcome = { file, status: 'ok', error: null, ms: 0, notices: [] };
  client.on('notice', n => outcome.notices.push(n.message));

  try {
    await client.query("SET statement_timeout = '120s'");
    await client.query(sql);    // includes its own BEGIN/COMMIT
    outcome.ms = Date.now() - t0;
    console.log(`OK    ${file}  (${outcome.ms}ms)`);
    for (const n of outcome.notices) console.log(`        notice: ${n}`);
  } catch (e) {
    outcome.status = 'fail';
    outcome.error = { message: e.message, code: e.code, position: e.position, where: e.where };
    outcome.ms = Date.now() - t0;
    anyFailed = true;
    console.log(`FAIL  ${file}  (${outcome.ms}ms): ${e.message}`);
    try { await client.query('ROLLBACK'); } catch {}
  } finally {
    client.release();
    results.push(outcome);
  }
}

fs.writeFileSync('audit-output/execution-results.json', JSON.stringify({
  executed_at: new Date().toISOString(),
  results,
}, null, 2));

const okCount = results.filter(r => r.status === 'ok').length;
console.log(`\nResultado: ${okCount}/${results.length} migrations aplicadas.`);
await pool.end();
process.exitCode = anyFailed ? 1 : 0;
