/* Pack du jour — la page de Julien (téléphone). Lit /studio/<jour>/data?t=… ; marque « filmé / publié » par /studio/<jour>/etat.
   Rien n'est publié d'ici : la page montre, Julien filme et publie. */
(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const m = /^\/studio\/(\d{4}-\d{2}-\d{2})/.exec(location.pathname); const jour = m ? m[1] : ''; const t = new URLSearchParams(location.search).get('t') || '';
  const base = `/studio/${jour}`; const q = `?t=${encodeURIComponent(t)}`;
  const D = { pack: null, onglet: {}, players: {} };
  const sec = (v) => String(v).replace('.', ',');
  const jourLong = (d) => { const x = new Date(`${d}T12:00:00Z`); return `${['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'][x.getUTCDay()]} ${x.getUTCDate()} ${['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'][x.getUTCMonth()]}`; };
  const ETAT = { a_filmer: 'À filmer', filme: 'Filmé', publie: 'Publié', ecarte: 'Mis de côté' };
  const memo = { lire: (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch { return null; } }, ecrire: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* stockage bloqué */ } } };

  let tToast = 0;
  function toast(msg) { const el = $('#toast'); el.textContent = msg; el.classList.add('on'); clearTimeout(tToast); tToast = setTimeout(() => el.classList.remove('on'), 2400); }
  async function copier(texte, ok = 'Copié') {
    try { await navigator.clipboard.writeText(texte); toast(ok); }
    catch { const ta = document.createElement('textarea'); ta.value = texte; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); toast(ok); } catch { toast('Sélectionne le texte et copie-le à la main'); } ta.remove(); }
  }
  const etatDe = (id) => (D.pack.etat[id] || { status: 'a_filmer' });
  function compte() {
    const n = D.pack.reels.length; const faits = D.pack.reels.filter((r) => ['filme', 'publie'].includes(etatDe(r.id).status)).length; const pub = D.pack.reels.filter((r) => etatDe(r.id).status === 'publie').length;
    const el = $('#compte'); el.hidden = false; el.textContent = pub ? `${pub} publié${pub > 1 ? 's' : ''} · ${faits}/${n} filmés` : `${faits}/${n} filmés`; el.classList.toggle('fini', faits === n && n > 0);
  }

  function volet(r) {
    const o = D.onglet[r.id] || 'plans'; const tg = r.tournage || {}; const tl = D.pack.timeline[r.id];
    if (o === 'plans') {
      const faits = memo.lire(`wc_plans_${jour}_${r.id}`) || [];
      return `<ol class="plans">${(r.plans || []).map((p, i) => `<li class="${faits.includes(i) ? 'fait' : ''}"><input type="checkbox" id="p-${esc(r.id)}-${i}" data-plan="${i}" ${faits.includes(i) ? 'checked' : ''}><label for="p-${esc(r.id)}-${i}"><b>PLAN ${i + 1} · ${sec(p.duree_s)} s</b>${esc(p.description)}</label></li>`).join('')}</ol>
        <p class="tournage">Caméra : ${esc(tg.camera || 'fixe')} ·${tg.voiture_arret === false ? 'voiture en mouvement, LED éteintes' : 'voiture à l’arrêt (LED seulement à l’arrêt)'} · ${tg.personnes_a_bord ? `${tg.personnes_a_bord} personne(s) à bord${tg.autorisation_image ? ', autorisation d’image signée' : ', de dos ou floues'}` : 'personne à bord'} · musique : ${esc(tg.musique || 'thème original ou bibliothèque')}</p>`;
    }
    if (o === 'texte') {
      const voix = (r.voix_off || []).filter(Boolean);
      return `<div class="bloc"><p class="eyebrow">Texte à l’écran</p><div class="ecrans">${tl.ecran.map((e) => `<div><span>${sec(e.debut)}–${sec(e.fin)} s</span><b>${esc(e.texte)}</b></div>`).join('')}</div></div>
        <div class="bloc"><p class="eyebrow">Voix off</p>${voix.length ? voix.map((v) => `<p class="voix">« ${esc(v)} »</p>`).join('') : '<p class="tournage">Sans voix : l’écran porte tout.</p>'}</div>
        ${voix.length ? `<button class="btn" type="button" data-a="prompteur">Ouvrir le prompteur</button>` : ''}
        ${(r.accroches_alternatives || []).length ? `<div class="bloc"><p class="eyebrow">Autres accroches à tester (Trial Reel)</p><div class="variantes">${r.accroches_alternatives.map((a) => { const [v, e] = a.split(/\s+\|\s+/); return `<p>« ${esc(v)} »<small>${esc(e || '')}</small></p>`; }).join('')}</div></div>` : ''}`;
    }
    return `<div class="texte" id="leg-${esc(r.id)}">${esc(r.legende)}\n${esc((r.hashtags || []).join(' '))}</div>
      <div class="ligne"><button class="btn pri" type="button" data-a="copier-legende">Copier la légende</button><a class="btn" href="${base}/srt/${encodeURIComponent(r.id)}${q}" download>Sous-titres .srt</a></div>
      <p class="tournage">Dans CapCut : Texte → Sous-titres → Importer un fichier. Publication à 7:00 PM.</p>`;
  }
  function blocEtat(r) {
    const e = etatDe(r.id); const s = e.status;
    if (s === 'publie') return `<p class="etat-msg">Publié${e.lien ? ` · <a href="${esc(e.lien)}" target="_blank" rel="noopener noreferrer" style="color:var(--ciel)">voir le post</a>` : ' · colle le lien du post pour qu’on mesure le résultat'}</p>${e.lien ? '' : `<div class="lien"><input type="url" inputmode="url" placeholder="https://www.instagram.com/reel/…" aria-label="Lien du post"><button class="btn ok" type="button" data-a="lien">OK</button></div>`}<button class="btn petit large" type="button" data-etat="a_filmer">Annuler</button>`;
    if (s === 'filme') return `<button class="btn ok large" type="button" data-a="publier">C’est publié</button><div class="lien" hidden><input type="url" inputmode="url" placeholder="Colle le lien du post (facultatif)" aria-label="Lien du post"><button class="btn ok" type="button" data-a="lien">OK</button></div><button class="btn petit large" type="button" data-etat="a_filmer">Pas encore filmé</button>`;
    if (s === 'ecarte') return `<p class="etat-msg">Mis de côté. Le Studio en tient compte pour les prochains packs.</p><button class="btn petit large" type="button" data-etat="a_filmer">Le reprendre</button>`;
    return `<button class="btn ok" type="button" data-etat="filme">Filmé</button><button class="btn" type="button" data-etat="ecarte">Pas celui-là</button>`;
  }
  function carteReel(r, i) {
    const o = D.onglet[r.id] || 'plans'; const tl = D.pack.timeline[r.id];
    return `<section class="reel" id="reel-${esc(r.id)}" data-reel="${esc(r.id)}" data-etat="${esc(etatDe(r.id).status)}">
      <div class="reel-tete"><div><p class="eyebrow">Reel ${i + 1} · ${sec(tl.total)} s${(r.voix_off || []).filter(Boolean).length ? '' : ' · sans voix'}</p><h2>${esc(r.titre)}</h2></div>${r.note != null ? `<div class="note" style="color:${r.note >= 75 ? 'var(--bom)' : 'var(--atencao)'}">${r.note}<small>ACCROCHE</small></div>` : ''}</div>
      <p class="idee">${esc(r.idee)}</p>
      <div class="ph-slot"></div>
      <div class="ligne"><button class="btn petit" type="button" data-a="lire">Lire l’aperçu</button>${window.WCPlayer.temVoz() && (r.voix_off || []).filter(Boolean).length ? '<button class="btn petit" type="button" data-a="voix" aria-pressed="false">Écouter la voix</button>' : ''}</div>
      <div class="onglets" role="tablist">${[['plans', 'Plans'], ['texte', 'Texte'], ['legende', 'Légende']].map(([k, n]) => `<button type="button" role="tab" data-onglet="${k}" class="${o === k ? 'on' : ''}" aria-selected="${o === k}">${n}</button>`).join('')}</div>
      <div class="volet">${volet(r)}</div>
      <div class="etat">${blocEtat(r)}</div></section>`;
  }
  // ---- pièces prêtes (créées dans l'area Criar) : images dessinées ici, à télécharger et publier
  const FMT = { post: 'Post', carrossel: 'Carrousel', story: 'Story', reel: 'Reel' };
  function cartePiece(x) {
    const legende = `${x.legende || ''}\n${(x.hashtags || []).join(' ')}`.trim();
    return `<div class="rep piece-j" data-piece="${esc(x.id)}"><h3>${esc(FMT[x.formato] || x.formato)}${x.formato === 'carrossel' ? ` · ${(x.slides || []).length} images` : ''}</h3><p><b>${esc(x.titre || (x.reel && x.reel.titre) || '')}</b></p>
      <div class="piece-prev" data-prev="${esc(JSON.stringify({ formato: x.formato, image: x.image, slides: x.slides, reel: x.reel ? { texte_ecran: x.reel.texte_ecran } : null }))}"></div>
      ${x.sticker ? `<p>Sticker : ${esc(x.sticker)}</p>` : ''}
      ${x.reel ? `<p class="tournage">${(x.reel.plans || []).map((pl, i) => `${i + 1}. (${sec(pl.duree_s)} s) ${esc(pl.description)}`).join('<br>')}</p>${(x.reel.voix_off || []).filter(Boolean).map((v) => `<p class="voix">« ${esc(v)} »</p>`).join('')}` : ''}
      <div class="ligne" style="justify-content:flex-start"><button class="btn petit pri" type="button" data-a="dl-piece">${x.formato === 'reel' ? 'Textes d’écran (PNG)' : x.formato === 'carrossel' ? 'Télécharger les images' : 'Télécharger l’image'}</button>${legende ? `<button class="btn petit" type="button" data-copier="${esc(legende)}">Copier la légende</button>` : ''}${x.reel ? `<a class="btn petit" href="${base}/srt/${encodeURIComponent(x.id)}${q}" download>.srt</a>` : ''}</div></div>`;
  }
  async function dessinerPieces() {
    const alvos = $$('.piece-prev'); if (!alvos.length || !window.WCRender) return;
    await window.WCRender.prontas();
    for (const el of alvos) { const x = JSON.parse(el.dataset.prev); const cvs = x.formato === 'reel' ? (x.reel.texte_ecran || []).map((t) => window.WCRender.overlay({ texte: t.texte })) : (x.formato === 'carrossel' ? x.slides : [x.image]).map((s, i) => window.WCRender.imagem({ ...s, formato: x.formato, contador: x.formato === 'carrossel' ? `${i + 1}/${x.slides.length}` : '', seed: i + 3 })); el.innerHTML = ''; for (const cv of cvs) { const img = document.createElement('img'); img.src = cv.toDataURL('image/jpeg', .8); img.alt = ''; el.appendChild(img); } }
  }
  async function telechargerPiece(id) {
    const x = (D.pack.pecas || []).find((y) => y.id === id); if (!x || !window.WCRender) return;
    await window.WCRender.prontas();
    const cvs = x.formato === 'reel' ? (x.reel.texte_ecran || []).map((t) => window.WCRender.overlay({ texte: t.texte })) : (x.formato === 'carrossel' ? x.slides : [x.image]).map((s, i) => window.WCRender.imagem({ ...s, formato: x.formato, contador: x.formato === 'carrossel' ? `${i + 1}/${x.slides.length}` : '', seed: i + 3 }));
    for (let i = 0; i < cvs.length; i++) await window.WCRender.baixar(cvs[i], `wanted-chauffeur-${jour}-${id}-${String(i + 1).padStart(2, '0')}.png`);
    toast(cvs.length === 1 ? 'Image téléchargée' : `${cvs.length} images téléchargées`);
  }
  function peindre() {
    const p = D.pack;
    $('#page').innerHTML = `<section class="abre"><p class="eyebrow">Pack du jour · @wantedchauffeur</p><h1>${esc(jourLong(p.date))}<br><em>${p.reels.length} Reels à filmer</em></h1>
        ${p.tendance_du_jour ? `<p class="jour">${esc(p.tendance_du_jour)}</p>` : ''}<p class="regle">Tout est brouillon : tu filmes, tu ajustes, tu publies à 7:00 PM. Caméra fixe, « TOULOUSE » dans les 2 premières secondes, LED seulement voiture à l’arrêt.</p></section>
      ${p.reels.map(carteReel).join('')}
      ${(p.pecas || []).length ? `<section class="piece"><p class="eyebrow">Pièces prêtes à publier</p>${p.pecas.map(cartePiece).join('')}</section>` : ''}
      ${p.story ? `<section class="piece"><p class="eyebrow">Story${p.story.sticker ? ` · sticker ${esc(p.story.sticker)}` : ''}</p><p>${esc(p.story.texte)}</p><button class="btn petit" type="button" data-copier="${esc(p.story.texte)}" style="width:fit-content">Copier</button></section>` : ''}
      ${p.carrousel && (p.carrousel.slides || []).length ? `<section class="piece"><p class="eyebrow">Carrousel · ${esc(p.carrousel.titre)}</p><div class="slides">${p.carrousel.slides.map((s, i) => `<div class="slide"><span>${i + 1}/${p.carrousel.slides.length}</span>${esc(s)}</div>`).join('')}</div><button class="btn petit" type="button" data-copier="${esc(p.carrousel.slides.map((s, i) => `${i + 1}. ${s}`).join('\n'))}" style="width:fit-content">Copier les textes</button></section>` : ''}
      ${(p.reponses_commentaires || []).length ? `<section class="piece"><p class="eyebrow">Réponses aux commentaires</p>${p.reponses_commentaires.map((c) => `<div class="rep"><h3>${esc(c.situation)}</h3><p>${esc(c.reponse)}</p><button class="btn petit" type="button" data-copier="${esc(c.reponse)}" style="width:fit-content">Copier</button></div>`).join('')}</section>` : ''}
      ${(p.a_eviter || []).length ? `<section class="piece"><p class="eyebrow">À éviter aujourd’hui</p><ul class="eviter">${p.a_eviter.map((a) => `<li>${esc(a)}</li>`).join('')}</ul></section>` : ''}
      <p class="pied">Vous jouez. On conduit.</p>`;
    for (const r of p.reels) { const slot = $(`#reel-${CSS.escape(r.id)} .ph-slot`); D.players[r.id] = window.WCPlayer.criar(slot, p.timeline[r.id]); }
    compte(); dessinerPieces();
  }
  function repeindreReel(id) {
    const r = D.pack.reels.find((x) => x.id === id); const el = $(`#reel-${CSS.escape(id)}`); if (!r || !el) return;
    el.dataset.etat = etatDe(id).status; $('.volet', el).innerHTML = volet(r); $('.etat', el).innerHTML = blocEtat(r);
    $$('.onglets button', el).forEach((b) => { const on = b.dataset.onglet === (D.onglet[id] || 'plans'); b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
    compte();
  }
  async function marquer(id, status, lien = null) {
    try { const r = await fetch(`${base}/etat${q}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reel: id, status, ...(lien ? { lien } : {}) }) }); const j = await r.json().catch(() => ({}));
      if (!r.ok) { toast(j.erreur || 'Ça n’a pas marché, réessaie'); return false; }
      D.pack.etat = j.etat; repeindreReel(id); toast(status === 'publie' ? 'Noté : publié' : status === 'filme' ? 'Noté : filmé' : status === 'ecarte' ? 'Mis de côté' : 'Remis à filmer'); return true;
    } catch { toast('Pas de réseau : réessaie dans un instant'); return false; }
  }

  // ---- prompteur
  const P = { lignes: [], i: 0, timer: 0, vitesse: 1, veille: null };
  function ouvrirPrompteur(r) {
    P.lignes = (r.voix_off || []).filter(Boolean); P.i = -1; P.vitesse = 1;
    $('#pr-texte').innerHTML = P.lignes.map((l) => `<p>${esc(l)}</p>`).join(''); $('#prompteur').hidden = false; $('#pr-go').textContent = 'Démarrer'; $('#pr-texte').scrollTop = 0;
    if (navigator.wakeLock && navigator.wakeLock.request) navigator.wakeLock.request('screen').then((w) => { P.veille = w; }).catch(() => {});
  }
  function avancer() {
    P.i += 1; const ps = $$('#pr-texte p'); if (P.i >= ps.length) { arreter(); $('#pr-go').textContent = 'Recommencer'; P.i = -1; return; }
    ps.forEach((p, k) => p.classList.toggle('on', k === P.i)); ps[P.i].scrollIntoView({ block: 'center', behavior: 'smooth' });
    const mots = P.lignes[P.i].split(/\s+/).length; P.timer = setTimeout(avancer, Math.max(900, (mots / (190 / 60)) * 1000 / P.vitesse + 350));
  }
  function arreter() { clearTimeout(P.timer); P.timer = 0; }
  function fermerPrompteur() { arreter(); $('#prompteur').hidden = true; if (P.veille) { try { P.veille.release(); } catch { /* déjà libéré */ } P.veille = null; } }
  $('#pr-go').addEventListener('click', () => { if (P.timer) { arreter(); $('#pr-go').textContent = 'Reprendre'; P.i -= 1; } else { $('#pr-go').textContent = 'Pause'; avancer(); } });
  $('#pr-plus').addEventListener('click', () => { P.vitesse = Math.min(1.6, P.vitesse + 0.1); toast(`Rythme ×${sec(P.vitesse.toFixed(1))}`); });
  $('#pr-moins').addEventListener('click', () => { P.vitesse = Math.max(0.6, P.vitesse - 0.1); toast(`Rythme ×${sec(P.vitesse.toFixed(1))}`); });
  $('#pr-fermer').addEventListener('click', fermerPrompteur);

  document.addEventListener('click', (ev) => {
    const b = ev.target.closest('button'); if (!b) return;
    if (b.dataset.copier !== undefined) return copier(b.dataset.copier);
    if (b.dataset.a === 'dl-piece') { const pj = b.closest('.piece-j'); b.disabled = true; telechargerPiece(pj.dataset.piece).finally(() => { b.disabled = false; }); return; }
    const carte = b.closest('.reel'); if (!carte) return; const id = carte.dataset.reel; const r = D.pack.reels.find((x) => x.id === id);
    if (b.dataset.onglet) { D.onglet[id] = b.dataset.onglet; return repeindreReel(id); }
    if (b.dataset.etat) return marquer(id, b.dataset.etat);
    const a = b.dataset.a;
    if (a === 'lire') { for (const [k, pl] of Object.entries(D.players)) if (k !== id) pl.pausar(); D.players[id].alternar(); $('.ph', carte).scrollIntoView({ block: 'center', behavior: 'smooth' }); return; }
    if (a === 'voix') { const on = b.getAttribute('aria-pressed') !== 'true'; const ok = D.players[id].voz(on); b.setAttribute('aria-pressed', ok); b.textContent = ok ? 'Voix activée' : 'Écouter la voix'; if (ok) { D.players[id].ir(0); D.players[id].tocar(); } return; }
    if (a === 'prompteur') return ouvrirPrompteur(r);
    if (a === 'copier-legende') return copier(`${r.legende}\n${(r.hashtags || []).join(' ')}`, 'Légende copiée');
    if (a === 'publier') { const l = $('.lien', carte); if (l && l.hidden) { l.hidden = false; b.textContent = 'Publié, sans lien'; $('input', l).focus(); return; } return marquer(id, 'publie'); }
    if (a === 'lien') { const v = $('.lien input', carte).value.trim(); if (!v) return marquer(id, 'publie'); return marquer(id, 'publie', v); }
  });
  document.addEventListener('change', (ev) => {
    const c = ev.target; if (c.dataset.plan === undefined) return; const carte = c.closest('.reel'); const id = carte.dataset.reel;
    const faits = $$('.plans input', carte).filter((x) => x.checked).map((x) => Number(x.dataset.plan)); memo.ecrire(`wc_plans_${jour}_${id}`, faits); c.closest('li').classList.toggle('fait', c.checked);
    const r = D.pack.reels.find((x) => x.id === id); if (faits.length === (r.plans || []).length && etatDe(id).status === 'a_filmer') toast('Tous les plans sont cochés : marque le Reel « Filmé »');
  });

  fetch(`${base}/data${q}`).then((r) => { if (!r.ok) throw new Error('introuvable'); return r.json(); }).then((j) => { D.pack = j; document.title = `Pack du ${jourLong(j.date)} · Wanted Chauffeur`; peindre(); })
    .catch(() => { $('#page').innerHTML = '<p class="charge">Ce lien n’est plus valable ou le pack n’existe pas encore. Demande le lien du jour.</p>'; });
})();
