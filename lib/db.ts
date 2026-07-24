import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import { analyzeWriteSql, safeIdent, WriteOperation } from './sql-guard';

// Pool único por processo, inclusive sob hot-reload do Next (que recarrega módulos).
const globalForPool = globalThis as unknown as { __twkPool?: Pool; __twkSslWarned?: boolean };

function buildSsl(): { ca: string; rejectUnauthorized: true } | { rejectUnauthorized: false } {
  const ca = process.env.DB_CA_CERT;
  if (ca && ca.trim()) {
    return { ca: ca.replace(/\\n/g, '\n'), rejectUnauthorized: true };
  }
  if (!globalForPool.__twkSslWarned) {
    globalForPool.__twkSslWarned = true;
    console.warn(
      '[db] TLS sem verificação de certificado (rejectUnauthorized=false). ' +
        'Defina DB_CA_CERT com o certificado CA do Cloud SQL para verificação completa.'
    );
  }
  return { rejectUnauthorized: false };
}

function getPool(): Pool {
  if (!globalForPool.__twkPool) {
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: buildSsl(),
      max: parseInt(process.env.DB_POOL_MAX || '20', 10),
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });
    pool.on('error', (err) => {
      console.error('Unexpected pool error', err);
    });
    globalForPool.__twkPool = pool;
  }
  return globalForPool.__twkPool;
}

export async function query<T = Record<string, unknown>>(
  sql: string,
  params?: unknown[]
): Promise<QueryResult<T>> {
  const client = await getPool().connect();
  try {
    return await client.query<T>(sql, params);
  } finally {
    client.release();
  }
}

/**
 * Run a SELECT under a genuinely read-only transaction.
 * Postgres rejects any write inside `READ ONLY`, so this is a hard guarantee even
 * if a clever statement slips past the keyword guard. A per-statement timeout caps
 * runaway scans, and the row count is capped to protect the agent's context window.
 */
export interface ReadOnlyOptions {
  params?: unknown[];
  timeoutMs?: number;
  maxRows?: number;
}

export interface ReadOnlyResult<T = Record<string, unknown>> {
  rows: T[];
  rowCount: number;
  returned: number;
  truncated: boolean;
}

const WRITE_KEYWORD = /\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|comment|copy|vacuum|reindex|refresh|call|do|merge|lock|set|reset)\b/i;

export async function queryReadOnly<T extends QueryResultRow = Record<string, unknown>>(
  sql: string,
  opts: ReadOnlyOptions = {}
): Promise<ReadOnlyResult<T>> {
  const { params, timeoutMs = 15000, maxRows = 500 } = opts;
  const trimmed = sql.trim().replace(/;+\s*$/, '');
  const head = trimmed.replace(/^\(+/, '').slice(0, 12).toLowerCase();
  if (!head.startsWith('select') && !head.startsWith('with') && !head.startsWith('table') && !head.startsWith('explain')) {
    throw new Error('execute_query aceita apenas SELECT/WITH/TABLE/EXPLAIN (somente leitura).');
  }
  if (/;/.test(trimmed)) {
    throw new Error('Múltiplos statements não são permitidos em execute_query.');
  }
  if (WRITE_KEYWORD.test(trimmed)) {
    throw new Error('execute_query bloqueou uma palavra-chave de escrita. Use execute_mutation para alterar dados.');
  }

  const client = await getPool().connect();
  try {
    await client.query('BEGIN TRANSACTION READ ONLY');
    await client.query(`SET LOCAL statement_timeout = ${Math.max(1000, Math.min(timeoutMs, 60000))}`);
    const result = await client.query<T>(trimmed, params);
    await client.query('COMMIT');
    const truncated = result.rows.length > maxRows;
    return {
      rows: truncated ? result.rows.slice(0, maxRows) : result.rows,
      rowCount: result.rowCount ?? result.rows.length,
      returned: truncated ? maxRows : result.rows.length,
      truncated,
    };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* connection may be dead */ }
    throw err;
  } finally {
    client.release();
  }
}

export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* conexão pode estar morta; preserva o erro original */ }
    throw err;
  } finally {
    client.release();
  }
}

export interface WriteOptions {
  params?: unknown[];
  /** Operação declarada pelo chamador; precisa bater com o SQL real. */
  operation?: string;
  /** Máximo de linhas afetadas antes de rollback automático. */
  maxAffectedRows?: number;
  /** Permite UPDATE/DELETE sem WHERE (exige intenção explícita). */
  allowFullTable?: boolean;
  timeoutMs?: number;
}

export interface WriteResult<T = Record<string, unknown>> {
  operation: WriteOperation;
  rowCount: number;
  rows: T[];
}

export const DEFAULT_WRITE_MAX_ROWS = parseInt(process.env.WRITE_MAX_ROWS || '500', 10);

/**
 * Contraparte de escrita do queryReadOnly: TODA mutação de dados passa por aqui.
 * Camadas: statement único · operação declarada == real · sem DDL · WHERE
 * obrigatório · transação com rollback automático se afetar mais linhas que o
 * limite (blast-radius) · statement_timeout.
 */
export async function queryWrite<T extends QueryResultRow = Record<string, unknown>>(
  sql: string,
  opts: WriteOptions = {}
): Promise<WriteResult<T>> {
  const {
    params,
    operation,
    maxAffectedRows = DEFAULT_WRITE_MAX_ROWS,
    allowFullTable = false,
    timeoutMs = 30000,
  } = opts;
  const analysis = analyzeWriteSql(sql, operation, { allowMissingWhere: allowFullTable });

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await client.query(`SET LOCAL statement_timeout = ${Math.max(1000, Math.min(timeoutMs, 120000))}`);
    const result = await client.query<T>(analysis.statement, params);
    const affected = result.rowCount ?? 0;
    if (affected > maxAffectedRows) {
      await client.query('ROLLBACK');
      throw new Error(
        `Mutação abortada (rollback): afetaria ${affected} linhas, acima do limite de ${maxAffectedRows}. ` +
          `Refine o WHERE ou aumente max_affected_rows deliberadamente.`
      );
    }
    await client.query('COMMIT');
    return { operation: analysis.operation, rowCount: affected, rows: result.rows };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* já rolled back ou conexão morta */ }
    throw err;
  } finally {
    client.release();
  }
}

export async function testConnection(): Promise<boolean> {
  try {
    const result = await query('SELECT 1 as ok');
    return result.rows[0]?.ok === 1;
  } catch {
    return false;
  }
}

export async function listTables(): Promise<{ table_schema: string; table_name: string }[]> {
  const result = await query<{ table_schema: string; table_name: string }>(`
    SELECT table_schema, table_name
    FROM information_schema.tables
    WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
      AND table_type = 'BASE TABLE'
    ORDER BY table_schema, table_name
  `);
  return result.rows;
}

export async function getTableSchema(tableName: string): Promise<{
  column_name: string;
  data_type: string;
  is_nullable: string;
  column_default: string | null;
}[]> {
  const [schema, table] = tableName.includes('.')
    ? tableName.split('.')
    : ['public', tableName];

  const result = await query(`
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = $1 AND table_name = $2
    ORDER BY ordinal_position
  `, [schema, table]);
  return result.rows;
}

export async function getRowCount(tableName: string): Promise<number> {
  const result = await query(`SELECT COUNT(*) as count FROM ${safeIdent(tableName)}`);
  return parseInt(String(result.rows[0].count), 10);
}

export interface UpdateEvent {
  table_name: string;
  operation: 'INSERT' | 'UPDATE' | 'DELETE';
  record_id?: string | number;
  old_data?: Record<string, unknown>;
  new_data?: Record<string, unknown>;
  agent?: string;
}

export class AuditLogError extends Error {
  constructor(cause: unknown) {
    super(
      'Falha ao registrar no log de auditoria (update_events). ' +
        'Mutação bloqueada: nenhuma escrita acontece sem trilha de auditoria. ' +
        `Causa: ${cause instanceof Error ? cause.message : String(cause)}`
    );
    this.name = 'AuditLogError';
  }
}

async function insertUpdateEvent(event: UpdateEvent): Promise<void> {
  await query(
    `INSERT INTO public.update_events
       (table_name, operation, record_id, old_data, new_data, agent, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
    [
      event.table_name,
      event.operation,
      event.record_id ?? null,
      event.old_data ? JSON.stringify(event.old_data) : null,
      event.new_data ? JSON.stringify(event.new_data) : null,
      event.agent ?? 'db-architect',
    ]
  );
}

/**
 * Registro de auditoria FAIL-CLOSED: se o insert falhar, tenta criar a tabela
 * uma vez (self-healing) e reexecuta; persistindo a falha, lança AuditLogError.
 * Chamadores de mutação devem logar ANTES de considerar a operação bem-sucedida.
 */
export async function logUpdateEvent(event: UpdateEvent): Promise<void> {
  try {
    await insertUpdateEvent(event);
  } catch (first) {
    try {
      await query(`
        CREATE TABLE IF NOT EXISTS public.update_events (
          id          SERIAL PRIMARY KEY,
          table_name  TEXT NOT NULL,
          operation   TEXT NOT NULL,
          record_id   TEXT,
          old_data    JSONB,
          new_data    JSONB,
          agent       TEXT DEFAULT 'db-architect',
          created_at  TIMESTAMPTZ DEFAULT NOW()
        )
      `);
      await insertUpdateEvent(event);
    } catch {
      console.error('[audit] Falha definitiva ao gravar update_events', first);
      throw new AuditLogError(first);
    }
  }
}
