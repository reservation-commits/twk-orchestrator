'use strict';
/** Peças sob medida: limpeza, travas por formato e a criação pela IA com uma correção. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const contexto = require('../contexto.js');
const pecas = require('../pecas.js');
const ia = require('../ia.js');
const skill = contexto.carregarSkill();

test('limpar: só os campos do formato, hashtags válidas, textos com teto', () => {
  const bom = pecas.limpar('post', { titre: 'x', image: { fond: 'nuit', titre: 'TOULOUSE · mardi', sous_titre: '3 h à bord', bas: '58 € chacun' }, legende: 'Mardi, Game Night à Toulouse. 350 € la voiture.\nLien en bio.', hashtags: ['#Toulouse', '#WantedChauffeur', 'semcerquilha'], campo_estranho: 1 });
  assert.equal(bom.campo_estranho, undefined); assert.deepEqual(bom.hashtags, ['#Toulouse', '#WantedChauffeur']); assert.equal(bom.image.fond, 'nuit');
  assert.equal(pecas.limpar('post', { image: { fond: 'arco-iris' } }).image.fond, 'nuit', 'fundo desconhecido vira noite');
  assert.equal(pecas.limpar('carrossel', { slides: Array.from({ length: 14 }, (_, i) => ({ titre: `s${i}` })) }).slides.length, 10);
});

test('verificar: GTA na imagem e preço fora da tabela barram; carrossel curto barra; story sem legenda passa', () => {
  const bom = pecas.limpar('post', { image: { fond: 'nuit', titre: 'TOULOUSE · mardi', sous_titre: '3 h à bord', bas: '58 € chacun' }, legende: 'Mardi, Game Night à Toulouse. 350 € la voiture.\nLien en bio.', hashtags: ['#Toulouse', '#WantedChauffeur'] });
  assert.equal(pecas.verificar(bom, skill.wc).ok, true);
  const gta = pecas.limpar('post', { ...bom, image: { ...bom.image, titre: 'GTA 6 · TOULOUSE' } });
  assert.equal(pecas.verificar(gta, skill.wc).ok, false);
  const caro = pecas.limpar('post', { ...bom, legende: 'Game Night à Toulouse : 199 € la voiture. Lien en bio.' });
  assert.ok(pecas.verificar(caro, skill.wc).problemas.some((p) => /Fora da tabela/.test(p.detalhe)));
  const curto = pecas.limpar('carrossel', { slides: [{ titre: 'TOULOUSE', texte: 'a' }, { titre: 'b', texte: 'c' }], legende: 'Toulouse. Lien en bio.', hashtags: ['#Toulouse'] });
  assert.ok(pecas.verificar(curto, skill.wc).problemas.some((p) => /menos de 3/.test(p.detalhe)));
  const story = pecas.limpar('story', { image: { fond: 'ciel', titre: 'TOULOUSE · ce soir', sous_titre: 'Tu joues où ?' }, sticker: 'Sondage', legende: '' });
  assert.equal(pecas.verificar(story, skill.wc).ok, true);
  const dispo = pecas.limpar('story', { ...story, sticker: 'dispo ce soir, sans réservation' });
  assert.equal(pecas.verificar(dispo, skill.wc).ok, false, 'sticker também passa pelas travas');
});

test('criarPeca: primeira resposta barrada é corrigida numa segunda chamada; formato desconhecido é recusado', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'twk-pecas-'));
  const ctx = contexto.carregar({ dia: '2026-11-20', stateRoot: null, stateDir: dir });
  const bom = { titre: 'Annonce', image: { fond: 'nuit', titre: 'TOULOUSE · mardi', sous_titre: '3 h à bord', bas: '58 € chacun' }, legende: 'Mardi, Game Night à Toulouse. 350 € la voiture.\nLien en bio.', hashtags: ['#Toulouse', '#WantedChauffeur'] };
  const gta = { ...bom, image: { ...bom.image, titre: 'GTA 6 · TOULOUSE' } };
  let n = 0; const llm = { disponivel: true, modelo: 'sim', chamar: async ({ user, system }) => { n += 1; assert.match(system, /un post image/); if (n === 2) assert.match(user, /CORRECTIONS DEMANDÉES/); return { texto: JSON.stringify(n === 1 ? gta : bom), modelo: 'sim', usage: {} }; } };
  const r = await ia.criarPeca({ llm, ctx, wc: skill.wc, formato: 'post', direcao: 'anuncie a game night de terça' });
  assert.equal(n, 2); assert.equal(r.ok, true); assert.equal(r.peca.image.titre, 'TOULOUSE · mardi'); assert.equal(r.peca.formato, 'post');
  await assert.rejects(ia.criarPeca({ llm, ctx, wc: skill.wc, formato: 'tiktok', direcao: 'x' }), /formato/);
  const reelLlm = { disponivel: true, modelo: 'sim', chamar: async () => ({ texto: JSON.stringify(JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'pacote-2026-11-20.json'), 'utf8')).reels[0]), modelo: 'sim', usage: {} }) };
  const rr = await ia.criarPeca({ llm: reelLlm, ctx, wc: skill.wc, formato: 'reel', direcao: 'a porta Falcon no Capitole' });
  assert.equal(rr.ok, true); assert.equal(rr.peca.reel.id, 'P'); assert.equal(rr.peca.titre, 'Pas eux');
});
