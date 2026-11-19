'use strict';
/** Fase 2: confirmação e lembretes ao cliente pela Meta, link de confirmação do Julien, lembretes na vigia. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const R = require('../reservas.js');
const cliente = require('../cliente.js');
const confirmar = require('../confirmar.js');
const vigia = require('../vigia-reservas.js');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'twk-fase2-'));
let relogio = Date.parse('2026-11-23T18:00:00Z'); // 23/11 7:00 PM em Paris
const store = R.abrirArquivo({ dir, agora: () => relogio });
const META = { WC_WA_TOKEN: 'tok', WC_WA_PHONE_NUMBER_ID: '123', WC_TEMPLATE_CONFIRMED: 'wc_ride_confirmed', WC_TEMPLATE_REMINDER: 'wc_ride_reminder' };
const mk = (o) => R.validar({ produto: 'game', data: '2026-11-24', hora: '9:00 PM', pessoas: 6, nome: 'Léa Martin', whatsapp: '+33612345678', partida: 'Place du Capitole', idioma: 'fr', ...o }, { exigirPessoa: true }).reserva;
const meta = () => { const envios = []; return { envios, fetchImpl: async (url, init) => { envios.push({ url, auth: init.headers.authorization, corpo: JSON.parse(init.body) }); return { ok: true, status: 200, json: async () => ({ messages: [{ id: 'wamid.ABC' }] }) }; } }; };

test('cliente: sem canal registra sem_canal uma vez e não chama a Meta; com canal manda o template na ordem do contrato, uma vez', async () => {
  await store.criar(mk({ codigo: 'WTD-T-7K2Q' }));
  const m = meta();
  let e = await cliente.enviar({ store, reserva: { codigo: 'WTD-T-7K2Q' }, tipo: 'confirmacao_cliente', env: {}, fetchImpl: m.fetchImpl });
  assert.equal(e.motivo, 'sem_canal'); assert.equal(m.envios.length, 0);
  e = await cliente.enviar({ store, reserva: { codigo: 'WTD-T-7K2Q' }, tipo: 'confirmacao_cliente', env: {}, fetchImpl: m.fetchImpl });
  assert.deepEqual((await store.obter('WTD-T-7K2Q')).avisos, ['sem_canal'], 'sem_canal só uma vez');
  e = await cliente.enviar({ store, reserva: { codigo: 'WTD-T-7K2Q' }, tipo: 'confirmacao_cliente', env: META, fetchImpl: m.fetchImpl });
  assert.equal(e.enviado, true); assert.equal(e.id, 'wamid.ABC');
  assert.equal(m.envios.length, 1);
  const c = m.envios[0];
  assert.equal(c.url, 'https://graph.facebook.com/v21.0/123/messages'); assert.equal(c.auth, 'Bearer tok');
  assert.equal(c.corpo.to, '33612345678'); assert.equal(c.corpo.template.name, 'wc_ride_confirmed'); assert.equal(c.corpo.template.language.code, 'fr');
  assert.deepEqual(c.corpo.template.components[0].parameters.map((p) => p.text), ['Game Night', 'Mardi 24 novembre 2026', '9:00 PM', 'Léa Martin', 'Place du Capitole', '350 €', 'WTD-T-7K2Q']);
  e = await cliente.enviar({ store, reserva: { codigo: 'WTD-T-7K2Q' }, tipo: 'confirmacao_cliente', env: META, fetchImpl: m.fetchImpl });
  assert.equal(e.motivo, 'já enviada'); assert.equal(m.envios.length, 1);
  const r = await store.obter('WTD-T-7K2Q');
  assert.ok(r.avisos.includes('confirmacao_cliente'));
});

test('cliente: inglês quando a página não era em francês; sem WhatsApp e não-contatar barram; recusa da Meta vira evento sem telefone', async () => {
  await store.criar(mk({ codigo: 'WTD-Y-ENGL', idioma: 'en', whatsapp: '+447700900123', produto: 'soiree' }));
  const m = meta();
  await cliente.enviar({ store, reserva: { codigo: 'WTD-Y-ENGL' }, tipo: 'lembrete_vespera', env: META, fetchImpl: m.fetchImpl });
  assert.equal(m.envios[0].corpo.template.language.code, 'en'); assert.equal(m.envios[0].corpo.template.name, 'wc_ride_reminder');
  assert.deepEqual(m.envios[0].corpo.template.components[0].parameters.map((p) => p.text), ['tomorrow', 'Soirée', '9:00 PM', 'Léa Martin', 'Place du Capitole', 'WTD-Y-ENGL']);
  await store.criar(mk({ codigo: 'WTD-H-SEMW', whatsapp: null }));
  assert.equal((await cliente.enviar({ store, reserva: { codigo: 'WTD-H-SEMW' }, tipo: 'confirmacao_cliente', env: META, fetchImpl: m.fetchImpl })).motivo, 'sem_whatsapp');
  await store.criar(mk({ codigo: 'WTD-I-NACQ', whatsapp: '+33699000000' }));
  await store.naoContatar.adicionar({ whatsapp: '+33699000000', motivo: 'pediu' });
  assert.equal((await cliente.enviar({ store, reserva: { codigo: 'WTD-I-NACQ' }, tipo: 'confirmacao_cliente', env: META, fetchImpl: m.fetchImpl })).motivo, 'nao_contatar');
  assert.equal(m.envios.length, 1);
  await store.criar(mk({ codigo: 'WTD-S-FALH' }));
  const recusa = async () => ({ ok: false, status: 400, json: async () => ({ error: { code: 132001, message: 'Template name does not exist +33612345678' } }) });
  const e = await cliente.enviar({ store, reserva: { codigo: 'WTD-S-FALH' }, tipo: 'confirmacao_cliente', env: META, fetchImpl: recusa });
  assert.equal(e.enviado, false); assert.match(e.motivo, /132001/);
  const r = await store.obter('WTD-S-FALH');
  assert.deepEqual(r.avisos, ['confirmacao_cliente_falhou']);
  const evFalha = fs.readFileSync(store.arquivos.eventos, 'utf8').split(/\r?\n/).find((l) => l.includes('confirmacao_cliente_falhou'));
  assert.ok(evFalha && evFalha.includes('132001') && !evFalha.includes('+33612345678'), 'o motivo gravado não leva telefone');
});

test('confirmar: token só com segredo, link só com a URL base, página com a ficha e sem telefone, token errado não vale', () => {
  assert.equal(confirmar.token('WTD-T-7K2Q', {}), null);
  assert.equal(confirmar.link('WTD-T-7K2Q', { CHAUFFEUR_CONFIRMA_SECRET: 's' }), null);
  const env = { CHAUFFEUR_CONFIRMA_SECRET: 's3gredo', CHAUFFEUR_CONFIRMA_URL: 'https://central.test/' };
  const l = confirmar.link('WTD-T-7K2Q', env);
  assert.match(l, /^https:\/\/central\.test\/c\/WTD-T-7K2Q\?t=[A-Za-z0-9_-]{16}$/);
  const t = new URL(l).searchParams.get('t');
  assert.equal(confirmar.tokenValido('WTD-T-7K2Q', t, env), true);
  assert.equal(confirmar.tokenValido('WTD-T-7K2Q', t.slice(0, 15) + 'x', env), false);
  assert.equal(confirmar.tokenValido('WTD-T-AAAA', t, env), false);
  assert.equal(confirmar.tokenValido('WTD-T-7K2Q', t, { CENTER_TOKEN: 'outro' }), false);
  const r = { codigo: 'WTD-T-7K2Q', produto: 'game', data: '2026-11-24', hora: '9:00 PM', pessoas: 6, nome: 'Léa <b>Martin</b>', whatsapp: '+33612345678', partida: 'Capitole', valor_cent: 35000, status: 'pedido', imagens: 'ok' };
  const html = confirmar.pagina(r, { t });
  assert.ok(html.includes('Léa &lt;b&gt;Martin&lt;/b&gt;') && html.includes('mardi 24 novembre') && html.includes('350 €') && html.includes('Confirmer la course'));
  assert.ok(!html.includes('+33612345678') && !html.includes('<script'));
  assert.ok(!confirmar.pagina({ ...r, status: 'confirmado' }, { t }).includes('<form'), 'já respondida: sem botões');
});

test('vigia: lembrete da véspera a partir das 8:00 PM, lembrete de 2 h ao cliente e ao Julien, cada um uma vez', async () => {
  const d2 = fs.mkdtempSync(path.join(os.tmpdir(), 'twk-fase2-vigia-'));
  const s = R.abrirArquivo({ dir: d2, agora: () => relogio });
  await s.criar(mk({ codigo: 'WTD-T-AMNH' })); await s.evento({ codigo: 'WTD-T-AMNH', tipo: 'status', valor: 'confirmado' }); // 24/11 9:00 PM
  await s.criar(mk({ codigo: 'WTD-T-PEDX' })); // ainda em pedido: não recebe lembrete
  const m = meta(); const aria = [];
  const fetchImpl = async (url, init) => { if (url.includes('aria.test')) { aria.push(JSON.parse(init.body)); return { ok: true, status: 200, json: async () => ({ ok: true, desfecho: 'alerta_equipe_enviado' }) }; } return m.fetchImpl(url, init); };
  const env = { ...META, ARIA_TEAM_ALERT_SECRET: 's', AGENT_ARIA_URL: 'https://aria.test', CHAUFFEUR_PENDENTE_MIN: '600' };
  const estado = { anonimizado_em: '2026-11-23' };
  // 23/11 7:00 PM Paris: antes das 8:00 PM, nada
  let r = await vigia.rodar({ store: s, env, fetchImpl, estado, agora: () => relogio });
  assert.equal(r.lembretes.length, 0);
  // 23/11 8:30 PM Paris: véspera
  relogio = Date.parse('2026-11-23T19:30:00Z');
  r = await vigia.rodar({ store: s, env, fetchImpl, estado, agora: () => relogio });
  assert.deepEqual(r.lembretes.map((x) => x.tipo), ['lembrete_vespera']); assert.equal(m.envios.length, 1, JSON.stringify(m.envios.map((x) => [x.url, x.corpo.to, x.corpo.template.name])));
  assert.equal(m.envios[0].corpo.template.components[0].parameters[0].text, 'demain');
  r = await vigia.rodar({ store: s, env, fetchImpl, estado, agora: () => relogio });
  assert.equal(r.lembretes.length, 0, 'não repete');
  // 24/11 7:30 PM Paris: faltam 90 min → cliente + Julien
  relogio = Date.parse('2026-11-24T18:30:00Z');
  r = await vigia.rodar({ store: s, env, fetchImpl, estado, agora: () => relogio });
  assert.deepEqual(r.lembretes.map((x) => x.tipo).sort(), ['lembrete_2h', 'lembrete_julien']);
  assert.equal(m.envios[1].corpo.template.components[0].parameters[0].text, 'dans deux heures');
  const lembJ = aria.filter((a) => a.evento.startsWith('lembrete:')); // o aviso de pedido parado (PEDX, > 600 min) também passa pela Aria
  assert.equal(lembJ.length, 1); assert.equal(lembJ[0].destinatario, 'julien'); assert.equal(lembJ[0].evento, 'lembrete:WTD-T-AMNH');
  assert.match(lembJ[0].situacao, /^Dans 2 h : Game Night à 9:00 PM, au nom de Léa Martin, départ Place du Capitole\. 6 pers\., 350 €\. Réf WTD-T-AMNH\.$/);
  r = await vigia.rodar({ store: s, env, fetchImpl, estado, agora: () => relogio });
  assert.equal(r.lembretes.length, 0); assert.equal(aria.filter((a) => a.evento.startsWith('lembrete:')).length, 1);
  // 24/11 9:30 PM: corrida já começou, nada novo
  relogio = Date.parse('2026-11-24T20:30:00Z');
  r = await vigia.rodar({ store: s, env, fetchImpl, estado, agora: () => relogio });
  assert.equal(r.lembretes.length, 0);
  assert.deepEqual((await s.obter('WTD-T-AMNH')).avisos.sort(), ['lembrete_2h', 'lembrete_julien', 'lembrete_vespera']);
  assert.deepEqual((await s.obter('WTD-T-PEDX')).avisos, ['pendente'], 'o pedido parado recebeu só o aviso ao Márlon, nenhum lembrete');
});
