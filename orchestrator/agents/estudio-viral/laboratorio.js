'use strict';
/**
 * Laboratório: as medidas da skill (wc.js) em formato pronto para o painel. Sem modelo, sem rede, resposta na hora.
 *   ganchos(texto)  → uma linha por gancho ("fala | texto de tela"), ordenados por nota, com os seis controles explicados
 *   legenda(texto)  → as verificações de legenda
 *   travas(texto, contexto) → só as travas do projeto
 *   formulas()      → a biblioteca de fórmulas da skill
 */
const ROTULO = {
  entree: ['Entrada', 'começa na coisa, sem saudação nem preâmbulo'],
  concret: ['Concreto', 'número, lugar, objeto ou nome próprio'],
  lieu: ['Toulouse', 'a cidade aparece na fala ou na tela'],
  duree: ['Duração', 'a primeira fala cabe em 3 segundos'],
  tension: ['Tensão', 'negação, contraste, pergunta ou algo em jogo'],
  ecran: ['Tela', 'texto de tela curto e diferente da fala'],
};

function criar(skill) {
  const { wc } = skill;

  function gancho(linha) {
    const a = wc.noterAccroche(String(linha).slice(0, 400));
    return {
      voix: a.voix, ecran: a.ecran, note: a.note, verdict: a.verdict, secondes: a.secondes, mots: a.mots, plus_faible: a.plus_faible,
      formule: a.formule ? { id: a.formule.id, nom: a.formule.nom } : null, adresse: a.adresse, concrets: a.concrets, lieu: a.lieu,
      controles: Object.entries(a.controles).map(([k, v]) => ({ id: k, nom: (ROTULO[k] || [k])[0], explique: (ROTULO[k] || ['', ''])[1], valeur: v })),
      conseils: a.motifs, travas: a.garde_fous.map((g) => ({ niveau: g.niveau, message: g.message, extrait: g.extrait })),
    };
  }
  function ganchos(texto) {
    const linhas = String(texto || '').split(/\r?\n/).map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').trim()).filter(Boolean).slice(0, 40);
    return linhas.map(gancho).sort((a, b) => b.note - a.note);
  }
  function legenda(texto, { type = 'legende' } = {}) {
    const l = wc.legende(String(texto || '').slice(0, 4000), { type: type === 'bio' ? 'bio' : 'legende' });
    return { linhas: l.linhas, fenetre: l.fenetre || null, coupe: !!l.coupe, cliches: (l.cliches || []).map((c) => ({ terme: c.terme, conseil: c.conseil })), travas: (l.garde_fous || []).map((g) => ({ niveau: g.niveau, message: g.message, extrait: g.extrait })) };
  }
  function travas(texto, contexto = 'legende') {
    const ctx = ['ecran', 'legende', 'voix', 'bio'].includes(contexto) ? contexto : 'legende';
    return wc.travas(String(texto || '').slice(0, 4000), ctx).map((g) => ({ niveau: g.niveau, message: g.message, extrait: g.extrait }));
  }
  function formulas() {
    const f = skill.formules; const ordem = f.ordre || [];
    return (f.formules || []).slice().sort((a, b) => ordem.indexOf(a.id) - ordem.indexOf(b.id)).map((x) => ({ id: x.id, nom: x.nom, modele: x.modele, exemple: x.exemple, ecran: x.ecran, pour: x.pour, rate: x.rate }));
  }
  return { gancho, ganchos, legenda, travas, formulas, ROTULO };
}

module.exports = { criar, ROTULO };
