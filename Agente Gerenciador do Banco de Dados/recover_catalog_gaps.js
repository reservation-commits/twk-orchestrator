#!/usr/bin/env node
'use strict';
/**
 * recover_catalog_gaps.js — recupera os dados que faltam para publicar casas DESPUBLICADAS
 * que já têm foto (e-mail, telefone, site, horários, faixa de preço, status, endereço).
 *
 * Só LÊ: banco pela credencial twk_ro, Google Places (Details legado + Text Search) e o site
 * oficial da casa (mesmas regras de enrich_emails.js / harvest_phone.js). Não grava nada:
 * devolve um relatório JSON e um arquivo .sql REVERSÍVEL (ADR-017) para a porta única:
 *
 *   node recover_catalog_gaps.js --city Paris --only-with-photo            → pesquisa + .sql + relatório
 *   node recover_catalog_gaps.js --ids 14506,14534                          → só estas casas
 *   node ../orchestrator/agents/dba-escrita/executar.js --sql <arquivo>    → dry-run da porta
 *   node ../orchestrator/agents/dba-escrita/executar.js --sql <arquivo> --apply --autonomo
 *
 * O .sql declara `-- backup:` de db_restaurants e opening_hours (desfazer.js --ultimo restaura),
 * nunca toca published, ready_pending_photo nem do_not_relist: publicar continua humano.
 *
 * Flags: --city <nome> · --only-with-photo · --ids a,b,c · --out <.sql> · --report <.json>
 *        --max N (teto de casas, padrão 200) · --no-scrape (só Places)
 */
const fs = require('fs');
const path = require('path');
const { Client } = require('./twk-db-agent/node_modules/pg');
const axios = require('./twk-db-agent/node_modules/axios');
const { harvestEmail } = require('./email_harvest');

const RAIZ = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const val = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const CITY = val('city', null);
const IDS = val('ids', '').split(',').map((s) => s.trim()).filter(Boolean);
const ONLY_PHOTO = flag('only-with-photo');
const MAX = parseInt(val('max', '200'), 10);
const SCRAPE = !flag('no-scrape');
const HOJE = new Date().toISOString().slice(0, 10);
const TRACE = `trc-recuperacao-catalogo-${HOJE.replace(/-/g, '')}`;
const slugCity = (CITY || 'ids').toLowerCase().replace(/[^a-z0-9]+/g, '-');
const OUT = val('out', path.join(RAIZ, 'orchestrator', 'state', `recuperacao-catalogo-${slugCity}-${HOJE}.sql`));
const REPORT = val('report', path.join(RAIZ, 'orchestrator', 'state', `recuperacao-catalogo-${slugCity}-${HOJE}.json`));

const lerEnv = (p) => { try { return Object.fromEntries(fs.readFileSync(p, 'utf8').split(/\r?\n/).filter((l) => l && !l.startsWith('#') && l.includes('=')).map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]; })); } catch { return {}; } };
const envRO = lerEnv(path.join(__dirname, 'twk-db-agent', '.env.readonly.local'));
const envLocal = lerEnv(path.join(__dirname, 'twk-db-agent', '.env.local'));
const RO_URL = envRO.DATABASE_URL_RO;
const KEY = envLocal.GOOGLE_PLACES_API_KEY;
if (!RO_URL) { console.error('ERRO: DATABASE_URL_RO ausente em twk-db-agent/.env.readonly.local (este script só lê — exige twk_ro).'); process.exit(1); }
if (!KEY) { console.error('ERRO: GOOGLE_PLACES_API_KEY ausente em twk-db-agent/.env.local.'); process.exit(1); }

const audit = (o) => { try { const d = path.join(RAIZ, 'orchestrator', 'logs'); fs.mkdirSync(d, { recursive: true }); fs.appendFileSync(path.join(d, `audit-${HOJE}.jsonl`), JSON.stringify({ ts: new Date().toISOString(), trace_id: TRACE, agente: 'dba', ...o }) + '\n'); } catch { /* log nunca derruba a pesquisa */ } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/^(l|le|la|les|the|el|il)\b['\s]*/, '').replace(/[^a-z0-9]/g, '');
const mesmoNome = (a, b) => { const x = norm(a), y = norm(b); return !!x && !!y && (x.includes(y) || y.includes(x)); };
// o Places devolve o site com utm_*/y_source/src de rastreio — guardamos o endereço limpo
const limparUrl = (u) => { try { const url = new URL(u); for (const k of [...url.searchParams.keys()]) if (/^(utm_|y_source|src$|gclid|fbclid|ref$)/i.test(k)) url.searchParams.delete(k); url.hash = ''; return url.toString().replace(/\?$/, ''); } catch { return u; } };

// ---------- regras de validação (as mesmas do Juiz de Catálogo e dos scripts da raiz) ----------
const telOk = (t) => /^\+[1-9]\d{7,14}$/.test(String(t || '').replace(/[\s().-]/g, ''));
const emailOk = (e) => /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(String(e || '').trim());
const CC = { France: '33', Portugal: '351', Spain: '34', Italy: '39', 'United Kingdom': '44', 'United States': '1', Brazil: '55', Morocco: '212', 'United Arab Emirates': '971', Switzerland: '41', Belgium: '32', Germany: '49', Netherlands: '31', Monaco: '377' };
function normalizePhone(raw, country) {
  const cc = CC[country]; let d = String(raw || '').replace(/[^\d+]/g, ''); if (!d) return null;
  d = d.replace(/^00/, '+');
  if (d.startsWith('+')) { const n = d.slice(1); if (n.length < 7 || n.length > 15) return null; if (cc && !n.startsWith(cc)) return null; return '+' + n; }
  if (!cc) return null; const nat = d.replace(/^0+/, ''); if (nat.length < 6 || nat.length > 13) return null; return '+' + cc + nat;
}
const SITE_REJEITA = ['thefork', 'lafourchette', 'opentable', 'sevenrooms', 'resy.com', 'tripadvisor', 'zenchef', 'guestonline', 'facebook.com', 'instagram.com', 'google.com', 'ubereats', 'deliveroo', 'linktr.ee'];
const siteOk = (u) => { try { const h = new URL(u).hostname.toLowerCase(); return !SITE_REJEITA.some((s) => h.includes(s)); } catch { return false; } };
const enderecoFraco = (a) => !/\d/.test(String(a || '')) || String(a || '').trim().length < 12;
const STATUS = { OPERATIONAL: 'active', CLOSED_TEMPORARILY: 'temporarily_closed', CLOSED_PERMANENTLY: 'closed_permanently' };
const PRECO = { 0: 1, 1: 1, 2: 2, 3: 3, 4: 4 }; // price_level do Places legado → restaurant_price_range.id

// ---------- horários: Places periods → formato nativo → linhas de opening_hours ----------
const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const GDAY = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const WEEKDAY = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 }; // convenção da tabela opening_hours (conferida em ANDIA)
const fmt = (t) => { const s = String(t).padStart(4, '0'); return s.slice(0, 2) + ':' + s.slice(2); };
function periodsParaNativo(periods) {
  if (!Array.isArray(periods) || periods.length === 0) return null;
  if (periods.length === 1 && !periods[0].close && (periods[0].open?.time === '0000' || periods[0].open?.time === undefined)) return DAYS.map((d) => ({ day: d, intervals: [{ open: '00:00', close: '23:59' }] }));
  const map = Object.fromEntries(DAYS.map((d) => [d, []]));
  for (const per of periods) { if (!per.open || per.open.day === undefined) continue; const day = GDAY[per.open.day]; if (!day) continue; map[day].push({ open: fmt(per.open.time), close: per.close ? fmt(per.close.time) : '23:59' }); }
  const nativo = DAYS.map((d) => ({ day: d, intervals: map[d].sort((a, b) => a.open.localeCompare(b.open)) }));
  return nativo.some((x) => x.intervals.length) ? nativo : null;
}
const bhReal = (bh) => Array.isArray(bh) && bh.some((d) => Array.isArray(d.intervals) && d.intervals.some((i) => /^\d{2}:\d{2}$/.test(i.open || '')));
const bhGenerico = (bh) => { if (!bhReal(bh)) return true; const chaves = new Set(); let dias = 0; for (const d of bh) for (const i of d.intervals || []) { chaves.add(`${i.open}-${i.close}`); dias++; } return chaves.size === 1 && dias >= 6; };
const linhasOpening = (bh) => { const out = []; for (const d of bh) for (const i of d.intervals || []) out.push({ weekday: WEEKDAY[d.day], open: i.open, close: i.close }); return out; };

// ---------- fontes externas ----------
async function placeDetails(placeId) {
  const fields = 'name,formatted_address,international_phone_number,formatted_phone_number,website,business_status,opening_hours,price_level,url';
  const { data } = await axios.get('https://maps.googleapis.com/maps/api/place/details/json', { params: { place_id: placeId, fields, key: KEY }, timeout: 12000 });
  return { status: data.status, r: data.result || {} };
}
async function textSearch(query) {
  const { data } = await axios.get('https://maps.googleapis.com/maps/api/place/textsearch/json', { params: { query, type: 'restaurant', key: KEY }, timeout: 12000 });
  return data.results || [];
}
async function resolverPlaceId(nome, cidade, pais) {
  const cands = await textSearch(`${nome} ${cidade} ${pais}`); const nq = norm(nome); let best = null, score = 0;
  for (const c of cands.slice(0, 5)) { const nc = norm(c.name); let s = 0; if (nc === nq) s = 100; else if (nc.includes(nq) || nq.includes(nc)) s = 80; if (s > score) { score = s; best = c; } }
  return best && score >= 80 ? { place_id: best.place_id, nome_places: best.name, score } : null;
}

// ---------- SQL ----------
const q1 = (v) => `'${String(v).replace(/'/g, "''")}'`;
const seguro = (v) => !/;/.test(String(v)) && !/\b(drop|truncate|alter|create|grant|revoke|vacuum|reindex|copy|security|owner)\b/i.test(String(v));

(async () => {
  const c = new Client({ connectionString: RO_URL, ssl: { rejectUnauthorized: false } }); await c.connect();
  const q = async (s, p) => (await c.query(s, p)).rows;
  const where = ['r.published IS NOT TRUE'];
  const params = [];
  if (CITY) { params.push(CITY.toLowerCase()); where.push(`lower(r.city) = $${params.length}`); }
  if (IDS.length) { params.push(IDS); where.push(`r.restaurant_id = ANY($${params.length})`); }
  if (ONLY_PHOTO) where.push(`(COALESCE(r.images_json->'cover'->>'source_url','')<>'' OR COALESCE(r.images_json->'slider'->0->>'source_url','')<>'')`);
  const casas = await q(`SELECT r.restaurant_id AS id, r.name, r.city, r.country, r.place_id, r.site_url, r.telephone_of_the_establishment AS tel, r.email_for_reservations AS email,
      r.price_range_id AS preco, r.operational_status AS status, r.address_of_establishment AS endereco, r.business_hours_json AS bh, r.do_not_relist,
      (SELECT count(*)::int FROM opening_hours h WHERE h.restaurant_id::text = r.restaurant_id) AS n_hor,
      (SELECT count(DISTINCT open_time||'-'||close_time)::int FROM opening_hours h WHERE h.restaurant_id::text = r.restaurant_id) AS n_int,
      (SELECT count(*)::int FROM reservations v WHERE v.restaurant_id::text = r.restaurant_id) AS pedidos
    FROM db_restaurants r WHERE ${where.join(' AND ')} ORDER BY pedidos DESC, r.name LIMIT $${params.length + 1}`, [...params, MAX]);
  // place_id é único em db_restaurants: um id resolvido que já pertence a outra linha denuncia ficha duplicada
  const donoDoPlace = Object.fromEntries((await q(`SELECT place_id, restaurant_id AS id, name, published FROM db_restaurants WHERE place_id IS NOT NULL AND place_id <> ''`)).map((x) => [x.place_id, x]));
  await c.end();
  console.log(`${casas.length} casa(s) despublicada(s)${ONLY_PHOTO ? ' com foto' : ''}${CITY ? ` em ${CITY}` : ''} — pesquisando Places${SCRAPE ? ' + site oficial' : ''}…\n`);

  const relatorio = []; const sqlRest = []; const sqlHoras = []; const idsRest = new Set(); const idsHoras = new Set();
  for (const r of casas) {
    const item = { id: r.id, nome: r.name, pedidos: r.pedidos, lacunas: [], achados: {}, fontes: {}, pendente: [], set: {} };
    if (!emailOk(r.email)) item.lacunas.push('email');
    if (!telOk(r.tel)) item.lacunas.push('tel');
    if (!r.site_url) item.lacunas.push('site');
    if (!r.preco) item.lacunas.push('preco');
    if (r.status !== 'active') item.lacunas.push(`status=${r.status}`);
    if (enderecoFraco(r.endereco)) item.lacunas.push('endereco');
    const horasRuins = r.n_hor === 0 || (r.n_int === 1 && r.n_hor >= 6) || !bhReal(r.bh);
    if (horasRuins) item.lacunas.push(r.n_hor === 0 ? 'horarios' : 'horarios genericos');
    if (r.do_not_relist) item.pendente.push('do_not_relist=true — não republicar sem o fundador');

    // 1) Places
    let placeId = r.place_id; let det = null;
    try {
      if (!placeId) {
        const res = await resolverPlaceId(r.name, r.city, r.country);
        if (!res) item.pendente.push('sem place_id e Text Search não achou nome compatível');
        else if (donoDoPlace[res.place_id]) { const d = donoDoPlace[res.place_id]; item.pendente.push(`place_id resolvido já pertence a [${d.id}] ${d.name} (${d.published ? 'publicada' : 'despublicada'}) — provável ficha duplicada, nada usado`); }
        else { placeId = res.place_id; item.achados.place_id = res; item.set.place_id = res.place_id; }
      }
      if (placeId) { const d = await placeDetails(placeId); if (d.status === 'OK') det = d.r; else item.pendente.push(`Places ${d.status}`); }
    } catch (e) { item.pendente.push(`Places erro: ${e.message}`); }
    await sleep(120);
    // ficha do Places com outro nome = place_id errado (Lutetia → "Paris", SUR MESURE → o hotel): nada dela entra
    if (det && !mesmoNome(det.name, r.name)) { item.pendente.push(`place_id aponta para "${det.name}" — ficha errada, nada usado; corrigir place_id à mão`); item.fontes.places_recusado = `google_places:${placeId}`; det = null; }
    if (det) {
      item.fontes.places = `google_places:${placeId}`;
      const tel = normalizePhone(det.international_phone_number || det.formatted_phone_number, r.country);
      if (tel) item.achados.tel = tel;
      if (det.website && siteOk(det.website)) item.achados.site = limparUrl(det.website);
      if (det.business_status && STATUS[det.business_status]) item.achados.status = STATUS[det.business_status];
      if (det.price_level !== undefined && PRECO[det.price_level]) item.achados.preco = PRECO[det.price_level];
      if (det.formatted_address) item.achados.endereco = det.formatted_address;
      const nativo = periodsParaNativo(det.opening_hours?.periods); if (nativo) item.achados.horarios = nativo;
    }
    // 2) site oficial → e-mail (e telefone, se o Places não deu)
    // tenta o site cadastrado e, se for outro, o que o Places conhece
    const sites = [...new Set([r.site_url, item.achados.site].filter(Boolean))];
    if (SCRAPE && sites.length && item.lacunas.includes('email')) {
      for (const site of sites) { try { const h = await harvestEmail(site); if (h) { item.achados.email = h; item.fontes.email = h.source; break; } } catch (e) { item.pendente.push(`scrape erro em ${site}: ${e.message}`); } }
      if (!item.achados.email) item.pendente.push(`site não expõe e-mail (${sites.map((s) => s.replace(/^https?:\/\/(www\.)?/, '').split('/')[0]).join(', ')})`);
    } else if (item.lacunas.includes('email') && !sites.length) item.pendente.push('sem site para procurar e-mail');

    // 3) decidir o que entra no SQL (só preenche lacuna; nunca sobrescreve dado válido)
    const S = item.set; const log = [];
    if (item.lacunas.includes('email') && item.achados.email && ['HIGH', 'MEDIUM'].includes(item.achados.email.confidence)) { S.email_for_reservations = item.achados.email.email; S.confidence_level = item.achados.email.confidence; log.push({ field: 'email', value: item.achados.email.email, source: item.achados.email.source, confidence: item.achados.email.confidence }); }
    else if (item.achados.email) item.pendente.push(`e-mail só com confiança ${item.achados.email.confidence}: ${item.achados.email.email} (${item.achados.email.source}) — decidir à mão`);
    if (item.lacunas.includes('tel') && item.achados.tel) { S.telephone_of_the_establishment = item.achados.tel; log.push({ field: 'telephone', value: item.achados.tel, source: item.fontes.places }); }
    if (item.lacunas.includes('site') && item.achados.site) { S.site_url = item.achados.site; log.push({ field: 'site_url', value: item.achados.site, source: item.fontes.places }); }
    if (item.lacunas.includes('preco') && item.achados.preco) { S.price_range_id = item.achados.preco; log.push({ field: 'price_range_id', value: item.achados.preco, source: item.fontes.places + ':price_level' }); }
    if (item.lacunas.includes('endereco') && item.achados.endereco && !enderecoFraco(item.achados.endereco)) { S.address_of_establishment = item.achados.endereco; log.push({ field: 'address', value: item.achados.endereco, source: item.fontes.places }); }
    if (item.achados.status && item.achados.status !== r.status) { S.operational_status = item.achados.status; log.push({ field: 'operational_status', from: r.status, value: item.achados.status, source: item.fontes.places + ':business_status' }); if (item.achados.status !== 'active') item.pendente.push(`Places diz ${item.achados.status} — não publicar`); }
    else if (r.status !== 'active' && !item.achados.status) item.pendente.push(`status ${r.status} sem confirmação do Places`);
    let bhFinal = null;
    if (horasRuins) {
      if (item.achados.horarios && !bhGenerico(item.achados.horarios)) { bhFinal = item.achados.horarios; S.business_hours_json = JSON.stringify(bhFinal); log.push({ field: 'opening_hours', rows: linhasOpening(bhFinal).length, source: item.fontes.places + ':opening_hours' }); }
      else if (bhReal(r.bh) && !bhGenerico(r.bh)) { bhFinal = r.bh; log.push({ field: 'opening_hours', rows: linhasOpening(bhFinal).length, source: 'business_hours_json existente (tabela opening_hours regenerada)' }); }
      else item.pendente.push('horários: nem Places nem business_hours_json têm grade real');
    }
    if (item.achados.place_id) log.push({ field: 'place_id', value: item.achados.place_id.place_id, source: `places_text_search:${item.achados.place_id.nome_places}` });

    // 4) SQL — ficha do Places errada contamina tudo (site cadastrado pode ser do mesmo engano): nada entra
    if (item.fontes.places_recusado) { for (const k of Object.keys(S)) delete S[k]; bhFinal = null; }
    const campos = Object.entries(S).filter(([, v]) => seguro(v));
    if (campos.length) {
      idsRest.add(r.id);
      const sets = campos.map(([k, v]) => `${k} = ${k === 'business_hours_json' ? q1(v) + '::jsonb' : typeof v === 'number' ? v : q1(v)}`);
      const entrada = { at: new Date().toISOString(), agent: 'recover_catalog_gaps', trace: TRACE, action: 'fill_gaps_unpublished', fields: log };
      sets.push(`enrichment_log = COALESCE(enrichment_log, '[]'::jsonb) || ${q1(JSON.stringify([entrada]))}::jsonb`, `last_verified_at = now()`);
      sqlRest.push(`-- ${r.name} (${r.id}) — ${campos.map(([k]) => k).join(', ')}\nupdate public.db_restaurants set ${sets.join(', ')} where restaurant_id = ${q1(r.id)} and published is not true;`);
    }
    if (bhFinal) {
      idsHoras.add(r.id);
      const linhas = linhasOpening(bhFinal);
      sqlHoras.push(`-- ${r.name} (${r.id}) — ${linhas.length} linha(s) de horário\ndelete from public.opening_hours where restaurant_id = ${q1(r.id)};\ninsert into public.opening_hours (restaurant_id, weekday, open_time, close_time) values\n${linhas.map((l) => `  (${q1(r.id)}, ${l.weekday}, ${q1(l.open)}, ${q1(l.close)})`).join(',\n')};`);
    }
    item.resolvido = Object.keys(S).filter((k) => k !== 'confidence_level'); item.set = S;
    relatorio.push(item);
    const tag = item.resolvido.length ? '✓' : '·';
    console.log(`${tag} [${r.id}] ${r.name} (${r.pedidos} pedidos) — faltava: ${item.lacunas.join(', ') || 'nada'} | preenche: ${item.resolvido.join(', ') || '—'}${item.pendente.length ? ' | pendente: ' + item.pendente.join('; ') : ''}`);
    await sleep(150);
  }

  // ---------- arquivo da porta ----------
  if (sqlRest.length || sqlHoras.length) {
    const lista = (s) => [...s].map(q1).join(', ');
    const cab = [
      `-- Recuperação de dados de catálogo — ${CITY || 'ids'} — ${HOJE}`,
      `-- Casas DESPUBLICADAS com foto: preenche só o que falta (e-mail, telefone, site, horários, preço, status, endereço).`,
      `-- Fontes: Google Places (Details) e site oficial da casa (regras de enrich_emails/harvest_phone). Nunca sobrescreve dado válido.`,
      `-- Não toca published, ready_pending_photo nem do_not_relist — publicar continua decisão humana.`,
      `-- Autoridade: ADR-017 (escrita reversível pela porta, ≤200 linhas/tabela) · trace ${TRACE}`,
      `-- Gerado por Agente Gerenciador do Banco de Dados/recover_catalog_gaps.js; relatório em ${path.relative(RAIZ, REPORT)}`,
    ];
    if (idsRest.size) cab.push(`-- backup: public.db_restaurants where restaurant_id in (${lista(idsRest)})`);
    if (idsHoras.size) cab.push(`-- backup: public.opening_hours where restaurant_id in (${lista(idsHoras)})`);
    const corpo = ['begin;', ...sqlRest, ...sqlHoras];
    if (idsRest.size) corpo.push(`do $$\ndeclare n int;\nbegin\n  select count(*) into n from public.db_restaurants where restaurant_id in (${lista(idsRest)}) and last_verified_at > now() - interval '5 minutes';\n  if n <> ${idsRest.size} then raise exception 'esperava ${idsRest.size} casas atualizadas, encontrei %', n; end if;\n  select count(*) into n from public.db_restaurants where restaurant_id in (${lista(idsRest)}) and published is true;\n  if n <> 0 then raise exception 'nenhuma casa deveria ter sido publicada, mas % estão', n; end if;\nend $$;`);
    corpo.push('commit;');
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, cab.join('\n') + '\n' + corpo.join('\n') + '\n');
  }
  fs.mkdirSync(path.dirname(REPORT), { recursive: true });
  fs.writeFileSync(REPORT, JSON.stringify({ gerado_em: new Date().toISOString(), trace_id: TRACE, cidade: CITY, casas: relatorio }, null, 1));
  const n = (f) => relatorio.filter(f).length;
  console.log(`\n=== RESUMO ===\ncasas: ${relatorio.length} · com algo a preencher: ${n((i) => i.resolvido.length)} · e-mail: ${n((i) => i.set.email_for_reservations)} · telefone: ${n((i) => i.set.telephone_of_the_establishment)} · site: ${n((i) => i.set.site_url)} · horários: ${idsHoras.size} · preço: ${n((i) => i.set.price_range_id)} · status: ${n((i) => i.set.operational_status)} · endereço: ${n((i) => i.set.address_of_establishment)}\npendências humanas: ${n((i) => i.pendente.length)} casa(s)`);
  console.log(`relatório: ${REPORT}`);
  if (sqlRest.length || sqlHoras.length) console.log(`SQL da porta: ${OUT}\n→ node orchestrator/agents/dba-escrita/executar.js --sql "${path.relative(RAIZ, OUT)}" (dry-run) e depois --apply --autonomo`);
  else console.log('nada a escrever.');
  audit({ evento: 'recuperacao_catalogo_pesquisa', cidade: CITY, casas: relatorio.length, preenche: n((i) => i.resolvido.length), sql: sqlRest.length || sqlHoras.length ? path.relative(RAIZ, OUT) : null, relatorio: path.relative(RAIZ, REPORT) });
})().catch((e) => { console.error('ERRO:', e.message); audit({ evento: 'recuperacao_catalogo_erro', erro: e.message }); process.exit(1); });
