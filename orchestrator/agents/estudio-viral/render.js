'use strict';
/** O pacote em texto: Markdown em francês para o Julien (copiar no WhatsApp ou ler na página) e HTML sem script (CSP da Central). */

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const diaFr = (iso) => { const d = new Date(`${iso}T12:00:00Z`); return `${['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'][d.getUTCDay()]} ${d.getUTCDate()} ${['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'][d.getUTCMonth()]}`; };

function medidaLinha(m) {
  if (!m) return '';
  const partes = [];
  if (m.accroche) partes.push(`accroche ${m.accroche.note}/100 (${m.accroche.verdict.toLowerCase()})`);
  if (m.duree_s != null) partes.push(`${m.duree_s} s`);
  return partes.join(' · ');
}

function markdownFr(pacote, { medidas = {}, problemas = [], veille = null } = {}) {
  const L = [];
  L.push(`# Pack du jour · ${diaFr(pacote.date)} · @wantedchauffeur`);
  if (pacote.tendance_du_jour) L.push(`\n**Aujourd'hui :** ${pacote.tendance_du_jour}`);
  L.push('\nTout est brouillon : tu filmes, tu ajustes, tu publies à 7:00 PM. Caméra fixe, LED voiture à l\'arrêt, « TOULOUSE » dans les 2 premières secondes.');
  (pacote.reels || []).forEach((r, i) => {
    L.push(`\n---\n\n## Reel ${i + 1} · ${r.titre}`);
    L.push(`*${r.formule} · pilier ${r.pilier}${medidaLinha(medidas[r.id]) ? ` · ${medidaLinha(medidas[r.id])}` : ''}*`);
    L.push(`\n**L'idée.** ${r.idee}`);
    L.push('\n**Les plans**');
    (r.plans || []).forEach((p, k) => L.push(`${k + 1}. (${p.duree_s} s) ${p.description}`));
    L.push('\n**Texte à l\'écran**');
    (r.texte_ecran || []).forEach((t) => L.push(`- ${t.quand} : ${t.texte}`));
    if (r.voix_off && r.voix_off.length) { L.push('\n**Voix off**'); L.push(r.voix_off.map((v) => `« ${v} »`).join(' … ')); } else L.push('\n**Sans voix** : l\'écran porte tout.');
    L.push('\n**Légende**'); L.push(`${r.legende}\n${(r.hashtags || []).join(' ')}`);
    L.push(`\n**Pourquoi.** ${r.pourquoi}`);
    const tg = r.tournage || {};
    L.push(`\n**Tournage.** ${tg.camera || 'caméra fixe'} · ${tg.voiture_arret === false ? 'voiture en mouvement (pas de LED)' : 'voiture à l\'arrêt'} · ${tg.personnes_a_bord || 0} personne(s) à bord${tg.autorisation_image ? ' · autorisation d\'image à signer' : ''} · musique : ${tg.musique || 'thème original ou bibliothèque'}`);
    const av = problemas.filter((p) => p.reel === r.id && p.tipo === 'aviso');
    if (av.length) L.push(`\n**À vérifier avant de publier :** ${av.map((a) => a.detalhe).join(' · ')}`);
  });
  if (pacote.story) L.push(`\n---\n\n## Story\n${pacote.story.texte}${pacote.story.sticker ? ` *(sticker : ${pacote.story.sticker})*` : ''}`);
  if (pacote.carrousel && pacote.carrousel.slides && pacote.carrousel.slides.length) { L.push(`\n## Carrousel · ${pacote.carrousel.titre}`); pacote.carrousel.slides.forEach((s, k) => L.push(`${k + 1}. ${s}`)); }
  if (pacote.reponses_commentaires && pacote.reponses_commentaires.length) { L.push('\n## Réponses aux commentaires'); pacote.reponses_commentaires.forEach((c) => L.push(`- **${c.situation}** → ${c.reponse}`)); }
  if (pacote.a_eviter && pacote.a_eviter.length) L.push(`\n## À éviter aujourd'hui\n${pacote.a_eviter.map((a) => `- ${a}`).join('\n')}`);
  if (veille && veille.novidades && veille.novidades.length) { L.push('\n## Ce qui se passe (sources)'); veille.novidades.slice(0, 8).forEach((n) => L.push(`- ${n.titre} — ${n.fait} (${n.date}) ${n.source_url}`)); }
  return L.join('\n');
}

function html(pacote, opts = {}) {
  const md = markdownFr(pacote, opts);
  // conversão mínima e previsível (sem biblioteca): títulos, listas, negrito, itálico, separadores, parágrafos
  const linhas = md.split('\n'); const out = []; let lista = null;
  const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*([^*\n]+?)\*(?!\*)/g, '$1<i>$2</i>').replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" rel="noopener">$1</a>');
  const fechar = () => { if (lista) { out.push(`</${lista}>`); lista = null; } };
  for (const l of linhas) {
    if (/^# /.test(l)) { fechar(); out.push(`<h1>${inline(l.slice(2))}</h1>`); continue; }
    if (/^## /.test(l)) { fechar(); out.push(`<h2>${inline(l.slice(3))}</h2>`); continue; }
    if (/^---$/.test(l)) { fechar(); out.push('<hr>'); continue; }
    if (/^- /.test(l)) { if (lista !== 'ul') { fechar(); out.push('<ul>'); lista = 'ul'; } out.push(`<li>${inline(l.slice(2))}</li>`); continue; }
    if (/^\d+\. /.test(l)) { if (lista !== 'ol') { fechar(); out.push('<ol>'); lista = 'ol'; } out.push(`<li>${inline(l.replace(/^\d+\. /, ''))}</li>`); continue; }
    if (!l.trim()) { fechar(); continue; }
    fechar(); out.push(`<p>${inline(l)}</p>`);
  }
  fechar();
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Pack du jour · ${esc(pacote.date)}</title>
<style>:root{color-scheme:light dark}body{margin:0;padding:20px 16px 48px;max-width:46rem;margin-inline:auto;font:16px/1.55 system-ui,sans-serif;background:#15121c;color:#ece7f5}h1{font-size:1.5rem;line-height:1.2}h2{font-size:1.15rem;margin-top:1.6rem;color:#f07ab8}hr{border:0;border-top:1px solid #2d2740;margin:1.4rem 0}p,li{margin:.35rem 0}ol,ul{padding-left:1.3rem}a{color:#6fb6ee;word-break:break-all}b{color:#fff}i{color:#a79fbb}</style></head><body>${out.join('\n')}</body></html>`;
}

module.exports = { markdownFr, html, diaFr };
