'use strict';
/**
 * Regência — consolida os relatos no Estado do Sistema e nas decisões do MAESTRO.
 * Determinístico. As decisões seguem a tabela de autonomia da constituição:
 *   autonomo / autonomo_com_log → "em curso" (o MAESTRO só registra)
 *   requer_aprovacao_orquestrador → o MAESTRO decide e grava a justificativa
 *   requer_aprovacao_humana → vai para "Precisa de você", com prazo
 */
const SEV = { critica: 4, alta: 3, media: 2, info: 1 };

function consolidar(relatos, opts = {}) {
  const achados = [];
  for (const r of relatos) for (const a of r.achados || []) achados.push({ ...a, agente: r.agente });
  achados.sort((a, b) => (SEV[b.severidade] || 0) - (SEV[a.severidade] || 0));

  const cobertura = relatos.map((r) => ({ agente: r.agente, status: r.status, fontes: r.cobertura.fontes.length, lacunas: r.cobertura.lacunas }));
  const cegos = cobertura.filter((c) => c.status !== 'ok');
  const vistos = new Set();
  const sinais = relatos.flatMap((r) => (r.sinais_conversao || []).map((s) => ({ ...s, agente: r.agente }))).filter((s) => { const k = `${s.tipo}|${s.valor}|${s.fonte || ''}`; if (vistos.has(k)) return false; vistos.add(k); return true; });
  const experiencia = relatos.flatMap((r) => (r.experiencia || []).map((s) => ({ ...s, agente: r.agente })));
  const autonomas = relatos.flatMap((r) => (r.acoes_autonomas || []).map((s) => ({ ...s, agente: r.agente })));
  const aprovacoes = relatos.flatMap((r) => r.aprovacoes_pendentes || []);
  const custo_eur_e4 = relatos.reduce((n, r) => n + (r.custo?.eur_e4 || 0), 0);

  const decisoes = achados.map((a) => {
    let decisao, fila;
    switch (a.autonomia) {
      case 'autonomo': case 'autonomo_com_log': decisao = 'em curso — agente executa e registra'; fila = 'em_curso'; break;
      case 'requer_aprovacao_orquestrador': decisao = `MAESTRO decide: ${a.acao_proposta}`; fila = 'maestro'; break;
      default: decisao = `precisa de você: ${a.acao_proposta}`; fila = 'fundador';
    }
    return { ...a, decisao, fila };
  });
  const paraFundador = decisoes.filter((d) => d.fila === 'fundador');
  const criticos = decisoes.filter((d) => d.severidade === 'critica');

  // Manchete determinística: o pior item + o melhor sinal.
  const pior = decisoes[0];
  const melhor = sinais.find((s) => Number(s.valor) > 0);
  const manchete = pior ? `${pior.severidade.toUpperCase()}: ${pior.titulo}` : 'Nenhum achado acima de "info" neste ciclo';

  return {
    ts: new Date().toISOString(), trace_id: opts.trace || null, modo: opts.modo || 'diario',
    manchete, melhor_sinal: melhor || null,
    contagens: { relatos: relatos.length, cegos: cegos.length, achados: achados.length, criticos: criticos.length, para_fundador: paraFundador.length, aprovacoes_pendentes: aprovacoes.length },
    decisoes, para_fundador: paraFundador, criticos, sinais, experiencia, autonomas, aprovacoes, cobertura, cegos, custo_eur_e4,
    kpis: Object.fromEntries(relatos.map((r) => [r.agente, r.kpis])),
  };
}

module.exports = { consolidar, SEV };
