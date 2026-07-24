// Runner de migrations versionadas.
//   node scripts/migrate.mjs            → aplica pendentes (cada uma em transação)
//   node scripts/migrate.mjs --status   → lista aplicadas + pendentes
//   node scripts/migrate.mjs --dry-run  → mostra o que seria aplicado, sem executar
//
// Ledger: public.schema_migrations (name, checksum, applied_at). O checksum trava
// o conteúdo: migration aplicada nunca deve ser editada — crie uma nova.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Pool } from 'pg';

const root = path.resolve(process.cwd());
const envPath = path.join(root, '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
  }
}
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL ausente (.env.local ou ambiente).');
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const dryRun = process.argv.includes('--dry-run');
const statusOnly = process.argv.includes('--status');

const dir = path.join(root, 'migrations');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();

await pool.query(`
  CREATE TABLE IF NOT EXISTS public.schema_migrations (
    name       TEXT PRIMARY KEY,
    checksum   TEXT NOT NULL,
    applied_at TIMESTAMPTZ DEFAULT NOW()
  )
`);

const appliedRows = (await pool.query('SELECT name, checksum FROM public.schema_migrations')).rows;
const applied = new Map(appliedRows.map((r) => [r.name, r.checksum]));

const pending = [];
for (const file of files) {
  const sql = fs.readFileSync(path.join(dir, file), 'utf8');
  const checksum = crypto.createHash('sha256').update(sql.replace(/\r\n/g, '\n')).digest('hex').slice(0, 16);
  if (applied.has(file)) {
    if (applied.get(file) !== checksum) {
      console.warn(`⚠ ${file}: conteúdo mudou depois de aplicada (checksum divergente). Crie uma NOVA migration em vez de editar.`);
    }
    continue;
  }
  pending.push({ file, sql, checksum });
}

console.log(`Aplicadas: ${applied.size} · Pendentes: ${pending.length}`);
if (statusOnly || dryRun) {
  for (const p of pending) console.log(`  → pendente: ${p.file}`);
  await pool.end();
  process.exit(0);
}

for (const p of pending) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(p.sql);
    await client.query('INSERT INTO public.schema_migrations (name, checksum) VALUES ($1, $2)', [p.file, p.checksum]);
    await client.query('COMMIT');
    console.log(`✓ ${p.file}`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(`✗ ${p.file}: ${err.message}`);
    client.release();
    await pool.end();
    process.exit(1);
  }
  client.release();
}
await pool.end();
console.log('Migrations concluídas.');
