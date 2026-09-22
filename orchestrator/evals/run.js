#!/usr/bin/env node
'use strict';
/**
 * Harness comum de eval (ADR-011). Zero LLM, zero rede, zero banco.
 *   node orchestrator/evals/run.js            → todas as suítes
 *   node orchestrator/evals/run.js guardiao-reserva
 * Sai com 1 se alguma asserção `hard` falhar. Relatório em evals/relatorios/<data>-<suite>.md
 */
const fs = require('node:fs');
const path = require('node:path');

const SUITES = {
  'guardiao-reserva': './guardiao-reserva/casos.js',
  'registro-optout': './registro-optout/casos.js',
  'chave-girada': './chave-girada/casos.js',
  'notificacao-reserva': './notificacao-reserva/casos.js',
  'dba-escrita': './dba-escrita/casos.js',
  'central': './central/casos.js',
};
const alvo = process.argv[2];
const nomes = alvo ? [alvo] : Object.keys(SUITES);
let falhouHard = false;

// Casos podem ser síncronos ou `async` (a suíte `central` exercita funções que devolvem
// Promise). Sem o await, uma Promise teria `.length` undefined e TODO caso async passaria
// a reprovar — ou, pior, passar — por engano.
(async () => {
for (const nome of nomes) {
  if (!SUITES[nome]) { console.error(`suite desconhecida: ${nome}`); process.exit(2); }
  const { casos } = require(SUITES[nome]);
  const res = [];
  for (const c of casos) {
    try {
      const falhas = (await c.run()) || [];
      if (!Array.isArray(falhas)) throw new Error(`run() devolveu ${typeof falhas}, esperado array de falhas`);
      res.push({ nome: c.nome, sev: c.sev || 'hard', ok: falhas.length === 0, detalhe: falhas.join(' | ') });
    } catch (e) { res.push({ nome: c.nome, sev: c.sev || 'hard', ok: false, detalhe: `exceção: ${e.message}` }); }
  }
  const hard = res.filter((r) => r.sev === 'hard');
  const soft = res.filter((r) => r.sev === 'soft');
  const hardFail = hard.filter((r) => !r.ok).length;
  const softFail = soft.filter((r) => !r.ok).length;
  if (hardFail) falhouHard = true;
  const md = [`# Eval · ${nome} · ${new Date().toISOString()}`, '', `casos: ${res.length} · hard ${hard.length - hardFail}/${hard.length} · soft ${soft.length - softFail}/${soft.length} · **${hardFail ? 'REPROVADO' : 'APROVADO'}** para canário`, '', '| # | Caso | Sev | Resultado | Detalhe |', '|---|---|---|---|---|', ...res.map((r, i) => `| ${i + 1} | ${r.nome} | ${r.sev} | ${r.ok ? 'ok' : 'FALHOU'} | ${r.detalhe.replace(/\|/g, '/')} |`)].join('\n');
  const dir = path.join(__dirname, 'relatorios'); fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, `${new Date().toISOString().slice(0, 10)}-${nome}.md`);
  fs.writeFileSync(f, md, 'utf8');
  console.log(`[${nome}] ${res.length} casos · hard ${hard.length - hardFail}/${hard.length} · soft ${soft.length - softFail}/${soft.length} → ${hardFail ? 'REPROVADO' : 'APROVADO'} (${path.relative(process.cwd(), f)})`);
  res.filter((r) => !r.ok).forEach((r) => console.log(`   ✗ [${r.sev}] ${r.nome}: ${r.detalhe}`));
}
process.exit(falhouHard ? 1 : 0);
})().catch((e) => { console.error('harness falhou:', e.message); process.exit(2); });
