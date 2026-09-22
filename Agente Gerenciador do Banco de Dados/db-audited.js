/*
 * db-audited.js — escrita AUDITADA para os scripts de manutenção da raiz.
 *
 * Problema que resolve: os scripts (enrich_*, fill_*, import_csv, republish_no_photo…)
 * escreviam por conexão direta, sem old_data e sem linha em agent_audit_log — em
 * 2026-08-28 o log tinha 17 linhas contra milhares de escritas reais. Este módulo
 * fecha esse buraco: toda mutação captura o estado anterior e grava a trilha
 * DENTRO DA MESMA TRANSAÇÃO (se o log falhar, a mutação inteira sofre rollback).
 *
 * Uso:
 *   const { auditedUpdate } = require('./db-audited');
 *   const res = await auditedUpdate(pool, {
 *     table: 'db_restaurants',          // precisa ter PK simples
 *     pk: 'restaurant_id',
 *     where: 'ready_pending_photo AND NOT published',   // ou where + params
 *     params: [],
 *     set: 'published = true, ready_pending_photo = false',
 *     agent: 'republish_no_photo',      // quem assina a linha de auditoria
 *     reason: 'republicacao em lote apos foto adicionada',
 *     maxRows: 500,                     // teto de segurança; acima disso -> rollback
 *   });
 *   // res = { rowCount, ids }
 */
const MAX_ROWS_DEFAULT = 200;

async function auditedUpdate(pool, opts) {
  const { table, pk, where, params = [], set, agent, reason, maxRows = MAX_ROWS_DEFAULT } = opts;
  if (!table || !pk || !where || !set || !agent) throw new Error('auditedUpdate: table, pk, where, set e agent são obrigatórios');
  if (!/^[a-z_][a-z0-9_]*$/i.test(table) || !/^[a-z_][a-z0-9_]*$/i.test(pk)) throw new Error('auditedUpdate: nome de tabela/pk inválido');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1) Estado anterior das linhas-alvo, travadas até o COMMIT.
    const before = await client.query(
      `SELECT ${pk} AS id, to_jsonb(t) AS old_data FROM public.${table} t WHERE ${where} FOR UPDATE`, params);

    if (before.rowCount === 0) { await client.query('ROLLBACK'); return { rowCount: 0, ids: [] }; }
    if (before.rowCount > maxRows) {
      await client.query('ROLLBACK');
      throw new Error(`auditedUpdate: ${before.rowCount} linhas-alvo excede o teto maxRows=${maxRows} — abortado. Aumente maxRows conscientemente se for intencional.`);
    }

    // 2) A mutação em si, restrita às linhas capturadas (não ao WHERE original,
    //    para que nada que apareça entre o SELECT e o UPDATE entre sem old_data).
    const ids = before.rows.map(r => r.id);
    const upd = await client.query(
      `UPDATE public.${table} SET ${set} WHERE ${pk} = ANY($1) RETURNING ${pk} AS id`, [ids]);
    if (upd.rowCount !== before.rowCount) {
      await client.query('ROLLBACK');
      throw new Error(`auditedUpdate: UPDATE afetou ${upd.rowCount}, esperado ${before.rowCount} — rollback`);
    }

    // 3) Trilha: uma linha de auditoria POR REGISTRO, com o old_data completo.
    for (const r of before.rows) {
      await client.query(
        `INSERT INTO public.agent_audit_log (table_name, operation, record_id, old_data, new_data, agent, created_at)
         VALUES ($1,'UPDATE',$2,$3,$4,$5,NOW())`,
        [table, String(r.id), JSON.stringify(r.old_data),
         JSON.stringify({ set, reason, lote: before.rowCount > 1 ? `${before.rowCount} registros nesta execução` : undefined }),
         agent]);
    }

    await client.query('COMMIT');
    return { rowCount: upd.rowCount, ids };
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    throw e;
  } finally {
    client.release();
  }
}

/**
 * auditedUpdateRow — a versão POR LINHA, para os scripts que calculam um SET diferente
 * para cada registro (preço, fotos, place_id, structured_data). Mesma garantia do
 * auditedUpdate: old_data capturado com FOR UPDATE e trilha em agent_audit_log DENTRO
 * da mesma transação — se o log falhar, a mutação sofre rollback.
 *
 *   await auditedUpdateRow(pool, {
 *     table: 'db_restaurants', pk: 'restaurant_id', id: r.restaurant_id,
 *     set: 'price_range_id=$1, verification_source=$2',   // placeholders $1..$n
 *     params: [tier, 'places_v1_pricerange'],              // na ordem dos placeholders
 *     extraWhere: 'images_json IS NULL',                   // opcional, literal sem parâmetros
 *     agent: 'price_fill', reason: 'faixa de preço via Places v1',
 *   });
 *   // → { rowCount: 0|1 }
 */
async function auditedUpdateRow(pool, opts) {
  const { table, pk, id, set, params = [], extraWhere = '', agent, reason } = opts;
  if (!table || !pk || id === undefined || id === null || !set || !agent) throw new Error('auditedUpdateRow: table, pk, id, set e agent são obrigatórios');
  if (!/^[a-z_][a-z0-9_]*$/i.test(table) || !/^[a-z_][a-z0-9_]*$/i.test(pk)) throw new Error('auditedUpdateRow: nome de tabela/pk inválido');
  if (/\$\d+/.test(extraWhere)) throw new Error('auditedUpdateRow: extraWhere não pode ter placeholders');

  const idx = params.length + 1;
  const where = `${pk} = $${idx}${extraWhere ? ` AND (${extraWhere})` : ''}`;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const before = await client.query(
      `SELECT to_jsonb(t) AS old_data FROM public.${table} t WHERE ${pk} = $1${extraWhere ? ` AND (${extraWhere})` : ''} FOR UPDATE`, [id]);
    if (before.rowCount === 0) { await client.query('ROLLBACK'); return { rowCount: 0 }; }

    const upd = await client.query(`UPDATE public.${table} SET ${set} WHERE ${where}`, [...params, id]);
    if (upd.rowCount !== 1) { await client.query('ROLLBACK'); throw new Error(`auditedUpdateRow: UPDATE afetou ${upd.rowCount} linha(s), esperado 1 — rollback`); }

    await client.query(
      `INSERT INTO public.agent_audit_log (table_name, operation, record_id, old_data, new_data, agent, created_at)
       VALUES ($1,'UPDATE',$2,$3,$4,$5,NOW())`,
      [table, String(id), JSON.stringify(before.rows[0].old_data), JSON.stringify({ set, params, reason }), agent]);

    await client.query('COMMIT');
    return { rowCount: 1 };
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    throw e;
  } finally {
    client.release();
  }
}

module.exports = { auditedUpdate, auditedUpdateRow };
