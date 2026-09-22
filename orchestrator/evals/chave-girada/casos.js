'use strict';
/** Eval dos Extratos de Resposta (Chave Girada): nunca cobrar pendências a quem responde; opt-out sempre; só promete o que existe. */
const fs = require('node:fs');
const path = require('node:path');
const { gerarExtrato, TOKENS_PROIBIDOS } = require('../../agents/chave-girada/extratos');
const { exigirOptout } = require('../../agents/registro-optout/rodape-optout');

const esperar = (c, m) => (c ? [] : [m]);
const casa = { name: 'Casa Teste', city: 'Lagos' };
const ctx = { confirmadores: 12, publicados: 1548 };
const casos = [];

for (const idioma of ['pt', 'en', 'fr', 'es', 'it']) {
  for (const [seg, n] of [['A-CONFIRMADOR', { pedidos: 40, aceitos: 33, recusados: 0 }], ['B-MISTO', { pedidos: 20, aceitos: 5, recusados: 4 }], ['C-RECUSADOR', { pedidos: 193, aceitos: 2, recusados: 116 }]]) {
    casos.push({ nome: `${seg} · ${idioma}: gera, tem opt-out real, sem tokens proibidos, com números e link`, run: () => {
      const e = gerarExtrato({ segmento: seg, idioma, casa, n, ctx, restaurant_id: '15207' });
      const f = [];
      try { exigirOptout(e.html); } catch (x) { f.push('sem opt-out'); }
      if (TOKENS_PROIBIDOS.some((re) => re.test(e.texto))) f.push('token proibido');
      if (!e.html.includes('manager.theworldkeys.com/register')) f.push('sem link de cadastro');
      if (!e.texto.includes(casa.name)) f.push('sem nome da casa');
      if (seg !== 'A-CONFIRMADOR' && !e.texto.includes(String(n.recusados))) f.push('não cita recusas');
      if (seg === 'A-CONFIRMADOR' && !e.texto.includes(String(n.aceitos))) f.push('não cita aceites');
      if (!e.assunto || e.assunto.length < 10) f.push('assunto vazio');
      return f;
    } });
  }
}
casos.push({ nome: 'sem --selo, o texto NÃO promete o selo (só promete o que existe)', run: () => { const e = gerarExtrato({ segmento: 'A-CONFIRMADOR', idioma: 'pt', casa, n: { pedidos: 5, aceitos: 5, recusados: 0 }, ctx, restaurant_id: '1' }); return esperar(!/selo "Responde rápido"/.test(e.texto), 'prometeu selo inexistente'); } });
casos.push({ nome: 'nunca afirma ter corrigido horários (hipótese derrubada em 03/09: Google confirma os horários das 15 casas)', run: () => { const f = []; for (const seg of ['A-CONFIRMADOR', 'B-MISTO', 'C-RECUSADOR']) for (const idioma of ['pt', 'en', 'fr', 'es', 'it']) { const e = gerarExtrato({ segmento: seg, idioma, casa, n: { pedidos: 50, aceitos: 10, recusados: 30 }, ctx, restaurant_id: '1' }); if (/corrigimos|we corrected|nous avons corrigé|corregimos|abbiamo corretto/i.test(e.texto)) f.push(`${seg}/${idioma}`); } return esperar(f.length === 0, `afirma correção: ${f.join(',')}`); } });
casos.push({ nome: 'e-mail de reservas aparece só MASCARADO (i***@dominio), nunca inteiro', run: () => { const e = gerarExtrato({ segmento: 'A-CONFIRMADOR', idioma: 'it', casa, n: { pedidos: 6, aceitos: 5, recusados: 0 }, ctx: { ...ctx, email: 'info@ristorante-teste.it' }, restaurant_id: '1' }); return [...esperar(e.html.includes('i***@ristorante-teste.it'), 'sem e-mail mascarado'), ...esperar(!e.html.includes('info@ristorante-teste.it'), 'e-mail inteiro vazou')]; } });
casos.push({ nome: 'identidade visual dos transacionais: fundo #0B0A08, dourado #CE9E3C, logo TWK, pré-visualização', run: () => { const e = gerarExtrato({ segmento: 'A-CONFIRMADOR', idioma: 'en', casa, n: { pedidos: 4, aceitos: 3, recusados: 0 }, ctx, restaurant_id: '1' }); return [...esperar(/#0B0A08/.test(e.html) && /#CE9E3C/.test(e.html), 'paleta fora do padrão'), ...esperar(/twk-logo\.gif/.test(e.html), 'sem logo'), ...esperar(e.preheader && e.preheader.length > 10, 'sem preheader'), ...esperar(/World's Kitchen/.test(e.html) === false, 'marca errada')]; } });
casos.push({ nome: 'texto com "pendentes" é recusado pelo validador', run: () => { const { TOKENS_PROIBIDOS: T } = require('../../agents/chave-girada/extratos'); return esperar(T.some((re) => re.test('vocês têm 12 pedidos pendentes')), 'validador não pega "pendentes"'); } });
casos.push({ nome: 'a lista-alvo gerada não contém casas internas nem PII de cliente', run: () => { const p = path.resolve(__dirname, '..', '..', 'state', 'chave-girada', 'alvos-2026-09-03.csv'); if (!fs.existsSync(p)) return ['lista ausente']; const s = fs.readFileSync(p, 'utf8'); return [...esperar(!/Marlon Food|Le Julien/.test(s), 'casa interna na lista'), ...esperar(!/@/.test(s.split('\n').slice(1).join('\n')), 'e-mail na lista'), ...esperar(!/customer|cliente|phone/.test(s.split('\n')[0]), 'coluna de PII')]; } });

module.exports = { casos };
