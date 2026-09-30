#!/usr/bin/env node
/**
 * Gera o SQL de opt-in dos ESTABELECIMENTOS para a porta única (executar.js), a partir do catálogo.
 *
 *   node orchestrator/agents/chave-girada/ativacao/optin-sql.cjs            # top 40 por pedidos (90 d)
 *   node orchestrator/agents/chave-girada/ativacao/optin-sql.cjs --n 20 --so-movel
 *
 * Saída: orchestrator/state/ativacao/optin-estabelecimentos.sql (fora do git — contém telefones das casas).
 * Regras: só casas publicadas, com número válido em E.164 (móvel ou fixo — a v12 aceita fixo marcado);
 * casas no Registro de Opt-out de Listagem ficam de fora; idioma pelo país. O fundador revisa a lista,
 * apaga as linhas que não quiser, e roda:  node orchestrator/agents/dba-escrita/executar.js <arquivo> --apply --autonomo
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const RAIZ = path.resolve(__dirname, '..', '..', '..', '..');
const args = process.argv.slice(2);
const N = args.includes('--n') ? Number(args[args.indexOf('--n') + 1]) : 40;
const SO_MOVEL = args.includes('--so-movel');
const OUT = path.join(RAIZ, 'orchestrator', 'state', 'ativacao', 'optin-estabelecimentos.sql');
const IDIOMA = { Portugal: 'pt', Brazil: 'pt', France: 'fr', Belgium: 'fr', Morocco: 'fr', Tunisia: 'fr', Monaco: 'fr', Italy: 'it', Spain: 'es', Argentina: 'es', Colombia: 'es', Mexico: 'es', Chile: 'es', Germany: 'de', Austria: 'de' };
function envDe(rel) {
  return Object.fromEntries(fs.readFileSync(path.join(RAIZ, rel), 'utf8').split(/[\r\n]+/).filter((l) => l && !l.startsWith('#')).map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]; }));
}
(async () => {
  const { Client } = require(path.join(RAIZ, 'Agente de Suporte e Concierge', 'node_modules', 'pg'));
  const { avaliarTelefone } = require(path.join(RAIZ, 'Agente de Suporte e Concierge', 'dist', 'phoneQuality.js'));
  const { parsePhoneNumberFromString } = require(path.join(RAIZ, 'Agente de Suporte e Concierge', 'node_modules', 'libphonenumber-js', 'max'));
  const ISO = { Portugal: 'PT', Brazil: 'BR', France: 'FR', Belgium: 'BE', Morocco: 'MA', Tunisia: 'TN', Monaco: 'MC', Italy: 'IT', Spain: 'ES', Argentina: 'AR', Colombia: 'CO', Mexico: 'MX', Chile: 'CL', Germany: 'DE', Austria: 'AT', Thailand: 'TH', Greece: 'GR', Türkiye: 'TR', Turkey: 'TR', China: 'CN', 'United Kingdom': 'GB', 'United States': 'US', Israel: 'IL', Qatar: 'QA', Malaysia: 'MY', 'South Korea': 'KR', Maldives: 'MV', Egypt: 'EG', Japan: 'JP', Singapore: 'SG' };
  // Número ambíguo (lido sem país parece brasileiro): a casa está no catálogo COM o país — desempata por ele.
  const desambiguar = (tel, pais) => { try { const p = parsePhoneNumberFromString('+' + String(tel ?? '').replace(/\D/g, '')); if (!p || !p.isValid() || !ISO[pais] || p.country !== ISO[pais]) return null; const t = p.getType() ?? ''; return { e164: p.number, qualidade: t === 'MOBILE' || t === 'FIXED_LINE_OR_MOBILE' ? 'ENVIAVEL' : 'ENVIAVEL_NAO_MOVEL' }; } catch { return null; } };
  const c = new Client({ connectionString: envDe('Agente Gerenciador do Banco de Dados/twk-db-agent/.env.readonly.local').DATABASE_URL_RO, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const { rows } = await c.query(`
    SELECT r.restaurant_id, r.name, r.city, r.country, r.telephone_of_the_establishment AS tel,
           count(*) FILTER (WHERE v.created_date >= now() - interval '90 days')::int AS p90
      FROM db_restaurants r JOIN reservations v ON v.restaurant_id = r.restaurant_id
     WHERE r.published AND NOT EXISTS (SELECT 1 FROM v_listing_consent_atual o WHERE o.restaurant_id = r.restaurant_id)
     GROUP BY 1,2,3,4,5 ORDER BY p90 DESC LIMIT $1`, [N]);
  await c.end();
  const linhas = [];
  const fora = [];
  for (const r of rows) {
    let a = avaliarTelefone(r.tel);
    if (a.qualidade === 'AMBIGUO_BR') { const d = desambiguar(r.tel, r.country); if (d) a = { ...a, ...d, motivo: 'desambiguado pelo país do catálogo' }; }
    const ok = a.qualidade === 'ENVIAVEL' || (!SO_MOVEL && a.qualidade === 'ENVIAVEL_NAO_MOVEL');
    if (!ok || !a.e164) { fora.push(`${r.name} (${r.city}): telefone ${a.qualidade}`); continue; }
    const idioma = IDIOMA[r.country] || 'en';
    const motivo = `${r.p90} pedidos/90d · ${a.qualidade === 'ENVIAVEL' ? 'celular' : 'fixo'} do catálogo`;
    linhas.push(`  ('${a.e164}', true, 'estabelecimento', '${String(r.restaurant_id).replace(/'/g, "''")}', 'fundador', '${motivo.replace(/'/g, "''")}', '${idioma}', NOW())  -- ${r.name.replace(/[\r\n]/g, ' ')} · ${r.city}`);
  }
  const telefones = linhas.map((l) => l.match(/\('(\+\d+)'/)[1]);
  const sql = [
    `-- Opt-in de ESTABELECIMENTOS para receber pedidos de mesa no WhatsApp (gerado ${new Date().toISOString().slice(0, 10)}).`,
    '-- Revise a lista: apague as linhas que não quiser. Depois:',
    '--   node orchestrator/agents/dba-escrita/executar.js orchestrator/state/ativacao/optin-estabelecimentos.sql --apply --autonomo',
    `-- backup: public.aria_contact_consent where phone in (${telefones.map((t) => `'${t}'`).join(', ') || "''"})`,
    '--',
    `-- Fora da lista (telefone inválido/ambíguo): ${fora.length ? fora.join('; ') : 'nenhum'}`,
    'BEGIN;',
    'INSERT INTO public.aria_contact_consent (phone, whatsapp_reservas, tipo, restaurant_id, source, motivo, idioma, updated_at)',
    'VALUES',
    linhas.join(',\n'),
    'ON CONFLICT (phone) DO UPDATE',
    '  SET whatsapp_reservas = EXCLUDED.whatsapp_reservas,',
    '      tipo              = EXCLUDED.tipo,',
    '      restaurant_id     = COALESCE(EXCLUDED.restaurant_id, aria_contact_consent.restaurant_id),',
    '      source            = EXCLUDED.source,',
    '      motivo            = EXCLUDED.motivo,',
    '      idioma            = COALESCE(EXCLUDED.idioma, aria_contact_consent.idioma),',
    '      updated_at        = NOW();',
    'COMMIT;',
    '',
  ].join('\n');
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, sql, 'utf8');
  console.log(`casas incluídas: ${linhas.length} · fora: ${fora.length} → ${path.relative(RAIZ, OUT)}`);
})().catch((e) => { console.error('ERRO', e.message); process.exit(1); });
