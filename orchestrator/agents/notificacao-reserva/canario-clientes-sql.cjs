#!/usr/bin/env node
/**
 * Gera o SQL de opt-in do CANÁRIO DE CLIENTES para a porta única (executar.js).
 *
 *   node orchestrator/agents/notificacao-reserva/canario-clientes-sql.cjs            # 15 clientes
 *   node orchestrator/agents/notificacao-reserva/canario-clientes-sql.cjs --n 20
 *
 * Saída: orchestrator/state/ativacao/optin-clientes-canario.sql (fora do git — contém telefones).
 *
 * Critérios (01/10/2026, decisão do fundador: canário pequeno antes da caixa no formulário):
 *   - pedido pendente VIVO (expired_at IS NULL), mesa a partir de amanhã, casa publicada;
 *   - telefone ENVIAVEL (celular em E.164 inequívoco — a mesma trava do envio; fixo e ambíguo ficam fora);
 *   - ainda sem linha em aria_contact_consent (não mexe em quem já decidiu);
 *   - um pedido por telefone; prioridade: casa já marcada para WhatsApp (os dois lados vivos),
 *     depois casa que mais aceita em 90 dias, depois mesa mais próxima;
 *   - idioma pelo país do telefone (pt/fr/es/it/de, senão en) — o template sai no idioma da pessoa.
 * O arquivo usa ON CONFLICT DO NOTHING: nunca sobrescreve um consentimento existente.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const RAIZ = path.resolve(__dirname, '..', '..', '..');
const args = process.argv.slice(2);
const N = args.includes('--n') ? Number(args[args.indexOf('--n') + 1]) : 15;
const OUT = path.join(RAIZ, 'orchestrator', 'state', 'ativacao', 'optin-clientes-canario.sql');
const HOJE = new Date().toISOString().slice(0, 10);
const IDIOMA_POR_PAIS = { BR: 'pt', PT: 'pt', FR: 'fr', BE: 'fr', MC: 'fr', MA: 'fr', TN: 'fr', ES: 'es', AR: 'es', CO: 'es', MX: 'es', CL: 'es', IT: 'it', DE: 'de', AT: 'de' };
const mask = (p) => String(p).replace(/^(\+\d{2,3})\d+(\d{2})$/, '$1…$2');
function envDe(rel) {
  return Object.fromEntries(fs.readFileSync(path.join(RAIZ, rel), 'utf8').split(/[\r\n]+/).filter((l) => l && !l.startsWith('#')).map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]; }));
}
(async () => {
  const { Client } = require(path.join(RAIZ, 'Agente de Suporte e Concierge', 'node_modules', 'pg'));
  const { avaliarTelefone, podeReceberWhatsApp } = require(path.join(RAIZ, 'Agente de Suporte e Concierge', 'dist', 'phoneQuality.js'));
  const c = new Client({ connectionString: envDe('Agente Gerenciador do Banco de Dados/twk-db-agent/.env.readonly.local').DATABASE_URL_RO, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const { rows } = await c.query(`
    WITH casa AS (
      SELECT restaurant_id,
             count(*) FILTER (WHERE created_date >= now() - interval '90 days')::int AS p90,
             count(*) FILTER (WHERE created_date >= now() - interval '90 days' AND lower(btrim(booking_status)) = 'accept')::int AS a90
        FROM reservations GROUP BY 1)
    SELECT r.reservation_code, u.phone AS tel, r.booking_date::text AS data, r.reservation_time::text AS hora,
           d.name AS casa, d.city AS cidade, d.country AS pais_casa, casa.p90, casa.a90,
           EXISTS (SELECT 1 FROM aria_contact_consent cc WHERE cc.restaurant_id = r.restaurant_id AND cc.tipo = 'estabelecimento'
                     AND cc.whatsapp_reservas AND NOT cc.outbound_opted_out AND NOT coalesce(cc.whatsapp_indisponivel, false)) AS casa_marcada
      FROM reservations r
      JOIN db_restaurants d ON d.restaurant_id = r.restaurant_id
      LEFT JOIN nextauth."User" u ON u.id = r.customer_id
      LEFT JOIN casa ON casa.restaurant_id = r.restaurant_id
     WHERE r.expired_at IS NULL
       AND lower(btrim(r.booking_status)) IN ('pending', 'in treatment')
       AND r.booking_date >= current_date + 1
       AND d.published
       AND u.phone IS NOT NULL AND btrim(u.phone) <> ''
     ORDER BY casa_marcada DESC, (casa.a90::float / NULLIF(casa.p90, 0)) DESC NULLS LAST, r.booking_date ASC`);
  const existentes = new Set((await c.query(`SELECT phone FROM aria_contact_consent`)).rows.map((x) => x.phone));
  await c.end();

  const linhas = [];
  const fora = {};
  const vistos = new Set();
  for (const r of rows) {
    if (linhas.length >= N) break;
    const a = avaliarTelefone(r.tel);
    if (!podeReceberWhatsApp(a)) { fora[a.qualidade] = (fora[a.qualidade] || 0) + 1; continue; }
    if (vistos.has(a.e164)) { fora.repetido = (fora.repetido || 0) + 1; continue; }
    vistos.add(a.e164);
    if (existentes.has(a.e164)) { fora.ja_tem_linha = (fora.ja_tem_linha || 0) + 1; continue; }
    const idioma = IDIOMA_POR_PAIS[a.pais] || 'en';
    const motivo = `canário ${HOJE} · pedido ${r.reservation_code} · ${r.casa} · ${r.data}${r.casa_marcada ? ' · casa marcada' : ''}`;
    linhas.push({
      e164: a.e164,
      tupla: `('${a.e164}', true, 'cliente', NULL, 'fundador:canario', '${motivo.replace(/'/g, "''")}', '${idioma}', NOW())`,
      comentario: `${r.reservation_code} · ${r.casa} (${r.cidade}) · ${r.data} ${String(r.hora || '').slice(0, 5)} · ${a.pais}/${idioma}${r.casa_marcada ? ' · casa marcada' : ''} · casa aceita ${r.a90}/${r.p90} em 90d`,
      resumo: { pedido: r.reservation_code, casa: r.casa, data: r.data, tel: mask(a.e164), idioma, casa_marcada: r.casa_marcada, aceites_90d: `${r.a90}/${r.p90}` },
    });
  }
  const telefones = linhas.map((l) => l.e164);
  const sql = [
    `-- Opt-in de CLIENTES — canário de ${linhas.length} (gerado ${HOJE}). Decisão do fundador: canário pequeno antes da caixa no formulário.`,
    '-- Revise a lista: apague as linhas que não quiser. Depois:',
    '--   node orchestrator/agents/dba-escrita/executar.js --sql orchestrator/state/ativacao/optin-clientes-canario.sql --apply --autonomo',
    `-- backup: public.aria_contact_consent where phone in (${telefones.map((t) => `'${t}'`).join(', ') || "''"})`,
    `-- Fora: ${Object.entries(fora).map(([k, v]) => `${k}=${v}`).join(', ') || 'nenhum'} (de ${rows.length} pedidos pendentes vivos com telefone)`,
    'BEGIN;',
    'INSERT INTO public.aria_contact_consent (phone, whatsapp_reservas, tipo, restaurant_id, source, motivo, idioma, updated_at)',
    'VALUES',
    linhas.map((l, i) => `  ${l.tupla}${i < linhas.length - 1 ? ',' : ''}  -- ${l.comentario}`).join('\n'),
    'ON CONFLICT (phone) DO NOTHING;',
    'COMMIT;',
    '',
  ].join('\n');
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, sql, 'utf8');
  console.log(`clientes no canário: ${linhas.length} de ${rows.length} pedidos pendentes vivos com telefone · fora: ${JSON.stringify(fora)} → ${path.relative(RAIZ, OUT)}`);
  console.table(linhas.map((l) => l.resumo));
})().catch((e) => { console.error('ERRO', e.message); process.exit(1); });
