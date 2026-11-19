'use strict';
/** Estúdio Viral: o pacote escrito à mão passa; GTA na tela, preço fora da tabela e disponibilidade são barrados; a rodada com fixture grava e relata; a cópia da skill está em dia. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'twk-estudio-'));
process.env.ESTUDIO_STATE_DIR = dir;
const contexto = require('../contexto.js');
const pacoteMod = require('../pacote.js');
const render = require('../render.js');
const { rodar, token, tokenValido, link } = require('../run.js');
const { sincronizar } = require('../sincronizar-skill.js');
const { criar, extrairJson } = require('../llm.js');

const FIXTURE = path.join(__dirname, 'fixtures', 'pacote-2026-11-20.json');
const lerFixture = () => JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
const { wc } = contexto.carregarSkill();

test('cópia da skill em dia com .claude/skills (ou ausente no ambiente hospedado)', () => {
  const r = sincronizar({ verificar: true });
  if (r.ok === null) return; // sem a skill (container): a cópia é a fonte
  assert.equal(r.ok, true, `cópia velha: ${r.divergentes.join(', ')}`);
});

test('o pacote de 20/11 passa pelas travas e cada gancho é FORTE', () => {
  const v = pacoteMod.verificar(lerFixture(), wc);
  assert.equal(v.ok, true, JSON.stringify(v.problemas));
  assert.deepEqual(v.bloqueados, []);
  for (const r of ['R1', 'R3']) assert.ok(v.medidas[r].accroche.note >= 75, `${r}: ${v.medidas[r].accroche.note}`);
  assert.equal(v.medidas.R2.accroche, undefined, 'R2 é sem voz');
  for (const r of ['R1', 'R2', 'R3']) assert.ok(v.medidas[r].duree_s >= 6 && v.medidas[r].duree_s <= 20);
  assert.equal(v.problemas.filter((p) => /batem com a tabela/.test(p.detalhe)).length, 0, 'preço que bate com a tabela não é aviso');
});

test('GTA na tela bloqueia o Reel; preço fora da tabela bloqueia; TOULOUSE ausente bloqueia', () => {
  const p = lerFixture();
  p.reels[0].texte_ecran[1].texte = 'GTA 6 À BORD';
  p.reels[1].legende = p.reels[1].legende.replace('350 €', '299 €');
  p.reels[2].texte_ecran[0].texte = 'ZOOME';
  const v = pacoteMod.verificar(p, wc);
  assert.equal(v.ok, false);
  assert.deepEqual(v.bloqueados.sort(), ['R1', 'R2', 'R3']);
  assert.ok(v.problemas.some((x) => x.reel === 'R1' && /Marca do jogo/.test(x.detalhe)));
  assert.ok(v.problemas.some((x) => x.reel === 'R2' && /Fora da tabela/.test(x.detalhe)));
  assert.ok(v.problemas.some((x) => x.reel === 'R3' && /TOULOUSE/.test(x.detalhe)));
  const podado = pacoteMod.podar(p, v);
  assert.equal(podado.pacote.reels.length, 0);
});

test('resposta a comentário prometendo disponibilidade é barrada; story idem', () => {
  const p = lerFixture();
  p.reponses_commentaires.push({ situation: '« Dispo ? »', reponse: 'Oui, dispo ce soir, sans réservation, monte direct !' });
  const v = pacoteMod.verificar(p, wc);
  assert.ok(v.bloqueados.includes('reponses'));
  const podado = pacoteMod.podar(p, v);
  assert.equal(podado.pacote.reponses_commentaires.length, lerFixture().reponses_commentaires.length);
});

test('render: markdown em francês com assinatura, planos e legenda; HTML sem script', () => {
  const p = lerFixture();
  const md = render.markdownFr(p, { medidas: {}, problemas: [] });
  assert.match(md, /^# Pack du jour · vendredi 20 novembre · @wantedchauffeur/);
  assert.match(md, /Vous jouez\. On conduit\./);
  assert.match(md, /## Reel 1 · Pas eux/);
  assert.match(md, /#Toulouse #WantedChauffeur/);
  const html = render.html(p);
  assert.doesNotMatch(html, /<script/i);
  assert.match(html, /<h2>Reel 2 · C&#39;est combien \?<\/h2>/);
});

test('rodada com --fixture: grava json+md+relato, status parcial (sem modelo), relato no contrato', async () => {
  const r = await rodar({ argv: ['--fixture', FIXTURE, '--dia', '2026-11-20', '--relato'], env: {}, log: () => {}, stateDir: dir });
  assert.equal(r.status, 'parcial');
  assert.equal(r.pacote.reels.length, 3);
  assert.ok(fs.existsSync(path.join(dir, 'pacote-2026-11-20.json')));
  assert.ok(fs.existsSync(path.join(dir, 'pacote-2026-11-20.md')));
  const rel = JSON.parse(fs.readFileSync(path.join(dir, 'relato-2026-11-20.json'), 'utf8'));
  for (const k of ['agente', 'ts', 'trace_id', 'status', 'kpis', 'achados', 'cobertura']) assert.ok(k in rel, k);
  assert.equal(rel.agente, 'estudio-viral');
  assert.equal(rel.kpis.reels_aprovados, 3);
  assert.ok(rel.cobertura.lacunas.some((l) => /fixture/.test(l)));
  const schema = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'contracts', 'relato.schema.json'), 'utf8'));
  assert.ok(schema.properties.agente.enum.includes('estudio-viral'));
});

test('sem chave e sem fixture: falha alto', async () => {
  await assert.rejects(rodar({ argv: ['--dia', '2026-11-20'], env: {}, log: () => {}, stateDir: dir }), /ANTHROPIC_API_KEY ausente/);
});

test('rodada com modelo simulado: pacote bloqueado é corrigido na segunda chamada; aviso ao Julien leva o link', async () => {
  const bom = lerFixture(); const ruim = lerFixture(); ruim.reels[0].texte_ecran[0].texte = 'GTA 6 CE SOIR';
  let chamadas = 0;
  const llm = { disponivel: true, modelo: 'simulado', chamar: async ({ tools }) => { chamadas += 1; if (tools) return { texto: JSON.stringify({ novidades: [{ panier: 'jeu', titre: 'x', fait: 'y', date: '2026-11-20', source_url: 'https://ex.test/a' }, { panier: 'jeu', titre: 'sem fonte', fait: 'z' }] }), modelo: 'simulado', buscas: 2, usage: {} }; return { texto: '```json\n' + JSON.stringify(chamadas === 2 ? ruim : bom) + '\n```', modelo: 'simulado', usage: {} }; } };
  const pedidos = [];
  const env = { CHAUFFEUR_CONFIRMA_URL: 'https://central.test', CENTER_TOKEN: 'segredo', ARIA_TEAM_ALERT_SECRET: 'aria', AGENT_ARIA_URL: 'https://aria.test' };
  const avisarImpl = async (url, init) => { pedidos.push({ url, corpo: JSON.parse(init.body) }); return { ok: true, status: 200, json: async () => ({ ok: true, desfecho: 'alerta_equipe_enviado' }) }; };
  const r = await rodar({ argv: ['--dia', '2026-11-21', '--avisar'], env, llm, avisarImpl, log: () => {}, stateDir: dir });
  assert.equal(chamadas, 3, 'veille + pacote + correção');
  assert.equal(r.veille.novidades.length, 1, 'item sem fonte descartado');
  assert.equal(r.status, 'parcial', 'sem Olheiro a lacuna é declarada: nunca "ok" silencioso');
  assert.ok(r.lacunas.some((l) => /Olheiro/.test(l)));
  assert.equal(r.removidos.length, 0);
  assert.equal(r.pacote.reels.length, 3);
  assert.equal(pedidos.length, 1);
  assert.equal(pedidos[0].corpo.destinatario, 'julien');
  assert.match(pedidos[0].corpo.situacao, /https:\/\/central\.test\/studio\/2026-11-21\?t=/);
  assert.ok(!/\+33/.test(pedidos[0].corpo.situacao));
});

test('link assinado: token do dia valida; outro dia ou outro segredo, não', () => {
  const env = { CENTER_TOKEN: 'abc', CHAUFFEUR_CONFIRMA_URL: 'https://c.test/' };
  const t = token('2026-11-20', env);
  assert.equal(t.length, 16);
  assert.equal(tokenValido('2026-11-20', t, env), true);
  assert.equal(tokenValido('2026-11-21', t, env), false);
  assert.equal(tokenValido('2026-11-20', t, { CENTER_TOKEN: 'outro' }), false);
  assert.equal(link('2026-11-20', env), `https://c.test/studio/2026-11-20?t=${t}`);
  assert.equal(link('2026-11-20', {}), null);
});

test('llm: sem chave não está disponível; extrairJson aceita cerca ```json', () => {
  assert.equal(criar({}, { sdk: function Fake() {} }).disponivel, false);
  assert.deepEqual(extrairJson('texto antes ```json\n{"a":1}\n``` depois'), { a: 1 });
  assert.throws(() => extrairJson('nada'), /nenhum JSON/);
});

test('contexto: calendário na janela de 21 dias e pilar do dia', () => {
  const c = contexto.calendario('2026-11-20');
  assert.ok(c.eventos.some((e) => /Game Show/.test(e.titre)));
  assert.ok(!c.eventos.some((e) => /Toulon/.test(e.titre)), '26/12 está fora da janela');
  assert.equal(c.pilier, 'toulouse'); // sexta
});
