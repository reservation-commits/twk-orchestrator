'use strict';
/** Central · Wanted Chauffeur: reserva da página gravada inteira, origem conferida, teto por endereço, aviso ao Julien, painel e status. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'twk-central-chauffeur-'));
const { criar } = require('../../chauffeur.js');
let relogio = Date.parse('2026-11-19T20:00:00Z');
const avisos = []; // o que foi mandado à Aria
const fetchImpl = async (url, init) => { avisos.push({ url, corpo: JSON.parse(init.body), segredo: init.headers['x-aria-secret'] }); return { ok: true, status: 200, json: async () => ({ ok: true, desfecho: 'alerta_equipe_enviado' }) }; };
const acoes = []; const sentinels = { upsert: (_d, f) => { acoes.push(f); return f; } };
const ch = criar({ stateDir: raiz, env: { CHAUFFEUR_ORIGINS: 'https://theworldkeys.com', CHAUFFEUR_TETO_HORA: '3', ARIA_TEAM_ALERT_SECRET: 'seg', AGENT_ARIA_URL: 'https://aria.test' }, agora: () => relogio, fetchImpl, log: () => {}, sentinels });
const json = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
// Reproduz a ordem do server.js: a rota pública antes da chave; o resto só com chave.
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (ch.tratarPublico(req, res, u, json)) return;
  if (u.pathname.startsWith('/api/')) {
    if (req.headers['x-center-key'] !== 'chave') return json(res, 401, { error: 'nao autorizado' });
    if (ch.tratar(req, res, u, json)) return;
  }
  json(res, 404, {});
});
let base = '';
test.before(async () => { await new Promise((ok) => server.listen(0, '127.0.0.1', ok)); base = `http://127.0.0.1:${server.address().port}`; await ch.armazem(); });
test.after(() => server.close());
const post = async (r, corpo, headers = {}) => { const x = await fetch(base + r, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(corpo) }); return { status: x.status, j: await x.json(), h: x.headers }; };
const get = async (r, headers = {}) => { const x = await fetch(base + r, { headers }); return { status: x.status, j: await x.json() }; };
const daPagina = { origin: 'https://theworldkeys.com', 'x-forwarded-for': '203.0.113.7' };
const k = { 'x-center-key': 'chave' };
const espera = (ms) => new Promise((ok) => setTimeout(ok, ms));
const arqReservas = path.join(raiz, 'agents', 'wanted-chauffeur', 'reservas.jsonl');

test('reserva da página: gravada inteira (nome, WhatsApp normalizado, trajeto, valor em centavos) e o Julien é avisado pela Aria sem telefone', async () => {
  const r = await post('/api/chauffeur/reserva', { codigo: 'wtd-t-7k2q', produto: 'game', data: '2026-11-24', hora: '9:00 PM', pessoas: 6, idioma: 'fr', nome: 'Léa Martin', whatsapp: '06 12 34 56 78', partida: 'Place du Capitole', destino: 'Saint-Cyprien', recado: 'Anniversaire', imagens: 'ok', campo_estranho: 'x' }, daPagina);
  assert.equal(r.status, 201); assert.equal(r.j.codigo, 'WTD-T-7K2Q');
  const linhas = fs.readFileSync(arqReservas, 'utf8').trim().split('\n');
  assert.equal(linhas.length, 1);
  const g = JSON.parse(linhas[0]);
  assert.equal(g.nome, 'Léa Martin'); assert.equal(g.whatsapp, '+33612345678'); assert.equal(g.valor_cent, 35000); assert.equal(g.moeda, 'EUR'); assert.equal(g.imagens, 'ok');
  assert.equal(g.campo_estranho, undefined);
  // o mesmo código de novo (a página pode reenviar) não duplica
  const r2 = await post('/api/chauffeur/reserva', { codigo: 'WTD-T-7K2Q', produto: 'game', nome: 'Léa Martin' }, daPagina);
  assert.equal(r2.status, 200); assert.equal(r2.j.repetido, true);
  assert.equal(fs.readFileSync(arqReservas, 'utf8').trim().split('\n').length, 1);
  await espera(50);
  assert.equal(avisos.length, 1);
  const a = avisos[0];
  assert.equal(a.url, 'https://aria.test/webhook/alerta-equipe'); assert.equal(a.segredo, 'seg');
  assert.equal(a.corpo.destinatario, 'julien'); assert.equal(a.corpo.evento, 'reserva:WTD-T-7K2Q');
  assert.ok(a.corpo.situacao.startsWith('Nouvelle demande WTD-T-7K2Q : Game Night, mardi 24 novembre 9:00 PM, 6 pers., 350 €.'), a.corpo.situacao);
  assert.ok(a.corpo.situacao.includes('Léa Martin') && !a.corpo.situacao.includes('+33') && !a.corpo.situacao.includes('56 78') && !a.corpo.situacao.includes('\n'));
  assert.ok(a.corpo.situacao.length <= 300);
  const ficha = await get('/api/chauffeur/reserva/WTD-T-7K2Q', k);
  assert.equal(ficha.status, 200); assert.equal(ficha.j.status, 'pedido'); assert.deepEqual(ficha.j.avisos, ['nova_reserva']); assert.equal(ficha.j.whatsapp, '+33612345678');
});

test('formato estrito: código, produto, hora em AM/PM, pessoas de 1 a 6, nome obrigatório na reserva, WhatsApp inválido recusado', async () => {
  let n = 50; const ipNovo = () => ({ origin: 'https://theworldkeys.com', 'x-forwarded-for': `203.0.113.${n++}` }); // um endereço por chamada: aqui o que se testa é o formato, não o teto
  assert.equal((await post('/api/chauffeur/reserva', { codigo: 'WTD-X-7K2Q', produto: 'game', nome: 'A B' }, ipNovo())).status, 400);
  assert.equal((await post('/api/chauffeur/reserva', { codigo: 'WTD-I-AB23', produto: 'uber', nome: 'A B' }, ipNovo())).status, 400);
  assert.equal((await post('/api/chauffeur/reserva', { codigo: 'WTD-I-AB23', produto: 'night', hora: '21:00', nome: 'A B' }, ipNovo())).status, 400);
  assert.equal((await post('/api/chauffeur/reserva', { codigo: 'WTD-I-AB23', produto: 'night', pessoas: 9, nome: 'A B' }, ipNovo())).status, 400);
  assert.equal((await post('/api/chauffeur/reserva', { codigo: 'WTD-I-AB23', produto: 'night' }, ipNovo())).status, 400, 'sem nome, sem missão');
  const w = await post('/api/chauffeur/reserva', { codigo: 'WTD-I-AB23', produto: 'night', nome: 'Paul Durand', whatsapp: '12' }, ipNovo());
  assert.equal(w.status, 400); assert.match(w.j.error, /WhatsApp/);
  // a rota antiga (protótipo de 18/11) continua aceitando o pedido sem pessoa
  assert.equal((await post('/api/chauffeur/lead', { codigo: 'WTD-I-AB23', produto: 'night', data: '2026-11-26', hora: '8:00 PM' }, ipNovo())).status, 201);
});

test('origem: só a página da marca (ou a própria Central) pode gravar; OPTIONS responde com CORS; sem chave não se lê nada', async () => {
  const outro = await post('/api/chauffeur/reserva', { codigo: 'WTD-I-ZZZZ', produto: 'night', nome: 'A B' }, { origin: 'https://evil.example' });
  assert.equal(outro.status, 403);
  const pre = await fetch(base + '/api/chauffeur/reserva', { method: 'OPTIONS', headers: { origin: 'https://theworldkeys.com' } });
  assert.equal(pre.status, 204); assert.equal(pre.headers.get('access-control-allow-origin'), 'https://theworldkeys.com');
  // página servida pela própria Central: Origin igual ao Host passa
  const mesma = await post('/api/chauffeur/reserva', { codigo: 'WTD-S-MESM', produto: 'transfer', nome: 'Ana Souza' }, { origin: base, 'x-forwarded-for': '203.0.113.99' });
  assert.equal(mesma.status, 201);
  assert.equal((await get('/api/chauffeur/leads')).status, 401);
  assert.equal((await get('/api/chauffeur/reserva/WTD-T-7K2Q')).status, 401);
  assert.equal((await post('/api/chauffeur/lead/resultado', { codigo: 'WTD-T-7K2Q', resultado: 'feito' })).status, 401);
});

test('teto por endereço: a partir do limite responde 429', async () => {
  const ip = { ...daPagina, 'x-forwarded-for': '198.51.100.9' };
  const codigos = ['WTD-Y-AAAA', 'WTD-Y-BBBB', 'WTD-Y-CCCC', 'WTD-Y-DDDD'];
  const st = []; for (const c of codigos) st.push((await post('/api/chauffeur/reserva', { codigo: c, produto: 'transfer', nome: 'Cliente Teste' }, ip)).status);
  assert.deepEqual(st, [201, 201, 201, 429]);
});

test('status por código e painel: contagens por origem, produto, dia, conversão e valor; WhatsApp só mascarado; nota com telefone recusada', async () => {
  assert.equal((await post('/api/chauffeur/lead/resultado', { codigo: 'WTD-T-7K2Q', resultado: 'pago' }, k)).status, 400);
  assert.equal((await post('/api/chauffeur/lead/resultado', { codigo: 'WTD-T-7K2Q', resultado: 'pedido' }, k)).status, 400);
  assert.equal((await post('/api/chauffeur/lead/resultado', { codigo: 'WTD-H-N7PE', resultado: 'feito' }, k)).status, 404);
  assert.equal((await post('/api/chauffeur/lead/resultado', { codigo: 'WTD-T-7K2Q', resultado: 'orcado', nota: 'ligar 06 12 34 56 78' }, k)).status, 400);
  assert.equal((await post('/api/chauffeur/lead/resultado', { codigo: 'WTD-T-7K2Q', resultado: 'orcado' }, k)).status, 200);
  relogio += 3_600_000;
  assert.equal((await post('/api/chauffeur/lead/resultado', { codigo: 'WTD-T-7K2Q', resultado: 'confirmado' }, k)).status, 200);
  const p = await get('/api/chauffeur/leads?dias=7', k);
  assert.equal(p.status, 200); assert.equal(p.j.modo, 'arquivo');
  assert.equal(p.j.total, 6); // 1 TikTok + 1 Instagram (lead antigo) + 1 Site + 3 YouTube (o 4º bateu no teto)
  assert.deepEqual(p.j.por_origem, { TikTok: 1, Instagram: 1, Site: 1, YouTube: 3 });
  assert.deepEqual(p.j.por_produto, { 'Game Night': 1, 'Night Ride': 1, Transfer: 4 });
  assert.equal(p.j.por_resultado.confirmado, 1); assert.equal(p.j.por_resultado.pedido, 5);
  assert.equal(p.j.viraram_corrida, 1); assert.equal(p.j.taxa_conversao_pct, 17); assert.equal(p.j.valor_confirmado_cent, 35000);
  assert.equal(p.j.por_dia.length, 1); assert.equal(p.j.por_dia[0].dia, '2026-11-19');
  const t = p.j.pedidos.find((x) => x.codigo === 'WTD-T-7K2Q');
  assert.equal(t.status, 'confirmado'); assert.equal(t.origem_nome, 'TikTok'); assert.equal(t.nome, 'Léa Martin'); assert.equal(t.whatsapp_mascarado, '+33…5678'); assert.equal(t.whatsapp, undefined);
  assert.ok(!JSON.stringify(p.j).includes('+33612345678'), 'o painel não expõe o número inteiro');
});

test('aviso ao Julien falhou: fica registrado na reserva e abre Ação na Central; a resposta à página não muda', async () => {
  const ch2 = criar({ stateDir: fs.mkdtempSync(path.join(os.tmpdir(), 'twk-central-chauffeur2-')), env: { ARIA_TEAM_ALERT_SECRET: 'seg' }, fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({ ok: false, motivo: 'aria_fora' }) }), log: () => {}, sentinels });
  const s = await ch2.armazem();
  const v = require(path.join('..', '..', '..', 'agents', 'wanted-chauffeur', 'reservas.js')).validar({ codigo: 'WTD-H-F4LH', produto: 'transfer', nome: 'Paul Durand' }, { exigirPessoa: true });
  await s.criar(v.reserva);
  await ch2.avisarNova(v.reserva);
  const r = await s.obter('WTD-H-F4LH');
  assert.deepEqual(r.avisos, ['nova_reserva_falhou']);
  assert.equal(acoes.at(-1).regra, 'aviso_nova_reserva_falhou');
  assert.match(ch2.saude().aviso_julien, /^on/);
});

test('links por rede: um por letra, com a página da marca', async () => {
  const l = await get('/api/chauffeur/links', k);
  assert.equal(l.status, 200);
  assert.deepEqual(l.j.links.map((x) => x.origem), ['T', 'I', 'Y', 'W', 'H', 'S']);
  assert.equal(l.j.links[0].url, 'https://ride.theworldkeys.com/?o=T');
});

test('Fase 2: o aviso ao Julien leva o link de confirmar; a página /c abre com o token certo, confirma, muda o status e tenta a confirmação ao cliente', async () => {
  const raiz2 = fs.mkdtempSync(path.join(os.tmpdir(), 'twk-central-chauffeur3-'));
  const env = { CHAUFFEUR_ORIGINS: 'https://theworldkeys.com', ARIA_TEAM_ALERT_SECRET: 'seg', AGENT_ARIA_URL: 'https://aria.test', CHAUFFEUR_CONFIRMA_SECRET: 's3gredo', CHAUFFEUR_CONFIRMA_URL: 'https://central.test' };
  const av = [];
  // relógio fixo: a reserva do teste é de 25/11/2026 e a agenda recusa data passada (409) quando o teste roda depois disso
  const ch3 = criar({ stateDir: raiz2, env, agora: () => relogio, fetchImpl: async (url, init) => { av.push({ url, corpo: JSON.parse(init.body) }); return { ok: true, status: 200, json: async () => ({ ok: true, desfecho: 'alerta_equipe_enviado' }) }; }, log: () => {}, sentinels });
  const srv = http.createServer((req, res) => { const u = new URL(req.url, 'http://x'); if (ch3.tratarPublico(req, res, u, json)) return; json(res, 404, {}); });
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok)); const b3 = `http://127.0.0.1:${srv.address().port}`;
  try {
    const r = await fetch(b3 + '/api/chauffeur/reserva', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://theworldkeys.com' }, body: JSON.stringify({ codigo: 'WTD-H-LNKX', produto: 'transfer', data: '2026-11-25', hora: '7:00 AM', pessoas: 2, nome: 'Paul Durand', whatsapp: '+33611223344', partida: 'Hôtel Capitole', destino: 'Blagnac' }) });
    assert.equal(r.status, 201);
    await espera(50);
    assert.equal(av.length, 1);
    const link = /https:\/\/central\.test\/c\/WTD-H-LNKX\?t=[A-Za-z0-9_-]{16}/.exec(av[0].corpo.situacao);
    assert.ok(link, av[0].corpo.situacao);
    const caminho = link[0].replace('https://central.test', '');
    assert.equal((await fetch(b3 + '/c/WTD-H-LNKX?t=errado0000000000')).status, 404);
    assert.equal((await fetch(b3 + '/c/WTD-H-NXPE' + caminho.slice(caminho.indexOf('?')))).status, 404);
    const pg = await fetch(b3 + caminho);
    assert.equal(pg.status, 200);
    const html = await pg.text();
    assert.ok(html.includes('Paul Durand') && html.includes('Confirmer la course') && !html.includes('+33611223344'));
    const dec = await fetch(b3 + caminho, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'decision=confirmer' });
    assert.equal(dec.status, 200);
    const h2 = await dec.text();
    assert.ok(h2.includes('Course confirmée') && h2.includes("n'est pas partie automatiquement"), 'sem canal da Meta no ambiente: a página avisa que o cliente não recebeu');
    const s = await ch3.armazem();
    const f = await s.obter('WTD-H-LNKX');
    assert.equal(f.status, 'confirmado'); assert.ok(f.avisos.includes('sem_canal'));
    const de_novo = await fetch(b3 + caminho, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'decision=refuser' });
    assert.ok((await de_novo.text()).includes('a déjà une réponse'));
    assert.equal((await s.obter('WTD-H-LNKX')).status, 'confirmado');
    assert.equal(ch3.saude().link_confirmar, 'on');
  } finally { srv.close(); }
});

test('Fase 2: marcar confirmado no painel manda a confirmação ao cliente pela Meta quando o canal está ligado', async () => {
  const raiz3 = fs.mkdtempSync(path.join(os.tmpdir(), 'twk-central-chauffeur4-'));
  const metaEnvios = [];
  const ch4 = criar({ stateDir: raiz3, env: { WC_WA_TOKEN: 'tok', WC_WA_PHONE_NUMBER_ID: '123', WC_TEMPLATE_CONFIRMED: 'wc_ride_confirmed', WC_TEMPLATE_REMINDER: 'wc_ride_reminder' }, fetchImpl: async (url, init) => { metaEnvios.push({ url, corpo: JSON.parse(init.body) }); return { ok: true, status: 200, json: async () => ({ messages: [{ id: 'wamid.X' }] }) }; }, log: () => {}, sentinels });
  const s = await ch4.armazem();
  const v = require(path.join('..', '..', '..', 'agents', 'wanted-chauffeur', 'reservas.js')).validar({ codigo: 'WTD-S-PANL', produto: 'night', data: '2026-11-26', hora: '10:00 PM', pessoas: 4, nome: 'Ana Souza', whatsapp: '+33600000001', partida: 'Pont Neuf', idioma: 'en' }, { exigirPessoa: true });
  await s.criar(v.reserva);
  const r = await ch4.mudarStatus({ codigo: 'WTD-S-PANL', status: 'confirmado', por: 'marlon' });
  assert.equal(r.status, 200); assert.equal(r.cliente.enviado, true);
  assert.equal(metaEnvios.length, 1); assert.equal(metaEnvios[0].corpo.template.language.code, 'en');
  assert.equal((await s.obter('WTD-S-PANL')).avisos.includes('confirmacao_cliente'), true);
  assert.equal(ch4.saude().cliente, 'on');
  assert.equal((await ch4.mudarStatus({ codigo: 'WTD-S-PANL', status: 'feito', por: 'marlon' })).cliente, undefined, 'outros status não mandam nada');
});

test('22/11 agenda: a página consulta a disponibilidade sem chave; o POST barra horário ocupado (409); bloqueios só com chave', async () => {
  const raiz5 = fs.mkdtempSync(path.join(os.tmpdir(), 'twk-central-chauffeur5-'));
  const relogio5 = Date.parse('2026-11-22T13:00:00Z');
  const ch5 = criar({ stateDir: raiz5, env: { CHAUFFEUR_ORIGINS: 'https://theworldkeys.com' }, agora: () => relogio5, fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) }), log: () => {}, sentinels });
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (ch5.tratarPublico(req, res, u, json)) return;
    if (u.pathname.startsWith('/api/')) { if (req.headers['x-center-key'] !== 'chave') return json(res, 401, {}); if (ch5.tratar(req, res, u, json)) return; }
    json(res, 404, {});
  });
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok)); const b5 = `http://127.0.0.1:${srv.address().port}`;
  const pg = { origin: 'https://theworldkeys.com', 'content-type': 'application/json' };
  try {
    const d = await fetch(b5 + '/api/chauffeur/disponibilidade?de=2026-11-24&dias=2', { headers: { origin: 'https://theworldkeys.com' } });
    assert.equal(d.status, 200); assert.equal(d.headers.get('access-control-allow-origin'), 'https://theworldkeys.com');
    const dj = await d.json(); assert.deepEqual(dj.dias.map((x) => x.ocupado), [[], []]);
    assert.equal((await fetch(b5 + '/api/chauffeur/disponibilidade', { headers: { origin: 'https://evil.example' } })).status, 403);
    assert.equal((await fetch(b5 + '/api/chauffeur/disponibilidade?de=24/11')).status, 400);
    // reserva → confirmada → o mesmo horário passa a dar 409, e a agenda pública mostra ocupado (cache limpo)
    const p1 = await fetch(b5 + '/api/chauffeur/reserva', { method: 'POST', headers: pg, body: JSON.stringify({ codigo: 'WTD-T-AGND', produto: 'game', data: '2026-11-24', hora: '9:00 PM', nome: 'Léa Martin' }) });
    assert.equal(p1.status, 201);
    assert.equal((await ch5.mudarStatus({ codigo: 'WTD-T-AGND', status: 'confirmado', por: 'teste' })).status, 200);
    const p2 = await fetch(b5 + '/api/chauffeur/reserva', { method: 'POST', headers: pg, body: JSON.stringify({ codigo: 'WTD-I-AGN2', produto: 'transfer', data: '2026-11-24', hora: '8:00 PM', nome: 'Paul Durand' }) });
    assert.equal(p2.status, 409); assert.equal((await p2.json()).motivo, 'ocupado');
    const p3 = await fetch(b5 + '/api/chauffeur/reserva', { method: 'POST', headers: pg, body: JSON.stringify({ codigo: 'WTD-I-AGN3', produto: 'transfer', data: '2026-11-22', hora: '2:30 PM', nome: 'Paul Durand' }) });
    assert.equal(p3.status, 409); assert.equal((await p3.json()).motivo, 'antecedencia');
    const dj2 = await (await fetch(b5 + '/api/chauffeur/disponibilidade?de=2026-11-24&dias=1')).json();
    assert.deepEqual(dj2.dias[0].ocupado, [[1230, 1440]]); assert.ok(!JSON.stringify(dj2).includes('WTD-'));
    // a rota antiga (sem pessoa) não é barrada pela agenda
    assert.equal((await fetch(b5 + '/api/chauffeur/lead', { method: 'POST', headers: pg, body: JSON.stringify({ codigo: 'WTD-I-LEGA', produto: 'transfer', data: '2026-11-24', hora: '8:00 PM' }) })).status, 201);
    // bloqueios: sem chave não; com chave cria, aparece na agenda interna com motivo, some da pública, e se retira
    const k = { 'x-center-key': 'chave', 'content-type': 'application/json' };
    assert.equal((await fetch(b5 + '/api/chauffeur/bloqueios', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 401);
    const bl = await fetch(b5 + '/api/chauffeur/bloqueios', { method: 'POST', headers: k, body: JSON.stringify({ data: '2026-11-26', motivo: 'garage' }) });
    assert.equal(bl.status, 201); const blj = await bl.json();
    assert.equal((await fetch(b5 + '/api/chauffeur/bloqueios', { method: 'POST', headers: k, body: JSON.stringify({ data: 'amanhã' }) })).status, 400);
    const pub = await (await fetch(b5 + '/api/chauffeur/disponibilidade?de=2026-11-26&dias=1')).json();
    assert.equal(pub.dias[0].fechado, true); assert.ok(!JSON.stringify(pub).includes('garage'));
    const int = await (await fetch(b5 + '/api/chauffeur/agenda?de=2026-11-26&dias=1', { headers: k })).json();
    assert.equal(int.dias[0].detalhes[0].motivo, 'garage'); assert.equal(int.bloqueios.length, 1);
    const p4 = await fetch(b5 + '/api/chauffeur/reserva', { method: 'POST', headers: pg, body: JSON.stringify({ codigo: 'WTD-I-AGN4', produto: 'night', data: '2026-11-26', hora: '9:00 PM', nome: 'Ana Souza' }) });
    assert.equal(p4.status, 409); assert.equal((await p4.json()).motivo, 'dia_fechado');
    assert.equal((await fetch(b5 + `/api/chauffeur/bloqueios/${blj.id}`, { method: 'DELETE', headers: k })).status, 200);
    assert.equal((await (await fetch(b5 + '/api/chauffeur/disponibilidade?de=2026-11-26&dias=1')).json()).dias[0].fechado, false);
  } finally { srv.close(); }
});
