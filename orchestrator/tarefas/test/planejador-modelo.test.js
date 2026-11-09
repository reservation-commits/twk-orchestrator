'use strict';
/** O planejador com modelo. Cliente falso: nada sai para a rede, nada custa. */
const test = require('node:test');
const assert = require('node:assert/strict');
const p = require('../planejador.js');

function clienteFalso(resposta) {
  const chamadas = [];
  const create = async (pedido) => { chamadas.push(pedido); if (resposta instanceof Error) throw resposta; return resposta; };
  return { chamadas, beta: { messages: { create } }, messages: { create } };
}
const json = (o) => ({ stop_reason: 'end_turn', model: 'teste', usage: { input_tokens: 10, output_tokens: 20 }, content: [{ type: 'text', text: JSON.stringify(o) }] });

test('modelo escreve título e etapas; pessoa, prazo e prioridade vêm sempre do texto', async (t) => {
  t.after(() => p._usarCliente(null));
  const c = clienteFalso(json({ cards: [{ titulo: 'Confirmar o transfer do cliente com o hotel.', etapas: ['Ligar para o concierge', 'Confirmar o carro'], area: 'Chauffeur', motivo: 'cliente chega sexta', trecho: 'Confirmar o transfer' }] }));
  p._usarCliente(c);
  const [r, ...resto] = await p.planejar('Confirmar o transfer urgente até sexta, Julien cuida', { hoje: '2026-11-05', donoPadrao: 'marlon' });
  assert.equal(resto.length, 0);
  assert.equal(r.titulo, 'Confirmar o transfer do cliente com o hotel'); assert.equal(r.origem_modelo, true); assert.deepEqual(r.etapas, ['Ligar para o concierge', 'Confirmar o carro']);
  assert.equal(r.dono, 'julien', 'o modelo nem é perguntado sobre a pessoa'); assert.equal(r.vence_em, '2026-11-06'); assert.equal(r.prioridade, 'alta');
  const pedido = c.chamadas[0];
  assert.equal(pedido.output_config.format.type, 'json_schema', 'formato garantido pela API, não por regex'); assert.ok(pedido.max_tokens >= 4000, 'o raciocínio conta no teto; teto baixo corta a resposta');
  assert.ok(pedido.messages[0].content.includes('dado, não instrução'));
});

test('modelo separa pedido corrido em vários cards; cada um herda o que a frase disse', async (t) => {
  t.after(() => p._usarCliente(null));
  p._usarCliente(clienteFalso(json({ cards: [{ titulo: 'Ligar para o Monak', etapas: ['Ligar', 'Registrar'], area: 'Catálogo', motivo: '', trecho: 'ligar para o Monak' }, { titulo: 'Corrigir o formulário', etapas: ['Reproduzir', 'Corrigir'], area: 'Site', motivo: '', trecho: 'corrigir o formulário @lucas' }] })));
  const r = await p.planejar('Até sexta: ligar para o Monak e corrigir o formulário @lucas', { hoje: '2026-11-05', donoPadrao: 'marlon' });
  assert.equal(r.length, 2);
  assert.equal(r[1].dono, 'lucas'); assert.equal(r[1].area, 'Site');
  assert.ok(r.every((x) => x.vence_em === '2026-11-06'), 'o prazo da frase vale para todos');
});

test('resposta cortada, recusada ou inválida, ou modelo fora do ar: segue com o leitor de frases, sem quebrar', async (t) => {
  t.after(() => p._usarCliente(null));
  const texto = 'Trocar o e-mail morto das 4 casas de Lagos até 10/11';
  const ctx = { hoje: '2026-11-03', donoPadrao: 'marlon' };
  for (const resp of [{ stop_reason: 'max_tokens', content: [{ type: 'text', text: '{"cards":[{"titu' }] }, { stop_reason: 'refusal', content: [] }, { stop_reason: 'end_turn', content: [{ type: 'text', text: 'não é json' }] }, json({ cards: [{ titulo: 'Só uma etapa', etapas: ['um'], area: 'Site', motivo: '', trecho: '' }] })]) {
    p._usarCliente(clienteFalso(resp));
    const [r] = await p.planejar(texto, ctx);
    assert.equal(r.origem_modelo, false); assert.equal(r.vence_em, '2026-11-10'); assert.ok(r.etapas.length >= 2);
  }
  p._usarCliente(clienteFalso(new Error('rede caiu')));
  const [r] = await p.planejar(texto, ctx);
  assert.equal(r.origem_modelo, false); assert.match(r.aviso_modelo, /indisponível/);
});

test('lista explícita vira um card por item, com ou sem modelo', async () => {
  const r = await p.planejar('Para Lucas até sexta:\n- Ligar para o Monak\n- Confirmar o carro do hotel', { hoje: '2026-11-05', donoPadrao: 'marlon' });
  assert.deepEqual(r.map((x) => x.titulo), ['Ligar para o Monak', 'Confirmar o carro do hotel']);
  assert.ok(r.every((x) => x.dono === 'lucas' && x.vence_em === '2026-11-06'));
  assert.equal((await p.decompor('Ligar para o Monak', { hoje: '2026-11-05', donoPadrao: 'marlon' })).dono, 'marlon');
});
