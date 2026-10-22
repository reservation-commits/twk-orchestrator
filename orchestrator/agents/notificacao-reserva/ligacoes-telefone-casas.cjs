#!/usr/bin/env node
'use strict';
/**
 * Lista de UMA ligação por casa (plano C3, 2026-10-22): as casas cujo WhatsApp não recebe.
 *
 *   node orchestrator/agents/notificacao-reserva/ligacoes-telefone-casas.cjs
 *   → orchestrator/state/ligacoes-telefone-casas-<data>.csv
 *
 * Duas origens, somente leitura (twk_ro):
 *   1. casas marcadas (opt-in) cujo número a Meta devolveu "undeliverable" (aria_contact_consent.whatsapp_indisponivel);
 *   2. casas cujo telefone do catálogo ficou "ambíguo" ou "inválido" nos lembretes dos últimos 30 dias (aria_outbound_log),
 *      com o número bruto e o país do cadastro — a v22 da Aria resolve o ambíguo pelo país; o que sobra pede uma ligação.
 * Prioridade = pedidos de mesa nos últimos 90 dias (quem mais recebe pedido fala primeiro).
 * O CSV é contato comercial da casa (não é PII de cliente) e fica em orchestrator/state.
 */
const fs = require('node:fs');
const path = require('node:path');
const { comClienteRo } = require('../_lib/conectar');

const RAIZ = path.resolve(__dirname, '..', '..', '..');
const hoje = new Date().toISOString().slice(0, 10);
const saida = path.join(RAIZ, 'orchestrator', 'state', `ligacoes-telefone-casas-${hoje}.csv`);

(async () => {
  const linhas = await comClienteRo(async (c) => {
    const r = await c.query(`
      WITH pedidos AS (
        SELECT restaurant_id, count(*)::int AS pedidos_90d
          FROM public.reservations WHERE created_date >= now() - interval '90 days' GROUP BY 1),
      indisponiveis AS (
        SELECT cc.restaurant_id, 'undeliverable (Meta)' AS motivo, cc.phone AS numero_marcado, cc.indisponivel_em::date AS desde
          FROM public.aria_contact_consent cc
         WHERE cc.tipo = 'estabelecimento' AND cc.whatsapp_reservas AND COALESCE(cc.whatsapp_indisponivel, false)),
      ambiguos AS (
        SELECT r.restaurant_id, min(o.motivo) AS motivo, NULL::text AS numero_marcado, min(o.created_at)::date AS desde
          FROM public.aria_outbound_log o
          JOIN public.reservations r ON r.reservation_code = o.reservation_code
         WHERE o.created_at >= now() - interval '30 days'
           AND o.evento LIKE '%:estabelecimento' AND o.desfecho = 'telefone_nao_enviavel'
         GROUP BY r.restaurant_id)
      SELECT x.motivo, d.restaurant_id, d.name, d.city, d.country, upper(btrim(d.country_code)) AS pais,
             d.telephone_of_the_establishment AS telefone_catalogo, x.numero_marcado, d.email_for_reservations AS email,
             COALESCE(p.pedidos_90d, 0) AS pedidos_90d, x.desde
        FROM (SELECT * FROM indisponiveis UNION ALL SELECT * FROM ambiguos) x
        JOIN public.db_restaurants d ON d.restaurant_id = x.restaurant_id
        LEFT JOIN pedidos p ON p.restaurant_id = d.restaurant_id
       WHERE d.published
       ORDER BY COALESCE(p.pedidos_90d, 0) DESC, d.name`);
    return r.rows;
  });
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const cab = ['prioridade', 'motivo', 'restaurant_id', 'nome', 'cidade', 'pais_cadastro', 'telefone_catalogo', 'numero_marcado', 'email', 'pedidos_90d', 'desde', 'o_que_pedir'];
  const csv = [cab.join(';'), ...linhas.map((l, i) => [i + 1, l.motivo, l.restaurant_id, l.name, l.city, l.pais, l.telefone_catalogo, l.numero_marcado, l.email, l.pedidos_90d, l.desde ? String(l.desde).slice(0, 10) : '', 'o número de celular com WhatsApp Business da casa, com o código do país (+)'].map(esc).join(';'))].join('\n');
  fs.writeFileSync(saida, csv, 'utf8');
  console.log(`${linhas.length} casa(s) para ligar · ${path.relative(RAIZ, saida)}`);
  for (const l of linhas.slice(0, 12)) console.log(`  ${String(l.pedidos_90d).padStart(3)} pedidos · ${l.name} (${l.city}, ${l.pais || '??'}) · ${l.motivo}`);
})().catch((e) => { console.error('FALHA:', e.message); process.exit(2); });
