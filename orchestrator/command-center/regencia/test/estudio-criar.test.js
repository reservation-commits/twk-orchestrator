'use strict';
/** Central · Studio · área Criar: peça sob medida salva no pacote do dia (ou num pacote mínimo), vai à página do Julien sem dado interno, pode ser removida. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'twk-central-criar-'));
const AG = path.join(__dirname, '..', '..', '..', 'agents', 'estudio-viral');
const runMod = require(path.join(AG, 'run.js'));
const { criar } = require('../../estudio.js');
const env = { CHAUFFEUR_CONFIRMA_URL: 'https://central.test', CHAUFFEUR_CONFIRMA_SECRET: 'segredo-do-link' };
const PECA = { titre: 'Annonce', image: { fond: 'nuit', titre: 'TOULOUSE · mardi 9:00 PM', sous_titre: '3 h à bord', bas: '58 € chacun' }, legende: 'Mardi, Game Night à Toulouse. 350 € la voiture, 58 € chacun à six.\nLien en bio.', hashtags: ['#Toulouse', '#WantedChauffeur'], pourquoi: 'x', traduction_pt: 'y' };
const st = criar({ stateDir: raiz, env, llm: { disponivel: true, modelo: 'sim', effort: 'high', chamar: async () => ({ texto: JSON.stringify(PECA), modelo: 'sim', usage: {} }) } });
const json = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
const server = http.createServer((req, res) => { const u = new URL(req.url, 'http://x'); if (st.tratarPublico(req, res, u, json)) return; if (u.pathname.startsWith('/api/')) { if (req.headers['x-center-key'] !== 'chave') return json(res, 401, {}); if (st.tratar(req, res, u, json)) return; } json(res, 404, {}); });
let base = '';
test.before(async () => { await new Promise((ok) => server.listen(0, '127.0.0.1', ok)); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => server.close());
const k = { 'x-center-key': 'chave' };
const get = async (r, h = {}) => { const x = await fetch(base + r, { headers: h }); return { status: x.status, j: await x.json().catch(() => null) }; };
const post = async (r, corpo, h = {}) => { const x = await fetch(base + r, { method: 'POST', headers: { 'content-type': 'application/json', ...h }, body: JSON.stringify(corpo) }); return { status: x.status, j: await x.json().catch(() => null) }; };

test('direção curta ou formato desconhecido = 400', async () => {
  assert.equal((await post('/api/estudio/criar', { formato: 'post', direcao: 'curta' }, k)).status, 400);
  assert.equal((await post('/api/estudio/criar', { formato: 'tiktok', direcao: 'anuncie a game night de terça' }, k)).status, 400);
});

test('peça criada vai para um pacote mínimo do dia, aparece ao Julien sem tradução nem direção, e pode ser removida', async () => {
  const r = await post('/api/estudio/criar', { formato: 'post', direcao: 'anuncie a game night de terça', dia: '2026-11-22' }, k);
  assert.equal(r.status, 200); assert.equal(r.j.peca.id, 'P01'); assert.equal(r.j.peca.formato, 'post'); assert.equal(r.j.peca.direcao, 'anuncie a game night de terça'); assert.equal(r.j.peca.image.titre, 'TOULOUSE · mardi 9:00 PM');
  const p = (await get('/api/estudio/pacote?dia=2026-11-22', k)).j;
  assert.equal(p.pacote.reels.length, 0); assert.equal(p.pacote.pecas.length, 1); assert.ok(p.pacote._lacunas.some((l) => /pacote mínimo/.test(l)));
  const r2 = await post('/api/estudio/criar', { formato: 'post', direcao: 'segunda peça do mesmo dia', dia: '2026-11-22' }, k);
  assert.equal(r2.j.peca.id, 'P02');
  const dj = await get(`/studio/2026-11-22/data?t=${runMod.token('2026-11-22', env)}`);
  assert.equal(dj.status, 200); assert.equal(dj.j.pecas.length, 2);
  const bruto = JSON.stringify(dj.j); assert.ok(!bruto.includes('traduction_pt')); assert.ok(!bruto.includes('direcao')); assert.ok(!bruto.includes('"modelo"'));
  assert.equal((await post('/api/estudio/peca/remover', { dia: '2026-11-22', id: 'P01' }, k)).status, 200);
  assert.equal((await get('/api/estudio/pacote?dia=2026-11-22', k)).j.pacote.pecas.length, 1);
  assert.equal((await post('/api/estudio/peca/remover', { dia: '2026-11-22', id: 'P01' }, k)).status, 404);
  assert.equal(st.estado.edicoes('2026-11-22')[0].motivo, 'peca_removida');
});

test('dias: um dia só com peças aparece no arquivo', async () => {
  const d = (await get('/api/estudio/dias', k)).j.dias;
  assert.ok(d.some((x) => x.dia === '2026-11-22'));
});
