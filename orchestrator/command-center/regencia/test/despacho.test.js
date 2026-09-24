'use strict';
// Testes do redesenho do Despacho (2026-09-24): pull em vez de push, alerta só como exceção,
// toda decisão na Central, crônico separado do novo. `node --test regencia/test/despacho.test.js`
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const despacho = require('../despacho');
const historico = require('../historico');

const item = (chave, severidade, titulo, extra = {}) => ({ chave, severidade, titulo, agente: 'dba', acao_proposta: 'decidir', evidencia: '', fila: 'fundador', ...extra });
const estado = (itens) => ({ ts: '2026-09-24T08:00:00.000Z', manchete: 'x', contagens: { criticos: 0 }, decisoes: itens, para_fundador: itens, criticos: itens.filter((i) => i.severidade === 'critica'), sinais: [], experiencia: [], autonomas: [], aprovacoes: [], cobertura: [], cegos: [] });

test('limpar: nenhuma frase pede resposta por e-mail', () => {
  const frases = [
    'responder este e-mail',
    'responda a este e-mail',
    'responder sim ou não a este e-mail',
    'responda `pode cobrar` e eu envio hoje (Paris, Atenas e Marrakech, até 20 por dia)',
    'aprovar na Central (canário Paris) → run.js --apply',
  ];
  for (const f of frases) {
    const t = despacho.limpar(f);
    assert.doesNotMatch(t, /e-mail/i, `ainda pede e-mail: "${f}" → "${t}"`);
    assert.match(t, /Central/, `não aponta para a Central: "${f}" → "${t}"`);
  }
  assert.equal(despacho.limpar('responder na Conversa da Central'), 'responder na Conversa da Central');
});

test('corpo: rodapé aponta para a Central, nunca para responder o e-mail', () => {
  const md = despacho.corpo(estado([]), {});
  assert.doesNotMatch(md, /responder este e-mail/i);
  assert.match(md, /na Central, em Aprovações e Ações/);
  assert.match(despacho.corpo(estado([]), { centralUrl: 'https://central.exemplo' }), /https:\/\/central\.exemplo/);
});

test('corpo: item com mais de 3 dias vira dívida, fora de Urgente; novo fica em Urgente', () => {
  const est = estado([item('a.novo', 'critica', 'Item novo crítico'), item('b.velho', 'critica', 'Item crônico'), item('c.media', 'media', 'Item médio antigo')]);
  const md = despacho.corpo(est, { idades: { 'a.novo': 0, 'b.velho': 12, 'c.media': 5 }, desde: { 'b.velho': '2026-09-12', 'c.media': '2026-09-19' } });
  const urgente = md.slice(md.indexOf('### Urgente'), md.indexOf('### Esperando decisão'));
  assert.match(urgente, /Item novo crítico/);
  assert.doesNotMatch(urgente, /Item crônico/);
  assert.match(md, /### Esperando decisão há mais de 3 dias \(2\)/);
  assert.match(md, /\*\*Item crônico\*\* — desde 12\/09 \(12 dias\)/);
  assert.doesNotMatch(md, /### Quando puder/); // o médio antigo também é dívida
  // dívida mais antiga primeiro
  assert.ok(md.indexOf('Item crônico') < md.indexOf('Item médio antigo'));
});

test('corpo: só dívidas → "Nada novo hoje"; resolvidos aparecem', () => {
  const est = estado([item('b.velho', 'alta', 'Item crônico')]);
  const md = despacho.corpo(est, { idades: { 'b.velho': 9 }, desde: { 'b.velho': '2026-09-15' }, resolvidos: { desde: '2026-09-23', itens: [{ chave: 'z', titulo: 'A Aria não responde ninguém há 34 hora(s)' }] } });
  assert.match(md, /Nada novo hoje/);
  assert.match(md, /### Resolvido desde o último Despacho \(23\/09\)/);
  assert.match(md, /- A Aria não responde ninguém/);
});

test('alerta: curto, só os itens novos, aponta para a Central e declara o teto', () => {
  const md = despacho.alerta([item('a', 'critica', 'Cinco clientes jantam hoje sem resposta', { prazo: 'hoje' })], {});
  assert.match(md, /^# Alerta do MAESTRO/);
  assert.match(md, /Um item crítico novo/);
  assert.match(md, /Cinco clientes jantam hoje sem resposta/);
  assert.match(md, /na Central/);
  assert.match(md, /no máximo uma vez por dia/);
  assert.doesNotMatch(md, /Em três linhas|Quem está esperando/);
});

test('historico: idade conta dias consecutivos com estado gravado; dia sem estado é pulado; resolvidos vêm do último dia', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'regencia-'));
  const grava = (dia, chaves, nome = 'estado-do-sistema.json') => {
    fs.mkdirSync(path.join(dir, 'relatos', dia), { recursive: true });
    fs.writeFileSync(path.join(dir, 'relatos', dia, nome), JSON.stringify({ para_fundador: chaves.map((c) => ({ chave: c, titulo: 't-' + c, agente: 'dba', severidade: 'alta' })) }));
  };
  grava('2026-09-20', ['velho']);
  grava('2026-09-21', ['velho', 'sumiu']);
  fs.mkdirSync(path.join(dir, 'relatos', '2026-09-22'), { recursive: true }); // dia sem estado: pulado
  grava('2026-09-23', ['velho', 'ontem'], 'estado-do-sistema-2330.json'); // só horário → vale o último
  const hoje = estado([item('velho', 'alta', 'v'), item('ontem', 'alta', 'o'), item('novo', 'alta', 'n')]);
  const { idades, desde } = historico.calcularIdades(dir, hoje, '2026-09-24');
  assert.deepEqual(idades, { velho: 4, ontem: 1, novo: 0 });
  assert.equal(desde.velho, '2026-09-20');
  const r = historico.calcularResolvidos(dir, hoje, '2026-09-24');
  assert.equal(r.desde, '2026-09-23');
  assert.deepEqual(r.itens.map((i) => i.chave), []);
  const r2 = historico.calcularResolvidos(dir, estado([item('velho', 'alta', 'v')]), '2026-09-24');
  assert.deepEqual(r2.itens.map((i) => i.chave), ['ontem']);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('historico: dedup de 7 dias e teto de 1 e-mail por dia', () => {
  const agora = Date.parse('2026-09-24T10:00:00Z');
  const alertas = [
    { ts: '2026-09-20T08:00:00Z', chave: 'a' },                     // 4 dias: ainda vista
    { ts: '2026-09-15T08:00:00Z', chave: 'b' },                     // 9 dias: expirou
    { ts: '2026-09-24T08:05:00Z', chave: 'c', email_enviado_em: '2026-09-24T08:05:00Z' },
  ];
  const vistas = historico.chavesVistas(alertas, agora, 7);
  assert.ok(vistas.has('a') && !vistas.has('b') && vistas.has('c'));
  assert.equal(historico.emailEnviadoHoje(alertas, '2026-09-24'), true);
  assert.equal(historico.emailEnviadoHoje(alertas, '2026-09-25'), false);
  assert.equal(historico.emailEnviadoHoje([{ ts: '2026-09-24T08:00:00Z', chave: 'x' }], '2026-09-24'), false);
});
