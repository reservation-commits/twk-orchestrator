'use strict';
/**
 * Regência — leitura do twk_auth via role twk_ro. Self-contained (roda na Central hospedada ou local).
 * Credencial: DATABASE_URL_RO (env) ou, localmente, o .env.readonly.local do DBA.
 * Aborta se a sessão não for read-only. Nunca seleciona PII de cliente.
 */
const fs = require('node:fs');
const path = require('node:path');

function urlRo() {
  if (process.env.DATABASE_URL_RO) return process.env.DATABASE_URL_RO;
  const local = path.resolve(__dirname, '..', '..', '..', 'Agente Gerenciador do Banco de Dados', 'twk-db-agent', '.env.readonly.local');
  if (fs.existsSync(local)) { const m = fs.readFileSync(local, 'utf8').match(/DATABASE_URL_RO=(.+)/); if (m) return m[1].trim().replace(/^"|"$/g, ''); }
  return null;
}
function pg() {
  try { return require('pg'); } catch {}
  try { return require(path.resolve(__dirname, '..', '..', '..', 'Agente Gerenciador do Banco de Dados', 'twk-db-agent', 'node_modules', 'pg')); } catch {}
  return null;
}
function disponivel() { return !!(urlRo() && pg()); }

/**
 * Estabelecimentos de teste — excluídos de TODA contagem de relatório (fundador, 2026-09-06).
 * Fonte única: orchestrator/state/excluidos-teste.json. Se o arquivo sumir, falha alto:
 * é melhor o relatório não sair do que sair inflado por casas de teste.
 */
function idsTeste() {
  // Na máquina do Orquestrador a fonte é o repositório; na Central hospedada é a cópia que o
  // push-state.ps1 sincroniza para STATE_DIR (v4.5.2). Sem nenhuma das duas, falha alto.
  const candidatos = [
    path.resolve(__dirname, '..', '..', '..', 'orchestrator', 'state', 'excluidos-teste.json'),
    path.join(process.env.STATE_DIR || path.resolve(__dirname, '..', 'state'), 'excluidos-teste.json'),
  ];
  const f = candidatos.find((p) => fs.existsSync(p));
  if (!f) throw new Error('excluidos-teste.json ausente (repositório e STATE_DIR) — contagens não podem sair sem a lista de casas de teste');
  const j = JSON.parse(fs.readFileSync(f, 'utf8'));
  return (j.restaurantes || []).map((r) => String(r.restaurant_id));
}
/** Lista SQL literal e segura (ids são validados: só letras, números e hífen). */
function sqlExcluidos() {
  const ids = idsTeste().filter((id) => /^[A-Za-z0-9-]+$/.test(id));
  return ids.length ? ids.map((id) => `'${id}'`).join(',') : `''`;
}

async function comCliente(fn) {
  const P = pg(); const url = urlRo();
  if (!P || !url) throw new Error('sem_credencial: DATABASE_URL_RO ou módulo pg ausentes');
  const c = new P.Client({ connectionString: url, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000, statement_timeout: 45000 });
  await c.connect();
  try {
    const w = await c.query("select current_setting('default_transaction_read_only') ro");
    if (w.rows[0].ro !== 'on') throw new Error('sessão não é read-only — abortado');
    return await fn(c);
  } finally { await c.end(); }
}

/** Um único round-trip com as métricas que o MAESTRO precisa por ciclo. */
async function snapshot() {
  return comCliente(async (c) => {
    const EX = sqlExcluidos(); // casas de teste fora de toda contagem
    const q = async (sql) => (await c.query(sql)).rows[0];
    const cat = await q(`select count(*)::int total, count(*) filter (where published)::int publicados, count(*) filter (where partner)::int parceiros from db_restaurants where restaurant_id not in (${EX})`);
    const contas = await q(`select count(*)::int contas, count(distinct restaurant_id)::int casas, count(*) filter (where created_at >= now()-interval '24 hours')::int novas_24h, count(*) filter (where created_at >= now()-interval '7 days')::int novas_7d from restaurant_users where restaurant_id not in (${EX})`);
    const pend = await q(`select count(*)::int vivas, count(distinct restaurant_id)::int casas, count(*) filter (where booking_date = current_date)::int mesa_hoje, count(*) filter (where booking_date = current_date + 1)::int mesa_amanha from reservations where expired_at is null and booking_status in ('Pending','In Treatment') and booking_date >= current_date and restaurant_id not in (${EX})`);
    const fluxo = await q(`with d as (select distinct customer_id, booking_date, reservation_time, min(created_date) cd, min(booking_status) st from reservations where created_date >= now()-interval '7 days' and restaurant_id not in (${EX}) group by 1,2,3)
      select count(*)::int pedidos_7d, count(*) filter (where cd >= now()-interval '24 hours')::int pedidos_24h, count(*) filter (where st ilike 'accept%')::int aceitos_7d, count(*) filter (where st ilike 'decline%')::int recusados_7d from d`);
    const naoParc = await q(`select count(*)::int pedidos, count(*) filter (where s.booking_status ilike 'accept%')::int aceitos from reservations s join db_restaurants r on r.restaurant_id=s.restaurant_id where s.created_date >= now()-interval '30 days' and r.partner is not true and r.restaurant_id not in (${EX})`);
    const parc = await q(`select count(*)::int pedidos, count(*) filter (where s.booking_status ilike 'accept%')::int aceitos from reservations s join db_restaurants r on r.restaurant_id=s.restaurant_id where s.created_date >= now()-interval '30 days' and r.partner is true and r.restaurant_id not in (${EX})`);
    const despub = (await c.query(`select r.restaurant_id, r.name, r.slug, count(*)::int n, max(s.created_date)::text ultimo_pedido from reservations s join db_restaurants r on r.restaurant_id=s.restaurant_id where s.expired_at is null and s.booking_status in ('Pending','In Treatment') and s.booking_date >= current_date and r.published = false and r.restaurant_id not in (${EX}) group by 1,2,3 order by 4 desc limit 10`)).rows;
    const esc = await q(`select count(*) filter (where status='open')::int abertas, count(*) filter (where status='open' and created_at < now()-interval '24 hours')::int abertas_24h, count(*) filter (where created_at >= now()-interval '24 hours')::int novas_24h from aria_escalations`);
    // Incidente de 11/09: a Aria prometeu a clientes que "a equipe" cobraria o restaurante
    // em 2 horas. followup_6h_sent_at nunca foi preenchido em toda a base — a cobrança
    // automática jamais existiu. Este número é a distância entre o que prometemos e o que fazemos.
    const semCobranca = await q(`select count(*)::int total, count(*) filter (where booking_date <= current_date + 3)::int em_3_dias, count(distinct restaurant_id)::int casas
      from reservations where expired_at is null and booking_status in ('Pending','In Treatment') and booking_date >= current_date and followup_6h_sent_at is null and restaurant_id not in (${EX})`);
    const escTags = (await c.query(`select tag, count(*)::int n, min(created_at) desde from aria_escalations where status='open' group by 1 order by 2 desc`)).rows;
    const hand = await q(`select count(*) filter (where until > now())::int ativos from aria_handoffs`);
    const consent = await q(`select count(*)::int linhas, count(*) filter (where outbound_opted_out)::int optout from aria_contact_consent`);
    const generic = await q(`with h as (select restaurant_id, count(distinct (open_time,close_time)) k, count(*) d from opening_hours group by 1) select count(*) filter (where k=1 and d>=6)::int genericos from h join db_restaurants r using(restaurant_id) where r.published and r.restaurant_id not in (${EX})`);
    const cand = (await c.query(`select restaurant_name, full_name, status, created_at, expires_at,
        case when expires_at is null then null else round(extract(epoch from (expires_at - now())) / 3600)::int end as horas_para_vencer,
        round(extract(epoch from (now() - created_at)) / 3600)::int as horas_desde_pedido
        from restaurant_invitations
       where status not in ('completed','expired','rejected','cancelled')
       order by expires_at nulls last`)).rows;
    // Cadastros CONCLUÍDOS — é o número que o projeto inteiro persegue.
    const concl = (await c.query(`select restaurant_name, completed_at from restaurant_invitations
       where status = 'completed' and completed_at >= now() - interval '7 days'
       order by completed_at desc`)).rows;
    const audit = (await c.query(`select agent, count(*)::int n from agent_audit_log where created_at >= now()-interval '24 hours' group by 1`)).rows;
    // Pulso da Aria: recebeu e respondeu? (aria_messages.direction). Em 06-10/09 ela ficou 4 dias muda e ninguem viu.
    const aria = await q(`select count(*) filter (where direction='inbound' and created_at >= now()-interval '24 hours')::int inbound_24h, count(*) filter (where direction='outbound' and created_at >= now()-interval '24 hours')::int outbound_24h, round(extract(epoch from (now() - max(created_at) filter (where direction='outbound')))/3600)::int horas_sem_envio, (select count(*)::int from aria_pending_emails) fila_pendente from aria_messages`);
    return { cat, contas, pend, fluxo, naoParc, parc, despub, esc, escTags, hand, consent, generic, audit, cand, concl, aria, semCobranca };
  });
}

/** slug público de cada restaurante, por id. Usado para sondar se a ficha saiu do ar de verdade. */
async function slugs(ids) {
  if (!ids || !ids.length) return {};
  return comCliente(async (c) => {
    const r = await c.query('select restaurant_id, slug, name from db_restaurants where restaurant_id = ANY($1)', [ids.map(String)]);
    return Object.fromEntries(r.rows.map((x) => [String(x.restaurant_id), { slug: x.slug, name: x.name }]));
  });
}

module.exports = { disponivel, comCliente, snapshot, slugs, sqlExcluidos };
