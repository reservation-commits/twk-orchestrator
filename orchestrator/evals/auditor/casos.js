'use strict';
/** Eval do Auditor Interno: estrutura, fail-closed e que as checagens hard passam neste repositório. */
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const { executarChecagens, CHECAGENS } = require('../../auditor/verificar');
const EXP = (cond, msg) => (cond ? [] : [msg]);

const casos = [
  { nome: 'toda checagem tem id, sev hard|soft, regra e run', run: () => CHECAGENS.flatMap((c) => EXP(c.id && ['hard', 'soft'].includes(c.sev) && c.regra && typeof c.run === 'function', `checagem malformada: ${c.id}`)) },
  { nome: 'ids únicos', run: () => EXP(new Set(CHECAGENS.map((c) => c.id)).size === CHECAGENS.length, 'id repetido') },
  { nome: 'em raiz vazia nada passa e nada lança (fail-closed)', run: () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'auditor-')); const res = executarChecagens(dir); return [...EXP(res.length === CHECAGENS.length, 'faltou checagem'), ...EXP(res.every((r) => r.ok === false), `passou em raiz vazia: ${res.filter((r) => r.ok).map((r) => r.id).join(',')}`), ...EXP(res.every((r) => typeof r.detalhe === 'string' && r.detalhe.length > 0), 'reprovação sem detalhe')]; } },
  { nome: 'neste repositório todas as checagens hard passam', run: () => { const res = executarChecagens(); return res.filter((r) => r.sev === 'hard' && !r.ok).map((r) => `${r.id}: ${r.detalhe}`); } },
  { nome: 'checagens soft reprovadas são listadas (dívida, não bloqueio)', sev: 'soft', run: () => executarChecagens().filter((r) => r.sev === 'soft' && !r.ok).map((r) => `${r.id}: ${r.detalhe}`) },
];
module.exports = { casos };
