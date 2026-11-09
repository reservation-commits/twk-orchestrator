'use strict';
/** Testes da ferramenta: `node --test outils/wc.test.js`. Frases reais em francês, sem rede. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const wc = require('./wc.js');

const WC = path.join(__dirname, 'wc.js');
const rodar = (args, opts = {}) => execFileSync(process.execPath, [WC, ...args], { encoding: 'utf8', ...opts });

test('gancho: bom sobe, saudação e clichê caem, e a ordem é a esperada', () => {
  const bom = wc.noterAccroche("Il ne savait pas qu'il y avait une PS5 dans la voiture | Nice · il ne savait pas");
  const saudacao = wc.noterAccroche("Salut à tous, aujourd'hui je vais vous montrer notre nouvelle voiture");
  const cliche = wc.noterAccroche("Découvrez une expérience unique et inoubliable sur la Côte d'Azur");
  const mole = wc.noterAccroche('Alors du coup on a installé un ciel étoilé');
  assert.equal(bom.verdict, 'FORTE'); assert.equal(bom.formule.id, 'reaction'); assert.equal(bom.lieu, 'nice');
  assert.equal(saudacao.verdict, 'FRACA'); assert.equal(saudacao.controles.entree, 0); assert.ok(saudacao.note <= 30);
  assert.ok(cliche.note <= 45, 'clichê no gancho limita a nota'); assert.match(cliche.motifs.join(' '), /Clichê no gancho/);
  assert.equal(mole.controles.entree, 45);
  assert.ok(bom.note > mole.note && mole.note > saudacao.note);
  assert.ok(!bom.concrets.includes('5'), '"PS5" não conta como o número 5');
});

test('gancho: travas do plano bloqueiam, e a marca do jogo só bloqueia na tela', () => {
  const recorde = wc.noterAccroche('Le premier chauffeur gaming au monde | GTA 6 en Tesla');
  assert.equal(recorde.verdict, 'BLOQUEADA');
  assert.deepEqual(recorde.garde_fous.filter((x) => x.niveau === 'bloquant').map((x) => x.id).sort(), ['marque-jeu-ecran', 'record-sans-preuve']);
  assert.equal(wc.travas('On joue à GTA 6 sur la route de Monaco', 'voix').length, 0, 'na fala, a marca é permitida');
  assert.equal(wc.travas('On joue à GTA 6 sur la route de Monaco', 'legende').length, 0, 'na legenda também');
  assert.equal(wc.travas('GTA 6 en Tesla', 'ecran')[0].niveau, 'bloquant');
  assert.equal(wc.travas('La seule voiture de la Riviera où tu joues', 'legende').length, 0, 'o recorte da Riviera é o autorizado');
  assert.equal(wc.travas('Des touristes du monde entier', 'legende').length, 0, '"du monde entier" não é recorde');
});

test('travas: reserva, álcool, LEDs, motorista, hora, preço, concorrente', () => {
  const ids = (t, c = 'legende') => wc.travas(t, c).map((x) => x.id);
  assert.ok(ids('Monte direct, sans réservation').includes('sans-reservation'));
  assert.ok(ids('Champagne offert à bord').includes('alcool'));
  assert.ok(ids('Les LEDs allumées en roulant dans Nice').includes('leds-en-roulant'));
  assert.ok(ids('Julien joue aussi à la manette en conduisant').includes('chauffeur-ecran'));
  assert.ok(ids('Rendez-vous à 21h devant le Casino').includes('heure-24h'));
  assert.ok(!ids('Rendez-vous à 9:00 PM, trois heures à bord').includes('heure-24h'), 'AM/PM e duração passam');
  assert.ok(ids('Dispo ce soir').includes('disponibilite'));
  assert.ok(ids('Moins cher qu\'un Uber').includes('concurrent'));
  const dentro = wc.travas('82 euros chacun', 'legende').find((x) => x.id === 'prix');
  const fora = wc.travas('90 € chacun', 'legende').find((x) => x.id === 'prix');
  assert.match(dentro.message, /batem com a proposta/); assert.match(fora.message, /Fora da proposta: 90/);
  assert.equal(wc.travas('Son fils a adoré le trajet', 'legende').filter((x) => x.id === 'musique').length, 0, '"son" possessivo não é música');
});

test('fórmulas: reconhece frases francesas e se abstém quando não há fórmula', () => {
  const f = (s) => (wc.formuleDe(s) || {}).id;
  assert.equal(f('POV : tu commandes un chauffeur à Nice'), 'pov');
  assert.equal(f('Personne ne te dit que jouer en voiture donne le mal de mer'), 'personne-ne-dit');
  assert.equal(f('Combien coûte une soirée jeux à six ?'), 'prix');
  assert.equal(f('3 choses que personne ne fait en arrivant à Nice'), 'liste');
  assert.equal(f('Monte-Carlo, minuit. Vu de la banquette arrière'), 'lieu');
  assert.equal(f('Ne réserve pas ton transfert avant d\'avoir vu ça'), 'interdit');
  assert.equal(f('Hier soir, un père a réservé pour son fils'), 'histoire');
  assert.equal(f('Vous avez demandé combien consomme la PS5'), 'reponse');
  assert.equal(f('On a installé un ciel étoilé'), undefined);
});

test('roteiro: tempos, plano sem fala, texto de tela, volta ao gancho e assinatura', () => {
  const r = wc.minutage(['> Nice · 9:00 PM', '(1.5s) porte Falcon qui s\'ouvre', "Il ne savait pas qu'il y avait une PS5.", '(3s) sa réaction', 'Six amis, 82 euros chacun.', '> Vous jouez. On conduit. @wantedchauffeur', 'Et la PS5 reste allumée.'].join('\n'), { cible: 12 });
  assert.equal(r.batidas.length, 5); assert.equal(r.batidas[0].type, 'visuel'); assert.equal(r.batidas[0].duree, 1.5);
  assert.equal(r.notas_tela.length, 2);
  assert.ok(r.avisos.some((a) => /Fecha o ciclo/.test(a)));
  assert.ok(!r.avisos.some((a) => /Nenhuma cidade/.test(a)), 'a cidade está na tela no segundo zero');
  assert.ok(!r.avisos.some((a) => /assinatura/.test(a)));
  const ruim = wc.minutage('On roule et la partie continue pendant tout le trajet sans que personne ne regarde la route sauf lui.\nVoilà.\nC\'est tout.');
  assert.ok(ruim.avisos.some((a) => /primeira fala dura/.test(a))); assert.ok(ruim.avisos.some((a) => /Nenhuma cidade/.test(a))); assert.ok(ruim.avisos.some((a) => /assinatura/.test(a)));
});

test('legenda: trecho visível, hashtags, um pedido, clichês e tipografia francesa', () => {
  const ruim = wc.legende("Découvrez une expérience unique : six amis et la route de Monaco! Qui conduit? Personne.\n\nCommente JEU, abonne-toi pour plus et réserve via le lien en bio\n\n#a #b #c #d #e #f #g");
  const estado = Object.fromEntries(ruim.linhas.map((l) => [l.nome, l.estado]));
  assert.equal(estado.HASHTAGS, 'falha'); assert.equal(estado['UM PEDIDO'], 'aviso'); assert.equal(estado['CLICHÊS'], 'aviso');
  assert.equal(ruim.typographie.sem_espaco, 2);
  assert.ok(ruim.typographie.corrigido.includes('Monaco !') && ruim.typographie.corrigido.includes('conduit ?'), 'espaço fino insécable antes de ! e ?');
  assert.ok(ruim.typographie.corrigido.includes('unique :'), 'espaço insécable antes de :');
  const boa = wc.legende("Nice, 9:00 PM : il ne savait pas qu'il y avait une PS5 dans la voiture.\n\nSix amis, trois heures à bord.\n\nRéserve via le lien en bio.\n\n#wantedchauffeur #nice");
  assert.ok(boa.linhas.every((l) => l.estado === 'ok'), JSON.stringify(boa.linhas.filter((l) => l.estado !== 'ok')));
  assert.ok(!wc.tipografia('Voir https://theworldkeys.com/ride à 9:00 PM').corrigido.includes('https :'), 'endereço e hora não são mexidos');
  assert.equal(wc.tipografia('Bon​jour').corrigido, 'Bonjour', 'caractere invisível sai');
  assert.equal(wc.tipografia('Qui conduit ?').corrigido, 'Qui conduit ?', 'o espaço certo do francês fica');
  assert.equal(wc.legende('Vous jouez. On conduit. Nice · Monaco · Cannes. by The World Keys', { type: 'bio' }).linhas[0].estado, 'ok');
  assert.equal(wc.legende('GTA 6 dans une Tesla', { type: 'bio' }).garde_fous[0].niveau, 'bloquant');
});

test('pesquisa: ordena pelo múltiplo sobre a mediana, não pela visualização bruta', () => {
  const tsv = ['compte\tabonnes\tmediane\tvues\taccroche', '@grande\t2000000\t900000\t1200000\tAujourd\'hui je vais vous montrer ma routine', '@pequena\t4000\t10700\t412000\tPersonne ne te dit que les 30 premiers reels vont rater', '@media\t48000\t16100\t180000\tPOV : tu arrives à Monaco en Tesla'].join('\n');
  const r = wc.veille(tsv);
  assert.equal(r.itens[0].compte, '@pequena'); assert.equal(r.itens[0].multiple, 38.5); assert.equal(r.itens[2].compte, '@grande');
  assert.equal(r.sinais.length, 2); assert.equal(r.itens[0].formule.id, 'personne-ne-dit'); assert.match(r.amostra, /pequena/);
  assert.equal(wc.veille('conta\tseguidores\tviews\tgancho\n@x\t12k\t1,2M\tPOV : test à Nice').itens[0].multiple, 100, 'aceita cabeçalho em português e "12k", "1,2M"');
  assert.throws(() => wc.veille('a\tb\n1\t2'), /colunas/);
});

test('diário e balanço: acrescenta, atualiza sem apagar, mede só quando há dados', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wc-journal-'));
  const base = ['--dossier', dir, '--json'];
  const p1 = JSON.parse(rodar(['journal', 'ajouter', '--accroche', "Il ne savait pas qu'il y avait une PS5", '--ecran', 'Nice · il ne savait pas', '--personnage', 'vice', '--pilier', 'entree', '--ville', 'Nice', '--date', '2026-11-19', ...base]));
  assert.equal(p1.id, 'P-20261119-01');
  const p2 = JSON.parse(rodar(['journal', 'ajouter', '--accroche', 'Monte-Carlo, minuit', '--personnage', 'vice', '--pilier', 'nuit', '--date', '2026-11-19', ...base]));
  assert.equal(p2.id, 'P-20261119-02', 'dois posts no mesmo dia não colidem');
  rodar(['journal', 'maj', p1.id, '--vues', '9000', '--portee', '8000', '--partages', '80', ...base]);
  rodar(['journal', 'maj', p1.id, '--vues', '18400', '--leads', '4', ...base]);
  const posts = wc.lerJournal(dir);
  assert.equal(posts.find((p) => p.id === p1.id).vues, 18400, 'vale a última leitura'); assert.equal(posts.find((p) => p.id === p1.id).partages, 80, 'e o que veio antes fica');
  assert.equal(fs.readFileSync(path.join(dir, 'journal.jsonl'), 'utf8').trim().split('\n').length, 4, 'o arquivo só acrescenta');
  assert.throws(() => rodar(['journal', 'maj', 'P-20000101-01', '--vues', '1', ...base], { stdio: 'pipe' }), /não está no diário/);
  assert.throws(() => rodar(['journal', 'maj', p1.id, '--vues', 'muitas', ...base], { stdio: 'pipe' }), /precisa ser número/);
  const b = JSON.parse(rodar(['bilan', ...base]));
  assert.equal(b.avec_vues, 1); assert.equal(b.calibragem.pronta, false); assert.match(b.calibragem.message, /1\/20/); assert.match(b.amostra, /pequena/);
});

test('balanço com 24 posts: múltiplos, agrupamentos com n, e a calibração aparece', () => {
  const posts = [];
  for (let i = 0; i < 24; i++) {
    const forte = i % 2 === 0;
    posts.push({ id: `P-${i}`, date: `2026-11-${String((i % 28) + 1).padStart(2, '0')}`, plateforme: 'instagram', format: 'reel', accroche: forte ? "Il ne savait pas qu'il y avait une PS5 à Nice" : 'Alors du coup on a installé un truc', ecran: forte ? 'Nice · PS5' : '', personnage: forte ? 'vice' : 'fugitif', pilier: forte ? 'entree' : 'coulisses', vues: forte ? 20000 + i * 100 : 5000 + i * 10, portee: 10000, partages: forte ? 120 : 20, leads: forte ? 2 : 0 });
  }
  const b = wc.bilan(posts);
  assert.equal(b.avec_vues, 24); assert.equal(b.calibragem.pronta, true);
  const nota = b.calibragem.lignes.find((l) => l.controle === 'note');
  assert.ok(nota.multiple_haut > nota.multiple_bas, 'neste conjunto fabricado, gancho melhor rende mais');
  assert.equal(b.par.personnage[0].valor, 'vice'); assert.equal(b.par.personnage[0].n, 12);
  assert.ok(b.classement[0].multiple > 1 && b.classement.at(-1).multiple < 1);
  assert.equal(b.taux.partages_pour_1000_portee.n, 24); assert.ok(b.taux.leads_pour_10000_vues.mediane >= 0);
  assert.match(b.calibragem.message, /não prova/);
});

test('linha de comando: lê arquivo com BOM, texto direto e devolve JSON', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wc-cli-'));
  const f = path.join(dir, 'g.txt'); fs.writeFileSync(f, '﻿POV : ton chauffeur arrive à Cannes | Cannes · POV\n- Bonjour à tous\n');
  const r = JSON.parse(rodar(['accroche', f, '--json']));
  assert.equal(r.length, 2); assert.equal(r[0].formule.id, 'pov'); assert.equal(r[1].verdict, 'FRACA');
  assert.match(rodar(['garde', '--texte', 'Champagne à bord', '--contexte', 'legende']), /BLOQUEIA/);
  assert.match(rodar(['legende', '--texte', 'Nice ce soir', '--plateforme', 'tiktok']), /não foram conferidos/);
  assert.throws(() => rodar(['legende', '--texte', 'x', '--plateforme', 'orkut'], { stdio: 'pipe' }), /Plataforma desconhecida/);
});
