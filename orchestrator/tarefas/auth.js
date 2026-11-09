'use strict';
/**
 * COMPASSO Tarefas — três pessoas, três senhas, uma sessão assinada.
 *
 * Usuários: TAREFAS_USUARIOS (JSON) ou STATE_DIR/usuarios.json:
 *   [{"id":"marlon","nome":"Márlon","senha":"scrypt:<salt>:<hash>"}, ...]
 * Gerar o hash: node auth.js --senha "a senha"   (imprime a linha para colar no JSON; nunca grava a senha em claro)
 *
 * Fail-closed: em produção sem usuários ou sem TAREFAS_SECRET o servidor responde 503. Em desenvolvimento
 * (NODE_ENV != production) sem usuários, nascem Márlon, Lucas e Julien com a senha "twk" e um aviso no console.
 *
 * Sessão: cookie HttpOnly assinado com HMAC-SHA256 (TAREFAS_SECRET), validade 30 dias, SameSite=Lax. Token do conector
 * (acesso/refresh) nunca vale como sessão, e vice-versa. Mutação exige X-Requested-With: fetch.
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { PESSOAS } = require('./store.js');

// Logins aceitos: as três pessoas e um `admin` (login único do fundador). As TAREFAS continuam sendo
// sempre de Márlon, Lucas ou Julien: admin entra, cria, edita e atribui, mas nunca é dono de tarefa.
const LOGINS = { ...PESSOAS, admin: 'Admin' };
const DIAS_SESSAO = 30;

// Formato `scrypt:salt:hash`. Sem cifrão de propósito: o EasyPanel (e o docker compose) tratam `$palavra`
// numa variável de ambiente como referência a outra variável e engolem o conteúdo — foi o que derrubou o
// primeiro deploy (03/11). O formato antigo `scrypt$salt$hash` continua aceito na leitura.
function hashSenha(senha, salt) {
  const s = salt || crypto.randomBytes(12).toString('hex');
  const h = crypto.scryptSync(String(senha), s, 32).toString('hex');
  return `scrypt:${s}:${h}`;
}
function conferirSenha(senha, guardado) {
  const [alg, salt, h] = String(guardado || '').split(/[:$]/);
  if (alg !== 'scrypt' || !salt || !h) return false;
  const calc = crypto.scryptSync(String(senha), salt, 32).toString('hex');
  return calc.length === h.length && crypto.timingSafeEqual(Buffer.from(calc, 'hex'), Buffer.from(h, 'hex'));
}
/** A mesma conferência sem parar o servidor: scrypt custa ~100 ms de CPU e, síncrono, travava todo mundo a cada login. */
function conferirSenhaAsync(senha, guardado) {
  const [alg, salt, h] = String(guardado || '').split(/[:$]/);
  if (alg !== 'scrypt' || !salt || !h) return Promise.resolve(false);
  return new Promise((ok) => crypto.scrypt(String(senha), salt, 32, (e, chave) => {
    if (e) return ok(false);
    const calc = chave.toString('hex');
    ok(calc.length === h.length && crypto.timingSafeEqual(Buffer.from(calc, 'hex'), Buffer.from(h, 'hex')));
  }));
}

/**
 * Freio de tentativas por chave. A tentativa conta ANTES de conferir a senha (a conferência é assíncrona: contar depois
 * deixava passar dezenas em paralelo); acertar zera. `max` pode variar por chave.
 */
function criarFreio({ max = 8, janelaMs = 15 * 60 * 1000 } = {}) {
  const mapa = new Map();
  const teto = (c) => (typeof max === 'function' ? max(c) : max);
  const vivo = (chave) => { const t = mapa.get(chave); if (!t) return null; if (Date.now() - t.desde > janelaMs) { mapa.delete(chave); return null; } return t; };
  return {
    bloqueado(chaves) { for (const c of chaves) { const t = vivo(c); if (t && t.n >= teto(c)) return Math.ceil((t.desde + janelaMs - Date.now()) / 1000); } return 0; },
    falhou(chaves) { if (mapa.size > 10000) mapa.clear(); for (const c of chaves) { const t = vivo(c) || { n: 0, desde: Date.now() }; t.n += 1; mapa.set(c, t); } },
    acertou(chaves) { for (const c of chaves) mapa.delete(c); },
  };
}

function carregarUsuarios({ stateDir, isProd }) {
  let lista = null;
  if (process.env.TAREFAS_USUARIOS) { try { lista = JSON.parse(process.env.TAREFAS_USUARIOS); } catch { throw new Error('TAREFAS_USUARIOS não é JSON válido.'); } }
  else { const f = path.join(stateDir, 'usuarios.json'); if (fs.existsSync(f)) lista = JSON.parse(fs.readFileSync(f, 'utf8')); }
  if (Array.isArray(lista) && lista.length) {
    const ok = lista.filter((u) => LOGINS[u.id] && /^scrypt[:$][0-9a-f]+[:$][0-9a-f]{64}$/.test(u.senha));
    if (!ok.length) throw new Error(`Nenhum usuário válido (id em admin|marlon|lucas|julien e senha em hash "scrypt:salt:hash"). Recebido: ${lista.map((u) => `${u.id}=${String(u.senha || '').slice(0, 12)}…`).join(', ')}`);
    return ok.map((u) => ({ id: u.id, nome: u.nome || LOGINS[u.id], senha: u.senha }));
  }
  if (isProd) return [];
  console.warn('[auth] DESENVOLVIMENTO: sem usuarios.json — Márlon, Lucas e Julien entram com a senha "twk".');
  return Object.entries(PESSOAS).map(([id, nome]) => ({ id, nome, senha: hashSenha('twk', 'dev') }));
}

function criar({ stateDir, isProd, segredo }) {
  const usuarios = carregarUsuarios({ stateDir, isProd });
  const chave = segredo || (isProd ? '' : crypto.randomBytes(24).toString('hex'));
  const operacional = usuarios.length > 0 && !!chave;

  function assinar(payload) {
    const corpo = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const mac = crypto.createHmac('sha256', chave).update(corpo).digest('base64url');
    return `${corpo}.${mac}`;
  }
  function abrirToken(token) {
    if (!token || !chave) return null;
    const [corpo, mac] = String(token).split('.');
    if (!corpo || !mac) return null;
    const esperado = crypto.createHmac('sha256', chave).update(corpo).digest('base64url');
    const a = Buffer.from(esperado); const b = Buffer.from(mac); // compara bytes: letra acentuada no token muda o tamanho e faria timingSafeEqual lançar
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    try { const p = JSON.parse(Buffer.from(corpo, 'base64url').toString('utf8')); if (!p.exp || p.exp < Date.now()) return null; return p; } catch { return null; }
  }
  function cookieDe(req) {
    const c = req.headers.cookie || '';
    const m = c.match(/(?:^|;\s*)twk_tarefas=([^;]+)/);
    if (!m) return null;
    try { return decodeURIComponent(m[1]); } catch { return null; } // cookie malformado é só cookie inválido
  }
  const emitir = (u) => ({ token: assinar({ id: u.id, nome: u.nome, exp: Date.now() + DIAS_SESSAO * 864e5 }), usuario: { id: u.id, nome: u.nome } });
  return {
    operacional,
    usuarios: usuarios.map((u) => ({ id: u.id, nome: u.nome })),
    entrar(id, senha) {
      const u = usuarios.find((x) => x.id === String(id || '').toLowerCase());
      if (!u || !conferirSenha(senha, u.senha)) return null;
      return emitir(u);
    },
    async entrarAsync(id, senha) {
      const u = usuarios.find((x) => x.id === String(id || '').toLowerCase());
      if (!u || !(await conferirSenhaAsync(senha, u.senha))) return null;
      return emitir(u);
    },
    // Só o token de sessão vale aqui: token do conector (t: acesso|refresh) não tem `id` e cai fora.
    sessaoDe(req) { const p = abrirToken(cookieDe(req)); return p && p.id && !p.t && usuarios.some((u) => u.id === p.id) ? { id: p.id, nome: p.nome } : null; },
    cookie(token, secure) { return `twk_tarefas=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${DIAS_SESSAO * 86400}${secure ? '; Secure' : ''}`; },
    cookieSair(secure) { return `twk_tarefas=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`; },
    // Tokens do conector MCP (oauth.js): mesma assinatura HMAC da sessão, com tipo e validade próprios.
    token(payload, dias) { return assinar({ ...payload, exp: Date.now() + dias * 864e5 }); },
    abrir(token) { return abrirToken(token); },
    _abrirToken: abrirToken,
  };
}

module.exports = { criar, criarFreio, hashSenha, conferirSenha, conferirSenhaAsync, PESSOAS, LOGINS };

if (require.main === module) {
  const i = process.argv.indexOf('--senha');
  if (i < 0 || !process.argv[i + 1]) { console.log('uso: node auth.js --senha "a senha"'); process.exit(1); }
  console.log(hashSenha(process.argv[i + 1]));
}
