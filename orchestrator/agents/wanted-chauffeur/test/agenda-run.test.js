'use strict';
/** Agenda do Julien (rotina): desligada por padrão, 1 envio por dia, sem telefone no aviso, falha alto sem planilha. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'twk-agenda-'));
process.env.CHAUFFEUR_STATE_DIR = dir;
const { rodar } = require('../agenda-run.js');
const { COLUNAS } = require('../agenda-do-dia.js');

const CSV = `${COLUNAS.join(',')}
Paul Durand,+33 6 11 22 33 44,Hôtel Capitole,hôtel,Transfer,2026-11-24,7:00 AM,WTD-H-P8QA,confirmado,
Léa Martin,+33 6 55 66 77 88,Saint-Cyprien,TikTok,Game Night,2026-11-24,9:00 PM,WTD-T-7K2Q,confirmado,
`;
const ENV = { CHAUFFEUR_AGENDA: 'on', CHAUFFEUR_AGENDA_CSV_URL: 'https://docs.test/clientes.csv', AGENT_ARIA_URL: 'https://aria.test', ARIA_TEAM_ALERT_SECRET: 'seg' };
const planilha = (texto, status = 200) => async () => ({ ok: status === 200, status, text: async () => texto });
const aria = () => { const pedidos = []; return { pedidos, avisarImpl: async (url, init) => { pedidos.push({ url, segredo: init.headers['x-aria-secret'], corpo: JSON.parse(init.body) }); return { ok: true, status: 200, json: async () => ({ ok: true, desfecho: 'alerta_equipe_enviado' }) }; } }; };
const limpar = () => { for (const f of fs.readdirSync(dir)) fs.rmSync(path.join(dir, f), { force: true }); };

test('desligada: não lê planilha nem avisa', async () => {
  limpar(); const a = aria();
  const r = await rodar({ argv: ['--dia', '2026-11-24'], env: {}, fetchImpl: async () => { throw new Error('não devia ler'); }, avisarImpl: a.avisarImpl, log: () => {} });
  assert.equal(r.codigo, 0); assert.equal(r.desligada, true); assert.equal(a.pedidos.length, 0);
});

test('ligada: lê a planilha, manda UMA mensagem ao julien pela Aria, sem telefone, e não repete no mesmo dia', async () => {
  limpar(); const a = aria();
  const r = await rodar({ argv: ['--dia', '2026-11-24'], env: ENV, fetchImpl: planilha(CSV), avisarImpl: a.avisarImpl, log: () => {} });
  assert.equal(r.codigo, 0); assert.equal(r.enviado, true); assert.equal(r.corridas, 2);
  assert.equal(a.pedidos.length, 1);
  const p = a.pedidos[0];
  assert.equal(p.url, 'https://aria.test/webhook/alerta-equipe'); assert.equal(p.segredo, 'seg');
  assert.equal(p.corpo.destinatario, 'julien'); assert.equal(p.corpo.evento, 'agenda:2026-11-24');
  assert.equal(p.corpo.situacao, 'Agenda du mardi 24 novembre : 7:00 AM · Paul Durand · Transfer · Hôtel Capitole · 80 € | 9:00 PM · Léa Martin · Game Night · Saint-Cyprien · 350 €');
  assert.ok(!p.corpo.situacao.includes('+33') && !p.corpo.situacao.includes('\n'));
  assert.ok(p.corpo.situacao.length <= 300);
  const r2 = await rodar({ argv: ['--dia', '2026-11-24'], env: ENV, fetchImpl: planilha(CSV), avisarImpl: a.avisarImpl, log: () => {} });
  assert.equal(r2.repetida, true); assert.equal(a.pedidos.length, 1);
  const e = JSON.parse(fs.readFileSync(path.join(dir, 'agenda-2026-11-24.json'), 'utf8'));
  assert.equal(e.enviado, true); assert.equal(e.corridas, 2);
});

test('dia sem corrida: não manda (padrão); com CHAUFFEUR_AGENDA_VAZIA=on manda a linha curta', async () => {
  limpar(); const a = aria();
  let r = await rodar({ argv: ['--dia', '2026-11-26'], env: ENV, fetchImpl: planilha(CSV), avisarImpl: a.avisarImpl, log: () => {} });
  assert.equal(r.codigo, 0); assert.equal(r.enviado, false); assert.equal(a.pedidos.length, 0);
  r = await rodar({ argv: ['--dia', '2026-11-26'], env: { ...ENV, CHAUFFEUR_AGENDA_VAZIA: 'on' }, fetchImpl: planilha(CSV), avisarImpl: a.avisarImpl, log: () => {} });
  assert.equal(r.enviado, true); assert.equal(a.pedidos[0].corpo.situacao, 'Agenda du jeudi 26 novembre : aucune course confirmée.');
});

test('falha alto: sem URL, planilha fora do ar, HTML em vez de CSV, sem segredo — sai com 1 e nada é enviado', async () => {
  limpar(); const a = aria(); const argv = ['--dia', '2026-11-24'];
  assert.equal((await rodar({ argv, env: { ...ENV, CHAUFFEUR_AGENDA_CSV_URL: '' }, fetchImpl: planilha(CSV), avisarImpl: a.avisarImpl, log: () => {} })).codigo, 1);
  assert.equal((await rodar({ argv, env: ENV, fetchImpl: planilha('', 500), avisarImpl: a.avisarImpl, log: () => {} })).codigo, 1);
  assert.equal((await rodar({ argv, env: ENV, fetchImpl: planilha('<html><body>login</body></html>'), avisarImpl: a.avisarImpl, log: () => {} })).codigo, 1);
  assert.equal((await rodar({ argv, env: { ...ENV, ARIA_TEAM_ALERT_SECRET: '' }, fetchImpl: planilha(CSV), avisarImpl: a.avisarImpl, log: () => {} })).codigo, 1);
  assert.equal(a.pedidos.length, 0);
  // a Aria recusou → erro, e o dia continua aberto para a próxima tentativa
  const recusa = async () => ({ ok: false, status: 400, json: async () => ({ ok: false, motivo: 'destinatario_desconhecido' }) });
  const r = await rodar({ argv, env: ENV, fetchImpl: planilha(CSV), avisarImpl: recusa, log: () => {} });
  assert.equal(r.codigo, 1); assert.match(r.erro, /destinatario_desconhecido/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'agenda-2026-11-24.json'), 'utf8')).enviado, false);
});

test('--dry-run mostra a mensagem e não envia, mesmo desligada', async () => {
  limpar(); const a = aria();
  const r = await rodar({ argv: ['--dry-run', '--dia', '2026-11-24'], env: { CHAUFFEUR_AGENDA_CSV_URL: 'https://docs.test/c.csv' }, fetchImpl: planilha(CSV), avisarImpl: a.avisarImpl, log: () => {} });
  assert.equal(r.dryRun, true); assert.ok(r.mensagem.startsWith('Agenda du mardi 24 novembre')); assert.equal(a.pedidos.length, 0);
});
