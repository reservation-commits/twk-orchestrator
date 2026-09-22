/**
 * MAESTRO — Vigia determinístico de desempenho (Fase 1) + fila de Ações.
 *
 * Compara cada coleta com a série histórica e gera ACHADOS com evidência numérica
 * em state/acoes.jsonl. Regras da casa:
 *   - nunca inventa número: métrica ausente (null) é pulada, não tratada como zero;
 *   - o vigia DETECTA e PROPÕE — quem aprova a correção é humano (página Ações);
 *   - achado cuja condição normalizou é fechado como "resolvida" com carimbo, não some.
 *
 * Custo de IA desta fase: zero. É comparação de números — e teria pego a queda
 * de 985 publicados de julho/2026 no dia 1, não na semana 5.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const file = (stateDir) => path.join(stateDir, 'acoes.jsonl');
const SEV = { critica: 3, alta: 2, media: 1 };

// ---------------------------------------------------------------- fila de ações
function readActions(stateDir) {
  try {
    return fs.readFileSync(file(stateDir), 'utf8').split(/\r?\n/).filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}
function writeActions(stateDir, items) {
  try {
    fs.writeFileSync(file(stateDir), items.map((i) => JSON.stringify(i)).join('\n') + (items.length ? '\n' : ''), 'utf8');
  } catch {}
}
function appendAudit(stateDir, ev) {
  try {
    const d = new Date().toISOString();
    const ldir = path.join(stateDir, 'logs');
    fs.mkdirSync(ldir, { recursive: true });
    fs.appendFileSync(path.join(ldir, `audit-${d.slice(0, 10)}.jsonl`), JSON.stringify({ ts: d, ...ev }) + '\n', 'utf8');
  } catch {}
}

/** Cria ou atualiza um achado. Dedup por (agente, regra) enquanto aberto/adiado. */
function upsert(stateDir, finding) {
  const items = readActions(stateDir);
  const now = new Date().toISOString();
  const open = items.find((a) => a.agente === finding.agente && a.regra === finding.regra &&
    (a.status === 'aberta' || a.status === 'adiada'));
  if (open) {
    open.atualizado_em = now;
    open.ocorrencias = (open.ocorrencias || 1) + 1;
    open.detalhe = finding.detalhe;
    open.evidencia = finding.evidencia;
    if (finding.recomendacao) open.recomendacao = finding.recomendacao;
    if ((SEV[finding.severidade] || 0) > (SEV[open.severidade] || 0)) open.severidade = finding.severidade;
    writeActions(stateDir, items);
    return open;
  }
  const item = {
    id: 'AC-' + now.replace(/[-:TZ.]/g, '').slice(0, 14) + '-' + crypto.randomBytes(2).toString('hex'),
    status: 'aberta', criado_em: now, atualizado_em: now, ocorrencias: 1,
    ...finding,
  };
  items.push(item);
  writeActions(stateDir, items);
  appendAudit(stateDir, { evento: 'acao_criada', acao_id: item.id, agente: item.agente, regra: item.regra, severidade: item.severidade, origem: item.origem });
  return item;
}

/**
 * Fecha achados do VIGIA cuja condição não disparou nesta coleta (normalizou).
 * Regra de honestidade: só se o agente foi de fato LIDO (status 'ok') nesta coleta —
 * vigia cego (sem URL, sem credencial, erro) não dá alta a ninguém: sem dado não é
 * "normalizou", é "não sei", e o achado permanece aberto.
 */
function resolveStale(stateDir, firedKeys, visibleAgents) {
  const items = readActions(stateDir);
  let changed = 0;
  const now = new Date().toISOString();
  for (const a of items) {
    if (a.origem === 'vigia' && a.status === 'aberta' &&
        visibleAgents.has(a.agente) && !firedKeys.has(a.agente + '|' + a.regra)) {
      a.status = 'resolvida'; a.resolvido_em = now; a.atualizado_em = now;
      a.nota = 'condição normalizou na coleta seguinte';
      appendAudit(stateDir, { evento: 'acao_resolvida', acao_id: a.id, agente: a.agente, regra: a.regra });
      changed++;
    }
  }
  if (changed) writeActions(stateDir, items);
  return changed;
}

// ---------------------------------------------------------------- sentinelas
const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const pct = (antes, depois) => (antes ? Math.round(((depois - antes) / antes) * 1000) / 10 : null);

/** Valores anteriores (exclui o snapshot atual, que é o último da série). */
function prior(series, agent, getter) {
  const vals = [];
  for (const s of series.slice(0, -1)) {
    const v = getter((s.kpis || {})[agent] || {});
    if (v !== null) vals.push(v);
  }
  return vals;
}
const last = (arr) => (arr.length ? arr[arr.length - 1] : null);
const max = (arr) => (arr.length ? Math.max(...arr) : null);
const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);

/**
 * Roda todas as sentinelas sobre a coleta atual + série dos últimos dias.
 * Retorna { geradas, resolvidas }.
 */
function run(stateDir, kpisById, series) {
  const findings = [];
  const add = (agente, regra, severidade, titulo, detalhe, evidencia) =>
    findings.push({ origem: 'vigia', agente, regra, severidade, titulo, detalhe, evidencia });

  // --- coleta quebrada (qualquer agente): 401/404/erro persistente é achado, não silêncio
  for (const [id, k] of Object.entries(kpisById || {})) {
    if (!k) continue;
    if (k.status === 'sem_credencial' || k.status === 'sem_endpoint' || k.status === 'erro') {
      add(id, 'colheita_falhou', 'alta',
        'Central sem leitura dos KPIs deste agente',
        `A coleta respondeu "${k.status}"${k.erro ? ' · ' + k.erro : ''}${k.detalhe ? ' · ' + k.detalhe : ''}. Sem leitura, o vigia deste agente está cego.`,
        [{ metrica: 'status da coleta', antes: 'ok', depois: k.status }]);
    }
  }

  // --- DBA: catálogo é infraestrutura crítica
  const dba = (kpisById || {}).dba;
  if (dba && dba.status === 'ok') {
    const pub = num(dba.publicados);
    const pubPrior = prior(series, 'dba', (x) => num(x.publicados));
    const ref = max(pubPrior.slice(-14));
    if (pub !== null && ref !== null && pub < ref * 0.98) {
      const queda = pct(ref, pub);
      add('dba', 'queda_publicados', pub < ref * 0.9 ? 'critica' : 'alta',
        'Queda no número de restaurantes publicados',
        `Publicados caíram de ${ref} para ${pub} (${queda}%). Lição de julho/2026: queda de publicados sem alerta custou 5 semanas de cegueira. Verificar jobs de despublicação e notificar Comercial + Editorial (published é evento de negócio).`,
        [{ metrica: 'publicados', antes: ref, depois: pub, variacao_pct: queda }]);
    }
    const tot = num(dba.total);
    const totPrior = prior(series, 'dba', (x) => num(x.total));
    const totRef = max(totPrior.slice(-14));
    if (tot !== null && totRef !== null && tot < totRef * 0.98) {
      add('dba', 'queda_catalogo', 'alta',
        'Catálogo total encolheu',
        `Total de estabelecimentos caiu de ${totRef} para ${tot} (${pct(totRef, tot)}%). Encolhimento de catálogo sem decisão registrada é anomalia.`,
        [{ metrica: 'catálogo total', antes: totRef, depois: tot, variacao_pct: pct(totRef, tot) }]);
    }
    const sf = num(dba.semFoto);
    const sfPrev = last(prior(series, 'dba', (x) => num(x.semFoto)));
    if (sf !== null && sfPrev !== null && sf > sfPrev * 1.15 && sf - sfPrev >= 20) {
      add('dba', 'limbo_fotos_crescendo', 'media',
        'Fila de páginas sem foto de capa está crescendo',
        `Sem foto: ${sfPrev} → ${sf}. A esteira de fotos é o gargalo que mantém páginas fora do ar; se cresce, a política (fallback de foto vs. despublicado) precisa de decisão.`,
        [{ metrica: 'sem foto de capa', antes: sfPrev, depois: sf, variacao_pct: pct(sfPrev, sf) }]);
    }
  }

  // --- CLAVIS: demanda ignorada é a métrica que mata o negócio
  const com = (kpisById || {}).comercial;
  if (com && com.status === 'ok') {
    const pend = num(com.reservasPendentes);
    const pendPrior = prior(series, 'comercial', (x) => num(x.reservasPendentes));
    const base = avg(pendPrior.slice(-14));
    if (pend !== null && base !== null && pendPrior.length >= 3 && pend > base * 1.15 && pend - base >= 10) {
      add('comercial', 'pendentes_acumulando', 'alta',
        'Reservas sem resposta estão acumulando acima do padrão',
        `Pendentes: média recente ${Math.round(base)} → agora ${pend}. Cada pendente é um hóspede esperando na porta. Checar nudge de 6h (Aria) e fulfillment dos parceiros.`,
        [{ metrica: 'reservas pendentes', antes: Math.round(base), depois: pend, variacao_pct: pct(base, pend) }]);
    }
    if (com.orcamento && num(com.orcamento.dailyLimit)) {
      const spent = num(com.orcamento.spentToday) || 0;
      const lim = num(com.orcamento.dailyLimit);
      if (spent / lim >= 0.85) {
        add('comercial', 'orcamento_ia_no_limite', 'alta',
          'Orçamento diário de IA do CLAVIS perto do teto',
          `Consumo do dia: ${spent} de ${lim} tokens (${Math.round((spent / lim) * 100)}%). No teto, o agente para de analisar — decidir entre subir o teto ou reduzir o escopo do dia.`,
          [{ metrica: 'tokens (dia)', antes: lim, depois: spent, variacao_pct: Math.round((spent / lim) * 100) }]);
      }
    }
    const props = num(com.propostasPendentes);
    const propsPrev = last(prior(series, 'comercial', (x) => num(x.propostasPendentes)));
    if (props !== null && props >= 1 && propsPrev !== null && propsPrev >= 1) {
      add('comercial', 'portao_parado', 'media',
        'Propostas paradas no Portão de Aprovação',
        `${props} proposta(s) do CLAVIS aguardando decisão humana há mais de uma coleta. Portão parado = funil parado.`,
        [{ metrica: 'propostas no portão', antes: propsPrev, depois: props }]);
    }
  }

  // --- Quill: custo, worker e fila editorial
  const edi = (kpisById || {}).editorial;
  if (edi && edi.status === 'ok') {
    if (edi.workerOnline === false) {
      add('editorial', 'worker_offline', 'critica',
        'Worker editorial do Quill está offline',
        'Sem worker, nenhuma página é produzida — a esteira editorial inteira está parada. Reiniciar o serviço e investigar a causa.',
        [{ metrica: 'worker', antes: 'online', depois: 'offline' }]);
    }
    const custo = num(edi.custoHojeUsd);
    const cap = num(edi.capDiarioUsd);
    if (custo !== null && cap && custo / cap >= 0.8) {
      add('editorial', 'custo_editorial_no_cap', 'alta',
        'Custo de geração do Quill se aproximando do cap diário',
        `USD ${custo} de ${cap} (${Math.round((custo / cap) * 100)}%). No cap, a produção para no meio do dia.`,
        [{ metrica: 'custo do dia (USD)', antes: cap, depois: custo, variacao_pct: Math.round((custo / cap) * 100) }]);
    }
    const gsc = num(edi.gscAtrasoDias);
    if (gsc !== null && gsc > 3) {
      add('editorial', 'gsc_atrasado', 'media',
        'Ingestão do Google Search Console atrasada',
        `Dados do GSC com ${gsc} dias de atraso. As decisões de SEO estão sendo tomadas sobre números velhos.`,
        [{ metrica: 'atraso GSC (dias)', antes: 3, depois: gsc }]);
    }
    const fila = num(edi.filaAguardando);
    const filaPrior = prior(series, 'editorial', (x) => num(x.filaAguardando)).slice(-3);
    if (fila !== null && fila >= 20 && filaPrior.length >= 3 && filaPrior.every((v) => v === fila)) {
      add('editorial', 'fila_revisao_parada', 'media',
        'Fila de revisão editorial parada',
        `${fila} fichas aguardando revisão humana, sem movimento nas últimas coletas. Trabalho pronto apodrecendo na fila.`,
        [{ metrica: 'fila aguardando revisão', antes: fila, depois: fila }]);
    }
  }

  // --- Atlas: saúde financeira e propostas envelhecendo
  const fin = (kpisById || {}).financeiro;
  if (fin && fin.status === 'ok') {
    const hs = num(fin.healthScore);
    if (hs !== null && hs < 70) {
      add('financeiro', 'saude_financeira_baixa', 'alta',
        'Health score financeiro abaixo de 70',
        `Score ${hs}/100. Fatores no painel do Atlas — reconciliação, webhooks ou aging podem estar degradados.`,
        [{ metrica: 'health score', antes: 70, depois: hs }]);
    }
    const props = num(fin.propostasPendentes);
    const propsPrev = last(prior(series, 'financeiro', (x) => num(x.propostasPendentes)));
    if (props !== null && props >= 1 && propsPrev !== null && propsPrev >= 1) {
      add('financeiro', 'propostas_financeiras_paradas', 'media',
        'Propostas financeiras aguardando decisão humana',
        `${props} proposta(s) do Atlas paradas há mais de uma coleta. Propostas expiram em 72h — decidir antes que caduquem.`,
        [{ metrica: 'propostas pendentes', antes: propsPrev, depois: props }]);
    }
  }

  // --- Aria: experiência do cliente
  const sup = (kpisById || {}).suporte;
  if (sup && sup.status === 'ok') {
    const esc = num(sup.escalacoesAbertas);
    if (esc !== null && esc >= 5) {
      add('suporte', 'escalacoes_acumulando', 'alta',
        'Escalações abertas acumulando no suporte',
        `${esc} escalações abertas. Cliente premium esperando resposta humana é a promessa da marca quebrando em tempo real.`,
        [{ metrica: 'escalações abertas', antes: 5, depois: esc }]);
    }
    const csat = num(sup.csatPlataforma);
    if (csat !== null && csat > 0 && csat < 4) {
      add('suporte', 'csat_baixo', 'alta',
        'CSAT da plataforma abaixo de 4/5',
        `CSAT ${csat}/5. Investigar as últimas avaliações negativas e o padrão por trás delas.`,
        [{ metrica: 'CSAT plataforma', antes: 4, depois: csat }]);
    }
    const lat = num(sup.latenciaFerramentaMs);
    if (lat !== null && lat > 5000) {
      add('suporte', 'latencia_ferramentas', 'media',
        'Ferramentas da Aria lentas',
        `Latência média das ferramentas hoje: ${lat} ms. Acima de 5s por chamada, a conversa no WhatsApp trava.`,
        [{ metrica: 'latência média (ms)', antes: 5000, depois: lat }]);
    }
  }

  // --- aplica: upsert dos disparos + auto-resolução do que normalizou
  const fired = new Set(findings.map((f) => f.agente + '|' + f.regra));
  // Agentes visíveis nesta coleta: só quem respondeu 'ok' pode ter achado auto-resolvido.
  const visible = new Set(Object.entries(kpisById || {})
    .filter(([, k]) => k && k.status === 'ok').map(([id]) => id));
  for (const f of findings) upsert(stateDir, f);
  const resolvidas = resolveStale(stateDir, fired, visible);
  return { geradas: findings.length, resolvidas };
}

module.exports = { run, readActions, writeActions, upsert, appendAudit };
