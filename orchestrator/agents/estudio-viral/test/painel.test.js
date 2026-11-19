'use strict';
/** Motor do painel: linha do tempo e .srt, estado dos Reels, laboratório, ferramentas de IA (modelo simulado) e desempenho. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const contexto = require('../contexto.js');
const tl = require('../timeline.js');
const estadoMod = require('../estado.js');
const labMod = require('../laboratorio.js');
const ia = require('../ia.js');
const desempenho = require('../desempenho.js');

const skill = contexto.carregarSkill();
const lab = labMod.criar(skill);
const fixture = () => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'pacote-2026-11-20.json'), 'utf8'));
const tmp = (n) => fs.mkdtempSync(path.join(os.tmpdir(), `twk-estudio-${n}-`));

test('linha do tempo: planos somam, a tela usa os segundos declarados, a voz cabe na imagem', () => {
  const [r1, r2] = fixture().reels;
  const a = tl.construir(r1);
  assert.equal(a.total, 9);
  assert.deepEqual(a.plans.map((p) => p.fond), ['nuit', 'led', 'ciel', 'nuit', 'noir']);
  assert.deepEqual([a.ecran[0].debut, a.ecran[0].fin], [0, 2]);
  assert.equal(a.voix.length, 3);
  assert.equal(a.voix_comprimee, null, 'a voz do gabarito cabe sem acelerar');
  assert.ok(a.voix[a.voix.length - 1].fin <= a.total + 0.01);
  const b = tl.construir(r2);
  assert.equal(b.voix.length, 0);
  assert.equal(b.ecran.length, 5);
});

test('linha do tempo: sem segundos declarados, entende « 0–2 s », « dernière seconde » e o plano citado; voz longa é comprimida', () => {
  const r = { plans: [{ duree_s: 2, description: 'Place du Capitole de nuit' }, { duree_s: 2, description: 'Banquette arrière : deux manettes' }, { duree_s: 1, description: 'un détail sans indice' }],
    texte_ecran: [{ quand: '0–2 s', texte: 'TOULOUSE' }, { quand: 'sur la banquette', texte: 'MARDI' }, { quand: 'dernière seconde', texte: 'Vous jouez. On conduit.' }],
    voix_off: ['Une phrase vraiment très longue qui ne tient absolument pas dans cinq petites secondes de vidéo, même en parlant très vite, promis juré.'] };
  const a = tl.construir(r);
  assert.deepEqual([a.ecran[0].debut, a.ecran[0].fin], [0, 2]);
  assert.deepEqual([a.ecran[1].debut, a.ecran[1].fin], [2, 4]);
  assert.ok(a.ecran[2].debut >= 3.7 && a.ecran[2].fin === 5);
  assert.equal(a.plans[2].fond, 'interieur', 'plano sem pista herda o cenário do anterior');
  assert.ok(a.voix_comprimee < 1);
});

test('.srt: numerado, com vírgula nos milésimos; Reel sem voz usa os textos de tela', () => {
  const [r1, r2] = fixture().reels;
  const s = tl.srt(r1);
  assert.match(s, /^1\n00:00:00,\d{3} --> 00:00:03,\d{3}\nCe soir, Toulouse joue dans son salon\. Sauf ces 2 manettes\.\n/);
  assert.equal(s.split('\n\n').filter(Boolean).length, 3);
  assert.match(tl.srt(r2), /TOULOUSE · 11:00 PM/);
});

test('estado: marca, valida, guarda quem marcou e mantém o link do publicado', () => {
  const e = estadoMod.abrir(tmp('estado'));
  assert.equal(e.marcar({ dia: '2026-11-20', reel: 'R1', status: 'filme', por: 'julien' }).ok, true);
  assert.equal(e.marcar({ dia: '2026-11-20', reel: 'R1', status: 'publie', lien: 'https://www.instagram.com/reel/ABC123/', por: 'julien' }).ok, true);
  assert.equal(e.marcar({ dia: '2026-11-20', reel: 'R1', status: 'publie' }).ok, true, 'remarcar sem link não apaga o link');
  assert.equal(e.doDia('2026-11-20').R1.lien, 'https://www.instagram.com/reel/ABC123/');
  assert.equal(e.marcar({ dia: '2026-11-20', reel: 'R1', status: 'viral' }).ok, false);
  assert.equal(e.marcar({ dia: '20/11', reel: 'R1', status: 'filme' }).ok, false);
  assert.equal(e.marcar({ dia: '2026-11-20', reel: 'R2', status: 'publie', lien: 'javascript:alert(1)' }).ok, false);
  assert.equal(e.marcar({ dia: '2026-11-20', reel: 'R2', status: 'publie', lien: 'https://evil.test/reel/x' }).ok, false);
  e.registrarEdicao({ dia: '2026-11-20', reel: 'R1', antes: { id: 'R1', titre: 'antes' } });
  assert.equal(e.edicoes('2026-11-20')[0].antes.titre, 'antes');
});

test('laboratório: ordena por nota, explica os seis controles e mostra a trava', () => {
  const g = lab.ganchos('Bonjour à tous, aujourd\'hui une expérience unique | Une expérience inoubliable à découvrir\nCe soir, Toulouse joue dans son salon. Sauf ces 2 manettes. | TOULOUSE · ce soir\nGTA 6 est dans la voiture | GTA 6 · TOULOUSE');
  assert.equal(g.length, 3);
  assert.equal(g[0].verdict, 'FORTE'); assert.ok(g[0].note >= 75);
  assert.equal(g[0].controles.length, 6);
  assert.ok(g[0].controles.every((c) => c.nom && c.explique));
  const gta = g.find((x) => /GTA 6 est/.test(x.voix));
  assert.equal(gta.verdict, 'BLOQUEADA'); assert.ok(gta.travas.some((t) => t.niveau === 'bloquant'));
  assert.equal(lab.formulas().length, 19);
  assert.ok(lab.legenda('Toulouse, 11:00 PM. Lien en bio.\n#Toulouse').linhas.length >= 5);
});

test('IA · ganchos: o modelo escreve, a ferramenta mede e tira os barrados', async () => {
  const ctx = contexto.carregar({ dia: '2026-11-20', stateRoot: null, stateDir: tmp('ctx') });
  const llm = { disponivel: true, modelo: 'simulado', chamar: async ({ system, effort }) => { assert.match(system, /TA TÂCHE/); assert.equal(effort, 'medium'); return { texto: JSON.stringify({ accroches: [{ voix: 'GTA 6 est dans la voiture', ecran: 'GTA 6 · TOULOUSE', formule: 'lieu' }, { voix: 'Ce soir, Toulouse joue dans son salon. Sauf ces 2 manettes.', ecran: 'TOULOUSE · ce soir', formule: 'contre-pied', pourquoi: 'contraste' }] }), modelo: 'simulado', usage: {} }; } };
  const r = await ia.ganchos({ llm, ctx, lab, ideia: 'les manettes attendent place du Capitole' });
  assert.equal(r.accroches.length, 1); assert.equal(r.barrados, 1);
  assert.equal(r.accroches[0].verdict, 'FORTE'); assert.equal(r.accroches[0].pourquoi, 'contraste');
});

test('IA · reescrever: proposta boa volta medida; proposta com GTA na tela volta barrada', async () => {
  const ctx = contexto.carregar({ dia: '2026-11-20', stateRoot: null, stateDir: tmp('ctx2') });
  const p = fixture(); const bom = { ...p.reels[0], titre: 'Sauf elles' }; const ruim = JSON.parse(JSON.stringify(p.reels[0])); ruim.texte_ecran[0].texte = 'GTA 6 · ce soir';
  let qual = bom;
  const llm = { disponivel: true, modelo: 'simulado', chamar: async ({ user }) => { assert.match(user, /Demande : /); return { texto: JSON.stringify({ ...qual, id: 'OUTRO' }), modelo: 'simulado', usage: {} }; } };
  const a = await ia.reescrever({ llm, ctx, wc: skill.wc, pacote: p, reelId: 'R1', instrucao: 'mude o título' });
  assert.equal(a.ok, true); assert.equal(a.reel.id, 'R1', 'o id do Reel nunca muda'); assert.equal(a.reel.titre, 'Sauf elles');
  qual = ruim;
  const b = await ia.reescrever({ llm, ctx, wc: skill.wc, pacote: p, reelId: 'R1', instrucao: 'ponha o nome do jogo na tela' });
  assert.equal(b.ok, false); assert.ok(b.problemas.some((x) => x.tipo === 'bloqueia'));
  await assert.rejects(ia.reescrever({ llm, ctx, wc: skill.wc, pacote: p, reelId: 'R9', instrucao: 'x' }), /não está no pacote/);
});

test('IA · juiz do quadro: manda a imagem ao modelo, barra marca do jogo e TOULOUSE ilegível, recusa formato estranho', async () => {
  let visto = null;
  const llm = { disponivel: true, modelo: 'simulado', chamar: async ({ user }) => { visto = user; return { texto: JSON.stringify({ texte_lu: 'GTA', toulouse_lisible: false, marque_du_jeu_visible: true, arret_du_pouce: 40, verdict: 'refaire', resume_pt: 'Refazer.' }), modelo: 'simulado', usage: {} }; } };
  const r = await ia.quadro({ llm, reel: fixture().reels[0], base64: 'AAAA', mediaType: 'image/jpeg' });
  assert.equal(visto[0].type, 'image'); assert.equal(visto[0].source.media_type, 'image/jpeg');
  assert.equal(r.bloqueia.length, 2); assert.equal(r.verdict, 'refaire');
  await assert.rejects(ia.quadro({ llm, base64: 'AAAA', mediaType: 'image/gif' }), /imagem:/);
});

test('desempenho: cruza o Reel publicado com o post do Olheiro pelo link; sem Olheiro declara a lacuna', async () => {
  const raiz = tmp('raiz'); const dir = path.join(raiz, 'agents', 'estudio-viral');
  const { rodar } = require('../run.js');
  await rodar({ argv: ['--fixture', path.join(__dirname, 'fixtures', 'pacote-2026-11-20.json'), '--dia', '2026-11-20'], env: {}, log: () => {}, stateDir: dir });
  const e = estadoMod.abrir(dir);
  e.marcar({ dia: '2026-11-20', reel: 'R1', status: 'publie', lien: 'https://www.instagram.com/reel/XyZ_1/?igsh=abc' });
  e.marcar({ dia: '2026-11-20', reel: 'R2', status: 'filme' });
  e.marcar({ dia: '2026-11-20', reel: 'R3', status: 'ecarte' });
  const sem = desempenho.calcular({ stateRoot: raiz, estudioDir: dir, estados: e.todos(), wc: skill.wc });
  assert.equal(sem.olheiro_ligado, false); assert.ok(sem.lacunas.some((l) => /Olheiro/.test(l)));
  assert.deepEqual(sem.funil, { escritos: 3, filmados: 2, publicados: 1, medidos: 0, descartados: 1 });
  const ol = path.join(raiz, 'agents', 'olheiro-instagram'); fs.mkdirSync(ol, { recursive: true });
  fs.writeFileSync(path.join(ol, 'resumo.json'), JSON.stringify({ conta: { username: 'wantedchauffeur' }, numeros: { seguidores: 300, seguidores_7d: 40 } }));
  fs.writeFileSync(path.join(ol, 'estado.json'), JSON.stringify({ conta_historico: [{ dia: '2026-11-18', seguidores: 280 }, { dia: '2026-11-19', seguidores: 290 }, { dia: '2026-11-20', seguidores: 300 }] }));
  fs.writeFileSync(path.join(ol, 'journal.jsonl'), [{ id: 'IG-1', format: 'reel', lien: 'https://www.instagram.com/reel/XyZ_1/', vues: 5000, abonnes: 22 }, { id: 'IG-2', format: 'reel', lien: 'https://www.instagram.com/reel/outro/', vues: 1000, abonnes: 2 }].map((l) => JSON.stringify(l)).join('\n'));
  const com = desempenho.calcular({ stateRoot: raiz, estudioDir: dir, estados: e.todos(), wc: skill.wc });
  assert.equal(com.funil.medidos, 1);
  const r1 = com.reels.find((r) => r.id === 'R1');
  assert.equal(r1.vues, 5000); assert.equal(r1.abonnes, 22); assert.equal(r1.multiple, 1.67);
  assert.equal(com.por_formule[0].valor, 'contre-pied'); assert.equal(com.por_formule[0].abonnes_total, 22);
  assert.equal(com.ganho_mediano, 10); assert.equal(com.calibragem.pronta, false);
  assert.equal(desempenho.chaveLink('https://www.instagram.com/wantedchauffeur/reel/AbC/?x=1'), 'AbC');
});

test('contexto: o que o Julien publicou e descartou entra nos pacotes recentes', async () => {
  const dir = tmp('rec'); const { rodar } = require('../run.js');
  await rodar({ argv: ['--fixture', path.join(__dirname, 'fixtures', 'pacote-2026-11-20.json'), '--dia', '2026-11-20'], env: {}, log: () => {}, stateDir: dir });
  const e = estadoMod.abrir(dir); e.marcar({ dia: '2026-11-20', reel: 'R1', status: 'publie' }); e.marcar({ dia: '2026-11-20', reel: 'R3', status: 'ecarte' });
  const rec = contexto.pacotesRecentes(dir, '2026-11-21');
  assert.equal(rec.length, 1);
  assert.deepEqual(rec[0].choix, ['« Pas eux » publié', '« Zoome » écarté']);
});

test('JSON inválido do modelo: vírgula sobrando é consertada sem nova chamada; guillemet solto leva a UMA nova tentativa com o erro; duas falhas = erro claro', async () => {
  const { chamarJsonCom, extrairJson } = require('../llm.js');
  assert.deepEqual(extrairJson('```json\n{"a": [1, 2,], "b": {"c": 1,},}\n```'), { a: [1, 2], b: { c: 1 } });
  const respostas = ['{"titre": "Il a dit "zoome" et c\'est tout", "n": 1}', '{"titre": "Il a dit « zoome » et c’est tout", "n": 1}'];
  const chamadas = [];
  const llm = { chamar: async (o) => { chamadas.push(o); return { texto: respostas[chamadas.length - 1], modelo: 'sim', usage: {}, buscas: 3 }; } };
  const invalidas = [];
  const r = await chamarJsonCom(llm, { system: 's', user: 'u', tools: [{ type: 'web_search_20260209' }] }, { aoFalhar: (t, e) => invalidas.push({ t, e: e.message }) });
  assert.equal(r.json.titre, 'Il a dit « zoome » et c’est tout'); assert.equal(r.tentativas, 2); assert.equal(r.buscas, 3, 'as buscas da primeira chamada ficam no resultado');
  assert.equal(chamadas.length, 2); assert.equal(chamadas[1].tools, null, 'a segunda chamada não pesquisa de novo');
  assert.match(chamadas[1].user, /JSON valide/); assert.equal(chamadas[1].historico[1].content, respostas[0]);
  assert.equal(invalidas.length, 1); assert.match(invalidas[0].e, /JSON/);
  const teimoso = { chamar: async () => ({ texto: 'pas du json', modelo: 'sim', usage: {} }) };
  await assert.rejects(chamarJsonCom(teimoso, { system: 's', user: 'u' }), /duas tentativas/);
});

test('modelo padrão é o Fable 5.1 e vai pelo caminho beta com fallback do servidor; o Opus vai pelo caminho normal', async () => {
  const { criar } = require('../llm.js');
  const chamadas = [];
  function Fake() { this.beta = { messages: { create: async (p) => { chamadas.push(['beta', p]); return { stop_reason: 'end_turn', model: p.model, content: [{ type: 'text', text: '{"ok":1}' }], usage: {} }; } } }; this.messages = { create: async (p) => { chamadas.push(['normal', p]); return { stop_reason: 'end_turn', model: p.model, content: [{ type: 'text', text: '{"ok":1}' }], usage: {} }; } }; }
  const fable = criar({ ANTHROPIC_API_KEY: 'k' }, { sdk: Fake });
  assert.equal(fable.modelo, 'claude-fable-5-1');
  await fable.chamar({ system: 's', user: 'u' });
  assert.equal(chamadas[0][0], 'beta'); assert.deepEqual(chamadas[0][1].betas, ['server-side-fallback-2026-07-01']); assert.equal(chamadas[0][1].fallbacks, 'default');
  assert.deepEqual(chamadas[0][1].thinking, { type: 'adaptive' }); assert.match(chamadas[0][1].system, /FORMAT JSON/);
  const opus = criar({ ANTHROPIC_API_KEY: 'k', ESTUDIO_MODEL: 'claude-opus-5-5' }, { sdk: Fake });
  await opus.chamar({ system: 's', user: 'u' });
  assert.equal(chamadas[1][0], 'normal'); assert.equal(chamadas[1][1].fallbacks, undefined);
});
