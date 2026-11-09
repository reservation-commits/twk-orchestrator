#!/usr/bin/env node
/*
 * captar_paris.js — capta casas novas de Paris pelo caminho mais fácil: descarta barato antes de gastar.
 * NÃO ESCREVE NO BANCO (dedupe com twk_ro). A saída é um JSON com aprovadas e descartadas, cada uma com o motivo.
 * Decisão do fundador em 05/11/2026: casa com dado ou foto difícil de verificar fica de lado, sem nova tentativa.
 *
 * Funil, do mais barato ao mais caro:
 *   1. Busca (Places Text Search) por CEP e tema: nota, avaliações, preço, aberta, repetida no catálogo.
 *   2. Detalhe (Places Details): site próprio, telefone internacional, horários não genéricos, preço conhecido,
 *      coordenadas dentro de Paris, telefone que não esteja já no catálogo.
 *   3. Site oficial (grátis): aviso de fechamento e e-mail de reserva no próprio domínio. E-mail pessoal fica de fora.
 *   4. Fotos (pixels grátis, visão só se existir capa possível): mesmo critério de enrich_photos_v2.js.
 *
 * Preço desconhecido não vira preço alto, ao contrário de build_candidates.js: casa sem preço verificado fica de lado.
 *
 * Tetos: --max-buscas, --max-detalhes e --max-fotos. O script para no teto e diz quantas casas ficaram sem processar.
 *
 * Uso:
 *   node captar_paris.js --out saida.json [--temas "restaurant gastronomique,bistronomie"] [--paginas 2]
 *        [--max-buscas 40] [--max-detalhes 120] [--max-fotos 60] [--minrating 4.5] [--minreviews 100] [--preco-min 3]
 *        [--ignorar anterior1.json,anterior2.json]
 */
'use strict';
const fs = require('fs');
const path = require('path');
const axios = require('./twk-db-agent/node_modules/axios');
const { harvestEmail, registrableDomain } = require('./email_harvest');
const { qualificar, fetchHtml, usoVisao } = require('./enrich_photos_v2');
const { horariosGenericos } = require(path.resolve(__dirname, '..', 'orchestrator', 'juizes', 'catalogo.js'));
const { comClienteRo } = require(path.resolve(__dirname, '..', 'orchestrator', 'agents', '_lib', 'conectar.js'));

const argv = process.argv.slice(2);
const val = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const OUT = val('out', '');
if (!OUT) { console.error('FALHA: informe --out <arquivo.json>'); process.exit(1); }
const TEMAS = val('temas', 'restaurant gastronomique').split(',').map((s) => s.trim()).filter(Boolean);
const PAGINAS = parseInt(val('paginas', '2'), 10);
const MAX_BUSCAS = parseInt(val('max-buscas', '40'), 10);
const MAX_DETALHES = parseInt(val('max-detalhes', '120'), 10);
const MAX_FOTOS = parseInt(val('max-fotos', '60'), 10);
const MIN_RATING = parseFloat(val('minrating', '4.5'));
const MIN_REVIEWS = parseInt(val('minreviews', '100'), 10);
const PRECO_MIN = parseInt(val('preco-min', '3'), 10);
const IGNORAR = val('ignorar', '').split(',').map((s) => s.trim()).filter(Boolean);

// Preços: Places pela tabela legada do Google (suposição, conferir na fatura). Haiku 4.5 pela tabela da Anthropic.
const USD = { busca: 32 / 1000, detalhe: 25 / 1000, visaoEntrada: 1 / 1e6, visaoSaida: 5 / 1e6 };

const KEY = (() => {
  const m = fs.readFileSync(path.join(__dirname, 'twk-db-agent', '.env.local'), 'utf8').match(/GOOGLE_PLACES_API_KEY=(.+)/);
  if (!m) { console.error('FALHA: GOOGLE_PLACES_API_KEY ausente'); process.exit(1); }
  return m[1].trim();
})();
const PLACES = 'https://maps.googleapis.com/maps/api/place';
const CEPS = val('ceps', '') ? val('ceps', '').split(',').map((s) => s.trim()) : [...Array.from({ length: 20 }, (_, i) => `750${String(i + 1).padStart(2, '0')}`), '75116'];
const CAIXA = { lat: [48.80, 48.91], lng: [2.22, 2.47] };
const SITE_DE_TERCEIRO = /(^|\.)(facebook|instagram|linktr|tripadvisor|thefork|lafourchette|zenchef|sevenrooms|opentable|resy|ubereats|deliveroo|google|yelp|wixsite|business\.site)\./i;
const FECHAMENTO = /ferm[ée]e?\s+(d[ée]finitivement|pour\s+(r[ée]novation|travaux)|temporairement)|temporairement\s+ferm[ée]e?|fermeture\s+d[ée]finitive|r[ée]ouverture\s+prochaine|closed\s+for\s+renovation|permanently\s+closed|temporarily\s+closed/i;

const norm = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const nomeChave = (s) => norm(s).replace(/\b(restaurant|restaurante|paris|le|la|les|l)\b/g, ' ').replace(/[^a-z0-9]/g, '');
const telChave = (s) => String(s || '').replace(/[^\d+]/g, '');
const dominio = (u) => { try { return registrableDomain(new URL(/^https?:/i.test(u) ? u : `https://${u}`).hostname); } catch { return ''; } };
const limparSite = (u) => { try { const x = new URL(u); x.search = ''; x.hash = ''; return x.href.replace(/\/+$/, ''); } catch { return null; } };

const gasto = { buscas: 0, detalhes: 0, fotos: 0 };
const conta = {};
const descartadas = [];
const descartar = (r, etapa, motivo) => {
  conta[motivo] = (conta[motivo] || 0) + 1;
  descartadas.push({ place_id: r.place_id, name: r.name, etapa, motivo, nota: r.rating, avaliacoes: r.user_ratings_total, preco: r.price_level ?? null });
};

async function buscar(query, token) {
  // A página seguinte repete a pesquisa junto com o token; sem isso o Google responde INVALID_REQUEST.
  const params = { query, type: 'restaurant', key: KEY, ...(token ? { pagetoken: token } : {}) };
  for (let tentativa = 0; tentativa < 3; tentativa++) {
    if (gasto.buscas >= MAX_BUSCAS) return null;
    gasto.buscas++;
    const { data } = await axios.get(`${PLACES}/textsearch/json`, { params, timeout: 15000 });
    if (data.status === 'OK' || data.status === 'ZERO_RESULTS') return data;
    // Token recém-criado ainda não vale, ou falha passageira do Google: espera e tenta de novo.
    const passageiro = (token && data.status === 'INVALID_REQUEST') || data.status === 'INTERNAL' || data.status === 'UNKNOWN_ERROR';
    if (!passageiro) throw new Error(`Places busca: ${data.status}`);
    await new Promise((s) => setTimeout(s, 3000));
  }
  console.error(`  aviso: sem resposta para "${query}"${token ? ' (página seguinte)' : ''}; seguindo sem ela.`);
  return { results: [] };
}

async function detalhar(placeId) {
  gasto.detalhes++;
  const fields = 'name,formatted_address,geometry,international_phone_number,website,price_level,rating,user_ratings_total,business_status,opening_hours';
  const { data } = await axios.get(`${PLACES}/details/json`, { params: { place_id: placeId, fields, key: KEY }, timeout: 15000 });
  if (data.status !== 'OK') throw new Error(`Places detalhe: ${data.status}`);
  return data.result;
}

const hhmm = (t) => (t ? `${t.slice(0, 2)}:${t.slice(2, 4)}` : null);
const periodos = (ps) => (Array.isArray(ps) ? ps.filter((p) => p.open && p.open.day !== undefined && p.close).map((p) => ({ dia: p.open.day, abre: hhmm(p.open.time), fecha: hhmm(p.close.time) })) : []);

(async () => {
  const t0 = Date.now();
  const cat = await comClienteRo(async (c) => (await c.query(`select name, city, place_id, telephone_of_the_establishment tel, site_url from db_restaurants`)).rows, { timeoutMs: 60000 });
  const noCatalogo = { place: new Set(), nome: new Set(), tel: new Set(), site: new Set() };
  for (const r of cat) {
    if (r.place_id) noCatalogo.place.add(r.place_id);
    if (r.city !== 'Paris') continue;
    noCatalogo.nome.add(nomeChave(r.name));
    if (r.tel) noCatalogo.tel.add(telChave(r.tel));
    const d = dominio(r.site_url || ''); if (d) noCatalogo.site.add(d);
  }
  for (const f of IGNORAR) {
    const a = JSON.parse(fs.readFileSync(f, 'utf8'));
    for (const r of [...(a.aprovadas || []), ...(a.descartadas || []), ...(a.sem_processar || [])]) if (r.place_id) noCatalogo.place.add(r.place_id);
  }
  console.log(`Catálogo: ${cat.length} casas para dedupe.${IGNORAR.length ? ` Ignorando também: ${IGNORAR.length} execução(ões) anterior(es).` : ''}`);

  // 1. Busca
  const vistas = new Map();
  for (const tema of TEMAS) {
    for (const cep of CEPS) {
      let token = null; let pag = 0;
      do {
        const data = await buscar(`${tema} ${cep} Paris`, token);
        if (!data) break;
        for (const r of data.results || []) if (!vistas.has(r.place_id)) vistas.set(r.place_id, r);
        token = data.next_page_token || null; pag++;
        if (token && pag < PAGINAS) await new Promise((s) => setTimeout(s, 2200)); else token = null;
      } while (token);
    }
  }
  const brutos = vistas.size;
  const fila = [];
  for (const r of vistas.values()) {
    if (noCatalogo.place.has(r.place_id) || noCatalogo.nome.has(nomeChave(r.name))) { descartar(r, 'busca', 'já no catálogo'); continue; }
    if (!/\b75\d{3}\s+Paris\b/i.test(r.formatted_address || '')) { descartar(r, 'busca', 'fora de Paris'); continue; }
    if (r.business_status && r.business_status !== 'OPERATIONAL') { descartar(r, 'busca', 'não está aberta'); continue; }
    if ((r.rating || 0) < MIN_RATING) { descartar(r, 'busca', `nota abaixo de ${MIN_RATING}`); continue; }
    if ((r.user_ratings_total || 0) < MIN_REVIEWS) { descartar(r, 'busca', `menos de ${MIN_REVIEWS} avaliações`); continue; }
    if (r.price_level != null && r.price_level < PRECO_MIN) { descartar(r, 'busca', `preço abaixo de ${PRECO_MIN}`); continue; }
    fila.push(r);
  }
  // Primeiro o que tende a ser mais fácil e mais premium: preço conhecido e alto, depois mais avaliações.
  fila.sort((a, b) => (b.price_level || 0) - (a.price_level || 0) || (b.user_ratings_total || 0) - (a.user_ratings_total || 0));
  console.log(`Busca: ${gasto.buscas} chamadas, ${brutos} casas distintas, ${fila.length} seguem para detalhe.`);

  // 2 e 3. Detalhe e site oficial
  const paraDetalhar = fila.slice(0, MAX_DETALHES);
  const semProcessar = fila.slice(MAX_DETALHES).map((r) => ({ place_id: r.place_id, name: r.name }));
  const fotosFila = [];
  const nestaExecucao = { tel: new Set(), site: new Set() };
  const q = [...paraDetalhar];
  async function trabalhador() {
    while (q.length) {
      const r = q.shift();
      try {
        const d = await detalhar(r.place_id);
        const base = { ...r, name: d.name || r.name, price_level: d.price_level ?? r.price_level };
        if (d.business_status && d.business_status !== 'OPERATIONAL') { descartar(base, 'detalhe', 'não está aberta'); continue; }
        const site = limparSite(d.website || '');
        if (!site) { descartar(base, 'detalhe', 'sem site'); continue; }
        let host = ''; try { host = new URL(site).hostname; } catch { /* limparSite já validou */ }
        if (SITE_DE_TERCEIRO.test(`.${host}.`)) { descartar(base, 'detalhe', 'site de terceiro, sem site próprio'); continue; }
        const tel = telChave(d.international_phone_number);
        if (!/^\+[1-9]\d{7,14}$/.test(tel)) { descartar(base, 'detalhe', 'sem telefone internacional'); continue; }
        if (noCatalogo.tel.has(tel) || nestaExecucao.tel.has(tel)) { descartar(base, 'detalhe', 'telefone já no catálogo'); continue; }
        const dom = dominio(site);
        if (noCatalogo.site.has(dom) || nestaExecucao.site.has(dom)) { descartar(base, 'detalhe', 'site já usado por outra casa'); continue; }
        const pl = d.price_level;
        if (pl == null) { descartar(base, 'detalhe', 'preço não verificado'); continue; }
        if (pl < PRECO_MIN) { descartar(base, 'detalhe', `preço abaixo de ${PRECO_MIN}`); continue; }
        const lat = d.geometry?.location?.lat; const lng = d.geometry?.location?.lng;
        if (!(lat >= CAIXA.lat[0] && lat <= CAIXA.lat[1] && lng >= CAIXA.lng[0] && lng <= CAIXA.lng[1])) { descartar(base, 'detalhe', 'coordenadas fora de Paris'); continue; }
        const horarios = periodos(d.opening_hours?.periods);
        if (horariosGenericos(horarios).generico) { descartar(base, 'detalhe', 'horários ausentes ou genéricos'); continue; }

        const home = await fetchHtml(site);
        if (!home) { descartar(base, 'site', 'site não responde'); continue; }
        const texto = home.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ');
        const fech = texto.match(FECHAMENTO);
        if (fech) { descartar(base, 'site', 'site avisa fechamento'); continue; }
        const em = await harvestEmail(site);
        if (!em) { descartar(base, 'site', 'site sem e-mail'); continue; }
        if (em.confidence !== 'HIGH') { descartar(base, 'site', 'só e-mail pessoal'); continue; }

        nestaExecucao.tel.add(tel); nestaExecucao.site.add(dom);
        fotosFila.push({
          place_id: r.place_id, name: (d.name || r.name).split('|')[0].trim(), address: d.formatted_address, phone: tel,
          email: em.email, email_source: em.source, site_url: site, latitude: lat, longitude: lng,
          price_range_id: pl, rating: d.rating, reviews: d.user_ratings_total, horarios, price_level: pl, user_ratings_total: d.user_ratings_total,
        });
      } catch (e) { descartar(r, 'detalhe', 'erro na consulta'); console.error(`  erro em ${r.name}: ${String(e.message).slice(0, 100)}`); }
    }
  }
  await Promise.all(Array.from({ length: 4 }, trabalhador));
  console.log(`Detalhe e site: ${gasto.detalhes} consultas, ${fotosFila.length} seguem para fotos.`);

  // 4. Fotos
  const aprovadas = [];
  const paraFotos = fotosFila.slice(0, MAX_FOTOS);
  for (const c of fotosFila.slice(MAX_FOTOS)) semProcessar.push({ place_id: c.place_id, name: c.name });
  const qf = [...paraFotos];
  async function trabalhadorFotos() {
    while (qf.length) {
      const c = qf.shift(); gasto.fotos++;
      try {
        const f = await qualificar(c.site_url, c.name);
        if (!f.ok) { descartar({ ...c, rating: c.rating }, 'fotos', f.motivo.replace(/\s*\(melhor:.*$/, '')); continue; }
        const { price_level: _p, user_ratings_total: _u, ...casa } = c;
        aprovadas.push({ ...casa, foto_tipo: f.kind, capa_px: `${f.cover.w}x${f.cover.h}`, n_galeria: f.gallery.length, images_json: f.imagesJson });
        console.log(`  ✓ ${c.name} · ${f.kind} · capa ${f.cover.w}x${f.cover.h} + ${f.gallery.length}`);
      } catch (e) { descartar(c, 'fotos', 'erro nas fotos'); console.error(`  erro em ${c.name}: ${String(e.message).slice(0, 100)}`); }
    }
  }
  await Promise.all(Array.from({ length: 3 }, trabalhadorFotos));

  const custo = {
    busca_usd: +(gasto.buscas * USD.busca).toFixed(2),
    detalhe_usd: +(gasto.detalhes * USD.detalhe).toFixed(2),
    visao_usd: +(usoVisao.entrada * USD.visaoEntrada + usoVisao.saida * USD.visaoSaida).toFixed(3),
  };
  custo.total_usd = +(custo.busca_usd + custo.detalhe_usd + custo.visao_usd).toFixed(2);
  const funil = {
    casas_distintas: brutos, passaram_na_busca: fila.length, detalhadas: gasto.detalhes,
    chegaram_as_fotos: gasto.fotos, aprovadas: aprovadas.length, sem_processar_por_teto: semProcessar.length,
  };
  fs.writeFileSync(OUT, JSON.stringify({ gerado_em: new Date().toISOString(), parametros: { TEMAS, PAGINAS, MIN_RATING, MIN_REVIEWS, PRECO_MIN }, funil, descartes: conta, gasto, uso_visao: usoVisao, custo, aprovadas, descartadas, sem_processar: semProcessar }, null, 1));

  console.log('\n──────── FUNIL ────────');
  for (const [k, v] of Object.entries(funil)) console.log(`${k.padEnd(26)} ${v}`);
  console.log('\nDescartes por motivo:');
  for (const [k, v] of Object.entries(conta).sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(4)}  ${k}`);
  console.log(`\nCusto estimado: US$ ${custo.total_usd} (busca ${custo.busca_usd}, detalhe ${custo.detalhe_usd}, visão ${custo.visao_usd})`);
  if (aprovadas.length) console.log(`Custo por casa aprovada, sem texto: US$ ${(custo.total_usd / aprovadas.length).toFixed(2)}`);
  console.log(`Duração: ${Math.round((Date.now() - t0) / 60000)} min · Saída: ${OUT}`);
  process.exit(0);
})().catch((e) => { console.error('FALHA', e.message); process.exit(1); });
