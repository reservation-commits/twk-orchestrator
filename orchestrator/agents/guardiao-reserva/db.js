'use strict';
/**
 * Acesso SOMENTE LEITURA ao twk_auth via role twk_ro (bloqueio de escrita no servidor).
 * Credencial: Agente Gerenciador do Banco de Dados/twk-db-agent/.env.readonly.local (DATABASE_URL_RO).
 * `pg` é resolvido do node_modules do DBA — sem instalar nada novo neste repositório.
 * Nunca seleciona PII do cliente: só códigos, datas, ids e domínio do e-mail da casa.
 */
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.resolve(__dirname, '..', '..', '..');
const DBA_DIR = path.join(RAIZ, 'Agente Gerenciador do Banco de Dados', 'twk-db-agent');

function urlRo() {
  const envFile = process.env.TWK_RO_ENV || path.join(DBA_DIR, '.env.readonly.local');
  if (process.env.DATABASE_URL_RO) return process.env.DATABASE_URL_RO;
  if (!fs.existsSync(envFile)) throw new Error(`credencial read-only ausente: ${envFile}`);
  const m = fs.readFileSync(envFile, 'utf8').match(/DATABASE_URL_RO=(.+)/);
  if (!m) throw new Error('DATABASE_URL_RO não encontrada no .env.readonly.local');
  return m[1].trim().replace(/^"|"$/g, '');
}

function pg() {
  try { return require(path.join(DBA_DIR, 'node_modules', 'pg')); }
  catch { return require('pg'); }
}

// A1 (2026-10-22): conexão com nova tentativa (0 s, 60 s, 180 s) pela biblioteca comum — em 19 e 20/10 a
// tarefa morreu em "timeout expired" ao ligar o notebook antes do Wi-Fi. A conferência read-only continua.
const { comClienteRo } = require('../_lib/conectar');
async function comCliente(fn) {
  return comClienteRo(fn, { log: (m) => console.error(`[guardiao/db] ${m}`) });
}

/** Pendências vivas + dados mínimos da casa (sem PII de cliente). */
async function carregarPendencias() {
  return comCliente(async (c) => {
    const r = await c.query(`
      SELECT s.reservation_code, s.booking_date::text AS booking_date, s.reservation_time::text AS reservation_time,
             s.created_date::text AS created_date, s.booking_status, s.restaurant_id,
             r.name, r.city, r.country, r.partner, r.published, r.timezone,
             (r.email_for_reservations IS NOT NULL AND r.email_for_reservations <> '') AS tem_email,
             lower(split_part(r.email_for_reservations,'@',2)) AS email_dominio,
             (r.telephone_of_the_establishment IS NOT NULL AND r.telephone_of_the_establishment <> '') AS tem_telefone,
             r.telephone_of_the_establishment AS telefone_casa,
             r.slug,
             EXISTS (SELECT 1 FROM public.aria_contact_consent cc
                      WHERE cc.tipo = 'estabelecimento' AND cc.restaurant_id::text = r.restaurant_id::text
                        AND cc.whatsapp_reservas AND NOT COALESCE(cc.whatsapp_indisponivel, false)
                        AND NOT COALESCE(cc.outbound_opted_out, false)) AS casa_whatsapp
        FROM public.reservations s
        JOIN public.db_restaurants r ON r.restaurant_id = s.restaurant_id
       WHERE s.expired_at IS NULL
         AND s.booking_status IN ('Pending','In Treatment')
         AND s.booking_date >= CURRENT_DATE - 1
       ORDER BY s.booking_date, s.reservation_time`);
    const reservas = []; const restaurantes = {};
    for (const x of r.rows) {
      reservas.push({ reservation_code: x.reservation_code, restaurant_id: String(x.restaurant_id), booking_date: x.booking_date, reservation_time: x.reservation_time, created_date: x.created_date.replace(' ', 'T') + 'Z', booking_status: x.booking_status });
      restaurantes[String(x.restaurant_id)] = { restaurant_id: String(x.restaurant_id), name: x.name, city: x.city, country: x.country, partner: !!x.partner, published: x.published !== false, timezone: x.timezone || null, tem_email: !!x.tem_email, email_dominio: x.email_dominio || null, tem_telefone: !!x.tem_telefone, telefone_casa: x.telefone_casa || null, slug: x.slug, casa_whatsapp: !!x.casa_whatsapp };
    }
    return { reservas, restaurantes };
  });
}

/** Casas que respondem: ≥4 pedidos em 90d e ≥50% de aceite — candidatas a alternativa (degrau 4). */
async function carregarRespondedoras() {
  return comCliente(async (c) => {
    const r = await c.query(`
      WITH x AS (SELECT restaurant_id, COUNT(*) n, COUNT(*) FILTER (WHERE booking_status ILIKE 'accept%') a
                   FROM public.reservations WHERE created_date >= now() - interval '90 days' GROUP BY 1)
      SELECT r.restaurant_id, r.name, r.city, r.slug, r.partner, x.n, x.a
        FROM x JOIN public.db_restaurants r ON r.restaurant_id = x.restaurant_id
       WHERE x.n >= 4 AND x.a::float / x.n >= 0.5 AND r.published = true`);
    return r.rows.map((x) => ({ restaurant_id: String(x.restaurant_id), name: x.name, city: x.city, slug: x.slug, partner: !!x.partner, pedidos_90d: Number(x.n), aceitos_90d: Number(x.a) }));
  });
}

/** Status atual por código (para medir respostas após contato). */
async function statusPorCodigo(codigos) {
  if (!codigos.length) return {};
  return comCliente(async (c) => {
    const r = await c.query('SELECT reservation_code, booking_status, expired_at FROM public.reservations WHERE reservation_code = ANY($1)', [codigos]);
    return Object.fromEntries(r.rows.map((x) => [x.reservation_code, { status: x.booking_status, expired_at: x.expired_at }]));
  });
}

module.exports = { carregarPendencias, carregarRespondedoras, statusPorCodigo, comCliente };
