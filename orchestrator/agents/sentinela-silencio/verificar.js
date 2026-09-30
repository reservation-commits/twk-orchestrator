#!/usr/bin/env node
'use strict';
/**
 * Sentinela de Silêncio — o vigia de AUSÊNCIA.
 *
 * Os vigias existentes (sentinels.js, Regência) detectam erro e queda de número. Nenhum
 * detecta o que NÃO aconteceu: o outbound da Aria ficou inerte por meses com "[reminders]
 * ativo" no log; o ciclo-cliente morre com o notebook e o log do dia simplesmente não existe;
 * o pg_cron que expira pendências pode parar sem que nada acuse.
 *
 * Determinístico, zero LLM. Lê `cadencias.json` (o que deveria acontecer e com que
 * frequência), confere cada fonte — arquivo diário ou "última linha" no banco via twk_ro —
 * e emite achados no contrato do relato (ADR-012). Regra da casa: fonte que NUNCA teve dado
 * é lacuna declarada, não silêncio.
 *
 *   node verificar.js            → relatório; sai 1 se houver achado crítico
 *   node verificar.js --relato   → grava state/relato-<data>.json
 *   node verificar.js --json     → só o JSON dos achados (para reparar.js)
 */
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.resolve(__dirname, '..', '..', '..');
const STATE = path.join(__dirname, 'state');
const CAD = JSON.parse(fs.readFileSync(path.join(__dirname, 'cadencias.json'), 'utf8')).fontes;
const H = 3_600_000;
const agora = new Date();
const hoje = () => agora.toISOString().slice(0, 10);

function fmt(d, padrao) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), dd = String(d.getDate()).padStart(2, '0');
  return padrao.replace('{YYYYMMDD}', `${y}${m}${dd}`).replace('{YYYY-MM-DD}', `${y}-${m}-${dd}`);
}

/** Último dia (olhando até 60 dias para trás) em que o arquivo diário existiu. */
function ultimoArquivo(padrao) {
  for (let i = 0; i < 60; i++) {
    const d = new Date(agora.getTime() - i * 24 * H);
    const f = path.join(RAIZ, fmt(d, padrao));
    if (fs.existsSync(f)) { const st = fs.statSync(f); return { quando: st.mtime, arquivo: path.relative(RAIZ, f), diasAtras: i }; }
  }
  return null;
}

function urlRo() {
  const f = process.env.TWK_RO_ENV || path.join(RAIZ, 'Agente Gerenciador do Banco de Dados', 'twk-db-agent', '.env.readonly.local');
  const l = fs.readFileSync(f, 'utf8').split(/\r?\n/).find((x) => x.startsWith('DATABASE_URL_RO='));
  if (!l) throw new Error('DATABASE_URL_RO ausente em ' + f);
  return l.slice('DATABASE_URL_RO='.length).trim().replace(/^["']|["']$/g, '');
}

async function main() {
  const achados = [];
  const lacunas = [];
  const ok = [];
  const achado = (f, evidencia, acao) => achados.push({
    chave: `silencio.${f.chave}`, severidade: f.severidade, titulo: `silêncio: ${f.chave}`, evidencia, fonte: 'sentinela-silencio',
    acao_proposta: acao, autonomia: f.tarefa ? 'autonomo_com_log' : 'requer_aprovacao_humana', dono: f.tarefa ? 'orquestrador' : 'fundador',
    tarefa: f.tarefa || null,
  });

  // ── arquivos diários ──
  for (const f of CAD.filter((x) => x.tipo === 'arquivo_diario')) {
    const u = ultimoArquivo(f.padrao);
    if (!u) { lacunas.push(`${f.chave}: nenhum arquivo nos últimos 60 dias (nunca rodou aqui, ou o padrão mudou)`); continue; }
    const horas = (agora - u.quando) / H;
    if (horas > f.tolerancia_horas) achado(f, `último: ${u.arquivo} há ${horas.toFixed(0)}h (tolerância ${f.tolerancia_horas}h)`, f.tarefa ? `rerodar a tarefa agendada "${f.tarefa}" e ler o log` : 'verificar o processo que gera a fonte');
    else ok.push(`${f.chave}: há ${horas.toFixed(0)}h`);
  }

  // ── resultado das tarefas agendadas ──
  // O arquivo de log existir NÃO prova que a tarefa terminou bem: em 22/09/2026 as quatro
  // tarefas TWK morreram (0xC000013A, 0xC0000142, 0x1) e deixaram logs parciais que passavam
  // na checagem acima. Aqui lemos o código de saída registrado pelo Windows.
  if (process.platform === 'win32' && CAD.some((x) => x.tarefa)) {
    try {
      const ps = require('node:child_process').spawnSync('powershell', ['-NoProfile', '-Command',
        "Get-ScheduledTask | Where-Object { $_.TaskName -like 'TWK *' } | ForEach-Object { $i = $_ | Get-ScheduledTaskInfo; [pscustomobject]@{ n = $_.TaskName; r = $i.LastTaskResult; t = $i.LastRunTime.ToString('s') } } | ConvertTo-Json -Compress"],
        { encoding: 'utf8', timeout: 60_000 });
      const bruto = JSON.parse((ps.stdout || '').trim() || '[]');
      const lista = Array.isArray(bruto) ? bruto : [bruto];
      for (const f of CAD.filter((x) => x.tarefa)) {
        const t = lista.find((x) => x && x.n === f.tarefa);
        if (!t) { lacunas.push(`${f.chave}: tarefa "${f.tarefa}" não está registrada nesta máquina`); continue; }
        const codigo = Number(t.r) >>> 0;
        const hex = '0x' + codigo.toString(16).toUpperCase();
        if (codigo === 0 || codigo === 0x41301 /* em execução */ || codigo === 0x41303 /* nunca rodou */) { ok.push(`${f.chave}: tarefa terminou ${hex}`); continue; }
        const nome = codigo === 0xC000013A ? 'morta (falta de memória no notebook)' : codigo === 0xC0000142 ? 'não conseguiu iniciar' : 'terminou com erro';
        achado(f, `tarefa "${f.tarefa}" ${nome}: ${hex} em ${String(t.t).slice(0, 16)}`, `rerodar a tarefa "${f.tarefa}" e ler o log; solução definitiva: Regência hospedada (REGENCIA_ENABLED=on na Central)`);
      }
    } catch (e) { lacunas.push('tarefas agendadas: não consegui ler o resultado (' + e.message + ')'); }
  }

  // ── banco ──
  const { Client } = (() => { for (const p of [["Agente Gerenciador do Banco de Dados","twk-db-agent","node_modules","pg"],["Agente de Suporte e Concierge","node_modules","pg"],["Agente Comercial","service","node_modules","pg"],["orchestrator","command-center","node_modules","pg"]]) { try { return require(path.join(RAIZ, ...p)); } catch {} } throw new Error("biblioteca pg não encontrada em nenhum agente — rode npm install na Aria"); })();
  const c = new Client({ connectionString: urlRo(), ssl: { rejectUnauthorized: false } });
  await c.connect();
  const ro = await c.query('show default_transaction_read_only');
  if (String(ro.rows[0].default_transaction_read_only) !== 'on') { await c.end(); throw new Error('sessão NÃO é read-only — abortado'); }
  for (const f of CAD.filter((x) => x.tipo === 'sql_max_ts' || x.tipo === 'sql_idade_ts' || x.tipo === 'sql_bool')) {
    if (f.requer_tabela) {
      const t = await c.query(`SELECT to_regclass($1) IS NOT NULL AS ok`, ['public.' + f.requer_tabela]);
      if (!t.rows[0].ok) { lacunas.push(`${f.chave}: tabela ${f.requer_tabela} ainda não existe (deploy pendente)`); continue; }
    }
    let row = null;
    try { row = (await c.query(f.sql)).rows[0] || {}; } catch (e) { lacunas.push(`${f.chave}: consulta falhou (${e.message.slice(0, 80)})`); continue; }

    // sql_bool: a consulta devolve `ok`; false = achado (ex.: último teste do modelo falhou).
    if (f.tipo === 'sql_bool') {
      if (row.ok === null || row.ok === undefined) { lacunas.push(`${f.chave}: sem dado`); continue; }
      if (row.ok === false) achado(f, 'última medição reprovada', f.acao || 'verificar a fonte');
      else ok.push(`${f.chave}: ok`);
      continue;
    }

    // sql_idade_ts: `ts` é o registro mais ANTIGO ainda pendente; nulo = nada pendente (bom).
    if (f.tipo === 'sql_idade_ts') {
      if (!row.ts) { ok.push(`${f.chave}: nada pendente`); continue; }
      const horas = (agora - new Date(row.ts)) / H;
      if (horas > f.tolerancia_horas) achado(f, `pendente mais antigo há ${horas.toFixed(0)}h (tolerância ${f.tolerancia_horas}h)`, f.acao || 'verificar a fila');
      else ok.push(`${f.chave}: pendente mais antigo há ${horas.toFixed(0)}h`);
      continue;
    }

    // sql_max_ts: `ts` é o último sinal de vida; nulo = nunca teve dado (lacuna).
    const ts = row.ts;
    if (!ts) { lacunas.push(`${f.chave}: nunca teve dado`); continue; }
    const horas = (agora - new Date(ts)) / H;
    if (horas > f.tolerancia_horas) achado(f, `último registro há ${horas.toFixed(0)}h (tolerância ${f.tolerancia_horas}h)`, 'verificar o processo que alimenta a fonte');
    else ok.push(`${f.chave}: há ${horas.toFixed(0)}h`);
  }
  await c.end();

  // ── compromissos com data vencida (ADR-015: promessa ao cliente é compromisso) ──
  try {
    const linhas = fs.readFileSync(path.join(RAIZ, 'orchestrator', 'state', 'compromissos.jsonl'), 'utf8').split(/\r?\n/).filter(Boolean);
    let vencidos = 0;
    for (const l of linhas) { try { const o = JSON.parse(l); const d = o.data || o.prazo || o.ate; if (d && !o.cumprido && !o.fechado && String(d).slice(0, 10) < hoje()) vencidos++; } catch {} }
    if (vencidos) achados.push({ chave: 'silencio.compromissos_vencidos', severidade: 'alta', titulo: `${vencidos} compromisso(s) com cliente vencido(s) sem fechamento`, evidencia: 'orchestrator/state/compromissos.jsonl', fonte: 'sentinela-silencio', acao_proposta: 'fechar ou renegociar cada um (Aria)', autonomia: 'requer_aprovacao_orquestrador', dono: 'suporte-concierge' });
  } catch { lacunas.push('compromissos.jsonl ilegível'); }

  const criticos = achados.filter((a) => a.severidade === 'critica').length;
  if (process.argv.includes('--json')) { console.log(JSON.stringify({ achados, lacunas, ok })); process.exit(criticos ? 1 : 0); }

  console.log(`\nSentinela de Silêncio · ${hoje()} · ${achados.length} achado(s), ${criticos} crítico(s) · ${ok.length} fonte(s) viva(s) · ${lacunas.length} lacuna(s)`);
  for (const a of achados) console.log(`  [${a.severidade}] ${a.titulo} — ${a.evidencia}\n      → ${a.acao_proposta}`);
  for (const l of lacunas) console.log(`  [lacuna] ${l}`);
  for (const o of ok) console.log(`  [ok] ${o}`);

  if (process.argv.includes('--relato')) {
    fs.mkdirSync(STATE, { recursive: true });
    const relato = {
      agente: 'orquestrador', ts: agora.toISOString(), trace_id: `trc-silencio-${hoje().replace(/-/g, '')}`,
      status: lacunas.length ? 'parcial' : 'ok', kpis: { achados: achados.length, criticos, fontes_vivas: ok.length },
      achados, cobertura: { fontes: CAD.map((f) => f.chave), lacunas },
    };
    const f = path.join(STATE, `relato-${hoje()}.json`);
    fs.writeFileSync(f, JSON.stringify(relato, null, 1), 'utf8');
    console.log(`\nrelato: ${path.relative(RAIZ, f)}`);
  }
  process.exit(criticos ? 1 : 0);
}

main().catch((e) => { console.error('FALHA:', e.message); process.exit(2); });
