import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';

let pool: Pool | null = null;

function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });
    pool.on('error', (err) => {
      console.error('Unexpected pool error', err);
    });
  }
  return pool;
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
    await client.query('ROLLBACK');
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
  const result = await query(`SELECT COUNT(*) as count FROM ${tableName}`);
  return parseInt(result.rows[0].count, 10);
}

export interface UpdateEvent {
  table_name: string;
  operation: 'INSERT' | 'UPDATE' | 'DELETE';
  record_id?: string | number;
  old_data?: Record<string, unknown>;
  new_data?: Record<string, unknown>;
  agent?: string;
}

export async function logUpdateEvent(event: UpdateEvent): Promise<void> {
  try {
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
  } catch {
    // log table may not exist yet; silently ignore
  }
}
