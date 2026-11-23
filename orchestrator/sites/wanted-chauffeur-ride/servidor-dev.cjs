#!/usr/bin/env node
'use strict';
/**
 * Servidor de desenvolvimento do site /ride. Sem dependências (Node 18+).
 *
 *   node servidor-dev.cjs                      → http://localhost:8792/ (ou /ride/) com a API SIMULADA (nada sai, nada grava de verdade)
 *   CENTRAL_URL=https://<central> node servidor-dev.cjs   → a página fala com a Central de verdade (/api/chauffeur/* repassado)
 *   PORT=9000 node servidor-dev.cjs            → outra porta
 *
 * A API simulada responde o mesmo formato da Central (ver README, seção "API"): uma corrida confirmada depois de amanhã
 * às 9:00 PM, um dia inteiro bloqueado daqui a 4 dias, e grava reservas só na memória. Serve para mexer no visual e no
 * formulário sem depender de nada. Para testar de ponta a ponta, use CENTRAL_URL.
 */
const http = require('node:http');
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');

const PORT = Number(process.env.PORT || 8792);
const PUB = path.join(__dirname, 'public');
const CENTRAL = String(process.env.CENTRAL_URL || '').replace(/\/+$/, '');
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png', '.json': 'application/json' };

// ---------------------------------------------------------------- API simulada
const hojeParis = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const somarDias = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const reservas = new Map();
function agendaSimulada(de, dias) {
  const hoje = hojeParis(); const ini = /^\d{4}-\d{2}-\d{2}$/.test(de || '') ? de : hoje; const n = Math.max(1, Math.min(62, Number(dias) || 14));
  const agoraMin = (() => { const p = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Paris', hourCycle: 'h23', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date()); const o = Object.fromEntries(p.map((x) => [x.type, x.value])); return Number(o.hour) * 60 + Number(o.minute); })();
  const out = [];
  for (let i = 0; i < n; i++) {
    const d = somarDias(ini, i); let ocupado = []; let fechado = d < hoje;
    if (d === hoje) ocupado.push([0, Math.min(1440, agoraMin + 120)]);                       // antecedência de 2 h
    if (d === somarDias(hoje, 2)) ocupado.push([1230, 1440]);                                 // Game Night 9:00 PM (+ folga)
    if (d === somarDias(hoje, 3)) ocupado.push([0, 30]);                                      // … que passa da meia-noite
    if (d === somarDias(hoje, 4)) fechado = true;                                             // folga do Julien
    if (fechado) ocupado = [[0, 1440]];
    out.push({ data: d, fechado, ocupado });
  }
  return { fuso: 'Europe/Paris', agora: new Date().toISOString(), hoje, primeiro_dia: ini, horizonte: somarDias(hoje, 90), antecedencia_min: 120, folga_min: 30, duracoes_min: { transfer: 90, mad: 120, night: 60, game: 180, soiree: 300 }, passo_min: 5, dias: out, simulada: true };
}
function apiSimulada(req, res, u) {
  const json = (c, o) => { res.writeHead(c, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
  if (u.pathname === '/api/chauffeur/disponibilidade' && req.method === 'GET') return json(200, agendaSimulada(u.searchParams.get('de'), u.searchParams.get('dias')));
  if (u.pathname === '/api/chauffeur/reserva' && req.method === 'POST') {
    let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => {
      let r; try { r = JSON.parse(b); } catch { return json(400, { error: 'JSON inválido' }); }
      if (!r.nome || r.nome.trim().length < 2) return json(400, { error: 'nome de quem embarca (2 a 80 letras)' });
      if (r.data === somarDias(hojeParis(), 4)) return json(409, { error: 'dia indisponível', motivo: 'dia_fechado' });
      if (reservas.has(r.codigo)) return json(200, { ok: true, codigo: r.codigo, repetido: true });
      reservas.set(r.codigo, r); console.log('[simulada] reserva recebida', r.codigo, r.produto, r.data, r.hora, '(só na memória)');
      json(201, { ok: true, codigo: r.codigo });
    });
    return;
  }
  json(404, { error: 'rota desconhecida na API simulada' });
}

// ---------------------------------------------------------------- repasse à Central
function repassar(req, res, u) {
  const alvo = new URL(u.pathname + u.search, CENTRAL);
  const lib = alvo.protocol === 'https:' ? https : http;
  const p = lib.request(alvo, { method: req.method, headers: { 'content-type': req.headers['content-type'] || 'application/json', accept: 'application/json', origin: alvo.origin } }, (r) => { res.writeHead(r.statusCode, { 'content-type': r.headers['content-type'] || 'application/json' }); r.pipe(res); });
  p.on('error', (e) => { res.writeHead(502, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'Central fora: ' + e.message })); });
  req.pipe(p);
}

http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname.startsWith('/api/chauffeur/')) return CENTRAL ? repassar(req, res, u) : apiSimulada(req, res, u);
  // Como em produção (raiz de ride.theworldkeys.com) e também em /ride/ (como a Central serve); /ride sem barra redireciona.
  if (u.pathname === '/ride') { res.writeHead(301, { location: '/ride/' + u.search }); return res.end(); }
  const rel = decodeURIComponent(u.pathname.replace(/^\/ride\//, '/').replace(/^\//, '')) || 'index.html';
  const file = path.resolve(PUB, rel);
  if (!file.startsWith(PUB + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(data);
  });
}).listen(PORT, () => console.log(`[ride] http://localhost:${PORT}/  (também /ride/)  ·  API: ${CENTRAL ? 'Central em ' + CENTRAL : 'SIMULADA (nada sai, nada grava)'}`));
