'use strict';
/**
 * Zelador de Ações — a Central se limpa sozinha (ADR-021, 23/11/2026).
 *
 * Em 23/11 a Central tinha 103 ações abertas e 19 aprovações pendentes; 95 ações eram o analista repetindo o mesmo tema
 * por semanas e as 19 aprovações eram cartões do Guardião de outubro com mesa já passada. Ninguém olha fila que só cresce.
 * Este módulo faz, todo dia e sob demanda, a triagem que foi feita à mão naquele dia, com as mesmas regras e o mesmo
 * registro (motivo em cada item, evento `zelador_acoes` no audit). Ele NUNCA aprova nada: aprovar vira envio ou handoff,
 * e isso continua sendo decisão de gente. Ele só fecha o que já não faz sentido continuar aberto.
 *
 * Regras (todas devolvem motivo auditável):
 *   A1  aprovação pendente do Guardião "Degrau 4 — avisar cliente … (mesa em Nh)" cuja mesa já passou        → negada
 *   A2  aprovação pendente "Degrau 1 — lote de e-mails" com mais de 48 h                                    → negada (ADR-019: o degrau 1 roda sozinho)
 *   B1  ação do analista repetida (mesmo agente, mesmo tema) → fica a mais recente, as outras               → descartadas
 *   B2  ação do analista sem atualização há ESTAGNADA_DIAS (21)                                              → descartada (o analista reabre se persistir)
 *   C   ações de vigia (origem 'vigia') não são tocadas: `resolveStale` já as resolve quando o sinal some
 *
 * Idempotente: rodar duas vezes não muda nada na segunda. `planejar` é pura (recebe listas, devolve decisões) e é o que
 * os testes cobrem; `aplicar` grava. O analista usa `temaParecido` para não abrir ação nova de tema já aberto.
 */
const fs = require('node:fs');
const path = require('node:path');
const sentinels = require('./sentinels.js');

const ESTAGNADA_DIAS = Number(process.env.ZELADOR_ESTAGNADA_DIAS || 21);
const LOTE_HORAS = 48;

// ---------------------------------------------------------------- semelhança de tema
const PARADAS = new Set(['para', 'com', 'sem', 'dos', 'das', 'por', 'uma', 'que', 'nos', 'nas', 'não', 'nao', 'mais', 'antes', 'depois', 'entre', 'todos', 'todas', 'ainda', 'seguidos', 'consecutivos', 'dias', 'dia', 'hoje', 'the', 'and', 'ate', 'até', 'desde', 'apenas', 'cada', 'qualquer', 'este', 'esta', 'esse', 'essa', 'está', 'esta', 'são', 'sao', 'ser', 'ter', 'foi', 'sem', 'via', 'num', 'numa']);
/** Palavras-chave do título: minúsculas, sem acento, sem números soltos e sem palavras vazias. */
function termos(titulo) {
  return new Set(String(titulo || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9_]+/g, ' ').split(' ').filter((w) => w.length >= 4 && !PARADAS.has(w) && !/^\d+$/.test(w)));
}
/** Jaccard entre os termos de dois títulos (0..1). */
function semelhanca(a, b) {
  const ta = termos(a), tb = termos(b); if (!ta.size || !tb.size) return 0;
  let inter = 0; for (const w of ta) if (tb.has(w)) inter++;
  return inter / (ta.size + tb.size - inter);
}
/** A ação aberta mais parecida (mesmo agente) com `titulo`, se a semelhança passar de `minimo`. */
function temaParecido(titulo, agente, abertas, minimo = 0.45) {
  let melhor = null, nota = 0;
  for (const a of abertas) {
    if (a.agente !== agente || (a.status !== 'aberta' && a.status !== 'adiada')) continue;
    const s = semelhanca(titulo, a.titulo);
    if (s > nota) { nota = s; melhor = a; }
  }
  return nota >= minimo ? { acao: melhor, semelhanca: Number(nota.toFixed(2)) } : null;
}

// ---------------------------------------------------------------- o plano
function mesaDe(aprovacao) {
  const m = /mesa em (\d+)h/i.exec(String(aprovacao.titulo || ''));
  if (!m || !aprovacao.criado_em) return null;
  return Date.parse(aprovacao.criado_em) + Number(m[1]) * 3_600_000;
}
const iso = (ms) => new Date(ms).toISOString();

/**
 * @param {{acoes: object[], aprovacoes: object[], agora?: number}} p
 * @returns {{decisoes: object[], resumo: object}}
 */
function planejar({ acoes = [], aprovacoes = [], agora = Date.now() }) {
  const decisoes = [];
  const hoje = iso(agora).slice(0, 10);

  // A — aprovações
  for (const a of aprovacoes) {
    if (a.status !== 'pendente') continue;
    const t = String(a.titulo || '');
    const mesa = mesaDe(a);
    if (mesa != null && /degrau 4/i.test(t)) {
      if (mesa < agora) decisoes.push({ regra: 'A1', alvo: 'aprovacao', id: a.id, decisao: 'negar', motivo: `Zelador: a mesa era em ${iso(mesa).slice(0, 10)} e já passou; avisar agora seria tarde. Cartão expirado em ${hoje} (ADR-021).` });
      continue;
    }
    if (/degrau 1/i.test(t) && /lote/i.test(t) && a.criado_em && agora - Date.parse(a.criado_em) > LOTE_HORAS * 3_600_000) {
      decisoes.push({ regra: 'A2', alvo: 'aprovacao', id: a.id, decisao: 'negar', motivo: `Zelador: lote do degrau 1 de ${String(a.criado_em).slice(0, 10)} com mais de ${LOTE_HORAS} h; as pendências venceram e o degrau 1 roda sozinho desde o ADR-019. Reenviar duplicaria cobrança (ADR-021).` });
    }
  }

  // B — ações do analista
  const abertas = acoes.filter((x) => (x.status === 'aberta' || x.status === 'adiada') && x.origem === 'analista');
  const porAgente = {};
  for (const x of abertas) (porAgente[x.agente] ||= []).push(x);
  const descartadas = new Set();
  for (const lista of Object.values(porAgente)) {
    const ord = [...lista].sort((p, q) => (String(p.atualizado_em) < String(q.atualizado_em) ? 1 : -1)); // mais recente primeiro
    const mantidas = [];
    for (const x of ord) {
      const dona = mantidas.find((m) => semelhanca(x.titulo, m.titulo) >= 0.45);
      if (dona) {
        descartadas.add(x.id);
        decisoes.push({ regra: 'B1', alvo: 'acao', id: x.id, decisao: 'descartar', motivo: `Zelador: mesmo tema já aberto em ${dona.id} (${String(dona.atualizado_em).slice(0, 10)}); a leitura mais recente fica, esta é repetição (ADR-021).`, mantida: dona.id });
      } else mantidas.push(x);
    }
    for (const x of mantidas) {
      const idade = (agora - Date.parse(x.atualizado_em || x.criado_em)) / 86_400_000;
      if (idade > ESTAGNADA_DIAS) decisoes.push({ regra: 'B2', alvo: 'acao', id: x.id, decisao: 'descartar', motivo: `Zelador: sem atualização há ${Math.floor(idade)} dias (limite ${ESTAGNADA_DIAS}); se o problema persistir o analista reabre com dados novos (ADR-021).` });
    }
  }

  const resumo = { aprovacoes_negadas: decisoes.filter((d) => d.alvo === 'aprovacao').length, acoes_descartadas: decisoes.filter((d) => d.alvo === 'acao').length, repetidas: decisoes.filter((d) => d.regra === 'B1').length, estagnadas: decisoes.filter((d) => d.regra === 'B2').length };
  return { decisoes, resumo };
}

// ---------------------------------------------------------------- aplicar
const aprFile = (S) => path.join(S, 'aprovacoes.jsonl');
function lerAprovacoes(S) { try { return fs.readFileSync(aprFile(S), 'utf8').split(/\r?\n/).filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; } }
function gravarAprovacoes(S, items) { fs.writeFileSync(aprFile(S), items.map((i) => JSON.stringify(i)).join('\n') + (items.length ? '\n' : ''), 'utf8'); }
const estadoFile = (S) => path.join(S, 'zelador-acoes.json');

/** Planeja e grava. Devolve o resumo com o que mudou. `ensaio: true` só planeja. */
function aplicar(stateDir, { agora = Date.now(), ensaio = false } = {}) {
  const acoes = sentinels.readActions(stateDir);
  const aprovacoes = lerAprovacoes(stateDir);
  const { decisoes, resumo } = planejar({ acoes, aprovacoes, agora });
  const em = iso(agora);
  if (!ensaio && decisoes.length) {
    for (const d of decisoes) {
      if (d.alvo === 'aprovacao') {
        const a = aprovacoes.find((x) => x.id === d.id); if (!a || a.status !== 'pendente') continue;
        a.status = 'negada'; a.decidido_em = em; a.motivo = d.motivo; a.decidido_por = 'zelador';
      } else {
        const a = acoes.find((x) => x.id === d.id); if (!a || (a.status !== 'aberta' && a.status !== 'adiada')) continue;
        a.status = 'descartada'; a.motivo_descarte = d.motivo; a.descartada_por = 'zelador'; a.atualizado_em = em; if (d.mantida) a.mantida_em = d.mantida;
      }
      sentinels.appendAudit(stateDir, { evento: 'zelador_acoes', regra: d.regra, alvo: d.alvo, id: d.id, decisao: d.decisao, motivo: d.motivo, mantida: d.mantida });
    }
    sentinels.writeActions(stateDir, acoes);
    gravarAprovacoes(stateDir, aprovacoes);
  }
  const estado = { em, ensaio, ...resumo, decisoes: decisoes.map((d) => ({ regra: d.regra, alvo: d.alvo, id: d.id, mantida: d.mantida })) };
  if (!ensaio) { try { fs.writeFileSync(estadoFile(stateDir), JSON.stringify(estado, null, 1), 'utf8'); } catch { /* disco */ } }
  return estado;
}
function ultimo(stateDir) { try { return JSON.parse(fs.readFileSync(estadoFile(stateDir), 'utf8')); } catch { return null; } }

module.exports = { planejar, aplicar, ultimo, temaParecido, semelhanca, termos, ESTAGNADA_DIAS, LOTE_HORAS };
