/* Prévia animada de um Reel — toca a linha do tempo (planos, textos de tela, falas) num telefone 9:16.
   window.WCPlayer.criar(elemento, timeline, { rotulos }) → { tocar, pausar, alternar, ir(t), trocar(timeline), voz(on), destruir, aoTempo(fn) }
   A voz usa a síntese de fala do próprio navegador (fr-FR), sem custo e sem rede; se o navegador não tiver, o botão some. */
(() => {
  'use strict';
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const temVoz = () => 'speechSynthesis' in window && typeof SpeechSynthesisUtterance === 'function';

  function criar(el, timeline, opts = {}) {
    const rot = { plano: 'PLAN', tocar: 'Lire l’aperçu', ...(opts.rotulos || {}) };
    let tl = timeline; let t = 0; let tocando = false; let raf = 0; let ultimo = 0; let comVoz = false; let falada = -1; const ouvintes = [];
    el.classList.add('ph');
    el.innerHTML = `<div class="ph-scene"></div><div class="ph-grain"></div>
      <div class="ph-plan"><b></b><span></span></div><div class="ph-osd"></div><div class="ph-sub"></div>
      <div class="ph-time"></div><div class="ph-bar"></div>
      <button class="ph-hit" type="button" aria-label="${esc(rot.tocar)}"></button>
      <button class="ph-play" type="button" aria-label="${esc(rot.tocar)}"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6 4l14 8-14 8z"/></svg></button>`;
    const $ = (s) => el.querySelector(s);
    const osd = $('.ph-osd'); const sub = $('.ph-sub'); const bar = $('.ph-bar'); const tempo = $('.ph-time'); const planB = $('.ph-plan b'); const planS = $('.ph-plan span');

    function montarBarra() { bar.innerHTML = (tl.plans || []).map((p) => `<i style="--w:${p.duree}"></i>`).join(''); }
    function desenhar() {
      const total = tl.total || 0.001;
      const p = (tl.plans || []).find((x) => t >= x.debut && t < x.fin) || (tl.plans || [])[(tl.plans || []).length - 1];
      if (p) { el.dataset.fond = p.fond; planB.textContent = `${rot.plano} ${p.i + 1} · ${String(p.duree).replace('.', ',')} s`; planS.textContent = p.description; }
      const telas = (tl.ecran || []).filter((x) => t >= x.debut && t < x.fin);
      const tela = telas[telas.length - 1];
      if (tela) { const assin = /vous jouez|on conduit/i.test(tela.texte); const [a, b] = tela.texte.split(/\s+·\s+@/); const partes = tela.texte.split(/\s+·\s+/); osd.innerHTML = assin && b ? `${esc(a)}<small>@${esc(b)}</small>` : partes.length > 1 ? `${esc(partes[0])}<em>${esc(partes.slice(1).join(' · '))}</em>` : esc(tela.texte); osd.classList.toggle('sig', assin); osd.classList.add('on'); } else osd.classList.remove('on');
      const fi = (tl.voix || []).findIndex((x) => t >= x.debut && t < x.fin);
      if (fi >= 0) { sub.innerHTML = `<span>${esc(tl.voix[fi].texte)}</span>`; sub.classList.add('on'); if (comVoz && tocando && falada !== fi) { falada = fi; falar(tl.voix[fi].texte); } } else sub.classList.remove('on');
      [...bar.children].forEach((i, k) => { const pl = tl.plans[k]; const f = t <= pl.debut ? 0 : t >= pl.fin ? 100 : ((t - pl.debut) / pl.duree) * 100; i.style.setProperty('--p', `${f}%`); });
      tempo.textContent = `${t.toFixed(1).replace('.', ',')} / ${String(total).replace('.', ',')} s`;
      for (const f of ouvintes) f(t, total);
    }
    function falar(texto) { try { const u = new SpeechSynthesisUtterance(texto); u.lang = 'fr-FR'; u.rate = 1.05; const v = speechSynthesis.getVoices().find((x) => /^fr[-_]FR/i.test(x.lang)) || speechSynthesis.getVoices().find((x) => /^fr/i.test(x.lang)); if (v) u.voice = v; speechSynthesis.cancel(); speechSynthesis.speak(u); } catch { /* sem voz neste navegador */ } }
    function passo(agora) {
      if (!tocando) return;
      t += (agora - ultimo) / 1000; ultimo = agora;
      if (t >= (tl.total || 0)) { t = tl.total || 0; desenhar(); pausar(); t = 0; falada = -1; return; }
      desenhar(); raf = requestAnimationFrame(passo);
    }
    function tocar() { if (tocando || !(tl.total > 0)) return; if (t >= tl.total) t = 0; tocando = true; falada = -1; el.classList.add('playing'); ultimo = performance.now(); raf = requestAnimationFrame(passo); }
    function pausar() { tocando = false; el.classList.remove('playing'); cancelAnimationFrame(raf); if (temVoz()) { try { speechSynthesis.cancel(); } catch { /* ignora */ } } }
    const alternar = () => (tocando ? pausar() : tocar());
    function ir(seg) { t = Math.max(0, Math.min(tl.total || 0, seg)); falada = -1; desenhar(); }
    function trocar(nova) { const estava = tocando; pausar(); tl = nova; t = Math.min(t, tl.total || 0); montarBarra(); desenhar(); if (estava) tocar(); }

    $('.ph-play').addEventListener('click', alternar);
    $('.ph-hit').addEventListener('click', alternar);
    montarBarra(); desenhar();
    return { tocar, pausar, alternar, ir, trocar, voz: (on) => { comVoz = !!on && temVoz(); if (!comVoz && temVoz()) speechSynthesis.cancel(); return comVoz; }, temVoz, aoTempo: (f) => ouvintes.push(f), tocando: () => tocando, destruir: () => { pausar(); el.innerHTML = ''; } };
  }

  window.WCPlayer = { criar, temVoz };
})();
