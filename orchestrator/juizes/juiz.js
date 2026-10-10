'use strict';
/**
 * Juiz genérico (08/10/2026) — padrão do Juiz de Conversa da Aria (ADR-015) para qualquer peça
 * produzida por agente: ficha de catálogo, texto editorial, mensagem a estabelecimento.
 *
 * Um juiz = lista de critérios determinísticos. Cada critério devolve { ok, detalhe }.
 * Critério `eliminatorio` reprovado → nota 0 e reprovação, independentemente do resto.
 * Nota = 10 × (critérios ok / critérios avaliados), arredondada a 1 casa.
 * Critério que lança exceção = reprovado (checagem que não rodou é finding).
 *
 * A nota alimenta o motor de políticas (juiz_*_nota). Zero LLM: o que exige leitura humana
 * ou modelo fica fora destes critérios e é dito nas lacunas.
 */

function julgar(criterios, peca, contexto = {}) {
  const resultados = [];
  for (const c of criterios) {
    let r;
    try { r = c.avaliar(peca, contexto) || { ok: false, detalhe: 'critério sem resultado' }; }
    catch (e) { r = { ok: false, detalhe: `critério falhou ao rodar: ${e.message}` }; }
    resultados.push({ id: c.id, descricao: c.descricao, eliminatorio: !!c.eliminatorio, ok: !!r.ok, detalhe: r.detalhe || '' });
  }
  const eliminado = resultados.find((r) => r.eliminatorio && !r.ok);
  const ok = resultados.filter((r) => r.ok).length;
  const nota = eliminado ? 0 : Math.round((10 * ok / Math.max(1, resultados.length)) * 10) / 10;
  return {
    nota, aprovado: !eliminado && nota >= 8, eliminado: eliminado ? eliminado.id : null,
    reprovados: resultados.filter((r) => !r.ok).map((r) => `${r.id}: ${r.detalhe}`),
    criterios: resultados,
  };
}

// Vocabulário interno que nunca pode sair numa peça pública (ADR-015, outboundGate).
const VOCAB_INTERNO = [/\bSLA\b/i, /\bhandoff\b/i, /\btrace_id\b/i, /\baria_[a-z_]+\b/i, /\bdb_restaurants\b/i, /\breservations\b(?=.*\btabela\b)/i, /\bexpired_at\b/i, /\bbooking_status\b/i, /\bn8n\b/i, /\bescalei\b/i, /\bregistrei\b/i, /\bfila de escala[cç][aã]o\b/i];
// Promessa de prazo de terceiro ou de etapa humana (ADR-015).
const PROMESSA_PRAZO = [/\b(within|in|dans|entro|en|dentro de|em at[eé]|in less than)\s+\d+\s*(h|hours?|heures?|ore|horas?|business days?|jours?|dias?|giorni)\b/i, /\bwe will get back to you (shortly|soon|within)/i, /\bnossa equipe (vai|ir[aá]) (retornar|responder)/i, /\bthe restaurant will (confirm|reply|answer) (by|within|in)\b/i, /\bconfirmation within\b/i, /\binstant(aneous)? confirmation\b/i, /\bconfirma[cç][aã]o (imediata|instant[aâ]nea)\b/i];
// Nome errado da marca (funil se apresentou como "The World's Kitchen" em 09/2026).
const MARCA_ERRADA = [/world'?s kitchen/i, /worldkeys\b(?!\.com)/i];

// Detector de idioma mínimo (sem rede): devolve 'en'|'fr'|'es'|'it'|'pt'|'de'|'desconhecido'.
const MARCAS_IDIOMA = {
  en: [/\bthe\b/i, /\band\b/i, /\byour\b/i, /\bwith\b/i, /\bplease\b/i, /\bthank you\b/i],
  fr: [/\bnous\b/i, /\bvous\b/i, /\bpour\b/i, /\bavec\b/i, /\bmerci\b/i, /\bdans\b/i, /\best\b/i],
  es: [/\bnosotros\b/i, /\busted\b/i, /\bgracias\b/i, /\bpara\b/i, /\bcon\b/i, /\breserva\b/i, /\bel\b/i, /\bla\b/i],
  it: [/\bgrazie\b/i, /\bper\b/i, /\bcon\b/i, /\bprenotazione\b/i, /\bil\b/i, /\bdella\b/i, /\bnoi\b/i],
  pt: [/\bobrigad[oa]\b/i, /\bvocê\b/i, /\bpara\b/i, /\bcom\b/i, /\bnão\b/i, /\breserva\b/i, /\bdo\b/i, /\bda\b/i],
  de: [/\bund\b/i, /\bnicht\b/i, /\bdanke\b/i, /\bmit\b/i, /\bfür\b/i, /\bsie\b/i, /\bder\b/i, /\bdie\b/i],
};
function detectarIdioma(texto) {
  const t = String(texto || '');
  if (t.trim().length < 20) return 'desconhecido';
  let melhor = 'desconhecido', max = 0;
  for (const [idioma, marcas] of Object.entries(MARCAS_IDIOMA)) {
    const n = marcas.reduce((a, re) => a + ((t.match(new RegExp(re.source, 'gi')) || []).length), 0);
    if (n > max) { max = n; melhor = idioma; }
  }
  return max >= 2 ? melhor : 'desconhecido';
}

const temAlgum = (lista, texto) => lista.find((re) => re.test(String(texto || '')));

module.exports = { julgar, detectarIdioma, temAlgum, VOCAB_INTERNO, PROMESSA_PRAZO, MARCA_ERRADA };
