'use strict';
/**
 * Vigia das reservas (Fase 1, 19/11/2026) — roda dentro da Central a cada 5 minutos (rotinas.js).
 *
 *  1. Pedido parado: reserva ainda em `pedido` há mais de CHAUFFEUR_PENDENTE_MIN minutos (padrão 30) sem resultado
 *     marcado → UM aviso ao Márlon pela Aria (evento pendente:<codigo>), registrado como evento `aviso pendente` para
 *     não repetir. É aviso interno: nada disso é prometido ao cliente (regra: nunca prometer prazo).
 *  2. Uma vez por dia: anonimiza as reservas com mais de 365 dias (apaga nome, WhatsApp, partida, destino, recado).
 *
 * Falha alto: a Aria recusou → devolve a lista de falhas (quem chama abre Ação na Central). Sem segredo → não tenta e diz.
 */
const avisar = require('./avisar.js');

async function rodar({ store, env = process.env, fetchImpl = globalThis.fetch, log = () => {}, hojeIso, estado = {}, agora = () => Date.now() }) {
  const cfg = avisar.config(env);
  const out = { avisados: [], falhas: [], anonimizadas: 0, pendentes: 0 };
  const pend = await store.pendentes(cfg.pendenteMin);
  out.pendentes = pend.length;
  if (pend.length && !cfg.segredo) { out.falhas.push({ codigo: pend.map((r) => r.codigo).join(','), motivo: 'sem ARIA_TEAM_ALERT_SECRET' }); }
  else {
    for (const r of pend) {
      const min = Math.round((agora() - Date.parse(r.criado_em)) / 60_000);
      try {
        const e = await avisar.avisarEquipe({ ...cfg, para: cfg.marlon, sistema: 'Wanted Chauffeur · pedido parado', situacao: avisar.textoPendente(r, min), evento: `pendente:${r.codigo}`, fetchImpl });
        if (!e.ok) throw new Error(e.desfecho);
        await store.evento({ codigo: r.codigo, tipo: 'aviso', valor: 'pendente', nota: `${min} min · ${e.desfecho}`, por: 'central' });
        out.avisados.push(r.codigo); log(`[vigia-reservas] ${r.codigo}: ${cfg.marlon} avisado (${min} min sem resultado)`);
      } catch (err) { const motivo = String(err && err.message || err).slice(0, 160); out.falhas.push({ codigo: r.codigo, motivo }); log(`[vigia-reservas] ${r.codigo}: aviso NÃO saiu (${motivo})`); }
    }
  }
  const hoje = hojeIso ? hojeIso() : new Date().toISOString().slice(0, 10);
  if (estado.anonimizado_em !== hoje) {
    try { const a = await store.anonimizar(365); out.anonimizadas = a.anonimizadas; estado.anonimizado_em = hoje; if (a.anonimizadas) log(`[vigia-reservas] ${a.anonimizadas} reserva(s) anonimizada(s)`); }
    catch (err) { out.falhas.push({ codigo: '-', motivo: `anonimizar: ${String(err && err.message || err).slice(0, 120)}` }); }
  }
  return out;
}

module.exports = { rodar };
