'use strict';
/**
 * Estúdio Viral na Central (19/11/2026): a página do Julien e a API do pacote do dia.
 *
 *   GET /studio/<dia>?t=<token>        ← pública com link assinado (HMAC do dia, mesmo segredo do link de confirmar):
 *                                        a página em francês do pacote, sem script (CSP). Token errado → 404 mudo.
 *   GET /api/estudio/pacote?dia=       → o pacote completo (chave da Central); sem dia = o mais recente
 *   GET /api/estudio/dias              → os dias com pacote (chave)
 *   GET /api/estudio/link?dia=         → o link assinado da página (chave)
 *
 * Só leitura. Quem escreve é a rotina `estudio-viral` (rotinas.js) em STATE_DIR/agents/estudio-viral/.
 */
const fs = require('node:fs');
const path = require('node:path');

const AGENTS_DIR = process.env.TWK_AGENTS_DIR || path.join(__dirname, '..', 'agents');
const render = require(path.join(AGENTS_DIR, 'estudio-viral', 'render.js'));
const runMod = require(path.join(AGENTS_DIR, 'estudio-viral', 'run.js'));

function criar({ stateDir, env = process.env } = {}) {
  const dir = path.join(stateDir, 'agents', 'estudio-viral');
  const RE_DIA = /^\d{4}-\d{2}-\d{2}$/;

  function dias() {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter((f) => /^pacote-\d{4}-\d{2}-\d{2}\.json$/.test(f)).map((f) => f.slice(7, 17)).sort().reverse();
  }
  function ler(dia) {
    if (!RE_DIA.test(String(dia))) return null;
    const p = path.join(dir, `pacote-${dia}.json`);
    if (!fs.existsSync(p)) return null;
    try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
  }
  function veille(dia) { const p = path.join(dir, `veille-${dia}.json`); try { return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null; } catch { return null; } }

  /** Rota pública (antes da chave). Devolve true se tratou. */
  function tratarPublico(req, res, u) {
    const m = /^\/studio\/(\d{4}-\d{2}-\d{2})\/?$/.exec(u.pathname);
    if (!m || req.method !== 'GET') return false;
    const dia = m[1]; const t = u.searchParams.get('t');
    const pacote = runMod.tokenValido(dia, t, env) ? ler(dia) : null;
    if (!pacote) { res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' }); res.end('<!doctype html><html lang="fr"><meta charset="utf-8"><title>Introuvable</title><p style="font-family:system-ui;padding:24px">Page introuvable.</p></html>'); return true; }
    const v = pacote._verificacao || {};
    const corpo = render.html(pacote, { medidas: v.medidas || {}, problemas: v.problemas || [], veille: veille(dia) });
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'private, no-store', 'x-robots-tag': 'noindex' });
    res.end(corpo);
    return true;
  }

  /** Rotas com chave. Devolve true se tratou. */
  function tratar(req, res, u, json) {
    if (!u.pathname.startsWith('/api/estudio')) return false;
    if (req.method !== 'GET') { json(res, 405, { error: 'só leitura' }); return true; }
    if (u.pathname === '/api/estudio/dias') { json(res, 200, { dias: dias(), pasta: dir }); return true; }
    if (u.pathname === '/api/estudio/pacote') {
      const dia = u.searchParams.get('dia') || dias()[0];
      const p = dia ? ler(dia) : null;
      if (!p) { json(res, 404, { error: dia ? `sem pacote para ${dia}` : 'nenhum pacote ainda: a rotina estudio-viral não rodou (ESTUDIO_VIRAL=on + ANTHROPIC_API_KEY)' }); return true; }
      json(res, 200, { dia, pacote: p, markdown: render.markdownFr(p, { medidas: (p._verificacao || {}).medidas || {}, problemas: (p._verificacao || {}).problemas || [] }), link: runMod.link(dia, env) });
      return true;
    }
    if (u.pathname === '/api/estudio/link') { const dia = u.searchParams.get('dia') || dias()[0]; json(res, 200, { dia, link: dia ? runMod.link(dia, env) : null, motivo: runMod.link(dia || '2026-01-01', env) ? null : 'sem CHAUFFEUR_CONFIRMA_URL ou segredo (CHAUFFEUR_CONFIRMA_SECRET/CENTER_TOKEN)' }); return true; }
    json(res, 404, { error: 'rota desconhecida em /api/estudio' });
    return true;
  }

  return { tratarPublico, tratar, dias, ler, dir };
}

module.exports = { criar };
