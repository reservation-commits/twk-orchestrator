'use strict';
/**
 * Dados de ENSAIO para ver o painel /estudio neste computador (dev-local.cjs). NUNCA roda em produção:
 * só é chamado pelo dev-local, que usa uma pasta temporária de estado.
 *   - pacote de 20/11 (o gabarito escrito à mão) e uma cópia datada de 19/11, para o arquivo ter dois dias
 *   - estado dos Reels de 19/11 (um publicado com link, um filmado, um descartado)
 *   - leitura FALSA do Olheiro, marcada `demo: true` (o painel mostra a faixa « Dados de ensaio »)
 */
const fs = require('node:fs');
const path = require('node:path');

async function semear(stateRoot, { log = () => {} } = {}) {
  const dir = path.join(stateRoot, 'agents', 'estudio-viral');
  if (fs.existsSync(path.join(dir, 'pacote-2026-11-20.json'))) return false;
  const { rodar } = require('./run.js');
  const fixture = path.join(__dirname, 'test', 'fixtures', 'pacote-2026-11-20.json');
  await rodar({ argv: ['--fixture', fixture, '--dia', '2026-11-20'], env: {}, log: () => {}, stateDir: dir });
  const p19 = JSON.parse(fs.readFileSync(fixture, 'utf8')); p19.date = '2026-11-19';
  p19.tendance_du_jour = 'Le jeu sort aujourd\'hui dans le monde entier. On montre son arrivée dans la voiture, sans jamais écrire son nom à l\'écran.';
  p19.resume_pt = 'Pacote de ensaio de 19/11, só para o arquivo ter dois dias neste computador.';
  ['Il est arrivé', 'Qui conduit ?', 'J-5'].forEach((t, i) => { p19.reels[i].titre = t; });
  const tmp = path.join(dir, '_p19.json'); fs.writeFileSync(tmp, JSON.stringify(p19));
  await rodar({ argv: ['--fixture', tmp, '--dia', '2026-11-19'], env: {}, log: () => {}, stateDir: dir }); fs.unlinkSync(tmp);
  const est = require('./estado.js').abrir(dir);
  est.marcar({ dia: '2026-11-19', reel: 'R1', status: 'filme', por: 'julien' });
  est.marcar({ dia: '2026-11-19', reel: 'R1', status: 'publie', lien: 'https://www.instagram.com/reel/DEMOaaa111/', por: 'julien' });
  est.marcar({ dia: '2026-11-19', reel: 'R2', status: 'filme', por: 'julien' });
  est.marcar({ dia: '2026-11-19', reel: 'R3', status: 'ecarte', por: 'julien' });

  const ol = path.join(stateRoot, 'agents', 'olheiro-instagram'); fs.mkdirSync(ol, { recursive: true });
  const base = Date.parse('2026-11-06T12:00:00Z'); let seg = 212; const hist = [];
  for (let i = 0; i < 14; i++) { seg += [3, 5, 2, 8, 4, 6, 11, 7, 5, 9, 14, 22, 31, 18][i]; hist.push({ dia: new Date(base + i * 86400000).toISOString().slice(0, 10), seguidores: seg, posts: 6 + i }); }
  fs.writeFileSync(path.join(ol, 'estado.json'), JSON.stringify({ demo: true, conta_historico: hist }));
  fs.writeFileSync(path.join(ol, 'resumo.json'), JSON.stringify({ demo: true, atualizado_em: '2026-11-19T06:10:00.000Z', conta: { username: 'wantedchauffeur' }, numeros: { seguidores: seg, seguidores_7d: seg - hist[6].seguidores, mediana_views_reels_30d: 1840 }, melhores_30d: [] }, null, 1));
  fs.writeFileSync(path.join(ol, 'journal.jsonl'), [
    { id: 'IG-1', date: '2026-11-19', plateforme: 'instagram', format: 'reel', accroche: 'Ce soir, Toulouse joue dans son salon.', lien: 'https://www.instagram.com/reel/DEMOaaa111/', vues: 6420, abonnes: 31, partages: 44, enregistrements: 27 },
    { id: 'IG-2', date: '2026-11-17', plateforme: 'instagram', format: 'reel', accroche: 'Personne ne te dit qui conduit cette voiture.', lien: 'https://www.instagram.com/reel/DEMObbb222/', vues: 1840, abonnes: 6 },
    { id: 'IG-3', date: '2026-11-15', plateforme: 'instagram', format: 'reel', accroche: 'TOULOUSE · 11:00 PM', lien: 'https://www.instagram.com/reel/DEMOccc333/', vues: 1210, abonnes: 3 },
  ].map((l) => JSON.stringify(l)).join('\n') + '\n');
  log('[dev-seed] Studio: pacotes de 19 e 20/11 e leitura de ENSAIO do Olheiro gravados');
  return true;
}

/** Modelo SIMULADO para a área Criar no dev-local: responde pelo formato pedido no prompt. Nunca em produção. */
function llmSimulado() {
  const pecas = {
    post: { titre: 'Game Night mardi', image: { fond: 'nuit', titre: 'TOULOUSE · mardi 9:00 PM', sous_titre: '3 h à bord, 2 manettes, 6 amis.', bas: '58 € chacun · lien en bio' }, legende: 'Mardi 9:00 PM, première Game Night à Toulouse : 3 h à bord de la Model X, PS5, 2 manettes, ciel étoilé, boissons sans alcool. 350 € la voiture, 58 € chacun à six.\nLien en bio.', hashtags: ['#Toulouse', '#WantedChauffeur', '#GameNight'], pourquoi: 'Annonce directe avec le prix par personne.', traduction_pt: 'Terça 9:00 PM, primeira Game Night em Toulouse: 3 h a bordo, PS5, 2 controles, teto estrelado. 350 € o carro, 58 € cada um a seis. Link na bio.' },
    story: { titre: 'Sondage du soir', image: { fond: 'ciel', titre: 'TOULOUSE · ce soir', sous_titre: 'Tu joues où ?', bas: 'réponds au sondage' }, sticker: 'Sondage : Salon / Banquette arrière', legende: '', hashtags: [], pourquoi: 'Le sondage fait répondre.', traduction_pt: 'Enquete: você joga onde hoje? Sala / Banco de trás.' },
    carrossel: { titre: 'Ce qu’il y a à bord', slides: [{ fond: 'nuit', titre: 'TOULOUSE · à bord', texte: 'Tout ce que tu trouves sur la banquette arrière.' }, { fond: 'interieur', titre: 'Une PS5', texte: 'Deux manettes, le jeu du moment.' }, { fond: 'ciel', titre: 'Un ciel étoilé', texte: 'Au plafond, toute la nuit.' }, { fond: 'led', titre: 'Les LED', texte: 'Violet, rose, bleu clair, voiture à l’arrêt.' }, { fond: 'noir', titre: '58 € chacun', texte: '3 h à six. Lien en bio.' }], legende: 'Tout ce qu’il y a sur la banquette arrière, en 5 images. 350 € la voiture pour 3 h, 58 € chacun à six.\nLien en bio.', hashtags: ['#Toulouse', '#WantedChauffeur', '#GameNight'], pourquoi: 'Un carrousel se garde et se partage.', traduction_pt: 'Tudo o que tem no banco de trás, em 5 imagens.' },
  };
  const reel = JSON.parse(fs.readFileSync(path.join(__dirname, 'test', 'fixtures', 'pacote-2026-11-20.json'), 'utf8')).reels[2];
  return { disponivel: true, modelo: 'simulado-dev', effort: 'high', chamar: async ({ system }) => { await new Promise((ok) => setTimeout(ok, 600)); const f = /un post image/.test(system) ? 'post' : /une story/.test(system) ? 'story' : /un carrousel/.test(system) ? 'carrossel' : 'reel'; return { texto: JSON.stringify(f === 'reel' ? { ...reel, titre: 'Peça simulada' } : pecas[f]), modelo: 'simulado-dev', usage: {} }; } };
}

module.exports = { semear, llmSimulado };
