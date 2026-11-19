'use strict';
/** Central · Studio: página do Julien por link assinado (sem nada interno), API com chave, edição barrada pelas travas, geração com progresso, IA sem chave = 503. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'twk-central-estudio-'));
const dir = path.join(raiz, 'agents', 'estudio-viral');
const AG = path.join(__dirname, '..', '..', '..', 'agents', 'estudio-viral');
const FIXTURE = path.join(AG, 'test', 'fixtures', 'pacote-2026-11-20.json');
const runMod = require(path.join(AG, 'run.js'));
const { criar } = require('../../estudio.js');
const env = { CHAUFFEUR_CONFIRMA_URL: 'https://central.test', CHAUFFEUR_CONFIRMA_SECRET: 'segredo-do-link' };
const fx = () => JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));

// modelo simulado: 1ª chamada com ferramenta = veille; depois o pacote
let chamadas = 0;
const llm = { disponivel: true, modelo: 'simulado', effort: 'high', chamar: async ({ tools }) => { chamadas += 1; await new Promise((ok) => setTimeout(ok, 30)); if (tools) return { texto: JSON.stringify({ novidades: [{ panier: 'jeu', titre: 'Sortie', fait: 'Le jeu est sorti.', date: '2026-11-19', source_url: 'https://ex.test/a', angle_pour_nous: 'banquette' }] }), modelo: 'simulado', buscas: 3, usage: {} }; return { texto: JSON.stringify(fx()), modelo: 'simulado', usage: {} }; } };
const st = criar({ stateDir: raiz, env, llm });
const semIa = criar({ stateDir: raiz, env, llm: { disponivel: false, modelo: 'x', effort: 'high' } });
const json = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
const servidor = (alvo) => http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (alvo.tratarPublico(req, res, u, json)) return;
  if (u.pathname.startsWith('/api/')) { if (req.headers['x-center-key'] !== 'chave') return json(res, 401, { error: 'nao autorizado' }); if (alvo.tratar(req, res, u, json)) return; }
  json(res, 404, {});
});
const s1 = servidor(st); const s2 = servidor(semIa); let base = ''; let base2 = '';
test.before(async () => {
  await runMod.rodar({ argv: ['--fixture', FIXTURE, '--dia', '2026-11-20'], env: {}, log: () => {}, stateDir: dir });
  await new Promise((ok) => s1.listen(0, '127.0.0.1', ok)); await new Promise((ok) => s2.listen(0, '127.0.0.1', ok));
  base = `http://127.0.0.1:${s1.address().port}`; base2 = `http://127.0.0.1:${s2.address().port}`;
});
test.after(() => { s1.close(); s2.close(); });
const k = { 'x-center-key': 'chave' };
const get = async (r, h = {}, b = base) => { const x = await fetch(b + r, { headers: h }); const t = await x.text(); let j = null; try { j = JSON.parse(t); } catch { /* texto */ } return { status: x.status, j, t, h: x.headers }; };
const post = async (r, corpo, h = {}, b = base) => { const x = await fetch(b + r, { method: 'POST', headers: { 'content-type': 'application/json', ...h }, body: JSON.stringify(corpo) }); return { status: x.status, j: await x.json().catch(() => null) }; };
const tk = runMod.token('2026-11-20', env);

test('página do Julien: 404 mudo sem token, com token de outro dia ou para dia sem pacote', async () => {
  assert.equal((await get('/studio/2026-11-20')).status, 404);
  assert.equal((await get(`/studio/2026-11-20?t=${runMod.token('2026-11-21', env)}`)).status, 404);
  assert.equal((await get(`/studio/2026-11-21?t=${runMod.token('2026-11-21', env)}`)).status, 404);
  assert.equal((await get(`/studio/2026-11-20/data?t=errado`)).status, 404);
  assert.equal((await post('/studio/2026-11-20/etat?t=errado', { reel: 'R1', status: 'filme' })).status, 404);
});

test('página do Julien: abre com o link, os dados não levam nada interno, o .srt baixa e « Filmé » fica gravado com o autor', async () => {
  const pg = await get(`/studio/2026-11-20?t=${tk}`);
  assert.equal(pg.status, 200); assert.match(pg.t, /<html lang="fr">/); assert.match(pg.t, /julien\.js/); assert.doesNotMatch(pg.t, /<script>[^<]/, 'sem script embutido (CSP)');
  const d = await get(`/studio/2026-11-20/data?t=${tk}`);
  assert.equal(d.j.reels.length, 3); assert.equal(d.j.reels[0].note, 83); assert.equal(d.j.timeline.R1.total, 9);
  const bruto = JSON.stringify(d.j);
  for (const proibido of ['_lacunas', '_verificacao', 'resume_pt', 'traduction_pt', '_modelo', 'usage']) assert.ok(!bruto.includes(proibido), `${proibido} não vai à página do Julien`);
  const srt = await get(`/studio/2026-11-20/srt/R1?t=${tk}`);
  assert.equal(srt.status, 200); assert.match(srt.h.get('content-disposition'), /wanted-chauffeur-2026-11-20-R1\.srt/); assert.match(srt.t, /-->/);
  assert.equal((await get(`/studio/2026-11-20/srt/R9?t=${tk}`)).status, 404);
  const e = await post(`/studio/2026-11-20/etat?t=${tk}`, { reel: 'R1', status: 'filme' });
  assert.equal(e.status, 200); assert.equal(e.j.etat.R1.status, 'filme'); assert.equal(e.j.etat.R1.por, 'julien');
  assert.equal((await post(`/studio/2026-11-20/etat?t=${tk}`, { reel: 'R1', status: 'publie', lien: 'https://evil.test/x' })).status, 400);
  assert.equal((await post(`/studio/2026-11-20/etat?t=${tk}`, { reel: 'R7', status: 'filme' })).status, 404);
});

test('API: exige a chave; saúde, dias, pacote, fórmulas, radar e desempenho respondem', async () => {
  assert.equal((await get('/api/estudio/saude')).status, 401);
  const s = (await get('/api/estudio/saude', k)).j;
  assert.equal(s.ia_disponivel, true); assert.equal(s.link_disponivel, true); assert.equal(s.rotina_ligada, false); assert.equal(s.dias, 1);
  assert.ok(s.falta.some((f) => /ESTUDIO_VIRAL/.test(f))); assert.ok(!JSON.stringify(s).includes('segredo-do-link'), 'a saúde nunca devolve segredo');
  const d = (await get('/api/estudio/dias', k)).j.dias;
  assert.equal(d[0].dia, '2026-11-20'); assert.equal(d[0].contagem.filme, 1); assert.equal(d[0].reels[0].note, 83);
  const p = (await get('/api/estudio/pacote?dia=2026-11-20', k)).j;
  assert.equal(p.pacote.reels.length, 3); assert.equal(p.link, `https://central.test/studio/2026-11-20?t=${tk}`); assert.ok(p.timeline.R2); assert.match(p.markdown, /Pack du jour/);
  assert.equal((await get('/api/estudio/pacote?dia=2026-01-01', k)).status, 404);
  assert.equal((await get('/api/estudio/formulas', k)).j.formulas.length, 19);
  const r = (await get('/api/estudio/radar?dia=2026-11-20', k)).j;
  assert.equal(r.veille, null); assert.ok(r.lacuna); assert.ok(r.calendario.eventos.length >= 5);
  const de = (await get('/api/estudio/desempenho', k)).j;
  assert.equal(de.funil.escritos, 3); assert.equal(de.olheiro_ligado, false);
});

test('medir: ganchos na hora; Reel com GTA na tela volta barrado, sem gravar nada', async () => {
  const g = (await post('/api/estudio/medir', { tipo: 'ganchos', texto: 'Ce soir, Toulouse joue dans son salon. Sauf ces 2 manettes. | TOULOUSE · ce soir' }, k)).j.ganchos;
  assert.equal(g[0].note, 83);
  const ruim = fx().reels[0]; ruim.texte_ecran[0].texte = 'GTA 6 · ce soir';
  const m = (await post('/api/estudio/medir', { tipo: 'reel', dia: '2026-11-20', reel: ruim }, k)).j;
  assert.equal(m.ok, false); assert.ok(m.problemas.some((x) => /Marca do jogo/.test(x.detalhe))); assert.ok(m.timeline.total > 0);
  assert.equal((await post('/api/estudio/medir', { tipo: 'nada' }, k)).status, 400);
});

test('salvar Reel: travas barram com 422 e o arquivo fica intacto; versão boa salva, guarda a anterior e refaz o markdown', async () => {
  const antes = fs.readFileSync(path.join(dir, 'pacote-2026-11-20.json'), 'utf8');
  const ruim = fx().reels[1]; ruim.legende = ruim.legende.replace('350 €', '199 €');
  const a = await post('/api/estudio/reel', { dia: '2026-11-20', reel: ruim }, k);
  assert.equal(a.status, 422); assert.ok(a.j.problemas.some((x) => /Fora da tabela/.test(x.detalhe)));
  assert.equal(fs.readFileSync(path.join(dir, 'pacote-2026-11-20.json'), 'utf8'), antes);
  const bom = fx().reels[0]; bom.titre = 'Sauf elles'; bom.plans[0].duree_s = 2; bom.id = 'R1'; bom.campo_estranho = 'x';
  const b = await post('/api/estudio/reel', { dia: '2026-11-20', reel: bom }, k);
  assert.equal(b.status, 200); assert.equal(b.j.reel.titre, 'Sauf elles'); assert.equal(b.j.reel.campo_estranho, undefined); assert.equal(b.j.timeline.total, 9.5);
  const salvo = JSON.parse(fs.readFileSync(path.join(dir, 'pacote-2026-11-20.json'), 'utf8'));
  assert.equal(salvo.reels[0].titre, 'Sauf elles'); assert.ok(salvo._editado_em);
  assert.match(fs.readFileSync(path.join(dir, 'pacote-2026-11-20.md'), 'utf8'), /Reel 1 · Sauf elles/);
  assert.equal(st.estado.edicoes('2026-11-20')[0].antes.titre, 'Pas eux');
  assert.equal((await post('/api/estudio/reel', { dia: '2026-11-20', reel: { id: 'R9' } }, k)).status, 404);
});

test('estado pelo painel: publicado com link do Instagram; link de outro lugar é recusado', async () => {
  const a = await post('/api/estudio/estado', { dia: '2026-11-20', reel: 'R2', status: 'publie', lien: 'https://www.instagram.com/reel/AbCdEf/' }, k);
  assert.equal(a.status, 200); assert.equal(a.j.estado.R2.por, 'painel');
  assert.equal((await post('/api/estudio/estado', { dia: '2026-11-20', reel: 'R2', status: 'publie', lien: 'http://x.test' }, k)).status, 400);
});

test('IA sem chave: gerar, ganchos, reescrever e quadro respondem 503 com a explicação; medir continua funcionando', async () => {
  for (const [r, c] of [['/api/estudio/gerar', {}], ['/api/estudio/ganchos', { ideia: 'x' }], ['/api/estudio/reescrever', { dia: '2026-11-20', reel: 'R1', instrucao: 'x' }], ['/api/estudio/quadro', { imagem: 'data:image/png;base64,AAAA' }]]) {
    const x = await post(r, c, k, base2); assert.equal(x.status, 503, r); assert.match(x.j.error, /ANTHROPIC_API_KEY/);
  }
  assert.equal((await post('/api/estudio/medir', { tipo: 'travas', texto: 'dispo ce soir, sans réservation', contexto: 'legende' }, k, base2)).j.travas.length >= 1, true);
  assert.equal((await get('/api/estudio/saude', k, base2)).j.ia_disponivel, false);
});

test('gerar pelo painel: roda em segundo plano com etapas, guarda o pacote anterior em arquivo/ e recusa uma segunda rodada simultânea', async () => {
  chamadas = 0;
  const a = await post('/api/estudio/gerar', { dia: '2026-11-20' }, k);
  assert.equal(a.status, 202); assert.equal(a.j.progresso.rodando, true);
  assert.equal((await post('/api/estudio/gerar', { dia: '2026-11-20' }, k)).status, 409);
  let p; for (let i = 0; i < 80; i++) { p = (await get('/api/estudio/progresso', k)).j; if (!p.rodando) break; await new Promise((ok) => setTimeout(ok, 50)); }
  assert.equal(p.rodando, false); assert.equal(p.erro, null);
  assert.deepEqual(p.etapas.map((e) => e.id), ['veille', 'escrita', 'medida', 'pronto']);
  assert.equal(chamadas, 2, 'veille + pacote (nada barrado, sem correção)');
  assert.equal(fs.readdirSync(path.join(dir, 'arquivo')).length, 1);
  const novo = (await get('/api/estudio/pacote?dia=2026-11-20', k)).j;
  assert.equal(novo.pacote._modelo, 'simulado'); assert.equal(novo.pacote.reels[0].titre, 'Pas eux'); assert.equal(novo.veille.novidades.length, 1);
  assert.equal(novo.estado.R1.status, 'filme', 'o estado marcado pelo Julien sobrevive à nova rodada');
  assert.equal((await get('/api/estudio/radar?dia=2026-11-20', k)).j.veille.buscas, 3);
});

test('quadro: recusa o que não é imagem; corpo gigante leva 413', async () => {
  assert.equal((await post('/api/estudio/quadro', { imagem: 'data:text/html;base64,AAAA' }, k)).status, 400);
  assert.equal((await post('/api/estudio/medir', { tipo: 'ganchos', texto: 'x'.repeat(70_000) }, k)).status, 413);
});
