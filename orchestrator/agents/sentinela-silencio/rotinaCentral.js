'use strict';
/**
 * Rotinas hospedadas da Central como fonte da Sentinela (levantamento 27/10/2026).
 *
 * Desde 22/10 Guardião, Ciclo, Retenção, Sentinela e Zelador rodam dentro da Central (rotinas.js), e as
 * cinco tarefas do Windows foram desabilitadas de propósito. A Sentinela continuava lendo os logs do
 * notebook e acusava "tarefa morta" todo dia — falso positivo — enquanto a retenção falhava de verdade
 * no container sem ninguém ver. Agora a fonte é o estado que a própria Central grava (`rotinas.json`):
 *   - hospedada (TWK_STATE_ROOT): lê o arquivo direto do volume;
 *   - local: GET <CENTER_URL>/api/rotinas com X-Center-Key (~/.twk/central.env).
 *
 * `avaliar()` é pura (testável); `carregar()` é a única que toca disco ou rede.
 */
const fs = require('node:fs');
const path = require('node:path');

const H = 3_600_000;

/** Carrega CENTER_URL/CENTER_TOKEN de ~/.twk/central.env sem sobrescrever o ambiente. */
function envCentral() {
  const f = path.join(process.env.USERPROFILE || process.env.HOME || '', '.twk', 'central.env');
  try {
    for (const l of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
      const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
    }
  } catch { /* sem arquivo: só o ambiente */ }
  return { url: (process.env.CENTER_URL || '').replace(/\/$/, ''), token: process.env.CENTER_TOKEN || '' };
}

/** Última rodada das rotinas ({dia, rodou_em, ok, jobs:[{job, ok, exit, modo, log, erro, tentativas}]}) ou null. */
async function carregar({ hospedado = process.env.TWK_STATE_ROOT ? path.resolve(process.env.TWK_STATE_ROOT) : null, fetchImpl = globalThis.fetch } = {}) {
  if (hospedado) {
    const f = path.join(hospedado, 'rotinas.json');
    if (!fs.existsSync(f)) return { origem: f, ultima: null };
    return { origem: f, ultima: JSON.parse(fs.readFileSync(f, 'utf8')) };
  }
  const { url, token } = envCentral();
  if (!url || !token) throw new Error('CENTER_URL/CENTER_TOKEN ausentes (~/.twk/central.env)');
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const r = await fetchImpl(`${url}/api/rotinas`, { headers: { 'X-Center-Key': token }, signal: ctrl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    return { origem: `${url}/api/rotinas`, ultima: j.ultima || null };
  } finally { clearTimeout(t); }
}

/**
 * Avalia uma cadência `rotina_central` contra a última rodada.
 * Devolve { tipo: 'ok'|'achado'|'lacuna', texto, evidencia?, acao? }.
 */
function avaliar(f, ultima, agora = new Date()) {
  if (!ultima) return { tipo: 'lacuna', texto: `${f.chave}: a Central ainda não rodou as rotinas (sem rotinas.json)` };
  const quando = ultima.rodou_em ? new Date(ultima.rodou_em) : ultima.dia ? new Date(`${ultima.dia}T09:00:00+01:00`) : null;
  if (!quando || Number.isNaN(quando.getTime())) return { tipo: 'lacuna', texto: `${f.chave}: rodada sem data legível` };
  const horas = (agora - quando) / H;
  if (horas > f.tolerancia_horas) {
    return { tipo: 'achado', evidencia: `última rodada das rotinas da Central em ${ultima.dia || quando.toISOString().slice(0, 10)} há ${horas.toFixed(0)}h (tolerância ${f.tolerancia_horas}h)`, acao: 'ler /health.rotinas da Central (ROTINAS_ENABLED? container no ar?) e disparar POST /api/rotinas/run' };
  }
  const j = (ultima.jobs || []).find((x) => x && x.job === f.job);
  if (!j) return { tipo: 'lacuna', texto: `${f.chave}: job "${f.job}" não aparece na última rodada (${(ultima.jobs || []).map((x) => x.job).join(', ') || 'nenhum'})` };
  if (j.ok === false) {
    const erro = String(j.erro || 'sem saída').slice(0, 200);
    return { tipo: 'achado', evidencia: `rotina "${f.job}" FALHOU em ${ultima.dia} (${j.tentativas || 1} tentativa(s), exit ${j.exit}): ${erro}`, acao: f.acao || `ler o log ${j.log || ''} no volume da Central, corrigir e disparar POST /api/rotinas/run {"so":"${f.job}"}` };
  }
  return { tipo: 'ok', texto: `${f.chave}: rotina "${f.job}" ok em ${ultima.dia}${j.modo ? ` (${j.modo})` : ''}${j.achados_criticos ? ' · com achado crítico no relato' : ''}` };
}

module.exports = { carregar, avaliar, envCentral };
