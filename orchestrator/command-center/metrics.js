/**
 * MAESTRO — Memória de métricas (Fase 0 do vigia de desempenho).
 *
 * Grava cada coleta de KPIs da frota em state/metrics/metrics-YYYY-MM-DD.jsonl
 * (uma linha por coleta, todos os agentes juntos). Sem série histórica não existe
 * "desempenho" — existe foto. Este módulo é o filme: é ele que permite ao vigia
 * dizer "publicados caíram 39%" em vez de descobrir 5 semanas depois.
 */
const fs = require('node:fs');
const path = require('node:path');

const dir = (stateDir) => path.join(stateDir, 'metrics');

function record(stateDir, kpisById) {
  const at = new Date().toISOString();
  try {
    fs.mkdirSync(dir(stateDir), { recursive: true });
    fs.appendFileSync(
      path.join(dir(stateDir), `metrics-${at.slice(0, 10)}.jsonl`),
      JSON.stringify({ at, kpis: kpisById }) + '\n', 'utf8'
    );
  } catch { /* disco indisponível aparece no /health (write-probe); a coleta não derruba o servidor */ }
  return at;
}

/** Últimos N dias de snapshots, em ordem cronológica (inclui o de hoje). */
function readSeries(stateDir, days = 7) {
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
    try {
      const txt = fs.readFileSync(path.join(dir(stateDir), `metrics-${d}.jsonl`), 'utf8');
      for (const ln of txt.split(/\r?\n/)) {
        if (!ln) continue;
        try { out.push(JSON.parse(ln)); } catch {}
      }
    } catch {}
  }
  return out;
}

/** Um snapshot por dia (o último de cada dia) — resumo compacto para o analista. */
function dailySeries(stateDir, days = 7) {
  const byDay = new Map();
  for (const s of readSeries(stateDir, days)) byDay.set(s.at.slice(0, 10), s);
  return [...byDay.values()];
}

function daysAvailable(stateDir) {
  try { return fs.readdirSync(dir(stateDir)).filter((f) => f.startsWith('metrics-')).length; }
  catch { return 0; }
}

module.exports = { record, readSeries, dailySeries, daysAvailable };
