'use strict';
/**
 * Estado de cada Reel do pacote: à filmer → filmé → publié (com o link do post) | écarté.
 * Arquivo append-only (estado-reels.jsonl): quem marcou, quando, e o link. É o que fecha o ciclo: com o link do post,
 * o Estúdio cruza a fórmula do roteiro com os números que o Olheiro leu daquele post.
 * Também guarda as edições feitas no painel (edicoes.jsonl): o Reel anterior fica gravado antes de ser trocado.
 */
const fs = require('node:fs');
const path = require('node:path');

const STATUS = ['a_filmer', 'filme', 'publie', 'ecarte'];
const RE_DIA = /^\d{4}-\d{2}-\d{2}$/;
const RE_REEL = /^[A-Za-z0-9_-]{1,12}$/;
const RE_LINK = /^https:\/\/(www\.)?(instagram\.com|tiktok\.com|vm\.tiktok\.com|youtube\.com|youtu\.be)\/[^\s<>"']{3,300}$/i;

function abrir(dir) {
  const arq = path.join(dir, 'estado-reels.jsonl');
  const arqEd = path.join(dir, 'edicoes.jsonl');
  const ler = (f) => { try { return fs.readFileSync(f, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; } };

  /** Marca o estado de um Reel. Devolve { ok, erro? }. `por`: 'julien' (página dele) ou 'painel'. */
  function marcar({ dia, reel, status, lien = null, note = null, por = 'painel', agora = Date.now() }) {
    if (!RE_DIA.test(String(dia))) return { ok: false, erro: 'dia inválido' };
    if (!RE_REEL.test(String(reel))) return { ok: false, erro: 'reel inválido' };
    if (!STATUS.includes(status)) return { ok: false, erro: `status: ${STATUS.join(', ')}` };
    const link = lien ? String(lien).trim() : null;
    if (link && !RE_LINK.test(link)) return { ok: false, erro: 'link: cole o endereço do post (instagram.com, tiktok.com ou youtube.com)' };
    const ev = { ts: new Date(agora).toISOString(), dia, reel, status, por: por === 'julien' ? 'julien' : 'painel', ...(link ? { lien: link } : {}), ...(note ? { note: String(note).slice(0, 200) } : {}) };
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(arq, JSON.stringify(ev) + '\n', 'utf8');
    return { ok: true, evento: ev };
  }

  /** Último estado de cada Reel de um dia: { R1: { status, lien, ts, por }, … }. O link de um "publie" anterior é mantido. */
  function doDia(dia) {
    const m = {};
    for (const e of ler(arq)) { if (e.dia !== dia) continue; m[e.reel] = { status: e.status, ts: e.ts, por: e.por, lien: e.lien || (m[e.reel] && m[e.reel].lien) || null, note: e.note || null }; }
    return m;
  }
  /** Todos os dias: { '2026-11-20': { R1: {...} } }. */
  function todos() {
    const m = {};
    for (const e of ler(arq)) { m[e.dia] = m[e.dia] || {}; const ant = m[e.dia][e.reel]; m[e.dia][e.reel] = { status: e.status, ts: e.ts, por: e.por, lien: e.lien || (ant && ant.lien) || null }; }
    return m;
  }
  function registrarEdicao({ dia, reel, antes, por = 'painel', motivo = 'edicao', agora = Date.now() }) {
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(arqEd, JSON.stringify({ ts: new Date(agora).toISOString(), dia, reel, por, motivo, antes }) + '\n', 'utf8');
  }
  const edicoes = (dia) => ler(arqEd).filter((e) => !dia || e.dia === dia);

  return { marcar, doDia, todos, registrarEdicao, edicoes, arquivo: arq };
}

module.exports = { abrir, STATUS, RE_DIA, RE_REEL, RE_LINK };
