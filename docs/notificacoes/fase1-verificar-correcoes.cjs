/**
 * Verificação da Fase 1 contra o banco REAL (somente leitura).
 * Compara a consulta ANTIGA com a NOVA e mede o efeito de cada correção:
 * caixa do booking_status, fuso do restaurante e filtro de pendência viva.
 *
 * Reexecutar depois de qualquer mexida em getReservationsForReminder ou
 * getStalePendingReservations (Agente de Suporte e Concierge/src/db.ts) —
 * as duas consultas abaixo são cópias das que estão em produção e precisam
 * ser atualizadas junto.
 *
 * USO:
 *   cd "Agente Gerenciador do Banco de Dados/twk-db-agent"
 *   NODE_PATH="$PWD/node_modules" node ../../docs/notificacoes/fase1-verificar-correcoes.cjs \
 *     "$PWD/.env.readonly.local"
 */
const fs = require("fs");
const { Client } = require("pg");
const url = fs.readFileSync(process.argv[2], "utf8").split(/\r?\n/)
  .find((l) => l.startsWith("DATABASE_URL_RO=")).slice("DATABASE_URL_RO=".length).trim().replace(/^["']|["']$/g, "");

const ANTIGA = `
  SELECT count(*)::int AS n
    FROM public.reservations r
    JOIN public.db_restaurants d ON r.restaurant_id = d.restaurant_id
    JOIN nextauth."User" u       ON r.customer_id = u.id
    LEFT JOIN public.aria_reminders_sent s
           ON s.reservation_code = r.reservation_code AND s.kind = $1
   WHERE r.booking_status = ANY($4::text[])
     AND u.phone IS NOT NULL
     AND s.id IS NULL
     AND (r.booking_date::timestamp + COALESCE(r.reservation_time, '00:00')::time)
           BETWEEN NOW() + ($2 || ' hours')::interval
               AND NOW() + ($3 || ' hours')::interval`;

const NOVA = `
  SELECT count(*)::int AS n
    FROM public.reservations r
    JOIN public.db_restaurants d ON r.restaurant_id = d.restaurant_id
    JOIN nextauth."User" u       ON r.customer_id = u.id
    LEFT JOIN pg_timezone_names z ON z.name = btrim(d.timezone)
    LEFT JOIN public.aria_reminders_sent s
           ON s.reservation_code = r.reservation_code AND s.kind = $1
   WHERE lower(btrim(r.booking_status)) = ANY($4::text[])
     AND u.phone IS NOT NULL
     AND s.id IS NULL
     AND ((r.booking_date + COALESCE(r.reservation_time, '00:00'::time))
            AT TIME ZONE COALESCE(z.name, 'UTC'))
           BETWEEN NOW() + ($2 || ' hours')::interval
               AND NOW() + ($3 || ' hours')::interval`;

(async () => {
  const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await c.connect();

  // 1) Efeito da caixa do status — janela larga (próximo ano), status 'accept'.
  const p = ["2h", "0", "8760"];
  const a = await c.query(ANTIGA, [...p, ["accept"]]);
  const n = await c.query(NOVA, [...p, ["accept"]]);
  console.log(`\n### caixa do status (janela de 1 ano, status 'accept')`);
  console.log(`consulta ANTIGA: ${a.rows[0].n} reservas   <-- era isto que o sistema via`);
  console.log(`consulta NOVA:   ${n.rows[0].n} reservas`);

  // Controle: com o valor exato do banco, a antiga também acha.
  const ctrl = await c.query(ANTIGA, [...p, ["Accept"]]);
  console.log(`controle (ANTIGA com 'Accept' exato): ${ctrl.rows[0].n} — confirma que a causa era só a caixa`);

  // 2) Efeito do fuso — de quanto cada reserva futura se desloca.
  const tz = await c.query(`
    SELECT d.timezone,
           count(*)::int AS reservas,
           round(avg(EXTRACT(EPOCH FROM (
             ((r.booking_date + COALESCE(r.reservation_time,'00:00'::time)) AT TIME ZONE 'UTC')
           - ((r.booking_date + COALESCE(r.reservation_time,'00:00'::time)) AT TIME ZONE z.name)
           )) / 3600)::numeric, 2) AS erro_horas
      FROM public.reservations r
      JOIN public.db_restaurants d ON r.restaurant_id = d.restaurant_id
      JOIN pg_timezone_names z ON z.name = btrim(d.timezone)
     WHERE r.booking_date >= CURRENT_DATE
     GROUP BY 1 ORDER BY 2 DESC LIMIT 8`);
  console.log(`\n### erro de fuso nas reservas futuras (horas que o lembrete erraria)`);
  for (const r of tz.rows) console.log(`  ${String(r.timezone).padEnd(22)} ${String(r.reservas).padStart(4)} reservas   erro ${r.erro_horas}h`);

  // 3) Watchdog de pendência: efeito da caixa + do filtro expired_at.
  const w = async (sql, params) => (await c.query(sql, params)).rows[0].n;
  const base = `SELECT count(*)::int AS n FROM public.reservations r
                 LEFT JOIN public.aria_reminders_sent s
                        ON s.reservation_code = r.reservation_code AND s.kind = 'pending_watch'
                 WHERE s.id IS NULL AND r.created_date < NOW() - interval '12 hours'
                   AND r.booking_date >= CURRENT_DATE`;
  console.log(`\n### watchdog de pendência (12h)`);
  console.log(`  ANTIGA  (status 'pending', sem filtro de expirada): ${await w(base + ` AND r.booking_status = 'pending'`, [])}`);
  console.log(`  só caixa corrigida, sem expired_at:                 ${await w(base + ` AND lower(btrim(r.booking_status)) = 'pending'`, [])}`);
  console.log(`  NOVA    (caixa + expired_at IS NULL):               ${await w(base + ` AND lower(btrim(r.booking_status)) = 'pending' AND r.expired_at IS NULL`, [])}`);

  // 4) A consulta nova não quebra com fuso inválido?
  const bad = await c.query(`
    SELECT count(*)::int AS n FROM public.db_restaurants d
     LEFT JOIN pg_timezone_names z ON z.name = btrim(d.timezone)
     WHERE d.published AND z.name IS NULL`);
  console.log(`\n### restaurantes publicados com fuso não reconhecido pelo Postgres: ${bad.rows[0].n}`);

  await c.end();
})().catch((e) => { console.error("FALHA:", e.message); process.exit(1); });
