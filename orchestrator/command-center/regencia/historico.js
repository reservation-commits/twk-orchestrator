'use strict';
/**
 * Regência — memória curta do Despacho (2026-09-24, pedido do fundador: "os e-mails não têm utilidade").
 *
 * Funções puras sobre o estado já gravado em STATE_DIR/relatos/<dia>/estado-do-sistema*.json e em
 * STATE_DIR/regencia-alertas.jsonl. Sem banco, sem modelo. Servem para:
 *   - idade de cada item "precisa de você" (há quantos dias consecutivos aparece) → separa novo de dívida;
 *   - o que saiu da lista desde o último Despacho → seção "Resolvido";
 *   - dedup de alerta por N dias e teto de 1 e-mail por dia.
 * Regra de honestidade: dia sem estado gravado não conta como "sumiu" — é pulado.
 */
const fs = require('node:fs');
const path = require('node:path');

const DIA_MS = 86400000;
const RE_DIA = /^\d{4}-\d{2}-\d{2}$/;

function lerEstadoDoDia(stateDir, dia) {
  const dir = path.join(stateDir, 'relatos', dia);
  let nomes;
  try { nomes = fs.readdirSync(dir).filter((n) => /^estado-do-sistema.*\.json$/.test(n)).sort(); } catch { return null; }
  if (!nomes.length) return null;
  // O diário (sem sufixo) manda; sem ele, o último horário do dia.
  const nome = nomes.includes('estado-do-sistema.json') ? 'estado-do-sistema.json' : nomes[nomes.length - 1];
  try { return JSON.parse(fs.readFileSync(path.join(dir, nome), 'utf8')); } catch { return null; }
}

function diasAnteriores(stateDir, hoje, max = 30) {
  try {
    return fs.readdirSync(path.join(stateDir, 'relatos')).filter((d) => RE_DIA.test(d) && d < hoje).sort().reverse().slice(0, max);
  } catch { return []; }
}

const chavesFundador = (est) => new Set(((est && est.para_fundador) || []).map((d) => d.chave).filter(Boolean));
const diasEntre = (a, b) => Math.round((Date.parse(a) - Date.parse(b)) / DIA_MS);

/**
 * Para cada item de hoje com chave: há quantos dias consecutivos (com estado gravado) ele já aparecia.
 * 0 = apareceu hoje pela primeira vez. `desde` = primeiro dia da sequência.
 */
function calcularIdades(stateDir, est, hoje) {
  const idades = {}; const desde = {};
  let vivos = chavesFundador(est);
  for (const k of vivos) { idades[k] = 0; desde[k] = hoje; }
  for (const dia of diasAnteriores(stateDir, hoje)) {
    if (!vivos.size) break;
    const e = lerEstadoDoDia(stateDir, dia);
    if (!e) continue; // sem estado nesse dia: não sabemos, não interrompe a sequência
    const ch = chavesFundador(e);
    const ainda = new Set();
    for (const k of vivos) if (ch.has(k)) { idades[k] = diasEntre(hoje, dia); desde[k] = dia; ainda.add(k); }
    vivos = ainda;
  }
  return { idades, desde };
}

/** Itens que estavam no último Despacho gravado e não estão hoje. */
function calcularResolvidos(stateDir, est, hoje) {
  const hojeChaves = chavesFundador(est);
  for (const dia of diasAnteriores(stateDir, hoje)) {
    const e = lerEstadoDoDia(stateDir, dia);
    if (!e) continue;
    return { desde: dia, itens: (e.para_fundador || []).filter((d) => d.chave && !hojeChaves.has(d.chave)).map((d) => ({ chave: d.chave, titulo: d.titulo, agente: d.agente, severidade: d.severidade })) };
  }
  return { desde: null, itens: [] };
}

/** Chaves alertadas nos últimos `dias` dias (dedup do alerta crítico). */
function chavesVistas(alertas, agoraMs, dias) {
  return new Set(alertas.filter((a) => agoraMs - Date.parse(a.ts) < dias * DIA_MS).map((a) => a.chave));
}

/** Teto: no máximo um e-mail de alerta por dia (data ISO `hoje`, ex. 2026-09-24). */
function emailEnviadoHoje(alertas, hoje) {
  return alertas.some((a) => typeof a.email_enviado_em === 'string' && a.email_enviado_em.startsWith(hoje));
}

module.exports = { calcularIdades, calcularResolvidos, chavesVistas, emailEnviadoHoje, lerEstadoDoDia, diasAnteriores };
