/*
 * expire_stale_pendings.js — rotina diária: marca com expired_at as reservas que
 * ficaram Pending/In Treatment e cuja data já passou sem resposta.
 *
 * booking_status é PRESERVADO (decisão de 2026-08-28: nenhum valor novo circula
 * por site/n8n/Aria/painéis). Pendência VIVA = expired_at IS NULL.
 * Idempotente: só toca linhas ainda não marcadas. Auditado via db-audited.js.
 *
 *   node expire_stale_pendings.js            → DRY RUN
 *   node expire_stale_pendings.js --apply    → marca e audita
 */
const { Pool } = require('./twk-db-agent/node_modules/pg');
const { CONN, SSL } = require('./db-config');
const pool = new Pool({ connectionString: CONN, ssl: SSL });
const APPLY = process.argv.includes('--apply');

const WHERE = `booking_status IN ('Pending','In Treatment') AND booking_date < CURRENT_DATE AND expired_at IS NULL`;

(async () => {
  const n = (await pool.query(`SELECT COUNT(*)::int c FROM public.reservations WHERE ${WHERE}`)).rows[0].c;
  const vivas = (await pool.query(
    `SELECT COUNT(*)::int c FROM public.reservations
      WHERE booking_status IN ('Pending','In Treatment') AND expired_at IS NULL AND booking_date >= CURRENT_DATE`)).rows[0].c;
  console.log(`Novas vencidas a expirar: ${n} | pendências vivas (intocadas): ${vivas} | modo: ${APPLY ? 'APPLY' : 'DRY RUN'}`);

  if (APPLY && n > 0) {
    // Escrita direta com trilha de lote: reservations é grande demais para linha-a-linha
    // de old_data; o critério + contagem + rollback ficam registrados.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const up = await client.query(`UPDATE public.reservations SET expired_at = now() WHERE ${WHERE}`);
      await client.query(
        `INSERT INTO public.agent_audit_log (table_name, operation, record_id, old_data, new_data, agent, created_at)
         VALUES ('reservations','UPDATE','__job_expiracao_diaria__',$1,$2,'expire_stale_pendings',NOW())`,
        [JSON.stringify({ criterio: WHERE, expired_at: null }),
         JSON.stringify({ linhas_afetadas: up.rowCount, expired_at: 'now()',
                          rollback: 'UPDATE reservations SET expired_at=NULL WHERE expired_at::date = CURRENT_DATE' })]);
      await client.query('COMMIT');
      console.log(`Expiradas hoje: ${up.rowCount}`);
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch (_) {}
      throw e;
    } finally { client.release(); }
  }

  // Diagnóstico de agendamento server-side (informativo)
  try {
    const ext = await pool.query(`SELECT name, default_version, installed_version FROM pg_available_extensions WHERE name='pg_cron'`);
    console.log(ext.rowCount
      ? `pg_cron disponível no servidor (instalada: ${ext.rows[0].installed_version || 'não'}) — dá para agendar no próprio banco`
      : 'pg_cron NÃO disponível — agendar externamente (n8n ou Agendador de Tarefas)');
  } catch (_) { /* sem permissão para ver extensões; irrelevante */ }
  await pool.end();
})().catch(e => { console.error('ERRO:', e.message); pool.end(); process.exit(1); });
