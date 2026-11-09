'use strict';
/**
 * COMPASSO — OAuth 2.1 mínimo para o conector MCP (claude.ai e Claude Code).
 *
 * Por que existe: o chat do Claude (claude.ai, conta da empresa) e o Claude Code só conectam a um servidor MCP
 * remoto por OAuth. Em vez de uma chave na URL, o conector abre a tela de login do próprio COMPASSO: a pessoa
 * entra uma vez com o usuário e a senha do app, e o Claude passa a agir EM NOME DELA (o login fica no token e
 * em toda auditoria). Nada de senha guardada no claude.ai, nada de chave em log.
 *
 * O que implementa (o mínimo que a especificação do MCP exige, sem biblioteca):
 *   GET  /.well-known/oauth-authorization-server[/mcp]  metadados do servidor de autorização (RFC 8414)
 *   GET  /.well-known/oauth-protected-resource[/mcp]    metadados do recurso protegido (RFC 9728)
 *   POST /oauth/register                                registro dinâmico de cliente (RFC 7591) — cliente público
 *   GET  /oauth/authorize                               tela de login (usuário + senha do app)
 *   POST /oauth/authorize                               confere a senha e devolve o código ao redirect_uri registrado
 *   POST /oauth/token                                   authorization_code (PKCE S256 obrigatório) e refresh_token
 *
 * Tokens: assinados com o mesmo segredo da sessão (auth.token), tipo `acesso` (1 dia) e `refresh` (90 dias).
 * Códigos: aleatórios, 5 minutos, uso único, presos ao cliente, ao redirect_uri e ao desafio PKCE.
 * Clientes: STATE_DIR/oauth-clients.json (id aleatório, redirect_uris exatos; https ou http://localhost).
 * Fail-closed: sem usuários ou sem TAREFAS_SECRET nada aqui responde (o servidor já devolve 503 antes).
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const DIAS_ACESSO = 1;
const DIAS_REFRESH = 90;
const MS_CODIGO = 5 * 60 * 1000;
const ESCOPO = 'tarefas';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Para onde o acesso pode ser devolvido: Claude (web e Claude Code local). O registro é aberto por exigência do MCP;
// sem esta lista, qualquer um registrava um "Claude" falso com o próprio site de destino e mandava o link de login.
const HOSTS_PADRAO = ['claude.ai', 'claude.com', 'anthropic.com'];
function hostsPermitidos() { return [...HOSTS_PADRAO, ...String(process.env.TAREFAS_OAUTH_HOSTS || '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean)]; }
function redirectValido(u) {
  try {
    const x = new URL(u);
    if (x.protocol === 'https:') { const h = x.hostname.toLowerCase(); return hostsPermitidos().some((p) => h === p || h.endsWith('.' + p)); }
    if (x.protocol === 'http:' && (x.hostname === 'localhost' || x.hostname === '127.0.0.1' || x.hostname === '[::1]' || x.hostname === '::1')) return true;
    return false;
  } catch { return false; }
}

function lerForm(req) {
  return new Promise((resolve, reject) => {
    let tam = 0; const partes = [];
    req.on('data', (c) => { tam += c.length; if (tam > 32 * 1024) { reject(new Error('corpo acima de 32 KB')); req.destroy(); } else partes.push(c); });
    req.on('end', () => {
      const corpo = Buffer.concat(partes).toString('utf8');
      const ct = String(req.headers['content-type'] || '');
      try {
        if (ct.includes('application/json')) return resolve(corpo ? JSON.parse(corpo) : {});
        resolve(Object.fromEntries(new URLSearchParams(corpo)));
      } catch { reject(new Error('corpo inválido')); }
    });
    req.on('error', reject);
  });
}

function criar({ auth, stateDir, urlPublica, auditar, freio, ipDe, nomeApp = 'COMPASSO Tarefas' }) {
  const F = path.join(stateDir, 'oauth-clients.json');
  let clientes = (() => { try { return JSON.parse(fs.readFileSync(F, 'utf8')); } catch { return {}; } })();
  const gravarClientes = () => { try { fs.writeFileSync(F, JSON.stringify(clientes, null, 1), 'utf8'); } catch (e) { console.error('[oauth] não gravei clientes:', e.message); } };
  const codigos = new Map();
  const registros = new Map(); // ip -> { n, desde }: registro dinâmico é aberto, mas não infinito

  function issuer(req) {
    if (urlPublica) return urlPublica.replace(/\/+$/, '');
    const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() || 'http';
    const host = String(req.headers['x-forwarded-host'] || req.headers.host || 'localhost').split(',')[0].trim();
    return `${proto}://${host}`;
  }
  function json(res, code, obj, extra) { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', pragma: 'no-cache', ...(extra || {}) }); res.end(JSON.stringify(obj)); }
  function html(res, code, corpo) { res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-frame-options': 'DENY' }); res.end(corpo); }

  function metadadosAS(req) {
    const iss = issuer(req);
    return { issuer: iss, authorization_endpoint: `${iss}/oauth/authorize`, token_endpoint: `${iss}/oauth/token`, registration_endpoint: `${iss}/oauth/register`, response_types_supported: ['code'], response_modes_supported: ['query'], grant_types_supported: ['authorization_code', 'refresh_token'], code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none'], scopes_supported: [ESCOPO], service_documentation: `${iss}/` };
  }
  function metadadosRecurso(req) {
    const iss = issuer(req);
    return { resource: `${iss}/mcp`, authorization_servers: [iss], scopes_supported: [ESCOPO], bearer_methods_supported: ['header'], resource_name: nomeApp };
  }

  function registroLiberado(ip) {
    const agora = Date.now();
    const t = registros.get(ip) || { n: 0, desde: agora };
    if (agora - t.desde > 3600 * 1000) { t.n = 0; t.desde = agora; }
    t.n += 1; registros.set(ip, t);
    if (registros.size > 5000) registros.clear();
    return t.n <= 30;
  }

  const hostDe = (u) => { try { return new URL(u).host; } catch { return '?'; } };
  function paginaLogin({ cliente, p, erro }) {
    const campos = ['client_id', 'redirect_uri', 'state', 'code_challenge', 'code_challenge_method', 'scope', 'resource'].map((k) => `<input type="hidden" name="${k}" value="${esc(p[k] || '')}">`).join('');
    const opcoes = auth.usuarios.map((u) => `<option value="${esc(u.id)}">${esc(u.nome)}</option>`).join('');
    return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(nomeApp)} — autorizar</title>
<style>:root{color-scheme:light dark}body{margin:0;min-height:100vh;display:grid;place-items:center;font:15px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;background:#f6f3ee;color:#1f1b16}@media(prefers-color-scheme:dark){body{background:#17140f;color:#efe9df}}
.card{width:min(420px,92vw);padding:28px 26px;border-radius:14px;background:rgba(255,255,255,.72);box-shadow:0 10px 40px rgba(0,0,0,.08);display:grid;gap:14px}@media(prefers-color-scheme:dark){.card{background:rgba(255,255,255,.06)}}
h1{margin:0;font-size:12px;letter-spacing:.22em;text-transform:uppercase;font-weight:500;opacity:.75}p{margin:0}label{display:grid;gap:6px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;opacity:.8}
select,input{font:inherit;padding:10px 12px;border-radius:9px;border:1px solid rgba(0,0,0,.18);background:transparent;color:inherit}button{font:inherit;padding:11px;border-radius:9px;border:0;background:#b8893a;color:#fff;font-weight:500;cursor:pointer}
.err{color:#a3341f;font-size:14px}.hint{font-size:13px;opacity:.7}</style></head><body><form class="card" method="post" action="/oauth/authorize">
<h1>${esc(nomeApp)}</h1><p><strong>${esc(cliente.client_name || 'Um aplicativo')}</strong> quer criar e acompanhar tarefas no COMPASSO em seu nome. Entre para autorizar.</p><p class="hint">O acesso será devolvido a: <strong>${esc(hostDe(p.redirect_uri))}</strong>. Se você não pediu isto, feche esta página.</p>
${erro ? `<p class="err">${esc(erro)}</p>` : ''}${campos}
<label>Quem é você<select name="usuario" required>${opcoes}</select></label>
<label>Senha<input type="password" name="senha" required autocomplete="current-password" autofocus></label>
<button type="submit">Autorizar</button>
<p class="hint">O Claude passará a agir com o seu usuário; tudo fica na auditoria. Para revogar, remova o conector no Claude.</p></form></body></html>`;
  }

  /** Identidade portada por um Bearer válido, ou null. */
  function identidade(req) {
    const m = String(req.headers.authorization || '').match(/^Bearer\s+(.+)$/i);
    if (!m) return null;
    const p = auth.abrir(m[1].trim());
    if (!p || p.t !== 'acesso' || !p.sub) return null;
    if (!auth.usuarios.some((u) => u.id === p.sub)) return null;
    return { id: p.sub, nome: p.nome, cliente: p.cid || null };
  }
  function cabecalho401(req) { return { 'www-authenticate': `Bearer realm="${nomeApp}", resource_metadata="${issuer(req)}/.well-known/oauth-protected-resource"` }; }

  async function tratar(req, res, url) {
    const rota = url.pathname.replace(/\/+$/, '');
    if (rota === '/.well-known/oauth-authorization-server' || rota === '/.well-known/oauth-authorization-server/mcp') return json(res, 200, metadadosAS(req)), true;
    if (rota === '/.well-known/oauth-protected-resource' || rota === '/.well-known/oauth-protected-resource/mcp') return json(res, 200, metadadosRecurso(req)), true;

    if (rota === '/oauth/register') {
      if (req.method !== 'POST') return json(res, 405, { error: 'invalid_request' }), true;
      let b; try { b = await lerForm(req); } catch (e) { return json(res, 400, { error: 'invalid_client_metadata', error_description: e.message }), true; }
      const ipReg = ipDe(req);
      if (!registroLiberado(ipReg)) { auditar({ tipo: 'oauth_registro_bloqueado', ip: ipReg }); return json(res, 429, { error: 'too_many_requests', error_description: 'muitos registros; espere uma hora' }), true; }
      const uris = Array.isArray(b.redirect_uris) ? b.redirect_uris.map(String) : [];
      if (!uris.length || !uris.every(redirectValido)) return json(res, 400, { error: 'invalid_redirect_uri', error_description: 'redirect_uris: endereço do Claude (claude.ai, claude.com) ou http://localhost para clientes locais' }), true;
      const client_id = 'c_' + crypto.randomBytes(16).toString('hex');
      const c = { client_id, client_name: String(b.client_name || 'cliente MCP').slice(0, 80), redirect_uris: uris.slice(0, 10), token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], scope: ESCOPO, client_id_issued_at: Math.floor(Date.now() / 1000) };
      clientes[client_id] = c;
      // Teto de 200: sai primeiro quem nunca foi autorizado. Um cliente em uso nunca é despejado por registros em massa.
      const ids = Object.keys(clientes);
      if (ids.length > 200) for (const id of ids.filter((i) => !clientes[i].autorizado_em).slice(0, ids.length - 200)) delete clientes[id];
      gravarClientes();
      auditar({ tipo: 'oauth_cliente_registrado', client_id, nome: c.client_name, redirect: uris[0] });
      return json(res, 201, c), true;
    }

    if (rota === '/oauth/authorize') {
      const p = req.method === 'POST' ? await lerForm(req).catch(() => ({})) : Object.fromEntries(url.searchParams);
      const cliente = clientes[p.client_id];
      // Erros de cliente/redirect NUNCA redirecionam (seria um redirecionador aberto): página de erro.
      if (!cliente) return html(res, 400, `<!doctype html><meta charset="utf-8"><p>Cliente desconhecido. Remova e adicione o conector de novo.</p>`), true;
      if (!cliente.redirect_uris.includes(p.redirect_uri)) return html(res, 400, `<!doctype html><meta charset="utf-8"><p>redirect_uri não registrado para este cliente.</p>`), true;
      const volta = (params) => { const u = new URL(p.redirect_uri); for (const [k, v] of Object.entries(params)) if (v) u.searchParams.set(k, v); res.writeHead(302, { location: u.toString(), 'cache-control': 'no-store' }); res.end(); return true; };
      if ((p.response_type || 'code') !== 'code') return volta({ error: 'unsupported_response_type', state: p.state });
      if (!p.code_challenge || (p.code_challenge_method || 'S256') !== 'S256') return volta({ error: 'invalid_request', error_description: 'PKCE S256 obrigatório', state: p.state });
      if (req.method === 'GET') return html(res, 200, paginaLogin({ cliente, p })), true;
      if (req.method !== 'POST') return json(res, 405, { error: 'invalid_request' }), true;
      const ip = ipDe(req);
      const chaves = [`ip:${ip}`, `u:${String(p.usuario || '').slice(0, 20).toLowerCase()}`];
      if (freio.bloqueado(chaves)) { auditar({ tipo: 'oauth_login_bloqueado', ip }); return html(res, 429, paginaLogin({ cliente, p, erro: 'Muitas tentativas. Espere 15 minutos.' })), true; }
      freio.falhou(chaves); // conta antes de conferir: tentativas em paralelo não passam juntas
      const r = await auth.entrarAsync(p.usuario, p.senha);
      auditar({ tipo: 'oauth_login', usuario: String(p.usuario || '').slice(0, 20), ok: !!r, client_id: p.client_id, ip });
      if (!r) { return html(res, 401, paginaLogin({ cliente, p, erro: 'Usuário ou senha não conferem.' })), true; }
      freio.acertou(chaves);
      // Senha provisória: primeiro a pessoa escolhe a dela no app; só então o Claude pode agir em seu nome.
      if (r.usuario.trocar) { auditar({ tipo: 'oauth_senha_provisoria', usuario: r.usuario.id, client_id: p.client_id }); return html(res, 403, paginaLogin({ cliente, p, erro: 'Esta é a sua senha provisória. Entre no COMPASSO, escolha a sua senha e volte aqui.' })), true; }
      if (!cliente.autorizado_em) { cliente.autorizado_em = new Date().toISOString(); gravarClientes(); }
      const code = crypto.randomBytes(32).toString('base64url');
      for (const [k, v] of codigos) if (v.exp < Date.now()) codigos.delete(k);
      codigos.set(code, { cid: p.client_id, redirect: p.redirect_uri, challenge: p.code_challenge, sub: r.usuario.id, nome: r.usuario.nome, exp: Date.now() + MS_CODIGO });
      auditar({ tipo: 'oauth_autorizado', usuario: r.usuario.id, client_id: p.client_id, nome_cliente: cliente.client_name });
      return volta({ code, state: p.state });
    }

    if (rota === '/oauth/token') {
      if (req.method !== 'POST') return json(res, 405, { error: 'invalid_request' }), true;
      let b; try { b = await lerForm(req); } catch (e) { return json(res, 400, { error: 'invalid_request', error_description: e.message }), true; }
      const emitir = (sub, nome, cid) => json(res, 200, { access_token: auth.token({ t: 'acesso', sub, nome, cid }, DIAS_ACESSO), token_type: 'Bearer', expires_in: DIAS_ACESSO * 86400, refresh_token: auth.token({ t: 'refresh', sub, nome, cid }, DIAS_REFRESH), scope: ESCOPO });
      if (b.grant_type === 'authorization_code') {
        const c = codigos.get(String(b.code || ''));
        codigos.delete(String(b.code || '')); // uso único, mesmo quando falha
        if (!c || c.exp < Date.now()) return json(res, 400, { error: 'invalid_grant', error_description: 'código inválido ou vencido' }), true;
        if (b.client_id && b.client_id !== c.cid) return json(res, 400, { error: 'invalid_grant', error_description: 'cliente não confere' }), true;
        if (b.redirect_uri && b.redirect_uri !== c.redirect) return json(res, 400, { error: 'invalid_grant', error_description: 'redirect_uri não confere' }), true;
        const esperado = crypto.createHash('sha256').update(String(b.code_verifier || '')).digest('base64url');
        const ba = Buffer.from(esperado); const bb = Buffer.from(String(c.challenge));
        if (!b.code_verifier || ba.length !== bb.length || !crypto.timingSafeEqual(ba, bb)) return json(res, 400, { error: 'invalid_grant', error_description: 'PKCE não confere' }), true;
        auditar({ tipo: 'oauth_token', usuario: c.sub, client_id: c.cid, grant: 'authorization_code' });
        return emitir(c.sub, c.nome, c.cid), true;
      }
      if (b.grant_type === 'refresh_token') {
        const p = auth.abrir(String(b.refresh_token || ''));
        if (!p || p.t !== 'refresh' || !p.sub || !auth.usuarios.some((u) => u.id === p.sub)) return json(res, 400, { error: 'invalid_grant', error_description: 'refresh_token inválido ou vencido' }), true;
        if (b.client_id && p.cid && b.client_id !== p.cid) return json(res, 400, { error: 'invalid_grant', error_description: 'cliente não confere' }), true;
        // Cliente registrado antes da marca de uso: renovar prova que está em uso, e ele nunca é despejado.
        if (p.cid && clientes[p.cid] && !clientes[p.cid].autorizado_em) { clientes[p.cid].autorizado_em = new Date().toISOString(); gravarClientes(); }
        auditar({ tipo: 'oauth_token', usuario: p.sub, client_id: p.cid, grant: 'refresh_token' });
        return emitir(p.sub, p.nome, p.cid), true;
      }
      return json(res, 400, { error: 'unsupported_grant_type' }), true;
    }
    return false;
  }

  return { tratar, identidade, cabecalho401, issuer, _clientes: () => clientes };
}

module.exports = { criar, redirectValido, DIAS_ACESSO, DIAS_REFRESH };
