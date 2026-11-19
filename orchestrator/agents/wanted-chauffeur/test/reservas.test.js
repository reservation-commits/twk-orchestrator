'use strict';
/** Reservas (modo arquivo): validação, status por evento, agenda do dia, pendentes, anonimização, não-contatar, importação do plano B. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const R = require('../reservas.js');
const vigia = require('../vigia-reservas.js');
const avisar = require('../avisar.js');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'twk-reservas-'));
let relogio = Date.parse('2026-11-19T18:00:00Z');
const store = R.abrirArquivo({ dir, agora: () => relogio });

test('validar: normaliza, calcula o valor em centavos, descarta campo estranho e recusa o que não presta', () => {
  const ok = R.validar({ codigo: ' wtd-h-ab23 ', produto: 'MAD', horas: 3, data: '2026-11-24', hora: '7:00 am', pessoas: '2', nome: '  Paul  Durand ', whatsapp: '+33 (0)6-11-22-33-44', partida: 'Hôtel Capitole', extra: 1 }, { exigirPessoa: true });
  assert.equal(ok.erro, undefined);
  assert.equal(ok.reserva.codigo, 'WTD-H-AB23'); assert.equal(ok.reserva.origem, 'H'); assert.equal(ok.reserva.hora, '7:00 AM'); assert.equal(ok.reserva.pessoas, 2);
  assert.equal(ok.reserva.nome, 'Paul Durand'); assert.equal(ok.reserva.valor_cent, 27000); assert.equal(ok.reserva.horas, 3);
  assert.equal(ok.reserva.whatsapp, '+330611223344'.replace('+330', '+33')); // "(0)" cai e o 0 nacional também
  assert.equal(ok.reserva.extra, undefined);
  assert.equal(R.validar({ codigo: 'WTD-T-AAAA', produto: 'game' }, { exigirPessoa: true }).erro, 'nome de quem embarca (2 a 80 letras)');
  assert.equal(R.validar({ codigo: 'WTD-T-AAAA', produto: 'game', nome: '06 12 34 56 78' }, { exigirPessoa: true }).erro, 'o nome não pode ter telefone');
  assert.match(R.validar({ codigo: 'WTD-T-AAAA', produto: 'game', nome: 'A B', whatsapp: 'abc' }).erro, /WhatsApp/);
  assert.equal(R.validar({ codigo: 'WTD-T-AAAA', produto: 'game', hora: '21:00' }).erro, 'hora em AM/PM, passos de 5 min (ex.: 9:00 PM)');
  assert.equal(R.normalizarWhatsapp('0033 6 12 34 56 78'), '+33612345678');
  assert.equal(R.normalizarWhatsapp('06 12 34 56 78'), '+33612345678');
  assert.equal(R.normalizarWhatsapp('+55 11 98765 4321'), '+5511987654321');
  assert.equal(R.valorCent('soiree'), 39000); assert.equal(R.valorCent('mad', 2), 18000); assert.equal(R.valorCent('mad'), 18000);
});

test('criar, status por evento (o último vale), ficha, lista, agenda do dia e pendentes', async () => {
  const mk = (codigo, extra) => R.validar({ codigo, produto: 'game', data: '2026-11-24', hora: '9:00 PM', pessoas: 6, nome: 'Léa Martin', whatsapp: '+33612345678', partida: 'Capitole', ...extra }, { exigirPessoa: true }).reserva;
  assert.equal((await store.criar(mk('WTD-T-7K2Q'))).status, 201);
  assert.equal((await store.criar(mk('WTD-T-7K2Q'))).repetido, true);
  assert.equal((await store.criar(mk('WTD-H-P8QA', { produto: 'transfer', hora: '7:00 AM', nome: 'Paul Durand' }))).status, 201);
  assert.equal((await store.criar(mk('WTD-I-ZZ22', { data: '2026-11-25', nome: 'Ana Souza' }))).status, 201);
  assert.equal((await store.evento({ codigo: 'WTD-X-0000', tipo: 'status', valor: 'orcado' })).status, 404);
  assert.equal((await store.evento({ codigo: 'WTD-T-7K2Q', tipo: 'status', valor: 'orcado', por: 'marlon' })).status, 200);
  relogio += 60_000;
  assert.equal((await store.evento({ codigo: 'WTD-T-7K2Q', tipo: 'status', valor: 'confirmado', por: 'marlon' })).status, 200);
  assert.equal((await store.evento({ codigo: 'WTD-H-P8QA', tipo: 'status', valor: 'confirmado' })).status, 200);
  assert.equal((await store.evento({ codigo: 'WTD-T-7K2Q', tipo: 'aviso', valor: 'nova_reserva' })).status, 200);
  const f = await store.obter('WTD-T-7K2Q');
  assert.equal(f.status, 'confirmado'); assert.deepEqual(f.avisos, ['nova_reserva']); assert.equal(f.valor_eur, 350); assert.equal(f.whatsapp_mascarado, '+33…5678'); assert.equal(f.produto_nome, 'Game Night');
  assert.equal((await store.listar({ dias: 7 })).length, 3); assert.equal(await store.total(), 3);
  const dia = await store.doDia('2026-11-24');
  assert.deepEqual(dia.map((r) => r.codigo), ['WTD-H-P8QA', 'WTD-T-7K2Q'], 'ordenado pela hora');
  // pendentes: só quem ainda está em "pedido" há mais de 30 min e ainda não foi avisado
  assert.deepEqual((await store.pendentes(30)).map((r) => r.codigo), []);
  relogio += 31 * 60_000;
  assert.deepEqual((await store.pendentes(30)).map((r) => r.codigo), ['WTD-I-ZZ22']);
  await store.evento({ codigo: 'WTD-I-ZZ22', tipo: 'aviso', valor: 'pendente' });
  assert.deepEqual((await store.pendentes(30)).map((r) => r.codigo), []);
});

test('vigia: avisa o Márlon uma vez por pedido parado, em português, sem telefone; sem segredo não tenta e diz', async () => {
  const mk = R.validar({ codigo: 'WTD-Y-PEND', produto: 'night', data: '2026-11-27', hora: '10:00 PM', nome: 'Marc Petit', whatsapp: '+33699887766' }, { exigirPessoa: true }).reserva;
  await store.criar(mk); relogio += 45 * 60_000;
  const envios = [];
  const fetchImpl = async (url, init) => { envios.push(JSON.parse(init.body)); return { ok: true, status: 200, json: async () => ({ ok: true, desfecho: 'alerta_equipe_enviado' }) }; };
  const semSegredo = await vigia.rodar({ store, env: {}, fetchImpl, estado: { anonimizado_em: '2026-11-19' }, agora: () => relogio });
  assert.equal(semSegredo.pendentes, 1); assert.equal(semSegredo.falhas[0].motivo, 'sem ARIA_TEAM_ALERT_SECRET'); assert.equal(envios.length, 0);
  const r = await vigia.rodar({ store, env: { ARIA_TEAM_ALERT_SECRET: 's', AGENT_ARIA_URL: 'https://aria.test' }, fetchImpl, estado: { anonimizado_em: '2026-11-19' }, agora: () => relogio });
  assert.deepEqual(r.avisados, ['WTD-Y-PEND']); assert.equal(envios.length, 1);
  assert.equal(envios[0].destinatario, 'marlon'); assert.equal(envios[0].evento, 'pendente:WTD-Y-PEND');
  assert.match(envios[0].situacao, /^Pedido WTD-Y-PEND \(Night Ride, 2026-11-27 10:00 PM, Marc Petit\) está há \d+ min sem resultado/);
  assert.ok(!envios[0].situacao.includes('+33'));
  const r2 = await vigia.rodar({ store, env: { ARIA_TEAM_ALERT_SECRET: 's' }, fetchImpl, estado: { anonimizado_em: '2026-11-19' }, agora: () => relogio });
  assert.equal(r2.avisados.length, 0); assert.equal(envios.length, 1, 'não repete');
  const t = avisar.textoNovaReserva({ codigo: 'WTD-T-7K2Q', produto: 'mad', horas: 3, data: '2026-11-24', hora: '7:00 AM', pessoas: 2, valor_cent: 27000, partida: 'Hôtel Capitole', destino: 'Aéroport de Blagnac', nome: 'Paul Durand' });
  assert.equal(t, 'Nouvelle demande WTD-T-7K2Q : Mise à disposition 3 h, mardi 24 novembre 7:00 AM, 2 pers., 270 €. Départ Hôtel Capitole → Aéroport de Blagnac. Au nom de Paul Durand. Le client t\'écrit sur WhatsApp : réponds avec l\'heure, le nom et le montant.');
  assert.ok(t.length <= 300);
});

test('anonimizar: apaga a pessoa das reservas encerradas há mais de 365 dias e mantém código, produto, valor e status', async () => {
  const velha = R.validar({ codigo: 'WTD-S-ANTG', produto: 'transfer', data: '2025-10-01', nome: 'Antiga Cliente', whatsapp: '+33611111111', partida: 'X', recado: 'y' }, { exigirPessoa: true }).reserva;
  await store.criar(velha); await store.evento({ codigo: 'WTD-S-ANTG', tipo: 'status', valor: 'feito' });
  const aberta = R.validar({ codigo: 'WTD-S-ABER', produto: 'transfer', data: '2025-10-01', nome: 'Pedido Esquecido' }, { exigirPessoa: true }).reserva;
  await store.criar(aberta); // ficou em "pedido": só apaga 30 dias depois do prazo
  relogio = Date.parse('2026-10-15T12:00:00Z');
  let a = await store.anonimizar(365);
  assert.equal(a.anonimizadas, 1);
  const v = await store.obter('WTD-S-ANTG');
  assert.equal(v.nome, null); assert.equal(v.whatsapp, null); assert.equal(v.recado, null); assert.ok(v.anonimizado_em); assert.equal(v.status, 'feito'); assert.equal(v.valor_cent, 8000);
  assert.equal((await store.obter('WTD-S-ABER')).nome, 'Pedido Esquecido');
  relogio = Date.parse('2026-11-15T12:00:00Z');
  a = await store.anonimizar(365); assert.equal(a.anonimizadas, 1);
  assert.equal((await store.obter('WTD-S-ABER')).nome, null);
  assert.equal((await store.obter('WTD-T-7K2Q')).nome, 'Léa Martin', 'as recentes ficam');
});

test('não-contatar: por WhatsApp ou nome; bloqueado() reconhece os dois', async () => {
  assert.equal((await store.naoContatar.adicionar({})).status, 400);
  assert.equal((await store.naoContatar.adicionar({ whatsapp: '06 99 88 77 66', motivo: 'não quer ser filmado', por: 'marlon' })).status, 201);
  assert.equal((await store.naoContatar.adicionar({ nome: 'Jean Dupont' })).status, 201);
  assert.equal(await store.naoContatar.bloqueado({ whatsapp: '+33699887766' }), true);
  assert.equal(await store.naoContatar.bloqueado({ nome: 'jean dupont' }), true);
  assert.equal(await store.naoContatar.bloqueado({ whatsapp: '+33600000000', nome: 'Outra' }), false);
  assert.equal((await store.naoContatar.listar()).length, 2);
});

test('importa o plano B de 18/11 (chauffeur-leads.jsonl + resultados) uma única vez, sem pessoa', async () => {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'twk-planob-'));
  fs.writeFileSync(path.join(raiz, 'chauffeur-leads.jsonl'), JSON.stringify({ codigo: 'WTD-T-VELH', origem: 'T', produto: 'game', data: '2026-11-20', hora: '9:00 PM', pessoas: 4, idioma: 'fr', imagens: 'privadas', criado_em: '2026-11-18T10:00:00.000Z' }) + '\n');
  fs.writeFileSync(path.join(raiz, 'chauffeur-leads-resultados.jsonl'), JSON.stringify({ codigo: 'WTD-T-VELH', resultado: 'confirmado', em: '2026-11-18T12:00:00.000Z' }) + '\n');
  const s2 = R.abrirArquivo({ dir: path.join(raiz, 'agents', 'wanted-chauffeur') });
  assert.deepEqual(await s2.importarLeadsAntigos(path.join(raiz, 'chauffeur-leads.jsonl'), path.join(raiz, 'chauffeur-leads-resultados.jsonl')), { importados: 1 });
  const r = await s2.obter('WTD-T-VELH');
  assert.equal(r.status, 'confirmado'); assert.equal(r.nome, null); assert.equal(r.criado_em, '2026-11-18T10:00:00.000Z'); assert.equal(r.valor_cent, 35000);
  assert.equal((await s2.importarLeadsAntigos(path.join(raiz, 'chauffeur-leads.jsonl'), path.join(raiz, 'chauffeur-leads-resultados.jsonl'))).ja, true);
});

test('abrir: sem CHAUFFEUR_RESERVAS_BANCO fica no arquivo; com a chave e sem TWK_DBA_URL avisa', async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'twk-abrir-'));
  assert.equal((await R.abrir({ dir: d, env: {} })).modo, 'arquivo');
  const s = await R.abrir({ dir: d, env: { CHAUFFEUR_RESERVAS_BANCO: 'on' } });
  assert.equal(s.modo, 'arquivo'); assert.match(s.aviso, /TWK_DBA_URL ausente/);
});
