'use strict';
/**
 * Peças sob medida (19/11, pedido do Márlon): a pessoa dá a direção (formato + ideia), o modelo cria a peça inteira e o
 * painel entrega pronta para baixar e postar, com a legenda. Formatos: reel (roteiro, como no pacote), post (uma imagem),
 * carrossel (até 10 imagens), story (uma imagem vertical). A imagem é desenhada no navegador (render-canvas.js) a partir
 * dos campos daqui; o modelo nunca gera pixel, só texto e direção visual.
 *
 * Toda peça passa pelas mesmas travas do pacote (wc.js da skill): texto de imagem = contexto `ecran`, legenda = `legende`.
 */
const pacoteMod = require('./pacote.js');

const FORMATOS = ['reel', 'post', 'carrossel', 'story'];
const FUNDOS = ['nuit', 'led', 'ciel', 'interieur', 'noir'];
const txt = (v, max) => String(v == null ? '' : v).replace(/\u0000/g, '').trim().slice(0, max);
const fundo = (f) => (FUNDOS.includes(f) ? f : 'nuit');

/** Normaliza o que veio do modelo (ou da edição) para o formato pedido; descarta o resto. */
function limpar(formato, bruto) {
  const b = bruto && typeof bruto === 'object' ? bruto : {};
  const base = { formato, titre: txt(b.titre, 80), legende: txt(b.legende, 2200), hashtags: (Array.isArray(b.hashtags) ? b.hashtags : []).map((h) => txt(h, 40)).filter((h) => /^#[\p{L}\p{N}_]+$/u.test(h)).slice(0, 8), pourquoi: txt(b.pourquoi, 500), traduction_pt: txt(b.traduction_pt, 2400) };
  if (formato === 'post') return { ...base, image: { fond: fundo(b.image && b.image.fond), titre: txt(b.image && b.image.titre, 60), sous_titre: txt(b.image && b.image.sous_titre, 110), bas: txt(b.image && b.image.bas, 60) } };
  if (formato === 'story') return { ...base, image: { fond: fundo(b.image && b.image.fond), titre: txt(b.image && b.image.titre, 60), sous_titre: txt(b.image && b.image.sous_titre, 140), bas: txt(b.image && b.image.bas, 60) }, sticker: txt(b.sticker, 80) };
  if (formato === 'carrossel') {
    const slides = (Array.isArray(b.slides) ? b.slides : []).map((s) => ({ fond: fundo(s && s.fond), titre: txt(s && s.titre, 60), texte: txt(s && s.texte, 180) })).filter((s) => s.titre || s.texte).slice(0, 10);
    return { ...base, slides };
  }
  return base; // reel: o Reel em si fica em `reel`, no formato do pacote
}

/** Mede a peça com as travas da skill. Devolve { ok, problemas: [{tipo, detalhe}], medidas }. */
function verificar(peca, wc) {
  if (peca.formato === 'reel') { const v = pacoteMod.verificarReel(peca.reel || {}, wc); return { ok: !v.problemas.some((p) => p.tipo === 'bloqueia'), problemas: v.problemas, medidas: v.medidas }; }
  const problemas = []; const bloqueia = (d) => problemas.push({ tipo: 'bloqueia', detalhe: d }); const aviso = (d) => problemas.push({ tipo: 'aviso', detalhe: d });
  const okPreco = (g) => !(g.id === 'prix' && /batem com a tabela/i.test(g.message));
  const textosImagem = peca.formato === 'carrossel' ? (peca.slides || []).flatMap((s, i) => [[`slide ${i + 1}`, s.titre], [`slide ${i + 1}`, s.texte]]) : [['imagem', (peca.image || {}).titre], ['imagem', (peca.image || {}).sous_titre], ['imagem', (peca.image || {}).bas]];
  for (const [onde, t] of textosImagem) if (t) for (const g of wc.travas(t, 'ecran').filter(okPreco)) (g.niveau === 'bloquant' ? bloqueia : aviso)(`${onde} « ${t} »: ${g.message}`);
  if (peca.formato === 'carrossel') {
    if ((peca.slides || []).length < 3) bloqueia('carrossel com menos de 3 slides');
    const primeiro = (peca.slides || [])[0]; if (primeiro && !/toulouse/i.test(`${primeiro.titre} ${primeiro.texte}`)) aviso('TOULOUSE não aparece no primeiro slide');
  } else if (!/toulouse/i.test(`${(peca.image || {}).titre} ${(peca.image || {}).sous_titre}`)) aviso('TOULOUSE não aparece na imagem');
  const medidas = {};
  if (peca.formato !== 'story' || peca.legende) {
    const l = wc.legende(`${peca.legende || ''}\n${(peca.hashtags || []).join(' ')}`.trim());
    medidas.legende = { linhas: l.linhas.filter((x) => x.estado !== 'ok').map((x) => `${x.nome}: ${x.detalhe}`), coupe: l.coupe };
    for (const x of l.linhas) if (x.estado === 'falha') bloqueia(`legenda: ${x.nome} — ${x.detalhe}`);
    for (const g of l.garde_fous.filter(okPreco)) { if (g.niveau === 'bloquant' || /fora da tabela/i.test(g.message)) bloqueia(`legenda: ${g.message}`); else aviso(`legenda: ${g.message}`); }
    if (!(peca.hashtags || []).some((h) => /^#toulouse$/i.test(h))) aviso('falta #Toulouse nos hashtags');
  }
  if (peca.sticker) for (const g of wc.travas(peca.sticker, 'ecran').filter(okPreco)) if (g.niveau === 'bloquant') bloqueia(`sticker: ${g.message}`);
  return { ok: !problemas.some((p) => p.tipo === 'bloqueia'), problemas, medidas };
}

module.exports = { FORMATOS, FUNDOS, limpar, verificar };
