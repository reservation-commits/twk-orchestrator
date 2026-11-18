'use strict';
/** Central · Wanted Chauffeur: pedido da página gravado sem PII, origem conferida, teto por endereço, painel e resultado. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'twk-central-chauffeur-'));
const { criar } = require('../../chauffeur.js');
let relogio = Date.parse('2026-11-19T20:00:00Z');
const ch = criar({ stateDir: raiz, env: { CHAUFFEUR_ORIGINS: 'https://theworldkeys.com', CHAUFFEUR_TETO_HORA: '3' }, agora: () => relogio });
const json = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
// Reproduz a ordem do server.js: a rota pública antes da chave; o resto só com chave.
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (ch.tratarPublico(req, res, u, json)) return;
  if (u.pathname.startsWith('/api/')) {
    if (req.headers['x-center-key'] !== 'chave') return json(res, 401, { error: 'nao autorizado' });
    if (ch.tratar(req, res, u, json)) return;
  }
  json(res, 404, {});
});
let base = '';
test.before(async () => { await new Promise((ok) => server.listen(0, '127.0.0.1', ok)); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => server.close());
const post = async (r, corpo, headers = {}) => { const x = await fetch(base + r, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(corpo) }); return { status: x.status, j: await x.json(), h: x.headers }; };
const get = async (r, headers = {}) => { const x = await fetch(base + r, { headers }); return { status: x.status, j: await x.json() }; };
const daPagina = { origin: 'https://theworldkeys.com', 'x-forwarded-for': '203.0.113.7' };

test('pedido da página: gravado com código, origem e produto; nome e telefone nunca entram no arquivo', async () => {
  const r = await post('/api/chauffeur/lead', { codigo: 'wtd-t-7k2q', produto: 'game', data: '2026-11-24', hora: '9:00 PM', pessoas: 6, idioma: 'fr', nom: 'Léa Martin', tel: '+33 6 12 34 56 78' }, daPagina);
  assert.equal(r.status, 201); assert.equal(r.j.codigo, 'WTD-T-7K2Q');
  const linhas = fs.readFileSync(path.join(raiz, 'chauffeur-leads.jsonl'), 'utf8');
  assert.equal(linhas.trim().split('\n').length, 1);
  assert.ok(!/Léa|Martin|nom|tel|56 78/.test(linhas), 'o arquivo não pode guardar nome nem telefone');
  assert.ok(/"origem":"T"/.test(linhas) && /"produto":"game"/.test(linhas));
  // o mesmo código de novo (a página pode reenviar) não duplica
  const r2 = await post('/api/chauffeur/lead', { codigo: 'WTD-T-7K2Q', produto: 'game' }, daPagina);
  assert.equal(r2.status, 200); assert.equal(r2.j.repetido, true);
  assert.equal(fs.readFileSync(path.join(raiz, 'chauffeur-leads.jsonl'), 'utf8').trim().split('\n').length, 1);
});

test('formato estrito: código, produto, hora em AM/PM e pessoas de 1 a 6', async () => {
  let k = 50; const ipNovo = () => ({ origin: 'https://theworldkeys.com', 'x-forwarded-for': `203.0.113.${k++}` }); // um endereço por chamada: aqui o que se testa é o formato, não o teto
  assert.equal((await post('/api/chauffeur/lead', { codigo: 'WTD-X-7K2Q', produto: 'game' }, ipNovo())).status, 400);
  assert.equal((await post('/api/chauffeur/lead', { codigo: 'WTD-I-AB12', produto: 'uber' }, ipNovo())).status, 400);
  assert.equal((await post('/api/chauffeur/lead', { codigo: 'WTD-I-AB12', produto: 'night', hora: '21:00' }, ipNovo())).status, 400);
  assert.equal((await post('/api/chauffeur/lead', { codigo: 'WTD-I-AB12', produto: 'night', pessoas: 9 }, ipNovo())).status, 400);
});

test('origem: só a página da marca pode gravar; OPTIONS responde com CORS; sem chave não se lê nada', async () => {
  const outro = await post('/api/chauffeur/lead', { codigo: 'WTD-I-ZZZZ', produto: 'night' }, { origin: 'https://evil.example' });
  assert.equal(outro.status, 403);
  const pre = await fetch(base + '/api/chauffeur/lead', { method: 'OPTIONS', headers: { origin: 'https://theworldkeys.com' } });
  assert.equal(pre.status, 204); assert.equal(pre.headers.get('access-control-allow-origin'), 'https://theworldkeys.com');
  assert.equal((await get('/api/chauffeur/leads')).status, 401);
  assert.equal((await post('/api/chauffeur/lead/resultado', { codigo: 'WTD-T-7K2Q', resultado: 'feito' })).status, 401);
});

test('teto por endereço: a partir do limite responde 429', async () => {
  const ip = { ...daPagina, 'x-forwarded-for': '198.51.100.9' };
  const codigos = ['WTD-Y-AAAA', 'WTD-Y-BBBB', 'WTD-Y-CCCC', 'WTD-Y-DDDD'];
  const st = []; for (const c of codigos) st.push((await post('/api/chauffeur/lead', { codigo: c, produto: 'transfer' }, ip)).status);
  assert.deepEqual(st, [201, 201, 201, 429]);
});

test('resultado por código e painel: contagens por origem, produto, dia e conversão; nota com telefone é recusada', async () => {
  const k = { 'x-center-key': 'chave' };
  assert.equal((await post('/api/chauffeur/lead/resultado', { codigo: 'WTD-T-7K2Q', resultado: 'pago' }, k)).status, 400);
  assert.equal((await post('/api/chauffeur/lead/resultado', { codigo: 'WTD-H-N7PE', resultado: 'feito' }, k)).status, 404);
  assert.equal((await post('/api/chauffeur/lead/resultado', { codigo: 'WTD-T-7K2Q', resultado: 'orcado', nota: 'ligar 06 12 34 56 78' }, k)).status, 400);
  assert.equal((await post('/api/chauffeur/lead/resultado', { codigo: 'WTD-T-7K2Q', resultado: 'orcado' }, k)).status, 200);
  relogio += 3_600_000;
  assert.equal((await post('/api/chauffeur/lead/resultado', { codigo: 'WTD-T-7K2Q', resultado: 'confirmado' }, k)).status, 200);
  const p = await get('/api/chauffeur/leads?dias=7', k);
  assert.equal(p.status, 200);
  assert.equal(p.j.total, 4); // 1 TikTok + 3 YouTube (o 4º bateu no teto)
  assert.deepEqual(p.j.por_origem, { TikTok: 1, YouTube: 3 });
  assert.deepEqual(p.j.por_produto, { 'Game Night': 1, Transfer: 3 });
  assert.equal(p.j.por_resultado.confirmado, 1); assert.equal(p.j.por_resultado.novo, 3);
  assert.equal(p.j.viraram_corrida, 1); assert.equal(p.j.taxa_conversao_pct, 25);
  assert.equal(p.j.por_dia.length, 1); assert.equal(p.j.por_dia[0].dia, '2026-11-19');
  const t = p.j.pedidos.find((x) => x.codigo === 'WTD-T-7K2Q');
  assert.equal(t.resultado, 'confirmado'); assert.equal(t.origem_nome, 'TikTok');
  assert.ok(!JSON.stringify(p.j).includes('Martin'));
});

test('links por rede: um por letra, com a página da marca', async () => {
  const l = await get('/api/chauffeur/links', { 'x-center-key': 'chave' });
  assert.equal(l.status, 200);
  assert.deepEqual(l.j.links.map((x) => x.origem), ['T', 'I', 'Y', 'W', 'H', 'S']);
  assert.equal(l.j.links[0].url, 'https://theworldkeys.com/ride?o=T');
});
