'use strict';
/**
 * Juiz Editorial — julga UMA peça do Quill (ficha, cidade, meta tags) antes de publicar.
 * Alimenta `juiz_editorial_nota` (PROP-103 publicação editorial autônoma).
 *
 * peca = { locale: 'en'|'fr'|'es'|'it'|'pt'|'de', titulo, meta_description, corpo (texto ou HTML),
 *          tem_review_real: boolean, structured_data?: object }
 * contexto = { titulos_existentes?: string[] }
 */
const { julgar, detectarIdioma, temAlgum, VOCAB_INTERNO, PROMESSA_PRAZO, MARCA_ERRADA } = require('./juiz');

const semHtml = (s) => String(s || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const tagsDesbalanceadas = (html) => {
  const h = String(html || '');
  for (const t of ['p', 'div', 'h1', 'h2', 'h3', 'ul', 'li', 'a', 'section']) {
    const abre = (h.match(new RegExp(`<${t}(\\s[^>]*)?>`, 'gi')) || []).length;
    const fecha = (h.match(new RegExp(`</${t}>`, 'gi')) || []).length;
    if (abre !== fecha) return `<${t}> abre ${abre}× e fecha ${fecha}×`;
  }
  return null;
};

const CRITERIOS = [
  { id: 'E1_rating', eliminatorio: true, descricao: 'nunca emitir aggregateRating sem review real (matriz item 01)', avaliar: (p) => { const tem = !!(p.structured_data && (p.structured_data.aggregateRating || JSON.stringify(p.structured_data).includes('aggregateRating'))); return { ok: !(tem && !p.tem_review_real), detalhe: tem && !p.tem_review_real ? 'aggregateRating sem review real' : '' }; } },
  { id: 'E2_idioma', eliminatorio: true, descricao: 'idioma do corpo = locale da URL (9.276 URLs localizadas tinham corpo em inglês)', avaliar: (p) => { const d = detectarIdioma(semHtml(p.corpo)); return { ok: d !== 'desconhecido' && d === p.locale, detalhe: `detectado=${d} locale=${p.locale}` }; } },
  { id: 'E3_vocab', eliminatorio: true, descricao: 'sem vocabulário interno', avaliar: (p) => { const m = temAlgum(VOCAB_INTERNO, `${p.titulo} ${p.meta_description} ${semHtml(p.corpo)}`); return { ok: !m, detalhe: m ? `casou ${m}` : '' }; } },
  { id: 'E4_promessa', eliminatorio: true, descricao: 'sem promessa de confirmação imediata ou prazo (matriz item 02, ADR-015)', avaliar: (p) => { const m = temAlgum(PROMESSA_PRAZO, `${p.titulo} ${p.meta_description} ${semHtml(p.corpo)}`); return { ok: !m, detalhe: m ? `casou ${m}` : '' }; } },
  { id: 'E5_marca', eliminatorio: true, descricao: 'marca correta', avaliar: (p) => { const m = temAlgum(MARCA_ERRADA, `${p.titulo} ${p.meta_description} ${semHtml(p.corpo)}`); return { ok: !m, detalhe: m ? `casou ${m}` : '' }; } },
  { id: 'E6_titulo', descricao: 'título 10–65 caracteres', avaliar: (p) => { const n = String(p.titulo || '').trim().length; return { ok: n >= 10 && n <= 65, detalhe: `${n} caracteres` }; } },
  { id: 'E7_meta', descricao: 'meta description 70–160 caracteres', avaliar: (p) => { const n = String(p.meta_description || '').trim().length; return { ok: n >= 70 && n <= 160, detalhe: `${n} caracteres` }; } },
  { id: 'E8_corpo', descricao: 'corpo com ≥ 300 caracteres de texto', avaliar: (p) => { const n = semHtml(p.corpo).length; return { ok: n >= 300, detalhe: `${n} caracteres` }; } },
  { id: 'E9_html', descricao: 'HTML balanceado', avaliar: (p) => { const d = tagsDesbalanceadas(p.corpo); return { ok: !d, detalhe: d || '' }; } },
  { id: 'E10_titulo_unico', descricao: 'título não repete outro já publicado', avaliar: (p, ctx) => { const dup = (ctx.titulos_existentes || []).some((t) => t.trim().toLowerCase() === String(p.titulo || '').trim().toLowerCase()); return { ok: !dup, detalhe: dup ? 'título duplicado' : '' }; } },
];

const julgarEditorial = (peca, contexto = {}) => ({ juiz: 'editorial', ...julgar(CRITERIOS, peca, contexto), lacunas: ['veracidade dos fatos sobre a casa (chef, prêmios, preço) não é verificável sem fonte — fora deste juiz', 'detector de idioma é por marcas de palavras; textos curtos caem em "desconhecido" e reprovam'] });

module.exports = { julgarEditorial, CRITERIOS, semHtml };
