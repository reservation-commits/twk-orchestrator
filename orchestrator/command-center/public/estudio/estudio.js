/* Studio · Wanted Chauffeur — painel da Central (sem framework).
   Lê /api/estudio/*; toda medida vem do servidor (a mesma ferramenta da skill), nada é calculado "de olho" aqui. */
(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const S = { token: '', rota: 'hoje', saude: null, dias: [], dia: null, dados: null, sel: null, aba: 'roteiro', rascunho: null, medida: null, sujo: false, formulas: null, controles: null, player: null, minis: [], labTexto: '', iaGanchos: null, quadro: null, timerProg: 0, timerMedir: 0 };
  try { S.token = localStorage.getItem('mc_key') || ''; S.labTexto = localStorage.getItem('wc_lab') || ''; } catch { /* armazenamento bloqueado */ }

  const STATUS = { a_filmer: 'A filmar', filme: 'Filmado', publie: 'Publicado', ecarte: 'Descartado' };
  const PILAR = { entree: 'A entrada', nuit: 'O carro à noite', 'a-bord': 'A bordo', coulisses: 'Bastidores', toulouse: 'A noite em Toulouse' };
  const TITULOS = { hoje: 'Pacote do dia', lab: 'Laboratório de ganchos', radar: 'Radar', desempenho: 'Desempenho', arquivo: 'Arquivo', sistema: 'Sistema' };
  const ETAPAS = [['veille', 'Pesquisa na web'], ['escrita', 'Escrita'], ['medida', 'Medida'], ['correcao', 'Correção'], ['pronto', 'Pronto']];
  const cor = (n) => (n == null ? 'var(--mudo)' : n >= 75 ? 'var(--bom)' : n >= 50 ? 'var(--atencao)' : 'var(--ruim)');
  const veredito = (n) => (n == null ? 'SEM VOZ' : n >= 75 ? 'FORTE' : n >= 50 ? 'CORRETO' : 'FRACO');
  const diaLongo = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).replace(/-/g, '‑');
  const diaCurto = (d) => { const s = new Date(`${d}T12:00:00Z`).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short', timeZone: 'UTC' }).replace(/\./g, ''); return s.charAt(0).toUpperCase() + s.slice(1); };
  const quando = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Europe/Paris' }) : '—');
  const n = (v) => (v == null ? '—' : Number(v).toLocaleString('pt-BR'));
  const seg = (v) => String(v).replace('.', ',');
  const formulaNome = (id) => { const f = (S.formulas || []).find((x) => x.id === id); return f ? f.nom : id || '—'; };

  // ------------------------------------------------------------------ utilidades
  async function api(caminho, { method = 'GET', body } = {}) {
    const r = await fetch(caminho, { method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(S.token ? { 'x-center-key': S.token } : {}) }, body: body ? JSON.stringify(body) : undefined });
    if (r.status === 401) { portao(true); const e = new Error('chave da Central'); e.status = 401; throw e; }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(j.error || `HTTP ${r.status}`); e.status = r.status; e.dados = j; throw e; }
    return j;
  }
  let tToast = 0;
  function toast(msg, ruim = false) { const t = $('#toast'); t.textContent = msg; t.className = `toast on${ruim ? ' ruim' : ''}`; clearTimeout(tToast); tToast = setTimeout(() => { t.className = 'toast'; }, ruim ? 5200 : 2600); }
  async function copiar(texto, ok = 'Copiado') {
    try { await navigator.clipboard.writeText(texto); toast(ok); }
    catch { const ta = document.createElement('textarea'); ta.value = texto; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); toast(ok); } catch { toast('Não consegui copiar: selecione o texto à mão', true); } ta.remove(); }
  }
  function portao(on) { $('#gate').hidden = !on; $('#app').style.visibility = on ? 'hidden' : 'visible'; if (on) $('#gate-key').focus(); }
  function anel(nota, grande = false) {
    const C = 163.36; const off = nota == null ? C : C * (1 - Math.max(0, Math.min(100, nota)) / 100);
    return `<div class="anel${grande ? ' g' : ''}" style="--c:${cor(nota)}" title="nota do gancho, de 0 a 100"><svg viewBox="0 0 60 60" aria-hidden="true"><circle class="tr" cx="30" cy="30" r="26"/><circle class="va" cx="30" cy="30" r="26" stroke-dasharray="${C}" stroke-dashoffset="${off}"/></svg><b>${nota == null ? '—' : nota}</b></div>`;
  }
  const medidaDe = (id) => ((S.dados && S.dados.pacote._verificacao && S.dados.pacote._verificacao.medidas) || {})[id] || {};
  const problemasDe = (id) => ((S.dados && S.dados.pacote._verificacao && S.dados.pacote._verificacao.problemas) || []).filter((p) => p.reel === id);
  const reelDe = (id) => (S.dados.pacote.reels || []).find((r) => r.id === id);
  const estadoDe = (id) => (S.dados.estado[id] || { status: 'a_filmer' });

  // ------------------------------------------------------------------ cabeçalho, rotas, progresso
  function pintarTopo() {
    $('#topo-t').textContent = TITULOS[S.rota] || '';
    $$('#nav a').forEach((a) => a.classList.toggle('on', a.dataset.v === S.rota));
    const comDia = S.rota === 'hoje' && S.dia; $('#dia-nav').hidden = !comDia; $('#btn-link').hidden = !(S.rota === 'hoje' && S.dados);
    if (comDia) { const i = S.dias.findIndex((d) => d.dia === S.dia); $('#dia-t').textContent = diaCurto(S.dia); $('#dia-s').textContent = S.saude && S.dia === S.saude.hoje ? 'hoje' : S.saude && S.dia > S.saude.hoje ? 'para publicar' : 'arquivo'; $('#dia-ant').disabled = i < 0 || i >= S.dias.length - 1; $('#dia-prox').disabled = i <= 0; }
    const p = $('#ia-pill'); if (S.saude) { p.dataset.s = S.saude.ia_disponivel ? 'on' : 'off'; p.querySelector('b').textContent = S.saude.ia_disponivel ? `IA ligada · ${S.saude.modelo.replace('claude-', '')}` : 'IA sem chave'; }
    $('#btn-gerar').disabled = !!(S.saude && S.saude.progresso && S.saude.progresso.rodando);
  }
  function pintarProgresso(p) {
    const el = $('#progresso');
    if (!p || (!p.rodando && !p.erro && !(p.fim && Date.now() - Date.parse(p.fim) < 20000))) { el.hidden = true; return; }
    const feitas = new Set((p.etapas || []).map((e) => e.id)); const ultima = (p.etapas || [])[p.etapas.length - 1];
    el.hidden = false;
    el.innerHTML = `<ol>${ETAPAS.map(([id, nome]) => `<li class="${ultima && ultima.id === id && p.rodando ? 'agora' : feitas.has(id) ? 'feito' : ''}">${esc(nome)}</li>`).join('')}</ol>
      <p>${p.erro ? `A rodada falhou: ${esc(p.erro)}` : p.rodando ? esc((ultima && ultima.detalhe) || 'começando…') : `Rodada de ${esc(p.dia)} terminou (${esc(p.status || '')}). ${esc((ultima && ultima.detalhe) || '')}`}</p>`;
  }
  async function vigiarProgresso() {
    clearTimeout(S.timerProg);
    try { const p = await api('/api/estudio/progresso'); if (S.saude) S.saude.progresso = p; pintarProgresso(p); pintarTopo();
      if (p.rodando) { S.timerProg = setTimeout(vigiarProgresso, 1500); return; }
      if (p.fim && !p.erro && S._esperando) { S._esperando = false; S.dia = p.dia; await carregarBase(); location.hash === '#hoje' ? rota() : (location.hash = '#hoje'); toast('Pacote novo pronto'); }
      else if (p.erro && S._esperando) { S._esperando = false; toast(`A rodada falhou: ${p.erro}`, true); }
    } catch { /* tenta de novo no próximo clique */ }
  }
  async function gerar() {
    if (!S.saude) return;
    if (!S.saude.ia_disponivel) { toast('Falta a chave da IA na Central (ANTHROPIC_API_KEY). Veja a área Sistema.', true); location.hash = '#sistema'; return; }
    const hoje = S.saude.hoje; const existe = S.dias.some((d) => d.dia === hoje);
    if (existe && !window.confirm(`Já existe um pacote para ${diaLongo(hoje)}. Gerar outro substitui o atual (o anterior fica guardado em arquivo). Continuar?`)) return;
    try { await api('/api/estudio/gerar', { method: 'POST', body: { dia: hoje } }); S._esperando = true; toast('Rodada iniciada: leva de 1 a 3 minutos'); vigiarProgresso(); }
    catch (e) { toast(e.message, true); }
  }
  async function carregarBase() {
    const [saude, dias, formulas] = await Promise.all([api('/api/estudio/saude'), api('/api/estudio/dias'), S.formulas ? null : api('/api/estudio/formulas')]);
    S.saude = saude; S.dias = dias.dias; if (formulas) { S.formulas = formulas.formulas; S.controles = formulas.controles; }
    if (!S.dia || !S.dias.some((d) => d.dia === S.dia)) S.dia = (S.dias[0] || {}).dia || null;
    pintarProgresso(saude.progresso); if (saude.progresso && saude.progresso.rodando) vigiarProgresso();
  }
  async function rota() {
    const r = (location.hash || '#hoje').slice(1); S.rota = TITULOS[r] ? r : 'hoje';
    destruirPlayers(); pintarTopo();
    const v = $('#view'); v.innerHTML = '<div class="skel"></div><div class="skel" style="height:320px"></div>';
    try { await ({ hoje: vHoje, lab: vLab, radar: vRadar, desempenho: vDesempenho, arquivo: vArquivo, sistema: vSistema })[S.rota](v); }
    catch (e) { if (e.status !== 401) v.innerHTML = `<div class="vazio"><h3>Não consegui ler esta área</h3><p>${esc(e.message)}</p><button class="btn" type="button" data-a="recarregar">Tentar de novo</button></div>`; }
    pintarTopo(); window.scrollTo(0, 0);
  }
  function destruirPlayers() { for (const p of S.minis) p.destruir(); S.minis = []; if (S.player) { S.player.destruir(); S.player = null; } }

  // ------------------------------------------------------------------ HOJE
  async function vHoje(v) {
    if (!S.dia) { S.dados = null; v.innerHTML = vazioSemPacote(); return; }
    if (!S.dados || S.dados.dia !== S.dia) { S.dados = await api(`/api/estudio/pacote?dia=${S.dia}`); S.sel = null; S.rascunho = null; S.sujo = false; }
    const p = S.dados.pacote; const ver = p._verificacao || {};
    if (!(p.reels || []).length) { v.innerHTML = `<div class="vazio"><h3>Nenhum Reel passou pelas travas neste dia</h3><p>O modelo escreveu, a medida barrou tudo. Veja o motivo em Sistema, ou gere de novo.</p></div>`; return; }
    if (!S.sel || !reelDe(S.sel)) S.sel = p.reels[0].id;
    const avisos = (ver.problemas || []).filter((x) => x.tipo === 'aviso').length;
    v.innerHTML = `
      <section class="abre">
        <p class="eyebrow">@wantedchauffeur · Toulouse · publicar às 7:00 PM</p>
        <h2>Pacote de <em>${esc(diaLongo(S.dia))}</em></h2>
        ${p.resume_pt ? `<p class="pt">${esc(p.resume_pt)}</p>` : ''}
        ${p.tendance_du_jour ? `<p class="frase" lang="fr">${esc(p.tendance_du_jour)}</p>` : ''}
        <div class="linha">
          <span class="chip ${p._modelo ? 'v' : 'atencao'}">${p._modelo ? `escrito por ${esc(String(p._modelo).replace('claude-', ''))}` : 'escrito à mão (gabarito)'}</span>
          <span class="chip ${avisos ? 'atencao' : 'bom'}">${avisos ? `${avisos} ponto(s) a conferir` : 'travas: tudo passou'}</span>
          ${(ver.removidos || []).length ? `<span class="chip ruim">${ver.removidos.length} peça(s) barrada(s)</span>` : ''}
          ${p._editado_em ? `<span class="chip">editado ${esc(quando(p._editado_em))}</span>` : ''}
          <span class="chip">${p._gerado_em ? `gerado ${esc(quando(p._gerado_em))}` : ''}</span>
        </div>
      </section>
      <section class="bloco"><header><h2>Os Reels do dia</h2><p>Toque num cartão para abrir a bancada. A prévia toca os planos, a tela e a voz no tempo certo.</p></header>
        <div class="reels" id="reels">${p.reels.map(cartaoReel).join('')}</div></section>
      <section id="bancada"></section>
      <section class="bloco"><header><h2>O resto do pacote</h2><p>Em francês, pronto para copiar.</p></header><div class="pecas">${pecas(p)}</div></section>
      ${(p._lacunas || []).length ? `<section class="bloco"><header><h2>O que faltou nesta rodada</h2></header>${p._lacunas.map((l) => `<p class="aviso">${esc(l)}</p>`).join('')}</section>` : ''}`;
    p.reels.forEach((r) => { const el = $(`#mini-${r.id}`); if (el) S.minis.push(window.WCPlayer.criar(el, S.dados.timeline[r.id], { rotulos: { tocar: 'Tocar a prévia', plano: 'PLANO' } })); });
    pintarBancada();
  }
  function vazioSemPacote() {
    const ia = S.saude && S.saude.ia_disponivel;
    return `<div class="vazio"><h3>Ainda não há pacote</h3><p>O Studio escreve três Reels por dia para o Julien filmar: pesquisa o que está acontecendo, escreve em francês e mede cada peça pelas travas do projeto.</p>
      ${ia ? '<button class="btn pri" type="button" data-a="gerar">Gerar o primeiro pacote</button>' : '<p class="aviso">A Central está sem a chave da IA (ANTHROPIC_API_KEY). Sem ela o Studio não escreve. O Laboratório de ganchos funciona mesmo assim.</p><a class="btn" href="#sistema">Ver o que falta ligar</a>'}</div>`;
  }
  function cartaoReel(r, i) {
    const m = medidaDe(r.id); const nota = m.accroche ? m.accroche.note : null; const e = estadoDe(r.id);
    return `<article class="reel${S.sel === r.id ? ' sel' : ''}" data-reel="${esc(r.id)}">
      <div id="mini-${esc(r.id)}"></div>
      <div class="reel-info">
        <div class="reel-topo"><div><span class="n">REEL ${i + 1} · ${seg(m.duree_s ?? '—')} s</span><h3 lang="fr">${esc(r.titre)}</h3></div>${anel(nota)}</div>
        <div class="reel-chips"><span class="chip v" title="fórmula do gancho">${esc(formulaNome(r.formule))}</span><span class="chip c">${esc(PILAR[r.pilier] || r.pilier)}</span>${(r.voix_off || []).length ? '' : '<span class="chip">sem voz</span>'}</div>
        <p class="gancho" lang="fr">${r.accroche_voix ? `« <b>${esc(r.accroche_voix)}</b> »` : `<b>${esc(r.accroche_ecran)}</b>`}</p>
        <div class="seg" role="group" aria-label="Estado do Reel">${Object.entries(STATUS).map(([k, t]) => `<button type="button" data-status="${k}" data-s="${k}" class="${e.status === k ? 'on' : ''}">${t}</button>`).join('')}</div>
      </div></article>`;
  }
  function pecas(p) {
    const st = p.story; const ca = p.carrousel;
    return `${st ? `<div class="carta bloco"><p class="eyebrow">Story${st.sticker ? ` · figurinha de ${esc(st.sticker)}` : ''}</p><div class="copiavel com-btn" lang="fr">${esc(st.texte)}<button class="btn mini" type="button" data-copiar="${esc(st.texte)}">Copiar</button></div></div>` : ''}
      ${ca && (ca.slides || []).length ? `<div class="carta bloco"><p class="eyebrow">Carrossel · ${esc(ca.titre)}</p><div class="slides" lang="fr">${ca.slides.map((s, i) => `<div class="slide"><span>${i + 1}/${ca.slides.length}</span>${esc(s)}</div>`).join('')}</div><button class="btn mini" type="button" data-copiar="${esc(ca.slides.map((s, i) => `${i + 1}. ${s}`).join('\n'))}" style="width:fit-content">Copiar os ${ca.slides.length} textos</button></div>` : ''}
      ${(p.reponses_commentaires || []).length ? `<div class="carta bloco"><p class="eyebrow">Respostas a comentários</p><div class="resp" lang="fr">${p.reponses_commentaires.map((c) => `<article><h4>${esc(c.situation)}</h4><p>${esc(c.reponse)}</p><button class="btn mini" type="button" data-copiar="${esc(c.reponse)}">Copiar</button></article>`).join('')}</div></div>` : ''}
      ${(p.a_eviter || []).length ? `<div class="carta bloco"><p class="eyebrow">A evitar hoje</p><ul class="evitar" lang="fr">${p.a_eviter.map((a) => `<li>${esc(a)}</li>`).join('')}</ul></div>` : ''}`;
  }

  // ------------------------------------------------------------------ bancada
  function pintarBancada() {
    const b = $('#bancada'); if (!b) return; const orig = reelDe(S.sel); if (!orig) { b.innerHTML = ''; return; }
    if (!S.rascunho || S.rascunho.id !== S.sel) { S.rascunho = JSON.parse(JSON.stringify(orig)); S.sujo = false; S.medida = { medidas: medidaDe(S.sel), problemas: problemasDe(S.sel), timeline: S.dados.timeline[S.sel], ok: true }; S.iaGanchos = null; S.quadro = null; }
    if (S.player) { S.player.destruir(); S.player = null; }
    b.className = 'bancada';
    b.innerHTML = `<div class="bancada-esq"><div id="big"></div>
        <div class="transporte"><button class="btn mini" type="button" data-a="tocar">Tocar</button><button class="btn mini" type="button" data-a="voz" aria-pressed="false">Ouvir a voz</button><button class="btn mini" type="button" data-a="srt">Baixar .srt</button></div>
        <p class="eyebrow">A prévia é desenho, não vídeo: serve para conferir ritmo, tela e fala.</p></div>
      <div class="bancada-dir"><div class="bancada-cab" id="b-cab"></div>
        <div class="abas" role="tablist">${[['roteiro', 'Roteiro'], ['ganchos', 'Ganchos'], ['legenda', 'Legenda'], ['filmagem', 'Filmagem'], ['ia', 'IA']].map(([k, t]) => `<button type="button" role="tab" data-aba="${k}" class="${S.aba === k ? 'on' : ''}" aria-selected="${S.aba === k}">${t}</button>`).join('')}</div>
        <div class="painel" id="b-painel"></div>
        <div class="rodape-ed" id="b-rodape"></div></div>`;
    S.player = window.WCPlayer.criar($('#big'), S.medida.timeline, { rotulos: { tocar: 'Tocar a prévia', plano: 'PLANO' } });
    S.player.aoTempo((t, total) => { const p = $('#pistas'); if (p) p.style.setProperty('--x', total ? t / total : 0); });
    if (!S.player.temVoz()) { const bv = $('[data-a="voz"]'); if (bv) bv.hidden = true; }
    pintarCab(); pintarAba(); pintarRodape();
  }
  function pintarCab() {
    const c = $('#b-cab'); if (!c) return; const m = (S.medida && S.medida.medidas) || {}; const nota = m.accroche ? m.accroche.note : null; const r = S.rascunho;
    c.innerHTML = `${anel(nota, true)}<div><p class="eyebrow">${esc(formulaNome(r.formule))} · ${esc(PILAR[r.pilier] || r.pilier)}</p><h2 lang="fr">${esc(r.titre)}</h2></div>
      <div class="veredito"><b style="color:${cor(nota)}">${veredito(nota)}</b><span>${m.accroche ? `primeira fala em ${seg(m.accroche.secondes)} s · ponto mais fraco: ${esc(((S.controles || {})[m.accroche.plus_faible] || [m.accroche.plus_faible])[0])}` : 'a tela carrega o gancho'} · vídeo de ${seg(m.duree_s ?? '—')} s</span></div>`;
  }
  function pintarRodape() {
    const el = $('#b-rodape'); if (!el) return; const bloqueios = ((S.medida && S.medida.problemas) || []).filter((p) => p.tipo === 'bloqueia').length;
    el.innerHTML = `<span class="estado">${S.sujo ? (bloqueios ? `${bloqueios} trava(s) impedem salvar` : 'Alterações não salvas') : 'Sem alterações'}</span>
      <button class="btn fantasma" type="button" data-a="descartar" ${S.sujo ? '' : 'disabled'}>Descartar</button>
      <button class="btn" type="button" data-a="copiar-julien">Copiar para o Julien</button>
      <button class="btn pri" type="button" data-a="salvar" ${S.sujo && !bloqueios ? '' : 'disabled'}>Salvar no pacote</button>`;
  }
  function pistas() {
    const tl = S.medida.timeline; const T = tl.total || 1; const bl = (x) => `left:${(x.debut / T) * 100}%;width:${Math.max(1.5, ((x.fin - x.debut) / T) * 100)}%`;
    return `<div class="pistas" id="pistas" title="clique para ir a um ponto do vídeo"><div class="agulha"></div>
      <div class="pista p"><span>Planos</span><div>${tl.plans.map((p) => `<i style="${bl(p)}" title="${esc(p.description)}">${p.i + 1} · ${esc(p.description)}</i>`).join('')}</div></div>
      <div class="pista e"><span>Tela</span><div>${tl.ecran.map((e) => `<i style="${bl(e)}" title="${esc(e.texte)}">${esc(e.texte)}</i>`).join('')}</div></div>
      <div class="pista v"><span>Voz</span><div>${tl.voix.map((e) => `<i style="${bl(e)}" title="${esc(e.texte)}">${esc(e.texte)}</i>`).join('') || ''}</div></div>
      <div class="regua"><span></span><div><span>0 s</span><span>${seg((T / 2).toFixed(1))} s</span><span>${seg(T)} s</span></div></div></div>
      ${tl.voix_comprimee ? `<p class="aviso">A voz não cabe nos ${seg(T)} s de imagem: na prévia ela foi acelerada para ${Math.round(tl.voix_comprimee * 100)}% do ritmo. Corte palavras ou alongue um plano.</p>` : ''}`;
  }
  function listaProblemas() {
    const ps = (S.medida && S.medida.problemas) || []; const m = (S.medida && S.medida.medidas) || {};
    const dicas = (m.minutage_avisos || []).filter((a) => !/abaixo do alvo/.test(a));
    if (!ps.length && !dicas.length) return '<p class="chip bom" style="width:fit-content">Nenhuma trava, nenhum aviso</p>';
    return `<ul class="lista-prob">${ps.map((p) => `<li class="${p.tipo === 'bloqueia' ? 'bloqueia' : 'aviso-l'}"><b>${p.tipo === 'bloqueia' ? 'BARRADO' : 'CONFERIR'}</b>${esc(p.detalhe)}</li>`).join('')}${dicas.map((d) => `<li><b>DICA</b>${esc(d)}</li>`).join('')}</ul>`;
  }
  function pintarAba() {
    const el = $('#b-painel'); if (!el) return; const r = S.rascunho; const ia = S.saude && S.saude.ia_disponivel;
    if (S.aba === 'roteiro') {
      el.innerHTML = `<div id="pistas-wrap">${pistas()}</div>
        <div class="campo"><span class="rot">Planos (duração em segundos e o que a câmera fixa vê)</span><div class="linhas" id="ed-plans">${(r.plans || []).map((p) => `<div class="linha-ed plano"><input type="number" min="0.3" max="30" step="0.1" data-k="d" value="${esc(p.duree_s)}" aria-label="duração em segundos"><textarea rows="2" data-k="t" lang="fr" aria-label="descrição do plano">${esc(p.description)}</textarea><button class="x" type="button" data-rem aria-label="remover plano">×</button></div>`).join('')}</div><button class="btn mini" type="button" data-add="plano" style="width:fit-content">+ plano</button></div>
        <div class="campo"><span class="rot">Texto de tela (início, fim, texto). O primeiro começa por TOULOUSE.</span><div class="linhas" id="ed-telas">${(r.texte_ecran || []).map((t, i) => { const j = S.medida.timeline.ecran[i] || {}; return `<div class="linha-ed tela" data-quand="${esc(t.quand || '')}"><input type="number" min="0" max="120" step="0.1" data-k="a" value="${esc(t.debut_s ?? j.debut ?? 0)}" aria-label="início"><input type="number" min="0" max="120" step="0.1" data-k="b" value="${esc(t.fin_s ?? j.fin ?? 1)}" aria-label="fim"><input type="text" data-k="t" lang="fr" value="${esc(t.texte)}" aria-label="texto de tela"><button class="x" type="button" data-rem aria-label="remover texto">×</button></div>`; }).join('')}</div><button class="btn mini" type="button" data-add="tela" style="width:fit-content">+ texto de tela</button></div>
        <div class="campo"><span class="rot">Voz off (a primeira frase é o gancho: até 3 segundos)</span><div class="linhas" id="ed-voz">${(r.voix_off || []).map((v) => `<div class="linha-ed voz"><textarea rows="2" lang="fr" aria-label="fala">${esc(v)}</textarea><button class="x" type="button" data-rem aria-label="remover fala">×</button></div>`).join('')}</div><button class="btn mini" type="button" data-add="voz" style="width:fit-content">+ fala</button></div>
        <div id="b-prob">${listaProblemas()}</div>
        ${r.traduction_pt ? `<div class="campo"><span class="rot">Tradução (o que o original dizia)</span><p class="pt">${esc(r.traduction_pt.voix || '')}</p><p class="pt mono" style="font-size:12.5px">${esc(r.traduction_pt.ecran || '')}</p></div>` : ''}
        <div class="campo"><span class="rot">Por que este roteiro</span><p class="pt" lang="fr">${esc(r.pourquoi || '')}</p></div>`;
    } else if (S.aba === 'ganchos') {
      const alt = ((S.medida.medidas || {}).alternatives || []);
      el.innerHTML = `<div class="campo"><span class="rot">O gancho atual, controle por controle</span><div id="g-atual" class="skel" style="height:120px"></div></div>
        <div class="campo"><span class="rot">Ganchos alternativos (para testar como Trial Reel)</span>${alt.length ? alt.map((a) => { const [vz, tela] = a.texte.split(/\s+\|\s+/); return `<div class="alt"><span class="nota" style="color:${cor(a.note)}">${a.note}</span><p lang="fr">${esc(vz)}<small>${esc(tela || '')}</small></p><button class="btn mini" type="button" data-usar="${esc(a.texte)}">Usar</button></div>`; }).join('') : '<p class="pt">Este Reel não tem alternativas escritas.</p>'}</div>
        <div class="campo"><span class="rot">Mais opções escritas pela IA para esta ideia</span>
          ${ia ? `<button class="btn" type="button" data-a="ia-ganchos" style="width:fit-content">Escrever 10 ganchos e medir</button>` : '<p class="aviso">Precisa da chave da IA na Central. O Laboratório mede os ganchos que você mesmo escrever.</p>'}
          <div id="g-ia" class="resultado">${S.iaGanchos ? S.iaGanchos.map((g) => cartaoGancho(g, true)).join('') : ''}</div></div>`;
      medirGanchoAtual();
    } else if (S.aba === 'legenda') {
      el.innerHTML = `<div class="grade2"><div class="campo"><label for="ed-leg">Legenda</label><textarea id="ed-leg" rows="9" lang="fr">${esc(r.legende || '')}</textarea><label for="ed-tags">Hashtags (até 5, separadas por espaço)</label><input type="text" id="ed-tags" lang="fr" value="${esc((r.hashtags || []).join(' '))}"><button class="btn" type="button" data-a="copiar-legenda" style="width:fit-content">Copiar legenda e hashtags</button></div>
        <div class="campo"><span class="rot">Verificações</span><div id="leg-check" class="skel" style="height:160px"></div></div></div>
        ${r.traduction_pt && r.traduction_pt.legende ? `<div class="campo"><span class="rot">Tradução (do texto original)</span><p class="pt">${esc(r.traduction_pt.legende)}</p></div>` : ''}`;
      medirLegenda();
    } else if (S.aba === 'filmagem') {
      const tg = r.tournage || {}; const e = estadoDe(r.id);
      el.innerHTML = `<div class="grade2"><div class="campo"><span class="rot">Antes de gravar</span><ul class="check">
          <li><input type="checkbox" id="c1"><label for="c1" style="font-size:14px;color:var(--texto)">Câmera: ${esc(tg.camera || 'fixa')}</label></li>
          <li><input type="checkbox" id="c2"><label for="c2" style="font-size:14px;color:var(--texto)">${tg.voiture_arret === false ? 'Carro em movimento: LEDs apagados' : 'Carro parado (LEDs só com o carro parado)'}</label></li>
          <li><input type="checkbox" id="c3"><label for="c3" style="font-size:14px;color:var(--texto)">${tg.personnes_a_bord ? `${tg.personnes_a_bord} pessoa(s) a bordo${tg.autorisation_image ? ': termo de imagem assinado' : ': de costas ou desfocadas'}` : 'Ninguém a bordo: sem termo de imagem'}</label></li>
          <li><input type="checkbox" id="c4"><label for="c4" style="font-size:14px;color:var(--texto)">Música: ${esc(tg.musique || 'tema original ou biblioteca da rede')}</label></li>
          <li><input type="checkbox" id="c5"><label for="c5" style="font-size:14px;color:var(--texto)">Nenhuma caixa, logo ou nome do jogo no quadro</label></li></ul></div>
        <div class="campo"><span class="rot">Lista de planos</span><ul class="check" lang="fr">${(r.plans || []).map((p, i) => `<li><input type="checkbox" id="pl${i}"><label for="pl${i}" style="font-size:14px;color:var(--texto)"><span class="mono" style="color:var(--mudo)">${seg(p.duree_s)} s</span> ${esc(p.description)}</label></li>`).join('')}</ul></div></div>
        <div class="campo"><span class="rot">Depois de publicar: o link do post fecha o ciclo com os números da conta</span>
          <div style="display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px"><input type="url" id="ed-link" placeholder="https://www.instagram.com/reel/…" value="${esc(e.lien || '')}"><button class="btn" type="button" data-a="publicado">Marcar como publicado</button></div>
          <p class="pt" style="font-size:13px">Estado atual: <b>${esc(STATUS[e.status])}</b>${e.ts ? ` · marcado por ${e.por === 'julien' ? 'Julien' : 'você'} em ${esc(quando(e.ts))}` : ''}</p></div>
        <div class="transporte"><button class="btn" type="button" data-a="srt">Baixar legendas .srt (CapCut)</button><button class="btn" type="button" data-a="copiar-julien">Copiar o roteiro para o Julien</button></div>`;
    } else {
      el.innerHTML = `${ia ? '' : '<p class="aviso">Estas duas ferramentas usam o modelo e precisam da chave da IA na Central (ANTHROPIC_API_KEY). Veja a área Sistema.</p>'}
        <div class="campo"><label for="ia-inst">Reescrever este Reel com IA</label><textarea id="ia-inst" rows="3" placeholder="Diga em português o que mudar. Ex.: troque o Capitole pelo Pont-Neuf e deixe sem voz."></textarea>
          <div class="reel-chips">${['mais curto, 9 segundos', 'sem voz, só texto de tela', 'gancho com pergunta', 'trocar o lugar por Saint-Cyprien', 'tom mais seco e direto'].map((s) => `<button class="chip" type="button" data-sug="${esc(s)}" style="cursor:pointer;background:transparent">${esc(s)}</button>`).join('')}</div>
          <button class="btn pri" type="button" data-a="ia-reescrever" style="width:fit-content" ${ia ? '' : 'disabled'}>Reescrever e medir</button>
          <p class="pt" style="font-size:13px">A proposta volta para a bancada como rascunho. Nada é salvo até você clicar em Salvar, e nada passa se as travas barrarem.</p></div>
        <div class="campo"><span class="rot">Juiz do primeiro quadro (visão)</span>
          <label class="solta" id="solta" for="q-arq"><input type="file" id="q-arq" accept="image/jpeg,image/png,image/webp" hidden>${S.quadro && S.quadro.url ? `<img src="${S.quadro.url}" alt="quadro enviado">` : '<b style="color:var(--texto)">Solte aqui o primeiro quadro do vídeo ou a capa</b><span>ou clique para escolher. JPEG, PNG ou WebP. A imagem não fica gravada.</span>'}</label>
          <div id="q-res">${S.quadro && S.quadro.res ? cartaoQuadro(S.quadro.res) : ''}</div></div>`;
    }
  }
  function cartaoGancho(g, comUsar = false) {
    return `<div class="res"><div class="nota"><b style="color:${cor(g.note)}">${g.note}</b><span class="chip ${g.verdict === 'FORTE' ? 'bom' : g.verdict === 'CORRETA' ? 'atencao' : 'ruim'}">${g.verdict === 'CORRETA' ? 'CORRETO' : g.verdict === 'FRACA' ? 'FRACO' : g.verdict === 'BLOQUEADA' ? 'BARRADO' : g.verdict}</span></div>
      <div class="txt"><p lang="fr">${esc(g.voix)}${g.ecran ? `<small>${esc(g.ecran)}</small>` : ''}</p>
        <div class="mini-ctl">${g.controles.map((c) => `<div title="${esc(c.explique)}">${esc(c.nom)} ${c.valeur}<i style="--w:${c.valeur}%;--c:${cor(c.valeur)}"></i></div>`).join('')}</div>
        <p class="dica">${seg(g.secondes)} s de fala · ${g.mots} palavras${g.formule ? ` · fórmula ${esc(g.formule.nom)}` : ''}${g.pourquoi ? ` · ${esc(g.pourquoi)}` : ''}</p>
        ${g.conseils.map((c) => `<p class="dica">→ ${esc(c)}</p>`).join('')}${g.travas.map((t) => `<p class="dica" style="color:${t.niveau === 'bloquant' ? 'var(--ruim)' : 'var(--atencao)'}">${t.niveau === 'bloquant' ? 'BARRADO' : 'CONFERIR'}: ${esc(t.message)}</p>`).join('')}
        ${comUsar && g.verdict !== 'BLOQUEADA' ? `<button class="btn mini" type="button" data-usar="${esc(`${g.voix} | ${g.ecran || ''}`)}" style="width:fit-content">Usar neste Reel</button>` : ''}</div></div>`;
  }
  function cartaoQuadro(q) {
    const sim = (v, bom) => `<b style="color:${v === bom ? 'var(--bom)' : 'var(--ruim)'}">${v ? 'sim' : 'não'}</b>`;
    return `<div class="juiz"><div><b style="color:${q.verdict === 'publier' ? 'var(--bom)' : q.verdict === 'corriger' ? 'var(--atencao)' : 'var(--ruim)'}">${esc({ publier: 'publicar', corriger: 'corrigir', refaire: 'refazer' }[q.verdict] || q.verdict || '—')}</b><span>veredito</span></div>
      <div>${sim(!!q.toulouse_lisible, true)}<span>« TOULOUSE » se lê</span></div><div>${sim(!!q.marque_du_jeu_visible, false)}<span>marca do jogo à vista</span></div><div>${sim(!!q.visage_passager_visible, false)}<span>rosto de passageiro</span></div>
      <div><b style="color:${cor(q.arret_du_pouce)}">${esc(q.arret_du_pouce ?? '—')}</b><span>para o dedo (0 a 100)</span></div><div><b style="color:${cor(q.lisible_sur_telephone)}">${esc(q.lisible_sur_telephone ?? '—')}</b><span>leitura no celular</span></div></div>
      ${q.resume_pt ? `<p class="pt">${esc(q.resume_pt)}</p>` : ''}${(q.bloqueia || []).map((b) => `<p class="aviso ruim">${esc(b)}</p>`).join('')}
      ${(q.a_corriger || []).length ? `<ul class="evitar" lang="fr">${q.a_corriger.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>` : ''}`;
  }

  // ---- edição ao vivo
  function colher() {
    const r = S.rascunho; const num = (v) => { const x = parseFloat(String(v).replace(',', '.')); return Number.isFinite(x) ? x : undefined; };
    if ($('#ed-plans')) {
      r.plans = $$('#ed-plans .linha-ed').map((l) => ({ duree_s: num($('[data-k="d"]', l).value) || 1, description: $('[data-k="t"]', l).value }));
      r.texte_ecran = $$('#ed-telas .linha-ed').map((l) => ({ quand: l.dataset.quand || '', debut_s: num($('[data-k="a"]', l).value) ?? 0, fin_s: num($('[data-k="b"]', l).value) ?? 1, texte: $('[data-k="t"]', l).value }));
      r.voix_off = $$('#ed-voz textarea').map((t) => t.value);
      r.accroche_voix = (r.voix_off.find((v) => v.trim()) || ''); r.accroche_ecran = (r.texte_ecran[0] || {}).texte || '';
    }
    if ($('#ed-leg')) { r.legende = $('#ed-leg').value; r.hashtags = $('#ed-tags').value.split(/\s+/).filter(Boolean).map((h) => (h.startsWith('#') ? h : `#${h}`)); }
  }
  function mexeu(agora = false) {
    colher(); S.sujo = true; pintarRodape(); clearTimeout(S.timerMedir);
    S.timerMedir = setTimeout(async () => {
      const id = S.rascunho.id; const vez = (S._vez = (S._vez || 0) + 1); // resposta atrasada de uma medida antiga não sobrescreve a mais nova
      try { const m = await api('/api/estudio/medir', { method: 'POST', body: { tipo: 'reel', dia: S.dia, reel: { ...S.rascunho, voix_off: (S.rascunho.voix_off || []).filter((v) => v.trim()) } } });
        if (!S.rascunho || S.rascunho.id !== id || vez !== S._vez) return;
        S.medida = m; pintarCab(); pintarRodape(); if (S.player) S.player.trocar(m.timeline);
        const w = $('#pistas-wrap'); if (w) w.innerHTML = pistas(); const pb = $('#b-prob'); if (pb) pb.innerHTML = listaProblemas();
        if (S.aba === 'ganchos') medirGanchoAtual(); if (S.aba === 'legenda') medirLegenda();
      } catch (e) { if (e.status !== 401) toast(e.message, true); }
    }, agora ? 0 : 380);
  }
  async function medirGanchoAtual() {
    const el = $('#g-atual'); if (!el) return; const r = S.rascunho; const voz = (r.voix_off || []).find((v) => v.trim());
    if (!voz) { el.removeAttribute('style'); el.className = ''; el.innerHTML = `<p class="pt">Reel sem voz: o gancho é o texto de tela « <b lang="fr">${esc((r.texte_ecran[0] || {}).texte || '')}</b> ».</p>`; return; }
    try { const j = await api('/api/estudio/medir', { method: 'POST', body: { tipo: 'ganchos', texto: `${voz} | ${(r.texte_ecran[0] || {}).texte || ''}` } }); el.removeAttribute('style'); el.className = 'resultado'; el.innerHTML = j.ganchos.map((g) => cartaoGancho(g)).join(''); } catch (e) { el.removeAttribute('style'); el.className = ''; el.innerHTML = `<p class="aviso ruim">${esc(e.message)}</p>`; }
  }
  async function medirLegenda() {
    const el = $('#leg-check'); if (!el) return; const r = S.rascunho;
    try { const j = await api('/api/estudio/medir', { method: 'POST', body: { tipo: 'legenda', texto: `${r.legende || ''}\n${(r.hashtags || []).join(' ')}`.trim() } });
      el.removeAttribute('style'); el.className = ''; el.innerHTML = `<ul class="lista-prob">${j.linhas.map((l) => `<li class="${l.estado === 'falha' ? 'bloqueia' : l.estado === 'aviso' ? 'aviso-l' : ''}"><b style="color:${l.estado === 'ok' ? 'var(--bom)' : l.estado === 'aviso' ? 'var(--atencao)' : 'var(--ruim)'}">${esc(l.nome)}</b>${esc(l.detalhe)}</li>`).join('')}${j.travas.filter((t) => !/batem com a tabela/.test(t.message)).map((t) => `<li class="${t.niveau === 'bloquant' ? 'bloqueia' : 'aviso-l'}"><b>${t.niveau === 'bloquant' ? 'BARRADO' : 'CONFERIR'}</b>${esc(t.message)}</li>`).join('')}</ul>
        ${j.fenetre ? `<p class="rot" style="margin-top:10px">Como aparece antes do « … plus »</p><p class="copiavel" lang="fr">${esc(j.fenetre)}${j.coupe ? ' <span style="color:var(--mudo)">… plus</span>' : ''}</p>` : ''}`;
    } catch (e) { el.removeAttribute('style'); el.className = ''; el.innerHTML = `<p class="aviso ruim">${esc(e.message)}</p>`; }
  }
  function textoJulien(r) {
    const tg = r.tournage || {};
    return [`*Reel · ${r.titre}*`, '', `L'idée : ${r.idee}`, '', 'Les plans :', ...(r.plans || []).map((p, i) => `${i + 1}. (${seg(p.duree_s)} s) ${p.description}`), '', 'Texte à l\'écran :', ...(r.texte_ecran || []).map((t) => `- ${t.quand || `${seg(t.debut_s)}–${seg(t.fin_s)} s`} : ${t.texte}`), '',
      (r.voix_off || []).filter(Boolean).length ? `Voix off : ${(r.voix_off || []).filter(Boolean).map((v) => `« ${v} »`).join(' … ')}` : 'Sans voix : l\'écran porte tout.', '', 'Légende :', r.legende, (r.hashtags || []).join(' '), '',
      `Tournage : ${tg.camera || 'caméra fixe'} · ${tg.voiture_arret === false ? 'voiture en mouvement, pas de LED' : 'voiture à l\'arrêt'} · musique : ${tg.musique || 'thème original ou bibliothèque'}`].join('\n');
  }
  async function baixarSrt() {
    try { const r = await fetch(`/api/estudio/srt?dia=${S.dia}&reel=${encodeURIComponent(S.sel)}`, { headers: S.token ? { 'x-center-key': S.token } : {} }); if (!r.ok) throw new Error('não achei o Reel salvo');
      const url = URL.createObjectURL(new Blob([await r.text()], { type: 'application/x-subrip' })); const a = document.createElement('a'); a.href = url; a.download = `wanted-chauffeur-${S.dia}-${S.sel}.srt`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 2000);
      toast(S.sujo ? 'Baixei as legendas da versão salva (há alterações não salvas)' : 'Legendas baixadas: no CapCut, Texto → Legendas → Importar'); } catch (e) { toast(e.message, true); }
  }
  async function marcar(reel, status, lien = null) {
    try { const j = await api('/api/estudio/estado', { method: 'POST', body: { dia: S.dia, reel, status, ...(lien ? { lien } : {}) } }); S.dados.estado = j.estado;
      $$(`.reel[data-reel="${reel}"] .seg button`).forEach((b) => b.classList.toggle('on', b.dataset.status === status));
      const d = S.dias.find((x) => x.dia === S.dia); if (d) { const rr = d.reels.find((x) => x.id === reel); if (rr) rr.status = status; }
      toast(status === 'publie' && !lien ? 'Marcado. Cole o link do post na aba Filmagem para medir o resultado.' : `Marcado: ${STATUS[status]}`); if (S.aba === 'filmagem' && S.sel === reel) pintarAba();
    } catch (e) { toast(e.message, true); }
  }
  function usarGancho(texto) {
    const [voz, tela] = texto.split(/\s+\|\s+/); const r = S.rascunho;
    r.voix_off = r.voix_off && r.voix_off.length ? [voz, ...r.voix_off.slice(1)] : [voz]; if (tela && r.texte_ecran && r.texte_ecran[0]) r.texte_ecran[0].texte = tela;
    r.accroche_voix = voz; if (tela) r.accroche_ecran = tela; S.sujo = true; S.aba = 'roteiro'; $$('.abas button').forEach((b) => b.classList.toggle('on', b.dataset.aba === 'roteiro')); pintarAba(); mexeu(true); toast('Gancho trocado no rascunho. Confira a prévia e salve.');
  }
  function lerImagem(arq) {
    if (!arq || !/^image\/(jpeg|png|webp)$/.test(arq.type)) { toast('Envie JPEG, PNG ou WebP', true); return; }
    const fr = new FileReader();
    fr.onload = () => { const img = new Image(); img.onload = async () => {
      const k = Math.min(1, 1280 / Math.max(img.width, img.height)); const cv = document.createElement('canvas'); cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k); cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      const url = cv.toDataURL('image/jpeg', 0.86); S.quadro = { url, res: null }; pintarAba(); $('#q-res').innerHTML = '<div class="skel" style="height:110px"></div>';
      try { const res = await api('/api/estudio/quadro', { method: 'POST', body: { imagem: url, dia: S.dia, reel: S.sel } }); S.quadro.res = res; if ($('#q-res')) $('#q-res').innerHTML = cartaoQuadro(res); }
      catch (e) { if ($('#q-res')) $('#q-res').innerHTML = `<p class="aviso ruim">${esc(e.message)}</p>`; }
    }; img.src = fr.result; };
    fr.readAsDataURL(arq);
  }

  // ------------------------------------------------------------------ LABORATÓRIO
  async function vLab(v) {
    if (!S.formulas) await carregarBase();
    v.innerHTML = `<section class="abre"><p class="eyebrow">Sem modelo, resposta na hora</p><h2>Laboratório de <em>ganchos</em></h2><p class="pt">Escreva um gancho por linha, no formato <span class="mono">fala | texto de tela</span>. A nota elimina o fraco; quem escolhe o vencedor são os números da conta.</p></section>
      <section class="lab"><div class="bloco">
          <div class="campo"><label for="lab-t">Ganchos em francês</label><textarea id="lab-t" rows="8" lang="fr" placeholder="Ce soir, Toulouse joue dans son salon. Sauf ces 2 manettes. | TOULOUSE · ce soir">${esc(S.labTexto)}</textarea></div>
          <div class="campo"><label for="lab-ideia">Ou peça à IA: a ideia do Reel em uma frase</label><div style="display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px"><input type="text" id="lab-ideia" placeholder="ex.: o carro passa em frente ao Marché de Noël do Capitole"><button class="btn" type="button" data-a="lab-ia" ${S.saude && S.saude.ia_disponivel ? '' : 'disabled title="precisa da chave da IA na Central"'}>Escrever 10</button></div></div>
          <div class="campo"><label for="lab-leg">Conferir uma legenda</label><textarea id="lab-leg" rows="5" lang="fr" placeholder="cole a legenda com as hashtags"></textarea><div id="lab-leg-res"></div></div>
        </div>
        <div class="bloco"><header><h2>Resultado</h2><p id="lab-cont"></p></header><div class="resultado" id="lab-res"><p class="pt">Os ganchos medidos aparecem aqui, do mais forte ao mais fraco.</p></div></div></section>
      <section class="bloco"><header><h2>As ${S.formulas.length} fórmulas</h2><p>Cada uma com o modelo, um exemplo e como costuma ser estragada. Toque em « Usar » para levar o modelo ao campo.</p></header>
        <div class="formulas">${S.formulas.map((f) => `<article class="formula"><h3>${esc(f.nom)}</h3><p class="modelo" lang="fr">${esc(f.modele)}</p><p class="ex" lang="fr">${esc(f.exemple)}</p><p class="rate">Estraga quando: ${esc(f.rate)}</p><button class="btn mini" type="button" data-modelo="${esc(`${f.exemple} | ${f.ecran || ''}`)}" style="width:fit-content">Usar</button></article>`).join('')}</div></section>`;
    if (S.labTexto.trim()) medirLab();
  }
  let tLab = 0;
  function medirLab() {
    clearTimeout(tLab); tLab = setTimeout(async () => {
      const t = $('#lab-t'); if (!t) return; S.labTexto = t.value; try { localStorage.setItem('wc_lab', S.labTexto); } catch { /* sem armazenamento */ }
      if (!S.labTexto.trim()) { $('#lab-res').innerHTML = '<p class="pt">Os ganchos medidos aparecem aqui, do mais forte ao mais fraco.</p>'; $('#lab-cont').textContent = ''; return; }
      try { const j = await api('/api/estudio/medir', { method: 'POST', body: { tipo: 'ganchos', texto: S.labTexto } }); if (!$('#lab-res')) return; $('#lab-res').innerHTML = j.ganchos.map((g) => cartaoGancho(g)).join(''); $('#lab-cont').textContent = `${j.ganchos.length} medido(s) · ${j.ganchos.filter((g) => g.verdict === 'FORTE').length} forte(s)`; } catch (e) { if (e.status !== 401) toast(e.message, true); }
    }, 320);
  }
  let tLeg = 0;
  function medirLabLegenda() {
    clearTimeout(tLeg); tLeg = setTimeout(async () => { const t = $('#lab-leg'); if (!t) return; const el = $('#lab-leg-res'); if (!t.value.trim()) { el.innerHTML = ''; return; }
      try { const j = await api('/api/estudio/medir', { method: 'POST', body: { tipo: 'legenda', texto: t.value } }); el.innerHTML = `<ul class="lista-prob">${j.linhas.map((l) => `<li class="${l.estado === 'falha' ? 'bloqueia' : l.estado === 'aviso' ? 'aviso-l' : ''}"><b style="color:${l.estado === 'ok' ? 'var(--bom)' : l.estado === 'aviso' ? 'var(--atencao)' : 'var(--ruim)'}">${esc(l.nome)}</b>${esc(l.detalhe)}</li>`).join('')}${j.travas.map((x) => `<li class="${x.niveau === 'bloquant' ? 'bloqueia' : 'aviso-l'}"><b>${x.niveau === 'bloquant' ? 'BARRADO' : 'CONFERIR'}</b>${esc(x.message)}</li>`).join('')}</ul>`; } catch (e) { if (e.status !== 401) el.innerHTML = `<p class="aviso ruim">${esc(e.message)}</p>`; } }, 350);
  }

  // ------------------------------------------------------------------ RADAR
  async function vRadar(v) {
    const dia = S.dia || (S.saude && S.saude.hoje); const r = await api(`/api/estudio/radar${dia ? `?dia=${dia}` : ''}`);
    const t0 = Date.parse(`${r.dia}T12:00:00Z`); const DIA = 86400000; const col = (iso) => Math.round((Date.parse(`${iso}T12:00:00Z`) - t0) / DIA) + 1;
    const diasCal = Array.from({ length: 22 }, (_, i) => new Date(t0 + i * DIA));
    const cestos = { jeu: 'Jogo e gaming', reels: 'Formatos da semana', toulouse: 'Toulouse' };
    v.innerHTML = `<section class="abre"><p class="eyebrow">O que dá para surfar · ${esc(diaLongo(r.dia))}</p><h2>Radar de <em>Toulouse</em> e das redes</h2><p class="pt">O calendário vem do plano aprovado e de fontes conferidas. As novidades vêm da pesquisa que o modelo faz na web a cada pacote, sempre com a fonte.</p></section>
      <section class="bloco"><header><h2>Os próximos 21 dias</h2><p>Pilar de hoje: ${esc(PILAR[r.calendario.pilier] || r.calendario.pilier)}. Tracejado = data a confirmar na véspera.</p></header>
        <div class="carta cal"><div class="cal-dias">${diasCal.map((d, i) => `<span class="${i === 0 ? 'hoje' : [0, 6].includes(d.getUTCDay()) ? 'fds' : ''}">${['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'][d.getUTCDay()]}<br>${d.getUTCDate()}</span>`).join('')}</div>
          ${r.calendario.eventos.map((e) => `<div class="cal-ev"><div class="${e.statut === 'FATO' ? '' : 'conf'}" style="--a:${Math.max(1, col(e.de))};--b:${Math.min(23, col(e.ate) + 1)}" title="${esc(e.titre)} · ${esc(e.angle)} · fonte: ${esc(e.source)}" lang="fr">${esc(e.titre)}</div></div>`).join('')}</div>
        <div class="novas">${r.calendario.eventos.map((e) => `<article class="nova"><p class="eyebrow">${esc(diaCurto(e.de))}${e.ate !== e.de ? ` → ${esc(diaCurto(e.ate))}` : ''} · ${e.statut === 'FATO' ? 'confirmado' : 'a confirmar'}</p><h3 lang="fr">${esc(e.titre)}</h3><p class="angulo" lang="fr">${esc(e.angle)}</p><footer><span>${esc(e.source)}</span></footer></article>`).join('')}</div></section>
      <section class="bloco"><header><h2>Novidades do dia</h2><p>${r.veille ? `${r.veille.novidades.length} com fonte · ${r.veille.buscas || 0} busca(s)${r.veille.descartadas_sem_fonte ? ` · ${r.veille.descartadas_sem_fonte} descartada(s) por não ter fonte` : ''}` : ''}</p></header>
        ${r.veille && r.veille.novidades.length ? `<div class="novas">${r.veille.novidades.map((x) => `<article class="nova"><p class="eyebrow">${esc(cestos[x.panier] || x.panier)} · ${esc(x.date || '')}</p><h3 lang="fr">${esc(x.titre)}</h3><p lang="fr" style="font-size:13.5px">${esc(x.fait)}</p><p class="angulo" lang="fr">${esc(x.angle_pour_nous || '')}</p><footer><a href="${esc(x.source_url)}" target="_blank" rel="noopener noreferrer">${esc(String(x.source_url).replace(/^https?:\/\/(www\.)?/, '').split('/')[0])}</a></footer></article>`).join('')}</div>${(r.veille.a_eviter || []).length ? `<div class="carta bloco"><p class="eyebrow">A evitar</p><ul class="evitar" lang="fr">${r.veille.a_eviter.map((a) => `<li>${esc(a)}</li>`).join('')}</ul></div>` : ''}`
          : `<div class="vazio"><h3>Sem pesquisa na web para este dia</h3><p>${esc(r.lacuna || '')}</p>${S.saude && S.saude.ia_disponivel ? '<button class="btn pri" type="button" data-a="gerar">Gerar o pacote de hoje com pesquisa</button>' : ''}</div>`}</section>`;
  }

  // ------------------------------------------------------------------ DESEMPENHO
  function grafico(hist) {
    if (hist.length < 2) return '<p class="pt">O gráfico aparece quando houver dois dias de leitura.</p>';
    const W = 760, H = 220, p = { l: 44, r: 12, t: 14, b: 26 }; const vs = hist.map((h) => h.seguidores); const mn = Math.min(...vs), mx = Math.max(...vs); const span = Math.max(1, mx - mn);
    const x = (i) => p.l + (i / (hist.length - 1)) * (W - p.l - p.r); const y = (v) => p.t + (1 - (v - mn) / span) * (H - p.t - p.b);
    const linha = hist.map((h, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(h.seguidores).toFixed(1)}`).join(' ');
    const passo = Math.max(1, Math.ceil(hist.length / 7));
    return `<svg class="grafico" viewBox="0 0 ${W} ${H}" role="img" aria-label="seguidores por dia"><defs><linearGradient id="gl" x1="0" x2="1"><stop offset="0" stop-color="#8b5cf6"/><stop offset=".55" stop-color="#ff4fa3"/><stop offset="1" stop-color="#6fd3ff"/></linearGradient><linearGradient id="ga" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#ff4fa3" stop-opacity=".28"/><stop offset="1" stop-color="#ff4fa3" stop-opacity="0"/></linearGradient></defs>
      ${[0, 0.5, 1].map((g) => { const v = mn + span * g; return `<line x1="${p.l}" x2="${W - p.r}" y1="${y(v)}" y2="${y(v)}" stroke="#2c2147" stroke-width="1"/><text x="${p.l - 8}" y="${y(v) + 3}" text-anchor="end">${n(Math.round(v))}</text>`; }).join('')}
      <path d="${linha} L${x(hist.length - 1)} ${H - p.b} L${p.l} ${H - p.b} Z" fill="url(#ga)" stroke="none"/><path d="${linha}" stroke="url(#gl)" stroke-width="2.5" fill="none"/>
      <circle cx="${x(hist.length - 1)}" cy="${y(vs[vs.length - 1])}" r="4.5" fill="#fff" stroke="none"/>
      ${hist.map((h, i) => (i % passo === 0 || i === hist.length - 1 ? `<text x="${x(i)}" y="${H - 8}" text-anchor="${i === hist.length - 1 ? 'end' : 'middle'}">${h.dia.slice(8)}/${h.dia.slice(5, 7)}</text>` : '')).join('')}</svg>`;
  }
  async function vDesempenho(v) {
    const d = await api('/api/estudio/desempenho'); const f = d.funil; const mxF = Math.max(1, f.escritos);
    const tabGrupo = (titulo, lista, rot) => `<div class="carta bloco"><p class="eyebrow">${titulo}</p>${lista.length ? `<div class="tab-wrap"><table class="tab" style="min-width:420px"><thead><tr><th>${rot}</th><th class="n">Reels</th><th class="n">Seguidores</th><th class="n">Vistas (mediana)</th><th class="n">× mediana</th></tr></thead><tbody>${lista.map((g) => `<tr><td>${esc(rot === 'Fórmula' ? formulaNome(g.valor) : PILAR[g.valor] || g.valor)}</td><td class="n">${g.n}</td><td class="n">${n(g.abonnes_total)}</td><td class="n">${n(g.vues_mediane)}</td><td class="n">${g.multiple_mediane == null ? '—' : `${seg(g.multiple_mediane)}×`}</td></tr>`).join('')}</tbody></table></div>` : '<p class="pt">Aparece quando houver Reel publicado, com link, lido pelo Olheiro.</p>'}</div>`;
    v.innerHTML = `<section class="abre"><p class="eyebrow">O que os roteiros renderam depois de publicados</p><h2>Seguidores e <em>pedidos</em>, não vistas</h2><p class="pt">Cada Reel marcado como publicado, com o link do post, é cruzado com o que o Olheiro leu da conta. É assim que o Studio aprende qual fórmula traz seguidor em Toulouse.</p></section>
      ${d.demo ? '<p class="aviso info"><b>Dados de ensaio.</b> Estes números foram gerados para testar a tela neste computador. Não são da conta real.</p>' : ''}
      ${d.lacunas.map((l) => `<p class="aviso">${esc(l)}</p>`).join('')}
      <section class="kpis"><div class="kpi destaque"><b>${n(d.conta && d.conta.seguidores)}</b><span>seguidores${d.conta && d.conta.username ? ` · @${esc(d.conta.username)}` : ''}</span></div>
        <div class="kpi"><b>${d.conta && d.conta.seguidores_7d != null ? `${d.conta.seguidores_7d >= 0 ? '+' : ''}${n(d.conta.seguidores_7d)}` : '—'}</b><span>em 7 dias</span></div>
        <div class="kpi"><b>${d.ganho_mediano == null ? '—' : `${d.ganho_mediano >= 0 ? '+' : ''}${seg(d.ganho_mediano)}`}</b><span>por dia (mediana)</span></div>
        <div class="kpi"><b>${n(d.conta && d.conta.mediana_views_reels_30d)}</b><span>vistas por Reel (mediana, 30 dias)</span></div></section>
      <section class="bloco"><header><h2>Seguidores por dia</h2><p>${d.conta && d.conta.atualizado_em ? `lido em ${esc(quando(d.conta.atualizado_em))}` : ''}</p></header><div class="carta">${d.olheiro_ligado ? grafico(d.seguidores_historico) : '<p class="pt">Sem leitura da conta. O Olheiro do Instagram liga com a chave da Meta no Easypanel (runbook olheiro-instagram).</p>'}</div></section>
      <section class="grade2"><div class="carta bloco"><p class="eyebrow">Do roteiro ao resultado</p><div class="funil">${[['Escritos', f.escritos], ['Filmados', f.filmados], ['Publicados', f.publicados], ['Com números', f.medidos]].map(([t, q], i) => `<div><span>${t}</span><i style="--w:${(q / mxF) * 100}%;--o:${1 - i * 0.18}"></i><b>${q}</b></div>`).join('')}</div><p class="pt" style="font-size:13px">${f.descartados} descartado(s) pelo Julien. O que ele descarta, o Studio evita nos próximos pacotes.</p></div>
        <div class="carta bloco"><p class="eyebrow">A nota do gancho prevê resultado nesta conta?</p><p class="pt">${esc(d.calibragem.message)}</p>${d.calibragem.pronta ? `<div class="funil"><div><span>Gancho forte</span><i style="--w:100%"></i><b>${n(d.calibragem.alto.vues_mediane)}</b></div><div><span>Demais</span><i style="--w:${d.calibragem.alto.vues_mediane ? Math.min(100, (d.calibragem.baixo.vues_mediane / d.calibragem.alto.vues_mediane) * 100) : 0}%;--o:.6"></i><b>${n(d.calibragem.baixo.vues_mediane)}</b></div></div>` : ''}</div></section>
      <section class="grade2">${tabGrupo('Por fórmula de gancho', d.por_formule, 'Fórmula')}${tabGrupo('Por pilar', d.por_pilier, 'Pilar')}</section>
      <section class="bloco"><header><h2>Reel por Reel</h2><p>${d.reels.length} roteiro(s) escritos</p></header><div class="carta tab-wrap"><table class="tab"><thead><tr><th>Dia</th><th>Reel</th><th>Fórmula</th><th class="n">Gancho</th><th>Estado</th><th class="n">Vistas</th><th class="n">Seguidores</th><th class="n">× mediana</th></tr></thead><tbody>
        ${d.reels.map((r) => `<tr><td class="mono">${esc(r.dia.slice(8))}/${esc(r.dia.slice(5, 7))}</td><td lang="fr">${r.lien ? `<a href="${esc(r.lien)}" target="_blank" rel="noopener noreferrer">${esc(r.titre)}</a>` : esc(r.titre)}</td><td>${esc(formulaNome(r.formule))}</td><td class="n" style="color:${cor(r.note)}">${r.note ?? '—'}</td><td><span class="chip ${r.status === 'publie' ? 'bom' : r.status === 'filme' ? 'atencao' : ''}">${esc(STATUS[r.status])}</span></td><td class="n">${n(r.vues)}</td><td class="n">${r.abonnes == null ? '—' : `+${n(r.abonnes)}`}</td><td class="n">${r.multiple == null ? '—' : `${seg(r.multiple)}×`}</td></tr>`).join('') || '<tr><td colspan="8">Nenhum roteiro ainda.</td></tr>'}</tbody></table></div></section>`;
  }

  // ------------------------------------------------------------------ ARQUIVO e SISTEMA
  async function vArquivo(v) {
    await carregarBase();
    v.innerHTML = `<section class="abre"><p class="eyebrow">${S.dias.length} dia(s) com pacote</p><h2>Arquivo dos <em>pacotes</em></h2></section>
      ${S.dias.length ? `<div class="dias">${S.dias.map((d) => `<button class="dia-linha" type="button" data-dia="${esc(d.dia)}"><span><b>${esc(diaCurto(d.dia))}</b><br><span class="eyebrow">${d.modelo ? esc(String(d.modelo).replace('claude-', '')) : 'à mão'}</span></span><p lang="fr">${esc(d.tendance || d.reels.map((r) => r.titre).join(' · '))}</p><span class="pontos">${d.reels.map((r) => `<span class="chip ${r.status === 'publie' ? 'bom' : r.status === 'filme' ? 'atencao' : r.status === 'ecarte' ? '' : 'c'}" title="${esc(STATUS[r.status])}" lang="fr">${esc(r.titre)}${r.note != null ? ` · ${r.note}` : ''}</span>`).join('')}</span></button>`).join('')}</div>` : vazioSemPacote()}`;
  }
  async function vSistema(v) {
    await carregarBase(); const s = S.saude; const p = s.progresso || {};
    const luz = (on, t, sub) => `<div class="luz${on ? ' on' : ''}"><i></i><div>${t}<small>${sub}</small></div></div>`;
    v.innerHTML = `<section class="abre"><p class="eyebrow">O que está ligado e o que falta</p><h2>Sistema do <em>Studio</em></h2><p class="pt">O Studio nunca publica, comenta ou responde. Ele escreve e mede; o Julien filma e publica. Ligar a rotina diária é decisão do fundador.</p></section>
      <section class="sis"><div class="carta">
          ${luz(s.ia_disponivel, 'Modelo de IA', s.ia_disponivel ? `${esc(s.modelo)} · esforço ${esc(s.effort)}` : 'falta ANTHROPIC_API_KEY na Central')}
          ${luz(s.rotina_ligada, 'Rotina diária', s.rotina_ligada ? 'o pacote nasce sozinho todo dia' : 'ESTUDIO_VIRAL=on liga; até lá, só pelo botão « Gerar pacote »')}
          ${luz(s.link_disponivel, 'Página do Julien', s.link_disponivel ? 'link assinado por dia, sem chave' : 'falta CHAUFFEUR_CONFIRMA_URL (e o segredo do link)')}
          ${luz(s.aviso_ligado, 'Aviso no WhatsApp do Julien', s.aviso_ligado ? 'uma linha com o link, pela Aria' : 'ESTUDIO_AVISAR=on + ARIA_TEAM_ALERT_SECRET')}
          ${luz(s.olheiro_leu, 'Números da conta (Olheiro)', s.olheiro_leu ? 'o pacote aprende com o que rendeu' : 'sem leitura: falta a chave da Meta (IG_ACCESS_TOKEN)')}
          ${luz(s.skill_em_dia !== false, 'Travas e voz da marca', s.skill_em_dia === false ? 'a cópia da skill está velha: rodar sincronizar-skill.js' : 'as mesmas regras da skill Wanted Chauffeur Studio')}</div>
        <div class="carta bloco"><p class="eyebrow">Última rodada pelo painel</p>${p.inicio ? `<p>${esc(p.dia)} · começou ${esc(quando(p.inicio))}${p.fim ? ` · terminou ${esc(quando(p.fim))}` : ' · em curso'}</p><ul class="lista-prob">${(p.etapas || []).map((e) => `<li><b>${esc((ETAPAS.find((x) => x[0] === e.id) || [0, e.id])[1]).toUpperCase()}</b>${esc(e.detalhe)}</li>`).join('')}</ul>${p.erro ? `<p class="aviso ruim">${esc(p.erro)}</p>` : ''}${(p.lacunas || []).map((l) => `<p class="aviso">${esc(l)}</p>`).join('')}` : '<p class="pt">Nenhuma rodada disparada pelo painel desde que a Central subiu.</p>'}
          <p class="pt" style="font-size:13px">${s.dias} dia(s) com pacote · último: ${s.ultimo ? esc(diaLongo(s.ultimo)) : '—'} · hoje em Paris: ${esc(diaLongo(s.hoje))}</p></div></section>
      ${s.falta.length ? `<section class="bloco"><header><h2>Para ligar tudo</h2><p>No Easypanel, serviço da Central, aba Environment. Passo a passo em docs/runbooks/estudio-viral.md.</p></header>${s.falta.map((f) => `<p class="aviso">${esc(f)}</p>`).join('')}</section>` : '<p class="chip bom" style="width:fit-content">Tudo ligado</p>'}`;
  }

  // ------------------------------------------------------------------ eventos
  document.addEventListener('click', async (ev) => {
    const t = ev.target.closest('button, a, .reel, label.solta'); if (!t) return;
    if (t.dataset.copiar !== undefined) { ev.stopPropagation(); return copiar(t.dataset.copiar); }
    if (t.dataset.status) { ev.stopPropagation(); return marcar(t.closest('.reel').dataset.reel, t.dataset.status); }
    if (t.classList.contains('reel')) { if (ev.target.closest('.ph')) return; const id = t.dataset.reel; if (id === S.sel) return; if (S.sujo && !window.confirm('Há alterações não salvas neste Reel. Descartar?')) return; S.sel = id; S.rascunho = null; $$('.reel').forEach((x) => x.classList.toggle('sel', x.dataset.reel === id)); pintarBancada(); $('#bancada').scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
    if (t.dataset.aba) { colher(); S.aba = t.dataset.aba; $$('.abas button').forEach((b) => { b.classList.toggle('on', b === t); b.setAttribute('aria-selected', b === t); }); return pintarAba(); }
    if (t.dataset.rem !== undefined) { t.closest('.linha-ed').remove(); return mexeu(true); }
    if (t.dataset.add) { colher(); const r = S.rascunho; const T = (S.medida.timeline.total || 10); if (t.dataset.add === 'plano') r.plans.push({ duree_s: 2, description: '' }); if (t.dataset.add === 'tela') r.texte_ecran.push({ quand: '', debut_s: Math.max(0, T - 3), fin_s: Math.max(1, T - 1), texte: '' }); if (t.dataset.add === 'voz') r.voix_off.push(''); pintarAba(); const ult = $$(`#ed-${{ plano: 'plans', tela: 'telas', voz: 'voz' }[t.dataset.add]} .linha-ed`).pop(); if (ult) (ult.querySelector('textarea, input[type="text"]') || ult.querySelector('input')).focus(); return; }
    if (t.dataset.usar) return usarGancho(t.dataset.usar);
    if (t.dataset.sug) { const i = $('#ia-inst'); i.value = i.value ? `${i.value.trim()}; ${t.dataset.sug}` : t.dataset.sug; return i.focus(); }
    if (t.dataset.modelo) { const a = $('#lab-t'); a.value = `${a.value.trim() ? `${a.value.trim()}\n` : ''}${t.dataset.modelo}`; a.scrollIntoView({ behavior: 'smooth', block: 'center' }); a.focus(); return medirLab(); }
    if (t.dataset.dia) { S.dia = t.dataset.dia; S.dados = null; location.hash = '#hoje'; return; }
    const a = t.dataset.a;
    if (a === 'recarregar') return rota();
    if (a === 'gerar') return gerar();
    if (a === 'tocar') return S.player && S.player.alternar();
    if (a === 'voz') { const on = t.getAttribute('aria-pressed') !== 'true'; const ok = S.player.voz(on); t.setAttribute('aria-pressed', ok); t.textContent = ok ? 'Voz ligada' : 'Ouvir a voz'; if (ok) { S.player.ir(0); S.player.tocar(); } return; }
    if (a === 'srt') return baixarSrt();
    if (a === 'copiar-julien') { colher(); return copiar(textoJulien(S.rascunho), 'Roteiro copiado, em francês, pronto para o WhatsApp'); }
    if (a === 'copiar-legenda') { colher(); return copiar(`${S.rascunho.legende}\n${(S.rascunho.hashtags || []).join(' ')}`, 'Legenda copiada'); }
    if (a === 'descartar') { S.rascunho = null; pintarBancada(); return toast('Alterações descartadas'); }
    if (a === 'publicado') { const l = $('#ed-link').value.trim(); return marcar(S.sel, 'publie', l || null); }
    if (a === 'salvar') { colher(); t.disabled = true;
      try { const j = await api('/api/estudio/reel', { method: 'POST', body: { dia: S.dia, reel: { ...S.rascunho, voix_off: (S.rascunho.voix_off || []).filter((x) => x.trim()) }, motivo: S._viaIa ? 'ia' : 'edicao' } });
        const i = S.dados.pacote.reels.findIndex((x) => x.id === j.reel.id); S.dados.pacote.reels[i] = j.reel; S.dados.timeline[j.reel.id] = j.timeline; const ver = S.dados.pacote._verificacao; ver.medidas[j.reel.id] = j.medidas; ver.problemas = ver.problemas.filter((x) => x.reel !== j.reel.id).concat(j.problemas); S._viaIa = false;
        S.rascunho = null; S.sujo = false; destruirPlayers(); await vHoje($('#view')); toast('Salvo no pacote. A página do Julien já mostra a versão nova.'); }
      catch (e) { if (e.dados && e.dados.problemas) { S.medida = { ...S.medida, problemas: e.dados.problemas, medidas: e.dados.medidas || S.medida.medidas }; pintarRodape(); const pb = $('#b-prob'); if (pb) pb.innerHTML = listaProblemas(); } toast(e.message, true); t.disabled = false; }
      return; }
    if (a === 'ia-ganchos' || a === 'lab-ia') {
      const ideia = a === 'lab-ia' ? $('#lab-ideia').value.trim() : `${S.rascunho.idee} (titre : ${S.rascunho.titre})`; if (!ideia) return toast('Escreva a ideia do Reel em uma frase', true);
      const rot = t.textContent; t.disabled = true; t.textContent = 'Escrevendo e medindo…';
      try { const j = await api('/api/estudio/ganchos', { method: 'POST', body: { ideia, pilier: a === 'lab-ia' ? null : S.rascunho.pilier } });
        if (a === 'lab-ia') { const ta = $('#lab-t'); ta.value = `${ta.value.trim() ? `${ta.value.trim()}\n` : ''}${j.accroches.map((g) => `${g.voix} | ${g.ecran || ''}`).join('\n')}`; medirLab(); }
        else { S.iaGanchos = j.accroches; const el = $('#g-ia'); if (el) el.innerHTML = j.accroches.map((g) => cartaoGancho(g, true)).join(''); }
        toast(`${j.accroches.length} ganchos medidos${j.barrados ? ` · ${j.barrados} barrado(s) pelas travas` : ''}`); }
      catch (e) { toast(e.message, true); } finally { t.disabled = false; t.textContent = rot; }
      return; }
    if (a === 'ia-reescrever') {
      const inst = $('#ia-inst').value.trim(); if (!inst) return toast('Diga o que mudar', true);
      if (S.sujo && !window.confirm('A proposta substitui o rascunho atual, que tem alterações não salvas. Continuar?')) return;
      t.disabled = true; t.textContent = 'Reescrevendo e medindo…';
      try { const j = await api('/api/estudio/reescrever', { method: 'POST', body: { dia: S.dia, reel: S.sel, instrucao: inst } });
        if (!j.ok) { toast('A proposta do modelo foi barrada pelas travas e não foi carregada', true); const el = $('#b-painel'); el.insertAdjacentHTML('beforeend', `<ul class="lista-prob">${j.problemas.filter((x) => x.tipo === 'bloqueia').map((x) => `<li class="bloqueia"><b>BARRADO</b>${esc(x.detalhe)}</li>`).join('')}</ul>`); }
        else { S.rascunho = j.reel; S.medida = { medidas: j.medidas, problemas: j.problemas, timeline: j.timeline, ok: true }; S.sujo = true; S._viaIa = true; S.aba = 'roteiro'; const sel = S.sel; pintarBancada(); S.sel = sel; toast('Proposta carregada como rascunho. Confira a prévia e salve se gostar.'); } }
      catch (e) { toast(e.message, true); } finally { const b = $('[data-a="ia-reescrever"]'); if (b) { b.disabled = false; b.textContent = 'Reescrever e medir'; } }
      return; }
  });
  document.addEventListener('input', (ev) => {
    const t = ev.target;
    if (t.id === 'lab-t') return medirLab();
    if (t.id === 'lab-leg') return medirLabLegenda();
    if (t.closest && t.closest('#b-painel') && (t.closest('.linha-ed') || t.id === 'ed-leg' || t.id === 'ed-tags')) mexeu();
  });
  document.addEventListener('change', (ev) => { if (ev.target.id === 'q-arq') lerImagem(ev.target.files[0]); });
  document.addEventListener('dragover', (ev) => { const s = ev.target.closest && ev.target.closest('#solta'); if (s) { ev.preventDefault(); s.classList.add('sobre'); } });
  document.addEventListener('dragleave', (ev) => { const s = ev.target.closest && ev.target.closest('#solta'); if (s) s.classList.remove('sobre'); });
  document.addEventListener('drop', (ev) => { const s = ev.target.closest && ev.target.closest('#solta'); if (s) { ev.preventDefault(); s.classList.remove('sobre'); lerImagem(ev.dataTransfer.files[0]); } });
  document.addEventListener('click', (ev) => { const p = ev.target.closest('#pistas'); if (!p || !S.player) return; const faixa = p.querySelector('.pista > div').getBoundingClientRect(); const f = Math.max(0, Math.min(1, (ev.clientX - faixa.left) / faixa.width)); S.player.ir(f * (S.medida.timeline.total || 0)); });
  $('#btn-gerar').addEventListener('click', gerar);
  $('#btn-link').addEventListener('click', () => { if (S.dados && S.dados.link) copiar(S.dados.link, 'Link da página do Julien copiado'); else { toast('Sem link: falta CHAUFFEUR_CONFIRMA_URL na Central. Veja Sistema.', true); } });
  $('#dia-ant').addEventListener('click', () => trocarDia(1)); $('#dia-prox').addEventListener('click', () => trocarDia(-1));
  function trocarDia(passo) { const i = S.dias.findIndex((d) => d.dia === S.dia); const alvo = S.dias[i + passo]; if (!alvo) return; if (S.sujo && !window.confirm('Há alterações não salvas. Descartar?')) return; S.dia = alvo.dia; S.dados = null; rota(); }
  $('#gate-form').addEventListener('submit', (e) => { e.preventDefault(); S.token = $('#gate-key').value.trim(); try { localStorage.setItem('mc_key', S.token); } catch { /* sem armazenamento */ } portao(false); iniciar(); });
  window.addEventListener('hashchange', rota);
  window.addEventListener('beforeunload', (e) => { if (S.sujo) { e.preventDefault(); e.returnValue = ''; } });

  async function iniciar() { try { await carregarBase(); await rota(); } catch (e) { if (e.status !== 401) $('#view').innerHTML = `<div class="vazio"><h3>A Central não respondeu</h3><p>${esc(e.message)}</p><button class="btn" type="button" data-a="recarregar">Tentar de novo</button></div>`; } }
  iniciar();
})();
