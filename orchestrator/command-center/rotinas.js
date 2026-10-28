'use strict';
/**
 * Rotinas hospedadas (plano A1, 2026-10-22) — os agentes locais rodam DENTRO da Central, todo dia, sem notebook.
 *
 * POR QUE EXISTE
 * Até 21/10 o Guardião, o Ciclo do Cliente, a Sentinela e o Zelador só rodavam como tarefas agendadas do
 * Windows num notebook de 4 GB: morreram por falta de memória (0xC000013A, 24/09) e por "timeout expired"
 * ao ligar antes do Wi-Fi (19 e 20/10); os vigias ficaram quatro semanas calados. Aqui, o mesmo código
 * (copiado para a imagem pelo Dockerfile: /app/agents) roda num cron interno, grava no VOLUME e deixa o
 * mesmo rastro que as tarefas do Windows deixavam (logs/tarefas/<job>-<YYYYMMDD>.log), para a Sentinela
 * continuar lendo a mesma cadência.
 *
 * LIGAR: ROTINAS_ENABLED=on · ROTINAS_HORA=9 (hora local Europe/Paris, padrão 9) · DATABASE_URL_RO (twk_ro)
 *        CICLO_APROVACAO="<frase do fundador>" → o Ciclo do Cliente envia (sem ela: dry-run, nada sai)
 *        GUARDIAO_CANARIO="Paris,Athens,Marrakech" · GUARDIAO_MAX_EMAILS=20 → o portão do Guardião (nunca envia:
 *        só registra o lote em aprovacoes.jsonl; o envio exige run.js --apply --aprovacao <APR-id>)
 *        EMAIL_WEBHOOK_URL/EMAIL_WEBHOOK_TOKEN já existem para o Despacho — o Ciclo usa os mesmos.
 *
 * O QUE RODA, EM SEQUÊNCIA (cada job é um processo filho, com TWK_STATE_ROOT=STATE_DIR):
 *   1. guardiao-reserva  run.js --gate [--canario … --max-emails N]
 *   2. ciclo-cliente     run.js [--apply --aprovacao "…"]
 *   3. sentinela-silencio verificar.js --relato
 *   4. zelador-privilegios verificar.js --relato
 * Nova tentativa em falha transitória (saída ≠ 0 com "timeout"/rede no log): 3 vezes (0, 10 min, 30 min),
 * além das 3 tentativas de conexão internas de cada agente. Falhou nas 3: Ação "rotina_falhou" na Central.
 * Depois dos jobs: os relatos da Sentinela e do Zelador vão para STATE_DIR/relatos/<dia>/ (formato da Regência)
 * e o instantâneo do Guardião é exportado para STATE_DIR/guardiao-sincronizado.json — o mesmo arquivo que o
 * push-state.ps1 mandaria, agora gerado no lugar (A3: uma origem para cada número).
 *
 * Estado: STATE_DIR/rotinas.json (última rodada, por job) — o /health mostra; /api/rotinas/run dispara à mão.
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const STATE_DIR = path.resolve(process.env.STATE_DIR || path.join(__dirname, 'state'));
const AGENTS_DIR = path.resolve(process.env.TWK_AGENTS_DIR || path.join(__dirname, '..', 'agents'));
const HORA = Number(process.env.ROTINAS_HORA || 9);
const ESPERAS_MS = (process.env.ROTINAS_RETRY_MS || '0,600000,1800000').split(',').map((x) => Number(x.trim())).filter((x) => Number.isFinite(x) && x >= 0);
const LIMITE_JOB_MS = Number(process.env.ROTINAS_JOB_TIMEOUT_MS || 20 * 60_000);

let sentinels = null; try { sentinels = require('./sentinels.js'); } catch { /* sem fila de ações */ }
let guardiaoAdaptador = null; try { guardiaoAdaptador = require('./guardiao.js'); } catch { /* sem adaptador */ }

const hojeIso = () => new Date().toISOString().slice(0, 10);
const diaCompacto = () => hojeIso().replace(/-/g, '');
const horaParis = () => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', hour: '2-digit', hour12: false }).format(new Date()));
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

function enabled() { return (process.env.ROTINAS_ENABLED || 'off') === 'on'; }

function jobs() {
  // ADR-019 (2026-10-28): com GUARDIAO_AUTONOMO=on e o canal de e-mail, o degrau 1 sai sozinho (--apply --autonomo);
  // sem isso, continua no portão (cartão de aprovação na Central).
  const emailOk = (process.env.N8N_MAESTRO_EMAIL_URL || process.env.EMAIL_WEBHOOK_URL) && (process.env.N8N_MAESTRO_EMAIL_TOKEN || process.env.EMAIL_WEBHOOK_TOKEN);
  const guardiaoArgs = process.env.GUARDIAO_AUTONOMO === 'on' && emailOk ? ['--apply', '--autonomo'] : ['--gate'];
  if (process.env.GUARDIAO_CANARIO) guardiaoArgs.push('--canario', process.env.GUARDIAO_CANARIO);
  if (process.env.GUARDIAO_MAX_EMAILS) guardiaoArgs.push('--max-emails', String(process.env.GUARDIAO_MAX_EMAILS));
  const cicloArgs = [];
  if (process.env.CICLO_APROVACAO && process.env.CICLO_APROVACAO.length >= 10) cicloArgs.push('--apply', '--aprovacao', process.env.CICLO_APROVACAO);
  return [
    { job: 'guardiao-gate', script: path.join(AGENTS_DIR, 'guardiao-reserva', 'run.js'), args: guardiaoArgs },
    { job: 'ciclo-cliente', script: path.join(AGENTS_DIR, 'ciclo-cliente', 'run.js'), args: cicloArgs },
    // ADR-018: pedidos de remoção — carta de retenção, decisão da casa ou prazo de 48 h, exclusão autônoma.
    // Só age de verdade com o canal de e-mail (EMAIL_WEBHOOK_URL) e a porta única (TWK_DBA_URL); sem eles, dry-run.
    { job: 'retencao', script: path.join(AGENTS_DIR, 'maestro-atendimento', 'retencao-run.js'), args: process.env.EMAIL_WEBHOOK_URL && process.env.TWK_DBA_URL ? ['--apply'] : [] },
    { job: 'sentinela', script: path.join(AGENTS_DIR, 'sentinela-silencio', 'verificar.js'), args: ['--relato'], relato: ['sentinela-silencio', 'sentinela-silencio.json'] },
    { job: 'zelador', script: path.join(AGENTS_DIR, 'zelador-privilegios', 'verificar.js'), args: ['--relato'], relato: ['zelador-privilegios', 'zelador-privilegios.json'] },
  ];
}

const transitorio = (saida) => /timeout|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH|ENETUNREACH|conexão read-only falhou|Connection terminated/i.test(saida);

function rodarUmaVez(j, logFile) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const env = { ...process.env, TWK_STATE_ROOT: STATE_DIR };
    const p = spawn(process.execPath, [j.script, ...j.args], { cwd: AGENTS_DIR, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let saida = '';
    const colher = (d) => { const s = String(d); saida += s; try { fs.appendFileSync(logFile, s, 'utf8'); } catch { /* disco */ } };
    p.stdout.on('data', colher); p.stderr.on('data', colher);
    const limite = setTimeout(() => { try { p.kill('SIGKILL'); } catch { /* já saiu */ } colher(`\n[rotinas] ${j.job}: limite de ${Math.round(LIMITE_JOB_MS / 60000)} min atingido — processo encerrado\n`); }, LIMITE_JOB_MS);
    p.on('error', (e) => { clearTimeout(limite); colher(`\n[rotinas] ${j.job}: não iniciou (${e.message})\n`); resolve({ ok: false, exit: null, ms: Date.now() - t0, saida }); });
    p.on('close', (code) => { clearTimeout(limite); resolve({ ok: code === 0, exit: code, ms: Date.now() - t0, saida }); });
  });
}

async function rodarJob(j) {
  const logDir = path.join(STATE_DIR, 'logs', 'tarefas');
  fs.mkdirSync(logDir, { recursive: true });
  const logFile = path.join(logDir, `${j.job}-${diaCompacto()}.log`);
  let ultimo = null;
  for (let i = 0; i < ESPERAS_MS.length; i++) {
    if (ESPERAS_MS[i] > 0) await dormir(ESPERAS_MS[i]);
    fs.appendFileSync(logFile, `\n=== ${new Date().toISOString()} · ${j.job} · tentativa ${i + 1}/${ESPERAS_MS.length} · ${path.basename(j.script)} ${j.args.join(' ')}\n`, 'utf8');
    ultimo = await rodarUmaVez(j, logFile);
    // `modo` diz se o job agiu de verdade ou só ensaiou — visível no /health e em GET /api/rotinas, sem abrir o log do container.
    if (ultimo.ok) return { job: j.job, ok: true, exit: 0, ms: ultimo.ms, tentativas: i + 1, modo: j.relato ? 'vigia' : j.args.includes('--apply') ? 'real' : j.args.includes('--gate') ? 'portao' : 'ensaio', log: path.relative(STATE_DIR, logFile) };
    // Vigias (Sentinela, Zelador) saem com 1 quando há achado CRÍTICO — o relato foi gravado; isso é
    // sinal, não falha da rotina. Falha de verdade é 2+ (exceção) ou processo que não iniciou.
    if (j.relato && ultimo.exit === 1) return { job: j.job, ok: true, exit: 1, achados_criticos: true, ms: ultimo.ms, tentativas: i + 1, log: path.relative(STATE_DIR, logFile) };
    if (!transitorio(ultimo.saida)) break; // erro de lógica: repetir não ajuda, e o log diz o porquê
  }
  return { job: j.job, ok: false, exit: ultimo ? ultimo.exit : null, ms: ultimo ? ultimo.ms : 0, tentativas: Math.min(ESPERAS_MS.length, 3), log: path.relative(STATE_DIR, logFile), erro: (ultimo ? ultimo.saida : '').split(/\r?\n/).filter(Boolean).slice(-3).join(' | ').slice(0, 300) };
}

/** Relatos da Sentinela e do Zelador no formato da Regência (STATE_DIR/relatos/<dia>/<agente>.json). */
function publicarRelato(j) {
  if (!j.relato) return;
  const [pasta, nome] = j.relato;
  const origem = path.join(STATE_DIR, 'agents', pasta, `relato-${hojeIso()}.json`);
  if (!fs.existsSync(origem)) return;
  const destino = path.join(STATE_DIR, 'relatos', hojeIso(), nome);
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  fs.copyFileSync(origem, destino);
}

/** Instantâneo do Guardião no lugar do push-state (A3). */
function exportarGuardiao() {
  if (!guardiaoAdaptador || typeof guardiaoAdaptador.exportar !== 'function') return false;
  try {
    const p = guardiaoAdaptador.exportar();
    if (!p) return false;
    fs.writeFileSync(path.join(STATE_DIR, guardiaoAdaptador.ARQ_SINC || 'guardiao-sincronizado.json'), JSON.stringify(p), 'utf8');
    return true;
  } catch { return false; }
}

let rodando = false;
async function executar(opts = {}) {
  if (rodando) return { ok: false, erro: 'já em execução' };
  rodando = true;
  const t0 = Date.now();
  const resultados = [];
  try {
    for (const j of jobs()) {
      if (opts.so && opts.so !== j.job) continue;
      const r = await rodarJob(j);
      resultados.push(r);
      try { publicarRelato(j); } catch { /* relato opcional */ }
      if (!r.ok && sentinels) {
        try { sentinels.upsert(STATE_DIR, { origem: 'vigia', agente: 'orquestrador', regra: `rotina_falhou.${j.job}`, severidade: j.job === 'guardiao-gate' || j.job === 'ciclo-cliente' ? 'critica' : 'alta', titulo: `Rotina hospedada "${j.job}" falhou ${r.tentativas} vez(es)`, detalhe: `${r.erro || 'sem saída'} · log: ${r.log}`, evidencia: [{ metrica: 'exit', antes: '', depois: String(r.exit) }] }); } catch { /* fila indisponível */ }
      }
    }
    const guardiaoExportado = exportarGuardiao();
    const estado = { dia: hojeIso(), rodou_em: new Date(t0).toISOString(), duracao_s: Math.round((Date.now() - t0) / 1000), ok: resultados.every((r) => r.ok), jobs: resultados, guardiao_exportado: guardiaoExportado };
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(path.join(STATE_DIR, 'rotinas.json'), JSON.stringify(estado, null, 1), 'utf8');
    return estado;
  } finally { rodando = false; }
}

function estado() {
  try { return JSON.parse(fs.readFileSync(path.join(STATE_DIR, 'rotinas.json'), 'utf8')); } catch { return null; }
}

/** Resumo para o /health: ligado? última rodada? tudo verde? */
function saude() {
  if (!enabled()) return { ligado: false, aviso: 'ROTINAS_ENABLED=off — Guardião, Ciclo, Sentinela e Zelador dependem das tarefas do Windows' };
  const e = estado();
  const agentes = fs.existsSync(AGENTS_DIR);
  if (!agentes) return { ligado: true, erro: `pasta de agentes ausente (${AGENTS_DIR}) — Dockerfile precisa copiar orchestrator/agents` };
  if (!e) return { ligado: true, hora_paris: HORA, ultima: null, aviso: 'ainda não rodou neste container' };
  return {
    ligado: true, hora_paris: HORA, ultima: e.dia, ok: e.ok,
    jobs: e.jobs.map((j) => `${j.job}:${j.ok ? 'ok' : 'FALHOU'}${j.modo ? ':' + j.modo : ''}`),
    guardiao_exportado: e.guardiao_exportado,
    // O que falta no ambiente para cada job agir de verdade (nomes de variáveis, nunca valores).
    faltam: [
      ...(process.env.CICLO_APROVACAO ? [] : ['CICLO_APROVACAO (Ciclo do Cliente em ensaio)']),
      ...(process.env.GUARDIAO_AUTONOMO === 'on' ? [] : ['GUARDIAO_AUTONOMO=on (Guardião só no portão — ADR-019)']),
      ...(process.env.EMAIL_WEBHOOK_URL ? [] : ['EMAIL_WEBHOOK_URL (retenção em ensaio)']),
      ...(process.env.TWK_DBA_URL ? [] : ['TWK_DBA_URL (retenção em ensaio)']),
      ...(process.env.DATABASE_URL_RO ? [] : ['DATABASE_URL_RO (nenhum job lê o banco)']),
    ],
  };
}

function start() {
  if (!enabled()) { console.log('[rotinas] desligadas (ROTINAS_ENABLED=off)'); return; }
  if (!fs.existsSync(AGENTS_DIR)) { console.error(`[rotinas] pasta de agentes ausente: ${AGENTS_DIR} — nada vai rodar`); return; }
  let ultimoDia = (estado() || {}).dia || null;
  setInterval(() => {
    if (horaParis() === HORA && ultimoDia !== hojeIso() && !rodando) {
      ultimoDia = hojeIso();
      executar().then((e) => console.log(`[rotinas] ${e.dia}: ${e.jobs.map((j) => `${j.job}=${j.ok ? 'ok' : 'FALHOU'}`).join(' · ')} · ${e.duracao_s}s`)).catch((err) => console.error('[rotinas]', String(err && err.message || err)));
    }
    // Falhar alto: 2 h depois da hora marcada sem rodada do dia → Ação na Central.
    if (horaParis() > HORA + 2 && (estado() || {}).dia !== hojeIso() && sentinels) {
      try { sentinels.upsert(STATE_DIR, { origem: 'vigia', agente: 'orquestrador', regra: 'rotinas_nao_rodaram', severidade: 'alta', titulo: 'Rotinas hospedadas de hoje não rodaram', detalhe: `ROTINAS_HORA=${HORA} (Paris); sem rotinas.json de ${hojeIso()}`, evidencia: [] }); } catch { /* fila */ }
    }
  }, 5 * 60_000).unref();
  console.log(`[rotinas] ligadas: Guardião (gate), Ciclo do Cliente${process.env.CICLO_APROVACAO ? ' (envio aprovado)' : ' (dry-run)'}, Sentinela e Zelador às ${HORA}h Paris · agentes em ${AGENTS_DIR}`);
}

module.exports = { start, executar, estado, saude, enabled, jobs, AGENTS_DIR };

if (require.main === module) {
  // Execução manual (local ou dentro do container): node rotinas.js [--so <job>]
  const i = process.argv.indexOf('--so');
  executar({ so: i >= 0 ? process.argv[i + 1] : null }).then((e) => { console.log(JSON.stringify(e, null, 1)); process.exitCode = e.ok ? 0 : 1; });
}
