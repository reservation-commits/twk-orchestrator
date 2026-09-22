#!/usr/bin/env node
'use strict';
/**
 * Reparos executáveis — o braço de ação da Sentinela de Silêncio.
 *
 * Ideia (ADR-017): o fundador aprova um PROCEDIMENTO uma vez; daí em diante o orquestrador o
 * executa sozinho toda vez que o achado correspondente aparecer, com auditoria. É o que
 * transforma "o orquestrador sabe que quebrou" em "o orquestrador consertou".
 *
 * Só entram aqui reparos determinísticos e sem efeito externo (nada que envie mensagem,
 * nada que escreva no banco). O primeiro: rerodar uma tarefa agendada do Windows que não
 * deixou log no dia. O registro de aprovação é `reparos-aprovados.json` — tudo nasce
 * desligado (false).
 *
 *   node reparar.js            → mostra o que faria (dry-run)
 *   node reparar.js --apply    → executa os reparos APROVADOS no registro
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const RAIZ = path.resolve(__dirname, '..', '..', '..');
const LOGS = path.join(RAIZ, 'orchestrator', 'logs');
const REGISTRO = path.join(__dirname, 'reparos-aprovados.json');
const hoje = () => new Date().toISOString().slice(0, 10);
const audit = (o) => { try { fs.mkdirSync(LOGS, { recursive: true }); fs.appendFileSync(path.join(LOGS, `audit-${hoje()}.jsonl`), JSON.stringify({ ts: new Date().toISOString(), trace_id: `trc-silencio-${hoje().replace(/-/g, '')}`, agente: 'sentinela-silencio', ...o }) + '\n'); } catch {} };

const apply = process.argv.includes('--apply');
const aprovados = JSON.parse(fs.readFileSync(REGISTRO, 'utf8'));

// 1. pergunta à sentinela o que está em silêncio
let saida;
try {
  saida = JSON.parse(execFileSync(process.execPath, [path.join(__dirname, 'verificar.js'), '--json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
} catch (e) {
  // sai 1 quando há crítico — o JSON continua no stdout
  try { saida = JSON.parse(e.stdout); } catch { console.error('sentinela falhou:', (e.stderr || e.message).slice(0, 300)); process.exit(2); }
}

const REPAROS = {
  rerodar_tarefa_agendada: {
    aplica: (a) => !!a.tarefa,
    descricao: (a) => `Start-ScheduledTask "${a.tarefa}"`,
    executar: (a) => {
      // Start-ScheduledTask dispara a tarefa já registrada (mesmo comando, mesmo log). Se ela
      // não existir nesta máquina, o erro é explícito — nunca "ok" silencioso.
      execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', `Start-ScheduledTask -TaskName '${a.tarefa.replace(/'/g, "''")}' -ErrorAction Stop`], { stdio: 'pipe' });
    },
  },
};

let feitos = 0, pendentes = 0;
for (const a of saida.achados) {
  for (const [nome, r] of Object.entries(REPAROS)) {
    if (!r.aplica(a)) continue;
    const aprovado = aprovados[nome] === true;
    console.log(`${aprovado ? (apply ? 'EXECUTAR' : 'faria') : 'NÃO APROVADO'} · ${nome} · ${a.titulo} → ${r.descricao(a)}`);
    if (!aprovado) { pendentes++; continue; }
    if (!apply) continue;
    try {
      r.executar(a);
      feitos++;
      audit({ evento: 'reparo_executado', reparo: nome, achado: a.chave, detalhe: r.descricao(a) });
    } catch (e) {
      audit({ evento: 'reparo_falhou', reparo: nome, achado: a.chave, erro: String(e.stderr || e.message).slice(0, 300) });
      console.error(`  falhou: ${String(e.stderr || e.message).slice(0, 200)}`);
    }
  }
}
console.log(`\n${apply ? 'executados' : 'a executar'}: ${feitos}${apply ? '' : ' (dry-run)'} · sem aprovação no registro: ${pendentes}`);
if (pendentes) console.log(`aprovar: edite ${path.relative(RAIZ, REGISTRO)} e mude o reparo para true (uma vez; vale daí em diante).`);
