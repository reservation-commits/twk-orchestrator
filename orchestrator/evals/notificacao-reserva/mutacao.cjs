'use strict';
/**
 * Teste de mutação da suíte `notificacao-reserva`.
 *
 * POR QUE EXISTE
 * Suíte de eval que só passa não prova nada — prova que ninguém a exercitou.
 * Este script estraga os textos de propósito, uma mutação por vez, e exige que
 * o eval REPROVE. Mutante sobrevivente = buraco na suíte, não texto aprovado.
 *
 * Restaura o arquivo original sempre, inclusive se o eval explodir no meio.
 *
 * USO:  node orchestrator/evals/notificacao-reserva/mutacao.cjs
 * Sai com 1 se algum mutante sobreviver.
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const RAIZ = path.resolve(__dirname, '../../..');
// Desde 2026-09-30 os textos vivem no documento v2 (o mesmo que vai para a Meta); o
// contrato (evento, params, bloqueio) continua em templates.js.
const ALVO = path.join(RAIZ, 'docs/notificacoes/templates-meta-v2-2026-09-30.md');
const CONTRATO = path.join(RAIZ, 'orchestrator/agents/notificacao-reserva/templates.js');
const GUARDA = path.join(RAIZ, 'Agente de Suporte e Concierge/dist/webhookAuth.js');

/**
 * Mutações na GUARDA do webhook, aplicadas no `dist` (é de lá que o eval
 * carrega, então não precisa rebuild). Se qualquer uma sobreviver, a suíte
 * está aprovando uma porta destrancada.
 */
const MUTACOES_GUARDA = [
  ['guarda: canal desligado passaria a liberar',
    'return "nao_configurado";',
    'return "ok";'],
  ['guarda: segredo errado passaria a liberar',
    'return "segredo_invalido";\n',
    'return "ok";\n'],
  ['guarda: comparação final sempre verdadeira',
    'return crypto.timingSafeEqual(a, b) ? "ok" : "segredo_invalido";',
    'return "ok";'],
];

/** [nome, trecho original, trecho mutado] — cada um viola uma regra do ADR-015. */
const MUTACOES = [
  ['promete prazo de 24h',
    'I will write to you here as soon as I have news',
    'I will write to you here within 24 hours'],
  ['promete disponibilidade',
    'If you would like us to look for another table for the same evening',
    'We guarantee you another table for the same evening'],
  ['vaza vocabulário interno',
    'we have received your request and are already taking care of it',
    'our internal workflow is processing the ticket'],
  ['relata ação em primeira pessoa',
    'There is nothing you need to do',
    'I escalated your request to the team'],
  ['remove o opt-out do rodapé',
    '| en | Reply STOP to stop receiving reservation updates. |',
    '| en | Thank you for choosing us. |'],
  ['afirma mesa num template que não confirma',
    'Hello {{1}}, your reservation has been cancelled.',
    'Hello {{1}}, your table at {{2}} is confirmed for {{3}}.'],
  ['quebra o contrato de placeholders',
    '> *Guests:* {{5}}',
    '> *Guests:* {{7}}'],
];

/** Mutação no contrato (templates.js), não no texto. */
const MUTACOES_CONTRATO = [
  ['desbloqueia o reagendamento sem fonte de dados',
    "bloqueado: 'sem fonte de dados",
    "desativado: 'sem fonte de dados"],
];

function rodarEval() {
  try {
    execFileSync('node', ['orchestrator/evals/run.js', 'notificacao-reserva'], {
      cwd: RAIZ, encoding: 'utf8', stdio: 'pipe',
    });
    return 'APROVADO';
  } catch {
    return 'REPROVADO';
  }
}

const linhas = [];
let sobreviventes = 0;
let naoAplicadas = 0;

const original = fs.readFileSync(ALVO, 'utf8');
const originalContrato = fs.readFileSync(CONTRATO, 'utf8');
const temGuarda = fs.existsSync(GUARDA);
const originalGuarda = temGuarda ? fs.readFileSync(GUARDA, 'utf8') : null;

function restaurar() {
  fs.writeFileSync(ALVO, original, 'utf8');
  fs.writeFileSync(CONTRATO, originalContrato, 'utf8');
  if (temGuarda) fs.writeFileSync(GUARDA, originalGuarda, 'utf8');
}

function rodarMutacoes(arquivo, conteudoOriginal, lista) {
  for (const [nome, de, para] of lista) {
    if (!conteudoOriginal.includes(de)) {
      linhas.push([false, 'NÃO APLICADA', `${nome} — trecho não encontrado, mutação desatualizada`]);
      naoAplicadas++;
      continue;
    }
    fs.writeFileSync(arquivo, conteudoOriginal.replace(de, para), 'utf8');
    const r = rodarEval();
    fs.writeFileSync(arquivo, conteudoOriginal, 'utf8');
    const pegou = r === 'REPROVADO';
    if (!pegou) sobreviventes++;
    linhas.push([pegou, r, nome]);
  }
}

try {
  const base = rodarEval();
  linhas.push([base === 'APROVADO', base, '(sem mutação — deve APROVAR)']);
  if (base !== 'APROVADO') sobreviventes++; // linha de base quebrada invalida tudo

  rodarMutacoes(ALVO, original, MUTACOES);
  rodarMutacoes(CONTRATO, originalContrato, MUTACOES_CONTRATO);

  if (!temGuarda) {
    linhas.push([false, 'NÃO APLICADA', 'guarda do webhook — dist ausente, rode "npm run build"']);
    naoAplicadas++;
  } else {
    rodarMutacoes(GUARDA, originalGuarda, MUTACOES_GUARDA);
  }
} finally {
  restaurar();
}

for (const [ok, r, nome] of linhas) {
  console.log(`${ok ? '  pegou ' : '  FALHOU'} · ${String(r).padEnd(12)} · ${nome}`);
}
console.log(`\nmutantes sobreviventes: ${sobreviventes} · mutações desatualizadas: ${naoAplicadas}`);
console.log(`arquivo restaurado: ${fs.readFileSync(ALVO, 'utf8') === original}`);

process.exit(sobreviventes > 0 || naoAplicadas > 0 ? 1 : 0);
