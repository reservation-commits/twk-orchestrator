import { Pool, PoolClient, QueryResult } from 'pg';

let pool: Pool | null = null;

function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
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
