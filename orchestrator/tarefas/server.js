'use strict';
/**
 * COMPASSO Tarefas — servidor. Zero dependências além do SDK (e pg opcional). Node >= 18.
 *
 * O que é: o gerenciador de tarefas de três pessoas (Márlon, Lucas, Julien). Abre no que fazer hoje, muda na hora para
 * todo mundo (tempo real), não perde nada e entende frases. Nada além disso.
 *
 * Integração com a frota (por API, não por acoplamento):
 *   - GET /api/relato (X-Center-Key)  → relato no contrato da Regência (kpis + achados), para o Despacho do MAESTRO
 *   - sugestões lidas dos sinais existentes (compromissos, achados do vigia, Central, banco via twk_ro)
 *   - auditoria: STATE_DIR/logs/audit-AAAA-MM-DD.jsonl com quem fez o quê; o ledger de eventos é append-only
 *
 * Segurança (doutrina fail-closed): produção sem TAREFAS_SECRET ou sem usuários → 503 em tudo menos /health.
 * Livro ilegível e irrecuperável → 503 com o motivo, nunca um quadro vazio. Nenhuma rota envia nada para fora.
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const store = require('./store.js');
const authMod = require('./auth.js');
const planejador = require('./planejador.js');
const sugestoes = require('./sugestoes.js');
const oauthMod = require('./oauth.js');
const mcpMod = require('./mcp.js');
const nucleo = store.nucleo;

const BUILD = '1.2.1-etapa-modal-20261109';
const PORT = Number(process.env.PORT || 8790);
const IS_PROD = process.env.NODE_ENV === 'production';
const STATE_DIR = path.resolve(process.env.STATE_DIR || path.join(__dirname, 'state'));
const PUBLIC_DIR = path.join(__dirname, 'public');
const CENTER_TOKEN = process.env.CENTER_TOKEN || '';
// Com CENTER_URL, as sugestões leem as filas da Central (achados, perguntas, aprovações, compromissos) pela API
// com a mesma chave; sem ela, só do disco (máquina do Orquestrador) — e o banco, se houver DATABASE_URL_RO.
const CENTER_URL = String(process.env.CENTER_URL || '').replace(/\/+$/, '');
const SUGESTOES_TTL_MS = Number(process.env.TAREFAS_SUGESTOES_TTL_MIN || 60) * 60000;
// Marco zero (03/11, decisão do fundador): sinais nascidos antes desta data (AAAA-MM-DD) não viram sugestão.
const MARCO_ZERO = /^\d{4}-\d{2}-\d{2}$/.test(process.env.TAREFAS_MARCO_ZERO || '') ? process.env.TAREFAS_MARCO_ZERO : null;
if (process.env.TAREFAS_MARCO_ZERO && !MARCO_ZERO) console.error('[tarefas] TAREFAS_MARCO_ZERO ignorado: use AAAA-MM-DD.');

fs.mkdirSync(path.join(STATE_DIR, 'logs'), { recursive: true });
const db = store.abrir({ stateDir: STATE_DIR, databaseUrl: process.env.TAREFAS_DATABASE_URL || '' });
let livroFatal = null; // livro que não abre: tudo responde 503 com o motivo, nada é escrito por cima
let auth;
try { auth = authMod.criar({ stateDir: STATE_DIR, isProd: IS_PROD, segredo: process.env.TAREFAS_SECRET || '' }); }
catch (e) { console.error('[auth]', e.message); auth = { operacional: false, usuarios: [], sessaoDe: () => null }; }
if (!auth.operacional) console.error('[tarefas] NÃO OPERACIONAL: faltam usuários (TAREFAS_USUARIOS ou state/usuarios.json) ou TAREFAS_SECRET — a API responde 503.');

/** IP real atrás de um proxy (EasyPanel/Traefik): o último da lista é o que o proxy viu; os anteriores o cliente pode forjar. */
function ipDe(req) { const x = String(req.headers['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean); return x[x.length - 1] || req.socket.remoteAddress || ''; }
// Por IP o freio é curto. Por usuário é largo: serve contra ataque distribuído, sem deixar que erros de outros IPs tranquem a dona da conta.
const freioLogin = authMod.criarFreio({ max: (c) => (c.startsWith('u:') ? 50 : 8), janelaMs: 15 * 60 * 1000 });

// Conector MCP: o chat do Claude e o Claude Code entram por OAuth com o login do app e agem em nome de quem autorizou.
const TAREFAS_URL = String(process.env.TAREFAS_URL || '').replace(/\/+$/, '');
const oauth = oauthMod.criar({ auth, stateDir: STATE_DIR, urlPublica: TAREFAS_URL, auditar, freio: freioLogin, ipDe });
const mcp = mcpMod.criar({ db, store, planejador, sugestoesAtuais, assumirSugestao, auditar, build: BUILD });

// ---------- util ----------
function json(res, code, obj, extra) {
  const corpo = Buffer.from(JSON.stringify(obj));
  const h = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...(extra || {}) };
  const aceita = String(res.req?.headers?.['accept-encoding'] || '').includes('gzip');
  if (aceita && corpo.length > 1400) {
    zlib.gzip(corpo, { level: 6 }, (e, gz) => { if (e) { res.writeHead(code, h); return res.end(corpo); } res.writeHead(code, { ...h, 'content-encoding': 'gzip', vary: 'accept-encoding' }); res.end(gz); });
    return;
  }
  res.writeHead(code, h); res.end(corpo);
}
function erro(res, code, msg, extra) { json(res, code, { erro: msg, ...(extra || {}) }); }
class ErroDeCorpo extends Error { constructor(msg, http) { super(msg); this.http = http; } }
function lerCorpo(req) {
  return new Promise((resolve, reject) => {
    let tam = 0; const partes = [];
    req.on('data', (c) => { tam += c.length; if (tam > 64 * 1024) { reject(new ErroDeCorpo('corpo acima de 64 KB', 413)); req.destroy(); } else partes.push(c); });
    req.on('end', () => { if (!partes.length) return resolve({}); try { const v = JSON.parse(Buffer.concat(partes).toString('utf8')); if (v === null || typeof v !== 'object') return reject(new ErroDeCorpo('JSON inválido', 400)); resolve(v); } catch { reject(new ErroDeCorpo('JSON inválido', 400)); } });
    req.on('error', reject);
  });
}
function auditar(ev) { try { fs.appendFileSync(path.join(STATE_DIR, 'logs', `audit-${store.hoje()}.jsonl`), JSON.stringify({ ts: new Date().toISOString(), ...ev }) + '\n', 'utf8'); } catch { /* nunca derruba a requisição */ } }
/** Um trace por requisição, ou o que veio de fora. Antes todo evento do dia dividia o mesmo e a auditoria não reconstruía nada. */
function traceDe(req) { const t = String(req.headers['x-trace-id'] || ''); return /^trc-[a-z0-9-]{6,40}$/.test(t) ? t : `trc-tarefas-${store.hoje().replace(/-/g, '')}-${crypto.randomBytes(3).toString('hex')}`; }
function timingSafeEq(a, b) { const ha = crypto.createHash('sha256').update(String(a)).digest(); const hb = crypto.createHash('sha256').update(String(b)).digest(); return crypto.timingSafeEqual(ha, hb); }
function seguro(req) { return IS_PROD || String(req.headers['x-forwarded-proto'] || '').includes('https'); }
function chaveCentralOk(req) { return !!CENTER_TOKEN && timingSafeEq(req.headers['x-center-key'] || '', CENTER_TOKEN); }

function cabecalhosDeSeguranca(req, res, url) {
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('referrer-policy', 'same-origin');
  res.setHeader('x-frame-options', 'DENY');
  res.setHeader('permissions-policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  if (seguro(req)) res.setHeader('strict-transport-security', 'max-age=15552000');
  // A tela OAuth devolve o acesso por redirecionamento a outro endereço depois do POST: form-action não pode prendê-la.
  const form = url.pathname.startsWith('/oauth/') ? '' : " form-action 'self';";
  res.setHeader('content-security-policy', `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; manifest-src 'self'; worker-src 'self'; frame-ancestors 'none'; base-uri 'none';${form}`);
}

// ---------- arquivos da interface: em memória, comprimidos e com versão no endereço ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
const COMPRIMIVEL = new Set(['.html', '.css', '.js', '.svg', '.webmanifest']);
let ativosEmCache = null;
function carregarAtivos() {
  const mapa = new Map();
  const nomes = fs.readdirSync(PUBLIC_DIR).filter((n) => MIME[path.extname(n)] && fs.statSync(path.join(PUBLIC_DIR, n)).isFile());
  const brutos = nomes.map((n) => [n, fs.readFileSync(path.join(PUBLIC_DIR, n))]);
  const versao = crypto.createHash('sha1').update(BUILD); for (const [n, b] of brutos) if (n !== 'index.html') versao.update(n).update(b);
  const v = versao.digest('hex').slice(0, 10);
  for (const [n, b0] of brutos) {
    const ext = path.extname(n);
    // index.html e o service worker carregam a versão: asset novo = endereço novo, cache antigo nunca serve código velho.
    const b = n === 'index.html' || n === 'sw.js' ? Buffer.from(b0.toString('utf8').replaceAll('__V__', v)) : b0;
    mapa.set('/' + n, { corpo: b, gz: COMPRIMIVEL.has(ext) ? zlib.gzipSync(b, { level: 9 }) : null, etag: `"${crypto.createHash('sha1').update(b).digest('hex').slice(0, 16)}"`, mime: MIME[ext], ext });
  }
  return { mapa, v };
}
const ativos = () => { if (IS_PROD && ativosEmCache) return ativosEmCache; const a = carregarAtivos(); if (IS_PROD) ativosEmCache = a; return a; };

function estatico(req, res, url) {
  const p = url.pathname === '/' ? '/index.html' : url.pathname;
  const { mapa, v } = ativos();
  const a = mapa.get(p);
  if (!a) { res.writeHead(404); return res.end('não encontrado'); }
  const entrada = p === '/index.html' || p === '/sw.js' || p === '/manifest.webmanifest';
  const versionado = url.searchParams.get('v') === v;
  const h = { 'content-type': a.mime, etag: a.etag, vary: 'accept-encoding', 'cache-control': entrada ? 'no-cache' : versionado ? 'public, max-age=31536000, immutable' : 'public, max-age=300' };
  if (req.headers['if-none-match'] === a.etag) { res.writeHead(304, h); return res.end(); }
  const usaGz = a.gz && String(req.headers['accept-encoding'] || '').includes('gzip');
  res.writeHead(200, usaGz ? { ...h, 'content-encoding': 'gzip' } : h);
  res.end(req.method === 'HEAD' ? undefined : usaGz ? a.gz : a.corpo);
}

// ---------- tempo real: quem está com o app aberto vê a mudança no mesmo segundo ----------
const conexoes = new Set();
function transmitir(evento, dados) {
  const s = `event: ${evento}\ndata: ${JSON.stringify(dados)}\n\n`;
  for (const c of conexoes) { try { c.write(s); } catch { conexoes.delete(c); } }
}
db.assinar((m) => transmitir('mudanca', m));
setInterval(() => { for (const c of conexoes) { try { c.write(': pulso\n\n'); } catch { conexoes.delete(c); } } }, 25000).unref();

// ---------- sugestões: resposta na hora com o que está guardado; a releitura das fontes acontece por trás ----------
let sugCache = { em: 0, dados: null, normalizados: [] };
let sugEmAndamento = null;
function regenerarSugestoes() {
  if (sugEmAndamento) return sugEmAndamento;
  sugEmAndamento = (async () => {
    const inicio = new Date().toISOString();
    const guardadas = await db.sugestoesLer();
    const todas = await db.listar({ arquivadas: 'todas' });
    const abertas = new Set(todas.filter((t) => t.estado !== 'done').map((t) => t.id));
    const g = await sugestoes.gerar({ centerUrl: CENTER_URL, centerToken: CENTER_TOKEN, centralStateDir: process.env.CENTRAL_STATE_DIR || '', compromissosPath: process.env.COMPROMISSOS_PATH || '', marcoZero: MARCO_ZERO }, guardadas.itens, { tarefasAbertas: abertas });
    // Alguém decidiu enquanto as fontes eram lidas: a decisão vale mais que a leitura, senão o mesmo card nasceria duas vezes.
    const recentes = new Map((await db.sugestoesLer()).itens.filter((x) => x.decisao && x.decidida_em >= inicio).map((x) => [x.id, x]));
    const itens = g.itens.map((s) => (recentes.has(s.id) ? { ...s, ...recentes.get(s.id) } : s));
    for (const [id, d] of recentes) if (!itens.some((s) => s.id === id)) itens.push(d);
    const salvas = await db.sugestoesGravar(itens, { marco_zero: MARCO_ZERO });
    sugCache = { em: Date.now(), dados: g, normalizados: sugestoes.sinaisNormalizados(todas, g) };
    transmitir('sugestoes', { vivas: salvas.itens.filter((x) => !x.decisao).length, normalizados: sugCache.normalizados });
    return { ...salvas, cobertura: g.cobertura };
  })().finally(() => { sugEmAndamento = null; });
  return sugEmAndamento;
}
async function sugestoesAtuais(forcar) {
  const guardadas = await db.sugestoesLer();
  const idade = guardadas.geradas_em ? Date.now() - Date.parse(guardadas.geradas_em) : Infinity;
  // marco zero diferente do que gerou a lista guardada = a lista velha não vale mais: regenera já
  const velhaDeMais = (guardadas.marco_zero || null) !== MARCO_ZERO || !guardadas.geradas_em;
  if (forcar || velhaDeMais) return regenerarSugestoes();
  if (idade >= SUGESTOES_TTL_MS || !sugCache.dados) regenerarSugestoes().catch((e) => console.error('[sugestoes]', e.message));
  return { ...guardadas, cobertura: sugCache.dados?.cobertura || null };
}

/** Sugestão → card. Usado pela API (gaveta) e pelo MCP. Devolve { tarefa } ou { erro }. Prazo e prioridade vêm do sinal. */
const assumindo = new Set();
async function assumirSugestao(id, dono, quem, trace, venceEm) {
  if (assumindo.has(id)) return { erro: 'esta sugestão já está virando card' }; // duplo clique, ou duas pessoas ao mesmo tempo
  assumindo.add(id);
  try {
    const s = (await db.sugestoesLer()).itens.find((x) => x.id === id);
    if (!s) return { erro: 'sugestão não existe mais' };
    if (s.decisao === 'assumida') return { erro: `sugestão já virou a tarefa ${s.tarefa_id || ''}`.trim() };
    const t = await db.criar({ titulo: s.titulo, area: s.area, dono: dono || s.dono_sugerido, vence_em: venceEm || s.vence_sugerido || null, estado: 'todo', prioridade: s.prioridade_fixa || s.severidade === 'alta' ? 'alta' : 'normal', referencia: s.referencia || '', etapas: s.etapas.map((e) => ({ texto: e, feita: false })), notas: `Por quê: ${s.porque}\nFonte: ${s.fonte}`, origem: { tipo: 'sugestao', ref: s.chave } }, quem, trace);
    await db.sugestaoDecidir(s.id, 'assumida', quem, trace, t.id);
    auditar({ tipo: 'sugestao_assumida', quem, id: s.id, tarefa: t.id, dono: t.dono, trace });
    return { tarefa: t };
  } catch (e) { return { erro: e.message }; }
  finally { assumindo.delete(id); }
}

// ---------- durabilidade: o app denuncia quando o estado pode sumir e quando precisou se recuperar ----------
// O livro em arquivo vive em STATE_DIR. Em produção isso TEM de ser um volume montado pelo EasyPanel em /app/state.
const INICIO = new Date().toISOString();
function durabilidade() {
  const info = { state_dir: STATE_DIR, motor: db.motor, processo_desde: INICIO };
  try { const linhas = fs.readFileSync('/proc/mounts', 'utf8').split('\n'); info.volume_montado = linhas.some((l) => l.split(' ')[1] === STATE_DIR); } catch { info.volume_montado = null; }
  const marca = path.join(STATE_DIR, 'estado-desde.txt');
  try { if (!fs.existsSync(marca)) fs.writeFileSync(marca, INICIO, 'utf8'); info.estado_desde = fs.readFileSync(marca, 'utf8').trim(); } catch (e) { info.estado_desde = null; info.erro_escrita = e.message; }
  info.sobreviveu_a_reinicio = !!info.estado_desde && info.estado_desde < INICIO;
  const s = db.saude();
  if (db.motor === 'arquivo') {
    info.tarefas = s.tarefas; info.eventos = s.eventos; info.linhas_ilegiveis = s.linhas_ilegiveis;
    if (s.recuperado) { info.recuperado_de = s.recuperado; info.arquivo_corrompido_guardado = s.corrompido_em; }
    try { info.copias = fs.readdirSync(path.join(STATE_DIR, 'backups')).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().slice(-3); } catch { info.copias = []; }
  }
  if (livroFatal) info.aviso = `Livro indisponível: ${livroFatal}`;
  else if (info.erro_escrita) info.aviso = `STATE_DIR não aceita escrita (${info.erro_escrita}): nada será guardado.`;
  else if (s.recuperado) info.aviso = `O livro abriu com tarefas.json ilegível e foi reconstruído a partir de: ${s.recuperado}. Conferir o quadro; o arquivo original está guardado ao lado.`;
  else if (db.motor === 'arquivo' && info.volume_montado === false) info.aviso = 'STATE_DIR não é um volume montado: tarefas, histórico e auditoria SOMEM no próximo deploy. No EasyPanel, monte um volume persistente em /app/state.';
  return info;
}
/** Cópia diária do livro no próprio volume, 14 dias. Protege de erro de operação, não de volume ausente. */
function copiaDeSeguranca() {
  try { return db.copiar(store.hoje()); }
  catch (e) { console.error('[tarefas] cópia de segurança falhou:', e.message); return null; }
}

// ---------- relato à Regência ----------
async function relato() {
  const todas = await db.listar({ arquivadas: 'todas' });
  const tarefas = todas.filter((t) => !t.arquivada_em);
  const r = store.resumo(todas);
  const achados = [];
  const hoje = store.hoje();
  const saude = db.saude();
  if (saude.recuperado) achados.push({ chave: 'tarefas.livro_recuperado', severidade: 'alta', titulo: 'O livro de tarefas abriu com o arquivo ilegível e foi reconstruído', evidencia: `reconstruído de: ${saude.recuperado}; original guardado como ${saude.corrompido_em}`, fonte: 'tarefas.json', acao_proposta: 'conferir o quadro e descartar o arquivo guardado', dono: 'equipe', autonomia: 'requer_aprovacao_humana' });
  const atrasadas = tarefas.filter((t) => t.estado !== 'done' && t.vence_em && t.vence_em < hoje).sort((a, b) => a.vence_em.localeCompare(b.vence_em));
  for (const t of atrasadas.slice(0, 5)) achados.push({ chave: `tarefas.atrasada.${t.id}`, severidade: nucleo.diasEntre(t.vence_em, hoje) > 7 ? 'alta' : 'media', titulo: `Tarefa atrasada desde ${t.vence_em}: ${t.titulo}`, evidencia: `dono ${store.PESSOAS[t.dono] || t.dono}, ${t.etapas.filter((e) => e.feita).length}/${t.etapas.length} etapas`, fonte: 'plan_tarefas', acao_proposta: 'concluir, mudar a data ou devolver ao quadro', dono: store.PESSOAS[t.dono] || t.dono, autonomia: 'autonomo_com_log' });
  if (atrasadas.length > 5) achados.push({ chave: 'tarefas.atrasadas.total', severidade: 'alta', titulo: `${atrasadas.length} tarefas atrasadas no total`, evidencia: `a mais antiga vence em ${atrasadas[0].vence_em}`, fonte: 'plan_tarefas', acao_proposta: 'abrir o Calendário e triar', dono: 'equipe', autonomia: 'autonomo_com_log' });
  if (r.cobrar) achados.push({ chave: 'tarefas.cobrar', severidade: 'media', titulo: `${r.cobrar} tarefa${r.cobrar === 1 ? '' : 's'} aguardando terceiro com a cobrança vencida`, evidencia: 'estado Aguardando com data de cobrança hoje ou antes, ou sem data', fonte: 'plan_tarefas', acao_proposta: 'cobrar quem está devendo a resposta', dono: 'equipe', autonomia: 'autonomo_com_log' });
  return { agente: 'planejador', ts: new Date().toISOString(), trace_id: `trc-tarefas-${hoje.replace(/-/g, '')}`, status: livroFatal ? 'erro' : 'ok', build: BUILD, motor: db.motor, kpis: { tarefas_abertas: r.abertas, tarefas_atrasadas: r.atrasadas, tarefas_hoje: r.hoje, tarefas_cobrar: r.cobrar, tarefas_paradas_7d: r.paradas_7d, concluidas_7d: r.concluidas_7d, no_prazo_30d_pct: r.no_prazo_30d_pct, ciclo_mediano_dias: r.ciclo_mediano_dias, tarefas_arquivadas: todas.length - tarefas.length, marlon_abertas: r.por_pessoa.marlon.abertas, lucas_abertas: r.por_pessoa.lucas.abertas, julien_abertas: r.por_pessoa.julien.abertas }, achados, cobertura: { fontes: [`${db.motor} (livro de tarefas)`], lacunas: [] } };
}

// ---------- novidades: o que mudou nos cards da pessoa, feito por outra pessoa ----------
const TIPOS_NOVIDADE = new Set(['criada', 'estado', 'atualizada', 'comentario', 'excluida', 'arquivada']);
function relevanteParaMim(ev, card, pessoa, login) {
  const autor = String(ev.quem || '');
  const ehClaude = /via Claude$/.test(autor);
  if (!ehClaude && autor === login) return false; // o que eu mesmo fiz não é novidade para mim
  if (ev.tipo === 'atualizada' && !(ev.mudou && (ev.mudou.dono || ev.mudou.vence_em || ev.mudou.prioridade || ev.mudou.resultado))) return false; // ruído
  if (!pessoa) return true;
  if ((ev.mencoes || []).includes(pessoa)) return true;
  if (ev.mudou && ev.mudou.dono && ev.mudou.dono.para === pessoa) return true;
  if (ev.para && ev.para.dono === pessoa) return true;
  if (ev.de && ev.de.dono === pessoa) return true;
  return !!card && card.dono === pessoa;
}
async function novidades(pessoa, login) {
  const [evs, cards] = await Promise.all([db.eventos(null, 400), db.listar({ arquivadas: 'todas' })]);
  const porId = new Map(cards.map((c) => [c.id, c]));
  return evs.filter((e) => TIPOS_NOVIDADE.has(e.tipo) && e.tarefa_id).filter((e) => relevanteParaMim(e, porId.get(e.tarefa_id), pessoa, login)).slice(-40).reverse().map((e) => ({ seq: e.seq, ts: e.ts, tipo: e.tipo, tarefa_id: e.tarefa_id, titulo: porId.get(e.tarefa_id)?.titulo || e.de?.titulo || e.para?.titulo || e.tarefa_id, quem: e.quem, estado: e.mudou?.estado?.para || null, dono: e.mudou?.dono?.para || null, vence_em: e.mudou?.vence_em ? e.mudou.vence_em.para : undefined, texto: e.tipo === 'comentario' ? String(e.texto || '').slice(0, 160) : e.tipo === 'excluida' ? e.motivo : undefined }));
}

// ---------- rotas ----------
async function api(req, res, url) {
  const rota = url.pathname.replace(/\/+$/, '');
  if (livroFatal) return erro(res, 503, `Livro indisponível: ${livroFatal}`);
  if (rota === '/api/relato') {
    if (!chaveCentralOk(req)) { const s = auth.sessaoDe(req); if (!s || s.trocar) return erro(res, 401, 'chave da Central ou sessão necessária'); }
    return json(res, 200, await relato());
  }
  if (!auth.operacional) return erro(res, 503, 'serviço não configurado: faltam usuários ou TAREFAS_SECRET');

  if (rota === '/api/login' && req.method === 'POST') {
    const b = await lerCorpo(req);
    const usuario = String(b.usuario || '').slice(0, 20).toLowerCase();
    const ip = ipDe(req);
    const chaves = [`ip:${ip}`, `u:${usuario}`];
    const espera = freioLogin.bloqueado(chaves);
    if (espera) { auditar({ tipo: 'login_bloqueado', usuario, ip }); return erro(res, 429, `Muitas tentativas. Espere ${Math.ceil(espera / 60)} min.`, { espera_s: espera }); }
    freioLogin.falhou(chaves); // conta antes de conferir: tentativas em paralelo não passam juntas
    const r = await auth.entrarAsync(usuario, b.senha);
    auditar({ tipo: 'login', usuario, ok: !!r, ip });
    if (!r) return erro(res, 401, 'usuário ou senha não conferem');
    freioLogin.acertou(chaves);
    return json(res, 200, { usuario: r.usuario }, { 'set-cookie': auth.cookie(r.token, seguro(req)) });
  }
  const sessao = auth.sessaoDe(req);
  // pessoas = quem pode ser dono de tarefa (sempre as três); usuarios = quem pode entrar (pode ser só o admin)
  if (rota === '/api/eu') {
    const publico = { usuario: sessao, pessoas: Object.entries(store.PESSOAS).map(([id, nome]) => ({ id, nome })), usuarios: auth.usuarios };
    if (!sessao) return json(res, 200, publico); // sem login: só o necessário para a tela de entrada
    return json(res, 200, { ...publico, areas: store.AREAS, canais: store.CANAIS, prioridades: store.PRIORIDADES, repeticoes: store.REPETICOES, fuso: store.FUSO, build: BUILD, motor: db.motor, modelo: planejador.modeloLigado() ? 'ligado' : 'heurística' });
  }
  if (!sessao) return erro(res, 401, 'entre com seu usuário');
  if (req.method !== 'GET' && req.headers['x-requested-with'] !== 'fetch') return erro(res, 403, 'origem não reconhecida');
  const trace = traceDe(req);
  const quem = sessao.id;
  const donoPadrao = store.PESSOAS[quem] ? quem : null; // admin não é dono de tarefa: precisa escolher alguém

  if (rota === '/api/logout' && req.method === 'POST') { auditar({ tipo: 'logout', quem }); return json(res, 200, { ok: true }, { 'set-cookie': auth.cookieSair(seguro(req)) }); }

  // Trocar a senha: com a atual, sempre; na senha provisória, é a única coisa que o app deixa fazer.
  if (rota === '/api/senha' && req.method === 'POST') {
    const b = await lerCorpo(req);
    const chaves = [`ip:${ipDe(req)}`, `u:${quem}`];
    const espera = freioLogin.bloqueado(chaves);
    if (espera) { auditar({ tipo: 'senha_bloqueada', quem }); return erro(res, 429, `Muitas tentativas. Espere ${Math.ceil(espera / 60)} min.`, { espera_s: espera }); }
    freioLogin.falhou(chaves);
    const r = await auth.trocarSenha(quem, b.atual, b.nova);
    if (r.erro) { if (!r.senha_atual) freioLogin.acertou(chaves); auditar({ tipo: 'senha_recusada', quem, motivo: r.senha_atual ? 'atual' : 'regra' }); return erro(res, 400, r.erro, { senha_atual: !!r.senha_atual }); }
    freioLogin.acertou(chaves);
    auditar({ tipo: 'senha_trocada', quem, trace });
    return json(res, 200, { usuario: r.usuario }, { 'set-cookie': auth.cookie(r.token, seguro(req)) });
  }
  if (sessao.trocar) return erro(res, 403, 'Escolha a sua senha antes de continuar.', { trocar_senha: true });

  // Tempo real (SSE). Um canal por aba; o pulso mantém a conexão viva atrás do proxy.
  if (rota === '/api/stream' && req.method === 'GET') {
    if (conexoes.size >= 200) return erro(res, 503, 'conexões demais');
    res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' });
    res.write(`retry: 4000\nevent: ola\ndata: ${JSON.stringify({ seq: await db.ultimoSeq(), hoje: store.hoje() })}\n\n`);
    conexoes.add(res);
    req.on('close', () => conexoes.delete(res));
    return undefined;
  }

  if (rota === '/api/tarefas' && req.method === 'GET') {
    const seq = await db.ultimoSeq();
    // Nada mudou desde o que o navegador já tem: resposta de poucos bytes.
    if (Number(url.searchParams.get('desde')) === seq && seq > 0) return json(res, 200, { inalterado: true, seq, hoje: store.hoje() });
    const todas = await db.listar({ arquivadas: 'todas' });
    const vivas = todas.filter((t) => !t.arquivada_em);
    return json(res, 200, { tarefas: vivas, resumo: store.resumo(todas), hoje: store.hoje(), seq, arquivadas: todas.length - vivas.length, normalizados: sugCache.normalizados });
  }
  // Arquivo: concluídas arquivadas saem do quadro mas ficam consultáveis aqui, no MCP e no relato.
  if (rota === '/api/arquivo' && req.method === 'GET') {
    const q = String(url.searchParams.get('q') || '').trim().toLowerCase();
    let t = await db.listar({ arquivadas: true });
    if (q) t = t.filter((x) => [x.titulo, x.notas, x.referencia, x.cidade, x.resultado, x.area, x.dono, ...(x.comentarios || []).map((c) => c.texto)].join(' ').toLowerCase().includes(q));
    t.sort((a, b) => String(b.arquivada_em).localeCompare(String(a.arquivada_em)));
    return json(res, 200, { tarefas: t.slice(0, 200), total: t.length });
  }
  if (rota === '/api/novidades' && req.method === 'GET') {
    const p = url.searchParams.get('pessoa');
    const pessoa = store.PESSOAS[p] ? p : store.PESSOAS[quem] ? quem : null;
    return json(res, 200, { itens: await novidades(pessoa, quem), pessoa });
  }
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
  if (m && req.method === 'GET') { const t = await db.obter(m[1]); return t ? json(res, 200, { tarefa: t }) : erro(res, 404, 'tarefa não existe'); }
  if (m && req.method === 'PATCH') {
    const { base, ...patch } = await lerCorpo(req);
    try {
      const t = await db.atualizar(m[1], patch, quem, trace, { base });
      if (!t) return erro(res, 404, 'tarefa não existe');
      auditar({ tipo: 'tarefa_atualizada', quem, id: m[1], campos: Object.keys(patch), trace });
      return json(res, 200, { tarefa: t });
    } catch (e) {
      if (e instanceof store.ErroConflito) { auditar({ tipo: 'tarefa_conflito', quem, id: m[1], campos: e.conflito, trace }); return erro(res, 409, e.message, { conflito: e.conflito, tarefa: e.tarefa }); }
      return erro(res, 400, e.message);
    }
  }
  if (m && req.method === 'DELETE') {
    // Excluir exige motivo (corpo JSON {motivo} ou ?motivo=) e só vale antes de concluir; concluída se arquiva.
    const b = await lerCorpo(req).catch(() => ({}));
    const motivo = b.motivo !== undefined ? b.motivo : url.searchParams.get('motivo');
    try { const ok = await db.excluir(m[1], quem, trace, motivo); if (!ok) return erro(res, 404, 'tarefa não existe'); auditar({ tipo: 'tarefa_excluida', quem, id: m[1], motivo: String(motivo).slice(0, 300), trace }); return json(res, 200, { ok: true }); }
    catch (e) { return erro(res, 400, e.message); }
  }
  m = rota.match(/^\/api\/tarefas\/(T-\d{8}-\d{4})\/(arquivar|desarquivar)$/);
  if (m && req.method === 'POST') {
    try { const t = await db[m[2]](m[1], quem, trace); if (!t) return erro(res, 404, 'tarefa não existe'); auditar({ tipo: `tarefa_${m[2] === 'arquivar' ? 'arquivada' : 'desarquivada'}`, quem, id: m[1], trace }); return json(res, 200, { tarefa: t }); }
    catch (e) { return erro(res, 400, e.message); }
  }
  m = rota.match(/^\/api\/tarefas\/(T-\d{8}-\d{4})\/comentarios$/);
  if (m && req.method === 'POST') {
    const b = await lerCorpo(req);
    try { const t = await db.comentar(m[1], b.texto, quem, trace); if (!t) return erro(res, 404, 'tarefa não existe'); auditar({ tipo: 'tarefa_comentada', quem, id: m[1], trace }); return json(res, 201, { tarefa: t }); }
    catch (e) { return erro(res, 400, e.message); }
  }
  m = rota.match(/^\/api\/tarefas\/(T-\d{8}-\d{4})\/eventos$/);
  if (m && req.method === 'GET') return json(res, 200, { eventos: await db.eventos(m[1]) });

  if (rota === '/api/planejar' && req.method === 'POST') {
    const b = await lerCorpo(req);
    const texto = String(b.texto || '').trim();
    if (texto.length < 4) return erro(res, 400, 'escreva o que precisa ser feito');
    if (texto.length > 2000) return erro(res, 400, 'texto longo demais (máx. 2000 caracteres)');
    const idioma = b.idioma === 'fr' ? 'fr' : 'pt';
    await db.conversaGravar({ quem, canal: 'app', papel: 'pessoa', texto, idioma, trace_id: trace });
    // Pergunta sobre o quadro se responde com o próprio quadro: na hora, de graça, sem modelo.
    const resposta = nucleo.responder(texto, await db.listar(), store.hoje());
    if (resposta) {
      auditar({ tipo: 'perguntar', quem, chars: texto.length, trace });
      const mr = await db.conversaGravar({ quem, canal: 'app', papel: 'planejador', resposta, trace_id: trace });
      return json(res, 200, { resposta, conversa_id: mr.id });
    }
    const propostas = await planejador.planejar(texto, { donoPadrao, idioma, hoje: store.hoje() });
    auditar({ tipo: 'planejar', quem, chars: texto.length, idioma, cards: propostas.length, modelo: propostas[0].origem_modelo, custo: propostas[0].custo || null, trace });
    // Histórico por pessoa: a mensagem e a proposta ficam gravadas; o id da proposta volta para ligar o card.
    const mr = await db.conversaGravar({ quem, canal: 'app', papel: 'planejador', proposta: propostas[0], propostas, trace_id: trace });
    return json(res, 200, { proposta: propostas[0], propostas, conversa_id: mr.id });
  }
  if (rota === '/api/chat' && req.method === 'GET') {
    // Cada pessoa vê a própria conversa; o admin vê todas (é quem opera o app pelos três e pelo Claude).
    const limite = Math.min(200, Math.max(1, Number(url.searchParams.get('limite')) || 50));
    return json(res, 200, { mensagens: await db.conversaLer({ quem: quem === 'admin' ? null : quem, limite }) });
  }

  if (rota === '/api/sugestoes' && req.method === 'GET') {
    const s = await sugestoesAtuais(url.searchParams.get('atualizar') === '1');
    return json(res, 200, { geradas_em: s.geradas_em, marco_zero: MARCO_ZERO, itens: s.itens.filter((x) => !x.decisao), decididas: s.itens.filter((x) => x.decisao).length, cobertura: s.cobertura, normalizados: sugCache.normalizados });
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

/** Nada que chegue de fora derruba o processo: endereço, cookie ou token malformado viram resposta de erro. */
const server = http.createServer((req, res) => {
  atender(req, res).catch((e) => {
    console.error('[http]', String(req.url).slice(0, 200), e && e.message);
    try { if (!res.headersSent) { res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ erro: 'falha interna' })); } else res.end(); } catch { /* conexão já foi */ }
  });
});
async function atender(req, res) {
  let url;
  try { url = new URL(req.url, 'http://localhost'); } catch { res.writeHead(400); return res.end('endereço inválido'); }
  cabecalhosDeSeguranca(req, res, url);
  if (url.pathname === '/health') {
    // Sem login: só se está de pé. O detalhe (caminhos, contagens, aviso) é para quem tem sessão ou a chave da Central.
    const ignorados = auth.ignorados || [];
    const aviso = livroFatal || db.saude().recuperado || ignorados.length ? true : false;
    // Quantos logins existem já é público (a tela de entrada os lista); o número de ignorados deixa o defeito à vista sem login.
    // "modelo" diz só se o planejador tem modelo (ligado) ou usa o leitor de frases (heurística): não revela chave nem nome.
    const publico = { ok: !livroFatal, build: BUILD, operacional: auth.operacional, alerta: aviso, logins: auth.usuarios.length, modelo: planejador.modeloLigado() ? 'ligado' : 'heurística', ...(ignorados.length ? { logins_ignorados: ignorados.length } : {}), mcp: { rota: '/mcp', ferramentas: mcp.FERRAMENTAS.length } };
    if (!chaveCentralOk(req) && !auth.sessaoDe(req)) return json(res, livroFatal ? 503 : 200, publico);
    return json(res, livroFatal ? 503 : 200, { ...publico, usuarios_ignorados: ignorados, motor: db.motor, modelo: planejador.modeloLigado() ? 'ligado' : 'heurística', fuso: store.FUSO, conexoes_ao_vivo: conexoes.size, leitura: { central: CENTER_URL ? 'api' : 'arquivo', banco: !!process.env.DATABASE_URL_RO, marco_zero: MARCO_ZERO }, mcp: { rota: '/mcp', issuer: TAREFAS_URL || 'derivado do host', ferramentas: mcp.FERRAMENTAS.length }, durabilidade: durabilidade() });
  }
  // ---- conector MCP: OAuth (metadados, registro, login, token) e o próprio /mcp ----
  if (url.pathname.startsWith('/.well-known/oauth-') || url.pathname.startsWith('/oauth/')) {
    if (!auth.operacional) return erro(res, 503, 'serviço não configurado: faltam usuários ou TAREFAS_SECRET');
    try { if (await oauth.tratar(req, res, url)) return; } catch (e) { console.error('[oauth]', url.pathname, e && e.message); if (!res.headersSent) return erro(res, 500, 'falha interna'); return; }
    return erro(res, 404, 'rota não existe');
  }
  if (url.pathname === '/mcp') {
    if (!auth.operacional) return erro(res, 503, 'serviço não configurado: faltam usuários ou TAREFAS_SECRET');
    if (livroFatal) return json(res, 503, { jsonrpc: '2.0', id: null, error: { code: -32603, message: `Livro indisponível: ${livroFatal}` } });
    const ident = oauth.identidade(req);
    if (!ident) return json(res, 401, { erro: 'autorize o conector (OAuth) para usar o COMPASSO' }, oauth.cabecalho401(req));
    let corpo = {};
    if (req.method === 'POST') { try { corpo = await lerCorpo(req); } catch (e) { return json(res, e.http || 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: e.message } }); } }
    try { await mcp.tratar(req, res, corpo, ident, traceDe(req)); }
    catch (e) { console.error('[mcp]', e && e.message); if (!res.headersSent) json(res, 500, { jsonrpc: '2.0', id: null, error: { code: -32603, message: 'falha interna' } }); }
    return;
  }
  if (url.pathname.startsWith('/api/')) {
    try { await api(req, res, url); }
    catch (e) {
      if (e instanceof ErroDeCorpo) { if (!res.headersSent) erro(res, e.http, e.message); return; }
      console.error('[api]', url.pathname, e && e.message);
      if (!res.headersSent) erro(res, 500, 'falha interna: ' + String(e && e.message || e).slice(0, 120));
    }
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
  return estatico(req, res, url);
}

function iniciar() {
  return db.pronto().catch((e) => {
    // Livro irrecuperável: fica de pé respondendo 503 com o motivo. Reiniciar em laço ou abrir vazio esconderia a pane.
    livroFatal = e.message;
    console.error('[tarefas] ERRO FATAL no livro:', e.message);
  }).then(() => {
    server.listen(PORT, () => {
      console.log(`[tarefas] COMPASSO Tarefas ${BUILD} em http://localhost:${PORT} · motor ${db.motor} · estado ${STATE_DIR} · fuso ${store.FUSO} · modelo ${planejador.modeloLigado() ? 'ligado' : 'heurística'} · ${auth.operacional ? 'operacional' : 'NÃO OPERACIONAL'}`);
      const d = durabilidade();
      console.log(`[tarefas] durabilidade: volume ${d.volume_montado === null ? 'não verificável' : d.volume_montado ? 'montado' : 'NÃO MONTADO'} · estado desde ${d.estado_desde || '?'} · ${d.tarefas ?? '?'} tarefas · ${d.eventos ?? '?'} eventos${d.sobreviveu_a_reinicio ? ' · sobreviveu a reinício' : ''}`);
      if (d.aviso) console.error('[tarefas] AVISO:', d.aviso);
      const c = copiaDeSeguranca(); if (c) console.log(`[tarefas] cópia de segurança ${c.dia}: ${c.arquivos} arquivos`);
      setInterval(copiaDeSeguranca, 6 * 3600 * 1000).unref();
    });
  });
}
function encerrar() { try { db.gravarAgora(); } catch (e) { console.error('[tarefas] instantâneo final falhou (o ledger está íntegro):', e.message); } process.exit(0); }
if (require.main === module) {
  process.on('SIGTERM', encerrar); process.on('SIGINT', encerrar);
  // Última rede: um erro esquecido é registrado; não tira o quadro do ar para as outras pessoas.
  process.on('unhandledRejection', (e) => console.error('[tarefas] promessa sem tratamento:', e && e.stack || e));
  process.on('uncaughtException', (e) => console.error('[tarefas] exceção sem tratamento:', e && e.stack || e));
  iniciar();
}

module.exports = { server, api, relato, db, BUILD, iniciar, durabilidade, copiaDeSeguranca, conexoes };
