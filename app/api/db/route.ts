import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { query, withTransaction, listTables, getTableSchema, getRowCount, testConnection, logUpdateEvent } from '@/lib/db';

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
});

const BulkInsertSchema = z.object({
  table: z.string(),
  rows: z.array(z.record(z.unknown())),
});

function isSafeSelect(sql: string): boolean {
  const upper = sql.trim().toUpperCase();
  return upper.startsWith('SELECT') || upper.startsWith('WITH') || upper.startsWith('EXPLAIN');
}

function isDestructive(sql: string): boolean {
  const upper = sql.trim().toUpperCase();
  return upper.startsWith('DELETE') || upper.startsWith('DROP') || upper.startsWith('TRUNCATE');
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
        const schema = await getTableSchema(table);
        return NextResponse.json({ schema });
      }
      case 'count': {
        const table = searchParams.get('table');
        if (!table) return NextResponse.json({ error: 'Missing table param' }, { status: 400 });
        const count = await getRowCount(table);
        return NextResponse.json({ count });
      }
      case 'rows': {
        const table = searchParams.get('table');
        const page = parseInt(searchParams.get('page') ?? '1', 10);
        const limit = Math.min(parseInt(searchParams.get('limit') ?? '50', 10), 200);
        const offset = (page - 1) * limit;
        const orderBy = searchParams.get('orderBy') ?? '1';
        const orderDir = searchParams.get('orderDir') === 'desc' ? 'DESC' : 'ASC';
        const filter = searchParams.get('filter');

        let sql = `SELECT * FROM ${table}`;
        const params: unknown[] = [];
        if (filter) {
          sql += ` WHERE ${filter}`;
        }
        sql += ` ORDER BY ${orderBy} ${orderDir} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
        params.push(limit, offset);

        const result = await query(sql, params);
        const countResult = await query(`SELECT COUNT(*) as total FROM ${table}${filter ? ` WHERE ${filter}` : ''}`);
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
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const action = body.action as string;

    switch (action) {
      case 'query': {
        const { sql, params } = QuerySchema.parse(body);
        if (!isSafeSelect(sql)) {
          return NextResponse.json({ error: 'Only SELECT queries allowed on this endpoint. Use /api/db with action=mutate.' }, { status: 403 });
        }
        const result = await query(sql, params as unknown[]);
        return NextResponse.json({ rows: result.rows, rowCount: result.rowCount });
      }

      case 'mutate': {
        const { sql, params, table, operation, confirmed } = MutationSchema.parse(body);
        if (isDestructive(sql) && !confirmed) {
          const countMatch = sql.match(/WHERE\s+(.+)/i);
          return NextResponse.json({
            requiresConfirmation: true,
            message: `This ${operation} operation${countMatch ? '' : ' has no WHERE clause'}. Confirm to proceed.`,
            sql,
          });
        }
        const result = await query(sql, params as unknown[]);
        await logUpdateEvent({ table_name: table, operation, new_data: { sql, params } });
        return NextResponse.json({ rowCount: result.rowCount, command: result.command });
      }

      case 'bulk_insert': {
        const { table, rows } = BulkInsertSchema.parse(body);
        const maxBulk = parseInt(process.env.MAX_BULK_INSERT ?? '50', 10);
        if (rows.length > maxBulk) {
          return NextResponse.json({ error: `Cannot insert more than ${maxBulk} rows at once` }, { status: 400 });
        }
        if (!rows.length) return NextResponse.json({ inserted: 0 });

        const columns = Object.keys(rows[0]);
        let inserted = 0;
        const errors: string[] = [];

        await withTransaction(async (client) => {
          for (const row of rows) {
            try {
              const values = columns.map((c) => row[c]);
              const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
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
          await logUpdateEvent({ table_name: table, operation: 'INSERT', new_data: { count: inserted } });
        });

        return NextResponse.json({ inserted, errors });
      }

      case 'update_cell': {
        const { table, id_column, id_value, column, value } = body as {
          table: string; id_column: string; id_value: unknown; column: string; value: unknown;
        };
        const oldResult = await query(`SELECT * FROM ${table} WHERE ${id_column} = $1`, [id_value]);
        await query(`UPDATE ${table} SET ${column} = $1 WHERE ${id_column} = $2`, [value, id_value]);
        await logUpdateEvent({
          table_name: table,
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
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
