'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { lerCsv, montar, valor, COLUNAS } = require('../agenda-do-dia.js');

const CSV = `${COLUNAS.join(',')}
Paul Durand,+33 6 11 22 33 44,Hôtel Capitole,hôtel,Transfer,2026-11-24,7:00 AM,WTD-H-P8QA,confirmado,
Léa Martin,+33 6 55 66 77 88,Saint-Cyprien,TikTok,Game Night,2026-11-24,9:00 PM,WTD-T-7K2Q,confirmado,"6 personnes, anniversaire"
Marc Petit,+33 6 99 88 77 66,Compans,Instagram,Night Ride,2026-11-24,11:00 PM,WTD-I-M4XZ,orcado,
Ana Silva,+33 6 00 11 22 33,Blagnac,site,Mise à disposition,2026-11-24,2:00 PM,WTD-S-AB12,confirmado,3 h
Outro Dia,+33 6 12 12 12 12,Capitole,hôtel,Transfer,2026-11-25,8:00 AM,,confirmado,
`;

test('corridas confirmadas do dia em ordem de hora, com valor da tabela e o nome de quem embarca', () => {
  const r = montar(lerCsv(CSV), { dia: '2026-11-24' });
  assert.equal(r.corridas, 3); assert.equal(r.pendentes, 1);
  const l = r.mensagem.split('\n');
  assert.equal(l[0], 'Bonjour Julien, agenda du mardi 24 novembre :');
  assert.ok(l[2].startsWith('7:00 AM · Paul Durand · Transfer · Hôtel Capitole · hôtel · 80 € · WTD-H-P8QA'));
  assert.ok(l[3].startsWith('2:00 PM · Ana Silva · Mise à disposition') && l[3].includes('270 € (3 h)'));
  assert.ok(l[4].startsWith('9:00 PM · Léa Martin · Game Night') && l[4].includes('350 €'));
  assert.ok(r.mensagem.includes('À confirmer encore aujourd\'hui : 11:00 PM Marc Petit (orcado)'));
  assert.ok(!r.mensagem.includes('+33'), 'a agenda não repete o telefone do cliente');
  assert.deepEqual(r.avisos, []);
});

test('dia sem corrida: ideia do dia e hotel do cartão; sem os dois, aviso', () => {
  const r = montar(lerCsv(CSV), { dia: '2026-11-26', ideia: 'le Capitole à minuit, portes ouvertes', hotel: 'Hôtel Exemple' });
  assert.ok(r.mensagem.includes('Aucune course confirmée'));
  assert.ok(r.mensagem.includes('Idée de vidéo du jour : le Capitole à minuit'));
  assert.ok(r.mensagem.includes('Carte à déposer : Hôtel Exemple'));
  assert.equal(montar(lerCsv(CSV), { dia: '2026-11-26' }).avisos.length, 1);
});

test('falha alto: coluna faltando; hora fora de AM/PM vira aviso', () => {
  assert.throws(() => montar(lerCsv('nome,data\nx,2026-11-24\n'), { dia: '2026-11-24' }), /não tem as colunas/);
  const r = montar(lerCsv(`${COLUNAS.join(',')}\nX Y,,,,Transfer,2026-11-24,19:00,,confirmado,\n`), { dia: '2026-11-24' });
  assert.equal(r.corridas, 1); assert.match(r.avisos[0], /não está em AM\/PM/);
});

test('valores: tabela de 16/11; produto desconhecido não inventa preço', () => {
  assert.equal(valor('Transfer'), '80 €'); assert.equal(valor('Soirée'), '390 € + dîner'); assert.equal(valor('mise à disposition', '2h'), '180 € (2 h)');
  assert.equal(valor('Uber'), null);
});
