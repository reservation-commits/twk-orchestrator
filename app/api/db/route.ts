import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  query,
  queryReadOnly,
  queryWrite,
  withTransaction,
  listTables,
  getTableSchema,
  getRowCount,
  testConnection,
  logUpdateEvent,
  AuditLogError,
} from '@/lib/db';
import { safeIdent, safeColumn, safeOrderDir } from '@/lib/sql-guard';

const QuerySchema = z.object({
  sql: z.string().min(1),
  params: z.array(z.unknown()).optional(),
});

const MutationSchema = z.object({
  sql: z.string().min(1),
  params: z.array(z.unknown()).optional(),
  table: z.string(),
  operation: z.enum(['INSERT', 'UPDATE', 'DELETE']),
  confirmed: z.boolean().optional(),
  confirm_token: z.string().optional(),
});

const BulkInsertSchema = z.object({
  table: z.string(),
  rows: z.array(z.record(z.unknown())),
});

function isDestructive(sql: string): boolean {
  const upper = sql.trim().toUpperCase();
  return upper.startsWith('DELETE') || upper.startsWith('DROP') || upper.startsWith('TRUNCATE');
}

// Token HMAC do SQL exato: a confirmação só vale para o statement que foi pré-visualizado.
function mutationConfirmToken(sql: string): string {
  const secret = process.env.DASHBOARD_PASSWORD || 'dev-secret';
  return createHmac('sha256', secret).update(sql).digest('hex');
}

function tokenMatches(expected: string, provided: string | undefined): boolean {
  if (!provided) return false;
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(provided, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

// Erros vindos dos guards de identificador → 400 (input do cliente), resto → 500.
function guardStatus(err: unknown): number {
  return err instanceof Error && /^(Identificador|Nome de coluna)/.test(err.message) ? 400 : 500;
}

// Primeira coluna da PK de uma tabela (possivelmente schema-qualificada), parameterizado.
async function getPrimaryKeyColumn(tableName: string): Promise<string | null> {
  const [schema, table] = tableName.includes('.')
    ? tableName.split('.')
    : ['public', tableName];
  const result = await query<{ column_name: string }>(
    `SELECT kcu.column_name
     FROM information_schema.table_constraints tc
     JOIN information_schema.key_column_usage kcu
       ON kcu.constraint_name = tc.constraint_name
      AND kcu.table_schema = tc.table_schema
     WHERE tc.constraint_type = 'PRIMARY KEY'
       AND tc.table_schema = $1 AND tc.table_name = $2
     ORDER BY kcu.ordinal_position
     LIMIT 1`,
    [schema, table]
  );
  return result.rows[0]?.column_name ?? null;
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const action = searchParams.get('action');

  try {
    switch (action) {
      case 'ping': {
        const ok = await testConnection();
        return NextResponse.json({ ok });
      }
      case 'tables': {
        const tables = await listTables();
        return NextResponse.json({ tables });
      }
      case 'schema': {
        const table = searchParams.get('table');
        if (!table) return NextResponse.json({ error: 'Missing table param' }, { status: 400 });
        // getTableSchema é parameterizado (information_schema); safeIdent só valida o formato.
        safeIdent(table);
        const schema = await getTableSchema(table);
        return NextResponse.json({ schema });
      }
      case 'count': {
        const table = searchParams.get('table');
        if (!table) return NextResponse.json({ error: 'Missing table param' }, { status: 400 });
        const count = await getRowCount(table); // usa safeIdent internamente
        return NextResponse.json({ count });
      }
      case 'pk': {
        const table = searchParams.get('table');
        if (!table) return NextResponse.json({ error: 'Missing table param' }, { status: 400 });
        safeIdent(table);
        const pk = await getPrimaryKeyColumn(table);
        return NextResponse.json({ pk });
      }
      case 'schema_graph': {
        // Grafo do schema (ERD): tabelas + colunas + PKs + FKs, tudo de catálogos do próprio PG.
        const [colsRes, estRes, pkRes, fkRes] = await Promise.all([
          query<{ table_schema: string; table_name: string; column_name: string; data_type: string; is_nullable: string }>(
            `SELECT c.table_schema, c.table_name, c.column_name, c.data_type, c.is_nullable
             FROM information_schema.columns c
             JOIN information_schema.tables t
               ON t.table_schema = c.table_schema AND t.table_name = c.table_name
              AND t.table_type = 'BASE TABLE'
             WHERE c.table_schema NOT IN ('pg_catalog', 'information_schema')
             ORDER BY c.table_schema, c.table_name, c.ordinal_position`
          ),
          query<{ table_schema: string; table_name: string; row_estimate: string }>(
            `SELECT n.nspname AS table_schema, c.relname AS table_name, c.reltuples::bigint AS row_estimate
             FROM pg_class c
             JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE c.relkind = 'r' AND n.nspname NOT IN ('pg_catalog', 'information_schema')`
          ),
          query<{ table_schema: string; table_name: string; column_name: string }>(
            `SELECT tc.table_schema, tc.table_name, kcu.column_name
             FROM information_schema.table_constraints tc
             JOIN information_schema.key_column_usage kcu
               ON kcu.constraint_name = tc.constraint_name AND kcu.table_schema = tc.table_schema
             WHERE tc.constraint_type = 'PRIMARY KEY'
               AND tc.table_schema NOT IN ('pg_catalog', 'information_schema')`
          ),
          query<{ from_table: string; from_column: string; to_table: string; to_column: string }>(
            `SELECT
               tc.table_schema || '.' || tc.table_name  AS from_table,
               kcu.column_name                          AS from_column,
               ccu.table_schema || '.' || ccu.table_name AS to_table,
               ccu.column_name                          AS to_column
             FROM information_schema.table_constraints tc
             JOIN information_schema.key_column_usage kcu
               ON kcu.constraint_name = tc.constraint_name AND kcu.constraint_schema = tc.constraint_schema
             JOIN information_schema.constraint_column_usage ccu
               ON ccu.constraint_name = tc.constraint_name AND ccu.constraint_schema = tc.constraint_schema
             WHERE tc.constraint_type = 'FOREIGN KEY'
               AND tc.table_schema NOT IN ('pg_catalog', 'information_schema')`
          ),
        ]);

        const estimates = new Map<string, number>();
        for (const r of estRes.rows) {
          estimates.set(`${r.table_schema}.${r.table_name}`, Math.max(0, parseInt(String(r.row_estimate), 10) || 0));
        }
        const pks = new Set<string>();
        for (const r of pkRes.rows) pks.add(`${r.table_schema}.${r.table_name}.${r.column_name}`);

        const tableMap = new Map<string, {
          schema: string; name: string; row_estimate: number;
          columns: { name: string; data_type: string; is_nullable: boolean; is_pk: boolean }[];
        }>();
        for (const c of colsRes.rows) {
          const key = `${c.table_schema}.${c.table_name}`;
          let t = tableMap.get(key);
          if (!t) {
            t = { schema: c.table_schema, name: c.table_name, row_estimate: estimates.get(key) ?? 0, columns: [] };
            tableMap.set(key, t);
          }
          t.columns.push({
            name: c.column_name,
            data_type: c.data_type,
            is_nullable: c.is_nullable === 'YES',
            is_pk: pks.has(`${key}.${c.column_name}`),
          });
        }

        return NextResponse.json({
          tables: Array.from(tableMap.values()),
          foreign_keys: fkRes.rows,
        });
      }
      case 'rows': {
        const tableParam = searchParams.get('table');
        if (!tableParam) return NextResponse.json({ error: 'Missing table param' }, { status: 400 });
        const table = safeIdent(tableParam);
        const page = Math.max(parseInt(searchParams.get('page') ?? '1', 10) || 1, 1);
        const limit = Math.min(parseInt(searchParams.get('limit') ?? '50', 10) || 50, 200);
        const offset = (page - 1) * limit;
        const orderByParam = searchParams.get('orderBy');
        const orderBy = orderByParam ? safeColumn(orderByParam) : '1';
        const orderDir = safeOrderDir(searchParams.get('orderDir'));

        // Busca parameterizada: nada de WHERE cru vindo do cliente.
        const search = searchParams.get('search');
        const searchColumnParam = searchParams.get('searchColumn');
        const params: unknown[] = [];
        let where = '';
        if (search && searchColumnParam) {
          const col = safeColumn(searchColumnParam);
          params.push(`%${search}%`);
          where = ` WHERE CAST(${col} AS TEXT) ILIKE $${params.length}`;
        }

        const sql = `SELECT * FROM ${table}${where} ORDER BY ${orderBy} ${orderDir} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
        const result = await query(sql, [...params, limit, offset]);
        const countResult = await query<{ total: string }>(`SELECT COUNT(*) as total FROM ${table}${where}`, params);
        return NextResponse.json({
          rows: result.rows,
          total: parseInt(countResult.rows[0].total, 10),
          page,
          limit,
        });
      }
      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: guardStatus(err) });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const action = body.action as string;

    switch (action) {
      case 'query': {
        const { sql, params } = QuerySchema.parse(body);
        // queryReadOnly garante: SELECT/WITH/TABLE/EXPLAIN, statement único,
        // transação READ ONLY real (o PG rejeita escrita), timeout e cap de linhas.
        const result = await queryReadOnly(sql, { params: params as unknown[] });
        return NextResponse.json({
          rows: result.rows,
          rowCount: result.rowCount,
          returned: result.returned,
          truncated: result.truncated,
        });
      }

      case 'mutate': {
        const { sql, params, table, operation, confirmed, confirm_token } = MutationSchema.parse(body);
        const expectedToken = mutationConfirmToken(sql);

        if (isDestructive(sql) && confirmed !== true) {
          // Preview: devolve o token HMAC do SQL exato; a execução exige o mesmo token.
          const hasWhere = /\bWHERE\b/i.test(sql);
          return NextResponse.json({
            requiresConfirmation: true,
            message: `This ${operation} operation${hasWhere ? '' : ' has no WHERE clause'}. Confirm to proceed.`,
            sql,
            confirm_token: expectedToken,
          });
        }
        if (isDestructive(sql) && !tokenMatches(expectedToken, confirm_token)) {
          return NextResponse.json(
            { error: 'confirm_token ausente ou inválido: a confirmação deve referir-se ao SQL exato pré-visualizado.' },
            { status: 403 }
          );
        }

        // queryWrite: statement único, operação declarada == real, sem DDL, WHERE
        // obrigatório (salvo confirmação explícita), rollback por blast-radius.
        const result = await queryWrite(sql, {
          params: params as unknown[],
          operation,
          allowFullTable: confirmed === true,
        });
        // Fail-closed: se a trilha de auditoria falhar, a resposta é erro (500 abaixo).
        await logUpdateEvent({ table_name: table, operation, new_data: { sql, params } });
        return NextResponse.json({ rowCount: result.rowCount, command: result.operation });
      }

      case 'bulk_insert': {
        const { table: tableParam, rows } = BulkInsertSchema.parse(body);
        const table = safeIdent(tableParam);
        const maxBulk = parseInt(process.env.MAX_BULK_INSERT ?? '50', 10);
        if (rows.length > maxBulk) {
          return NextResponse.json({ error: `Cannot insert more than ${maxBulk} rows at once` }, { status: 400 });
        }
        if (!rows.length) return NextResponse.json({ inserted: 0 });

        const rawColumns = Object.keys(rows[0]);
        const columns = rawColumns.map((c) => safeColumn(c));
        let inserted = 0;
        const errors: string[] = [];

        await withTransaction(async (client) => {
          for (const row of rows) {
            try {
              const values = rawColumns.map((c) => row[c]);
              const placeholders = rawColumns.map((_, i) => `$${i + 1}`).join(', ');
              await client.query(
                `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`,
                values
              );
              inserted++;
            } catch (err) {
              errors.push(String(err));
              if (errors.length / rows.length > 0.1) throw new Error('More than 10% of inserts failed — rolling back');
            }
          }
          await logUpdateEvent({ table_name: tableParam, operation: 'INSERT', new_data: { count: inserted } });
        });

        return NextResponse.json({ inserted, errors });
      }

      case 'update_cell': {
        const { table: tableParam, id_column, id_value, column, value } = body as {
          table: string; id_column: string; id_value: unknown; column: string; value: unknown;
        };
        const table = safeIdent(tableParam);
        const idCol = safeColumn(id_column);
        const col = safeColumn(column);

        // A coluna precisa existir de verdade no schema da tabela.
        const schema = await getTableSchema(tableParam);
        const known = new Set(schema.map((c) => c.column_name));
        if (!known.has(column)) {
          return NextResponse.json({ error: `Coluna "${column}" não existe em ${tableParam}` }, { status: 400 });
        }
        if (!known.has(id_column)) {
          return NextResponse.json({ error: `Coluna de id "${id_column}" não existe em ${tableParam}` }, { status: 400 });
        }

        const oldResult = await query(`SELECT * FROM ${table} WHERE ${idCol} = $1`, [id_value]);
        await query(`UPDATE ${table} SET ${col} = $1 WHERE ${idCol} = $2`, [value, id_value]);
        await logUpdateEvent({
          table_name: tableParam,
          operation: 'UPDATE',
          record_id: String(id_value),
          old_data: oldResult.rows[0],
          new_data: { [column]: value },
        });
        return NextResponse.json({ ok: true });
      }

      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: 'Validation error', details: err.issues }, { status: 400 });
    }
    if (err instanceof AuditLogError) {
      return NextResponse.json({ error: err.message }, { status: 500 });
    }
    return NextResponse.json({ error: String(err) }, { status: guardStatus(err) });
  }
}
