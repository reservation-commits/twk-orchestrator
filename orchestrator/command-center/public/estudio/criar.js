/* Área « Criar »: briefing (formato + direção) → a IA cria a peça inteira → prévia desenhada → download das imagens e legenda.
   Também desenha as peças guardadas no pacote do dia (Hoje). Depende de estudio.js (api, toast…) via WCCriar.ligar(). */
(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let H = null; // { api, S, toast, copiar, cor, textoJulien }
  const FORMATOS = [['reel', 'Reel', 'Roteiro de 12 s para o Julien filmar: planos, texto de tela, voz, legenda, .srt e os textos de tela em PNG.'], ['post', 'Post', 'Uma imagem 4:5 pronta, com legenda e hashtags.'], ['carrossel', 'Carrossel', 'De 5 a 8 imagens 4:5 prontas, com legenda.'], ['story', 'Story', 'Uma imagem 9:16 pronta, com o sticker a adicionar.']];
  const SUGESTOES = { reel: ['a porta Falcon abrindo no Pont-Neuf à meia-noite, sem voz', 'reação de quem descobre a PS5 no banco de trás (sem rosto)', 'o Marché de Noël do Capitole visto de dentro do carro'], post: ['o preço da Game Night explicado em uma imagem, tom seco', 'anúncio da primeira Game Night de terça, 9:00 PM', 'o teto estrelado, com a frase « Vous jouez. On conduit. »'], carrossel: ['tudo o que tem na banquette arrière, um item por slide', 'as 5 regras de bordo, com humor', 'Transfer, Night Ride, Game Night, Soirée: um slide por produto, com preço'], story: ['enquete: ce soir tu joues où ? salon / banquette', 'contagem regressiva para a Game Night de terça', 'pergunta: qual jogo você levaria para 3 h no banco de trás?'] };
  const FUNDO_NOME = { nuit: 'noite de Toulouse', led: 'LEDs das portas', ciel: 'teto estrelado', interieur: 'banco de trás', noir: 'preto' };
  let fontesOk = false;
  async function fontes() { if (!fontesOk) { await window.WCRender.prontas(); fontesOk = true; } }

  const slidesDe = (p) => (p.formato === 'carrossel' ? p.slides : [{ ...p.image }]);
  function nomeArquivo(dia, p, i) { return `wanted-chauffeur-${dia}-${p.id || 'peca'}-${p.formato}${p.formato === 'carrossel' ? `-${String(i + 1).padStart(2, '0')}` : ''}.png`; }
  async function desenhar(p) {
    await fontes();
    if (p.formato === 'reel') return (p.reel.texte_ecran || []).map((t) => window.WCRender.overlay({ texte: t.texte }));
    const sl = slidesDe(p);
    return sl.map((s, i) => window.WCRender.imagem({ ...s, formato: p.formato, contador: p.formato === 'carrossel' ? `${i + 1}/${sl.length}` : '', seed: i + 3 }));
  }
  async function baixar(dia, p) {
    const cvs = await desenhar(p);
    for (let i = 0; i < cvs.length; i++) await window.WCRender.baixar(cvs[i], p.formato === 'reel' ? `wanted-chauffeur-${dia}-${p.id}-ecran-${String(i + 1).padStart(2, '0')}.png` : nomeArquivo(dia, p, i));
    H.toast(cvs.length === 1 ? 'Imagem baixada' : `${cvs.length} imagens baixadas`);
  }
  async function previas(raiz = document) {
    const alvos = $$('[data-previa]', raiz); if (!alvos.length) return;
    await fontes();
    for (const el of alvos) {
      if (el.dataset.feito) continue; el.dataset.feito = '1';
      const p = JSON.parse(el.dataset.previa); const cvs = await desenhar(p);
      el.innerHTML = ''; for (const cv of cvs) { const img = document.createElement('img'); img.src = cv.toDataURL('image/jpeg', .82); img.alt = p.titre || ''; img.className = p.formato === 'story' || p.formato === 'reel' ? 'prev-9x16' : 'prev-4x5'; el.appendChild(img); }
      if (p.formato === 'reel') el.insertAdjacentHTML('beforeend', '<p class="eyebrow" style="width:100%">Textos de tela em PNG transparente (para o CapCut)</p>');
    }
  }
  const dadosPrevia = (p) => esc(JSON.stringify({ id: p.id, formato: p.formato, titre: p.titre, image: p.image, slides: p.slides, reel: p.reel ? { texte_ecran: p.reel.texte_ecran } : null }));

  function cartaoPeca(p, dia, { comRemover = true } = {}) {
    const legenda = `${p.legende || ''}\n${(p.hashtags || []).join(' ')}`.trim();
    const avisos = (p.problemas || []).filter((x) => x.tipo === 'aviso');
    return `<article class="peca-c" data-peca="${esc(p.id)}">
      <div class="peca-prev" data-previa="${dadosPrevia(p)}"><div class="skel" style="height:220px;width:100%"></div></div>
      <div class="peca-info">
        <p class="eyebrow">${esc(p.formato)}${p.criado_em ? ` · ${esc(new Date(p.criado_em).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Europe/Paris' }))}` : ''}${p.modelo ? ` · ${esc(String(p.modelo).replace('claude-', ''))}` : ''}</p>
        <h3 lang="fr">${esc(p.titre || (p.reel && p.reel.titre) || 'Sem título')}</h3>
        ${p.direcao ? `<p class="pt" style="font-size:13px">Direção: ${esc(p.direcao)}</p>` : ''}
        ${p.formato === 'reel' ? `<p class="gancho" lang="fr">« <b>${esc(p.reel.accroche_voix || p.reel.accroche_ecran)}</b> »</p>` : ''}
        ${p.sticker ? `<p class="pt"><b>Sticker:</b> <span lang="fr">${esc(p.sticker)}</span></p>` : ''}
        ${legenda ? `<div class="copiavel com-btn" lang="fr" style="font-size:13.5px">${esc(legenda)}<button class="btn mini" type="button" data-copiar="${esc(legenda)}">Copiar</button></div>` : ''}
        ${p.traduction_pt ? `<p class="pt" style="font-size:13px">${esc(p.traduction_pt)}</p>` : ''}
        ${avisos.length ? `<p class="aviso">${avisos.map((a) => esc(a.detalhe)).join(' · ')}</p>` : ''}
        <div class="transporte">
          <button class="btn pri" type="button" data-a="baixar-peca" data-dia="${esc(dia)}">${p.formato === 'reel' ? 'Baixar textos de tela (PNG)' : p.formato === 'carrossel' ? `Baixar as ${(p.slides || []).length} imagens` : 'Baixar a imagem'}</button>
          ${p.formato === 'reel' ? `<a class="btn" href="/api/estudio/srt?dia=${esc(dia)}&reel=${esc(p.id)}" data-srt>.srt</a><button class="btn" type="button" data-a="copiar-roteiro-peca">Copiar roteiro</button>` : ''}
          ${comRemover ? `<button class="btn fantasma" type="button" data-a="remover-peca" data-dia="${esc(dia)}">Remover</button>` : ''}
        </div></div></article>`;
  }
  function pecasHtml(pecas, dia) {
    if (!pecas || !pecas.length) return '';
    return `<section class="bloco"><header><h2>Peças criadas sob medida</h2><p>${pecas.length} peça(s) pedidas na área Criar. Baixe e poste; a legenda vai junto.</p></header><div class="pecas-grid">${pecas.map((p) => cartaoPeca(p, dia)).join('')}</div></section>`;
  }

  async function vista(v) {
    const S = H.S; const ia = S.saude && S.saude.ia_disponivel; const f = S.criar || (S.criar = { formato: 'post', direcao: '', resultado: null });
    v.innerHTML = `<section class="abre"><p class="eyebrow">Você dá a direção, a IA entrega pronto</p><h2>Criar uma <em>peça</em></h2><p class="pt">Escolha o formato, diga em uma ou duas frases o que seria legal, e o Studio escreve tudo: texto da imagem, direção visual, legenda com hashtags e tradução. Passa pelas travas do projeto antes de aparecer. Depois é só baixar e postar.</p></section>
      ${ia ? '' : '<p class="aviso">A Central está sem a chave da IA (ANTHROPIC_API_KEY): sem ela esta área não cria. Veja Sistema.</p>'}
      <section class="criar">
        <form class="carta bloco" id="f-criar">
          <div class="campo"><span class="rot">Formato</span><div class="formatos">${FORMATOS.map(([k, n, d]) => `<label class="fmt${f.formato === k ? ' on' : ''}"><input type="radio" name="formato" value="${k}" ${f.formato === k ? 'checked' : ''}><b>${n}</b><span>${d}</span></label>`).join('')}</div></div>
          <div class="campo"><label for="c-dir">Direção de arte (português ou francês)</label><textarea id="c-dir" rows="4" placeholder="Ex.: um post anunciando a Game Night de terça às 9:00 PM, clima de noite em Toulouse, tom seco, com o preço por pessoa.">${esc(f.direcao)}</textarea>
            <div class="reel-chips" id="c-sug">${SUGESTOES[f.formato].map((s) => `<button class="chip" type="button" data-sug="${esc(s)}" style="cursor:pointer;background:transparent">${esc(s)}</button>`).join('')}</div></div>
          <div class="rodape-ed"><span class="estado" id="c-estado">${ia ? 'Leva de 20 a 60 segundos.' : ''}</span><button class="btn pri" type="submit" id="c-go" ${ia ? '' : 'disabled'}>Criar com IA</button></div>
        </form>
        <div class="bloco" id="c-res">${f.resultado ? cartaoPeca(f.resultado.peca, f.resultado.dia, { comRemover: false }) : `<div class="vazio"><h3>A peça aparece aqui</h3><p>Com a prévia desenhada na identidade do Wanted Chauffeur, a legenda pronta para copiar e o botão de baixar. Ela também fica guardada no pacote do dia, na área Hoje.</p></div>`}</div>
      </section>`;
    previas(v);
  }
  async function criar(form) {
    const S = H.S; const f = S.criar; const go = $('#c-go', form); const est = $('#c-estado', form);
    f.formato = (form.querySelector('input[name="formato"]:checked') || {}).value || 'post'; f.direcao = $('#c-dir', form).value.trim();
    if (f.direcao.length < 8) return H.toast('Diga a direção da peça: a ideia, o clima, o que mostrar', true);
    go.disabled = true; go.textContent = 'Criando e medindo…'; est.textContent = 'O modelo escreve, a ferramenta mede as travas, e se algo barrar ele corrige uma vez.';
    try {
      const j = await H.api('/api/estudio/criar', { method: 'POST', body: { formato: f.formato, direcao: f.direcao, dia: S.saude.hoje } });
      f.resultado = { peca: j.peca, dia: j.dia }; S.dados = null; S.dia = j.dia; // a área Hoje abre no dia da peça const dias = S.dias.find((d) => d.dia === j.dia); if (!dias) S.dias.unshift({ dia: j.dia, reels: [], contagem: {}, tendance: '' });
      const res = $('#c-res'); res.innerHTML = cartaoPeca(j.peca, j.dia, { comRemover: false }); previas(res); res.scrollIntoView({ behavior: 'smooth', block: 'start' });
      H.toast('Peça pronta e guardada no pacote do dia'); est.textContent = 'Pronto. Baixe, copie a legenda e poste. A peça também está na área Hoje.';
    } catch (e) { est.textContent = ''; if (e.dados && e.dados.problemas) { $('#c-res').innerHTML = `<div class="carta bloco"><p class="aviso ruim">${esc(e.message)}</p><ul class="lista-prob">${e.dados.problemas.filter((x) => x.tipo === 'bloqueia').map((x) => `<li class="bloqueia"><b>BARRADO</b>${esc(x.detalhe)}</li>`).join('')}</ul></div>`; } H.toast(e.message, true); }
    finally { go.disabled = false; go.textContent = 'Criar com IA'; }
  }

  document.addEventListener('submit', (ev) => { if (ev.target.id === 'f-criar') { ev.preventDefault(); criar(ev.target); } });
  document.addEventListener('change', (ev) => { if (ev.target.name === 'formato') { $$('.fmt').forEach((l) => l.classList.toggle('on', l.querySelector('input').checked)); const sug = $('#c-sug'); if (sug) sug.innerHTML = SUGESTOES[ev.target.value].map((s) => `<button class="chip" type="button" data-sug="${esc(s)}" style="cursor:pointer;background:transparent">${esc(s)}</button>`).join(''); } });
  document.addEventListener('click', async (ev) => {
    const b = ev.target.closest('button, a'); if (!b || !H) return;
    if (b.dataset.sug !== undefined && $('#c-dir')) { const t = $('#c-dir'); t.value = t.value.trim() ? `${t.value.trim()}; ${b.dataset.sug}` : b.dataset.sug; t.focus(); return; }
    if (b.dataset.srt !== undefined) { ev.preventDefault(); try { const r = await fetch(b.getAttribute('href'), { headers: H.S.token ? { 'x-center-key': H.S.token } : {} }); if (!r.ok) throw new Error('não achei o Reel'); const url = URL.createObjectURL(new Blob([await r.text()], { type: 'application/x-subrip' })); const a = document.createElement('a'); a.href = url; a.download = `${b.getAttribute('href').split('reel=')[1]}.srt`; document.body.appendChild(a); a.click(); a.remove(); H.toast('Legendas baixadas'); } catch (e) { H.toast(e.message, true); } return; }
    const card = b.closest('.peca-c'); if (!card) return; const p = JSON.parse(card.querySelector('[data-previa]').dataset.previa); const a = b.dataset.a;
    const completa = () => { const S = H.S; const r = S.criar && S.criar.resultado && S.criar.resultado.peca.id === p.id && S.criar.resultado.peca; return r || ((S.dados && S.dados.pacote.pecas) || []).find((x) => x.id === p.id) || p; };
    if (a === 'baixar-peca') { b.disabled = true; try { await baixar(b.dataset.dia, completa()); } finally { b.disabled = false; } return; }
    if (a === 'copiar-roteiro-peca') { const c = completa(); if (c.reel) return H.copiar(H.textoJulien(c.reel), 'Roteiro copiado, em francês'); return; }
    if (a === 'remover-peca') { if (!window.confirm('Remover esta peça do pacote?')) return; try { await H.api('/api/estudio/peca/remover', { method: 'POST', body: { dia: b.dataset.dia, id: p.id } }); card.remove(); H.S.dados = null; H.toast('Peça removida'); } catch (e) { H.toast(e.message, true); } }
  });

  window.WCCriar = { ligar: (h) => { H = h; }, vista, pecasHtml, previas };
})();
