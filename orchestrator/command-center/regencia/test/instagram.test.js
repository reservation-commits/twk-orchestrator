'use strict';
/** Central · Instagram: rotas de leitura com chave, anotação validada, diário refeito na hora, coletor da Regência. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'twk-central-ig-'));
const dirIg = path.join(raiz, 'agents', 'olheiro-instagram');
const AGENTS = path.join(__dirname, '..', '..', '..', 'agents');
const { criar } = require('../../instagram.js');
const cerebro = require(path.join(AGENTS, 'olheiro-instagram', 'cerebro.js'));

const estado = { atualizado_em: '2026-11-14T08:00:00Z', conta: { username: 'wantedchauffeur', seguidores: 1240 }, posts: { 17900000001: { id: '17900000001', tipo: 'REELS', media_type: 'VIDEO', permalink: 'https://www.instagram.com/reel/X/', timestamp: '2026-11-13T19:00:00Z', legenda: 'Minuit à Monaco. Le Vice au volant.', metricas: { views: 4200, reach: 3000 }, historico: [] } }, comentarios: [{ id: 'c1', media_id: '17900000001', texto: 'Combien pour samedi ?', ts: '2026-11-14T02:00:00Z', respondido: false, classe: 'reserva' }, { id: 'c2', media_id: '17900000001', texto: 'Top', ts: '2026-11-14T03:00:00Z', respondido: false, classe: 'elogio' }], conta_historico: [] };
fs.mkdirSync(dirIg, { recursive: true });
fs.writeFileSync(path.join(dirIg, 'estado.json'), JSON.stringify(estado));
fs.writeFileSync(path.join(dirIg, 'resumo.json'), JSON.stringify(cerebro.resumo(estado, { agora: Date.parse('2026-11-14T08:00:00Z') })));
fs.writeFileSync(path.join(dirIg, 'journal.jsonl'), cerebro.diario(estado).map((l) => JSON.stringify(l)).join('\n') + '\n');

const ig = criar({ stateDir: raiz, agentsDir: AGENTS });
const json = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
const server = http.createServer((req, res) => { const u = new URL(req.url, 'http://x'); if (!ig.tratar(req, res, u, json)) json(res, 404, {}); });
let base = '';
test.before(async () => { await new Promise((ok) => server.listen(0, '127.0.0.1', ok)); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => server.close());
const get = async (r) => { const x = await fetch(base + r); return { status: x.status, j: await x.json() }; };
const post = async (r, corpo) => { const x = await fetch(base + r, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo) }); return { status: x.status, j: await x.json() }; };

test('resumo sem a fila inteira; comentários filtráveis por classe', async () => {
  const r = await get('/api/instagram');
  assert.equal(r.status, 200); assert.equal(r.j.conta.username, 'wantedchauffeur'); assert.equal(r.j.fila_comentarios, undefined); assert.equal(r.j.comentarios_na_fila, 2);
  const c = await get('/api/instagram/comentarios?classe=reserva');
  assert.deepEqual(c.j.comentarios.map((x) => x.id), ['c1']);
});

test('anotação: valida pilar e personagem, e o diário muda na hora', async () => {
  assert.equal((await post('/api/instagram/anotar', { id: 'IG-17900000001', pilier: 'praia' })).status, 400);
  assert.equal((await post('/api/instagram/anotar', { id: 'IG-123456789', pilier: 'nuit' })).status, 404);
  assert.equal((await post('/api/instagram/anotar', { id: '../../etc', pilier: 'nuit' })).status, 400);
  const ok = await post('/api/instagram/anotar', { id: 'IG-17900000001', pilier: 'nuit', ecran: 'MONACO · minuit' });
  assert.equal(ok.status, 200);
  const d = await get('/api/instagram/diario');
  const l = d.j.posts.find((x) => x.id === 'IG-17900000001');
  assert.equal(l.pilier, 'nuit'); assert.equal(l.ecran, 'MONACO · minuit');
  assert.equal(l.ville, 'Monaco', 'cidade inferida da legenda'); assert.equal(l.personnage, 'Le Vice', 'personagem inferido da legenda');
});

test('sem leitura ainda: 404 com explicação, nunca vazio silencioso', async () => {
  const vazio = criar({ stateDir: fs.mkdtempSync(path.join(os.tmpdir(), 'twk-central-ig-vazio-')), agentsDir: AGENTS });
  const s2 = http.createServer((req, res) => { vazio.tratar(req, res, new URL(req.url, 'http://x'), json); });
  await new Promise((ok) => s2.listen(0, '127.0.0.1', ok));
  const r = await fetch(`http://127.0.0.1:${s2.address().port}/api/instagram`);
  assert.equal(r.status, 404); assert.match((await r.json()).erro, /ainda não leu/);
  s2.close();
});

test('coletor da Regência: sem chave é lacuna declarada; com relato de hoje, repassa o relato', () => {
  const antes = { root: process.env.TWK_STATE_ROOT, tok: process.env.IG_ACCESS_TOKEN };
  process.env.TWK_STATE_ROOT = raiz; delete process.env.IG_ACCESS_TOKEN;
  delete require.cache[require.resolve('../coletores.js')];
  const col = require('../coletores.js');
  const sem = col.olheiroInstagram({ trace: 't1' });
  assert.equal(sem.status, 'sem_credencial'); assert.match(sem.cobertura.lacunas[0], /não ligado/);
  const hoje = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(path.join(dirIg, `relato-${hoje}.json`), JSON.stringify(cerebro.relato(cerebro.resumo(estado, { agora: Date.now() }), { agora: Date.now() })));
  const com = col.olheiroInstagram({ trace: 't2' });
  assert.equal(com.agente, 'olheiro-instagram'); assert.equal(com.trace_id, 't2'); assert.equal(com.kpis.seguidores, 1240);
  if (antes.root === undefined) delete process.env.TWK_STATE_ROOT; else process.env.TWK_STATE_ROOT = antes.root;
  if (antes.tok !== undefined) process.env.IG_ACCESS_TOKEN = antes.tok;
  delete require.cache[require.resolve('../coletores.js')];
});
