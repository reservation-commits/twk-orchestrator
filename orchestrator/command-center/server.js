/**
 * MAESTRO Command Center — servidor da Central de Comando do Orquestrador TWK.
 * Zero dependências (Node >= 18). Deploy: EasyPanel via Dockerfile.
 *
 * Fontes de dados:
 *  - STATE_DIR (default ./state): tasks.jsonl, logs/audit-*.jsonl, conhecimento.md
 *  - Health dos 5 agentes: AGENT_<NOME>_URL (poll a cada 30s, timeout 3.5s)
 *  - POST /api/ingest: recebe estado do Orquestrador local (Bearer INGEST_TOKEN)
 *
 * Segurança (doutrina fail-closed da operação):
 *  - Em produção SEM CENTER_TOKEN definido, a API responde 503 — nunca aberta por engano.
 *  - Com CENTER_TOKEN, todo /api/* (exceto /health) exige X-Center-Key (comparação constante).
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const brain = require('./brain.js');
const chat = require('./chat.js');
const { kpisFor } = require('./kpis.js');
const metrics = require('./metrics.js');
const sentinels = require('./sentinels.js');
const analyst = require('./analyst.js');
const plataforma = require('./plataforma.js'); // Panorama: leitura unificada da frota (somente leitura)
const whatsapp = require('./whatsapp.js'); // Sala do WhatsApp: o canal ao vivo (somente leitura, cache 30 s)

// Carimbo de build: aparece em /health e no rodapé do painel.
// Serve para responder, em 1 segundo, "a versão que subi é a que está no ar?".
const BUILD = '4.8.0-sala-do-whatsapp-20261023';

const PORT = Number(process.env.PORT || 8787);
const STATE_DIR = path.resolve(process.env.STATE_DIR || path.join(__dirname, 'state'));
const SEED_DIR = process.env.SEED_DIR ? path.resolve(process.env.SEED_DIR) : '';
const LOGS_DIR = path.join(STATE_DIR, 'logs');

// ---------- durabilidade: semear estado sem NUNCA destruir dado vivo (seed.js) ----------
try {
  const r = require('./seed.js').seedState(STATE_DIR, SEED_DIR);
  if (r.seed) console.log(`[seed] estado vivo em ${STATE_DIR} · novos: ${r.novos} · referência atualizada: ${r.atualizados} · preservados: ${r.preservados}`);
} catch (e) { console.error('[seed]', String((e && e.message) || e)); }
const PUBLIC_DIR = path.join(__dirname, 'public');
const CENTER_TOKEN = process.env.CENTER_TOKEN || '';
const INGEST_TOKEN = process.env.INGEST_TOKEN || '';
const IS_PROD = process.env.NODE_ENV === 'production';

const AGENTS = [
  { id: 'comercial', nome: 'CLAVIS', env: 'CLAVIS', url: process.env.AGENT_CLAVIS_URL || '' },
  { id: 'suporte', nome: 'ARIA', env: 'ARIA', url: process.env.AGENT_ARIA_URL || '' },
  { id: 'editorial', nome: 'QUILL', env: 'QUILL', url: process.env.AGENT_QUILL_URL || '' },
  { id: 'financeiro', nome: 'ATLAS', env: 'ATLAS', url: process.env.AGENT_ATLAS_URL || '' },
  { id: 'dba', nome: 'DB ARCHITECT', env: 'DBA', url: process.env.AGENT_DBA_URL || '' },
  // v4.6: o Guardião da Reserva é agente de primeira classe da Central, mas é LOCAL — não tem URL.
  // Saúde e KPIs vêm dos arquivos de estado dele (guardiao.js), nunca de HTTP.
  { id: 'guardiao', nome: 'GUARDIÃO', env: 'GUARDIAO', url: '', local: true },
];
const guardiao = require('./guardiao.js');

// ---------- util ----------
function timingSafeEq(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}
function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(body);
}
function readLines(file) {
  try {
    return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean);
  } catch { return []; }
}

// ---------- estado ----------
function loadTasks() {
  const lines = readLines(path.join(STATE_DIR, 'tasks.jsonl'));
  const byId = new Map();
  for (const t of lines) if (t.task_id) byId.set(t.task_id, { ...(byId.get(t.task_id) || {}), ...t });
  return [...byId.values()].sort((a, b) => String(b.task_id).localeCompare(String(a.task_id)));
}
function loadLogs(dateStr) {
  const d = dateStr || new Date().toISOString().slice(0, 10);
  return readLines(path.join(LOGS_DIR, `audit-${d}.jsonl`));
}
function overview() {
  const tasks = loadTasks();
  const today = new Date().toISOString().slice(0, 10);
  const logs = loadLogs(today);
  const by = (s) => tasks.filter((t) => t.status === s).length;
  return {
    generated_at: new Date().toISOString(),
    tasks: {
      total: tasks.length,
      concluidas: by('concluida'),
      em_andamento: by('em_andamento'),
      bloqueadas: by('bloqueada'),
      aguardando_humano: tasks.filter((t) => t.autonomia === 'requer_aprovacao_humana' && t.status !== 'concluida').length,
    },
    guardrail_blocks_hoje: logs.filter((e) => e.evento === 'guardrail_block').length,
    eventos_hoje: logs.length,
    pendencias: tasks.filter((t) => t.status !== 'concluida').map((t) => ({
      task_id: t.task_id, destino: t.destino, objetivo: t.objetivo, status: t.status,
    })),
  };
}

// ---------- inbox (fila de missões) ----------
const inboxFile = () => path.join(STATE_DIR, 'inbox.jsonl');
function readInbox() { return readLines(inboxFile()); }
function writeInbox(items) {
  try { fs.writeFileSync(inboxFile(), items.map((i) => JSON.stringify(i)).join('\n') + (items.length ? '\n' : ''), 'utf8'); } catch {}
}
function updateInboxItem(id, patch) {
  const items = readInbox().map((i) => (i.id === id ? { ...i, ...patch } : i));
  writeInbox(items);
}

// ---------- health dos agentes ----------
const healthCache = new Map(); // id -> {ok, ms, at, detail}

// Nem todo agente expõe /health: o admin do Quill (Next.js) e o painel do DBA não têm.
// Regra honesta: "vivo" = o serviço RESPONDEU HTTP. 401/403/404 provam vida tanto quanto 200;
// só 5xx e falha de rede contam como fora do ar. Testa os caminhos usuais e guarda qual respondeu.
const HEALTH_PATHS = ['/health', '/healthz', '/api/health', '/'];
async function probe(base, p) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 3500);
  try {
    const r = await fetch(new URL(p, base), { signal: ctrl.signal, redirect: 'follow' });
    return { status: r.status };
  } finally { clearTimeout(to); }
}
async function pollAgent(a) {
  // Agente local (Guardião): "vivo" = varredura recente e não pausado, lido dos arquivos de estado.
  if (a.local) { try { healthCache.set(a.id, guardiao.saude({ stateDir: STATE_DIR })); } catch (e) { healthCache.set(a.id, { configured: true, ok: false, local: true, error: String((e && e.message) || e).slice(0, 120) }); } return; }
  if (!a.url) { healthCache.set(a.id, { configured: false }); return; }
  const started = Date.now();
  const custom = process.env[`AGENT_${a.env}_HEALTH_PATH`];
  const paths = custom ? [custom, ...HEALTH_PATHS] : HEALTH_PATHS;
  let lastErr = null;
  for (const p of paths) {
    try {
      const { status } = await probe(a.url, p);
      if (status < 500) {
        healthCache.set(a.id, {
          configured: true, ok: true, http: status, path: p,
          ms: Date.now() - started, at: new Date().toISOString(),
        });
        return;
      }
      lastErr = `HTTP ${status} em ${p}`;
    } catch (e) {
      lastErr = String(e && e.name === 'AbortError' ? 'timeout' : (e.message || e)).slice(0, 120);
    }
  }
  healthCache.set(a.id, { configured: true, ok: false, error: lastErr, ms: Date.now() - started, at: new Date().toISOString() });
}
function pollAll() { AGENTS.forEach((a) => { pollAgent(a); }); }
pollAll();
setInterval(pollAll, 30_000).unref();

// ---------- vigia de desempenho (v3.4: métricas + sentinelas + analista) ----------
// Coleta horária → série histórica → sentinelas determinísticas → fila de Ações.
// O analista IA roda 1x/dia (teto configurável) e só ACRESCENTA propostas à fila;
// nada aqui executa correção — aprovação é humana, na página Ações.
const METRICS_INTERVAL_MS = Number(process.env.METRICS_INTERVAL_MS || 3_600_000);
async function harvest() {
  try {
    const pares = await Promise.all(AGENTS.map(async (a) => [a.id, await kpisFor(a)]));
    const kpis = Object.fromEntries(pares);
    metrics.record(STATE_DIR, kpis);
    const r = sentinels.run(STATE_DIR, kpis, metrics.readSeries(STATE_DIR, 7));
    if (r.geradas || r.resolvidas) console.log(`[vigia] achados: +${r.geradas} · resolvidos: ${r.resolvidas}`);
  } catch (e) { console.error('[vigia]', String(e && e.message || e)); }
}
setTimeout(harvest, 90_000).unref();          // 1ª coleta 90s após o boot (credenciais/health assentados)
setInterval(harvest, METRICS_INTERVAL_MS).unref();
// ---------- Regência (ADR-012): ciclo diário (Despacho) + horário (alerta crítico novo) ----------
// REGENCIA_ENABLED=on liga; REGENCIA_HORA = hora local Europe/Paris do Despacho (padrão 8).
// Falhar alto: se o Despacho do dia não existir 2h após a hora marcada, vira Ação "regencia_nao_rodou".
if ((process.env.REGENCIA_ENABLED || 'off') === 'on') {
  const REG_HORA = Number(process.env.REGENCIA_HORA || 8);
  const horaParis = () => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', hour: '2-digit', hour12: false }).format(new Date()));
  const hojeStr = () => new Date().toISOString().slice(0, 10);
  let ultimoDiario = null; let rodando = false;
  async function cicloRegencia(modo) {
    if (rodando) return; rodando = true;
    try {
      const reg = require('./regencia/run.js');
      const pares = await Promise.all(AGENTS.map(async (a) => [a.id, await kpisFor(a)]));
      const { resultado } = await reg.executar({ modo, kpis: Object.fromEntries(pares), semExecutar: true });
      if (modo === 'diario') ultimoDiario = hojeStr();
      console.log(`[regencia] ${modo}: ${resultado.relatos} relatos · ${resultado.achados} achados · ${resultado.criticos} críticos · despacho=${resultado.despacho ? 'sim' : 'não'} · email=${resultado.email ? resultado.email.ok : '-'}`);
    } catch (e) { console.error('[regencia]', String(e && e.message || e)); }
    finally { rodando = false; }
  }
  setInterval(() => {
    const h = horaParis();
    if (h === REG_HORA && ultimoDiario !== hojeStr()) return void cicloRegencia('diario');
    if (h > REG_HORA + 2 && ultimoDiario !== hojeStr() && !fs.existsSync(path.join(STATE_DIR, 'despachos', `${hojeStr()}.md`))) {
      try { sentinels.upsert(STATE_DIR, { origem: 'vigia', agente: 'orquestrador', regra: 'regencia_nao_rodou', severidade: 'alta', titulo: 'Despacho do MAESTRO de hoje não foi gerado', detalhe: `REGENCIA_HORA=${REG_HORA} (Paris); sem despachos/${hojeStr()}.md`, evidencia: [] }); } catch {}
    }
    if (h >= 8 && h <= 22 && new Date().getUTCMinutes() < 5) return void cicloRegencia('horario');
  }, 5 * 60_000).unref();
  console.log(`[regencia] ligada: despacho diário às ${REG_HORA}h Paris; alerta crítico a cada hora (08–22h)`);
}
// ---------- Rotinas hospedadas (A1, 2026-10-22): Guardião, Ciclo do Cliente, Sentinela e Zelador dentro da Central ----------
// ROTINAS_ENABLED=on liga. Com elas ligadas, a Regência em processo lê o estado dos agentes no volume (TWK_STATE_ROOT).
const rotinas = require('./rotinas.js');
if (rotinas.enabled()) { process.env.TWK_STATE_ROOT = process.env.TWK_STATE_ROOT || STATE_DIR; process.env.TWK_AGENTS_DIR = process.env.TWK_AGENTS_DIR || rotinas.AGENTS_DIR; }
rotinas.start();
const ANALYST_INTERVAL_MS = Math.max(1, Number(process.env.ANALYST_INTERVAL_H || 24)) * 3_600_000;
if (analyst.enabled()) {
  setTimeout(() => { analyst.run(STATE_DIR).catch(() => {}); }, 300_000).unref(); // 1º ciclo 5 min após o boot
  setInterval(() => { analyst.run(STATE_DIR).catch(() => {}); }, ANALYST_INTERVAL_MS).unref();
}

// ---------- auth ----------
function apiAuthorized(req, res) {
  if (!CENTER_TOKEN) {
    if (IS_PROD) { json(res, 503, { error: 'CENTER_TOKEN ausente - central fail-closed em producao' }); return false; }
    return true; // dev local
  }
  const key = req.headers['x-center-key'] || '';
  if (key && timingSafeEq(key, CENTER_TOKEN)) return true;
  json(res, 401, { error: 'nao autorizado' });
  return false;
}

// ---------- ingest ----------
function handleIngest(req, res) {
  if (!INGEST_TOKEN) return json(res, 503, { error: 'INGEST_TOKEN ausente' });
  const auth = String(req.headers.authorization || '');
  if (!auth.startsWith('Bearer ') || !timingSafeEq(auth.slice(7), INGEST_TOKEN)) return json(res, 401, { error: 'nao autorizado' });
  let body = '';
  req.on('data', (c) => { body += c; if (body.length > 5_000_000) req.destroy(); });
  req.on('end', () => {
    try {
      const payload = JSON.parse(body);
      fs.mkdirSync(LOGS_DIR, { recursive: true });
      if (typeof payload.tasks_jsonl === 'string') fs.writeFileSync(path.join(STATE_DIR, 'tasks.jsonl'), payload.tasks_jsonl, 'utf8');
      if (payload.log_date && typeof payload.log_jsonl === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(payload.log_date)) {
        fs.writeFileSync(path.join(LOGS_DIR, `audit-${payload.log_date}.jsonl`), payload.log_jsonl, 'utf8');
      }
      if (typeof payload.conhecimento_md === 'string') fs.writeFileSync(path.join(STATE_DIR, 'conhecimento.md'), payload.conhecimento_md, 'utf8');
      // Panorama: métricas que só nascem na máquina do Orquestrador (porta, avaliações, sentinela, Guardião, convites)
      if (payload.plataforma_local && typeof payload.plataforma_local === 'object' && payload.plataforma_local.metricas) {
        fs.writeFileSync(path.join(STATE_DIR, 'plataforma-local.json'), JSON.stringify(payload.plataforma_local), 'utf8');
      }
      // Guardião da Reserva (v4.6): a última varredura, compacta (contagens, lote, fila, clientes a avisar,
      // livro-razão e relatório) — calculada na máquina do Orquestrador por `node guardiao.js --exportar`.
      if (payload.guardiao && typeof payload.guardiao === 'object' && payload.guardiao.snapshot && payload.guardiao.snapshot.status === 'ok') {
        fs.writeFileSync(path.join(STATE_DIR, guardiao.ARQ_SINC), JSON.stringify(payload.guardiao), 'utf8');
      }
      // Casas de teste (fundador, 2026-09-06): a lista mora no repositório do Orquestrador; aqui é a cópia
      // que regencia/db.js usa para tirar as casas de teste de TODA contagem (v4.5.2)
      if (payload.excluidos_teste && typeof payload.excluidos_teste === 'object' && Array.isArray(payload.excluidos_teste.restaurantes)) {
        fs.writeFileSync(path.join(STATE_DIR, 'excluidos-teste.json'), JSON.stringify(payload.excluidos_teste, null, 2), 'utf8');
      }
      // Rotinas hospedadas (A1, 2026-10-22): o Guardião dentro da Central só contata casa com o registro de
      // opt-out legível (fail-closed), e a Sentinela lê os compromissos. Cópias dos arquivos interinos do repositório;
      // só se aceita JSONL íntegro (toda linha um JSON), para um envio truncado nunca virar "registro vazio".
      const jsonlIntegro = (s) => typeof s === 'string' && s.split(/\r?\n/).filter(Boolean).every((l) => { try { JSON.parse(l); return true; } catch { return false; } });
      if (jsonlIntegro(payload.listing_consent_jsonl)) fs.writeFileSync(path.join(STATE_DIR, 'listing-consent.jsonl'), payload.listing_consent_jsonl, 'utf8');
      if (jsonlIntegro(payload.compromissos_jsonl)) fs.writeFileSync(path.join(STATE_DIR, 'compromissos.jsonl'), payload.compromissos_jsonl, 'utf8');
      if (payload.missoes && typeof payload.missoes === 'object') {
        const mdir = path.join(STATE_DIR, 'missoes');
        fs.mkdirSync(mdir, { recursive: true });
        for (const [name, content] of Object.entries(payload.missoes)) {
          if (/^[A-Za-z0-9._-]+\.md$/.test(name) && typeof content === 'string') fs.writeFileSync(path.join(mdir, name), content, 'utf8');
        }
      }
      // Regência (ADR-012): relatos do dia vindos do Orquestrador local ({ "<data>/<agente>.json": "<json>" })
      if (payload.relatos && typeof payload.relatos === 'object') {
        for (const [name, content] of Object.entries(payload.relatos)) {
          if (/^\d{4}-\d{2}-\d{2}\/[A-Za-z0-9._-]+\.json$/.test(name) && typeof content === 'string' && content.length < 400_000) {
            const f = path.join(STATE_DIR, 'relatos', name);
            fs.mkdirSync(path.dirname(f), { recursive: true });
            fs.writeFileSync(f, content, 'utf8');
          }
        }
      }
      json(res, 200, { ok: true, at: new Date().toISOString() });
    } catch (e) { json(res, 400, { error: 'payload invalido' }); }
  });
}

// ---------- static ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };
function serveStatic(req, res) {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/') p = '/index.html';
  const file = path.join(PUBLIC_DIR, path.normalize(p));
  if (!file.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) {
      // SPA fallback
      fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (e2, idx) => {
        if (e2) { res.writeHead(404); return res.end('not found'); }
        res.writeHead(200, { 'content-type': MIME['.html'] }); res.end(idx);
      });
      return;
    }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(data);
  });
}

// ---------- server ----------
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  res.setHeader('x-frame-options', 'DENY');
  // Fontes da marca (Cormorant Garamond + Jost) liberadas; todo o resto continua restrito ao próprio host
  res.setHeader('content-security-policy', "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self'");

  if (u.pathname === '/health') {
    // Falhar alto: se o estado nao for gravavel, o /health diz — nao espera o usuario descobrir no clique
    let writable = 'ok';
    try {
      fs.mkdirSync(STATE_DIR, { recursive: true });
      const probe = path.join(STATE_DIR, '.write-probe');
      fs.writeFileSync(probe, 'x'); fs.unlinkSync(probe);
    } catch (e) { writable = `FALHA (${(e && e.code) || 'ERR'}) - missoes nao poderao ser gravadas`; }
    return json(res, 200, {
      ok: true, service: 'maestro-command-center',
      build: BUILD,
      kpi_proxy: typeof kpisFor === 'function' ? 'ok' : 'ausente',
      state_writable: writable,
      state_dir: fs.existsSync(path.join(STATE_DIR, 'tasks.jsonl')) ? 'ok' : 'vazio',
      durabilidade: (() => {
        // Alerta honesto: se STATE_DIR == pasta da imagem (sem volume), avisa que some no deploy.
        const semVolumeProvavel = !SEED_DIR;
        const conversas = (() => { try { return fs.readdirSync(path.join(STATE_DIR, 'threads')).filter((f) => f.endsWith('.json')).length; } catch { return 0; } })();
        return { seed: SEED_DIR ? 'on' : 'off (dev)', conversas_salvas: conversas, aviso: semVolumeProvavel ? undefined : 'monte um VOLUME persistente em /app/state no EasyPanel, senão as conversas somem no redeploy' };
      })(),
      rotinas: rotinas.saude(),
      auth: CENTER_TOKEN ? 'token' : (IS_PROD ? 'FAIL-CLOSED (sem token em producao)' : 'dev-aberto'),
      agents_configurados: AGENTS.filter((a) => a.url || (a.local && (healthCache.get(a.id) || {}).configured)).length,
      brain: brain.brainEnabled() ? `on (${brain.MODEL_STANDARD} / complexo: ${brain.MODEL_COMPLEX})` : 'off',
      conversa: chat.enabled() ? 'on' : 'off (mensagens caem na fila do Orquestrador local)',
      ferramentas_frota: process.env.MAESTRO_TOOLS !== 'off' ? 'on (leitura: kpis, api dos agentes, estado, especialista)' : 'off',
      envio_email: (() => { const e = require('./email.js'); return e.enabled() ? `on (${e.provider()})` : 'off — defina EMAIL_WEBHOOK_URL ou RESEND_API_KEY+EMAIL_FROM'; })(),
      escrita_banco: require('./dbexec.js').statusLinha(),
      vigia: { intervalo_min: Math.round(METRICS_INTERVAL_MS / 60_000), dias_de_serie: metrics.daysAvailable(STATE_DIR) },
      analista: analyst.enabled() ? `on (${analyst.MODEL})` : 'off',
      acoes: (() => {
        const a = sentinels.readActions(STATE_DIR);
        return {
          abertas: a.filter((x) => x.status === 'aberta' || x.status === 'adiada').length,
          criticas: a.filter((x) => (x.status === 'aberta' || x.status === 'adiada') && x.severidade === 'critica').length,
        };
      })(),
    });
  }
  if (u.pathname === '/api/ingest' && req.method === 'POST') return handleIngest(req, res);
  if (u.pathname === '/api/inbox/consume' && req.method === 'POST') {
    // O Orquestrador local coleta os pedidos pendentes (Bearer INGEST_TOKEN) e eles saem da fila.
    if (!INGEST_TOKEN) return json(res, 503, { error: 'INGEST_TOKEN ausente' });
    const auth = String(req.headers.authorization || '');
    if (!auth.startsWith('Bearer ') || !timingSafeEq(auth.slice(7), INGEST_TOKEN)) return json(res, 401, { error: 'nao autorizado' });
    // O Orquestrador local coleta apenas o que o cérebro embarcado não pegou (status 'fila').
    const all = readInbox();
    const items = all.filter((i) => !i.status || i.status === 'fila');
    try {
      if (items.length) {
        fs.appendFileSync(path.join(STATE_DIR, 'inbox-consumido.jsonl'), items.map((i) => JSON.stringify({ ...i, consumido_em: new Date().toISOString() })).join('\n') + '\n', 'utf8');
        writeInbox(all.filter((i) => i.status && i.status !== 'fila'));
      }
    } catch {}
    return json(res, 200, { items });
  }
  if (u.pathname.startsWith('/api/')) {
    if (!apiAuthorized(req, res)) return;
    if (u.pathname === '/api/overview') return json(res, 200, overview());
    if (u.pathname === '/api/tasks') return json(res, 200, { tasks: loadTasks() });
    if (u.pathname === '/api/logs') return json(res, 200, { date: u.searchParams.get('date') || null, eventos: loadLogs(u.searchParams.get('date')) });
    if (u.pathname === '/api/missions/new' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => { body += c; if (body.length > 100_000) req.destroy(); });
      req.on('end', () => {
        try {
          const p = JSON.parse(body);
          const titulo = String(p.titulo || '').trim().slice(0, 160);
          const descricao = String(p.descricao || '').trim().slice(0, 8000);
          if (!titulo || !descricao) return json(res, 400, { error: 'titulo e descricao obrigatorios' });
          const item = {
            id: 'INBOX-' + new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14),
            titulo, descricao,
            prioridade: ['critica', 'alta', 'normal', 'baixa'].includes(p.prioridade) ? p.prioridade : 'normal',
            status: 'fila',
            criado_em: new Date().toISOString(),
          };
          // Gravação separada do parse: erro de disco NÃO é "payload invalido".
          try {
            fs.mkdirSync(STATE_DIR, { recursive: true });
            fs.appendFileSync(inboxFile(), JSON.stringify(item) + '\n', 'utf8');
          } catch (e) {
            const code = (e && e.code) || 'ERR';
            return json(res, 500, {
              error: `estado nao gravavel (${code}) em ${STATE_DIR}`,
              hint: code === 'EACCES'
                ? 'o container roda como usuario "node" mas a pasta de estado pertence ao root — redeploy com o Dockerfile atualizado (COPY --chown=node:node)'
                : 'verifique o volume montado em /app/state',
            });
          }
          // Cérebro embarcado: processa a missão imediatamente (fila serial)
          if (brain.brainEnabled()) brain.enqueue(item, STATE_DIR, updateInboxItem);
          json(res, 200, { ok: true, item, brain: brain.brainEnabled() });
        } catch { json(res, 400, { error: 'payload invalido' }); }
      });
      return;
    }
    if (u.pathname === '/api/inbox') {
      return json(res, 200, { items: readLines(path.join(STATE_DIR, 'inbox.jsonl')) });
    }
    // Backlog RICE e Fila de Perguntas (2026-09-02, ADR-009): leitura; escrita é edição consciente do Orquestrador.
    if (u.pathname === '/api/backlog') {
      return json(res, 200, { items: readLines(path.join(STATE_DIR, 'backlog.jsonl')) });
    }
    if (u.pathname === '/api/perguntas') {
      return json(res, 200, { items: readLines(path.join(STATE_DIR, 'perguntas.jsonl')) });
    }
    // ---------- Regência (ADR-012): relatos dos agentes e despachos do MAESTRO ----------
    if (u.pathname === '/api/relatos' && req.method === 'GET') {
      const date = String(u.searchParams.get('date') || new Date().toISOString().slice(0, 10));
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return json(res, 400, { error: 'date invalida' });
      const dir = path.join(STATE_DIR, 'relatos', date);
      let relatos = [];
      try { relatos = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { return null; } }).filter(Boolean); } catch {}
      return json(res, 200, { date, relatos });
    }
    if (u.pathname === '/api/relatos' && req.method === 'POST') {
      // Um agente (serviço) empurra o próprio relato — mesmo token do ingest (Bearer INGEST_TOKEN).
      if (!INGEST_TOKEN) return json(res, 503, { error: 'INGEST_TOKEN ausente' });
      const auth = String(req.headers.authorization || '');
      if (!auth.startsWith('Bearer ') || !timingSafeEq(auth.slice(7), INGEST_TOKEN)) return json(res, 401, { error: 'nao autorizado' });
      let body = '';
      req.on('data', (c) => { body += c; if (body.length > 400_000) req.destroy(); });
      req.on('end', () => {
        try {
          const r = JSON.parse(body);
          if (!r || typeof r.agente !== 'string' || !/^[a-z-]+$/.test(r.agente) || !Array.isArray(r.achados) || !r.cobertura) return json(res, 400, { error: 'relato fora do contrato (relato.schema.json)' });
          const date = new Date().toISOString().slice(0, 10);
          const dir = path.join(STATE_DIR, 'relatos', date); fs.mkdirSync(dir, { recursive: true });
          const f = path.join(dir, `${r.agente}-push-${new Date().toISOString().slice(11, 16).replace(':', '')}.json`);
          fs.writeFileSync(f, JSON.stringify({ ...r, ts: r.ts || new Date().toISOString(), origem: 'push' }, null, 1), 'utf8');
          return json(res, 200, { ok: true, arquivo: path.basename(f) });
        } catch { return json(res, 400, { error: 'json invalido' }); }
      });
      return;
    }
    if (u.pathname === '/api/despachos') {
      const ddir = path.join(STATE_DIR, 'despachos');
      let files = [];
      try { files = fs.readdirSync(ddir).filter((f) => f.endsWith('.md')).sort().reverse().map((f) => ({ file: f, mtime: fs.statSync(path.join(ddir, f)).mtime })); } catch {}
      return json(res, 200, { despachos: files });
    }
    if (u.pathname === '/api/despacho') {
      const f = String(u.searchParams.get('f') || '');
      if (!/^[A-Za-z0-9._-]+\.md$/.test(f)) return json(res, 400, { error: 'nome invalido' });
      try { return json(res, 200, { file: f, content: fs.readFileSync(path.join(STATE_DIR, 'despachos', f), 'utf8') }); }
      catch { return json(res, 404, { error: 'despacho nao encontrado' }); }
    }
    // Rotinas hospedadas (A1): estado da última rodada e disparo manual (mesma chave da API).
    if (u.pathname === '/api/rotinas' && req.method === 'GET') return json(res, 200, { saude: rotinas.saude(), ultima: rotinas.estado() });
    if (u.pathname === '/api/rotinas/run' && req.method === 'POST') {
      const so = u.searchParams.get('so') || null;
      rotinas.executar({ so }).then((e) => json(res, e && e.erro ? 409 : 200, e)).catch((e) => json(res, 500, { error: String(e && e.message || e) }));
      return;
    }
    if (u.pathname === '/api/regencia/run' && req.method === 'POST') {
      // Disparo manual pelo operador (mesma proteção X-Center-Key). Nunca envia e-mail daqui.
      try {
        const reg = require('./regencia/run.js');
        const pares = await Promise.all(AGENTS.map(async (a) => [a.id, await kpisFor(a)]));
        const { resultado } = await reg.executar({ modo: u.searchParams.get('modo') === 'horario' ? 'horario' : 'diario', kpis: Object.fromEntries(pares), semEmail: true, semExecutar: true });
        return json(res, 200, resultado);
      } catch (e) { return json(res, 500, { error: String(e.message || e).slice(0, 300) }); }
    }
    if (u.pathname === '/api/missions') {
      const mdir = path.join(STATE_DIR, 'missoes');
      let files = [];
      try {
        files = fs.readdirSync(mdir).filter((f) => f.endsWith('.md')).sort().reverse().map((f) => {
          const txt = fs.readFileSync(path.join(mdir, f), 'utf8');
          const title = (txt.match(/^#\s+(.+)$/m) || [null, f])[1];
          return { file: f, title, bytes: txt.length, mtime: fs.statSync(path.join(mdir, f)).mtime };
        });
      } catch {}
      return json(res, 200, { missions: files });
    }
    if (u.pathname === '/api/mission') {
      const f = String(u.searchParams.get('f') || '');
      if (!/^[A-Za-z0-9._-]+\.md$/.test(f)) return json(res, 400, { error: 'nome invalido' });
      try { return json(res, 200, { file: f, content: fs.readFileSync(path.join(STATE_DIR, 'missoes', f), 'utf8') }); }
      catch { return json(res, 404, { error: 'missao nao encontrada' }); }
    }
    // Guardião (v4.6): o relatório legível da última varredura (markdown) — página do agente e ler_estado
    if (u.pathname === '/api/guardiao/relatorio') {
      const r = guardiao.relatorio({ stateDir: STATE_DIR });
      if (!r.content) return json(res, 404, { error: 'relatório do Guardião indisponível nesta Central', hint: 'rode push-state.ps1 na máquina do Orquestrador' });
      return json(res, 200, r);
    }
    if (u.pathname === '/api/kpis') {
      // KPIs REAIS dos agentes. Busca server-to-server (os agentes têm CORS fechado
      // e as credenciais nunca podem chegar ao navegador). Cache de 60s no módulo.
      const id = u.searchParams.get('id');
      const alvo = id ? AGENTS.filter((a) => a.id === id) : AGENTS;
      const pares = await Promise.all(alvo.map(async (a) => [a.id, await kpisFor(a)]));
      return json(res, 200, { kpis: Object.fromEntries(pares) });
    }
    // ---------- Ações (vigia de desempenho) ----------
    if (u.pathname === '/api/actions' && req.method === 'GET') {
      return json(res, 200, { acoes: sentinels.readActions(STATE_DIR) });
    }
    if (u.pathname === '/api/actions/analyze' && req.method === 'POST') {
      const gate = analyst.canRun(STATE_DIR);
      if (!gate.ok) return json(res, 429, { error: gate.reason });
      // dispara e responde já: o ciclo leva minutos e o painel faz poll da fila
      analyst.run(STATE_DIR).then((r) => {
        if (!r.ok) console.error('[analista]', r.reason);
      }).catch((e) => console.error('[analista]', String(e && e.message || e)));
      return json(res, 200, { ok: true, status: 'analisando' });
    }
    if (u.pathname === '/api/actions/decide' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => { body += c; if (body.length > 20_000) req.destroy(); });
      req.on('end', () => {
        try {
          const p = JSON.parse(body);
          const id = String(p.id || '');
          const decisao = String(p.decisao || '');
          const motivo = String(p.motivo || '').trim();
          if (!['aprovar', 'adiar', 'descartar'].includes(decisao)) return json(res, 400, { error: 'decisao invalida' });
          const items = sentinels.readActions(STATE_DIR);
          const a = items.find((x) => x.id === id);
          if (!a) return json(res, 404, { error: 'acao nao encontrada' });
          if (a.status !== 'aberta' && a.status !== 'adiada') return json(res, 409, { error: `acao ja esta "${a.status}"` });
          const now = new Date().toISOString();
          if (decisao === 'descartar') {
            // Doutrina: descarte sem motivo não existe — a justificativa é auditada.
            if (motivo.length < 5) return json(res, 400, { error: 'descarte exige motivo (min. 5 caracteres)' });
            a.status = 'descartada'; a.motivo_descarte = motivo;
          } else if (decisao === 'adiar') {
            a.status = 'adiada'; a.adiada_ate = new Date(Date.now() + 7 * 86_400_000).toISOString();
          } else {
            // aprovar → vira handoff na fila do MAESTRO (o Orquestrador local roteia ao agente)
            a.status = 'aprovada';
            const rec = a.recomendacao || {};
            const ib = {
              id: 'ACAO-' + now.replace(/[-:TZ.]/g, '').slice(0, 14),
              titulo: `[Correção · ${a.agente}] ${a.titulo}`.slice(0, 160),
              descricao: [
                `Ação corretiva aprovada pelo fundador na Central (id ${a.id}, origem: ${a.origem}, severidade: ${a.severidade}).`,
                `Diagnóstico: ${a.detalhe || '—'}`,
                (a.evidencia || []).length ? `Evidência: ${a.evidencia.map((e) => `${e.metrica}: ${e.antes} → ${e.depois}${e.variacao_pct != null ? ` (${e.variacao_pct}%)` : ''}`).join(' · ')}` : '',
                rec.causa_provavel ? `Causa provável: ${rec.causa_provavel}` : '',
                rec.correcao ? `Correção proposta: ${rec.correcao}` : '',
                rec.impacto_estimado ? `Impacto estimado: ${rec.impacto_estimado}` : '',
                `Agente responsável: ${a.agente}. ${rec.requer_aprovacao_humana !== false ? 'Execução sensível: exige aprovação humana no gate correspondente.' : ''}`,
              ].filter(Boolean).join('\n').slice(0, 8000),
              prioridade: a.severidade === 'critica' ? 'critica' : a.severidade === 'alta' ? 'alta' : 'normal',
              status: 'fila',
              criado_em: now,
              origem: 'acao',
              acao_id: a.id,
              agente_destino: a.agente,
            };
            try {
              fs.appendFileSync(inboxFile(), JSON.stringify(ib) + '\n', 'utf8');
              a.handoff_id = ib.id;
            } catch (e) {
              return json(res, 500, { error: `estado nao gravavel (${(e && e.code) || 'ERR'})` });
            }
          }
          a.decidido_em = now; a.atualizado_em = now;
          sentinels.writeActions(STATE_DIR, items);
          sentinels.appendAudit(STATE_DIR, { evento: 'acao_decisao', acao_id: a.id, decisao, motivo: motivo || undefined, handoff_id: a.handoff_id });
          json(res, 200, { ok: true, acao: a });
        } catch { json(res, 400, { error: 'payload invalido' }); }
      });
      return;
    }
    // ---------- Backup (rede de segurança: baixar tudo antes de um deploy) ----------
    if (u.pathname === '/api/backup') {
      const bundle = { gerado_em: new Date().toISOString(), build: BUILD, threads: [], aprovacoes: [], inbox: [] };
      try {
        const tdir = path.join(STATE_DIR, 'threads');
        if (fs.existsSync(tdir)) for (const f of fs.readdirSync(tdir).filter((x) => x.endsWith('.json'))) {
          try { bundle.threads.push(JSON.parse(fs.readFileSync(path.join(tdir, f), 'utf8'))); } catch {}
        }
      } catch {}
      bundle.aprovacoes = readLines(path.join(STATE_DIR, 'aprovacoes.jsonl'));
      bundle.inbox = readLines(path.join(STATE_DIR, 'inbox.jsonl'));
      const nome = `maestro-backup-${new Date().toISOString().slice(0, 10)}.json`;
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'content-disposition': `attachment; filename="${nome}"`, 'cache-control': 'no-store' });
      return res.end(JSON.stringify(bundle, null, 1));
    }
    // ---------- Conversa v4 (chat multimodal com a frota) ----------
    if (u.pathname === '/api/chat/threads') return json(res, 200, { threads: chat.listThreads(STATE_DIR) });
    if (u.pathname === '/api/chat/thread') {
      const th = chat.readThread(STATE_DIR, String(u.searchParams.get('id') || ''));
      return th ? json(res, 200, { thread: th }) : json(res, 404, { error: 'conversa nao encontrada' });
    }
    if (u.pathname === '/api/chat/upload' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => { body += c; if (body.length > 12_000_000) req.destroy(); });
      req.on('end', () => {
        try {
          const r = chat.saveUpload(STATE_DIR, JSON.parse(body));
          if (r.error) return json(res, 400, { error: r.error });
          json(res, 200, { ok: true, anexo: r.meta });
        } catch { json(res, 400, { error: 'payload invalido' }); }
      });
      return;
    }
    if (u.pathname === '/api/anexo') {
      const a = chat.readAnexo(STATE_DIR, String(u.searchParams.get('id') || ''));
      if (!a) return json(res, 404, { error: 'anexo nao encontrado' });
      res.writeHead(200, { 'content-type': a.meta.mime, 'cache-control': 'private, max-age=3600', 'content-disposition': `inline; filename="${a.meta.nome.replace(/[^\w. -]/g, '_')}"` });
      return res.end(a.buf);
    }
    if (u.pathname === '/api/chat/send' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => { body += c; if (body.length > 200_000) req.destroy(); });
      req.on('end', () => {
        let p = null;
        try { p = JSON.parse(body); } catch { return json(res, 400, { error: 'payload invalido' }); }
        chat.handleSend(req, res, STATE_DIR, p);
      });
      return;
    }
    // ---------- Aprovações do fundador (tabela de escalonamento) ----------
    if (u.pathname === '/api/approvals') return json(res, 200, { aprovacoes: chat.readAprovacoes(STATE_DIR) });
    if (u.pathname === '/api/approvals/decide' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => { body += c; if (body.length > 20_000) req.destroy(); });
      req.on('end', async () => {
        try {
          const r = await chat.decideAprovacao(STATE_DIR, JSON.parse(body));
          json(res, r.code, r.body);
        } catch { json(res, 400, { error: 'payload invalido' }); }
      });
      return;
    }
    // ---------- Panorama: plataforma de leitura de todo o sistema (somente leitura, com cache) ----------
    if (u.pathname === '/api/plataforma/registro') {
      try { return json(res, 200, plataforma.registro()); }
      catch (e) { return json(res, 500, { error: 'plataforma: ' + String((e && e.message) || e).slice(0, 200) }); }
    }
    if (u.pathname === '/api/plataforma') {
      try { return json(res, 200, await plataforma.snapshot({ stateDir: STATE_DIR, agents: AGENTS, kpisFor, fresco: u.searchParams.get('fresco') === '1' })); }
      catch (e) { return json(res, 500, { error: 'plataforma: ' + String((e && e.message) || e).slice(0, 200) }); }
    }
    // ---------- Sala do WhatsApp: o canal ao vivo (conversas, entregas, funil, casas, clientes, qualidade) ----------
    if (u.pathname === '/api/whatsapp') {
      try { return json(res, 200, await whatsapp.snapshot({ fresco: u.searchParams.get('fresco') === '1' })); }
      catch (e) { return json(res, 500, { error: 'whatsapp: ' + String((e && e.message) || e).slice(0, 200) }); }
    }
    if (u.pathname === '/api/whatsapp/conversa') {
      try { return json(res, 200, await whatsapp.conversa(u.searchParams.get('id') || '')); }
      catch (e) { return json(res, 500, { error: 'whatsapp/conversa: ' + String((e && e.message) || e).slice(0, 200) }); }
    }
    if (u.pathname === '/api/agents') {
      return json(res, 200, {
        // agente local (Guardião): "configurado" = o estado dele é legível aqui (repositório ou sincronizado)
        agents: AGENTS.map((a) => ({ id: a.id, nome: a.nome, local: !!a.local, configured: a.local ? !!(healthCache.get(a.id) || {}).configured : !!a.url, health: healthCache.get(a.id) || null })),
      });
    }
    return json(res, 404, { error: 'rota desconhecida' });
  }
  // Panorama: /plataforma abre a página da plataforma (não o cockpit, que é o fallback de SPA).
  if (u.pathname === '/plataforma' || u.pathname === '/plataforma/') { req.url = '/plataforma/index.html'; }
  if (u.pathname === '/whatsapp' || u.pathname === '/whatsapp/') { req.url = '/whatsapp/index.html'; }
  serveStatic(req, res);
});

// Panorama: a primeira leitura leva ~20 s; começa já na subida para a página abrir com números.
plataforma.manterQuente({ stateDir: STATE_DIR, agents: AGENTS, kpisFor });

server.listen(PORT, () => {
  console.log(`[maestro] Command Center em :${PORT} · state=${STATE_DIR} · auth=${CENTER_TOKEN ? 'token' : (IS_PROD ? 'FAIL-CLOSED' : 'dev')}`);
});
process.on('SIGTERM', () => server.close(() => process.exit(0)));
