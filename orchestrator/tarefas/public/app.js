/* COMPASSO Tarefas — interface. Fala só com /api/*. Sem build, sem framework.
   Três regras guiam este arquivo:
     1. Toda ação aparece na hora. A tela muda antes da resposta do servidor; se o servidor recusar, volta e explica.
     2. Nada se perde. Tudo salva sozinho, campo a campo; dois editando se somam; toda ação tem Desfazer.
     3. O teclado alcança tudo, e o celular também. Arrastar é atalho, nunca o único caminho. */
(function () {
  'use strict';
  const N = window.COMPASSO_NUCLEO;
  const I18N = window.COMPASSO_I18N || { pt: {} };
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => [...(el || document).querySelectorAll(s)];
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const guardar = (k, v) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* opcional */ } };
  const ler = (k) => { try { return localStorage.getItem(k); } catch { return null; } };

  // ---------- idioma ----------
  let LANG = 'pt';
  const salva = ler('compasso-lang');
  if (I18N[salva]) LANG = salva; else if (/^fr/i.test(navigator.language || '')) LANG = 'fr';
  const t = (k, vars) => { let s = (I18N[LANG] && I18N[LANG][k]) ?? (I18N.pt[k] ?? k); if (vars) for (const [a, b] of Object.entries(vars)) s = s.split(`{${a}}`).join(b); return s; };
  const pl = (k, n, vars) => { const [s, p] = t(k).split('|'); let r = n === 1 ? s : (p || s); r = r.split('{n}').join(n); if (vars) for (const [a, b] of Object.entries(vars)) r = r.split(`{${a}}`).join(b); return r; };
  const MO = () => I18N[LANG]._months; const WD = () => I18N[LANG]._weekdays;
  const COLS = () => [['todo', t('col_todo')], ['doing', t('col_doing')], ['wait', t('col_wait')], ['done', t('col_done')]];
  const colLabel = (k) => (COLS().find((c) => c[0] === k) || [k, k])[1];
  const areaLabel = (a) => t('area_' + a);
  const canalLabel = (c) => (c ? t('canal_' + c) : t('canal_none'));
  function aplicarIdioma() {
    document.documentElement.lang = I18N[LANG]._lang || LANG;
    $$('[data-i]').forEach((el) => { el.textContent = t(el.dataset.i); });
    $$('[data-i-ph]').forEach((el) => { el.placeholder = t(el.dataset.iPh); });
    $$('[data-i-title]').forEach((el) => { el.title = t(el.dataset.iTitle); });
    $$('.lang button').forEach((b) => b.classList.toggle('on', b.dataset.l === LANG));
  }
  function mudarIdioma(l) {
    LANG = l || (LANG === 'pt' ? 'fr' : 'pt'); guardar('compasso-lang', LANG); aplicarIdioma();
    if (S.eu) { pintarAgora(); carregarChat(); renderFiltroDir(); if (D.aberto) pintarEditor(); }
  }

  const S = { eu: null, pessoas: [], areas: [], canais: [], prioridades: [], repeticoes: [], fuso: N.FUSO_PADRAO, modelo: '', tarefas: [], arquivadas: 0, resumo: null, seq: 0, hoje: N.hoje(), normalizados: new Set(), vista: 'hoje', who: 'all', busca: '', area: '', calInicio: null, sug: { itens: [] }, novidades: [], desfazer: null };
  const PESSOAS = () => Object.fromEntries(S.pessoas.map((p) => [p.id, p.nome]));
  const nomeDe = (q) => { const base = String(q || '').split(' ')[0]; const n = PESSOAS()[base] || (base === 'admin' ? 'Admin' : base); return /via Claude$/.test(String(q)) ? `${n} (${t('via_claude')})` : n; };
  const minhaPessoa = () => (S.eu && PESSOAS()[S.eu.id] ? S.eu.id : S.who !== 'all' ? S.who : null);
  const porId = (id) => S.tarefas.find((x) => x.id === id);
  const clone = (o) => JSON.parse(JSON.stringify(o));

  // ---------- API ----------
  async function api(metodo, rota, corpo) {
    const r = await fetch(rota, { method: metodo, headers: { 'content-type': 'application/json', 'x-requested-with': 'fetch' }, body: corpo ? JSON.stringify(corpo) : undefined, credentials: 'same-origin' });
    let j = {}; try { j = await r.json(); } catch { /* sem corpo */ }
    if (r.status === 401 && rota !== '/api/login') { mostrarLogin(); throw new Error(t('session_expired')); }
    if (r.status === 403 && j.trocar_senha) { mostrarTroca(true, S.eu); throw new Error(t('pw_needed')); }
    if (!r.ok) { const e = new Error(j.erro || `erro ${r.status}`); e.status = r.status; e.dados = j; throw e; }
    return j;
  }

  // ---------- datas ----------
  const dataDe = (iso) => new Date(iso + 'T00:00:00');
  const hora = (ts) => { const d = new Date(ts); const p = (n) => String(n).padStart(2, '0'); return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`; };
  const fmtCurto = (d) => { if (!d) return t('no_date'); const x = dataDe(d); return `${x.getDate()} ${MO()[x.getMonth()]}`; };
  function fmt(d) {
    if (!d) return t('no_date');
    const dif = N.diasEntre(S.hoje, d);
    if (dif === 0) return t('today'); if (dif === 1) return t('tomorrow'); if (dif === -1) return t('yesterday');
    if (dif > 1 && dif < 7) return `${WD()[N.diaDaSemana(d)]} ${dataDe(d).getDate()}`;
    return fmtCurto(d);
  }
  const dueClass = (x) => { if (!x.vence_em || x.estado === 'done') return ''; const dif = N.diasEntre(S.hoje, x.vence_em); return dif < 0 ? 'late' : dif < 2 ? 'soon' : ''; };
  const proximoDia = (semana) => { let dif = (semana - N.diaDaSemana(S.hoje) + 7) % 7; if (dif === 0) dif = 7; return N.somarDias(S.hoje, dif); };
  const segundaDe = (iso) => N.somarDias(iso, -((N.diaDaSemana(iso) + 6) % 7));

  // ---------- pedaços de HTML ----------
  const av = (w, xs) => { const n = PESSOAS()[w] || (w === 'admin' ? 'Admin' : '?'); return `<span class="av ${esc(w)} ${xs ? 'xs' : ''}" title="${esc(n)}">${esc(n.slice(0, 2).toUpperCase())}</span>`; };
  const prioMark = (x) => (x.prioridade === 'alta' ? `<span class="prio alta" title="${esc(t('prio_mark_alta'))}">!</span>` : x.prioridade === 'baixa' ? `<span class="prio baixa" title="${esc(t('prio_mark_baixa'))}">·</span>` : '');
  const proxEtapa = (x) => (x.etapas || []).find((e) => !e.feita);
  const feitas = (x) => (x.etapas || []).filter((e) => e.feita).length;
  const dueHtml = (x) => { const dc = dueClass(x); return `<span class="due ${dc}">${fmt(x.vence_em)}</span>`; };
  function esperaHtml(x) {
    if (x.estado !== 'wait') return '';
    const quem = x.aguardando_quem ? t('waiting_for', { q: esc(x.aguardando_quem) }) : '';
    const quando = x.cobrar_em ? t('chase_on', { d: fmt(x.cobrar_em) }) : t('chase_none');
    return `<span class="espera">${[quem, quando].filter(Boolean).join(' · ')}</span>`;
  }

  function cardHtml(x) {
    const paradaDias = x.estado !== 'done' && x.atualizado_em ? Math.floor((Date.now() - Date.parse(x.atualizado_em)) / 864e5) : 0;
    const extra = [esperaHtml(x), x.repete ? `<span title="${esc(t('rep_' + x.repete))}">↻ ${esc(t('rep_' + x.repete))}</span>` : '', (x.comentarios || []).length ? `<span>✎ ${x.comentarios.length}</span>` : '', paradaDias >= 7 ? `<span>${esc(t('stale', { n: paradaDias }))}</span>` : '', S.normalizados.has(x.id) ? `<span class="normal-tag" title="${esc(t('sinal_ok'))}">✓ ${esc(t('sinal_curto'))}</span>` : ''].filter(Boolean).join('');
    const nEt = (x.etapas || []).length;
    return `<div class="card${x.estado === 'done' ? ' done' : ''}${x.prioridade === 'alta' && x.estado !== 'done' ? ' hot' : ''}${x._temp ? ' salvando' : ''}" role="button" tabindex="0" ${x._temp ? '' : 'draggable="true"'} data-id="${esc(x.id)}">
      <span class="hd"><span class="tag">${esc(areaLabel(x.area))}${x.cidade ? ` · ${esc(x.cidade)}` : ''}</span><span style="display:inline-flex;align-items:center;gap:3px">${prioMark(x)}<button class="tres" type="button" data-menu aria-label="…">⋯</button></span></span>
      <span class="t">${esc(x.titulo)}</span>
      ${x.referencia ? `<span class="ref">${esc(x.referencia)}</span>` : ''}
      ${extra ? `<span class="extra">${extra}</span>` : ''}
      <span class="m"><span>${av(x.dono, true)} ${esc(PESSOAS()[x.dono] || x.dono)}${x.canal ? ` · ${esc(canalLabel(x.canal))}` : ''}</span>${dueHtml(x)}</span>
      ${nEt ? `<span class="steps" title="${feitas(x)} ${esc(t('of'))} ${nEt} ${esc(pl('steps', nEt))}"><i style="width:${(feitas(x) / nEt) * 100}%"></i></span>` : ''}
    </div>`;
  }

  function linhaHtml(x, comDono) {
    const prox = proxEtapa(x);
    const meta = [areaLabel(x.area), x.cidade, x.referencia, x.canal ? canalLabel(x.canal) : ''].filter(Boolean).map((m) => `<span>${esc(m)}</span>`).join('');
    return `<div class="linha${x.prioridade === 'alta' ? ' quente' : ''}" role="button" tabindex="0" data-id="${esc(x.id)}">
      <button class="ck" type="button" data-ck aria-label="${esc(t('complete'))}" title="${esc(t('complete'))}"></button>
      <div class="corpo"><span class="t">${prioMark(x)} ${esc(x.titulo)}</span>
        ${prox ? `<button class="prox" type="button" data-prox="${esc(prox.id)}" title="${esc(t('mark_step'))}"><b>${esc(t('next_step'))}</b><span>${esc(prox.texto)}</span></button>` : ''}
        <span class="s">${meta}${esperaHtml(x)}${S.normalizados.has(x.id) ? `<span class="normal-tag">${esc(t('sinal_ok'))}</span>` : ''}</span>
      </div>
      <div class="lado">${dueHtml(x)}${comDono ? av(x.dono) : ''}<button class="tres" type="button" data-menu aria-label="…">⋯</button></div>
    </div>`;
  }

  // ---------- mudanças: a tela responde antes do servidor ----------
  const CAMPOS_BASE = ['titulo', 'area', 'dono', 'vence_em', 'estado', 'notas', 'prioridade', 'cidade', 'canal', 'referencia', 'resultado', 'aguardando_quem', 'cobrar_em', 'repete'];
  const pendentes = new Map(); // id → envios em andamento; o eco do tempo real não pisa no que a pessoa acabou de fazer
  const filas = new Map();

  function aplicarOpsLocal(etapas, ops) {
    const l = (etapas || []).map((e) => ({ ...e }));
    for (const op of ops) {
      const i = l.findIndex((e) => e.id === op.id);
      if (op.op === 'marcar' && i >= 0) l[i].feita = op.feita;
      else if (op.op === 'texto' && i >= 0) l[i].texto = op.texto;
      else if (op.op === 'del' && i >= 0) l.splice(i, 1);
      else if (op.op === 'add') { const a = l.findIndex((e) => e.id === op.apos); const n = { id: op.novo_id, texto: op.texto, feita: false }; if (a >= 0) l.splice(a + 1, 0, n); else l.push(n); }
      else if (op.op === 'mover' && i >= 0) { const [e] = l.splice(i, 1); l.splice(Math.max(0, Math.min(l.length, op.para)), 0, e); }
    }
    return l;
  }
  function aplicarLocal(x, patch) {
    if (patch.etapas_ops) x.etapas = aplicarOpsLocal(x.etapas, patch.etapas_ops);
    for (const [k, v] of Object.entries(patch)) if (k !== 'etapas_ops') x[k] = v;
    if (patch.estado === 'done') { x.concluido_em = x.concluido_em || new Date().toISOString(); x.etapas = (x.etapas || []).map((e) => ({ ...e, feita: true })); }
    else if (patch.estado) { x.concluido_em = null; x.arquivada_em = null; }
    if (patch.estado && patch.estado !== 'wait' && patch.aguardando_quem === undefined) { x.aguardando_quem = ''; x.cobrar_em = null; }
    x.atualizado_em = new Date().toISOString();
  }
  function substituir(n) {
    const i = S.tarefas.findIndex((x) => x.id === n.id);
    if (n.arquivada_em) { if (i >= 0) { S.tarefas.splice(i, 1); S.arquivadas += 1; } }
    else if (i >= 0) S.tarefas[i] = n; else S.tarefas.unshift(n);
    if (D.aberto && D.t && D.t.id === n.id) { D.t = n; sincronizarEditor(); }
    guardarCache();
  }
  /** Muda um card. Volta sozinho se o servidor recusar; 409 = outra pessoa mudou o mesmo campo, fica o valor atual. */
  function mutar(id, patch, opts = {}) {
    const x = porId(id) || (D.t && D.t.id === id ? D.t : null);
    if (!x || x._temp) return Promise.resolve(null); // card ainda sem id de verdade não aceita ação
    const antes = clone(x);
    const base = {}; for (const k of Object.keys(patch)) if (CAMPOS_BASE.includes(k)) base[k] = x[k] ?? null;
    if (opts.base) Object.assign(base, opts.base); // o que a pessoa viu quando começou a editar, não o que chegou depois
    aplicarLocal(x, patch);
    S.animar = !!opts.animar;
    pintar();
    pendentes.set(id, (pendentes.get(id) || 0) + 1);
    estadoSalvo('saving');
    if (opts.rotulo) {
      const volta = () => mutar(id, inverso(antes, patch), {});
      S.desfazer = volta;
      toast(opts.rotulo, { acao: t('undo'), fn: () => { volta(); toast(t('undone')); } });
    }
    const envio = () => api('PATCH', `/api/tarefas/${id}`, { ...patch, base });
    const fila = (filas.get(id) || Promise.resolve()).then(envio, envio);
    const fim = fila.then((r) => { const resta = (pendentes.get(id) || 1) - 1; if (resta <= 0) { pendentes.delete(id); substituir(r.tarefa); } else pendentes.set(id, resta); estadoSalvo(resta > 0 ? 'saving' : 'saved'); pintar(); return r.tarefa; }).catch((e) => {
      pendentes.delete(id);
      if (e.status === 409 && e.dados && e.dados.tarefa) { substituir(e.dados.tarefa); toast(t('conflict', { p: t('someone') })); }
      else { substituir(antes); toast(e.message); }
      estadoSalvo('saved'); pintar();
      return null;
    });
    filas.set(id, fim);
    return fim;
  }
  function inverso(antes, patch) {
    const v = {};
    for (const k of Object.keys(patch)) { if (k === 'etapas_ops') v.etapas = antes.etapas; else v[k] = antes[k] ?? (k === 'vence_em' || k === 'cobrar_em' ? null : ''); }
    if (patch.estado && antes.estado === 'wait') { v.aguardando_quem = antes.aguardando_quem || ''; v.cobrar_em = antes.cobrar_em || null; }
    return v;
  }
  /** Mudar de status passa por aqui: concluir pede o resultado; aguardando pede de quem e quando cobrar. Nada disso trava. */
  function moverPara(id, estado, opts = {}) {
    const x = porId(id) || (D.t && D.t.id === id ? D.t : null);
    if (!x || x._temp || x.estado === estado) return;
    const titulo = x.titulo.length > 42 ? x.titulo.slice(0, 40) + '…' : x.titulo;
    mutar(id, { estado }, { animar: true, rotulo: t('moved', { t: titulo, c: colLabel(estado) }) });
    if (opts.semFolha) return;
    if (estado === 'done' && !x.resultado) folhaResultado(id);
    else if (estado === 'wait') folhaEspera(id);
    else fecharFolha();
  }

  // ---------- pintura ----------
  let rafPintura = 0;
  const pintar = () => {
    if (rafPintura) return;
    const rodar = () => { rafPintura = 0; pintarAgora(); };
    rafPintura = document.hidden ? setTimeout(rodar, 50) : requestAnimationFrame(rodar); // aba escondida não pinta quadro, mas o contador do título segue vivo
  };
  function pintarAgora() {
    if (!S.eu) return;
    const foco = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.id : null;
    renderFiltros();
    if (S.vista === 'hoje') renderHoje();
    else if (S.vista === 'quadro') renderBoard();
    else if (S.vista === 'calendario') renderCal();
    renderRodape();
    if (foco) { const el = $(`.view.on [data-id="${CSS.escape(foco)}"]`); if (el) el.focus({ preventScroll: true }); }
  }
  function renderRodape() {
    const abertas = S.tarefas.filter((x) => x.estado !== 'done').length;
    const atrasadas = S.tarefas.filter((x) => dueClass(x) === 'late').length;
    const r = S.resumo || {};
    const pz = r.no_prazo_30d_pct === null || r.no_prazo_30d_pct === undefined ? '' : t('footer_pz', { p: r.no_prazo_30d_pct });
    $('#rodape').textContent = t('footer', { a: abertas, l: atrasadas, d: r.concluidas_7d ?? 0, pz });
    $('#arcCount').textContent = S.arquivadas;
    $$('[data-v]').forEach((b) => b.classList.toggle('on', b.dataset.v === S.vista));
    $$('.view').forEach((v) => v.classList.toggle('on', v.id === 'v-' + S.vista));
    document.title = atrasadas ? `(${atrasadas}) COMPASSO` : 'COMPASSO';
  }
  function renderFiltros() {
    const conta = (id) => S.tarefas.filter((x) => x.estado !== 'done' && x.dono === id).length;
    const novo = `<button class="chip txt ${S.who === 'all' ? 'on' : ''}" type="button" data-w="all">${esc(t('all'))}</button>` + S.pessoas.map((p) => `<button class="chip ${S.who === p.id ? 'on' : ''}" type="button" data-w="${esc(p.id)}">${av(p.id, true)}${esc(p.nome)} <b>${conta(p.id)}</b></button>`).join('');
    if (renderFiltros.ultimo !== novo) { renderFiltros.ultimo = novo; $('#whoFilter').innerHTML = novo; }
  }
  function renderFiltroDir() {
    const box = $('#filtroDir');
    if (S.vista !== 'quadro') { box.innerHTML = ''; return; }
    box.innerHTML = `<input id="fBusca" type="search" aria-label="${esc(t('search_hint'))}" placeholder="${esc(t('search_hint'))}" value="${esc(S.busca)}"><select id="fArea" aria-label="${esc(t('f_area'))}"><option value="">${esc(t('f_area'))}</option>${S.areas.map((a) => `<option value="${esc(a)}" ${S.area === a ? 'selected' : ''}>${esc(areaLabel(a))}</option>`).join('')}</select>`;
    $('#fBusca').addEventListener('input', (e) => { S.busca = e.target.value; renderBoard(); });
    $('#fArea').addEventListener('change', (e) => { S.area = e.target.value; renderBoard(); });
  }
  $('#whoFilter').addEventListener('click', (e) => { const b = e.target.closest('[data-w]'); if (!b) return; S.who = b.dataset.w; guardar('compasso-who', S.who); pintarAgora(); carregarNovidades(); });

  // ---------- hoje ----------
  function renderHoje() {
    const f = N.foco(S.tarefas, S.who, S.hoje);
    const h = new Date().getHours();
    const ola = t(h < 12 ? 'hello_m' : h < 18 ? 'hello_a' : 'hello_e');
    const nome = S.who !== 'all' ? PESSOAS()[S.who] : (PESSOAS()[S.eu.id] || '');
    const d = dataDe(S.hoje);
    $('#diaCab').innerHTML = `<h1>${esc(ola)}${nome ? `, ${esc(nome)}` : ''}</h1><p>${esc(I18N[LANG]._weekdaysLong[d.getDay()])}, ${d.getDate()} ${esc(I18N[LANG]._monthsLong[d.getMonth()])} · ${esc(t('sum_line', { a: f.agora.length, h: f.hoje.length, c: f.cobrar.length }))}</p>`;
    const comDono = S.who === 'all';
    const secao = (classe, titulo, sub, lista) => (lista.length ? `<section class="secao ${classe}"><h2>${esc(titulo)} <i>${lista.length}</i>${sub ? ` <small>${esc(sub)}</small>` : ''}</h2><div class="linhas">${lista.map((x) => linhaHtml(x, comDono)).join('')}</div></section>` : '');
    const html = [secao('agora', t('sec_now'), t('sec_now_sub'), f.agora), secao('', t('sec_chase'), t('sec_chase_sub'), f.cobrar), secao('', t('sec_today'), '', f.hoje), secao('', t('sec_doing'), '', f.andamento), secao('', t('sec_next'), '', f.aSeguir), secao('', t('sec_waiting'), t('sec_waiting_sub'), f.esperando)].join('');
    const vazio = !f.agora.length && !f.cobrar.length && !f.hoje.length && !f.andamento.length && !f.aSeguir.length;
    $('#secoes').innerHTML = (vazio ? `<div class="zero"><b>${esc(t('zero_title'))}</b><span>${esc(t('zero_sub'))}</span>${S.sug.itens.length ? `<button class="btn sug-btn sm" type="button" data-abrir-sug>${esc(t('sug'))} ${S.sug.itens.length}</button>` : ''}</div>` : '') + html;
  }

  // ---------- quadro ----------
  function filtradaQuadro(x) {
    if (S.who !== 'all' && x.dono !== S.who) return false;
    if (S.area && x.area !== S.area) return false;
    const q = S.busca.trim().toLowerCase();
    if (!q) return true;
    return [x.id, x.titulo, x.referencia, x.cidade, x.notas, x.resultado, ...(x.comentarios || []).map((c) => c.texto), ...(x.etapas || []).map((e) => e.texto)].join(' ').toLowerCase().includes(q);
  }
  const FEITAS_VISIVEIS = 12;
  function renderBoard() {
    const board = $('#board');
    const anima = S.animar && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const antes = new Map();
    if (anima) $$('.card', board).forEach((c) => antes.set(c.dataset.id, c.getBoundingClientRect()));
    S.animar = false;
    const rolagens = new Map($$('.col', board).map((c) => [c.dataset.st, c.scrollTop]));
    let html = '';
    for (const [key, label] of COLS()) {
      const lista = S.tarefas.filter((x) => x.estado === key && filtradaQuadro(x));
      lista.sort(key === 'done' ? (a, b) => String(b.concluido_em).localeCompare(String(a.concluido_em)) : (a, b) => (a.prioridade === 'alta' ? 0 : 1) - (b.prioridade === 'alta' ? 0 : 1) || String(a.vence_em || '9999').localeCompare(String(b.vence_em || '9999')));
      const visiveis = key === 'done' && !S.verTodasFeitas ? lista.slice(0, FEITAS_VISIVEIS) : lista;
      const limite = N.somarDias(S.hoje, -7);
      const velhas = key === 'done' ? lista.filter((x) => x.concluido_em && x.concluido_em.slice(0, 10) < limite).length : 0;
      html += `<div class="col" data-st="${key}"><h2>${esc(label)}<span style="display:inline-flex;gap:6px;align-items:center"><i>${lista.length}</i>${key === 'todo' ? `<button type="button" data-novo aria-label="${esc(t('new_task'))}" title="${esc(t('new_task'))}">+</button>` : ''}</span></h2>${visiveis.map(cardHtml).join('')}${lista.length > visiveis.length ? `<button class="mais-feitas" type="button" data-ver-feitas>${esc(t('more_done', { n: lista.length - visiveis.length }))}</button>` : ''}${velhas ? `<button class="mais-feitas" type="button" data-arquivar-velhas>${esc(t('archive_old', { n: velhas }))}</button>` : ''}</div>`;
    }
    board.innerHTML = html;
    $$('.col', board).forEach((c) => { c.scrollTop = rolagens.get(c.dataset.st) || 0; });
    if (anima) $$('.card', board).forEach((c) => { const a = antes.get(c.dataset.id); if (!a) return; const b = c.getBoundingClientRect(); const dx = a.left - b.left, dy = a.top - b.top; if (dx || dy) c.animate([{ transform: `translate(${dx}px,${dy}px)` }, { transform: 'none' }], { duration: 170, easing: 'cubic-bezier(.2,.7,.2,1)' }); });
  }

  // ---------- calendário ----------
  const SEMANAS = 5;
  function renderCal() {
    const inicio = S.calInicio || segundaDe(S.hoje);
    const dias = Array.from({ length: SEMANAS * 7 }, (_, i) => N.somarDias(inicio, i));
    const meio = dataDe(dias[Math.floor(dias.length / 2)]);
    $('#calTitulo').textContent = `${I18N[LANG]._monthsLong[meio.getMonth()]} ${meio.getFullYear()}`;
    const abertas = S.tarefas.filter((x) => x.estado !== 'done' && (S.who === 'all' || x.dono === S.who));
    const chip = (x) => `<button class="cchip ${esc(x.dono)}${x.prioridade === 'alta' ? ' alta' : ''}" type="button" draggable="true" data-id="${esc(x.id)}" title="${esc(x.titulo)} · ${esc(PESSOAS()[x.dono] || '')}">${x.prioridade === 'alta' ? prioMark(x) : ''}<span>${esc(x.titulo)}</span></button>`;
    const late = abertas.filter((x) => dueClass(x) === 'late').sort((a, b) => a.vence_em.localeCompare(b.vence_em));
    const semData = abertas.filter((x) => !x.vence_em);
    $('#bandejas').innerHTML = (late.length ? `<div class="bandeja late"><b>${esc(t('tray_late'))} ${late.length}</b>${late.slice(0, 8).map(chip).join('')}</div>` : '') + (semData.length ? `<div class="bandeja"><b>${esc(t('tray_nodate'))} ${semData.length}</b>${semData.slice(0, 8).map(chip).join('')}</div>` : '');
    const cab = [1, 2, 3, 4, 5, 6, 0].map((d) => `<div class="gd-cab">${esc(WD()[d])}</div>`).join('');
    $('#grade').innerHTML = cab + dias.map((d) => {
      const itens = abertas.filter((x) => x.vence_em === d);
      const dt = dataDe(d);
      const fds = [0, 6].includes(dt.getDay());
      return `<div class="gd${d === S.hoje ? ' hoje' : ''}${fds ? ' fds' : ''}${d < S.hoje ? ' fora' : ''}" data-dia="${d}"><span class="gd-n">${dt.getDate()}${dt.getDate() === 1 ? ` ${esc(MO()[dt.getMonth()])}` : ''}</span>${itens.map(chip).join('')}</div>`;
    }).join('');
    // Celular: lista dos próximos 14 dias, sem grade.
    const feed = [];
    if (late.length) feed.push({ lab: t('tray_late'), sub: String(late.length), late: true, itens: late });
    for (let i = 0; i < 14; i++) { const k = N.somarDias(S.hoje, i); const itens = abertas.filter((x) => x.vence_em === k); if (itens.length) feed.push({ lab: fmtCurto(k), sub: i === 0 ? t('today') : i === 1 ? t('tomorrow') : WD()[N.diaDaSemana(k)], itens }); }
    if (semData.length) feed.push({ lab: t('tray_nodate'), sub: t('define'), itens: semData });
    $('#feed').innerHTML = feed.map((g) => `<div class="fday"><div class="lab ${g.late ? 'late' : ''}">${esc(g.lab)}<small>${esc(g.sub)}</small></div><div class="linhas">${g.itens.map((x) => linhaHtml(x, S.who === 'all')).join('')}</div></div>`).join('') || `<div class="zero"><b>${esc(t('zero_title'))}</b></div>`;
  }
  $('#calPrev').addEventListener('click', () => { S.calInicio = N.somarDias(S.calInicio || segundaDe(S.hoje), -28); renderCal(); });
  $('#calNext').addEventListener('click', () => { S.calInicio = N.somarDias(S.calInicio || segundaDe(S.hoje), 28); renderCal(); });
  $('#calHoje').addEventListener('click', () => { S.calInicio = null; renderCal(); });

  // ---------- arrastar (mouse). No celular, o menu ⋯ faz o mesmo. ----------
  document.addEventListener('dragstart', (e) => {
    const c = e.target.closest && e.target.closest('[draggable="true"][data-id]');
    if (!c) return;
    e.dataTransfer.setData('text/plain', c.dataset.id); e.dataTransfer.effectAllowed = 'move';
    requestAnimationFrame(() => c.classList.add('arrastando'));
  });
  document.addEventListener('dragend', (e) => { const c = e.target.closest && e.target.closest('[data-id]'); if (c) c.classList.remove('arrastando'); $$('.over').forEach((x) => x.classList.remove('over')); });
  document.addEventListener('dragover', (e) => {
    const alvo = e.target.closest && e.target.closest('.col, .gd');
    if (!alvo) return;
    e.preventDefault();
    if (!alvo.classList.contains('over')) { $$('.over').forEach((x) => x.classList.remove('over')); alvo.classList.add('over'); }
  });
  document.addEventListener('drop', (e) => {
    const alvo = e.target.closest && e.target.closest('.col, .gd');
    if (!alvo) return;
    e.preventDefault(); alvo.classList.remove('over');
    const id = e.dataTransfer.getData('text/plain'); const x = porId(id);
    if (!x) return;
    if (alvo.classList.contains('col')) moverPara(id, alvo.dataset.st);
    else if (x.vence_em !== alvo.dataset.dia) mutar(id, { vence_em: alvo.dataset.dia }, { rotulo: `${t('f_due')} ${fmt(alvo.dataset.dia)}` });
  });

  // ---------- cliques (delegados) ----------
  document.addEventListener('click', (e) => {
    const el = e.target;
    const lang = el.closest('.lang [data-l]');
    if (lang) { if (lang.dataset.l !== LANG) mudarIdioma(lang.dataset.l); return; }
    const vista = el.closest('[data-v]');
    if (vista && !el.closest('.drawer')) { irPara(vista.dataset.v); return; }
    if (!el.closest('#menu') && !el.closest('[data-menu]')) fecharMenu();
    if (!el.closest('#novi') && !el.closest('#noviBtn')) $('#novi').hidden = true;
    if (el.closest('[data-abrir-sug]')) { abrirSugestoes(false); return; }
    if (el.closest('[data-novo]')) { abrirEditor(null); return; }
    if (el.closest('[data-ver-feitas]')) { S.verTodasFeitas = true; renderBoard(); return; }
    if (el.closest('[data-arquivar-velhas]')) { arquivarVelhas(); return; }
    const menu = el.closest('[data-menu]');
    if (menu) { const c = menu.closest('[data-id]'); if (c) abrirMenuCard(c.dataset.id, menu.getBoundingClientRect()); e.stopPropagation(); return; }
    const ck = el.closest('[data-ck]');
    if (ck) { const c = ck.closest('[data-id]'); if (c) moverPara(c.dataset.id, 'done'); return; }
    const prox = el.closest('[data-prox]');
    if (prox) { const c = prox.closest('[data-id]'); const x = c && porId(c.dataset.id); if (x) mutar(x.id, { etapas_ops: [{ op: 'marcar', id: prox.dataset.prox, feita: true }] }); return; }
    const dia = el.closest('.gd');
    const item = el.closest('.card[data-id], .linha[data-id], .cchip[data-id], .rlinha[data-id], .nov[data-id]');
    if (item && !item.classList.contains('salvando') && !el.closest('.drawer')) { $('#novi').hidden = true; abrirEditor(item.dataset.id); return; }
    if (dia) { abrirEditor(null, { vence_em: dia.dataset.dia }); }
  });
  async function arquivarVelhas() {
    const limite = N.somarDias(S.hoje, -7);
    const velhas = S.tarefas.filter((x) => x.estado === 'done' && x.concluido_em && x.concluido_em.slice(0, 10) < limite);
    for (const x of velhas) { try { substituir((await api('POST', `/api/tarefas/${x.id}/arquivar`, {})).tarefa); } catch (e) { toast(e.message); break; } }
    toast(t('archived_ok')); pintar();
  }

  // ---------- menu do card (status, data, dono) ----------
  const menu = $('#menu');
  function fecharMenu() { menu.hidden = true; }
  function abrirMenuCard(id, r) {
    const x = porId(id); if (!x || x._temp) return;
    const sexta = proximoDia(5), segunda = proximoDia(1);
    menu.innerHTML = COLS().map(([k, v], i) => `<button type="button" role="menuitem" data-m="estado:${k}" class="${x.estado === k ? 'ativo' : ''}"><kbd>${i + 1}</kbd>${esc(v)}</button>`).join('') + '<hr>'
      + [['due_today', S.hoje], ['due_tomorrow', N.somarDias(S.hoje, 1)], ['due_friday', sexta], ['due_monday', segunda], ['due_none', '']].map(([k, d]) => `<button type="button" role="menuitem" data-m="vence:${d}" class="${(x.vence_em || '') === d ? 'ativo' : ''}">${esc(t(k))}${d ? ` <small style="margin-left:auto;color:var(--muted)">${esc(fmtCurto(d))}</small>` : ''}</button>`).join('') + '<hr>'
      + S.pessoas.map((p) => `<button type="button" role="menuitem" data-m="dono:${esc(p.id)}" class="${x.dono === p.id ? 'ativo' : ''}">${av(p.id, true)}${esc(p.nome)}</button>`).join('');
    menu.hidden = false;
    const w = menu.offsetWidth, h = menu.offsetHeight;
    menu.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w))}px`;
    menu.style.top = `${r.bottom + h + 8 > window.innerHeight ? Math.max(8, r.top - h - 4) : r.bottom + 4}px`;
    menu.dataset.id = id;
    const primeiro = $('button', menu); if (primeiro) primeiro.focus({ preventScroll: true });
  }
  menu.addEventListener('click', (e) => {
    const b = e.target.closest('[data-m]'); if (!b) return;
    const [tipo, valor] = b.dataset.m.split(':'); const id = menu.dataset.id;
    fecharMenu();
    if (tipo === 'estado') moverPara(id, valor);
    else if (tipo === 'vence') mutar(id, { vence_em: valor || null }, { rotulo: `${t('f_due')} ${fmt(valor || null)}` });
    else if (tipo === 'dono') mutar(id, { dono: valor }, { rotulo: PESSOAS()[valor] });
  });
  menu.addEventListener('keydown', (e) => {
    const itens = $$('button', menu); const i = itens.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); itens[(i + 1) % itens.length].focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); itens[(i - 1 + itens.length) % itens.length].focus(); }
  });

  // ---------- folha: uma pergunta curta depois de mudar o status. Ignorar não atrapalha. ----------
  const folha = $('#folha');
  function fecharFolha() { folha.hidden = true; folha.innerHTML = ''; }
  function folhaResultado(id) {
    const x = porId(id); if (!x) return;
    folha.innerHTML = `<h4><span>${esc(t('result_q'))}</span></h4><input id="fhRes" type="text" maxlength="1000" placeholder="${esc(t('result_ph'))}"><div class="acts"><button class="btn ghost sm" type="button" id="fhNao">${esc(t('later'))}</button><button class="btn gold sm" type="button" id="fhOk">${esc(t('save'))}</button></div>`;
    folha.hidden = false;
    const inp = $('#fhRes'); inp.focus({ preventScroll: true });
    const ok = () => { const v = inp.value.trim(); if (v) mutar(id, { resultado: v }); fecharFolha(); };
    $('#fhOk').addEventListener('click', ok);
    $('#fhNao').addEventListener('click', fecharFolha);
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); ok(); } });
  }
  function folhaEspera(id) {
    const x = porId(id); if (!x) return;
    const quem = [t('w_rest'), t('w_hotel'), t('w_client'), t('w_driver')];
    const datas = [['d_tomorrow', 1], ['d_2', 2], ['d_week', 7]];
    let cobrar = x.cobrar_em || N.somarDias(S.hoje, 1);
    folha.innerHTML = `<h4><span>${esc(t('wait_q'))}</span></h4><input id="fhQ" type="text" maxlength="80" value="${esc(x.aguardando_quem || '')}" placeholder="${esc(t('f_wait_who_ph'))}"><div class="atalhos">${quem.map((q) => `<button type="button" data-q="${esc(q)}">${esc(q)}</button>`).join('')}</div><div class="atalhos">${datas.map(([k, n]) => `<button type="button" data-n="${n}">${esc(t(k))}</button>`).join('')}<input id="fhD" type="date" value="${esc(cobrar)}" style="width:auto;padding:1px 6px;font-size:12px"></div><div class="acts"><button class="btn ghost sm" type="button" id="fhNao">${esc(t('later'))}</button><button class="btn gold sm" type="button" id="fhOk">${esc(t('save'))}</button></div>`;
    folha.hidden = false;
    const inp = $('#fhQ'); inp.focus({ preventScroll: true });
    folha.onclick = (e) => {
      const q = e.target.closest('[data-q]'); if (q) { inp.value = q.dataset.q; inp.focus(); return; }
      const n = e.target.closest('[data-n]'); if (n) { cobrar = N.somarDias(S.hoje, Number(n.dataset.n)); $('#fhD').value = cobrar; }
    };
    const ok = () => { mutar(id, { aguardando_quem: inp.value.trim(), cobrar_em: $('#fhD').value || null }); fecharFolha(); };
    $('#fhOk').addEventListener('click', ok);
    $('#fhNao').addEventListener('click', fecharFolha);
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); ok(); } });
  }

  // ---------- captura rápida ----------
  const pillsDe = (a) => {
    const p = [];
    if (a.dono) p.push(`<span class="pill ouro">${av(a.dono, true)} ${esc(PESSOAS()[a.dono])}</span>`);
    if (a.vence_em) p.push(`<span class="pill ouro">${esc(fmt(a.vence_em))}</span>`);
    if (a.prioridade === 'alta') p.push(`<span class="pill alta">${esc(t('prio_alta'))}</span>`);
    if (a.prioridade === 'baixa') p.push(`<span class="pill">${esc(t('prio_baixa'))}</span>`);
    if (a.repete) p.push(`<span class="pill">↻ ${esc(t('rep_' + a.repete))}</span>`);
    if (a.cidade) p.push(`<span class="pill">${esc(a.cidade)}</span>`);
    if (a.canal) p.push(`<span class="pill">${esc(canalLabel(a.canal))}</span>`);
    if (a.referencia) p.push(`<span class="pill ref">${esc(a.referencia)}</span>`);
    p.push(`<span class="pill">${esc(areaLabel(a.area))}</span>`);
    return p.join('');
  };
  const donoInicial = (a) => a.dono || (a.dono_ambiguo ? null : (S.who !== 'all' ? S.who : (S.eu && PESSOAS()[S.eu.id] ? S.eu.id : null)));
  function previaRapida() {
    const v = $('#rapidoInput').value;
    const box = $('#rapidoPrevia');
    if (v.trim().length < 3) { box.innerHTML = ''; return; }
    const a = N.analisar(v, { hoje: S.hoje }); a.dono = donoInicial(a);
    const pedir = !a.dono ? `<span class="pill falta">${esc(t('quick_who'))}</span><span class="pick">${S.pessoas.map((p) => `<button type="button" data-rapido-dono="${esc(p.id)}">${av(p.id, true)}${esc(p.nome)}</button>`).join('')}</span>` : '';
    box.innerHTML = `${pedir}${pillsDe(a)}<button class="btn ghost sm" type="button" id="rapidoDetalhe" style="margin-left:auto">${esc(t('quick_detail'))}</button>`;
  }
  $('#rapidoInput').addEventListener('input', previaRapida);
  $('#rapidoPrevia').addEventListener('click', (e) => {
    const b = e.target.closest('[data-rapido-dono]');
    if (b) { criarDaFrase($('#rapidoInput').value, b.dataset.rapidoDono, () => { $('#rapidoInput').value = ''; previaRapida(); }); return; }
    if (e.target.closest('#rapidoDetalhe')) { const a = N.analisar($('#rapidoInput').value, { hoje: S.hoje }); a.dono = donoInicial(a); $('#rapidoInput').value = ''; previaRapida(); abrirEditor(null, a); }
  });
  $('#rapido').addEventListener('submit', (e) => {
    e.preventDefault();
    const v = $('#rapidoInput').value;
    if (v.trim().length < 3) return;
    const a = N.analisar(v, { hoje: S.hoje }); const dono = donoInicial(a);
    if (!dono) { previaRapida(); toast(t('pick_owner')); return; }
    criarDaFrase(v, dono, () => { $('#rapidoInput').value = ''; previaRapida(); $('#rapidoInput').focus(); });
  });
  /** Cria na hora: o card aparece antes da resposta; se o servidor recusar, some e o texto volta. */
  let tempN = 0;
  function criarDaFrase(frase, dono, depois) {
    const a = N.analisar(frase, { hoje: S.hoje });
    const corpo = { titulo: a.titulo, dono, vence_em: a.vence_em, prioridade: a.prioridade, cidade: a.cidade, canal: a.canal, referencia: a.referencia, area: a.area, repete: a.repete, estado: 'todo', etapas: [] };
    criarCard(corpo, frase);
    if (depois) depois();
  }
  function criarCard(corpo, fraseOriginal) {
    const temp = { ...corpo, id: `novo-${++tempN}`, _temp: true, etapas: corpo.etapas || [], comentarios: [], atualizado_em: new Date().toISOString() };
    S.tarefas.unshift(temp); pintar();
    return api('POST', '/api/tarefas', corpo).then((r) => {
      S.tarefas = S.tarefas.filter((x) => x.id !== temp.id);
      substituir(r.tarefa); pintar();
      const id = r.tarefa.id;
      const volta = () => api('DELETE', `/api/tarefas/${id}`, { motivo: t('undo_motivo') }).then(() => { S.tarefas = S.tarefas.filter((x) => x.id !== id); pintar(); toast(t('undone')); }).catch((e) => toast(e.message));
      S.desfazer = volta;
      toast(t('created', { p: PESSOAS()[r.tarefa.dono], d: r.tarefa.vence_em ? t('created_d', { d: fmt(r.tarefa.vence_em) }) : '' }), { acao: t('undo'), fn: volta });
      return r.tarefa;
    }).catch((e) => {
      S.tarefas = S.tarefas.filter((x) => x.id !== temp.id); pintar(); toast(e.message);
      if (fraseOriginal) { $('#rapidoInput').value = fraseOriginal; previaRapida(); }
      return null;
    });
  }

  // ---------- gaveta ----------
  const drawer = $('#drawer'), scrim = $('#scrim');
  const D = { aberto: false, novo: false, t: null, atividade: [], timers: {}, vistos: {}, foco: null };
  function abrirGaveta() {
    if (!D.aberto) D.foco = document.activeElement;
    D.aberto = true; drawer.classList.add('open'); drawer.setAttribute('aria-hidden', 'false'); drawer.inert = false; scrim.classList.add('on');
  }
  function fecharGaveta() {
    if (!D.aberto) return;
    descarregarCampos();
    guardarRascunho();
    D.aberto = false; D.t = null; D.vistos = {}; drawer.classList.remove('open'); drawer.setAttribute('aria-hidden', 'true'); drawer.inert = true; scrim.classList.remove('on');
    if (location.hash.startsWith('#/t/')) { if (D.empurrou) history.back(); else history.replaceState(null, '', `#/${S.vista}`); }
    D.empurrou = false;
    if (D.foco && D.foco.isConnected) D.foco.focus({ preventScroll: true });
    else if (D.foco && D.foco.dataset && D.foco.dataset.id) { const el = $(`.view.on [data-id="${CSS.escape(D.foco.dataset.id)}"]`); if (el) el.focus({ preventScroll: true }); }
  }
  scrim.addEventListener('click', fecharGaveta);
  drawer.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const f = $$('button, input, select, textarea, summary, a[href]', drawer).filter((x) => !x.disabled && x.offsetParent !== null);
    if (!f.length) return;
    const pri = f[0], ult = f[f.length - 1];
    if (e.shiftKey && document.activeElement === pri) { e.preventDefault(); ult.focus(); } else if (!e.shiftKey && document.activeElement === ult) { e.preventDefault(); pri.focus(); }
  });
  const opt = (v, label, sel) => `<option value="${esc(v)}" ${sel ? 'selected' : ''}>${esc(label)}</option>`;
  const areaAuto = (el) => { el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px`; };

  // ---------- editor do card: tudo salva sozinho ----------
  function estadoSalvo(q) { const el = $('#eSalvo'); if (el) el.textContent = q === 'saving' ? t('saving_state') : t('saved_state'); }
  const vazioNovo = () => ({ titulo: '', area: 'Operação', dono: S.who !== 'all' ? S.who : (PESSOAS()[S.eu.id] ? S.eu.id : ''), vence_em: null, estado: 'todo', etapas: [], notas: '', prioridade: 'normal', cidade: '', canal: '', referencia: '', resultado: '', aguardando_quem: '', cobrar_em: null, repete: '', comentarios: [] });
  async function abrirEditor(id, rascunho, deArquivo) {
    fecharFolha(); fecharMenu(); descarregarCampos();
    if (id) {
      let x = deArquivo || porId(id);
      if (!x) { try { x = (await api('GET', `/api/tarefas/${id}`)).tarefa; } catch (e) { toast(e.message); return; } }
      D.novo = false; D.t = clone(x); D.t = porId(id) || D.t;
      if (location.hash !== `#/t/${id}`) {
        if (location.hash.startsWith('#/t/')) history.replaceState(null, '', `#/t/${id}`);
        else { history.pushState(null, '', `#/t/${id}`); D.empurrou = true; }
      }
    } else {
      let salvo = null;
      if (!rascunho) { try { salvo = JSON.parse(ler('compasso-rascunho') || 'null'); } catch { salvo = null; } guardar('compasso-rascunho', null); }
      D.novo = true; D.t = { ...vazioNovo(), ...(rascunho || salvo || {}) };
      D.t.etapas = (D.t.etapas || []).map((e, i) => (typeof e === 'string' ? { id: `n${i}`, texto: e, feita: false } : { id: e.id || `n${i}`, ...e }));
    }
    D.atividade = []; D.vistos = {};
    pintarEditor();
    abrirGaveta();
    if (D.novo) $('#eT', drawer).focus();
    else { carregarAtividade(); $('#dClose', drawer).focus({ preventScroll: true }); }
  }
  /** Esc ou clique fora num card novo com texto não joga o trabalho fora: "C" continua de onde parou. */
  function guardarRascunho() {
    if (!D.novo || !D.t) return;
    const g = (s) => $(s, drawer); const titulo = g('#eT') ? g('#eT').value.trim() : '';
    if (!titulo && !(D.t.etapas || []).length && !(g('#eN') && g('#eN').value.trim())) return;
    guardar('compasso-rascunho', JSON.stringify({ ...D.t, titulo, notas: g('#eN') ? g('#eN').value : '', dono: g('#eW') ? g('#eW').value : D.t.dono, vence_em: g('#eD') ? g('#eD').value || null : D.t.vence_em }));
    toast(t('draft_saved'));
  }
  function pintarEditor() {
    const x = D.t; if (!x) return;
    const novo = D.novo;
    const origem = (o) => (!o || !o.tipo || o.tipo === 'manual' ? '' : o.tipo === 'chat' ? t('from_chat') : o.tipo === 'mcp' ? t('via_claude') : o.tipo === 'sugestao' ? t('from_sug') : o.tipo === 'recorrencia' ? t('from_rec') : o.tipo);
    const sexta = proximoDia(5), segunda = proximoDia(1);
    drawer.innerHTML = `<header><div><h2>${novo ? esc(t('ed_new')) : `<span class="id">${esc(x.id)}</span>`}</h2></div><div>${novo ? '' : `<span class="estado-salvo" id="eSalvo">${esc(t('saved_state'))}</span><button class="btn ghost sm" type="button" id="eLink" title="${esc(t('copy_link'))}">⧉</button>`}<button class="btn ghost sm" type="button" id="dClose">${esc(t('close'))}</button></div></header>
    <div class="body">
      <div class="field"><textarea id="eT" class="titulo-grande" rows="1" aria-label="${esc(t('f_what'))}" placeholder="${esc(t('f_what'))}" maxlength="300">${esc(x.titulo)}</textarea></div>
      ${S.normalizados.has(x.id) ? `<span class="alerta-sinal">✓ ${esc(t('sinal_ok'))}</span>` : ''}
      <div class="seg st-${esc(x.estado)}" id="eSt" role="group" aria-label="${esc(t('f_status'))}">${COLS().map(([k, v]) => `<button type="button" data-st="${k}" class="${x.estado === k ? 'on' : ''}">${esc(v)}</button>`).join('')}</div>
      <div class="bloco-espera" id="eEspera" ${x.estado === 'wait' ? '' : 'hidden'}>
        <div class="row2"><div class="field"><label for="eWq">${esc(t('f_wait_who'))}</label><input id="eWq" type="text" maxlength="80" value="${esc(x.aguardando_quem || '')}" placeholder="${esc(t('f_wait_who_ph'))}"></div>
        <div class="field"><label for="eCo">${esc(t('f_chase'))}</label><input id="eCo" type="date" value="${esc(x.cobrar_em || '')}"></div></div>
      </div>
      <div class="row2">
        <div class="field" id="eDonoBox"><label for="eW">${esc(t('f_who'))}</label><select id="eW">${x.dono ? '' : opt('', t('f_who_pick'), true)}${S.pessoas.map((p) => opt(p.id, p.nome, x.dono === p.id)).join('')}</select></div>
        <div class="field"><label for="eD">${esc(t('f_due'))}</label><input type="date" id="eD" value="${esc(x.vence_em || '')}"><div class="atalhos" id="eDueAt">${[['due_today', S.hoje], ['due_tomorrow', N.somarDias(S.hoje, 1)], ['due_friday', sexta], ['due_monday', segunda], ['due_none', '']].map(([k, d]) => `<button type="button" data-due="${d}">${esc(t(k))}</button>`).join('')}</div></div>
      </div>
      <div class="row2">
        <div class="field"><span class="rotulo">${esc(t('f_prio'))}</span><div class="seg p-${esc(x.prioridade)}" id="ePr" role="group" aria-label="${esc(t('f_prio'))}">${S.prioridades.map((p) => `<button type="button" data-pr="${esc(p)}" class="${x.prioridade === p ? 'on' : ''}">${esc(t('prio_' + p))}</button>`).join('')}</div></div>
        <div class="field"><label for="eA">${esc(t('f_area'))}</label><select id="eA">${S.areas.map((a) => opt(a, areaLabel(a), x.area === a)).join('')}</select></div>
      </div>
      <div class="field"><span class="rotulo">${esc(t('f_steps'))} <span id="eStepCount"></span></span><div class="steplist" id="eSteps"></div><div class="addstep"><input id="eAdd" type="text" maxlength="200" placeholder="${esc(t('new_step'))}" aria-label="${esc(t('new_step'))}"></div></div>
      <div class="field"><label for="eN">${esc(t('f_notes'))}</label><textarea id="eN" maxlength="4000" placeholder="${esc(t('f_notes_ph'))}">${esc(x.notas || '')}</textarea></div>
      <div class="field" id="eResBox" ${x.estado === 'done' || x.resultado ? '' : 'hidden'}><label for="eRes">${esc(t('f_result'))}</label><textarea id="eRes" maxlength="1000" placeholder="${esc(t('f_result_ph'))}">${esc(x.resultado || '')}</textarea></div>
      <details class="ctx" ${x.cidade || x.canal || x.referencia || x.repete ? 'open' : ''}><summary>${esc(t('sec_context'))}${x.referencia ? ` · <span class="ref">${esc(x.referencia)}</span>` : ''}</summary>
        <div class="row2">
          <div class="field"><label for="eC">${esc(t('f_city'))}</label><input type="text" id="eC" maxlength="40" value="${esc(x.cidade || '')}" placeholder="${esc(t('f_city_ph'))}" list="cidades"><datalist id="cidades"><option>Paris</option><option>Lagos</option><option>Marrakech</option><option>Nice</option><option>Monaco</option><option>Cannes</option><option>Lisboa</option></datalist></div>
          <div class="field"><label for="eK">${esc(t('f_channel'))}</label><select id="eK">${opt('', t('canal_none'), !x.canal)}${S.canais.map((c) => opt(c, canalLabel(c), x.canal === c)).join('')}</select></div>
          <div class="field"><label for="eR">${esc(t('f_ref'))}</label><input type="text" id="eR" maxlength="120" value="${esc(x.referencia || '')}" placeholder="${esc(t('f_ref_ph'))}"></div>
          <div class="field"><label for="eRep">${esc(t('f_repeat'))}</label><select id="eRep">${S.repeticoes.map((r) => opt(r, t('rep_' + r), (x.repete || '') === r)).join('')}</select></div>
        </div>
      </details>
      ${novo ? '' : `<div class="field"><span class="rotulo">${esc(t('activity'))}</span><div class="comentar"><textarea id="eCom" maxlength="2000" rows="1" placeholder="${esc(t('comment_ph'))}" aria-label="${esc(t('comment_send'))}"></textarea><button class="btn sm" type="button" id="eComOk">${esc(t('comment_send'))}</button></div><div class="atividade" id="eAtiv"></div><p class="hintline">${esc(t('created_by'))} ${esc(nomeDe(x.criado_por))}${origem(x.origem) ? ` · ${esc(origem(x.origem))}` : ''}${x.criado_em ? ` · ${esc(hora(x.criado_em))}` : ''}${x.arquivada_em ? ` · ${esc(t('archived_on'))} ${esc(hora(x.arquivada_em))}` : ''}</p></div>`}
      <div class="delbox" id="delBox" hidden><div class="field"><label for="eMot">${esc(t('del_why'))}</label><input type="text" id="eMot" maxlength="300" placeholder="${esc(t('del_why_ph'))}"></div><div class="acts"><button class="btn sm danger" type="button" id="dDelOk">${esc(t('del_confirm'))}</button><button class="btn ghost sm" type="button" id="dDelNo">${esc(t('del_cancel'))}</button></div></div>
    </div>
    <footer id="eRodape"></footer>`;
    pintarRodapeEditor(); pintarEtapas(); pintarAtividade();
    areaAuto($('#eT', drawer));
    ligarEditor();
  }
  function pintarRodapeEditor() {
    const x = D.t; const f = $('#eRodape', drawer); if (!f) return;
    if (D.novo) { f.innerHTML = `<span class="hintline"><kbd>Ctrl</kbd> <kbd>Enter</kbd></span><button class="btn gold" type="button" id="dCriar">${esc(t('create'))}</button>`; return; }
    f.innerHTML = x.estado === 'done'
      ? (x.arquivada_em ? `<button class="btn ghost sm" type="button" id="dUnarc">${esc(t('unarchive'))}</button>` : `<button class="btn ghost sm" type="button" id="dArc">${esc(t('archive'))}</button>`) + '<span></span>'
      : `<button class="btn ghost sm" type="button" id="dDel">${esc(t('del'))}</button><span></span>`;
  }
  function pintarEtapas() {
    const box = $('#eSteps', drawer); if (!box) return;
    const x = D.t; const lista = x.etapas || [];
    const focado = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.etapa : null;
    box.innerHTML = lista.map((s) => `<div class="step ${s.feita ? 'done' : ''}" data-e="${esc(s.id)}"><input type="checkbox" ${s.feita ? 'checked' : ''} aria-label="${esc(s.texto)}"><input type="text" data-etapa="${esc(s.id)}" value="${esc(s.texto)}" maxlength="200" aria-label="${esc(t('f_steps'))}"><button type="button" class="x" aria-label="${esc(t('remove_step'))}" title="${esc(t('remove_step'))}">×</button></div>`).join('') || `<span class="hintline">${esc(t('no_steps'))}</span>`;
    $('#eStepCount', drawer).textContent = lista.length ? `· ${feitas(x)}/${lista.length}` : '';
    if (focado) { const el = $(`[data-etapa="${CSS.escape(focado)}"]`, box); if (el) el.focus(); }
  }
  function opEtapa(op) {
    if (D.novo) { D.t.etapas = aplicarOpsLocal(D.t.etapas, [op]); pintarEtapas(); return; }
    mutar(D.t.id, { etapas_ops: [op] });
    pintarEtapas();
  }
  const idLocal = () => 'e' + Math.random().toString(16).slice(2, 10);
  function ligarEditor() {
    const g = (s) => $(s, drawer);
    g('#dClose').addEventListener('click', fecharGaveta);
    if (g('#eLink')) g('#eLink').addEventListener('click', async () => { try { await navigator.clipboard.writeText(`${location.origin}/#/t/${D.t.id}`); toast(t('link_copied')); } catch { toast(`${location.origin}/#/t/${D.t.id}`); } });
    const texto = (sel, campo) => {
      const el = g(sel); if (!el) return;
      el.addEventListener('input', () => { if (el.tagName === 'TEXTAREA' && sel === '#eT') areaAuto(el); agendarCampo(campo, el.value); });
      el.addEventListener('focus', () => { D.vistos[campo] = D.t ? D.t[campo] ?? null : null; });
      el.addEventListener('blur', () => { descarregarCampo(campo); delete D.vistos[campo]; });
    };
    texto('#eT', 'titulo'); texto('#eN', 'notas'); texto('#eRes', 'resultado'); texto('#eC', 'cidade'); texto('#eR', 'referencia'); texto('#eWq', 'aguardando_quem');
    const imediato = (sel, campo, nulo) => { const el = g(sel); if (el) el.addEventListener('change', () => salvarCampo(campo, nulo && !el.value ? null : el.value)); };
    imediato('#eW', 'dono'); imediato('#eD', 'vence_em', true); imediato('#eA', 'area'); imediato('#eK', 'canal'); imediato('#eRep', 'repete'); imediato('#eCo', 'cobrar_em', true);
    g('#eSt').addEventListener('click', (e) => {
      const b = e.target.closest('[data-st]'); if (!b) return;
      if (D.novo) { D.t.estado = b.dataset.st; sincronizarEditor(); return; }
      moverPara(D.t.id, b.dataset.st, { semFolha: true });
      sincronizarEditor();
      if (b.dataset.st === 'done') { g('#eResBox').hidden = false; g('#eRes').focus(); }
      if (b.dataset.st === 'wait') g('#eWq').focus();
    });
    g('#ePr').addEventListener('click', (e) => { const b = e.target.closest('[data-pr]'); if (b) salvarCampo('prioridade', b.dataset.pr); });
    g('#eDueAt').addEventListener('click', (e) => { const b = e.target.closest('[data-due]'); if (!b) return; g('#eD').value = b.dataset.due; salvarCampo('vence_em', b.dataset.due || null); });
    g('#eSteps').addEventListener('change', (e) => {
      const linha = e.target.closest('[data-e]'); if (!linha) return;
      if (e.target.type === 'checkbox') opEtapa({ op: 'marcar', id: linha.dataset.e, feita: e.target.checked });
      else if (e.target.dataset.etapa && e.target.value.trim()) opEtapa({ op: 'texto', id: linha.dataset.e, texto: e.target.value.trim() });
    });
    g('#eSteps').addEventListener('click', (e) => { const x = e.target.closest('.x'); if (x) opEtapa({ op: 'del', id: x.closest('[data-e]').dataset.e }); });
    g('#eSteps').addEventListener('keydown', (e) => {
      const linha = e.target.closest('[data-e]'); if (!linha || !e.target.dataset.etapa) return;
      const id = linha.dataset.e;
      if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); g('#eAdd').focus(); }
      if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); const lista = D.t.etapas; const i = lista.findIndex((s) => s.id === id); opEtapa({ op: 'mover', id, para: i + (e.key === 'ArrowUp' ? -1 : 1) }); }
      if (e.key === 'Backspace' && !e.target.value) { e.preventDefault(); opEtapa({ op: 'del', id }); g('#eAdd').focus(); }
    });
    g('#eAdd').addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault(); const v = e.target.value.trim(); if (!v) return;
      opEtapa({ op: 'add', texto: v, novo_id: idLocal() }); e.target.value = '';
    });
    if (g('#eCom')) {
      const enviar = async () => {
        const inp = g('#eCom'); const v = inp.value.trim(); if (!v) return;
        inp.value = '';
        try { const r = await api('POST', `/api/tarefas/${D.t.id}/comentarios`, { texto: v }); substituir(r.tarefa); carregarAtividade(); pintar(); }
        catch (e) { inp.value = v; toast(e.message); }
      };
      g('#eComOk').addEventListener('click', enviar);
      g('#eCom').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar(); } });
    }
    drawer.onclick = async (e) => {
      const alvo = e.target.closest('#dCriar, #dDel, #dDelNo, #dDelOk, #dArc, #dUnarc'); if (!alvo) return;
      if (alvo.id === 'dCriar') criarDoEditor();
      if (alvo.id === 'dDel') { g('#delBox').hidden = false; g('#eMot').focus(); alvo.disabled = true; }
      if (alvo.id === 'dDelNo') { g('#delBox').hidden = true; if (g('#dDel')) g('#dDel').disabled = false; }
      if (alvo.id === 'dDelOk') {
        const motivo = g('#eMot').value.trim(); if (motivo.length < 5) { toast(t('del_need')); return; }
        const id = D.t.id;
        try { await api('DELETE', `/api/tarefas/${id}`, { motivo }); S.tarefas = S.tarefas.filter((x) => x.id !== id); fecharGaveta(); pintar(); toast(t('del_done')); } catch (err) { toast(err.message); }
      }
      if (alvo.id === 'dArc') { try { const r = await api('POST', `/api/tarefas/${D.t.id}/arquivar`, {}); substituir(r.tarefa); fecharGaveta(); pintar(); toast(t('archived_ok')); } catch (err) { toast(err.message); } }
      if (alvo.id === 'dUnarc') { try { const r = await api('POST', `/api/tarefas/${D.t.id}/desarquivar`, {}); S.arquivadas = Math.max(0, S.arquivadas - 1); substituir(r.tarefa); fecharGaveta(); pintar(); toast(t('unarchived_ok')); } catch (err) { toast(err.message); } }
    };
    drawer.onkeydown = (e) => { if (D.novo && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); criarDoEditor(); } };
  }
  function agendarCampo(campo, valor) {
    if (D.novo) { D.t[campo] = valor; return; }
    if (!(campo in D.vistos)) D.vistos[campo] = D.t[campo] ?? null;
    estadoSalvo('saving');
    clearTimeout((D.timers[campo] || {}).h);
    D.timers[campo] = { valor, h: setTimeout(() => descarregarCampo(campo), 700) };
  }
  function descarregarCampo(campo) {
    const p = D.timers[campo]; if (!p) return;
    clearTimeout(p.h); delete D.timers[campo];
    if (D.t && !D.novo) { salvarCampo(campo, p.valor, D.vistos[campo]); if (campo in D.vistos) D.vistos[campo] = p.valor; }
  }
  function descarregarCampos() { for (const c of Object.keys(D.timers)) descarregarCampo(c); }
  function salvarCampo(campo, valor, visto) {
    if (D.novo) { D.t[campo] = valor; sincronizarEditor(); return; }
    if (campo === 'titulo' && String(valor).trim().length < 3) return;
    if ((D.t[campo] ?? '') === (valor ?? '')) { estadoSalvo('saved'); return; }
    mutar(D.t.id, { [campo]: valor }, visto !== undefined ? { base: { [campo]: visto } } : {}).then((r) => {
      if (!r && D.t && campo in D.vistos) D.vistos[campo] = D.t[campo] ?? null; // conflito: o texto segue no campo; a próxima edição parte do valor atual
      carregarAtividade();
    });
    sincronizarEditor();
  }
  /** Traz para a gaveta o que mudou (por aqui ou por outra pessoa), sem tocar no campo em que se está digitando. */
  function sincronizarEditor() {
    if (!D.aberto || !D.t) return;
    const x = D.t; const g = (s) => $(s, drawer); if (!g('#eSt')) return;
    const poe = (sel, v, campo) => { const el = g(sel); if (el && el !== document.activeElement && !(campo && D.timers[campo]) && el.value !== String(v ?? '')) el.value = v ?? ''; };
    poe('#eT', x.titulo, 'titulo'); poe('#eN', x.notas, 'notas'); poe('#eRes', x.resultado, 'resultado'); poe('#eC', x.cidade, 'cidade'); poe('#eR', x.referencia, 'referencia'); poe('#eWq', x.aguardando_quem, 'aguardando_quem');
    poe('#eD', x.vence_em); poe('#eCo', x.cobrar_em); poe('#eA', x.area); poe('#eK', x.canal); poe('#eRep', x.repete);
    if (x.dono) poe('#eW', x.dono);
    g('#eSt').className = `seg st-${x.estado}`; $$('[data-st]', g('#eSt')).forEach((b) => b.classList.toggle('on', b.dataset.st === x.estado));
    g('#ePr').className = `seg p-${x.prioridade}`; $$('[data-pr]', g('#ePr')).forEach((b) => b.classList.toggle('on', b.dataset.pr === x.prioridade));
    g('#eEspera').hidden = x.estado !== 'wait';
    g('#eResBox').hidden = !(x.estado === 'done' || x.resultado);
    if (!document.activeElement || !document.activeElement.dataset || !document.activeElement.dataset.etapa) pintarEtapas();
    pintarRodapeEditor();
  }
  function criarDoEditor() {
    descarregarCampos();
    const x = D.t; const g = (s) => $(s, drawer);
    const titulo = g('#eT').value.trim();
    if (titulo.length < 3) { g('#eT').focus(); toast(t('f_what')); return; }
    if (!g('#eW').value) { g('#eW').focus(); toast(t('pick_owner')); return; }
    const corpo = { titulo, dono: g('#eW').value, area: g('#eA').value, vence_em: g('#eD').value || null, estado: x.estado, etapas: (x.etapas || []).map((e) => ({ texto: e.texto, feita: !!e.feita })), notas: g('#eN').value, prioridade: x.prioridade, cidade: g('#eC').value, canal: g('#eK').value, referencia: g('#eR').value, resultado: g('#eRes').value, aguardando_quem: g('#eWq').value, cobrar_em: g('#eCo').value || null, repete: g('#eRep').value };
    if (x.origem) corpo.origem = x.origem;
    D.novo = false; // já virou card: não é rascunho
    fecharGaveta();
    criarCard(corpo);
  }
  async function carregarAtividade() {
    if (!D.t || D.novo) return;
    const id = D.t.id;
    try { const r = await api('GET', `/api/tarefas/${id}/eventos`); if (D.t && D.t.id === id) { D.atividade = r.eventos; pintarAtividade(); } } catch { /* histórico é complemento */ }
  }
  function frasesDoEvento(h) {
    const f = [];
    if (h.tipo === 'criada') f.push(t('ev_criada'));
    else if (h.tipo === 'arquivada') f.push(t('ev_arquivada'));
    else if (h.tipo === 'desarquivada') f.push(t('ev_desarquivada'));
    else if (h.tipo === 'excluida') f.push(t('ev_excluida'));
    else if (h.mudou) {
      const m = h.mudou;
      if (m.estado) f.push(t('ev_estado', { c: colLabel(m.estado.para) }));
      if (m.dono) f.push(t('ev_dono', { p: PESSOAS()[m.dono.para] || m.dono.para }));
      if (m.vence_em) f.push(t('ev_vence', { d: fmt(m.vence_em.para) }));
      if (m.prioridade) f.push(t('ev_prio', { p: t('prio_' + m.prioridade.para) }));
      if (m.resultado) f.push(t('ev_result'));
      if (m.etapas) f.push(t('ev_steps', { x: m.etapas.para || '' }));
      const outros = Object.keys(m).filter((k) => !['estado', 'dono', 'vence_em', 'prioridade', 'resultado', 'etapas'].includes(k));
      if (outros.length) f.push(t('ev_edit', { c: outros.map((k) => t('c_' + k)).join(', ') }));
    }
    return f.join(' · ');
  }
  function pintarAtividade() {
    const box = $('#eAtiv', drawer); if (!box) return;
    box.innerHTML = D.atividade.slice().reverse().slice(0, 40).map((h) => {
      if (h.tipo === 'comentario') return `<div class="ativ com"><span>${av(String(h.quem).split(' ')[0], true)}</span><span><b>${esc(nomeDe(h.quem))}</b> ${esc(h.texto)}</span><span class="quando">${esc(hora(h.ts))}</span></div>`;
      const frase = frasesDoEvento(h);
      if (!frase) return '';
      return `<div class="ativ"><span><b>${esc(nomeDe(h.quem))}</b> ${esc(frase)}${h.motivo ? ` · ${esc(h.motivo)}` : ''}</span><span class="quando">${esc(hora(h.ts))}</span></div>`;
    }).join('');
  }

  // ---------- gaveta: arquivo ----------
  async function abrirArquivo(q) {
    descarregarCampos();
    let r; try { r = await api('GET', '/api/arquivo' + (q ? '?q=' + encodeURIComponent(q) : '')); } catch (err) { toast(err.message); return; }
    D.t = null; D.novo = false;
    drawer.innerHTML = `<header><h2>${esc(t('archive_title'))}</h2><button class="btn ghost sm" type="button" id="dClose">${esc(t('close'))}</button></header>
      <div class="body"><input type="search" id="arcQ" class="search" placeholder="${esc(t('archive_search'))}" value="${esc(q || '')}">
      <p class="hintline">${esc(pl('archive_count', r.total))}</p>
      ${r.tarefas.length ? r.tarefas.map((x) => `<button class="fitem arc" type="button" data-arc="${esc(x.id)}">${av(x.dono)}<span><span class="t">${esc(x.titulo)}</span><br><span class="s">${esc(areaLabel(x.area))}${x.cidade ? ` · ${esc(x.cidade)}` : ''}${x.referencia ? ` · ${esc(x.referencia)}` : ''} · ${esc(t('done_on'))} ${esc(fmtCurto(String(x.concluido_em || '').slice(0, 10)))}</span>${x.resultado ? `<br><span class="s res">${esc(x.resultado.slice(0, 140))}${x.resultado.length > 140 ? '…' : ''}</span>` : ''}</span><span class="state done">${esc(x.id.slice(-4))}</span></button>`).join('') : `<p class="hintline">${esc(t('archive_empty'))}</p>`}</div>`;
    abrirGaveta();
    $('#dClose', drawer).addEventListener('click', fecharGaveta);
    let tm; const busca = $('#arcQ', drawer);
    busca.addEventListener('input', (e) => { clearTimeout(tm); tm = setTimeout(() => openArquivoFoco(e.target.value.trim()), 250); });
    drawer.onclick = (e) => { const b = e.target.closest('[data-arc]'); if (!b) return; const x = r.tarefas.find((y) => y.id === b.dataset.arc); if (x) abrirEditor(x.id, null, x); };
    drawer.onkeydown = null;
  }
  async function openArquivoFoco(q) { await abrirArquivo(q); const b = $('#arcQ', drawer); if (b) { b.focus(); b.setSelectionRange(b.value.length, b.value.length); } }
  $('#arcBtn').addEventListener('click', () => abrirArquivo(''));

  // ---------- gaveta: sugestões ----------
  function contarSugestoes() { $('#sugCount').textContent = (S.sug.itens || []).length; }
  async function abrirSugestoes(atualizar) {
    descarregarCampos(); D.t = null; D.novo = false; drawer.onclick = null;
    drawer.innerHTML = `<header><h2>${esc(t('sug_title'))}</h2><button class="btn ghost sm" type="button" id="dClose">${esc(t('close'))}</button></header><div class="body"><p class="hintline">${esc(t('sug_reading'))}</p></div>`;
    abrirGaveta();
    $('#dClose', drawer).addEventListener('click', fecharGaveta);
    drawer.onkeydown = null;
    try { S.sug = await api('GET', '/api/sugestoes' + (atualizar ? '?atualizar=1' : '')); } catch (err) { toast(err.message); return; }
    if (!D.aberto) return;
    contarSugestoes();
    S.normalizados = new Set(S.sug.normalizados || []);
    const cob = S.sug.cobertura || [];
    const lac = cob.filter((c) => !c.ok || c.parcial);
    const lidas = cob.filter((c) => c.ok).map((c) => c.fonte + (c.origem === 'api' ? ' (Central)' : c.origem === 'banco' ? ' (twk_ro)' : ''));
    const norm = [...S.normalizados].map(porId).filter(Boolean);
    drawer.innerHTML = `<header><h2>${esc(t('sug_title'))}</h2><div><button class="btn ghost sm" type="button" id="dRefresh">${esc(t('refresh'))}</button><button class="btn ghost sm" type="button" id="dClose">${esc(t('close'))}</button></div></header>
      <div class="body">
      ${norm.length ? `<div class="sug"><span class="tag">${esc(t('sug_norm'))}</span><span class="why">${esc(t('sug_norm_sub'))}</span>${norm.map((x) => `<button class="rlinha" type="button" data-abrir="${esc(x.id)}">${av(x.dono, true)}<span class="t">${esc(x.titulo)}</span></button>`).join('')}</div>` : ''}
      ${S.sug.itens.length ? S.sug.itens.map((s) => `<div class="sug" data-s="${esc(s.id)}"><span class="tag">${esc(areaLabel(s.area))}${s.prioridade_fixa ? ' · ' + esc(t('priority')) : ''}${s.voltou ? ' · ' + esc(t('sug_back')) : ''}${s.vence_sugerido ? ' · ' + esc(t('sug_due', { d: fmt(s.vence_sugerido) })) : ''}</span><span class="t">${esc(s.titulo)}</span><span class="why">${esc(s.porque)} <em>(${esc(s.fonte)})</em></span>
        <span class="who">${esc(t('sug_take'))} <span class="pick">${[...S.pessoas].sort((a, b) => (b.id === s.dono_sugerido) - (a.id === s.dono_sugerido)).map((p) => `<button type="button" data-take="${esc(p.id)}" class="${p.id === s.dono_sugerido ? 'on' : ''}">${av(p.id, true)}${esc(p.nome)}${p.id === s.dono_sugerido ? ` <em>${esc(t('sug_suggested'))}</em>` : ''}</button>`).join('')}</span><button class="btn ghost sm" type="button" data-skip="${esc(s.id)}">${esc(t('sug_skip'))}</button></span></div>`).join('') : `<p class="hintline">${esc(t('sug_none'))}</p>`}
      ${S.sug.marco_zero ? `<p class="hintline">${esc(t('sug_marco', { d: fmtCurto(S.sug.marco_zero) }))}</p>` : ''}
      ${lidas.length ? `<p class="hintline">${esc(t('sug_read', { f: lidas.join(', ') }))}</p>` : ''}
      ${lac.length ? `<p class="hintline">${esc(t('sug_lac', { f: lac.map((c) => c.fonte + (c.lacuna ? ` (${c.lacuna})` : '')).join(', ') }))}</p>` : ''}
      <p class="hintline">${S.sug.geradas_em ? esc(t('sug_at', { d: hora(S.sug.geradas_em) })) : ''}${S.sug.decididas ? ' · ' + esc(t('sug_decided', { n: S.sug.decididas })) : ''}</p></div>`;
    $('#dClose', drawer).addEventListener('click', fecharGaveta);
    $('#dRefresh', drawer).addEventListener('click', () => abrirSugestoes(true));
    drawer.onclick = async (e) => {
      const abrir = e.target.closest('[data-abrir]'); if (abrir) { abrirEditor(abrir.dataset.abrir); return; }
      const take = e.target.closest('[data-take]'); const skip = e.target.closest('[data-skip]');
      if (!take && !skip) return;
      try {
        if (take) { const sid = take.closest('.sug').dataset.s; const r = await api('POST', `/api/sugestoes/${sid}/assumir`, { dono: take.dataset.take }); substituir(r.tarefa); pintar(); toast(t('sug_took', { p: PESSOAS()[take.dataset.take], d: r.tarefa.vence_em ? t('created_d', { d: fmt(r.tarefa.vence_em) }) : '' })); abrirSugestoes(false); }
        if (skip) { await api('POST', `/api/sugestoes/${skip.dataset.skip}/descartar`, {}); toast(t('sug_skipped')); abrirSugestoes(false); }
      } catch (err) { toast(err.message); }
    };
  }
  $('#sugBtn').addEventListener('click', () => abrirSugestoes(false));

  // ---------- planejador ----------
  const msgs = $('#msgs');
  const propostas = new Map();
  let pid = 0;
  function addMsg(html, me, rotulo) { const m = document.createElement('div'); m.className = 'msg' + (me ? ' me' : ''); m.innerHTML = `<span class="who">${esc(rotulo || (me ? t('chat_you') : t('chat_planner')))}</span>${html}`; msgs.appendChild(m); msgs.scrollTop = msgs.scrollHeight; return m; }
  function metaProposta(p) {
    const dono = p.dono ? `<span class="pill ouro">${av(p.dono, true)} ${esc(PESSOAS()[p.dono] || '')}</span>` : `<span class="pill falta">${esc(t('chat_no_owner'))}</span>`;
    const prazo = `<span class="pill${p.vence_em ? ' ouro' : ''}">${esc(p.vence_em ? t('chat_until', { d: fmt(p.vence_em) }) : t('chat_no_due'))}</span>`;
    const resto = [p.prioridade === 'alta' ? `<span class="pill alta">${esc(t('prio_alta'))}</span>` : '', p.repete ? `<span class="pill">↻ ${esc(t('rep_' + p.repete))}</span>` : '', p.cidade ? `<span class="pill">${esc(p.cidade)}</span>` : '', p.canal ? `<span class="pill">${esc(canalLabel(p.canal))}</span>` : '', p.referencia ? `<span class="pill ref">${esc(p.referencia)}</span>` : '', `<span class="pill">${esc(areaLabel(p.area))}</span>`].join('');
    return dono + prazo + resto;
  }
  const propostaInner = (p) => `<span class="t">${esc(p.titulo)}</span>${(p.etapas || []).length ? `<ol>${p.etapas.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>` : ''}<span class="meta">${metaProposta(p)}</span>`;
  /** Cada proposta tem o próprio id: o botão cria exatamente aquele card, não o último que chegou. */
  function propostaViva(p, conversaId) {
    const id = `p${++pid}`; propostas.set(id, { ...p, conversa_id: conversaId });
    return `<div class="prop" data-pid="${id}">${propostaInner(p)}<div class="acts"><button class="btn gold sm" type="button" data-c="create">${esc(t('create_card'))}</button><span class="pick">${S.pessoas.map((u) => `<button type="button" data-dono="${esc(u.id)}" class="${p.dono === u.id ? 'on' : ''}">${av(u.id, true)}${esc(u.nome)}</button>`).join('')}</span><button class="btn ghost sm" type="button" data-c="edit">${esc(t('adjust'))}</button></div></div>`;
  }
  function corpoDeProposta(p) { return { titulo: p.titulo, area: p.area, dono: p.dono, vence_em: p.vence_em, prioridade: p.prioridade || 'normal', cidade: p.cidade || '', canal: p.canal || '', referencia: p.referencia || '', repete: p.repete || '', estado: 'todo', etapas: (p.etapas || []).map((s) => ({ texto: s, feita: false })), notas: p.motivo || '', origem: { tipo: 'chat', ref: p.conversa_id || '' } }; }
  async function criarProposta(el) {
    const id = el.dataset.pid; const p = propostas.get(id); if (!p || el.dataset.criando) return false;
    if (!p.dono) { toast(t('pick_owner')); return false; }
    el.dataset.criando = '1';
    const acts = $('.acts', el);
    try {
      const r = await api('POST', '/api/tarefas', corpoDeProposta(p));
      substituir(r.tarefa); pintar(); propostas.delete(id);
      acts.innerHTML = `<button class="linkbtn" type="button" data-abrir-card="${esc(r.tarefa.id)}">${esc(t('created_card', { id: r.tarefa.id }))}</button>`;
      return true;
    } catch (err) { toast(err.message); return false; }
    finally { delete el.dataset.criando; }
  }
  msgs.addEventListener('click', async (e) => {
    const abrir = e.target.closest('[data-abrir-card]'); if (abrir) { abrirEditor(abrir.dataset.abrirCard); return; }
    const todos = e.target.closest('[data-c="all"]');
    if (todos) { const box = todos.closest('.msg'); for (const el of $$('.prop[data-pid]', box)) if (propostas.has(el.dataset.pid)) await criarProposta(el); if (!$$('.prop [data-c="create"]', box).length) todos.remove(); return; }
    const el = e.target.closest('.prop[data-pid]'); if (!el) return;
    const p = propostas.get(el.dataset.pid); if (!p) return;
    const dono = e.target.closest('[data-dono]');
    if (dono) { p.dono = dono.dataset.dono; $('.meta', el).innerHTML = metaProposta(p); $$('[data-dono]', el).forEach((b) => b.classList.toggle('on', b === dono)); return; }
    const c = e.target.closest('[data-c]'); if (!c) return;
    if (c.dataset.c === 'create') criarProposta(el);
    if (c.dataset.c === 'edit') { const corpo = corpoDeProposta(p); propostas.delete(el.dataset.pid); $('.acts', el).innerHTML = ''; abrirEditor(null, { ...corpo, dono: corpo.dono || '' }); }
  });
  function respostaHtml(r) {
    if (r.tipo === 'carga') return `<p>${esc(t('chat_load'))}</p>` + r.por_pessoa.map((u) => `<div class="rlinha" style="cursor:default">${av(u.id, true)}<span class="t">${esc(t('chat_load_line', { p: PESSOAS()[u.id], a: u.abertas, l: u.atrasadas }))}</span></div>`).join('');
    const itens = (r.ids || []).map(porId).filter(Boolean);
    if (!itens.length) return `<p>${esc(t('chat_empty'))}</p>`;
    return `<p>${esc(pl('chat_found', r.total ?? itens.length))}</p>` + itens.map((x) => `<button class="rlinha" type="button" data-id="${esc(x.id)}">${av(x.dono, true)}<span class="t">${prioMark(x)} ${esc(x.titulo)}</span>${dueHtml(x)}</button>`).join('');
  }
  async function carregarChat() {
    let h; try { h = await api('GET', '/api/chat'); } catch { return; }
    msgs.innerHTML = '';
    for (const m of h.mensagens || []) {
      const via = m.canal === 'mcp' ? t('chat_via') : ''; const q = m.ts ? ' · ' + hora(m.ts) : '';
      const quemLabel = S.eu.id === 'admin' && m.quem && m.quem !== 'admin' ? ` (${PESSOAS()[m.quem] || m.quem})` : '';
      if (m.papel === 'pessoa') addMsg(`<p>${esc(m.texto || '')}</p>`, true, `${t('chat_you')}${quemLabel}${via}${q}`);
      else if (m.tarefa_id) addMsg(`<p>${esc(m.texto || m.tarefa_id)}</p>`, false, `${t('chat_planner')}${via}${q}`);
      else if (m.resposta) addMsg(respostaHtml(m.resposta), false, `${t('chat_planner')}${via}${q}`);
      else if (m.proposta) addMsg((m.propostas || [m.proposta]).map((p) => `<div class="prop">${propostaInner(p)}</div>`).join(''), false, `${t('chat_planner')}${via}${q}`);
    }
    if ((h.mensagens || []).length) addMsg(`<p class="hintline">${esc(t('chat_hist_end'))}</p>`);
    $('#exemplos').innerHTML = ['chat_ex1', 'chat_ex2', 'chat_ex3'].map((k) => `<button class="chip txt" type="button" data-ex="${esc(t(k))}">${esc(t(k))}</button>`).join('');
  }
  $('#exemplos').addEventListener('click', (e) => { const b = e.target.closest('[data-ex]'); if (b) { $('#input').value = b.dataset.ex; $('#composer').requestSubmit(); } });
  $('#composer').addEventListener('submit', async (e) => {
    e.preventDefault(); const inp = $('#input'); const v = inp.value.trim(); if (!v) return;
    addMsg(`<p>${esc(v)}</p>`, true); inp.value = '';
    const espera = addMsg(`<p class="hintline">${esc(t('chat_wait'))}</p>`);
    const rot = `<span class="who">${esc(t('chat_planner'))}</span>`;
    try {
      const r = await api('POST', '/api/planejar', { texto: v, idioma: LANG });
      if (r.resposta) { espera.innerHTML = rot + respostaHtml(r.resposta); }
      else {
        const ps = r.propostas || [r.proposta];
        const cab = ps.length > 1 ? t('chat_proposes', { n: ps.length }) : t('chat_propose');
        espera.innerHTML = `${rot}<p>${esc(ps[0].origem_modelo ? t('chat_ok') : t('chat_ok_heur'))} ${esc(cab)}${ps.length === 1 && ps[0].motivo ? `, ${esc(ps[0].motivo)}` : ''}:</p>${ps.map((p) => propostaViva(p, r.conversa_id)).join('')}${ps.length > 1 ? `<div class="acts"><button class="btn gold sm" type="button" data-c="all">${esc(t('create_all', { n: ps.length }))}</button></div>` : ''}`;
      }
      msgs.scrollTop = msgs.scrollHeight;
    } catch (err) { espera.innerHTML = `${rot}<p>${esc(err.message)}</p>`; inp.value = v; }
  });
  $('#input').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#composer').requestSubmit(); } });

  // ---------- paleta ----------
  const paleta = $('#paleta'); const palInput = $('#palInput'); const palLista = $('#palLista'); const palPrevia = $('#palPrevia');
  let palItens = []; let palSel = 0; let palArq = []; let palTm;
  function abrirPaleta(inicial) { paleta.hidden = false; palInput.value = inicial || ''; palArq = []; pintarPaleta(); palInput.focus(); if (inicial) palInput.setSelectionRange(inicial.length, inicial.length); }
  function fecharPaleta() { paleta.hidden = true; }
  function comandos() {
    const v = [['hoje', 'nav_today'], ['quadro', 'nav_board'], ['calendario', 'nav_cal'], ['planejador', 'nav_chat']].map(([k, l]) => ({ rot: t('pal_goto', { v: t(l) }), fn: () => irPara(k) }));
    const f = [{ rot: t('pal_filter_all'), fn: () => { S.who = 'all'; guardar('compasso-who', 'all'); pintarAgora(); } }, ...S.pessoas.map((p) => ({ rot: t('pal_filter', { p: p.nome }), html: av(p.id, true), fn: () => { S.who = p.id; guardar('compasso-who', p.id); pintarAgora(); } }))];
    return [{ rot: t('new_task'), kbd: 'C', fn: () => abrirEditor(null) }, { rot: t('pw_change'), fn: () => mostrarTroca(false, S.eu) }, { rot: t('sug'), fn: () => abrirSugestoes(false) }, { rot: t('novi_title'), fn: () => abrirNovidades() }, { rot: t('archive_title'), fn: () => abrirArquivo('') }, ...v, ...f, { rot: t('pal_lang'), fn: () => mudarIdioma() }, { rot: t('pal_help'), kbd: '?', fn: () => abrirAjuda() }];
  }
  function pintarPaleta() {
    const q = palInput.value.trim();
    const baixo = q.toLowerCase();
    palItens = []; const grupos = []; let criar = null;
    palPrevia.innerHTML = '';
    if (q.length >= 3) {
      const a = N.analisar(q, { hoje: S.hoje }); const dono = donoInicial(a);
      palPrevia.innerHTML = pillsDe({ ...a, dono });
      criar = dono ? [{ rot: t('pal_create', { t: a.titulo }), fn: () => criarDaFrase(q, dono) }] : S.pessoas.map((p) => ({ rot: t('pal_create_for', { p: p.nome, t: a.titulo }), html: av(p.id, true), fn: () => criarDaFrase(q, p.id) }));
    }
    const achadas = q ? S.tarefas.filter((x) => [x.id, x.titulo, x.referencia, x.cidade, x.notas, x.resultado, ...(x.comentarios || []).map((c) => c.texto)].join(' ').toLowerCase().includes(baixo)).slice(0, 8) : S.tarefas.filter((x) => x.estado !== 'done').slice(0, 4);
    // Procurando algo que existe: o que existe vem primeiro, e Enter abre. Só frase sem resultado cria de primeira.
    if (criar && !achadas.length) grupos.push(['', criar]);
    if (achadas.length) grupos.push([t('pal_tasks'), achadas.map((x) => ({ rot: x.titulo, html: av(x.dono, true), meta: `${colLabel(x.estado)} · ${fmt(x.vence_em)}`, fn: () => abrirEditor(x.id) }))]);
    if (criar && achadas.length) grupos.push(['', criar]);
    if (palArq.length) grupos.push([t('pal_archive'), palArq.map((x) => ({ rot: x.titulo, html: av(x.dono, true), meta: x.id.slice(-4), fn: () => abrirEditor(x.id, null, x) }))]);
    const cmds = comandos().filter((c) => !baixo || c.rot.toLowerCase().includes(baixo));
    if (cmds.length) grupos.push([t('pal_actions'), q ? cmds.slice(0, 5) : cmds]);
    let html = '';
    for (const [g, itens] of grupos) {
      if (g) html += `<div class="pal-grupo">${esc(g)}</div>`;
      for (const it of itens) { const i = palItens.push(it) - 1; html += `<button class="pal-item ${i === palSel ? 'on' : ''}" type="button" role="option" data-pi="${i}">${it.html || ''}<span class="t">${esc(it.rot)}</span>${it.meta ? `<small>${esc(it.meta)}</small>` : ''}${it.kbd ? `<kbd>${esc(it.kbd)}</kbd>` : ''}</button>`; }
    }
    palLista.innerHTML = html || `<div class="pal-vazio">${esc(t('pal_empty'))}</div>`;
  }
  palInput.addEventListener('input', () => {
    palSel = 0; pintarPaleta();
    clearTimeout(palTm); const q = palInput.value.trim();
    if (q.length < 3) { palArq = []; return; }
    palTm = setTimeout(async () => { try { const r = await api('GET', `/api/arquivo?q=${encodeURIComponent(q)}`); if (palInput.value.trim() === q) { palArq = r.tarefas.slice(0, 5); pintarPaleta(); } } catch { /* arquivo é complemento */ } }, 220);
  });
  palInput.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); palSel = Math.min(palItens.length - 1, palSel + 1); pintarPaleta(); $('.pal-item.on', palLista)?.scrollIntoView({ block: 'nearest' }); }
    if (e.key === 'ArrowUp') { e.preventDefault(); palSel = Math.max(0, palSel - 1); pintarPaleta(); $('.pal-item.on', palLista)?.scrollIntoView({ block: 'nearest' }); }
    if (e.key === 'Enter') { e.preventDefault(); const it = palItens[palSel]; if (it) { fecharPaleta(); it.fn(); } }
  });
  palLista.addEventListener('click', (e) => { const b = e.target.closest('[data-pi]'); if (!b) return; const it = palItens[Number(b.dataset.pi)]; fecharPaleta(); if (it) it.fn(); });
  paleta.addEventListener('click', (e) => { if (e.target === paleta) fecharPaleta(); });
  $('#palBtn').addEventListener('click', () => abrirPaleta());
  $('#tabMais').addEventListener('click', () => abrirEditor(null));

  // ---------- novidades ----------
  const novi = $('#novi');
  const chaveLido = () => `compasso-lido-${S.eu ? S.eu.id : ''}`;
  async function carregarNovidades() {
    if (!S.eu) return;
    const p = minhaPessoa();
    try { const r = await api('GET', `/api/novidades${p ? `?pessoa=${p}` : ''}`); S.novidades = r.itens; contarNovidades(); if (!novi.hidden) pintarNovidades(); } catch { /* complemento */ }
  }
  function contarNovidades() {
    const lido = ler(chaveLido()) || '';
    const n = S.novidades.filter((i) => i.ts > lido).length;
    const c = $('#noviCount'); c.hidden = !n; c.textContent = n > 9 ? '9+' : n;
  }
  function fraseNovidade(i) {
    if (i.dono) return t('n_dono', { p: PESSOAS()[i.dono] || i.dono });
    if (i.tipo === 'estado' && i.estado) return t('n_estado', { c: colLabel(i.estado) });
    return t('n_' + i.tipo);
  }
  function pintarNovidades() {
    const lido = ler(chaveLido()) || '';
    const podeAvisar = 'Notification' in window && Notification.permission === 'default';
    novi.innerHTML = `<h3>${esc(t('novi_title'))}${podeAvisar ? `<button class="btn ghost sm" type="button" id="noviAvisar">${esc(t('novi_enable'))}</button>` : ''}</h3>${S.novidades.length ? S.novidades.slice(0, 25).map((i) => `<button class="nov ${i.ts > lido ? 'nova' : ''}" type="button" data-id="${esc(i.tarefa_id)}"><span><b>${esc(nomeDe(i.quem))}</b> ${esc(fraseNovidade(i))}: ${esc(i.titulo)}</span>${i.texto ? `<span class="tx">${esc(i.texto)}</span>` : ''}<small>${esc(hora(i.ts))}</small></button>`).join('') : `<p class="hintline" style="padding:6px 4px">${esc(t('novi_none'))}</p>`}`;
    const b = $('#noviAvisar'); if (b) b.addEventListener('click', async () => { const r = await Notification.requestPermission(); toast(r === 'granted' ? t('novi_on') : t('novi_off')); pintarNovidades(); });
  }
  function abrirNovidades() { novi.hidden = false; pintarNovidades(); carregarNovidades(); if (S.novidades[0]) guardar(chaveLido(), S.novidades[0].ts); contarNovidades(); }
  $('#noviBtn').addEventListener('click', () => { if (novi.hidden) abrirNovidades(); else novi.hidden = true; });

  // ---------- ajuda ----------
  const ajuda = $('#ajuda');
  function abrirAjuda() {
    const k = (...ks) => ks.map((x) => `<kbd>${esc(x)}</kbd>`).join('');
    ajuda.innerHTML = `<div class="ajuda-caixa"><h3>${esc(t('help_title'))}<button class="btn ghost sm" type="button" id="ajFechar">${esc(t('close'))}</button></h3><dl>
      <dt>${k('Ctrl', 'K')}</dt><dd>${esc(t('k_palette'))}</dd><dt>${k('C')}</dt><dd>${esc(t('k_new'))}</dd><dt>${k('/')}</dt><dd>${esc(t('k_search'))}</dd>
      <dt>${k('G', 'H')} ${k('G', 'Q')} ${k('G', 'C')} ${k('G', 'P')}</dt><dd>${esc(t('k_views'))}</dd><dt>${k('J', 'K')} ${k('←', '→')}</dt><dd>${esc(t('k_nav'))}</dd><dt>${k('Enter')}</dt><dd>${esc(t('k_open'))}</dd><dt>${k('1', '2', '3', '4')}</dt><dd>${esc(t('k_move'))}</dd><dt>${k('Z')}</dt><dd>${esc(t('k_undo'))}</dd><dt>${k('Esc')}</dt><dd>${esc(t('k_close'))}</dd><dt>${k('?')}</dt><dd>${esc(t('k_help'))}</dd>
    </dl></div>`;
    ajuda.hidden = false;
    $('#ajFechar').addEventListener('click', () => { ajuda.hidden = true; }); $('#ajFechar').focus();
  }
  ajuda.addEventListener('click', (e) => { if (e.target === ajuda) ajuda.hidden = true; });

  // ---------- teclado ----------
  let prefixoG = 0;
  const focaveis = () => $$('.view.on .card[data-id], .view.on .linha[data-id]').filter((x) => x.offsetParent !== null);
  function moverFoco(delta) {
    const l = focaveis(); if (!l.length) return;
    const i = l.indexOf(document.activeElement);
    const alvo = l[i < 0 ? 0 : Math.max(0, Math.min(l.length - 1, i + delta))];
    alvo.focus(); alvo.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  function moverColuna(delta) {
    const c = document.activeElement && document.activeElement.closest ? document.activeElement.closest('.col') : null;
    const cols = $$('.col'); if (!c) { moverFoco(0); return; }
    const alvo = cols[cols.indexOf(c) + delta]; if (!alvo) return;
    const pos = $$('.card', c).indexOf(document.activeElement);
    const cards = $$('.card', alvo); const el = cards[Math.min(pos, cards.length - 1)] || cards[0];
    if (el) el.focus();
  }
  document.addEventListener('keydown', (e) => {
    const alvo = e.target;
    const digitando = /^(INPUT|TEXTAREA|SELECT)$/.test(alvo.tagName) || alvo.isContentEditable;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); if (paleta.hidden) abrirPaleta(); else fecharPaleta(); return; }
    if (e.key === 'Escape') {
      if (!ajuda.hidden) { ajuda.hidden = true; return; }
      if (!paleta.hidden) { fecharPaleta(); return; }
      if (!menu.hidden) { fecharMenu(); return; }
      if (!novi.hidden) { novi.hidden = true; return; }
      if (!folha.hidden) { fecharFolha(); return; }
      const del = $('#delBox', drawer); if (del && !del.hidden) { del.hidden = true; if ($('#dDel', drawer)) $('#dDel', drawer).disabled = false; return; }
      if (D.aberto) { fecharGaveta(); return; }
      if (digitando) alvo.blur();
      return;
    }
    if (digitando || e.ctrlKey || e.metaKey || e.altKey || !S.eu || !paleta.hidden) return;
    const emCard = alvo.closest && alvo.closest('.card[data-id], .linha[data-id]');
    if (emCard && (e.key === 'Enter' || e.key === ' ') && alvo === emCard) { e.preventDefault(); emCard.click(); return; }
    if (D.aberto) return;
    if (alvo.tagName === 'BUTTON' && (e.key === 'Enter' || e.key === ' ')) return;
    if (Date.now() - prefixoG < 900) {
      prefixoG = 0;
      const mapa = { h: 'hoje', q: 'quadro', c: 'calendario', p: 'planejador' };
      if (mapa[e.key.toLowerCase()]) { e.preventDefault(); irPara(mapa[e.key.toLowerCase()]); return; }
    }
    switch (e.key.toLowerCase()) {
      case 'g': prefixoG = Date.now(); break;
      case 'c': case 'n': e.preventDefault(); abrirEditor(null); break;
      case '/': e.preventDefault(); if (S.vista === 'quadro') $('#fBusca')?.focus(); else abrirPaleta(); break;
      case '?': abrirAjuda(); break;
      case 'z': if (S.desfazer) { const f = S.desfazer; S.desfazer = null; f(); toast(t('undone')); } break;
      case 'j': case 'arrowdown': e.preventDefault(); moverFoco(1); break;
      case 'k': case 'arrowup': e.preventDefault(); moverFoco(-1); break;
      case 'arrowright': if (S.vista === 'quadro') { e.preventDefault(); moverColuna(1); } break;
      case 'arrowleft': if (S.vista === 'quadro') { e.preventDefault(); moverColuna(-1); } break;
      case '1': case '2': case '3': case '4': if (emCard) { e.preventDefault(); moverPara(emCard.dataset.id, ['todo', 'doing', 'wait', 'done'][Number(e.key) - 1]); } break;
      case 'x': if (emCard) { e.preventDefault(); moverPara(emCard.dataset.id, 'done'); } break;
      case 'm': if (emCard) { e.preventDefault(); abrirMenuCard(emCard.dataset.id, emCard.getBoundingClientRect()); } break;
      default: break;
    }
  });

  // ---------- rotas ----------
  const VISTAS = ['hoje', 'quadro', 'calendario', 'planejador'];
  function irPara(v) {
    if (D.aberto) { D.empurrou = false; fecharGaveta(); }
    S.vista = v; guardar('compasso-view', v);
    if (location.hash !== `#/${v}`) history.replaceState(null, '', `#/${v}`);
    renderFiltroDir();
    pintarAgora();
    if (v === 'planejador') msgs.scrollTop = msgs.scrollHeight;
  }
  function rotear() {
    const m = location.hash.match(/^#\/t\/(T-\d{8}-\d{4})$/);
    if (m) { if (!D.aberto || !D.t || D.t.id !== m[1]) abrirEditor(m[1]); return; }
    if (D.aberto && D.t && !D.novo) { D.empurrou = false; fecharGaveta(); } // voltar do navegador fecha o card
    const v = location.hash.replace(/^#\//, '');
    if (VISTAS.includes(v) && v !== S.vista) irPara(v);
  }
  window.addEventListener('hashchange', rotear);

  // ---------- tempo real ----------
  let fonte = null; let aoEsconder = 0;
  function pulso(on) { const p = $('#pulso'); p.classList.toggle('on', on); p.title = on ? t('live_on') : t('live_off'); }
  function ligarTempoReal() {
    if (fonte || !window.EventSource) return;
    fonte = new EventSource('/api/stream');
    fonte.addEventListener('ola', (e) => { pulso(true); const d = JSON.parse(e.data); if (d.hoje) S.hoje = d.hoje; if (d.seq !== S.seq) carregar(); });
    fonte.addEventListener('mudanca', (e) => {
      const m = JSON.parse(e.data);
      if (m.seq) S.seq = Math.max(S.seq, m.seq);
      if (pendentes.has(m.tarefa_id)) return; // o que estou mudando agora volta pela resposta
      if (m.tarefa) {
        const atual = porId(m.tarefa.id);
        if (atual && (atual.versao || 0) >= (m.tarefa.versao || 0)) return;
        if (!atual && !m.tarefa.arquivada_em) S.tarefas = S.tarefas.filter((x) => !(x._temp && x.titulo === m.tarefa.titulo));
        substituir(m.tarefa);
      } else {
        S.tarefas = S.tarefas.filter((x) => x.id !== m.tarefa_id);
        if (D.t && D.t.id === m.tarefa_id) fecharGaveta();
      }
      pintar();
      avisarSeForComigo(m);
    });
    fonte.addEventListener('sugestoes', (e) => { const d = JSON.parse(e.data); S.sug.itens = S.sug.itens || []; $('#sugCount').textContent = d.vivas; S.normalizados = new Set(d.normalizados || []); pintar(); });
    fonte.onerror = () => {
      pulso(false);
      // Resposta que não é 200 (502 num deploy, por exemplo) fecha o canal de vez: o navegador não tenta sozinho.
      if (fonte && fonte.readyState === 2) { fonte = null; setTimeout(() => { if (S.eu && !document.hidden) ligarTempoReal(); }, 15000); }
    };
  }
  function desligarTempoReal() { if (fonte) { fonte.close(); fonte = null; } pulso(false); }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { aoEsconder = setTimeout(desligarTempoReal, 60000); return; }
    clearTimeout(aoEsconder);
    if (S.eu) { ligarTempoReal(); carregar().catch(() => {}); carregarNovidades(); }
  });
  let tmNovi;
  function avisarSeForComigo(m) {
    const eu = minhaPessoa();
    const autor = String(m.quem || '').split(' ')[0];
    if (autor === (S.eu && S.eu.id) && !/via Claude$/.test(String(m.quem))) return;
    clearTimeout(tmNovi); tmNovi = setTimeout(carregarNovidades, 1200);
    if (!eu || !('Notification' in window) || Notification.permission !== 'granted' || !document.hidden) return;
    const meu = (m.mencoes || []).includes(eu) || (m.tarefa && m.tarefa.dono === eu);
    if (meu && m.tarefa) { try { new Notification(`${nomeDe(m.quem)}: ${m.tarefa.titulo}`, { tag: m.tarefa_id, icon: '/icon.svg' }); } catch { /* opcional */ } }
  }

  // ---------- carga, sessão ----------
  function guardarCache() { if (!S.eu) return; clearTimeout(guardarCache.h); guardarCache.h = setTimeout(() => guardar('compasso-cache', JSON.stringify({ eu: S.eu.id, tarefas: S.tarefas.filter((x) => !x._temp), seq: S.seq, arquivadas: S.arquivadas, resumo: S.resumo })), 400); }
  async function carregar() {
    const r = await api('GET', `/api/tarefas${S.seq ? `?desde=${S.seq}` : ''}`);
    if (r.hoje) S.hoje = r.hoje;
    if (r.inalterado) { pintar(); return; }
    const locais = S.tarefas.filter((x) => pendentes.has(x.id) || x._temp);
    S.tarefas = r.tarefas.map((x) => locais.find((l) => l.id === x.id) || x);
    for (const l of locais) if (l._temp) S.tarefas.unshift(l);
    S.arquivadas = r.arquivadas || 0; S.resumo = r.resumo; S.seq = r.seq || S.seq; S.normalizados = new Set(r.normalizados || []);
    if (D.aberto && D.t && !D.novo) { const n = porId(D.t.id); if (n && n !== D.t) { D.t = n; sincronizarEditor(); } }
    guardarCache(); pintar();
  }
  function mostrarLogin() {
    desligarTempoReal(); S.eu = null; guardar('compasso-cache', null);
    fecharGaveta();
    $('#app').hidden = true; $('#tabbar').hidden = true; $('#trocar').hidden = true; $('#login').hidden = false; aplicarIdioma();
    const ult = ler('compasso-ultimo-login');
    if (ult && $$('#lUser option').some((o) => o.value === ult)) $('#lUser').value = ult;
  }
  function mostrarApp() {
    $('#login').hidden = true; $('#trocar').hidden = true; $('#app').hidden = false; $('#tabbar').hidden = false;
    $('#euAv').className = `av ${S.eu.id}`; $('#euAv').textContent = (S.eu.nome || S.eu.id).slice(0, 2).toUpperCase();
    $('#chatHint').textContent = S.modelo === 'heurística' ? t('chat_hint_heur') : t('chat_hint_model');
  }
  async function iniciar() {
    aplicarIdioma();
    const qs = location.hash.replace(/^#\//, '');
    const v0 = VISTAS.includes(qs) ? qs : (VISTAS.includes(ler('compasso-view')) ? ler('compasso-view') : 'hoje');
    S.vista = v0;
    const eu = await api('GET', '/api/eu');
    S.pessoas = eu.pessoas;
    $('#lUser').innerHTML = (eu.usuarios || eu.pessoas).map((p) => `<option value="${esc(p.id)}">${esc(p.nome)}</option>`).join('');
    if (!eu.usuario) return mostrarLogin();
    if (eu.usuario.trocar) return mostrarTroca(true, eu.usuario);
    S.eu = eu.usuario; S.areas = eu.areas; S.canais = eu.canais; S.prioridades = eu.prioridades; S.repeticoes = eu.repeticoes; S.fuso = eu.fuso || S.fuso; S.modelo = eu.modelo; S.hoje = N.hoje(S.fuso);
    const quem = ler('compasso-who');
    S.who = quem && (quem === 'all' || PESSOAS()[quem]) ? quem : (PESSOAS()[S.eu.id] ? S.eu.id : 'all');
    // Abre com o último estado (na hora); a verdade do servidor chega logo depois.
    try { const c = JSON.parse(ler('compasso-cache') || 'null'); if (c && c.eu === S.eu.id && Array.isArray(c.tarefas)) { S.tarefas = c.tarefas; S.arquivadas = c.arquivadas || 0; S.resumo = c.resumo; } } catch { /* cache é opcional */ }
    mostrarApp(); renderFiltroDir(); pintarAgora();
    await carregar();
    ligarTempoReal();
    rotear();
    api('GET', '/api/sugestoes').then((s) => { S.sug = s; contarSugestoes(); S.normalizados = new Set(s.normalizados || []); pintar(); }).catch(() => {});
    carregarChat(); carregarNovidades();
    // Passou da meia-noite em Paris com o app aberto: "hoje" muda sozinho.
    if (!iniciar.relogio) iniciar.relogio = setInterval(() => { const h = N.hoje(S.fuso); if (h !== S.hoje) { S.hoje = h; pintar(); } if (!fonte && !document.hidden) ligarTempoReal(); if (!fonte || fonte.readyState !== 1) carregar().catch(() => {}); }, 60000);
    if ('serviceWorker' in navigator && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') navigator.serviceWorker.register('/sw.js').catch(() => {});
    return undefined;
  }
  // Senha provisória: quem acabou de digitá-la não precisa digitar de novo na troca. Fica só na memória, por 5 min.
  let senhaRecente = null; let tmSenha;
  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault(); $('#lErr').textContent = '';
    const senha = $('#lPass').value;
    try {
      const r = await api('POST', '/api/login', { usuario: $('#lUser').value, senha });
      guardar('compasso-ultimo-login', $('#lUser').value);
      $('#lPass').value = '';
      if (r.usuario && r.usuario.trocar) { senhaRecente = senha; clearTimeout(tmSenha); tmSenha = setTimeout(() => { senhaRecente = null; }, 300000); }
      await iniciar();
    } catch (err) { $('#lErr').textContent = err.message; }
  });

  // ---------- trocar a senha ----------
  let trocaForcada = false;
  function mostrarTroca(forcada, usuario) {
    trocaForcada = !!forcada;
    fecharGaveta(); fecharPaleta();
    if (forcada) desligarTempoReal();
    $('#app').hidden = true; $('#tabbar').hidden = true; $('#login').hidden = true; $('#trocar').hidden = false;
    aplicarIdioma();
    const nome = (usuario && usuario.nome) || '';
    $('#tUser').value = (usuario && usuario.id) || '';
    $('#tDica').textContent = forcada ? t('pw_forced_hint', { n: nome }) : t('pw_change_hint');
    const pularAtual = forcada && !!senhaRecente;
    $('#tAtualBox').hidden = pularAtual;
    $('#tAtual').value = pularAtual ? senhaRecente : '';
    $('#tAtual').required = !pularAtual;
    $('#tNova').value = ''; $('#tConf').value = ''; $('#tErr').textContent = '';
    $('#tVoltar').textContent = forcada ? t('logout') : t('pw_cancel');
    (pularAtual ? $('#tNova') : $('#tAtual')).focus();
  }
  $('#trocarForm').addEventListener('submit', async (e) => {
    e.preventDefault(); $('#tErr').textContent = '';
    const nova = $('#tNova').value;
    if (nova.length < 10) { $('#tErr').textContent = t('pw_short'); $('#tNova').focus(); return; }
    if (nova !== $('#tConf').value) { $('#tErr').textContent = t('pw_mismatch'); $('#tConf').focus(); return; }
    const botao = $('#trocarForm button[type=submit]'); botao.disabled = true;
    try {
      await api('POST', '/api/senha', { atual: $('#tAtual').value, nova });
      senhaRecente = null; $('#tAtual').value = ''; $('#tNova').value = ''; $('#tConf').value = '';
      $('#trocar').hidden = true;
      await iniciar();
      toast(t('pw_saved'));
    } catch (err) {
      $('#tErr').textContent = err.message;
      if (err.dados && err.dados.senha_atual) { senhaRecente = null; $('#tAtualBox').hidden = false; $('#tAtual').required = true; $('#tAtual').value = ''; $('#tAtual').focus(); }
    } finally { botao.disabled = false; }
  });
  $('#tVoltar').addEventListener('click', async () => {
    if (!trocaForcada) { $('#trocar').hidden = true; $('#app').hidden = false; $('#tabbar').hidden = false; return; }
    senhaRecente = null;
    try { await api('POST', '/api/logout', {}); } catch { /* já saiu */ }
    location.reload();
  });
  $('#euBtn').addEventListener('click', async () => {
    const b = $('#euBtn');
    if (b.dataset.confirm !== '1') { b.dataset.confirm = '1'; toast(t('logout_again')); setTimeout(() => { b.dataset.confirm = ''; }, 3000); return; }
    guardar('compasso-cache', null); guardar('compasso-rascunho', null);
    await api('POST', '/api/logout', {}); location.reload();
  });

  // ---------- aviso ----------
  let tmToast;
  function toast(s, opts) {
    const x = $('#toast');
    x.innerHTML = `<span>${esc(s)}</span>${opts && opts.acao ? `<button type="button" id="toastAcao">${esc(opts.acao)}</button>` : ''}`;
    x.classList.add('show');
    if (opts && opts.acao) $('#toastAcao').addEventListener('click', () => { x.classList.remove('show'); opts.fn(); });
    clearTimeout(tmToast); tmToast = setTimeout(() => x.classList.remove('show'), opts && opts.acao ? 6000 : 3200);
  }

  iniciar().catch((err) => {
    // Sem rede e com cache: mostra o último estado em vez de uma tela de erro.
    let c = null; try { c = JSON.parse(ler('compasso-cache') || 'null'); } catch { /* sem cache */ }
    if (c && Array.isArray(c.tarefas) && !/sess/.test(err.message)) {
      window.addEventListener('online', () => location.reload());
      S.eu = { id: c.eu, nome: c.eu }; S.tarefas = c.tarefas; S.resumo = c.resumo; S.pessoas = [{ id: 'marlon', nome: 'Márlon' }, { id: 'lucas', nome: 'Lucas' }, { id: 'julien', nome: 'Julien' }];
      S.prioridades = ['alta', 'normal', 'baixa']; S.canais = []; S.areas = ['Clientes', 'Site', 'Chauffeur', 'Catálogo', 'Operação']; S.repeticoes = ['', 'diaria', 'dias_uteis', 'semanal', 'mensal'];
      mostrarApp(); renderFiltroDir(); pintarAgora(); toast(t('offline'));
      return;
    }
    if (!/sess/.test(err.message)) { $('#login').hidden = false; $('#lErr').textContent = err.message; }
  });
})();
