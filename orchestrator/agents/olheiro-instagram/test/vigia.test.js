'use strict';
/**
 * Vigia de comentários (14/11): pedido de reserva sem resposta há 30 min → a Aria avisa o Julien no WhatsApp com o
 * link do post. Um aviso por pedido, nunca dois; nada de aviso antes dos 30 min, nem para pedido já respondido.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'twk-olheiro-vigia-'));
process.env.OLHEIRO_STATE_DIR = dir;
const { rodar } = require('../run');
const cerebro = require('../cerebro');

const MIN = 60_000;
const T0 = Date.parse('2026-11-14T18:00:00Z');
const isoMeta = (ms) => new Date(ms).toISOString().replace('.000Z', '+0000');
const ENV = { IG_ACCESS_TOKEN: 'tok-teste', IG_USER_ID: 'me', OLHEIRO_ARIA_URL: 'https://aria.test/', ARIA_TEAM_ALERT_SECRET: 'seg', OLHEIRO_AVISAR: 'julien' };

/** Meta mínima: um Reel, comentários mutáveis. */
function meta(comentarios) {
  const chamadas = [];
  const fetchImpl = async (url) => {
    const u = new URL(url); const p = u.pathname.replace(/^\/v\d+\.\d+\//, ''); chamadas.push(p);
    const r = (j) => ({ ok: true, status: 200, json: async () => j });
    if (p === 'me') return r({ id: 'me', username: 'wantedchauffeur' });
    if (p === 'me/media') return r({ data: [{ id: '900', permalink: 'https://www.instagram.com/reel/A900/', timestamp: isoMeta(T0 - 5 * 3_600_000), comments_count: comentarios.length, media_type: 'VIDEO', media_product_type: 'REELS' }] });
    if (p === '900/comments') return r({ data: comentarios });
    return { ok: false, status: 400, json: async () => ({ error: { code: 100, message: p } }) };
  };
  return { fetchImpl, chamadas };
}
function aria(status = 200) {
  const pedidos = [];
  const avisarImpl = async (url, opts) => { pedidos.push({ url, segredo: opts.headers['x-aria-secret'], corpo: JSON.parse(opts.body) }); return { ok: status < 400, status, json: async () => (status < 400 ? { ok: true, desfecho: 'enviado' } : { ok: false, desfecho: 'meta_recusou' }) }; };
  return { avisarImpl, pedidos };
}
const pedido = (id, minutosAtras, respondido = false) => ({ id, text: 'C\'est combien pour samedi soir ?', timestamp: isoMeta(T0 - minutosAtras * MIN), like_count: 0, username: 'cliente', replies: { data: respondido ? [{ username: 'wantedchauffeur' }] : [] } });
const limpar = () => { for (const f of fs.readdirSync(dir)) fs.rmSync(path.join(dir, f), { force: true }); };

test('29 min sem resposta: nada; 30 min: um aviso ao Julien com o link do post; depois, nunca mais', async () => {
  limpar();
  const comentarios = [pedido('c1', 29)];
  const m = meta(comentarios); const a = aria();
  let x = await rodar({ argv: ['--comentarios'], env: ENV, fetchImpl: m.fetchImpl, avisarImpl: a.avisarImpl, agora: T0, log: () => {} });
  assert.equal(x.codigo, 0); assert.equal(a.pedidos.length, 0, 'antes dos 30 min, nenhum aviso');

  x = await rodar({ argv: ['--comentarios'], env: ENV, fetchImpl: m.fetchImpl, avisarImpl: a.avisarImpl, agora: T0 + 1 * MIN, log: () => {} });
  assert.equal(a.pedidos.length, 1);
  const p = a.pedidos[0];
  assert.equal(p.url, 'https://aria.test/webhook/alerta-equipe'); assert.equal(p.segredo, 'seg');
  assert.equal(p.corpo.destinatario, 'julien', 'a Aria recebe o NOME, nunca o número');
  assert.equal(p.corpo.situacao, 'Il y a une demande de réservation sans réponse sur ce post : https://www.instagram.com/reel/A900/', 'em francês por padrão: o Julien lê francês');
  assert.equal(p.corpo.sistema, 'Instagram @wantedchauffeur');
  assert.ok(!JSON.stringify(p.corpo).includes('combien'), 'o texto do cliente não vai no aviso');

  await rodar({ argv: ['--comentarios'], env: ENV, fetchImpl: m.fetchImpl, avisarImpl: a.avisarImpl, agora: T0 + 6 * MIN, log: () => {} });
  assert.equal(a.pedidos.length, 1, 'o mesmo pedido não gera segundo aviso');
  const estado = JSON.parse(fs.readFileSync(path.join(dir, 'estado.json'), 'utf8'));
  assert.ok(estado.alertas_reserva.c1, 'aviso registrado no estado');
});

test('pedido já respondido pela conta não gera aviso; dois pedidos no mesmo post viram um aviso no plural', async () => {
  limpar();
  const m = meta([pedido('r1', 45, true), pedido('n1', 40), pedido('n2', 35)]); const a = aria();
  await rodar({ argv: ['--comentarios'], env: ENV, fetchImpl: m.fetchImpl, avisarImpl: a.avisarImpl, agora: T0, log: () => {} });
  assert.equal(a.pedidos.length, 1);
  assert.equal(a.pedidos[0].corpo.situacao, 'Il y a 2 demandes de réservation sans réponse sur ce post : https://www.instagram.com/reel/A900/');
});

test('OLHEIRO_AVISO_IDIOMA=pt mantém a frase original em português', async () => {
  limpar();
  const m = meta([pedido('p1', 40)]); const a = aria();
  await rodar({ argv: ['--comentarios'], env: { ...ENV, OLHEIRO_AVISO_IDIOMA: 'pt' }, fetchImpl: m.fetchImpl, avisarImpl: a.avisarImpl, agora: T0, log: () => {} });
  assert.equal(a.pedidos[0].corpo.situacao, 'Tem um pedido de reserva não respondido nesse post: https://www.instagram.com/reel/A900/');
});

test('pedido de mais de 24 h não vira aviso (ligar o Olheiro não dispara rajada de atrasos antigos)', async () => {
  limpar();
  const m = meta([pedido('velho', 25 * 60)]); const a = aria();
  await rodar({ argv: ['--comentarios'], env: ENV, fetchImpl: m.fetchImpl, avisarImpl: a.avisarImpl, agora: T0, log: () => {} });
  assert.equal(a.pedidos.length, 0);
});

test('Aria fora ou recusando: o aviso não é marcado como dado, a vigia sai 1 e tenta de novo depois', async () => {
  limpar();
  const m = meta([pedido('c9', 40)]);
  const ruim = aria(502);
  const linhas = [];
  const x = await rodar({ argv: ['--comentarios'], env: ENV, fetchImpl: m.fetchImpl, avisarImpl: ruim.avisarImpl, agora: T0, log: (s) => linhas.push(s) });
  assert.equal(x.codigo, 1); assert.ok(linhas.some((l) => /NÃO saíram/.test(l)));
  const boa = aria();
  await rodar({ argv: ['--comentarios'], env: ENV, fetchImpl: m.fetchImpl, avisarImpl: boa.avisarImpl, agora: T0 + 5 * MIN, log: () => {} });
  assert.equal(boa.pedidos.length, 1, 'na vigia seguinte o aviso sai');
});

test('sem a Aria configurada: lacuna declarada, nada marcado como avisado', async () => {
  limpar();
  const m = meta([pedido('c5', 40)]); const a = aria();
  const env = { ...ENV, ARIA_TEAM_ALERT_SECRET: '' };
  await rodar({ argv: ['--comentarios'], env, fetchImpl: m.fetchImpl, avisarImpl: a.avisarImpl, agora: T0, log: () => {} });
  assert.equal(a.pedidos.length, 0);
  const resumo = JSON.parse(fs.readFileSync(path.join(dir, 'resumo.json'), 'utf8'));
  assert.ok(resumo.lacunas.some((l) => /aviso ao Julien desligado/.test(l)));
  const estado = JSON.parse(fs.readFileSync(path.join(dir, 'estado.json'), 'utf8'));
  assert.deepEqual(estado.alertas_reserva, {});
});

test('vigia econômica: contagem igual e nada pendente não relê comentários', async () => {
  limpar();
  const comentarios = [{ id: 'e1', text: 'Trop stylé 🔥', timestamp: isoMeta(T0 - 50 * MIN), like_count: 0, username: 'x', replies: { data: [] } }];
  const m = meta(comentarios); const a = aria();
  await rodar({ argv: ['--comentarios'], env: ENV, fetchImpl: m.fetchImpl, avisarImpl: a.avisarImpl, agora: T0, log: () => {} });
  const antes = m.chamadas.filter((c) => c === '900/comments').length;
  await rodar({ argv: ['--comentarios'], env: ENV, fetchImpl: m.fetchImpl, avisarImpl: a.avisarImpl, agora: T0 + 5 * MIN, log: () => {} });
  assert.equal(m.chamadas.filter((c) => c === '900/comments').length, antes, 'nada mudou: não relê');
});

test('a trava impede duas rodadas ao mesmo tempo', async () => {
  limpar();
  fs.writeFileSync(path.join(dir, '.olheiro.lock'), '');
  const x = await rodar({ argv: ['--comentarios'], env: ENV, fetchImpl: meta([]).fetchImpl, avisarImpl: aria().avisarImpl, agora: T0, log: () => {} });
  assert.equal(x.status, 'ocupado'); assert.equal(x.codigo, 0);
  fs.rmSync(path.join(dir, '.olheiro.lock'));
});

test('relato: o achado de reserva sem resposta usa o limite de 30 min', () => {
  const estado = { conta: { username: 'wantedchauffeur' }, posts: { 900: { id: '900', tipo: 'REELS', permalink: 'l', timestamp: new Date(T0 - 3_600_000).toISOString(), metricas: {}, historico: [] } }, comentarios: [{ id: 'k1', media_id: '900', texto: 'combien ?', ts: new Date(T0 - 31 * MIN).toISOString(), respondido: false, classe: 'reserva' }] };
  const rel = cerebro.relato(cerebro.resumo(estado, { agora: T0 }), { agora: T0 });
  const a = rel.achados.find((x) => x.chave === 'olheiro.reserva_sem_resposta');
  assert.ok(a); assert.match(a.titulo, /30 min/); assert.match(a.evidencia, /k1 \(31 min\)/);
});
