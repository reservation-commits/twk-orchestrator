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

module.exports = { semear };
