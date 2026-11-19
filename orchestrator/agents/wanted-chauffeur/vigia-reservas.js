'use strict';
/**
 * Vigia das reservas — roda dentro da Central a cada 5 minutos (rotinas.js).
 *
 *  1. (Fase 1) Pedido parado: reserva ainda em `pedido` há mais de CHAUFFEUR_PENDENTE_MIN minutos (padrão 30) sem resultado
 *     marcado → UM aviso ao Márlon pela Aria (evento pendente:<codigo>), registrado como evento `aviso pendente` para
 *     não repetir. É aviso interno: nada disso é prometido ao cliente (regra: nunca prometer prazo).
 *  2. (Fase 2) Lembretes das corridas confirmadas: na véspera a partir das 8:00 PM (Paris) → cliente (`lembrete_vespera`);
 *     até 2 h antes → cliente (`lembrete_2h`) e Julien pela Aria (`lembrete_julien`). Cada um sai uma vez por reserva.
 *     O cliente só recebe se o canal da Meta estiver ligado (cliente.js registra `sem_canal` quando não está).
 *  3. Uma vez por dia: anonimiza as reservas com mais de 365 dias (apaga nome, WhatsApp, partida, destino, recado).
 *
 * Falha alto: a Aria/Meta recusou → devolve a lista de falhas (quem chama abre Ação na Central). Sem segredo → não tenta e diz.
 */
const avisar = require('./avisar.js');
const cliente = require('./cliente.js');

async function rodar({ store, env = process.env, fetchImpl = globalThis.fetch, log = () => {}, hojeIso, estado = {}, agora = () => Date.now() }) {
  const cfg = avisar.config(env);
  const out = { avisados: [], falhas: [], anonimizadas: 0, pendentes: 0, lembretes: [] };
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

  // ---- lembretes (Fase 2)
  const t = agora();
  const hoje = cliente.hojeParis(t), amanha = cliente.amanhaParis(t), horaAgora = cliente.horaParis(t);
  const confirmadas = await store.porStatus('confirmado', { desde: hoje });
  for (const r of confirmadas) {
    const inicio = cliente.instanteParis(r.data, r.hora);
    // véspera: a partir das 8:00 PM do dia anterior
    if (r.data === amanha && horaAgora >= 20 && !r.avisos.includes('lembrete_vespera') && !r.avisos.includes('lembrete_vespera_falhou')) {
      const e = await cliente.enviar({ store, reserva: r, tipo: 'lembrete_vespera', env, fetchImpl, log });
      out.lembretes.push({ codigo: r.codigo, tipo: 'lembrete_vespera', ...e });
    }
    if (!inicio) continue;
    const faltam = (inicio - t) / 60_000;
    // 2 h antes: janela de 120 a 0 min; corrida já começada não recebe
    if (faltam <= 120 && faltam > 0) {
      if (!r.avisos.includes('lembrete_2h') && !r.avisos.includes('lembrete_2h_falhou')) {
        const e = await cliente.enviar({ store, reserva: r, tipo: 'lembrete_2h', env, fetchImpl, log });
        out.lembretes.push({ codigo: r.codigo, tipo: 'lembrete_2h', ...e });
      }
      if (!r.avisos.includes('lembrete_julien') && cfg.segredo) {
        try {
          const e = await avisar.avisarEquipe({ ...cfg, para: cfg.julien, sistema: 'Wanted Chauffeur · dans 2 h', situacao: avisar.textoLembreteJulien(r), evento: `lembrete:${r.codigo}`, fetchImpl });
          if (!e.ok) throw new Error(e.desfecho);
          await store.evento({ codigo: r.codigo, tipo: 'aviso', valor: 'lembrete_julien', nota: e.desfecho, por: 'central' });
          out.lembretes.push({ codigo: r.codigo, tipo: 'lembrete_julien', enviado: true });
        } catch (err) { const motivo = String(err && err.message || err).slice(0, 160); out.falhas.push({ codigo: r.codigo, motivo: `lembrete ao Julien: ${motivo}` }); }
      }
    }
  }

  const dia = hojeIso ? hojeIso() : hoje;
  if (estado.anonimizado_em !== dia) {
    try { const a = await store.anonimizar(365); out.anonimizadas = a.anonimizadas; estado.anonimizado_em = dia; if (a.anonimizadas) log(`[vigia-reservas] ${a.anonimizadas} reserva(s) anonimizada(s)`); }
    catch (err) { out.falhas.push({ codigo: '-', motivo: `anonimizar: ${String(err && err.message || err).slice(0, 120)}` }); }
  }
  return out;
}

module.exports = { rodar };
