#!/usr/bin/env node
'use strict';
/**
 * Regência — um ciclo completo: coletar (todos os agentes) → consolidar → despachar ao fundador.
 *
 *   node run.js                 → ciclo diário: relatos + Despacho na Central (despachos/ + Missões). NUNCA por e-mail.
 *   node run.js --modo horario  → ciclo curto: relatos + só item CRÍTICO novo (dedup por chave, REGENCIA_ALERTA_DEDUP_DIAS=7)
 *   node run.js --sem-email     → nem o alerta sai por e-mail
 *   node run.js --sem-executar  → não dispara o dry-run do Guardião (só lê o que existe)
 *
 * E-mail (decisão do fundador, 2026-09-24): desligado por padrão. MAESTRO_ALERTA_EMAIL=on manda um ALERTA curto
 * (só críticos novos, onde decidir), no máximo 1 por dia. MAESTRO_DESPACHO_EMAIL não vale mais.
 * Item que aparece há mais de REGENCIA_DIVIDA_DIAS (3) dias sai de "Urgente" e vai para "Esperando decisão".
 *
 * Também exportado como executar(opts) para o cron interno da Central (REGENCIA_ENABLED=on).
 * Saídas: STATE_DIR/relatos/<data>/<agente>.json · STATE_DIR/despachos/<data>[-HHMM].md
 *         STATE_DIR/missoes/D-<data>.md (aparece em Missões) · acoes.jsonl (críticos/altos, dedup) · logs/audit
 */
const fs = require('node:fs');
const path = require('node:path');

// Segredos da Regência FORA do OneDrive (runbook segredos-fora-do-onedrive.md):
// %USERPROFILE%\.twk\regencia.env — KEY=VALUE por linha. process.env sempre vence.
(function carregarEnv() {
  const f = process.env.TWK_REGENCIA_ENV || path.join(process.env.USERPROFILE || process.env.HOME || '', '.twk', 'regencia.env');
  try {
    for (const l of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
      const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^"|"$/g, '');
    }
  } catch { /* sem arquivo: segue com o ambiente */ }
})();

const { coletarTudo } = require('./coletores');
const { consolidar } = require('./consolidar');
const despacho = require('./despacho');
const historico = require('./historico');

const DEDUP_DIAS = Number(process.env.REGENCIA_ALERTA_DEDUP_DIAS || 7);

let sentinels = null; try { sentinels = require('../sentinels.js'); } catch {}
let email = null; try { email = require('../email.js'); } catch {}

const REPO = path.resolve(__dirname, '..', '..', '..');
const STATE_DIR = process.env.STATE_DIR || path.join(__dirname, '..', 'state');
const ORCH_LOGS = path.join(REPO, 'orchestrator', 'logs');

const hoje = () => new Date().toISOString().slice(0, 10);
const hhmm = () => new Date().toISOString().slice(11, 16).replace(':', '');
const appendJsonl = (f, o) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.appendFileSync(f, JSON.stringify(o) + '\n', 'utf8'); };
const lerJsonl = (f) => { try { return fs.readFileSync(f, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; } };

function audit(trace, o) {
  const ev = { ts: new Date().toISOString(), trace_id: trace, agente: 'maestro-regencia', ...o };
  appendJsonl(path.join(STATE_DIR, 'logs', `audit-${hoje()}.jsonl`), ev);
  if (fs.existsSync(ORCH_LOGS)) appendJsonl(path.join(ORCH_LOGS, `audit-${hoje()}.jsonl`), ev);
}

async function executar(opts = {}) {
  const modo = opts.modo || 'diario';
  const trace = `trc-regencia-${hoje().replace(/-/g, '')}${modo === 'horario' ? '-' + hhmm() : ''}`;
  const ctx = { trace, stateDir: STATE_DIR, kpis: opts.kpis || null, semExecutar: !!opts.semExecutar };
  const t0 = Date.now();

  // 1. coletar
  const relatos = await coletarTudo(ctx);
  const rdir = path.join(STATE_DIR, 'relatos', hoje());
  fs.mkdirSync(rdir, { recursive: true });
  for (const r of relatos) fs.writeFileSync(path.join(rdir, `${r.agente}${modo === 'horario' ? '-' + hhmm() : ''}.json`), JSON.stringify(r, null, 1), 'utf8');

  // 2. consolidar
  const est = consolidar(relatos, { trace, modo });
  fs.writeFileSync(path.join(rdir, `estado-do-sistema${modo === 'horario' ? '-' + hhmm() : ''}.json`), JSON.stringify(est, null, 1), 'utf8');

  // 3. achados críticos/altos → fila de Ações da Central (dedup por agente+regra enquanto abertos)
  let acoes = 0;
  if (sentinels) for (const d of est.decisoes.filter((x) => x.severidade === 'critica' || x.severidade === 'alta')) {
    try { sentinels.upsert(STATE_DIR, { origem: 'regencia', agente: d.agente, regra: d.chave || d.titulo.slice(0, 60), severidade: d.severidade, titulo: d.titulo.slice(0, 140), detalhe: `${d.acao_proposta} · evidência: ${d.evidencia}`.slice(0, 1000), evidencia: [{ metrica: 'fonte', antes: '', depois: d.fonte || d.agente }] }); acoes++; } catch {}
  }

  // 4. crítico NOVO = chave não alertada nos últimos REGENCIA_ALERTA_DEDUP_DIAS dias (padrão 7; era 24h até 2026-09-24)
  const alertasF = path.join(STATE_DIR, 'regencia-alertas.jsonl');
  const alertas = lerJsonl(alertasF);
  const vistos = historico.chavesVistas(alertas, Date.now(), DEDUP_DIAS);
  const novosCriticos = est.criticos.filter((c) => c.chave && !vistos.has(c.chave));

  // 5. despacho (diário sempre; horário só se houver crítico novo). Fica na Central (despachos/ + Missões) — pull.
  let resultado = { modo, trace, relatos: relatos.length, achados: est.contagens.achados, criticos: est.contagens.criticos, para_fundador: est.contagens.para_fundador, acoes_upsert: acoes, despacho: null, email: null, duracao_ms: 0 };
  const deveDespachar = modo === 'diario' || novosCriticos.length > 0;
  if (deveDespachar) {
    // memória curta: idade de cada item (novo × dívida) e o que saiu da lista desde o último Despacho
    const { idades, desde } = historico.calcularIdades(STATE_DIR, est, hoje());
    const resolvidos = historico.calcularResolvidos(STATE_DIR, est, hoje());
    const meta = { idades, desde, resolvidos, centralUrl: process.env.MAESTRO_CENTRAL_URL || '' };
    const g = await despacho.gerar(est, meta);
    const nome = `${hoje()}${modo === 'horario' ? '-' + hhmm() + '-alerta' : ''}`;
    const ddir = path.join(STATE_DIR, 'despachos'); fs.mkdirSync(ddir, { recursive: true });
    const f = path.join(ddir, `${nome}.md`);
    fs.writeFileSync(f, g.markdown, 'utf8');
    fs.mkdirSync(path.join(STATE_DIR, 'missoes'), { recursive: true });
    fs.writeFileSync(path.join(STATE_DIR, 'missoes', `D-${nome}.md`), g.markdown, 'utf8');
    resultado.despacho = f; resultado.modelo = g.modelo; resultado.custo_voz_e4 = g.custo_voz_e4;
    resultado.novos_criticos = novosCriticos.length; resultado.dividas = Object.values(idades).filter((n) => n > despacho.DIVIDA_DIAS).length; resultado.resolvidos = resolvidos.itens.length;

    // 6. e-mail — só como EXCEÇÃO (decisão do fundador, 2026-09-24): desligado por padrão (MAESTRO_ALERTA_EMAIL=on liga);
    //    só item crítico novo; corpo curto (alerta, não o Despacho); teto de 1 envio por dia. O Despacho nunca vai por e-mail.
    const para = process.env.MAESTRO_FOUNDER_EMAIL || '';
    const ligado = process.env.MAESTRO_ALERTA_EMAIL === 'on';
    const jaHoje = historico.emailEnviadoHoje(alertas, hoje());
    let enviadoEm = null;
    if (!opts.semEmail && ligado && email && para && novosCriticos.length && !jaHoje) {
      try {
        const assunto = `MAESTRO · Alerta ${hoje()} — ${novosCriticos[0].titulo.slice(0, 80)}`;
        const r = await email.enviar({ para, assunto, html: despacho.html(despacho.alerta(novosCriticos, meta)) });
        resultado.email = r;
        if (r.ok) enviadoEm = new Date().toISOString();
        audit(trace, { evento: 'alerta_email', para, ok: r.ok, provedor: r.provedor, detalhe: r.detalhe, itens: novosCriticos.map((c) => c.chave) });
      } catch (e) { resultado.email = { ok: false, detalhe: e.message }; }
    } else {
      resultado.email = { ok: false, detalhe: !ligado ? 'e-mail desligado (padrão desde 2026-09-24): Despacho só na Central; MAESTRO_ALERTA_EMAIL=on liga o alerta de crítico novo'
        : opts.semEmail ? '--sem-email' : !novosCriticos.length ? 'nenhum crítico novo — sem e-mail' : jaHoje ? 'teto de 1 e-mail por dia já usado' : !para ? 'MAESTRO_FOUNDER_EMAIL não definido' : 'sem provedor de e-mail configurado (EMAIL_WEBHOOK_URL)' };
    }
    novosCriticos.forEach((c) => appendJsonl(alertasF, { ts: new Date().toISOString(), chave: c.chave, titulo: c.titulo, trace, ...(enviadoEm ? { email_enviado_em: enviadoEm } : {}) }));
  }
  resultado.duracao_ms = Date.now() - t0;
  audit(trace, { evento: 'regencia_ciclo', ...resultado, email: resultado.email ? { ok: resultado.email.ok, detalhe: resultado.email.detalhe } : null });
  return { resultado, est };
}

if (require.main === module) {
  const a = process.argv.slice(2);
  const val = (n) => { const i = a.indexOf(n); return i >= 0 ? a[i + 1] : null; };
  executar({ modo: val('--modo') || 'diario', semEmail: a.includes('--sem-email'), semExecutar: a.includes('--sem-executar') })
    .then(({ resultado }) => { console.log(JSON.stringify(resultado, null, 1)); if (resultado.despacho) console.log('\n' + fs.readFileSync(resultado.despacho, 'utf8')); })
    .catch((e) => { console.error('REGÊNCIA FALHOU:', e.message); process.exit(1); });
}

module.exports = { executar, STATE_DIR };
