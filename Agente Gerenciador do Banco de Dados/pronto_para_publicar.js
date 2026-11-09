#!/usr/bin/env node
/*
 * pronto_para_publicar.js — mede uma cidade contra o critério "verificada e completa".
 * SÓ LEITURA (twk_ro, via orchestrator/agents/_lib/conectar.js). Não escreve nada.
 *
 * Critério cheio (uma casa conta como completa só se passar em todos):
 *   status       operational_status = 'active'
 *   veto         do_not_relist falso e sem opt-out em orchestrator/state/listing-consent.jsonl
 *   nome, slug   nome ≥ 3 caracteres; slug kebab-case e único no catálogo
 *   tel          telefone internacional (+ e 8–15 dígitos)          — juiz de catálogo C6
 *   email        e-mail de reserva válido                            — C7
 *   site         site oficial presente
 *   endereco     endereço com mais de 10 caracteres
 *   horarios     horários não genéricos (não é 1 intervalo igual em ≥ 6 dias) — C8
 *   coords       dentro da caixa da cidade, quando a cidade tem caixa (Paris); senão plausíveis — C10
 *   preco        price_range_id presente
 *   place        place_id presente
 *   foto         capa + ao menos 1 foto de galeria
 *   texto        about_text ≥ 900 caracteres, about_html presente, sem o defeito "<h6>: restaurant in"
 *                e sem HTML colado de interface de chat (padrão de 4 blocos, ex.: Bonnie)
 *
 * Uso:
 *   node pronto_para_publicar.js [--city Paris] [--meta 300] [--json saida.json]
 * Registro de opt-out ilegível = falha (nenhuma casa conta como sem veto).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { comClienteRo } = require(path.resolve(__dirname, '..', 'orchestrator', 'agents', '_lib', 'conectar.js'));

const argv = process.argv.slice(2);
const val = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const CIDADE = val('city', 'Paris');
const META = parseInt(val('meta', '0'), 10);
const JSON_OUT = val('json', '');
const CAIXAS = { Paris: { lat: [48.80, 48.91], lng: [2.22, 2.47] } };

let optout;
try {
  optout = fs.readFileSync(path.resolve(__dirname, '..', 'orchestrator', 'state', 'listing-consent.jsonl'), 'utf8')
    .split('\n').filter(Boolean).map((l) => JSON.parse(l));
} catch (e) {
  console.error(`FALHA: registro de opt-out ilegível (${e.message}). Sem registro, nenhuma casa conta como liberada.`);
  process.exit(1);
}
const vetados = new Set(optout.filter((o) => o.status === 'opted_out' || o.do_not_relist).map((o) => String(o.restaurant_id)));

const CRITERIOS = ['status', 'veto', 'nome', 'slug', 'tel', 'email', 'site', 'endereco', 'horarios', 'coords', 'preco', 'place', 'foto', 'texto'];

comClienteRo(async (c) => {
  const cx = CAIXAS[CIDADE];
  const coords = cx
    ? `(d.latitude between ${cx.lat[0]} and ${cx.lat[1]} and d.longitude between ${cx.lng[0]} and ${cx.lng[1]})`
    : `(d.latitude is not null and d.longitude is not null and abs(d.latitude) <= 90 and abs(d.longitude) <= 180 and not (d.latitude = 0 and d.longitude = 0))`;
  const { rows } = await c.query(String.raw`
    with h as (select restaurant_id, count(distinct weekday) dias, count(distinct (open_time, close_time)) intervalos
               from opening_hours group by restaurant_id),
         s as (select slug, count(*) n from db_restaurants where slug is not null group by slug)
    select d.restaurant_id, d.name, d.slug, coalesce(d.published, false) published,
      coalesce(d.operational_status, '') = 'active' ok_status,
      coalesce(d.do_not_relist, false) do_not_relist,
      length(trim(coalesce(d.name, ''))) >= 3 ok_nome,
      coalesce(d.slug, '') ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and coalesce(s.n, 0) = 1 ok_slug,
      regexp_replace(coalesce(d.telephone_of_the_establishment, ''), '[\s().-]', '', 'g') ~ '^\+[1-9]\d{7,14}$' ok_tel,
      lower(trim(coalesce(d.email_for_reservations, ''))) ~ '^[^\s@]+@[^\s@]+\.[a-z]{2,}$' ok_email,
      coalesce(d.site_url, '') <> '' ok_site,
      length(trim(coalesce(d.address_of_establishment, ''))) > 10 ok_endereco,
      (h.dias is not null and not (h.intervalos = 1 and h.dias >= 6)) ok_horarios,
      ${coords} ok_coords,
      d.price_range_id is not null ok_preco,
      coalesce(d.place_id, '') <> '' ok_place,
      coalesce(d.images_json->'cover'->>'source_url', '') <> ''
        and jsonb_array_length(case when jsonb_typeof(d.images_json->'slider') = 'array' then d.images_json->'slider' else '[]'::jsonb end) >= 1 ok_foto,
      length(coalesce(d.about_text, '')) >= 900 and coalesce(d.about_html, '') <> ''
        and not (coalesce(d.about_html, '') ~* '<h6>\s*:\s*restaurant in' or coalesce(d.about_text, '') ~* '^\s*:\s*restaurant in')
        and not (coalesce(d.about_html, '') ~* 'AIPRM|react-scroll') ok_texto
    from db_restaurants d
    left join h on h.restaurant_id = d.restaurant_id
    left join s on s.slug = d.slug
    where d.city = $1`, [CIDADE]);

  for (const r of rows) {
    r.ok_veto = !r.do_not_relist && !vetados.has(String(r.restaurant_id));
    r.falta = CRITERIOS.filter((k) => !r[`ok_${k}`]);
    r.completa = r.falta.length === 0;
  }
  const grupos = [
    ['publicadas', rows.filter((r) => r.published)],
    ['despublicadas ativas sem veto', rows.filter((r) => !r.published && r.ok_status && r.ok_veto)],
    ['fechadas, sem status ou com veto', rows.filter((r) => !r.published && !(r.ok_status && r.ok_veto))],
  ];
  const completas = rows.filter((r) => r.completa).length;
  console.log(`${CIDADE} — ${new Date().toISOString().slice(0, 10)} — ${rows.length} casas no catálogo`);
  console.log(`Completas no critério cheio: ${completas}${META ? ` de ${META} (faltam ${Math.max(0, META - completas)})` : ''}`);
  if (META && rows.length < META) console.log(`Aviso: o catálogo tem ${rows.length} casas — a meta exige captar pelo menos ${META - rows.length} casas novas.`);
  for (const [nome, rs] of grupos) {
    console.log(`\n${nome}: ${rs.length} · completas ${rs.filter((r) => r.completa).length}`);
    for (const k of CRITERIOS) { const n = rs.filter((r) => !r[`ok_${k}`]).length; if (n) console.log(`  sem ${k.padEnd(9)} ${n}`); }
  }
  if (JSON_OUT) {
    fs.writeFileSync(JSON_OUT, JSON.stringify(rows.map(({ restaurant_id, name, slug, published, completa, falta }) => ({ restaurant_id, name, slug, published, completa, falta })), null, 1));
    console.log(`\nDetalhe por casa: ${JSON_OUT}`);
  }
}, { timeoutMs: 60000 }).catch((e) => { console.error('FALHA', e.message); process.exit(1); });
