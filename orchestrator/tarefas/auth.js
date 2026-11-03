'use strict';
/**
 * COMPASSO Tarefas — três pessoas, três senhas, uma sessão assinada.
 *
 * Usuários: TAREFAS_USUARIOS (JSON) ou STATE_DIR/usuarios.json:
 *   [{"id":"marlon","nome":"Márlon","senha":"scrypt$<salt>$<hash>"}, ...]
 * Gerar o hash: node auth.js --senha "a senha"   (imprime a linha para colar no JSON; nunca grava a senha em claro)
 *
 * Fail-closed: em produção sem usuários ou sem TAREFAS_SECRET o servidor responde 503. Em desenvolvimento
 * (NODE_ENV != production) sem usuários, nascem Márlon, Lucas e Julien com a senha "twk" e um aviso no console.
 *
 * Sessão: cookie HttpOnly assinado com HMAC-SHA256 (TAREFAS_SECRET), validade 30 dias, SameSite=Lax.
 * Mutação exige o cabeçalho X-Requested-With: fetch (barreira simples contra formulário de terceiros).
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const PESSOAS = { marlon: 'Márlon', lucas: 'Lucas', julien: 'Julien' };
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
    if (esperado.length !== mac.length || !crypto.timingSafeEqual(Buffer.from(esperado), Buffer.from(mac))) return null;
    try { const p = JSON.parse(Buffer.from(corpo, 'base64url').toString('utf8')); if (!p.exp || p.exp < Date.now()) return null; return p; } catch { return null; }
  }
  function cookieDe(req) {
    const c = req.headers.cookie || '';
    const m = c.match(/(?:^|;\s*)twk_tarefas=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  }
  return {
    operacional,
    usuarios: usuarios.map((u) => ({ id: u.id, nome: u.nome })),
    entrar(id, senha) {
      const u = usuarios.find((x) => x.id === String(id || '').toLowerCase());
      if (!u || !conferirSenha(senha, u.senha)) return null;
      const exp = Date.now() + DIAS_SESSAO * 864e5;
      return { token: assinar({ id: u.id, nome: u.nome, exp }), usuario: { id: u.id, nome: u.nome } };
    },
    sessaoDe(req) { const p = abrirToken(cookieDe(req)); return p ? { id: p.id, nome: p.nome } : null; },
    cookie(token, secure) { return `twk_tarefas=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${DIAS_SESSAO * 86400}${secure ? '; Secure' : ''}`; },
    cookieSair(secure) { return `twk_tarefas=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`; },
    // Tokens do conector MCP (oauth.js): mesma assinatura HMAC da sessão, com tipo e validade próprios.
    token(payload, dias) { return assinar({ ...payload, exp: Date.now() + dias * 864e5 }); },
    abrir(token) { return abrirToken(token); },
    _abrirToken: abrirToken,
  };
}

module.exports = { criar, hashSenha, conferirSenha, PESSOAS, LOGINS };

if (require.main === module) {
  const i = process.argv.indexOf('--senha');
  if (i < 0 || !process.argv[i + 1]) { console.log('uso: node auth.js --senha "a senha"'); process.exit(1); }
  console.log(hashSenha(process.argv[i + 1]));
}
