#!/usr/bin/env node
'use strict';
/**
 * Monta o site da Biblioteca TWK (português e francês) a partir dos documentos em docs/agentes e empacota para o Easypanel.
 *
 *   node docs/site/montar.js                   → gera public/ (pt + fr) e o zip; traduz pela API o que ainda não tem tradução
 *   node docs/site/montar.js --sem-traducao    → não chama a API: sem tradução pronta, a página em francês avisa e leva ao original
 *   node docs/site/montar.js --forcar-traducao → retraduz tudo pela API, ignorando o cache
 *   node docs/site/montar.js --sem-zip         → só gera public/
 *
 * Fonte única: documentos.json (o que entra) + os HTML originais em docs/agentes (nunca editados aqui).
 * Traduções: docs/agentes/<slug>.fr.html (manual, vence) ou docs/site/traducoes/ (cache da API). Ver traduzir.js.
 * Falha alto: documento listado que não existe derruba a montagem; tradução reprovada na verificação também.
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { obterTraducao } = require('./traduzir.js');

const RAIZ = path.resolve(__dirname, '..', '..');
const SITE = __dirname;
const PUBLIC = path.join(SITE, 'public');
const SAIDA = path.join(SITE, 'public.tmp'); // monta aqui e só troca no fim: uma falha nunca deixa o public/ pela metade
const docs = JSON.parse(fs.readFileSync(path.join(SITE, 'documentos.json'), 'utf8'));
const a = process.argv.slice(2);
const semZip = a.includes('--sem-zip');
const semTraducao = a.includes('--sem-traducao');
const forcar = a.includes('--forcar-traducao');

const IDIOMAS = ['pt', 'fr'];
const T = {
  pt: { html_lang: 'pt-BR', eyebrow: 'Uso interno', titulo: 'Biblioteca The World Keys', intro: 'Os planos e análises da operação, na versão mais recente. Cada documento indica se está em vigor, se é uma análise ou se já foi superado.', montado: 'montado em', documentos: 'documentos', pendente: 'em português', voltar: 'Voltar à lista de documentos', nf_titulo: 'Página não encontrada', nf_texto: 'Este endereço não existe na biblioteca.', p_titulo: 'Tradução em preparação', p_texto: 'Este documento ainda não tem versão em português.', p_link: 'Abrir o original', biblioteca: 'Biblioteca', idioma: 'Idioma',
    grupos: { Planos: 'Planos', Análises: 'Análises', Histórico: 'Histórico' }, estados: { vigente: 'vigente', análise: 'análise', superado: 'superado', referência: 'referência' } },
  fr: { html_lang: 'fr', eyebrow: 'Usage interne', titulo: 'Bibliothèque The World Keys', intro: 'Les plans et analyses de l’opération, dans leur version la plus récente. Chaque document indique s’il est en vigueur, s’il s’agit d’une analyse ou s’il a été remplacé.', montado: 'assemblée le', documentos: 'documents', pendente: 'en portugais', voltar: 'Retour à la liste des documents', nf_titulo: 'Page introuvable', nf_texto: 'Cette adresse n’existe pas dans la bibliothèque.', p_titulo: 'Traduction en préparation', p_texto: 'Ce document n’a pas encore de version française.', p_link: 'Ouvrir l’original en portugais', biblioteca: 'Bibliothèque', idioma: 'Langue',
    grupos: { Planos: 'Plans', Análises: 'Analyses', Histórico: 'Historique' }, estados: { vigente: 'en vigueur', análise: 'analyse', superado: 'remplacé', referência: 'référence' } },
};

const carimbo = new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '');
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const dataBr = (iso) => { const [ano, m, d] = iso.split('-'); return `${d}/${m}/${ano}`; };
const classeEstado = (e) => e.normalize('NFD').replace(/[^a-z]/g, '');
const raizDe = (idioma) => (idioma === 'pt' ? '/' : `/${idioma}/`);
const urlDoc = (idioma, slug) => `${raizDe(idioma)}planos/${slug}.html`;

// Barra fixa acrescentada ao fim de cada documento: volta à Biblioteca e troca de idioma.
function barra(idioma, slug, opts = {}) {
  const t = T[idioma];
  // Documento com seletor de idioma próprio: só o atalho de volta, no canto inferior, longe dos controles dele.
  if (opts.soVoltar) return `
<nav aria-label="${esc(t.biblioteca)}" style="position:fixed;bottom:14px;right:14px;z-index:9;padding:6px 12px;border-radius:999px;background:rgba(27,24,18,.88);font:12px/1 'IBM Plex Mono',ui-monospace,Consolas,monospace;letter-spacing:.06em;backdrop-filter:blur(4px)"><a href="${raizDe(idioma)}" style="color:#EFE9DC;text-decoration:none">${esc(t.biblioteca)}</a></nav>
`;
  const links = IDIOMAS.map((i) => `<a href="${urlDoc(i, slug)}" style="color:${i === idioma ? '#CE9E3C' : '#EFE9DC'};text-decoration:none;font-weight:${i === idioma ? '600' : '400'}"${i === idioma ? ' aria-current="true"' : ''}>${i.toUpperCase()}</a>`).join('<span style="opacity:.45">·</span>');
  return `\n<nav aria-label="${esc(t.idioma)}" style="position:fixed;top:10px;right:12px;z-index:9;display:flex;align-items:center;gap:8px;padding:6px 10px;border-radius:999px;background:rgba(27,24,18,.88);color:#EFE9DC;font:12px/1 'IBM Plex Mono',ui-monospace,Consolas,monospace;letter-spacing:.06em;backdrop-filter:blur(4px)"><a href="${raizDe(idioma)}" style="color:#EFE9DC;text-decoration:none;opacity:.8">${esc(t.biblioteca)}</a><span style="opacity:.45">|</span>${links}</nav>\n`;
}

function paginaSimples(idioma, titulo, texto, linkHref, linkTexto) {
  return `<!doctype html><html lang="${T[idioma].html_lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(titulo)}</title>
<style>body{font-family:system-ui,sans-serif;background:#FBFAF7;color:#1B1812;padding:48px 20px;max-width:640px;margin:auto;line-height:1.6}a{color:#8A6512}@media (prefers-color-scheme:dark){body{background:#15130F;color:#EFE9DC}a{color:#D9AE55}}</style></head>
<body><h1>${esc(titulo)}</h1><p>${esc(texto)} <a href="${linkHref}">${esc(linkTexto)}</a>.</p></body></html>`;
}

const CSS = `
  :root { --ground:#FBFAF7; --surface:#F3F0E8; --ink:#1B1812; --ink-2:#4A443A; --muted:#6E6657; --rule:#E2DCCE; --accent:#8A6512; --accent-soft:#CE9E3C; --good:#2F7A4A; --focus:#2A6BB0;
    --serif:"Libre Caslon Text",Georgia,"Times New Roman",serif; --sans:"Instrument Sans","Segoe UI",system-ui,sans-serif; --mono:"IBM Plex Mono",ui-monospace,Consolas,monospace; }
  @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --ground:#15130F; --surface:#1E1B15; --ink:#EFE9DC; --ink-2:#CFC6B4; --muted:#A39883; --rule:#2F2A21; --accent:#D9AE55; --good:#6DBB86; --focus:#D9AE55; } }
  :root[data-theme="dark"] { --ground:#15130F; --surface:#1E1B15; --ink:#EFE9DC; --ink-2:#CFC6B4; --muted:#A39883; --rule:#2F2A21; --accent:#D9AE55; --good:#6DBB86; --focus:#D9AE55; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--ground); color:var(--ink); font-family:var(--sans); font-size:16px; line-height:1.6; padding-inline:20px; padding-block:0 56px; -webkit-font-smoothing:antialiased; }
  .page { max-width:720px; margin-inline:auto; }
  a:focus-visible { outline:2px solid var(--focus); outline-offset:3px; border-radius:4px; }
  header { padding-block:52px 24px; border-bottom:1px solid var(--rule); display:grid; gap:10px; }
  .topo { display:flex; justify-content:space-between; align-items:center; gap:12px; }
  .eyebrow { font-family:var(--mono); font-size:12px; letter-spacing:.08em; text-transform:uppercase; color:var(--accent); margin:0; }
  .idiomas { display:flex; gap:8px; font-family:var(--mono); font-size:12px; letter-spacing:.06em; }
  .idiomas a { color:var(--muted); text-decoration:none; }
  .idiomas a[aria-current] { color:var(--accent); font-weight:600; }
  h1 { font-family:var(--serif); font-weight:400; font-size:clamp(32px,6vw,44px); line-height:1.1; margin:0; }
  header p { margin:0; color:var(--ink-2); max-width:58ch; }
  section { padding-block:28px 0; display:grid; gap:12px; }
  h2 { font-family:var(--mono); font-weight:500; font-size:12px; letter-spacing:.08em; text-transform:uppercase; color:var(--muted); margin:0; }
  ul { margin:0; padding:0; list-style:none; display:grid; gap:10px; }
  .doc a { display:grid; grid-template-columns:minmax(0,1fr) auto; grid-template-areas:"estado data" "titulo titulo" "desc desc"; gap:4px 16px; padding:16px 18px; border:1px solid var(--rule); border-radius:6px; text-decoration:none; color:inherit; background:var(--ground); transition:border-color .12s ease; }
  .doc a:hover { border-color:var(--accent-soft); }
  .estado { grid-area:estado; justify-self:start; font-family:var(--mono); font-size:11px; letter-spacing:.06em; text-transform:uppercase; padding:1px 8px; border-radius:999px; border:1px solid var(--rule); color:var(--muted); }
  .estado.vigente { color:var(--good); border-color:color-mix(in srgb,var(--good) 45%,var(--rule)); }
  .estado.anlise { color:var(--accent); border-color:color-mix(in srgb,var(--accent-soft) 55%,var(--rule)); }
  .titulo { grid-area:titulo; font-family:var(--serif); font-size:22px; line-height:1.2; margin-top:4px; }
  .titulo small { font-family:var(--mono); font-size:11px; color:var(--muted); margin-left:8px; vertical-align:middle; }
  .desc { grid-area:desc; font-size:14.5px; color:var(--ink-2); }
  .data { grid-area:data; font-family:var(--mono); font-size:12px; color:var(--muted); }
  footer { margin-top:40px; padding-top:14px; border-top:1px solid var(--rule); font-family:var(--mono); font-size:12px; color:var(--muted); display:flex; flex-wrap:wrap; gap:6px 18px; }
`;

function indice(idioma, estadoTraducao) {
  const t = T[idioma];
  const campo = (d, k) => (idioma === 'pt' ? d[k] : (d[`${k}_${idioma}`] || d[k]));
  const cartao = (d) => [
    '        <li class="doc">',
    `          <a href="${urlDoc(idioma, d.slug)}">`,
    `            <span class="estado ${classeEstado(d.estado)}">${esc(t.estados[d.estado] || d.estado)}</span>`,
    `            <span class="titulo">${esc(campo(d, 'titulo'))}${estadoTraducao[d.slug] === 'pendente' && idioma !== 'pt' ? `<small>${esc(t.pendente)}</small>` : ''}</span>`,
    `            <span class="desc">${esc(campo(d, 'descricao'))}</span>`,
    `            <span class="data">${dataBr(d.data)}</span>`,
    '          </a>',
    '        </li>',
  ].join('\n');
  const grupos = [...new Set(docs.map((d) => d.grupo))];
  const secao = (g) => ['    <section>', `      <h2>${esc(t.grupos[g] || g)}</h2>`, '      <ul>', docs.filter((d) => d.grupo === g).map(cartao).join('\n'), '      </ul>', '    </section>'].join('\n');
  const idiomas = IDIOMAS.map((i) => `<a href="${raizDe(i)}"${i === idioma ? ' aria-current="true"' : ''}>${i.toUpperCase()}</a>`).join('');
  return [
    '<!doctype html>',
    `<html lang="${t.html_lang}">`,
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="robots" content="noindex, nofollow">',
    `<title>${esc(t.titulo)}</title>`,
    '<link rel="preconnect" href="https://fonts.googleapis.com">',
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
    '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Libre+Caslon+Text:ital,wght@0,400;1,400&family=Instrument+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap">',
    `<style>${CSS}</style>`,
    '</head>',
    '<body>',
    '  <div class="page">',
    '    <header>',
    `      <div class="topo"><p class="eyebrow">${esc(t.eyebrow)}</p><nav class="idiomas" aria-label="${esc(t.idioma)}">${idiomas}</nav></div>`,
    `      <h1>${esc(t.titulo)}</h1>`,
    `      <p>${esc(t.intro)}</p>`,
    '    </header>',
    grupos.map(secao).join('\n'),
    `    <footer><span>The World Keys</span><span>${esc(t.montado)} ${dataBr(carimbo.slice(0, 10))} ${carimbo.slice(11, 13)}:${carimbo.slice(13, 15)} UTC</span><span>${docs.length} ${esc(t.documentos)}</span></footer>`,
    '  </div>',
    '</body>',
    '</html>',
    '',
  ].join('\n');
}

(async () => {
  fs.rmSync(SAIDA, { recursive: true, force: true });
  for (const i of IDIOMAS) fs.mkdirSync(path.join(SAIDA, i === 'pt' ? '' : i, 'planos'), { recursive: true });

  const estadoTraducao = {};
  for (const d of docs) {
    const origem = path.join(RAIZ, d.fonte);
    if (!fs.existsSync(origem)) { console.error(`FALHOU: documento listado não existe: ${d.fonte}`); process.exit(2); }
    const html = fs.readFileSync(origem, 'utf8');
    if (d.bilingue) {
      // Já traz os dois idiomas e o próprio seletor: a mesma página serve os dois endereços; em /fr/ ela abre em francês.
      fs.writeFileSync(path.join(SAIDA, 'planos', `${d.slug}.html`), html + barra('pt', d.slug, { soVoltar: true }));
      for (const idioma of IDIOMAS.filter((i) => i !== 'pt')) {
        // A cópia em francês já nasce em francês no próprio HTML (atributo data-lang e botão marcado): funciona mesmo
        // onde o JavaScript não roda (pré-visualização de anexos no iPhone/iPad, leitores de e-mail). O clique automático
        // só completa o trabalho onde há JavaScript: redesenha os gráficos no idioma certo.
        const htmlIdioma = html
          .replace(/<html lang="[^"]*" data-lang="pt">/, `<html lang="${idioma}" data-lang="${idioma}">`)
          .split('data-setlang="pt" class="on"').join('data-setlang="pt"')
          .split(`data-setlang="${idioma}">`).join(`data-setlang="${idioma}" class="on">`);
        const abreEm = `
<script>(function(){var b=document.querySelector('[data-setlang="${idioma}"]');if(b)b.click();})();</script>
`;
        fs.writeFileSync(path.join(SAIDA, idioma, 'planos', `${d.slug}.html`), htmlIdioma + abreEm + barra(idioma, d.slug, { soVoltar: true }));
      }
      estadoTraducao[d.slug] = 'bilingue';
      continue;
    }
    fs.writeFileSync(path.join(SAIDA, 'planos', `${d.slug}.html`), html + barra('pt', d.slug));
    for (const idioma of IDIOMAS.filter((i) => i !== 'pt')) {
      const destino = path.join(SAIDA, idioma, 'planos', `${d.slug}.html`);
      const tr = await obterTraducao({ slug: d.slug, fonteRelativa: d.fonte, origemHtml: html, para: idioma, permitirApi: !semTraducao, forcar });
      if (tr) { fs.writeFileSync(destino, tr.html + barra(idioma, d.slug)); estadoTraducao[d.slug] = tr.fonte; }
      else { fs.writeFileSync(destino, paginaSimples(idioma, T[idioma].p_titulo, T[idioma].p_texto, urlDoc('pt', d.slug), T[idioma].p_link) + barra(idioma, d.slug)); estadoTraducao[d.slug] = 'pendente'; }
    }
  }

  for (const i of IDIOMAS) {
    const dir = path.join(SAIDA, i === 'pt' ? '' : i);
    fs.writeFileSync(path.join(dir, 'index.html'), indice(i, estadoTraducao));
    fs.writeFileSync(path.join(dir, '404.html'), paginaSimples(i, T[i].nf_titulo, T[i].nf_texto, raizDe(i), T[i].voltar));
  }
  fs.writeFileSync(path.join(SAIDA, 'build.json'), JSON.stringify({ build: carimbo, idiomas: IDIOMAS, documentos: docs.map((d) => ({ slug: d.slug, titulo: d.titulo, data: d.data, estado: d.estado, fr: estadoTraducao[d.slug] })) }, null, 2));
  fs.rmSync(PUBLIC, { recursive: true, force: true });
  fs.renameSync(SAIDA, PUBLIC);
  console.log(`public/ montado: ${docs.length} documentos · idiomas ${IDIOMAS.join(', ')} · build ${carimbo}`);
  for (const d of docs) console.log(`  ${d.slug.padEnd(28)} fr: ${estadoTraducao[d.slug]}`);

  if (semZip) return;
  const zip = path.join(SITE, `twk-biblioteca-${carimbo}.zip`);
  const itens = ['Dockerfile', 'server.js', 'package.json', '.dockerignore', 'public'];
  if (process.platform === 'win32') {
    // O tar do Git Bash (GNU) trata "C:" como servidor remoto; o do Windows (bsdtar, em System32) gera o zip certo, com barras normais.
    const tarWin = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
    execFileSync(tarWin, ['-a', '-c', '-f', zip, '-C', SITE, ...itens], { stdio: 'inherit' });
  } else {
    execFileSync('zip', ['-r', '-q', zip, ...itens], { cwd: SITE, stdio: 'inherit' });
  }
  console.log(`zip para o Easypanel: ${zip} (${Math.round(fs.statSync(zip).size / 1024)} KB)`);
})().catch((e) => { fs.rmSync(SAIDA, { recursive: true, force: true }); console.error('FALHOU:', e.message); process.exit(1); });
