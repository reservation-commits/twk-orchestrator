/* Wanted Chauffeur · tabela de preços (TTC, por carro), aprovada em 16/11/2026.
   Precisa bater com PRECO_CENT em orchestrator/agents/wanted-chauffeur/reservas.js: o servidor grava o valor de lá.
   Um teste da Porta compara os dois (test/site.test.js) e falha se divergirem. */
export const PRODUTOS = {
  transfer: { nome: 'Transfer', preco: 80, porHora: false },
  mad: { nome: 'Mise à disposition', preco: 90, porHora: true },
  night: { nome: 'Night Ride', preco: 250, porHora: false },
  game: { nome: 'Game Night', preco: 350, porHora: false },
  soiree: { nome: 'Soirée', preco: 390, porHora: false, plus: ' + dîner' },
};

/** Valor em euros da mission (MAD: preço × horas, mínimo 2). */
export function montante(produto, horas) {
  const p = PRODUTOS[produto];
  return p.porHora ? p.preco * Math.max(2, Number(horas) || 2) : p.preco;
}
