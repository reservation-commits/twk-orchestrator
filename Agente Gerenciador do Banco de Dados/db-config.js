/*
 * Shared DB connection config for the root ops scripts.
 *
 * The Postgres URL (with its password) used to be hardcoded in ~20 scripts. It now lives ONLY in
 * the environment or in twk-db-agent/.env.local, and every script pulls it from here — so the
 * credential is never committed in source. Set DATABASE_URL in the environment to override.
 */
const fs = require('fs');
const path = require('path');

function fromEnvFile() {
  const p = path.join(__dirname, 'twk-db-agent', '.env.local');
  try {
    for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^DATABASE_URL=(.*)$/);
      if (m) {
        let v = m[1].trim();
        if ((v.startsWith("'") && v.endsWith("'")) || (v.startsWith('"') && v.endsWith('"'))) v = v.slice(1, -1);
        return v;
      }
    }
  } catch { /* file missing → fall through */ }
  return null;
}

/**
 * Papel de escrita do DBA (ADR-013 / ADR-017): ~/.twk/dba.env → TWK_DBA_URL (usuário twk_dba —
 * INSERT/UPDATE/DELETE em todo o schema public, sem DDL, sem nextauth, fora do OneDrive).
 * É a MESMA credencial do executor (dba-escrita/executar.js): uma porta, um papel.
 * Ordem: TWK_DBA_URL (ambiente) → ~/.twk/dba.env → DATABASE_URL (ambiente) → twk-db-agent/.env.local.
 * TWK_DBA_ENV=off força o caminho antigo (diagnóstico).
 */
function fromDbaEnv() {
  if (String(process.env.TWK_DBA_ENV || '').toLowerCase() === 'off') return null;
  const home = process.env.USERPROFILE || process.env.HOME || '';
  try {
    for (const line of fs.readFileSync(path.join(home, '.twk', 'dba.env'), 'utf8').split(/\r?\n/)) {
      const m = line.match(/^TWK_DBA_URL=(.*)$/);
      if (m) { const v = m[1].trim().replace(/^["']|["']$/g, ''); if (v && !v.includes('__SENHA')) return v; }
    }
  } catch { /* sem ~/.twk/dba.env → fall through */ }
  return null;
}

const CONN = process.env.TWK_DBA_URL || fromDbaEnv() || process.env.DATABASE_URL || fromEnvFile();
if (!CONN) {
  console.error('ERRO: nenhuma credencial encontrada (TWK_DBA_URL, ~/.twk/dba.env, DATABASE_URL ou twk-db-agent/.env.local).');
  process.exit(1);
}

// Menor privilégio (auditoria 2026-09-21): estes scripts rodavam como `postgres`, o papel
// administrativo da instância — toda trava do app ficava ACIMA de uma chave-mestra. O papel
// twk_db_agent (twk-db-agent/db/roles/twk_db_agent.sql) existe para isto e nunca foi criado.
// Aviso por padrão; TWK_REQUIRE_LEAST_PRIVILEGE=1 transforma o aviso em bloqueio.
const USUARIO = (() => { try { return new URL(CONN).username; } catch { return ''; } })();
if (USUARIO === 'postgres') {
  const msg = 'conectando como `postgres` (papel administrativo). O papel de escrita é twk_dba (~/.twk/dba.env, TWK_DBA_URL) — se o arquivo existe, algo o impediu de ser lido.';
  if (process.env.TWK_REQUIRE_LEAST_PRIVILEGE === '1') { console.error('BLOQUEADO: ' + msg); process.exit(3); }
  console.error('ATENÇÃO: ' + msg);
} else if (process.env.TWK_DB_QUIET !== '1') {
  console.error(`[db-config] papel em uso: ${USUARIO}`);
}

module.exports = { CONN, SSL: { rejectUnauthorized: false }, USUARIO };
