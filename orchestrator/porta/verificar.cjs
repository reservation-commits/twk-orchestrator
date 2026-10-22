#!/usr/bin/env node
/**
 * Porta de Qualidade da frota — um comando, um veredito.
 *
 *   node orchestrator/porta/verificar.cjs            # tudo (≈ 3–5 min)
 *   node orchestrator/porta/verificar.cjs --rapido   # sem a suíte dos hooks (PowerShell, ~35 s)
 *   node orchestrator/porta/verificar.cjs --diario   # pula Quill/Atlas se não mudaram desde a última porta verde (plano D)
 *   node orchestrator/porta/verificar.cjs --so aria  # só um agente (aria | clavis | atlas | quill | dba | hooks | evals)
 *
 * Por que existe (22/09/2026): cada agente tinha typecheck, testes e evals — 760 checagens
 * verdes — e NADA rodava tudo junto. Quatro ferramentas da Aria ficaram 100% quebradas por
 * semanas sem que uma porta única acusasse. Esta porta roda cada etapa, grava o resultado em
 * `orchestrator/state/porta-qualidade.json` (a Sentinela lê) e num relatório diário em
 * `orchestrator/logs/porta/AAAA-MM-DD.md`, e sai com código 1 se qualquer etapa ficou vermelha.
 * Regra da constituição: checagem que não rodou é finding — etapa que não existe ou não
 * conseguiu iniciar conta como VERMELHA, nunca como "ok".
 */
"use strict";
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const RAIZ = path.resolve(__dirname, "..", "..");
const args = process.argv.slice(2);
const rapido = args.includes("--rapido");
const so = args.includes("--so") ? args[args.indexOf("--so") + 1] : null;
// Plano D (2026-10-22): --diario pula as etapas CONGELÁVEIS (Quill, Atlas — sem commit desde 24/09) quando o
// repositório delas não mudou desde a última porta verde. Rodar 32 k linhas paradas a cada porta custa 5 min
// e atenção; o modo completo (sem --diario) continua sendo o da semana e o de antes de qualquer push.
const diario = args.includes("--diario");

const ETAPAS = [
  { chave: "aria", nome: "Aria — typecheck + testes", dir: "Agente de Suporte e Concierge", cmds: ["npx tsc --noEmit", "npm test"] },
  { chave: "clavis", nome: "CLAVIS — typecheck + testes", dir: "Agente Comercial/service", cmds: ["npx tsc --noEmit", "npm test"] },
  { chave: "atlas", nome: "Atlas — typecheck + testes", dir: "Agente Financeiro", cmds: ["npx tsc --noEmit", "npx vitest run"], congelavel: true },
  { chave: "quill", nome: "Quill — testes (shared + jobs)", dir: "Agente Editorial", cmds: ["npm test"], congelavel: true },
  { chave: "dba", nome: "TWK DB Architect — testes", dir: "Agente Gerenciador do Banco de Dados/twk-db-agent", cmds: ["npm test"] },
  { chave: "regencia", nome: "Regência — testes do Despacho (pull, alerta, dívidas)", dir: "orchestrator/command-center", cmds: ["node --test regencia/test/despacho.test.js"] },
  { chave: "evals", nome: "Orquestrador — evals (10 suítes)", dir: ".", cmds: ["node orchestrator/evals/run.js"] },
  { chave: "auditor", nome: "Auditor Interno — travas dos ADRs no código", dir: ".", cmds: ["node orchestrator/auditor/verificar.js"] },
  { chave: "hooks", nome: "Guardrails — hooks (15 casos)", dir: ".", cmds: ['powershell -NoProfile -ExecutionPolicy Bypass -File "orchestrator/tests/test-guards.ps1"'], lento: true },
];

function rodar(cmd, cwd) {
  const t0 = Date.now();
  const r = spawnSync(cmd, { cwd, shell: true, encoding: "utf8", timeout: 15 * 60_000, maxBuffer: 64 * 1024 * 1024 });
  const saida = `${r.stdout || ""}\n${r.stderr || ""}`;
  return { ok: r.status === 0, ms: Date.now() - t0, status: r.status, saida };
}

// Extrai um número útil da saída (quantos testes passaram), só para o relatório.
function contar(saida) {
  const m = saida.match(/ℹ pass (\d+)/) || saida.match(/Tests\s+(\d+) passed/) || saida.match(/Todos os (\d+) casos/);
  if (m) return Number(m[1]);
  const evals = [...saida.matchAll(/hard (\d+)\/(\d+)/g)];
  if (evals.length) return evals.reduce((a, e) => a + Number(e[1]), 0);
  return null;
}

// Congelado = congelável, em --diario, e sem commit nem mudança local desde a última porta verde.
function mudouDesde(dir, iso) {
  try {
    const log = spawnSync("git", ["log", "-1", "--format=%cI"], { cwd: dir, encoding: "utf8" });
    const st = spawnSync("git", ["status", "--porcelain"], { cwd: dir, encoding: "utf8" });
    const ultimo = (log.stdout || "").trim();
    if (log.status !== 0 || !ultimo) return true; // sem git legível: não se assume congelado
    return Date.parse(ultimo) > Date.parse(iso) || (st.stdout || "").trim().length > 0;
  } catch { return true; }
}
const ultimaVerde = (() => { try { const j = JSON.parse(fs.readFileSync(path.join(RAIZ, "orchestrator/state/porta-qualidade.json"), "utf8")); return j.verde ? j.rodou_em : null; } catch { return null; } })();
const congelados = diario && ultimaVerde ? ETAPAS.filter((e) => e.congelavel && !mudouDesde(path.join(RAIZ, e.dir), ultimaVerde)).map((e) => e.chave) : [];
const selecionadas = ETAPAS.filter((e) => (!so || e.chave === so) && !(rapido && e.lento) && !congelados.includes(e.chave));
if (congelados.length) console.log(`congeladas (sem mudança desde a última porta verde em ${ultimaVerde.slice(0, 16)}): ${congelados.join(", ")}`);
if (selecionadas.length === 0) {
  console.error(`etapa desconhecida: ${so}. Válidas: ${ETAPAS.map((e) => e.chave).join(", ")}`);
  process.exit(2);
}

const inicio = new Date();
const resultados = [];
for (const e of selecionadas) {
  const cwd = path.join(RAIZ, e.dir);
  process.stdout.write(`▶ ${e.nome} … `);
  if (!fs.existsSync(cwd)) {
    resultados.push({ chave: e.chave, nome: e.nome, ok: false, ms: 0, detalhe: "pasta não existe" });
    console.log("VERMELHO (pasta não existe)");
    continue;
  }
  let ok = true, ms = 0, detalhe = "", passaram = 0;
  for (const cmd of e.cmds) {
    const r = rodar(cmd, cwd);
    ms += r.ms;
    const n = contar(r.saida);
    if (n) passaram += n;
    if (!r.ok) {
      ok = false;
      const linhas = r.saida.split(/\r?\n/).filter((l) => /not ok|✖|error|FAIL|REPROVADO|Error/.test(l)).slice(0, 8);
      detalhe = `\`${cmd}\` saiu com ${r.status}` + (linhas.length ? `\n${linhas.map((l) => "      " + l.trim().slice(0, 160)).join("\n")}` : "");
      break;
    }
  }
  resultados.push({ chave: e.chave, nome: e.nome, ok, ms, passaram, detalhe });
  console.log(ok ? `verde (${passaram || "?"} ok, ${(ms / 1000).toFixed(0)}s)` : `VERMELHO (${(ms / 1000).toFixed(0)}s)`);
}

const verde = resultados.every((r) => r.ok);
const puladas = ETAPAS.filter((e) => !selecionadas.includes(e)).map((e) => e.chave);
const totalOk = resultados.reduce((a, r) => a + (r.passaram || 0), 0);

// Estado (a Sentinela e o Zelador leem) — só quando a porta rodou INTEIRA, sem --so.
const estado = {
  rodou_em: inicio.toISOString(),
  duracao_s: Math.round((Date.now() - inicio.getTime()) / 1000),
  verde,
  completa: !so,
  modo: so ? "so" : diario ? "diario" : rapido ? "rapido" : "completa",
  puladas,
  congeladas: congelados,
  checagens_ok: totalOk,
  etapas: resultados.map(({ chave, ok, ms, passaram }) => ({ chave, ok, s: Math.round(ms / 1000), passaram })),
};
fs.mkdirSync(path.join(RAIZ, "orchestrator/state"), { recursive: true });
if (!so) fs.writeFileSync(path.join(RAIZ, "orchestrator/state/porta-qualidade.json"), JSON.stringify(estado, null, 2) + "\n");

// Relatório diário (append: várias rodadas no mesmo dia ficam no mesmo arquivo).
const dia = inicio.toISOString().slice(0, 10);
const logDir = path.join(RAIZ, "orchestrator/logs/porta");
fs.mkdirSync(logDir, { recursive: true });
const md =
  `## ${inicio.toISOString().replace("T", " ").slice(0, 16)} UTC — ${verde ? "VERDE" : "VERMELHO"}` +
  (so ? ` (só ${so})` : "") + (puladas.length && !so ? ` (puladas: ${puladas.join(", ")})` : "") + "\n\n" +
  "| Etapa | Resultado | Checagens | Tempo |\n|---|---|---|---|\n" +
  resultados.map((r) => `| ${r.nome} | ${r.ok ? "verde" : "**VERMELHO**"} | ${r.passaram || "—"} | ${(r.ms / 1000).toFixed(0)}s |`).join("\n") +
  "\n" +
  resultados.filter((r) => !r.ok).map((r) => `\n**${r.nome}:** ${r.detalhe}\n`).join("") +
  "\n";
fs.appendFileSync(path.join(logDir, `${dia}.md`), md);

console.log(`\n${verde ? "PORTA VERDE" : "PORTA VERMELHA"} — ${totalOk} checagens ok em ${estado.duracao_s}s` + (puladas.length ? ` (puladas: ${puladas.join(", ")})` : ""));
console.log(`relatório: orchestrator/logs/porta/${dia}.md`);
process.exit(verde ? 0 : 1);
