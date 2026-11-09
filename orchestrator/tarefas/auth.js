'use strict';
/**
 * COMPASSO Tarefas — um login por pessoa, uma sessão assinada.
 *
 * Usuários: TAREFAS_USUARIOS (JSON) ou STATE_DIR/usuarios.json:
 *   [{"id":"marlon","nome":"Márlon","senha":"scrypt:<salt>:<hash>","trocar":true}, ...]
 * Montar o valor inteiro, com senhas provisórias: node logins.cjs (a senha só aparece no terminal de quem roda).
 * Um hash só: node auth.js --senha "a senha".
 *
 * Senha provisória e senha própria (09/11):
 *   - `trocar: true` marca a senha da variável como provisória: no primeiro acesso, o app só deixa escolher uma senha.
 *   - A senha escolhida fica em STATE_DIR/senhas.json (no volume), presa ao hash da variável que ela substituiu.
 *     Se o fundador gera uma provisória nova para a pessoa, o hash da variável muda, a escolhida deixa de valer e a
 *     troca volta a ser pedida. É o "esqueci a senha": sem e-mail, sem tela de recuperação.
 *   - Toda sessão e todo token do conector levam uma marca da senha em vigor (`pv`). Trocar a senha encerra as
 *     sessões antigas e desconecta o Claude daquela pessoa. Token anterior a esta versão (sem `pv`) vale até vencer.
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

// Logins aceitos: as três pessoas e um `admin` (o fundador). As TAREFAS continuam sendo sempre de Márlon, Lucas
// ou Julien: admin entra, cria, edita e atribui, mas nunca é dono de tarefa.
const LOGINS = { ...PESSOAS, admin: 'Admin' };
const DIAS_SESSAO = 30;
const SENHA_MIN = 10;

// Formato `scrypt:salt:hash`. Sem cifrão de propósito: o EasyPanel (e o docker compose) tratam `$palavra`
// numa variável de ambiente como referência a outra variável e engolem o conteúdo — foi o que derrubou o
// primeiro deploy (03/11). O formato antigo `scrypt$salt$hash` continua aceito na leitura.
const FORMATO_HASH = /^scrypt[:$][0-9a-f]+[:$][0-9a-f]{64}$/;
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
const hashAsync = (senha) => new Promise((ok, falha) => { const s = crypto.randomBytes(12).toString('hex'); crypto.scrypt(String(senha), s, 32, (e, k) => (e ? falha(e) : ok(`scrypt:${s}:${k.toString('hex')}`))); });
const marca = (hash) => crypto.createHash('sha256').update(String(hash)).digest('base64url').slice(0, 12);

/** Senha nova aceitável? Devolve o motivo da recusa, ou null. */
function problemaNaSenha(nova, { id, atual } = {}) {
  const s = String(nova || '');
  if (s.length < SENHA_MIN) return `A senha precisa de pelo menos ${SENHA_MIN} caracteres.`;
  if (s.length > 200) return 'Senha longa demais.';
  if (atual !== undefined && s === String(atual)) return 'A senha nova precisa ser diferente da atual.';
  const baixa = s.toLowerCase();
  if (id && baixa.includes(String(id).toLowerCase())) return 'A senha não pode conter o seu nome de usuário.';
  if (/^(.)\1+$/.test(s) || /^(?:0123456789|1234567890|senhasenha|password12|azertyuiop|qwertyuiop)/.test(baixa) || /theworldkeys|compasso/.test(baixa)) return 'Senha fácil demais de adivinhar.';
  return null;
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
    const ok = lista.filter((u) => u && LOGINS[u.id] && FORMATO_HASH.test(u.senha));
    if (!ok.length) throw new Error(`Nenhum usuário válido (id em admin|marlon|lucas|julien e senha em hash "scrypt:salt:hash"). Recebido: ${lista.map((u) => `${u && u.id}=${String((u && u.senha) || '').slice(0, 12)}…`).join(', ')}`);
    const repetidos = ok.map((u) => u.id).filter((id, i, a) => a.indexOf(id) !== i);
    if (repetidos.length) throw new Error(`TAREFAS_USUARIOS tem o mesmo login mais de uma vez: ${[...new Set(repetidos)].join(', ')}.`);
    return ok.map((u) => ({ id: u.id, nome: u.nome || LOGINS[u.id], senha: u.senha, trocar: u.trocar === true }));
  }
  if (isProd) return [];
  console.warn('[auth] DESENVOLVIMENTO: sem usuarios.json — Márlon, Lucas e Julien entram com a senha "twk".');
  return Object.entries(PESSOAS).map(([id, nome]) => ({ id, nome, senha: hashSenha('twk', 'dev'), trocar: false }));
}

function criar({ stateDir, isProd, segredo }) {
  const usuarios = carregarUsuarios({ stateDir, isProd });
  const chave = segredo || (isProd ? '' : crypto.randomBytes(24).toString('hex'));
  const operacional = usuarios.length > 0 && !!chave;

  // Senhas escolhidas pelas pessoas, no volume. Ilegível = ninguém tem senha própria (vale a provisória), com aviso.
  const F = stateDir ? path.join(stateDir, 'senhas.json') : null;
  let proprias = {};
  if (F && fs.existsSync(F)) {
    try { proprias = JSON.parse(fs.readFileSync(F, 'utf8')) || {}; } catch (e) { console.error(`[auth] senhas.json ilegível (${e.message}): vale a senha da variável até cada um escolher de novo.`); proprias = {}; }
  }
  const gravarProprias = () => { const tmp = `${F}.${process.pid}.tmp`; fs.writeFileSync(tmp, JSON.stringify(proprias, null, 1), 'utf8'); fs.renameSync(tmp, F); };
  const usuario = (id) => usuarios.find((x) => x.id === String(id || '').toLowerCase()) || null;
  /** A senha própria vale enquanto a da variável for a mesma que ela substituiu. */
  const propriaValida = (u) => { const p = proprias[u.id]; return p && p.de === u.senha && FORMATO_HASH.test(p.senha) ? p : null; };
  const hashEmVigor = (u) => (propriaValida(u) || { senha: u.senha }).senha;
  const precisaTrocar = (u) => !!u && u.trocar && !propriaValida(u);
  const pvDe = (id) => { const u = usuario(id); return u ? marca(hashEmVigor(u)) : null; };

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
  /** O token foi emitido com a senha que está em vigor agora? Sem marca = anterior a esta versão: vale até vencer. */
  const senhaConfere = (p, id) => !p.pv || p.pv === pvDe(id);
  const emitir = (u) => ({ token: assinar({ id: u.id, nome: u.nome, pv: marca(hashEmVigor(u)), exp: Date.now() + DIAS_SESSAO * 864e5 }), usuario: { id: u.id, nome: u.nome, trocar: precisaTrocar(u) } });

  return {
    operacional,
    usuarios: usuarios.map((u) => ({ id: u.id, nome: u.nome })),
    entrar(id, senha) {
      const u = usuario(id);
      if (!u || !conferirSenha(senha, hashEmVigor(u))) return null;
      return emitir(u);
    },
    async entrarAsync(id, senha) {
      const u = usuario(id);
      if (!u || !(await conferirSenhaAsync(senha, hashEmVigor(u)))) return null;
      return emitir(u);
    },
    /** Troca a senha da pessoa. Devolve { token, usuario } (nova sessão) ou { erro }. */
    async trocarSenha(id, atual, nova) {
      const u = usuario(id);
      if (!u) return { erro: 'Usuário não existe.' };
      if (!F) return { erro: 'Sem pasta de estado: não há onde guardar a senha.' };
      if (!(await conferirSenhaAsync(atual, hashEmVigor(u)))) return { erro: 'A senha atual não confere.', senha_atual: true };
      const problema = problemaNaSenha(nova, { id: u.id, atual });
      if (problema) return { erro: problema };
      proprias[u.id] = { senha: await hashAsync(nova), de: u.senha, em: new Date().toISOString() };
      try { gravarProprias(); } catch (e) { delete proprias[u.id]; return { erro: `Não consegui guardar a senha (${e.message}).` }; }
      return emitir(u);
    },
    precisaTrocar: (id) => precisaTrocar(usuario(id)),
    pvDe,
    // Só o token de sessão vale aqui: token do conector (t: acesso|refresh) não tem `id` e cai fora.
    sessaoDe(req) {
      const p = abrirToken(cookieDe(req));
      if (!p || !p.id || p.t) return null;
      const u = usuario(p.id);
      if (!u || !senhaConfere(p, u.id)) return null;
      return { id: u.id, nome: u.nome, trocar: precisaTrocar(u) };
    },
    cookie(token, secure) { return `twk_tarefas=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${DIAS_SESSAO * 86400}${secure ? '; Secure' : ''}`; },
    cookieSair(secure) { return `twk_tarefas=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`; },
    // Tokens do conector MCP (oauth.js): mesma assinatura HMAC da sessão, com tipo, validade e marca da senha.
    token(payload, dias) { return assinar({ ...payload, pv: payload.sub ? pvDe(payload.sub) : undefined, exp: Date.now() + dias * 864e5 }); },
    abrir(token) { const p = abrirToken(token); return p && p.sub && !senhaConfere(p, p.sub) ? null : p; },
    _abrirToken: abrirToken,
  };
}

module.exports = { criar, criarFreio, hashSenha, conferirSenha, conferirSenhaAsync, problemaNaSenha, SENHA_MIN, FORMATO_HASH, PESSOAS, LOGINS };

if (require.main === module) {
  const i = process.argv.indexOf('--senha');
  if (i < 0 || !process.argv[i + 1]) { console.log('uso: node auth.js --senha "a senha"   (para montar todos os logins: node logins.cjs)'); process.exit(1); }
  console.log(hashSenha(process.argv[i + 1]));
}
