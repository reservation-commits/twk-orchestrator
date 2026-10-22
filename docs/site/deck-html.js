#!/usr/bin/env node
'use strict';
/**
 * Converte um deck do tipo "Slides" (pasta project/ com deck.json + slides/<id>.html) numa página HTML única,
 * legível em qualquer navegador e sem JavaScript: cada slide é uma tela 1920×1080 reduzida por CSS para a largura
 * da página, com as notas do apresentador logo abaixo, dobradas.
 *
 *   node docs/site/deck-html.js <pasta do deck> <saida.html> [--lang pt|fr]
 *
 * A pasta do deck é a que contém project/deck.json. O resultado é fonte da Biblioteca (documentos.json) e vale
 * como documento manual em francês quando gravado como <slug>.fr.html ao lado do original.
 */
const fs = require('node:fs');
const path = require('node:path');

const [pasta, saida, ...resto] = process.argv.slice(2);
if (!pasta || !saida) { console.error('uso: node deck-html.js <pasta do deck> <saida.html> [--lang pt|fr]'); process.exit(2); }
const lang = (() => { const i = resto.indexOf('--lang'); return i >= 0 ? resto[i + 1] : 'pt'; })();

const T = {
  pt: { html_lang: 'pt-BR', notas: 'Notas do apresentador', slide: 'Slide', de: 'de', fonte: 'Apresentação de' },
  fr: { html_lang: 'fr', notas: 'Notes du présentateur', slide: 'Diapositive', de: 'sur', fonte: 'Présentation du' },
}[lang] || { html_lang: lang, notas: 'Notes', slide: 'Slide', de: '/', fonte: '' };

const projeto = path.join(pasta, 'project');
const deck = JSON.parse(fs.readFileSync(path.join(projeto, 'deck.json'), 'utf8'));
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Formas do formato de slide que o navegador não conhece: só a seta para a direita é usada nos decks da TWK.
function formas(html) {
  return html.replace(/<x-shape\s+kind="([a-z-]+)"\s+style="([^"]*)"\s*><\/x-shape>/g, (m, kind, style) => {
    const bg = (style.match(/background:\s*(#[0-9a-fA-F]{3,8}|[a-z]+)/) || [])[1] || 'currentColor';
    const w = Number((style.match(/width:\s*(\d+)/) || [])[1] || 48);
    const h = Number((style.match(/height:\s*(\d+)/) || [])[1] || 24);
    if (kind === 'arrow-right') {
      const cabeca = Math.round(w * 0.4); const haste = Math.round(h * 0.56); const y0 = Math.round((h - haste) / 2);
      return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true" style="flex:none"><path d="M0 ${y0}h${w - cabeca}V0l${cabeca} ${h / 2}-${cabeca} ${h / 2}v-${y0}H0z" fill="${bg}"/></svg>`;
    }
    return `<span style="display:inline-block;${style}"></span>`;
  });
}

const slides = deck.order.map((id, i) => {
  const arq = path.join(projeto, 'slides', `${id}.html`);
  if (!fs.existsSync(arq)) { console.error(`FALHOU: slide listado não existe: ${id}`); process.exit(2); }
  let html = fs.readFileSync(arq, 'utf8').trim();
  let notas = '';
  html = html.replace(/<aside>([\s\S]*?)<\/aside>\s*/i, (m, n) => { notas = n.trim(); return ''; });
  html = formas(html);
  return { id, i: i + 1, html, notas };
});

const CSS = `
  :root{--ground:#FBFAF7;--ink:#1B1812;--muted:#6E6657;--rule:#E2DCCE;--accent:#8A6512}
  @media (prefers-color-scheme:dark){:root{--ground:#15130F;--ink:#EFE9DC;--muted:#A39883;--rule:#2F2A21;--accent:#D9AE55}}
  *{box-sizing:border-box}
  body{margin:0;background:var(--ground);color:var(--ink);font-family:"Jost","Segoe UI",system-ui,sans-serif;line-height:1.5;padding:28px 16px 64px}
  .page{max-width:1280px;margin:0 auto}
  header{display:flex;flex-wrap:wrap;gap:6px 18px;align-items:baseline;margin:0 0 20px;padding-bottom:12px;border-bottom:1px solid var(--rule)}
  header h1{font:500 26px/1.2 "Cormorant Garamond",Georgia,serif;margin:0}
  header p{margin:0;font:12px/1.4 "IBM Plex Mono",ui-monospace,Consolas,monospace;letter-spacing:.06em;color:var(--muted);text-transform:uppercase}
  figure{margin:0 0 28px}
  .tela{container-type:inline-size;width:100%;aspect-ratio:16/9;overflow:hidden;border:1px solid var(--rule);box-shadow:0 8px 28px rgba(0,0,0,.14);background:#141821}
  /* Fator = largura da tela ÷ 1920 px. CSS não divide comprimentos; tan(atan2(a, b)) devolve a/b como número puro. */
  .tela>section{width:1920px;height:1080px;position:relative;transform-origin:0 0;transform:scale(tan(atan2(100cqw, 1920px)));overflow:hidden}
  @supports not (transform:scale(tan(atan2(1cqw, 1px)))){.tela{aspect-ratio:auto;overflow:auto}.tela>section{transform:none}}
  /* Padrões do formato de slide: nada de margem, tamanhos explícitos vêm inline. */
  .tela>section *{margin:0;box-sizing:border-box}
  .tela>section h1{font-size:96px;font-weight:600;line-height:1.1}
  .tela>section h2{font-size:64px;font-weight:600;line-height:1.15}
  .tela>section h3{font-size:44px;font-weight:600;line-height:1.2}
  .tela>section p{font-size:32px;line-height:1.4}
  .tela>section ul,.tela>section ol{padding-left:1.2em}
  .tela>section li{line-height:inherit}
  .tela>section hr{border:0;height:0}
  .tela>section div:not([style*="display:"]){display:flex;flex-direction:column}
  .tela>section table{border-collapse:collapse;width:100%}
  .tela>section th,.tela>section td{padding:.35em .6em;border-bottom:1px solid rgba(128,128,128,.35);vertical-align:top;text-align:left}
  .tela>section tr:last-child td{border-bottom:0}
  .tela>section b{font-weight:600}
  figcaption{display:flex;justify-content:space-between;gap:12px;margin-top:8px;font:12px/1.4 "IBM Plex Mono",ui-monospace,Consolas,monospace;letter-spacing:.06em;color:var(--muted);text-transform:uppercase}
  details{margin-top:6px;font-size:14.5px;color:var(--ink)}
  details summary{cursor:pointer;color:var(--accent);font-size:13px;letter-spacing:.04em}
  details p{margin:8px 0 0;max-width:72ch;white-space:pre-wrap}
  @media print{body{background:#fff;padding:0}.tela{box-shadow:none;border:0}figure{break-inside:avoid;page-break-inside:avoid;margin:0 0 12px}details{display:none}}
`;

const fontes = Object.values(deck.faces || {}).map((f) => f.href).filter(Boolean);
const titulo = deck.title || path.basename(saida, '.html');
const out = [
  '<!doctype html>',
  `<html lang="${T.html_lang}">`,
  '<head>',
  '<meta charset="utf-8">',
  '<meta name="viewport" content="width=device-width, initial-scale=1">',
  '<meta name="robots" content="noindex, nofollow">',
  `<title>${esc(titulo)}</title>`,
  '<link rel="preconnect" href="https://fonts.googleapis.com">',
  '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
  ...fontes.map((h) => `<link rel="stylesheet" href="${esc(h)}">`),
  `<style>${CSS}</style>`,
  '</head>',
  '<body>',
  '<div class="page">',
  `<header><h1>${esc(titulo)}</h1><p>${esc(T.fonte)} ${esc((deck.createdOnFiles && deck.createdOnFiles.at || '').slice(0, 10))} · ${slides.length} ${esc(T.slide.toLowerCase())}s</p></header>`,
  ...slides.map((s) => [
    `<figure id="${esc(s.id)}">`,
    `<div class="tela">${s.html}</div>`,
    `<figcaption><span>${esc(T.slide)} ${s.i} ${esc(T.de)} ${slides.length}</span><span>The World Keys</span></figcaption>`,
    s.notas ? `<details><summary>${esc(T.notas)}</summary><p>${esc(s.notas)}</p></details>` : '',
    '</figure>',
  ].join('\n')),
  '</div>',
  '</body>',
  '</html>',
  '',
].join('\n');

fs.mkdirSync(path.dirname(saida), { recursive: true });
fs.writeFileSync(saida, out);
console.log(`${path.relative(process.cwd(), saida)}: ${slides.length} slides, ${Math.round(out.length / 1024)} KB`);
