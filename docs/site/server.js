#!/usr/bin/env node
'use strict';
/**
 * Biblioteca TWK — site estático dos planos e documentos, com senha.
 * Zero dependências (Node ≥ 18). Mesmo padrão da Sala de Comando: em produção sem
 * DOCS_USER/DOCS_PASS o site responde 503 (fail-closed); em desenvolvimento fica aberto só localmente.
 *
 *   node server.js                      → http://localhost:8080 (dev, sem senha)
 *   DOCS_USER=... DOCS_PASS=... node server.js
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PORT = Number(process.env.PORT || 8080);
const PUBLIC = path.join(__dirname, 'public');
const IS_PROD = process.env.NODE_ENV === 'production';
const USER = process.env.DOCS_USER || '';
const PASS = process.env.DOCS_PASS || '';
const REALM = 'The World Keys';
let BUILD = { build: 'dev', documentos: [] };
try { BUILD = JSON.parse(fs.readFileSync(path.join(PUBLIC, 'build.json'), 'utf8')); } catch {}

const TIPOS = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.woff2': 'font/woff2', '.pdf': 'application/pdf', '.webp': 'image/webp' };

function timingSafeEq(a, b) {
  const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
  if (x.length !== y.length) return false;
  return crypto.timingSafeEqual(x, y);
}
function autorizado(req) {
  const h = String(req.headers.authorization || '');
  if (!h.startsWith('Basic ')) return false;
  const dec = Buffer.from(h.slice(6), 'base64').toString('utf8');
  const i = dec.indexOf(':'); if (i < 0) return false;
  return timingSafeEq(dec.slice(0, i), USER) && timingSafeEq(dec.slice(i + 1), PASS);
}
function cabecalhos(res, extra = {}) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self' 'unsafe-inline'; img-src 'self' data:; base-uri 'none'; form-action 'none'");
  for (const [k, v] of Object.entries(extra)) res.setHeader(k, v);
}
function texto(res, status, corpo, tipo = 'text/plain; charset=utf-8', extra = {}) {
  cabecalhos(res, extra); res.writeHead(status, { 'Content-Type': tipo, 'Cache-Control': 'no-store' }); res.end(corpo);
}

const servidor = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/health') return texto(res, 200, JSON.stringify({ ok: true, build: BUILD.build, documentos: BUILD.documentos.length, auth: (USER && PASS) ? 'senha' : (IS_PROD ? 'FAIL-CLOSED (sem senha em producao)' : 'dev-aberto') }), 'application/json; charset=utf-8');
  if (!(USER && PASS)) {
    if (IS_PROD) return texto(res, 503, 'Site fechado: DOCS_USER e DOCS_PASS nao configurados.');
  } else if (!autorizado(req)) {
    return texto(res, 401, 'Acesso restrito.', 'text/plain; charset=utf-8', { 'WWW-Authenticate': `Basic realm="${REALM}", charset="UTF-8"` });
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') return texto(res, 405, 'Metodo nao permitido.');

  let rel = decodeURIComponent(url.pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const alvo = path.normalize(path.join(PUBLIC, rel));
  if (!alvo.startsWith(PUBLIC + path.sep) && alvo !== PUBLIC) return texto(res, 403, 'Proibido.');
  fs.stat(alvo, (err, st) => {
    if (err || !st.isFile()) {
      const nf = path.join(PUBLIC, '404.html');
      return fs.readFile(nf, (e2, b) => texto(res, 404, e2 ? 'Nao encontrado.' : b, e2 ? 'text/plain; charset=utf-8' : 'text/html; charset=utf-8'));
    }
    const ext = path.extname(alvo).toLowerCase();
    cabecalhos(res);
    res.writeHead(200, { 'Content-Type': TIPOS[ext] || 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600' });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(alvo).pipe(res);
  });
});
servidor.listen(PORT, () => console.log(`[biblioteca] em :${PORT} · build=${BUILD.build} · documentos=${BUILD.documentos.length} · auth=${(USER && PASS) ? 'senha' : (IS_PROD ? 'FAIL-CLOSED' : 'dev-aberto')}`));
