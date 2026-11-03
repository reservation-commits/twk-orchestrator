/* COMPASSO Tarefas — front. Fala só com /api/*. Estado vem do servidor; nada é inventado aqui.
   Idioma (PT-BR / FR): textos em i18n.js; dados (área, canal, status) seguem em português no servidor, só o rótulo muda. */
(function () {
  'use strict';
  const $ = (s, el) => (el || document).querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------- idioma ----------
  const I18N = window.COMPASSO_I18N || { pt: {} };
  let LANG = 'pt';
  try { const l = localStorage.getItem('compasso-lang'); if (I18N[l]) LANG = l; else if (/^fr/i.test(navigator.language || '')) LANG = 'fr'; } catch { /* opcional */ }
  const t = (k, vars) => { let s = (I18N[LANG] && I18N[LANG][k]) ?? (I18N.pt[k] ?? k); if (vars) for (const [a, b] of Object.entries(vars)) s = s.split(`{${a}}`).join(b); return s; };
  const pl = (k, n, vars) => { const [s, p] = t(k).split('|'); let r = n === 1 ? s : (p || s); r = r.split('{n}').join(n); if (vars) for (const [a, b] of Object.entries(vars)) r = r.split(`{${a}}`).join(b); return r; };
  const MO = () => I18N[LANG]._months, WD = () => I18N[LANG]._weekdays;
  const COLS = () => [['todo', t('col_todo')], ['doing', t('col_doing')], ['wait', t('col_wait')], ['done', t('col_done')]];
  const colLabel = (k) => (COLS().find((c) => c[0] === k) || [k, k])[1];
  const areaLabel = (a) => t('area_' + a);
  const canalLabel = (c) => (c ? t('canal_' + c) : t('canal_none'));
  function applyLang() {
    document.documentElement.lang = I18N[LANG]._lang || LANG;
    document.querySelectorAll('[data-i]').forEach((el) => { el.textContent = t(el.dataset.i); });
    document.querySelectorAll('[data-i-ph]').forEach((el) => { el.placeholder = t(el.dataset.iPh); });
    document.querySelectorAll('[data-i-title]').forEach((el) => { el.title = t(el.dataset.iTitle); });
    document.querySelectorAll('.lang button').forEach((b) => b.classList.toggle('on', b.dataset.l === LANG));
  }
  document.addEventListener('click', (e) => {
    const b = e.target.closest('.lang [data-l]'); if (!b || b.dataset.l === LANG) return;
    LANG = b.dataset.l; try { localStorage.setItem('compasso-lang', LANG); } catch { /* opcional */ }
    applyLang(); if (S.eu) { renderAll(); carregarChat(); }
  });

  const S = { eu: null, pessoas: [], areas: [], canais: [], prioridades: [], tarefas: [], arquivadas: 0, hoje: '', who: 'all', calDay: null, sug: { itens: [] }, pending: null, modelo: '' };
  const PESSOAS = () => Object.fromEntries(S.pessoas.map((p) => [p.id, p.nome]));

  // ---------- API ----------
  async function api(metodo, rota, corpo) {
    const r = await fetch(rota, { method: metodo, headers: { 'content-type': 'application/json', 'x-requested-with': 'fetch' }, body: corpo ? JSON.stringify(corpo) : undefined, credentials: 'same-origin' });
    let j = {}; try { j = await r.json(); } catch { /* sem corpo */ }
    if (r.status === 401 && rota !== '/api/login') { mostrarLogin(); throw new Error(t('session_expired')); }
    if (!r.ok) throw new Error(j.erro || `erro ${r.status}`);
    return j;
  }

  // ---------- util de data ----------
  const hojeDate = () => new Date(S.hoje + 'T00:00:00');
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const fmt = (d) => { if (!d) return t('no_date'); const x = new Date(d + 'T00:00:00'); return `${x.getDate()} ${MO()[x.getMonth()]}`; };
  const hora = (ts) => { const d = new Date(ts); const p = (n) => String(n).padStart(2, '0'); return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`; };
  const dueClass = (x) => { if (!x.vence_em || x.estado === 'done') return ''; const diff = (new Date(x.vence_em + 'T00:00:00') - hojeDate()) / 864e5; return diff < 0 ? 'late' : diff < 2 ? 'soon' : ''; };
  const prog = (x) => (x.etapas.length ? x.etapas.filter((e) => e.feita).length / x.etapas.length : 0);
  const av = (w, xs) => { const n = PESSOAS()[w] || '?'; return `<span class="av ${esc(w)} ${xs ? 'xs' : ''}" title="${esc(n)}">${esc(n.slice(0, 2).toUpperCase())}</span>`; };
  const short = (s) => (s.length > 42 ? s.slice(0, 40) + '…' : s);
  const prioMark = (x) => (x.prioridade === 'alta' ? `<span class="prio alta" title="${esc(t('prio_mark_alta'))}">!</span>` : x.prioridade === 'baixa' ? `<span class="prio baixa" title="${esc(t('prio_mark_baixa'))}">·</span>` : '');

  // ---------- quadro ----------
  function renderBoard() {
    const board = $('#board'); board.innerHTML = '';
    const H = hojeDate(); const seg = addDays(H, -((H.getDay() + 6) % 7));
    $('#boardTitle').textContent = t('week_of', { a: fmt(iso(seg)), b: fmt(iso(addDays(seg, 6))) });
    for (const [key, label] of COLS()) {
      const list = S.tarefas.filter((x) => x.estado === key && (S.who === 'all' || x.dono === S.who)).sort((a, b) => (a.prioridade === 'alta' ? 0 : 1) - (b.prioridade === 'alta' ? 0 : 1) || String(a.vence_em || '9999').localeCompare(String(b.vence_em || '9999')));
      const col = document.createElement('div'); col.className = 'col'; col.dataset.st = key;
      col.innerHTML = `<h2>${esc(label)}<i>${list.length}</i></h2>`;
      for (const x of list) {
        const c = document.createElement('button'); c.className = 'card' + (x.estado === 'done' ? ' done' : '') + (x.prioridade === 'alta' && x.estado !== 'done' ? ' hot' : ''); c.draggable = true; c.dataset.id = x.id;
        const dc = dueClass(x);
        c.innerHTML = `<span class="hd"><span class="tag">${esc(areaLabel(x.area))}${x.cidade ? ` · ${esc(x.cidade)}` : ''}</span>${prioMark(x)}</span><span class="t">${esc(x.titulo)}</span>
          ${x.referencia ? `<span class="ref" title="${esc(t('f_ref'))}">${esc(x.referencia)}</span>` : ''}
          <span class="m"><span>${av(x.dono)} ${esc(PESSOAS()[x.dono] || x.dono)}${x.canal ? ` <span class="ch">· ${esc(canalLabel(x.canal))}</span>` : ''}</span><span class="due ${dc}">${dc === 'late' ? t('late') + ' · ' : ''}${fmt(x.vence_em)}</span></span>
          ${x.etapas.length ? `<span class="steps" title="${x.etapas.filter((e) => e.feita).length} ${t('of')} ${x.etapas.length} ${pl('steps', x.etapas.length)}"><i style="width:${prog(x) * 100}%"></i></span>` : ''}`;
        c.addEventListener('click', () => openEditor(x.id));
        c.addEventListener('dragstart', (e) => e.dataTransfer.setData('text/plain', x.id));
        col.appendChild(c);
      }
      if (key === 'todo') { const a = document.createElement('button'); a.className = 'add'; a.textContent = t('new_task'); a.addEventListener('click', () => openEditor(null)); col.appendChild(a); }
      col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('over'); });
      col.addEventListener('dragleave', () => col.classList.remove('over'));
      col.addEventListener('drop', async (e) => {
        e.preventDefault(); col.classList.remove('over');
        const id = e.dataTransfer.getData('text/plain'); const x = S.tarefas.find((y) => y.id === id);
        if (!x || x.estado === key) return;
        try { await api('PATCH', `/api/tarefas/${id}`, { estado: key }); await carregar(); toast(t('moved', { t: short(x.titulo), c: label })); } catch (err) { toast(err.message); }
      });
      board.appendChild(col);
    }
    $('#arcCount').textContent = S.arquivadas;
  }
  function renderFiltros() {
    const f = $('#whoFilter');
    f.innerHTML = `<button class="chip ${S.who === 'all' ? 'on' : ''}" data-w="all">${esc(t('all'))}</button>` + S.pessoas.map((p) => `<button class="chip ${S.who === p.id ? 'on' : ''}" data-w="${p.id}">${av(p.id, true)}${esc(p.nome)}</button>`).join('');
  }
  $('#whoFilter').addEventListener('click', (e) => { const b = e.target.closest('.chip'); if (!b) return; S.who = b.dataset.w; try { localStorage.setItem('compasso-who', S.who); } catch { /* opcional */ } renderAll(); });

  // ---------- calendário ----------
  function renderCal() {
    const strip = $('#strip'); strip.innerHTML = '';
    const H = hojeDate();
    for (let i = 0; i < 14; i++) {
      const d = addDays(H, i); const k = iso(d);
      const n = S.tarefas.filter((x) => x.vence_em === k && x.estado !== 'done' && (S.who === 'all' || x.dono === S.who)).length;
      const el = document.createElement('button'); el.className = 'day' + (i === 0 ? ' today' : '') + (S.calDay === k ? ' on' : '') + (d.getDay() % 6 === 0 ? ' wk' : '');
      el.innerHTML = `<small>${WD()[d.getDay()]}</small><b>${d.getDate()}</b><span class="dots">${'<i></i>'.repeat(Math.min(n, 4))}</span>`;
      el.addEventListener('click', () => { S.calDay = S.calDay === k ? null : k; renderCal(); }); strip.appendChild(el);
    }
    const feed = $('#feed'); feed.innerHTML = '';
    const open = S.tarefas.filter((x) => x.estado !== 'done' && (S.who === 'all' || x.dono === S.who));
    const groups = [];
    const late = open.filter((x) => dueClass(x) === 'late').sort((a, b) => a.vence_em.localeCompare(b.vence_em));
    if (!S.calDay && late.length) groups.push({ lab: t('late_group'), sub: `${late.length} ${pl('tasks', late.length)}`, late: true, items: late });
    for (let i = 0; i < 14; i++) {
      const d = addDays(H, i); const k = iso(d); if (S.calDay && S.calDay !== k) continue;
      const items = open.filter((x) => x.vence_em === k);
      if (items.length || S.calDay === k) groups.push({ lab: `${d.getDate()} ${MO()[d.getMonth()]}`, sub: i === 0 ? t('today') : i === 1 ? t('tomorrow') : WD()[d.getDay()], items });
    }
    if (!S.calDay) { const nd = open.filter((x) => !x.vence_em); if (nd.length) groups.push({ lab: t('no_date_group'), sub: t('define'), items: nd }); }
    if (!groups.length) { feed.innerHTML = `<p class="hintline">${esc(t('nothing_period'))}</p>`; return; }
    for (const g of groups) {
      const el = document.createElement('div'); el.className = 'fday';
      el.innerHTML = `<div class="lab ${g.late ? 'late' : ''}">${esc(g.lab)}<small>${esc(g.sub)}</small></div><div class="items">${g.items.length ? '' : `<span class="hintline">${esc(t('none_this_day'))}</span>`}</div>`;
      const box = el.querySelector('.items');
      for (const x of g.items) { const b = document.createElement('button'); b.className = 'fitem'; b.innerHTML = `${av(x.dono)}<span><span class="t">${prioMark(x)}${esc(x.titulo)}</span><br><span class="s">${esc(areaLabel(x.area))}${x.cidade ? ` · ${esc(x.cidade)}` : ''}${x.referencia ? ` · ${esc(x.referencia)}` : ''} · ${x.etapas.filter((e) => e.feita).length}/${x.etapas.length} ${pl('steps', x.etapas.length)}</span></span><span class="state ${x.estado}">${esc(colLabel(x.estado))}</span>`; b.addEventListener('click', () => openEditor(x.id)); box.appendChild(b); }
      feed.appendChild(el);
    }
  }

  // ---------- gaveta ----------
  const drawer = $('#drawer'), scrim = $('#scrim');
  function openDrawer(html) { drawer.innerHTML = html; drawer.classList.add('open'); drawer.setAttribute('aria-hidden', 'false'); scrim.classList.add('on'); }
  function closeDrawer() { drawer.classList.remove('open'); drawer.setAttribute('aria-hidden', 'true'); scrim.classList.remove('on'); }
  scrim.addEventListener('click', closeDrawer);
  const opt = (v, label, sel) => `<option value="${esc(v)}" ${sel ? 'selected' : ''}>${esc(label)}</option>`;

  // ---------- editor do card ----------
  async function openEditor(id, rascunhoInicial, deArquivo) {
    const donoPadrao = S.pessoas.some((p) => p.id === S.eu.id) ? S.eu.id : S.pessoas[0].id; // admin não é dono: cai na primeira pessoa
    const vazio = { titulo: '', area: 'Operação', dono: donoPadrao, vence_em: '', estado: 'todo', etapas: [], notas: '', prioridade: 'normal', cidade: '', canal: '', referencia: '', resultado: '' };
    const base = id ? (deArquivo || S.tarefas.find((x) => x.id === id)) : { ...vazio, ...(rascunhoInicial || {}) };
    if (!base) return;
    if (!id && base.dono == null) base.dono = donoPadrao;
    const draft = JSON.parse(JSON.stringify({ ...vazio, ...base }));
    let hist = [];
    if (id) { try { hist = (await api('GET', `/api/tarefas/${id}/eventos`)).eventos.slice(-8).reverse(); } catch { hist = []; } }
    const origemTxt = (o) => (!o || !o.tipo || o.tipo === 'manual' ? '' : o.tipo === 'chat' ? t('from_chat') : o.tipo === 'mcp' ? t('via_claude') : o.tipo === 'sugestao' ? t('from_sug') : o.tipo);
    const nomeDe = (q) => PESSOAS()[String(q || '').split(' ')[0]] || q || '';
    const paint = () => {
      const done = draft.estado === 'done';
      openDrawer(`<header><h2>${id ? esc(id) : esc(t('ed_new'))}</h2><button class="btn ghost sm" id="dClose">${esc(t('close'))}</button></header>
      <div class="body">
        <div class="field"><label for="fT">${esc(t('f_what'))}</label><textarea id="fT">${esc(draft.titulo)}</textarea></div>
        <div class="row2">
          <div class="field"><label for="fW">${esc(t('f_who'))}</label><select id="fW">${S.pessoas.map((p) => opt(p.id, p.nome, draft.dono === p.id)).join('')}</select></div>
          <div class="field"><label for="fD">${esc(t('f_due'))}</label><input type="date" id="fD" value="${esc(draft.vence_em || '')}"></div>
        </div>
        <div class="row3">
          <div class="field"><label for="fS">${esc(t('f_status'))}</label><select id="fS">${COLS().map(([k, v]) => opt(k, v, draft.estado === k)).join('')}</select></div>
          <div class="field"><label for="fA">${esc(t('f_area'))}</label><select id="fA">${S.areas.map((a) => opt(a, areaLabel(a), draft.area === a)).join('')}</select></div>
          <div class="field"><label for="fP">${esc(t('f_prio'))}</label><select id="fP">${S.prioridades.map((p) => opt(p, t('prio_' + p), draft.prioridade === p)).join('')}</select></div>
        </div>
        <details class="ctx" ${draft.cidade || draft.canal || draft.referencia ? 'open' : ''}><summary>${esc(t('sec_context'))}${draft.referencia ? ` · <span class="ref">${esc(draft.referencia)}</span>` : ''}</summary>
          <div class="row3">
            <div class="field"><label for="fC">${esc(t('f_city'))}</label><input type="text" id="fC" maxlength="40" value="${esc(draft.cidade)}" placeholder="${esc(t('f_city_ph'))}" list="cidades"><datalist id="cidades"><option>Paris</option><option>Lagos</option><option>Marrakech</option><option>Nice</option><option>Monaco</option><option>Athens</option><option>Lisboa</option></datalist></div>
            <div class="field"><label for="fK">${esc(t('f_channel'))}</label><select id="fK">${opt('', t('canal_none'), !draft.canal)}${S.canais.map((c) => opt(c, canalLabel(c), draft.canal === c)).join('')}</select></div>
            <div class="field"><label for="fR">${esc(t('f_ref'))}</label><input type="text" id="fR" maxlength="120" value="${esc(draft.referencia)}" placeholder="${esc(t('f_ref_ph'))}"></div>
          </div>
        </details>
        <div class="field"><label>${esc(t('f_steps'))}</label><div class="steplist" id="fSteps">${draft.etapas.map((s, i) => `<label class="step ${s.feita ? 'done' : ''}"><input type="checkbox" data-i="${i}" ${s.feita ? 'checked' : ''}><span>${esc(s.texto)}</span><button type="button" class="x" data-x="${i}" aria-label="×">×</button></label>`).join('') || `<span class="hintline">${esc(t('no_steps'))}</span>`}</div>
          <div class="addstep"><input type="text" id="fNew" placeholder="${esc(t('new_step'))}"><button class="btn sm" id="fAdd" type="button">${esc(t('add'))}</button></div></div>
        <div class="field"><label for="fN">${esc(t('f_notes'))}</label><textarea id="fN" placeholder="${esc(t('f_notes_ph'))}">${esc(draft.notas || '')}</textarea></div>
        <div class="field ${done ? '' : 'dim'}"><label for="fRes">${esc(t('f_result'))}</label><textarea id="fRes" placeholder="${esc(t('f_result_ph'))}">${esc(draft.resultado || '')}</textarea>${done && !draft.resultado ? `<span class="hintline">${esc(t('result_hint'))}</span>` : ''}</div>
        ${id ? `<p class="hintline">${esc(t('created_by'))} ${esc(nomeDe(draft.criado_por))}${origemTxt(draft.origem) ? ` · ${esc(origemTxt(draft.origem))}` : ''} · ${esc(hora(draft.criado_em))}${draft.arquivada_em ? ` · ${esc(t('archived_on'))} ${esc(hora(draft.arquivada_em))}` : ''}</p>` : ''}
        ${hist.length ? `<div class="field"><label>${esc(t('history'))}</label><div class="hist">${hist.map((h) => `<span>${esc(hora(h.ts))} · ${esc(nomeDe(h.quem))} · ${esc(h.tipo)}${h.mudou && h.mudou.estado ? ` → ${esc(colLabel(h.mudou.estado.para))}` : ''}${h.motivo ? ` · ${esc(h.motivo)}` : ''}</span>`).join('')}</div></div>` : ''}
        <div class="delbox" id="delBox" hidden><div class="field"><label for="fMot">${esc(t('del_why'))}</label><input type="text" id="fMot" maxlength="300" placeholder="${esc(t('del_why_ph'))}"></div><div class="acts"><button class="btn sm danger" id="dDelOk">${esc(t('del_confirm'))}</button><button class="btn ghost sm" id="dDelNo">${esc(t('del_cancel'))}</button></div></div>
      </div>
      <footer>${id ? (base.estado === 'done' ? (draft.arquivada_em ? `<button class="btn ghost sm" id="dUnarc">${esc(t('unarchive'))}</button>` : `<button class="btn ghost sm" id="dArc">${esc(t('archive'))}</button>`) : `<button class="btn ghost sm" id="dDel">${esc(t('del'))}</button>`) : '<span></span>'}<button class="btn gold" id="dSave">${esc(t('save'))}</button></footer>`);
      const g = (s) => $(s, drawer);
      const sync = () => { draft.titulo = g('#fT').value; draft.dono = g('#fW').value; draft.vence_em = g('#fD').value; draft.estado = g('#fS').value; draft.area = g('#fA').value; draft.prioridade = g('#fP').value; draft.cidade = g('#fC').value; draft.canal = g('#fK').value; draft.referencia = g('#fR').value; draft.notas = g('#fN').value; draft.resultado = g('#fRes').value; };
      g('#dClose').addEventListener('click', closeDrawer);
      g('#fS').addEventListener('change', () => { sync(); paint(); });
      g('#fSteps').addEventListener('change', (e) => { const i = e.target.dataset.i; if (i != null) { sync(); draft.etapas[i].feita = e.target.checked; paint(); } });
      g('#fSteps').addEventListener('click', (e) => { const x = e.target.closest('[data-x]'); if (x) { sync(); draft.etapas.splice(Number(x.dataset.x), 1); paint(); } });
      g('#fAdd').addEventListener('click', () => { const v = g('#fNew').value.trim(); if (!v) return; sync(); draft.etapas.push({ texto: v, feita: false }); paint(); });
      g('#fNew').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); g('#fAdd').click(); } });
      g('#dSave').addEventListener('click', async () => {
        sync();
        const corpo = { titulo: draft.titulo, area: draft.area, dono: draft.dono, vence_em: draft.vence_em || null, estado: draft.estado, etapas: draft.etapas, notas: draft.notas, prioridade: draft.prioridade, cidade: draft.cidade, canal: draft.canal, referencia: draft.referencia, resultado: draft.resultado };
        if (!id && draft.origem) corpo.origem = draft.origem;
        try { if (id) await api('PATCH', `/api/tarefas/${id}`, corpo); else await api('POST', '/api/tarefas', corpo); await carregar(); closeDrawer(); toast(t('saved')); } catch (err) { toast(err.message); }
      });
      if (g('#dDel')) g('#dDel').addEventListener('click', () => { g('#delBox').hidden = false; g('#fMot').focus(); g('#dDel').disabled = true; });
      if (g('#dDelNo')) g('#dDelNo').addEventListener('click', () => { g('#delBox').hidden = true; g('#dDel').disabled = false; });
      if (g('#dDelOk')) g('#dDelOk').addEventListener('click', async () => {
        const motivo = g('#fMot').value.trim(); if (motivo.length < 5) { toast(t('del_need')); return; }
        try { await api('DELETE', `/api/tarefas/${id}`, { motivo }); await carregar(); closeDrawer(); toast(t('del_done')); } catch (err) { toast(err.message); }
      });
      if (g('#dArc')) g('#dArc').addEventListener('click', async () => { try { await api('POST', `/api/tarefas/${id}/arquivar`, {}); await carregar(); closeDrawer(); toast(t('archived_ok')); } catch (err) { toast(err.message); } });
      if (g('#dUnarc')) g('#dUnarc').addEventListener('click', async () => { try { await api('POST', `/api/tarefas/${id}/desarquivar`, {}); await carregar(); closeDrawer(); toast(t('unarchived_ok')); } catch (err) { toast(err.message); } });
    };
    paint();
  }

  // ---------- gaveta: arquivo ----------
  async function openArchive(q) {
    let r; try { r = await api('GET', '/api/arquivo' + (q ? '?q=' + encodeURIComponent(q) : '')); } catch (err) { toast(err.message); return; }
    openDrawer(`<header><h2>${esc(t('archive_title'))}</h2><button class="btn ghost sm" id="dClose">${esc(t('close'))}</button></header>
      <div class="body"><input type="search" id="arcQ" class="search" placeholder="${esc(t('archive_search'))}" value="${esc(q || '')}">
      <p class="hintline">${esc(pl('archive_count', r.total))}</p>
      ${r.tarefas.length ? r.tarefas.map((x) => `<button class="fitem arc" data-id="${esc(x.id)}">${av(x.dono)}<span><span class="t">${esc(x.titulo)}</span><br><span class="s">${esc(areaLabel(x.area))}${x.cidade ? ` · ${esc(x.cidade)}` : ''}${x.referencia ? ` · ${esc(x.referencia)}` : ''} · ${esc(t('done_on'))} ${esc(String(x.concluido_em || '').slice(0, 10))}</span>${x.resultado ? `<br><span class="s res">${esc(x.resultado.slice(0, 140))}${x.resultado.length > 140 ? '…' : ''}</span>` : ''}</span><span class="state done">${esc(x.id)}</span></button>`).join('') : `<p class="hintline">${esc(t('archive_empty'))}</p>`}</div>`);
    const lista = r.tarefas;
    $('#dClose', drawer).addEventListener('click', closeDrawer);
    let tm2; $('#arcQ', drawer).addEventListener('input', (e) => { clearTimeout(tm2); tm2 = setTimeout(() => openArchive(e.target.value.trim()), 300); });
    $('.body', drawer).addEventListener('click', (e) => { const b = e.target.closest('.arc'); if (!b) return; const x = lista.find((y) => y.id === b.dataset.id); if (x) openEditor(x.id, null, x); });
  }
  $('#arcBtn').addEventListener('click', () => openArchive(''));

  // ---------- gaveta: sugestões ----------
  async function openSugs(atualizar) {
    openDrawer(`<header><h2>${esc(t('sug_title'))}</h2><button class="btn ghost sm" id="dClose">${esc(t('close'))}</button></header><div class="body"><p class="hintline">${esc(t('sug_reading'))}</p></div>`);
    $('#dClose', drawer).addEventListener('click', closeDrawer);
    try { S.sug = await api('GET', '/api/sugestoes' + (atualizar ? '?atualizar=1' : '')); } catch (err) { toast(err.message); return; }
    $('#sugCount').textContent = S.sug.itens.length;
    const lac = (S.sug.cobertura || []).filter((c) => !c.ok);
    const lidas = (S.sug.cobertura || []).filter((c) => c.ok).map((c) => c.fonte + (c.origem === 'api' ? ' (Central)' : c.origem === 'banco' ? ' (twk_ro)' : '') + (c.lacuna ? ` — ${t('partial')}: ${c.lacuna}` : ''));
    openDrawer(`<header><h2>${esc(t('sug_title'))}</h2><div><button class="btn ghost sm" id="dRefresh">${esc(t('refresh'))}</button><button class="btn ghost sm" id="dClose">${esc(t('close'))}</button></div></header>
      <div class="body">${S.sug.itens.length ? S.sug.itens.map((s) => `<div class="sug" data-s="${s.id}"><span class="tag">${esc(areaLabel(s.area))}${s.prioridade_fixa ? ' · ' + esc(t('priority')) : ''}</span><span class="t">${esc(s.titulo)}</span><span class="why">${esc(s.porque)} <em>(${esc(s.fonte)})</em></span>
        <span class="who">${esc(t('sug_take'))} <span class="pick">${S.pessoas.map((p) => `<button data-take="${p.id}">${av(p.id)}${esc(p.nome)}</button>`).join('')}</span></span>
        <span class="who"><button class="btn ghost sm" data-skip="${s.id}">${esc(t('sug_skip'))}</button></span></div>`).join('') : `<p class="hintline">${esc(t('sug_none'))}</p>`}
      ${S.sug.marco_zero ? `<p class="hintline">${esc(t('sug_marco', { d: fmt(S.sug.marco_zero) }))}</p>` : ''}
      ${lidas.length ? `<p class="hintline">${esc(t('sug_read', { f: lidas.join(', ') }))}</p>` : ''}
      ${lac.length ? `<p class="hintline">${esc(t('sug_lac', { f: lac.map((c) => c.fonte + (c.lacuna ? ` (${c.lacuna})` : '')).join(', ') }))}</p>` : ''}
      <p class="hintline">${S.sug.geradas_em ? esc(t('sug_at', { d: hora(S.sug.geradas_em) })) : ''}${S.sug.decididas ? ' · ' + esc(t('sug_decided', { n: S.sug.decididas })) : ''}</p></div>`);
    $('#dClose', drawer).addEventListener('click', closeDrawer);
    $('#dRefresh', drawer).addEventListener('click', () => openSugs(true));
    $('.body', drawer).addEventListener('click', async (e) => {
      const take = e.target.closest('[data-take]'); const skip = e.target.closest('[data-skip]');
      try {
        if (take) { const sid = take.closest('.sug').dataset.s; const r = await api('POST', `/api/sugestoes/${sid}/assumir`, { dono: take.dataset.take }); await carregar(); toast(t('sug_took', { p: PESSOAS()[take.dataset.take], d: fmt(r.tarefa.vence_em) })); openSugs(); }
        if (skip) { await api('POST', `/api/sugestoes/${skip.dataset.skip}/descartar`, {}); toast(t('sug_skipped')); openSugs(); }
      } catch (err) { toast(err.message); }
    });
  }
  $('#sugBtn').addEventListener('click', () => openSugs(false));

  // ---------- chat ----------
  const msgs = $('#msgs');
  function addMsg(html, me, rotulo) { const m = document.createElement('div'); m.className = 'msg' + (me ? ' me' : ''); m.innerHTML = `<span class="who">${esc(rotulo || (me ? t('chat_you') : t('chat_planner')))}</span>${html}`; msgs.appendChild(m); msgs.scrollTop = msgs.scrollHeight; return m; }
  const metaHtml = (p) => `${p.dono ? av(p.dono) + ' ' + esc(PESSOAS()[p.dono] || '') : esc(t('chat_no_owner'))}${p.dono && p.pessoa_citada === false ? esc(t('chat_you_swap')) : ''} <span>· ${p.vence_em ? esc(t('chat_until', { d: fmt(p.vence_em) })) : esc(t('chat_no_due'))}</span><span>· ${(p.etapas || []).length} ${pl('steps', (p.etapas || []).length)}</span>`;
  function proposeHtml(p) {
    return `<p>${esc(p.origem_modelo ? t('chat_ok') : t('chat_ok_heur'))} ${esc(t('chat_propose'))}${p.motivo ? `, ${esc(p.motivo)}` : ''}:</p>
    <div class="prop"><span class="tag">${esc(areaLabel(p.area))}</span><span class="t">${esc(p.titulo)}</span><ol>${p.etapas.map((s) => `<li>${esc(s)}</li>`).join('')}</ol><span class="meta">${metaHtml(p)}</span></div>
    <div class="acts"><button class="btn gold sm" data-c="create">${esc(t('create_card'))}</button><button class="btn sm" data-c="who">${esc(t('swap_who'))}</button><button class="btn ghost sm" data-c="edit">${esc(t('adjust'))}</button></div>`;
  }
  function historicoHtml(p) { return `<div class="prop"><span class="tag">${esc(areaLabel(p.area))}</span><span class="t">${esc(p.titulo)}</span><ol>${(p.etapas || []).map((s) => `<li>${esc(s)}</li>`).join('')}</ol><span class="meta">${metaHtml({ ...p, pessoa_citada: true })}</span></div>`; }
  async function carregarChat() {
    let h; try { h = await api('GET', '/api/chat'); } catch { return; }
    msgs.innerHTML = '';
    for (const m of h.mensagens || []) {
      const via = m.canal === 'mcp' ? t('chat_via') : ''; const q = m.ts ? ' · ' + hora(m.ts) : '';
      const quemLabel = S.eu.id === 'admin' && m.quem && m.quem !== 'admin' ? ` (${PESSOAS()[m.quem] || m.quem})` : '';
      if (m.papel === 'pessoa') addMsg(`<p>${esc(m.texto || '')}</p>`, true, `${t('chat_you')}${quemLabel}${via}${q}`);
      else if (m.tarefa_id) addMsg(`<p>${esc(m.texto || m.tarefa_id)}</p>`, false, `${t('chat_planner')}${via}${q}`);
      else if (m.proposta) addMsg(historicoHtml(m.proposta), false, `${t('chat_planner')}${via}${q}`);
    }
    if ((h.mensagens || []).length) addMsg(`<p class="hintline">${esc(t('chat_hist_end'))}</p>`);
    else { const r = S.tarefas; const late = r.filter((x) => dueClass(x) === 'late').length; const hoje = r.filter((x) => x.vence_em === S.hoje && x.estado !== 'done').length; addMsg(`<p>${t('hello', { n: esc(S.eu.nome), late: pl('late_count', late), today: hoje })}</p>`); }
  }
  $('#composer').addEventListener('submit', async (e) => {
    e.preventDefault(); const inp = $('#input'); const v = inp.value.trim(); if (!v) return;
    addMsg(`<p>${esc(v)}</p>`, true); inp.value = '';
    const espera = addMsg(`<p class="hintline">${esc(t('chat_wait'))}</p>`);
    try {
      const r = await api('POST', '/api/planejar', { texto: v, idioma: LANG }); S.pending = r.proposta; S.pending.conversa_id = r.conversa_id || '';
      if (!S.pending.dono) { S.pending.dono = S.pessoas[0].id; S.pending.pessoa_citada = false; } // admin sem nome no texto: começa na primeira pessoa, troca com um clique
      espera.innerHTML = `<span class="who">${esc(t('chat_planner'))}</span>${proposeHtml(S.pending)}`;
    }
    catch (err) { espera.innerHTML = `<span class="who">${esc(t('chat_planner'))}</span><p>${esc(err.message)}</p>`; }
  });
  $('#input').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#composer').requestSubmit(); } });
  msgs.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-c]'); if (!b || !S.pending) return; const box = b.closest('.msg'); const p = S.pending;
    if (b.dataset.c === 'who') { const ids = S.pessoas.map((x) => x.id); p.dono = ids[(ids.indexOf(p.dono) + 1) % ids.length]; p.pessoa_citada = true; box.querySelector('.meta').innerHTML = metaHtml(p); return; }
    const corpo = { titulo: p.titulo, area: p.area, dono: p.dono, vence_em: p.vence_em, estado: 'todo', etapas: p.etapas.map((s) => ({ texto: s, feita: false })), notas: p.motivo || '', origem: { tipo: 'chat', ref: p.conversa_id || '' } };
    if (b.dataset.c === 'edit') { openEditor(null, corpo); box.querySelector('.acts').innerHTML = `<span class="hintline">${esc(t('opened_editor'))}</span>`; S.pending = null; return; }
    if (b.dataset.c === 'create') {
      try { const r = await api('POST', '/api/tarefas', corpo); await carregar(); box.querySelector('.acts').innerHTML = `<span class="hintline">${esc(t('created_in', { id: r.tarefa.id, p: PESSOAS()[p.dono] }))}</span>`; addMsg(`<p>${esc(t('created_msg', { p: PESSOAS()[p.dono], cal: p.vence_em ? t('created_cal', { d: fmt(p.vence_em) }) : '' }))}</p>`); S.pending = null; }
      catch (err) { toast(err.message); }
    }
  });

  // ---------- vistas, sessão, carga ----------
  $('.views').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; document.querySelectorAll('.views button').forEach((x) => x.classList.toggle('on', x === b)); document.querySelectorAll('.view').forEach((v) => v.classList.toggle('on', v.id === 'v-' + b.dataset.v)); try { localStorage.setItem('compasso-view', b.dataset.v); } catch { /* opcional */ } });
  let ultimoResumo = null;
  function renderAll() { renderFiltros(); renderBoard(); renderCal(); $('#chatHint').textContent = S.modelo === 'ligado' ? t('chat_hint_model') : t('chat_hint_heur'); if (ultimoResumo) $('#rodape').textContent = t('footer', { a: ultimoResumo.abertas, l: ultimoResumo.atrasadas, d: ultimoResumo.concluidas_7d, ar: S.arquivadas }); }
  async function carregar() {
    const r = await api('GET', '/api/tarefas'); S.tarefas = r.tarefas; S.hoje = r.hoje; S.arquivadas = r.arquivadas || 0; ultimoResumo = r.resumo;
    renderAll();
  }
  function mostrarLogin() { $('#app').hidden = true; $('#login').hidden = false; applyLang(); }
  async function iniciar() {
    applyLang();
    const eu = await api('GET', '/api/eu');
    S.pessoas = eu.pessoas; S.areas = eu.areas || ['Clientes', 'Site', 'Chauffeur', 'Catálogo', 'Operação']; S.canais = eu.canais || []; S.prioridades = eu.prioridades || ['alta', 'normal', 'baixa']; S.modelo = eu.modelo;
    $('#lUser').innerHTML = (eu.usuarios || eu.pessoas).map((p) => `<option value="${p.id}">${esc(p.nome)}</option>`).join('');
    if (!eu.usuario) return mostrarLogin();
    S.eu = eu.usuario; $('#login').hidden = true; $('#app').hidden = false;
    $('#euAv').className = `av ${S.eu.id}`; $('#euAv').textContent = S.eu.nome.slice(0, 2).toUpperCase();
    try { S.who = localStorage.getItem('compasso-who') || 'all'; } catch { S.who = 'all'; }
    try { const v = localStorage.getItem('compasso-view'); if (v) document.querySelector(`.views [data-v="${v}"]`)?.click(); } catch { /* opcional */ }
    await carregar();
    try { S.sug = await api('GET', '/api/sugestoes'); $('#sugCount').textContent = S.sug.itens.length; } catch { /* sem sugestões */ }
    await carregarChat();
  }
  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault(); $('#lErr').textContent = '';
    try { await api('POST', '/api/login', { usuario: $('#lUser').value, senha: $('#lPass').value }); $('#lPass').value = ''; await iniciar(); }
    catch (err) { $('#lErr').textContent = err.message; }
  });
  $('#euBtn').addEventListener('click', async () => { if ($('#euBtn').dataset.confirm !== '1') { $('#euBtn').dataset.confirm = '1'; toast(t('logout_again')); setTimeout(() => { $('#euBtn').dataset.confirm = ''; }, 3000); return; } await api('POST', '/api/logout', {}); location.reload(); });

  let tm; function toast(s) { const x = $('#toast'); x.textContent = s; x.classList.add('show'); clearTimeout(tm); tm = setTimeout(() => x.classList.remove('show'), 3200); }
  iniciar().catch((err) => { if (!/sess/.test(err.message)) { $('#login').hidden = false; $('#lErr').textContent = err.message; } });
})();
