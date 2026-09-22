#!/usr/bin/env node
'use strict';
/**
 * Gera os Extratos de Resposta para a lista-alvo (sem enviar) + manifesto + caderno de revisão.
 *   node gerar.js [--alvos <csv>] [--detalhe <json>] [--horarios <json>] [--selo]
 * Saída: orchestrator/state/chave-girada/extratos/<seg>-<id>-<lang>.html · manifesto.csv · revisao.html
 * Envio é SEMPRE outra etapa, com aprovação (Portão). Aqui nada sai.
 */
const fs = require('node:fs');
const path = require('node:path');
const { gerarExtrato } = require('./extratos');

const RAIZ = path.resolve(__dirname, '..', '..', '..');
const ST = path.join(RAIZ, 'orchestrator', 'state', 'chave-girada');
const a = process.argv.slice(2);
const val = (n, d) => { const i = a.indexOf(n); return i >= 0 ? a[i + 1] : d; };
const alvosCsv = val('--alvos', path.join(ST, 'alvos-2026-09-03.csv'));
const detalheJson = val('--detalhe', null);
const horariosJson = val('--horarios', path.join(ST, 'horarios-propostos.json'));
const selo = a.includes('--selo');

const linhas = fs.readFileSync(alvosCsv, 'utf8').split(/\r?\n/).filter(Boolean);
const cols = linhas[0].split(';');
const alvos = linhas.slice(1).map((l) => Object.fromEntries(l.split(';').map((v, i) => [cols[i], v])));
const detalhe = detalheJson && fs.existsSync(detalheJson) ? Object.fromEntries(JSON.parse(fs.readFileSync(detalheJson, 'utf8')).map((r) => [String(r.restaurant_id), r])) : {};
const horarios = fs.existsSync(horariosJson) ? Object.fromEntries(JSON.parse(fs.readFileSync(horariosJson, 'utf8')).filter((h) => h.proposta_texto).map((h) => [String(h.restaurant_id), h.proposta_texto])) : {};

const confirmadores = alvos.filter((x) => x.segmento === 'A-CONFIRMADOR').length;
const outDir = path.join(ST, 'extratos'); fs.mkdirSync(outDir, { recursive: true });
const manifesto = ['segmento;restaurant_id;nome;cidade;pais;idioma;arquivo;assunto;horarios_corrigidos;pedidos_180d;aceitos;recusados'];
const cards = [];
let n = 0;
for (const t of alvos) {
  const nums = { pedidos: +t.pedidos_180d, aceitos: +t.aceitos, recusados: +t.recusados, resp_propria: +t.resp_propria, pedidos_hist: detalhe[t.restaurant_id]?.pedidos_hist ?? null, aceitos_hist: detalhe[t.restaurant_id]?.aceitos_hist ?? null };
  // e-mail de reservas da casa: só a versão MASCARADA vai para o texto (i***@dominio) — a casa reconhece, ninguém mais.
  const e = gerarExtrato({ segmento: t.segmento, idioma: t.idioma, casa: { name: t.nome, city: t.cidade }, n: nums, restaurant_id: t.restaurant_id, ctx: { confirmadores, publicados: 1548, email: detalhe[t.restaurant_id]?.email || null, horarios_corrigidos: horarios[t.restaurant_id] || null, seloDisponivel: selo } });
  const file = `${e.segmento}-${t.restaurant_id}-${t.idioma}.html`;
  fs.writeFileSync(path.join(outDir, file), `<!-- ${t.nome} · ${t.cidade} · ${t.segmento} · gerado ${new Date().toISOString()} · NÃO ENVIADO -->\n<!-- assunto: ${e.assunto} -->\n${e.html}`, 'utf8');
  manifesto.push([t.segmento, t.restaurant_id, t.nome, t.cidade, t.pais, t.idioma, file, e.assunto.replace(/;/g, ','), horarios[t.restaurant_id] ? 'sim' : 'não', nums.pedidos, nums.aceitos, nums.recusados].join(';'));
  cards.push(`<section style="margin:28px 0"><h3 style="margin:0 0 6px;font-family:Arial">${t.segmento} · ${t.nome} · ${t.cidade} (${t.idioma})</h3><p style="margin:0 0 10px;color:#666;font-family:Arial"><b>Assunto:</b> ${e.assunto}<br/><b>Pré-visualização:</b> ${e.preheader}</p><iframe title="${t.nome}" srcdoc="${e.html.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}" style="width:100%;height:1180px;border:0;background:#0B0A08;border-radius:12px"></iframe></section>`);
  n++;
}
fs.writeFileSync(path.join(ST, 'manifesto-extratos.csv'), manifesto.join('\n'), 'utf8');
fs.writeFileSync(path.join(ST, 'revisao-extratos.html'), `<!doctype html><meta charset="utf-8"><title>Chave Girada — revisão dos Extratos (${n})</title><body style="font-family:Arial;max-width:760px;margin:24px auto"><h1>Extratos de Resposta — ${n} casas · NADA ENVIADO</h1><p>Gerado em ${new Date().toISOString()}. Aprovação em lote pelo fundador; envio via n8n <code>maestro-email</code> com <code>exigirOptout</code>.</p>${cards.join('\n')}</body>`, 'utf8');
console.log(`extratos: ${n} · manifesto: ${path.relative(RAIZ, path.join(ST, 'manifesto-extratos.csv'))} · revisão: ${path.relative(RAIZ, path.join(ST, 'revisao-extratos.html'))} · com horários corrigidos: ${Object.keys(horarios).length}`);
