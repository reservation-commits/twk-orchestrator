'use strict';
/**
 * COMPASSO Tarefas — servidor. Zero dependências além do SDK (e pg opcional). Node >= 18.
 *
 * O que é: um gerenciador de tarefas para três pessoas (Márlon, Lucas, Julien) com quadro por status,
 * calendário, chat que divide em etapas e sugestões do planejador. Nada além disso.
 *
 * Integração com a frota (por API, não por acoplamento):
 *   - GET /api/relato (X-Center-Key)  → relato no contrato da Regência (kpis + achados), para o Despacho do MAESTRO
 *   - sugestões lidas dos sinais existentes (compromissos, achados do vigia, Central, banco via twk_ro)
 *   - auditoria: STATE_DIR/logs/audit-AAAA-MM-DD.jsonl com quem fez o quê; o ledger de eventos é append-only
 *
 * Segurança (doutrina fail-closed): produção sem TAREFAS_SECRET ou sem usuários → 503 em tudo menos /health.
 * Nenhuma rota envia nada para fora: sem e-mail, sem WhatsApp, sem webhook.
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const store = require('./store.js');
const authMod = require('./auth.js');
const planejador = require('./planejador.js');
const sugestoes = require('./sugestoes.js');
const oauthMod = require('./oauth.js');
const mcpMod = require('./mcp.js');

const BUILD = '0.3.0-compasso-mcp-20261103';
const PORT = Number(process.env.PORT || 8790);
const IS_PROD = process.env.NODE_ENV === 'production';
const STATE_DIR = path.resolve(process.env.STATE_DIR || path.join(__dirname, 'state'));
const PUBLIC_DIR = path.join(__dirname, 'public');
const CENTER_TOKEN = process.env.CENTER_TOKEN || '';
// Com CENTER_URL, as sugestões leem as filas da Central (achados, perguntas, aprovações, compromissos) pela API
// com a mesma chave; sem ela, só do disco (máquina do Orquestrador) — e o banco, se houver DATABASE_URL_RO.
const CENTER_URL = String(process.env.CENTER_URL || '').replace(/\/+$/, '');
const SUGESTOES_TTL_MS = Number(process.env.TAREFAS_SUGESTOES_TTL_MIN || 360) * 60000;

fs.mkdirSync(path.join(STATE_DIR, 'logs'), { recursive: true });
const db = store.abrir({ stateDir: STATE_DIR, databaseUrl: process.env.TAREFAS_DATABASE_URL || '' });
let auth;
try { auth = authMod.criar({ stateDir: STATE_DIR, isProd: IS_PROD, segredo: process.env.TAREFAS_SECRET || '' }); }
catch (e) { console.error('[auth]', e.message); auth = { operacional: false, usuarios: [], sessaoDe: () => null }; }
if (!auth.operacional) console.error('[tarefas] NÃO OPERACIONAL: faltam usuários (TAREFAS_USUARIOS ou state/usuarios.json) ou TAREFAS_SECRET — a API responde 503.');
// Conector MCP (03/11): o chat do Claude e o Claude Code entram por OAuth com o login do app e agem em nome de quem
// autorizou. TAREFAS_URL é o endereço público (issuer); sem ela, deriva de x-forwarded-proto + host.
const TAREFAS_URL = String(process.env.TAREFAS_URL || '').replace(/\/+$/, '');
const oauth = oauthMod.criar({ auth, stateDir: STATE_DIR, urlPublica: TAREFAS_URL, auditar });
const mcp = mcpMod.criar({ db, store, planejador, sugestoesAtuais, assumirSugestao, auditar, build: BUILD });

// ---------- util ----------
function json(res, code, obj, extra) { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...(extra || {}) }); res.end(JSON.stringify(obj)); }
function erro(res, code, msg) { json(res, code, { erro: msg }); }
function lerCorpo(req) {
  return new Promise((resolve, reject) => {
    let tam = 0; const partes = [];
    req.on('data', (c) => { tam += c.length; if (tam > 64 * 1024) { reject(new Error('corpo acima de 64 KB')); req.destroy(); } else partes.push(c); });
    req.on('end', () => { if (!partes.length) return resolve({}); try { resolve(JSON.parse(Buffer.concat(partes).toString('utf8'))); } catch { reject(new Error('JSON inválido')); } });
    req.on('error', reject);
  });
}
function auditar(ev) { try { fs.appendFileSync(path.join(STATE_DIR, 'logs', `audit-${new Date().toISOString().slice(0, 10)}.jsonl`), JSON.stringify({ ts: new Date().toISOString(), ...ev }) + '\n', 'utf8'); } catch { /* nunca derruba a requisição */ } }
function traceDe(req) { const t = String(req.headers['x-trace-id'] || ''); return /^trc-[a-z0-9-]{6,40}$/.test(t) ? t : `trc-tarefas-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`; }
function timingSafeEq(a, b) { const ha = crypto.createHash('sha256').update(String(a)).digest(); const hb = crypto.createHash('sha256').update(String(b)).digest(); return crypto.timingSafeEqual(ha, hb); }
function seguro(req) { return IS_PROD || String(req.headers['x-forwarded-proto'] || '').includes('https'); }

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
function estatico(req, res, url) {
  let p = url.pathname === '/' ? '/index.html' : url.pathname;
  p = path.normalize(p).replace(/^(\.\.[/\\])+/, '');
  const f = path.join(PUBLIC_DIR, p);
  if (!f.startsWith(PUBLIC_DIR) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('não encontrado'); }
  res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream', 'cache-control': p === '/index.html' ? 'no-store' : 'public, max-age=300' });
  fs.createReadStream(f).pipe(res);
}

// ---------- sugestões (cache + geração) ----------
let sugCache = { em: 0, dados: null };
async function sugestoesAtuais(forcar) {
  const guardadas = await db.sugestoesLer();
  const idade = guardadas.geradas_em ? Date.now() - Date.parse(guardadas.geradas_em) : Infinity;
  if (!forcar && idade < SUGESTOES_TTL_MS) return { ...guardadas, cobertura: sugCache.dados?.cobertura || null };
  const g = await sugestoes.gerar({ centerUrl: CENTER_URL, centerToken: CENTER_TOKEN, centralStateDir: process.env.CENTRAL_STATE_DIR || '', compromissosPath: process.env.COMPROMISSOS_PATH || '' }, guardadas.itens);
  const salvas = await db.sugestoesGravar(g.itens);
  sugCache = { em: Date.now(), dados: g };
  return { ...salvas, cobertura: g.cobertura };
}

/** Sugestão → card. Usado pela API (gaveta) e pelo MCP. Devolve { tarefa } ou { erro }. */
async function assumirSugestao(id, dono, quem, trace, venceEm) {
  const s = (await db.sugestoesLer()).itens.find((x) => x.id === id);
  if (!s) return { erro: 'sugestão não existe mais' };
  if (s.decisao === 'assumida') return { erro: `sugestão já virou a tarefa ${s.tarefa_id || ''}`.trim() };
  try {
    const vence = venceEm || new Date(Date.now() + 4 * 864e5).toISOString().slice(0, 10);
    const t = await db.criar({ titulo: s.titulo, area: s.area, dono, vence_em: vence, estado: 'todo', etapas: s.etapas.map((e) => ({ texto: e, feita: false })), notas: `Por quê: ${s.porque}\nFonte: ${s.fonte}`, origem: { tipo: 'sugestao', ref: s.chave } }, quem, trace);
    await db.sugestaoDecidir(s.id, 'assumida', quem, trace, t.id);
    auditar({ tipo: 'sugestao_assumida', quem, id: s.id, tarefa: t.id, dono, trace });
    return { tarefa: t };
  } catch (e) { return { erro: e.message }; }
}

// ---------- relato à Regência ----------
async function relato() {
  const tarefas = await db.listar();
  const r = store.resumo(tarefas);
  const achados = [];
  const hoje = store.hoje();
  const atrasadas = tarefas.filter((t) => t.estado !== 'done' && t.vence_em && t.vence_em < hoje).sort((a, b) => a.vence_em.localeCompare(b.vence_em));
  for (const t of atrasadas.slice(0, 5)) achados.push({ chave: `tarefas.atrasada.${t.id}`, severidade: hoje > new Date(Date.parse(t.vence_em) + 7 * 864e5).toISOString().slice(0, 10) ? 'alta' : 'media', titulo: `Tarefa atrasada desde ${t.vence_em}: ${t.titulo}`, evidencia: `dono ${store.PESSOAS[t.dono] || t.dono}, ${t.etapas.filter((e) => e.feita).length}/${t.etapas.length} etapas`, fonte: 'plan_tarefas', acao_proposta: 'concluir, mudar a data ou devolver ao quadro', dono: store.PESSOAS[t.dono] || t.dono, autonomia: 'autonomo_com_log' });
  if (atrasadas.length > 5) achados.push({ chave: 'tarefas.atrasadas.total', severidade: 'alta', titulo: `${atrasadas.length} tarefas atrasadas no total`, evidencia: `a mais antiga vence em ${atrasadas[0].vence_em}`, fonte: 'plan_tarefas', acao_proposta: 'abrir o Calendário e triar', dono: 'equipe', autonomia: 'autonomo_com_log' });
  return { agente: 'planejador', ts: new Date().toISOString(), trace_id: `trc-tarefas-${hoje.replace(/-/g, '')}`, status: 'ok', build: BUILD, motor: db.motor, kpis: { tarefas_abertas: r.abertas, tarefas_atrasadas: r.atrasadas, tarefas_hoje: r.hoje, concluidas_7d: r.concluidas_7d, marlon_abertas: r.por_pessoa.marlon.abertas, lucas_abertas: r.por_pessoa.lucas.abertas, julien_abertas: r.por_pessoa.julien.abertas }, achados, cobertura: { fontes: [`${db.motor} (livro de tarefas)`], lacunas: [] } };
}

// ---------- rotas ----------
async function api(req, res, url) {
  const rota = url.pathname.replace(/\/+$/, '');
  if (rota === '/api/relato') {
    if (!CENTER_TOKEN || !timingSafeEq(req.headers['x-center-key'] || '', CENTER_TOKEN)) { const s = auth.sessaoDe(req); if (!s) return erro(res, 401, 'chave da Central ou sessão necessária'); }
    return json(res, 200, await relato());
  }
  if (!auth.operacional) return erro(res, 503, 'serviço não configurado: faltam usuários ou TAREFAS_SECRET');

  if (rota === '/api/login' && req.method === 'POST') {
    const b = await lerCorpo(req);
    const r = auth.entrar(b.usuario, b.senha);
    auditar({ tipo: 'login', usuario: String(b.usuario || '').slice(0, 20), ok: !!r, ip: req.socket.remoteAddress });
    if (!r) return erro(res, 401, 'usuário ou senha não conferem');
    return json(res, 200, { usuario: r.usuario }, { 'set-cookie': auth.cookie(r.token, seguro(req)) });
  }
  const sessao = auth.sessaoDe(req);
  // pessoas = quem pode ser dono de tarefa (sempre as três); usuarios = quem pode entrar (pode ser só o admin)
  if (rota === '/api/eu') return json(res, 200, { usuario: sessao, pessoas: Object.entries(store.PESSOAS).map(([id, nome]) => ({ id, nome })), usuarios: auth.usuarios, build: BUILD, motor: db.motor, modelo: planejador.modeloLigado() ? 'ligado' : 'heurística' });
  if (!sessao) return erro(res, 401, 'entre com seu usuário');
  if (req.method !== 'GET' && req.headers['x-requested-with'] !== 'fetch') return erro(res, 403, 'origem não reconhecida');
  const trace = traceDe(req);
  const quem = sessao.id;
  const donoPadrao = store.PESSOAS[quem] ? quem : null; // admin não é dono de tarefa: precisa escolher alguém

  if (rota === '/api/logout' && req.method === 'POST') { auditar({ tipo: 'logout', quem }); return json(res, 200, { ok: true }, { 'set-cookie': auth.cookieSair(seguro(req)) }); }

  if (rota === '/api/tarefas' && req.method === 'GET') { const t = await db.listar(); return json(res, 200, { tarefas: t, resumo: store.resumo(t), hoje: store.hoje() }); }
  if (rota === '/api/tarefas' && req.method === 'POST') {
    const b = await lerCorpo(req);
    try {
      const t = await db.criar({ ...b, dono: b.dono || donoPadrao }, quem, trace); auditar({ tipo: 'tarefa_criada', quem, id: t.id, trace });
      // Card nascido do chat: fecha a conversa com o resultado, para o histórico contar a história inteira.
      if (b.origem && b.origem.tipo === 'chat') await db.conversaGravar({ quem, canal: 'app', papel: 'planejador', texto: `Card ${t.id} criado em "A fazer" para ${store.PESSOAS[t.dono] || t.dono}: ${t.titulo}`, tarefa_id: t.id, proposta_ref: String(b.origem.ref || ''), trace_id: trace });
      return json(res, 201, { tarefa: t });
    } catch (e) { return erro(res, 400, e.message); }
  }
  let m = rota.match(/^\/api\/tarefas\/(T-\d{8}-\d{4})$/);
  if (m && req.method === 'PATCH') {
    const b = await lerCorpo(req);
    try { const t = await db.atualizar(m[1], b, quem, trace); if (!t) return erro(res, 404, 'tarefa não existe'); auditar({ tipo: 'tarefa_atualizada', quem, id: m[1], campos: Object.keys(b), trace }); return json(res, 200, { tarefa: t }); }
    catch (e) { return erro(res, 400, e.message); }
  }
  if (m && req.method === 'DELETE') { const ok = await db.excluir(m[1], quem, trace); if (!ok) return erro(res, 404, 'tarefa não existe'); auditar({ tipo: 'tarefa_excluida', quem, id: m[1], trace }); return json(res, 200, { ok: true }); }
  m = rota.match(/^\/api\/tarefas\/(T-\d{8}-\d{4})\/eventos$/);
  if (m && req.method === 'GET') return json(res, 200, { eventos: await db.eventos(m[1]) });

  if (rota === '/api/planejar' && req.method === 'POST') {
    const b = await lerCorpo(req);
    const texto = String(b.texto || '').trim();
    if (texto.length < 4) return erro(res, 400, 'escreva o que precisa ser feito');
    if (texto.length > 2000) return erro(res, 400, 'texto longo demais (máx. 2000 caracteres)');
    const p = await planejador.decompor(texto, { donoPadrao });
    auditar({ tipo: 'planejar', quem, chars: texto.length, modelo: p.origem_modelo, custo: p.custo || null, trace });
    // Histórico por pessoa (03/11): a mensagem e a proposta ficam gravadas; o id da proposta volta para ligar o card.
    await db.conversaGravar({ quem, canal: 'app', papel: 'pessoa', texto, trace_id: trace });
    const mr = await db.conversaGravar({ quem, canal: 'app', papel: 'planejador', proposta: p, trace_id: trace });
    return json(res, 200, { proposta: p, conversa_id: mr.id });
  }
  if (rota === '/api/chat' && req.method === 'GET') {
    // Cada pessoa vê a própria conversa; o admin vê todas (é quem opera o app pelos três e pelo Claude).
    const limite = Math.min(200, Math.max(1, Number(url.searchParams.get('limite')) || 50));
    return json(res, 200, { mensagens: await db.conversaLer({ quem: quem === 'admin' ? null : quem, limite }) });
  }

  if (rota === '/api/sugestoes' && req.method === 'GET') {
    const s = await sugestoesAtuais(url.searchParams.get('atualizar') === '1');
    return json(res, 200, { geradas_em: s.geradas_em, itens: s.itens.filter((x) => !x.decisao), decididas: s.itens.filter((x) => x.decisao).length, cobertura: s.cobertura });
  }
  m = rota.match(/^\/api\/sugestoes\/(s-[a-f0-9]{12})\/(assumir|descartar)$/);
  if (m && req.method === 'POST') {
    const b = await lerCorpo(req);
    const s = (await db.sugestoesLer()).itens.find((x) => x.id === m[1]);
    if (!s) return erro(res, 404, 'sugestão não existe mais');
    if (m[2] === 'descartar') { await db.sugestaoDecidir(s.id, 'descartada', quem, trace); auditar({ tipo: 'sugestao_descartada', quem, id: s.id, trace }); return json(res, 200, { ok: true }); }
    const r = await assumirSugestao(s.id, b.dono || donoPadrao, quem, trace, b.vence_em);
    if (r.erro) return erro(res, 400, r.erro);
    return json(res, 201, { tarefa: r.tarefa });
  }
  return erro(res, 404, 'rota não existe');
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('referrer-policy', 'same-origin');
  if (url.pathname === '/health') return json(res, 200, { ok: true, build: BUILD, motor: db.motor, operacional: auth.operacional, modelo: planejador.modeloLigado() ? 'ligado' : 'heurística', leitura: { central: CENTER_URL ? 'api' : 'arquivo', banco: !!process.env.DATABASE_URL_RO }, mcp: { rota: '/mcp', issuer: TAREFAS_URL || 'derivado do host', ferramentas: mcp.FERRAMENTAS.length } });
  // ---- conector MCP: OAuth (metadados, registro, login, token) e o próprio /mcp ----
  if (url.pathname.startsWith('/.well-known/oauth-') || url.pathname.startsWith('/oauth/')) {
    if (!auth.operacional) return erro(res, 503, 'serviço não configurado: faltam usuários ou TAREFAS_SECRET');
    try { if (await oauth.tratar(req, res, url)) return; } catch (e) { console.error('[oauth]', url.pathname, e && e.message); if (!res.headersSent) return erro(res, 500, 'falha interna'); return; }
    return erro(res, 404, 'rota não existe');
  }
  if (url.pathname === '/mcp') {
    if (!auth.operacional) return erro(res, 503, 'serviço não configurado: faltam usuários ou TAREFAS_SECRET');
    const ident = oauth.identidade(req);
    if (!ident) return json(res, 401, { erro: 'autorize o conector (OAuth) para usar o COMPASSO' }, oauth.cabecalho401(req));
    let corpo = {};
    if (req.method === 'POST') { try { corpo = await lerCorpo(req); } catch (e) { return json(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: e.message } }); } }
    try { await mcp.tratar(req, res, corpo, ident, traceDe(req)); }
    catch (e) { console.error('[mcp]', e && e.message); if (!res.headersSent) json(res, 500, { jsonrpc: '2.0', id: null, error: { code: -32603, message: 'falha interna' } }); }
    return;
  }
  if (url.pathname.startsWith('/api/')) {
    try { await api(req, res, url); }
    catch (e) { console.error('[api]', url.pathname, e && e.message); if (!res.headersSent) erro(res, 500, 'falha interna: ' + String(e && e.message || e).slice(0, 120)); }
    return;
  }
  if (req.method !== 'GET') { res.writeHead(405); return res.end(); }
  return estatico(req, res, url);
});

function iniciar() {
  return db.pronto().then(() => {
    server.listen(PORT, () => console.log(`[tarefas] COMPASSO Tarefas ${BUILD} em http://localhost:${PORT} · motor ${db.motor} · estado ${STATE_DIR} · modelo ${planejador.modeloLigado() ? 'ligado' : 'heurística'} · ${auth.operacional ? 'operacional' : 'NÃO OPERACIONAL'}`));
  }).catch((e) => { console.error('[tarefas] armazenamento indisponível:', e.message); process.exit(1); });
}
if (require.main === module) iniciar();

module.exports = { server, api, relato, db, BUILD, iniciar };
