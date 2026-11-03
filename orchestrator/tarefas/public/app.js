/* COMPASSO Tarefas — front. Fala só com /api/*. Estado vem do servidor; nada é inventado aqui. */
(function () {
  'use strict';
  const $ = (s, el) => (el || document).querySelector(s);
  const COLS = [['todo', 'A fazer'], ['doing', 'Em andamento'], ['wait', 'Aguardando'], ['done', 'Concluída']];
  const AREAS = ['Clientes', 'Site', 'Chauffeur', 'Catálogo', 'Operação'];
  const WD = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
  const MO = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const S = { eu: null, pessoas: [], tarefas: [], hoje: '', who: 'all', calDay: null, sug: { itens: [] }, pending: null };
  const PESSOAS = () => Object.fromEntries(S.pessoas.map((p) => [p.id, p.nome]));

  // ---------- API ----------
  async function api(metodo, rota, corpo) {
    const r = await fetch(rota, { method: metodo, headers: { 'content-type': 'application/json', 'x-requested-with': 'fetch' }, body: corpo ? JSON.stringify(corpo) : undefined, credentials: 'same-origin' });
    let j = {}; try { j = await r.json(); } catch { /* sem corpo */ }
    if (r.status === 401 && rota !== '/api/login') { mostrarLogin(); throw new Error('sessão expirada'); }
    if (!r.ok) throw new Error(j.erro || `erro ${r.status}`);
    return j;
  }

  // ---------- util de data ----------
  const hojeDate = () => new Date(S.hoje + 'T00:00:00');
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const fmt = (d) => { if (!d) return 'sem data'; const x = new Date(d + 'T00:00:00'); return `${x.getDate()} ${MO[x.getMonth()]}`; };
  const dueClass = (t) => { if (!t.vence_em || t.estado === 'done') return ''; const diff = (new Date(t.vence_em + 'T00:00:00') - hojeDate()) / 864e5; return diff < 0 ? 'late' : diff < 2 ? 'soon' : ''; };
  const prog = (t) => (t.etapas.length ? t.etapas.filter((e) => e.feita).length / t.etapas.length : 0);
  const av = (w, xs) => { const n = PESSOAS()[w] || '?'; return `<span class="av ${esc(w)} ${xs ? 'xs' : ''}" title="${esc(n)}">${esc(n.slice(0, 2).toUpperCase())}</span>`; };
  const short = (s) => (s.length > 42 ? s.slice(0, 40) + '…' : s);

  // ---------- quadro ----------
  function renderBoard() {
    const board = $('#board'); board.innerHTML = '';
    const semana = `Semana de ${fmt(iso(addDays(hojeDate(), -((hojeDate().getDay() + 6) % 7))))} a ${fmt(iso(addDays(hojeDate(), 6 - ((hojeDate().getDay() + 6) % 7))))}`;
    $('#boardTitle').textContent = semana;
    for (const [key, label] of COLS) {
      const list = S.tarefas.filter((t) => t.estado === key && (S.who === 'all' || t.dono === S.who));
      const col = document.createElement('div'); col.className = 'col'; col.dataset.st = key;
      col.innerHTML = `<h2>${label}<i>${list.length}</i></h2>`;
      for (const t of list) {
        const c = document.createElement('button'); c.className = 'card' + (t.estado === 'done' ? ' done' : ''); c.draggable = true; c.dataset.id = t.id;
        const dc = dueClass(t);
        c.innerHTML = `<span class="tag">${esc(t.area)}</span><span class="t">${esc(t.titulo)}</span>
          <span class="m"><span>${av(t.dono)} ${esc(PESSOAS()[t.dono] || t.dono)}</span><span class="due ${dc}">${dc === 'late' ? 'atrasada · ' : ''}${fmt(t.vence_em)}</span></span>
          ${t.etapas.length ? `<span class="steps" title="${t.etapas.filter((e) => e.feita).length} de ${t.etapas.length} etapas"><i style="width:${prog(t) * 100}%"></i></span>` : ''}`;
        c.addEventListener('click', () => openEditor(t.id));
        c.addEventListener('dragstart', (e) => e.dataTransfer.setData('text/plain', t.id));
        col.appendChild(c);
      }
      if (key === 'todo') { const a = document.createElement('button'); a.className = 'add'; a.textContent = '+ nova tarefa'; a.addEventListener('click', () => openEditor(null)); col.appendChild(a); }
      col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('over'); });
      col.addEventListener('dragleave', () => col.classList.remove('over'));
      col.addEventListener('drop', async (e) => {
        e.preventDefault(); col.classList.remove('over');
        const id = e.dataTransfer.getData('text/plain'); const t = S.tarefas.find((x) => x.id === id);
        if (!t || t.estado === key) return;
        try { await api('PATCH', `/api/tarefas/${id}`, { estado: key }); await carregar(); toast(`"${short(t.titulo)}" movida para ${label}.`); } catch (err) { toast(err.message); }
      });
      board.appendChild(col);
    }
  }
  function renderFiltros() {
    const f = $('#whoFilter');
    f.innerHTML = `<button class="chip ${S.who === 'all' ? 'on' : ''}" data-w="all">Todos</button>` + S.pessoas.map((p) => `<button class="chip ${S.who === p.id ? 'on' : ''}" data-w="${p.id}">${av(p.id, true)}${esc(p.nome)}</button>`).join('');
  }
  $('#whoFilter').addEventListener('click', (e) => { const b = e.target.closest('.chip'); if (!b) return; S.who = b.dataset.w; try { localStorage.setItem('compasso-who', S.who); } catch { /* opcional */ } renderAll(); });

  // ---------- calendário ----------
  function renderCal() {
    const strip = $('#strip'); strip.innerHTML = '';
    const H = hojeDate();
    for (let i = 0; i < 14; i++) {
      const d = addDays(H, i); const k = iso(d);
      const n = S.tarefas.filter((t) => t.vence_em === k && t.estado !== 'done' && (S.who === 'all' || t.dono === S.who)).length;
      const el = document.createElement('button'); el.className = 'day' + (i === 0 ? ' today' : '') + (S.calDay === k ? ' on' : '') + (d.getDay() % 6 === 0 ? ' wk' : '');
      el.innerHTML = `<small>${WD[d.getDay()]}</small><b>${d.getDate()}</b><span class="dots">${'<i></i>'.repeat(Math.min(n, 4))}</span>`;
      el.addEventListener('click', () => { S.calDay = S.calDay === k ? null : k; renderCal(); }); strip.appendChild(el);
    }
    const feed = $('#feed'); feed.innerHTML = '';
    const open = S.tarefas.filter((t) => t.estado !== 'done' && (S.who === 'all' || t.dono === S.who));
    const groups = [];
    const late = open.filter((t) => dueClass(t) === 'late').sort((a, b) => a.vence_em.localeCompare(b.vence_em));
    if (!S.calDay && late.length) groups.push({ lab: 'Atrasadas', sub: `${late.length} tarefa${late.length > 1 ? 's' : ''}`, late: true, items: late });
    for (let i = 0; i < 14; i++) {
      const d = addDays(H, i); const k = iso(d); if (S.calDay && S.calDay !== k) continue;
      const items = open.filter((t) => t.vence_em === k);
      if (items.length || S.calDay === k) groups.push({ lab: `${d.getDate()} ${MO[d.getMonth()]}`, sub: i === 0 ? 'hoje' : i === 1 ? 'amanhã' : WD[d.getDay()], items });
    }
    if (!S.calDay) { const nd = open.filter((t) => !t.vence_em); if (nd.length) groups.push({ lab: 'Sem data', sub: 'definir', items: nd }); }
    if (!groups.length) { feed.innerHTML = '<p class="hintline">Nada neste período.</p>'; return; }
    for (const g of groups) {
      const el = document.createElement('div'); el.className = 'fday';
      el.innerHTML = `<div class="lab ${g.late ? 'late' : ''}">${esc(g.lab)}<small>${esc(g.sub)}</small></div><div class="items">${g.items.length ? '' : '<span class="hintline">Nenhuma tarefa com esta data.</span>'}</div>`;
      const box = el.querySelector('.items');
      for (const t of g.items) { const b = document.createElement('button'); b.className = 'fitem'; b.innerHTML = `${av(t.dono)}<span><span class="t">${esc(t.titulo)}</span><br><span class="s">${esc(t.area)} · ${t.etapas.filter((e) => e.feita).length}/${t.etapas.length} etapas</span></span><span class="state ${t.estado}">${COLS.find((c) => c[0] === t.estado)[1]}</span>`; b.addEventListener('click', () => openEditor(t.id)); box.appendChild(b); }
      feed.appendChild(el);
    }
  }

  // ---------- gaveta: editor ----------
  const drawer = $('#drawer'), scrim = $('#scrim');
  function openDrawer(html) { drawer.innerHTML = html; drawer.classList.add('open'); drawer.setAttribute('aria-hidden', 'false'); scrim.classList.add('on'); }
  function closeDrawer() { drawer.classList.remove('open'); drawer.setAttribute('aria-hidden', 'true'); scrim.classList.remove('on'); }
  scrim.addEventListener('click', closeDrawer);

  async function openEditor(id, rascunhoInicial) {
    const donoPadrao = S.pessoas.some((p) => p.id === S.eu.id) ? S.eu.id : S.pessoas[0].id; // admin não é dono: cai na primeira pessoa
    const base = id ? S.tarefas.find((x) => x.id === id) : (rascunhoInicial || { titulo: '', area: 'Operação', dono: donoPadrao, vence_em: '', estado: 'todo', etapas: [], notas: '' });
    if (!id && base.dono == null) base.dono = donoPadrao;
    const draft = JSON.parse(JSON.stringify(base));
    let hist = [];
    if (id) { try { hist = (await api('GET', `/api/tarefas/${id}/eventos`)).eventos.slice(-6).reverse(); } catch { hist = []; } }
    const paint = () => {
      openDrawer(`<header><h2>${id ? 'Tarefa' : 'Nova tarefa'}</h2><button class="btn ghost sm" id="dClose">Fechar</button></header>
      <div class="body">
        <div class="field"><label for="fT">O que</label><textarea id="fT">${esc(draft.titulo)}</textarea></div>
        <div class="row2">
          <div class="field"><label for="fW">Quem assume</label><select id="fW">${S.pessoas.map((p) => `<option value="${p.id}" ${draft.dono === p.id ? 'selected' : ''}>${esc(p.nome)}</option>`).join('')}</select></div>
          <div class="field"><label for="fD">Até</label><input type="date" id="fD" value="${esc(draft.vence_em || '')}"></div>
        </div>
        <div class="row2">
          <div class="field"><label for="fS">Status</label><select id="fS">${COLS.map(([k, v]) => `<option value="${k}" ${draft.estado === k ? 'selected' : ''}>${v}</option>`).join('')}</select></div>
          <div class="field"><label for="fA">Área</label><select id="fA">${AREAS.map((a) => `<option ${draft.area === a ? 'selected' : ''}>${a}</option>`).join('')}</select></div>
        </div>
        <div class="field"><label>Etapas</label><div class="steplist" id="fSteps">${draft.etapas.map((s, i) => `<label class="step ${s.feita ? 'done' : ''}"><input type="checkbox" data-i="${i}" ${s.feita ? 'checked' : ''}><span>${esc(s.texto)}</span><button type="button" class="x" data-x="${i}" aria-label="remover etapa">×</button></label>`).join('') || '<span class="hintline">Sem etapas ainda. O chat pode sugerir.</span>'}</div>
          <div class="addstep"><input type="text" id="fNew" placeholder="nova etapa"><button class="btn sm" id="fAdd" type="button">Adicionar</button></div></div>
        <div class="field"><label for="fN">Notas</label><textarea id="fN">${esc(draft.notas || '')}</textarea></div>
        ${hist.length ? `<div class="field"><label>Histórico</label><div class="hist">${hist.map((h) => `<span>${esc(h.ts.slice(0, 16).replace('T', ' '))} · ${esc(PESSOAS()[h.quem] || h.quem || '')} · ${esc(h.tipo)}${h.mudou && h.mudou.estado ? ` → ${esc(COLS.find((c) => c[0] === h.mudou.estado.para)?.[1] || h.mudou.estado.para)}` : ''}</span>`).join('')}</div></div>` : ''}
      </div>
      <footer>${id ? '<button class="btn ghost sm" id="dDel">Excluir</button>' : '<span></span>'}<button class="btn gold" id="dSave">Salvar</button></footer>`);
      const g = (s) => $(s, drawer);
      const sync = () => { draft.titulo = g('#fT').value; draft.dono = g('#fW').value; draft.vence_em = g('#fD').value; draft.estado = g('#fS').value; draft.area = g('#fA').value; draft.notas = g('#fN').value; };
      g('#dClose').addEventListener('click', closeDrawer);
      g('#fSteps').addEventListener('change', (e) => { const i = e.target.dataset.i; if (i != null) { sync(); draft.etapas[i].feita = e.target.checked; paint(); } });
      g('#fSteps').addEventListener('click', (e) => { const x = e.target.closest('[data-x]'); if (x) { sync(); draft.etapas.splice(Number(x.dataset.x), 1); paint(); } });
      g('#fAdd').addEventListener('click', () => { const v = g('#fNew').value.trim(); if (!v) return; sync(); draft.etapas.push({ texto: v, feita: false }); paint(); });
      g('#fNew').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); g('#fAdd').click(); } });
      g('#dSave').addEventListener('click', async () => {
        sync();
        const corpo = { titulo: draft.titulo, area: draft.area, dono: draft.dono, vence_em: draft.vence_em || null, estado: draft.estado, etapas: draft.etapas, notas: draft.notas };
        if (!id && draft.origem) corpo.origem = draft.origem;
        try { if (id) await api('PATCH', `/api/tarefas/${id}`, corpo); else await api('POST', '/api/tarefas', corpo); await carregar(); closeDrawer(); toast('Salvo.'); } catch (err) { toast(err.message); }
      });
      if (g('#dDel')) g('#dDel').addEventListener('click', async () => {
        if (g('#dDel').dataset.confirm !== '1') { g('#dDel').dataset.confirm = '1'; g('#dDel').textContent = 'Confirmar exclusão'; return; }
        try { await api('DELETE', `/api/tarefas/${id}`); await carregar(); closeDrawer(); toast('Tarefa excluída. Fica no histórico.'); } catch (err) { toast(err.message); }
      });
    };
    paint();
  }

  // ---------- gaveta: sugestões ----------
  async function openSugs(atualizar) {
    openDrawer('<header><h2>Sugestões do planejador</h2><button class="btn ghost sm" id="dClose">Fechar</button></header><div class="body"><p class="hintline">Lendo os sinais da operação…</p></div>');
    $('#dClose', drawer).addEventListener('click', closeDrawer);
    try { S.sug = await api('GET', '/api/sugestoes' + (atualizar ? '?atualizar=1' : '')); } catch (err) { toast(err.message); return; }
    $('#sugCount').textContent = S.sug.itens.length;
    const lac = (S.sug.cobertura || []).filter((c) => !c.ok);
    const lidas = (S.sug.cobertura || []).filter((c) => c.ok).map((c) => c.fonte + (c.origem === 'api' ? ' (Central)' : c.origem === 'banco' ? ' (twk_ro)' : '') + (c.lacuna ? ` — parcial: ${c.lacuna}` : ''));
    openDrawer(`<header><h2>Sugestões do planejador</h2><div><button class="btn ghost sm" id="dRefresh">Atualizar</button><button class="btn ghost sm" id="dClose">Fechar</button></div></header>
      <div class="body">${S.sug.itens.length ? S.sug.itens.map((s) => `<div class="sug" data-s="${s.id}"><span class="tag">${esc(s.area)}${s.prioridade_fixa ? ' · prioridade' : ''}</span><span class="t">${esc(s.titulo)}</span><span class="why">${esc(s.porque)} <em>(${esc(s.fonte)})</em></span>
        <span class="who">Assumir como: <span class="pick">${S.pessoas.map((p) => `<button data-take="${p.id}">${av(p.id)}${esc(p.nome)}</button>`).join('')}</span></span>
        <span class="who"><button class="btn ghost sm" data-skip="${s.id}">Agora não</button></span></div>`).join('') : '<p class="hintline">Nenhuma sugestão pendente. O planejador traz novas quando os números mudam.</p>'}
      ${lidas.length ? `<p class="hintline">Fontes lidas: ${lidas.map(esc).join(', ')}.</p>` : ''}
      ${lac.length ? `<p class="hintline">Fontes que não consegui ler agora: ${lac.map((c) => esc(c.fonte + (c.lacuna ? ` (${c.lacuna})` : ''))).join(', ')}.</p>` : ''}
      <p class="hintline">${S.sug.geradas_em ? 'Lidas em ' + esc(S.sug.geradas_em.slice(0, 16).replace('T', ' ')) : ''}${S.sug.decididas ? ` · ${S.sug.decididas} já decididas` : ''}</p></div>`);
    $('#dClose', drawer).addEventListener('click', closeDrawer);
    $('#dRefresh', drawer).addEventListener('click', () => openSugs(true));
    $('.body', drawer).addEventListener('click', async (e) => {
      const take = e.target.closest('[data-take]'); const skip = e.target.closest('[data-skip]');
      try {
        if (take) { const sid = take.closest('.sug').dataset.s; const r = await api('POST', `/api/sugestoes/${sid}/assumir`, { dono: take.dataset.take }); await carregar(); toast(`${PESSOAS()[take.dataset.take]} assumiu. Card em "A fazer", prazo ${fmt(r.tarefa.vence_em)}.`); openSugs(); }
        if (skip) { await api('POST', `/api/sugestoes/${skip.dataset.skip}/descartar`, {}); toast('Sugestão guardada por 14 dias.'); openSugs(); }
      } catch (err) { toast(err.message); }
    });
  }
  $('#sugBtn').addEventListener('click', () => openSugs(false));

  // ---------- chat ----------
  const msgs = $('#msgs');
  function addMsg(html, me) { const m = document.createElement('div'); m.className = 'msg' + (me ? ' me' : ''); m.innerHTML = `<span class="who">${me ? 'Você' : 'Planejador'}</span>${html}`; msgs.appendChild(m); msgs.scrollTop = msgs.scrollHeight; return m; }
  function proposeHtml(p) {
    return `<p>${p.origem_modelo ? 'Entendi.' : 'Entendi (etapas padrão da área; o modelo não respondeu).'} Proponho um card assim${p.motivo ? `, ${esc(p.motivo)}` : ''}:</p>
    <div class="prop"><span class="tag">${esc(p.area)}</span><span class="t">${esc(p.titulo)}</span>
      <ol>${p.etapas.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
      <span class="meta">${av(p.dono)} ${esc(PESSOAS()[p.dono] || '')}${p.pessoa_citada ? '' : ' (você; troque se for de outro)'} <span>· ${p.vence_em ? 'até ' + fmt(p.vence_em) : 'sem prazo no pedido'}</span><span>· ${p.etapas.length} etapas</span></span></div>
    <div class="acts"><button class="btn gold sm" data-c="create">Criar card</button><button class="btn sm" data-c="who">Trocar quem assume</button><button class="btn ghost sm" data-c="edit">Ajustar antes</button></div>`;
  }
  $('#composer').addEventListener('submit', async (e) => {
    e.preventDefault(); const inp = $('#input'); const v = inp.value.trim(); if (!v) return;
    addMsg(`<p>${esc(v)}</p>`, true); inp.value = '';
    const espera = addMsg('<p class="hintline">Dividindo em etapas…</p>');
    try {
      const r = await api('POST', '/api/planejar', { texto: v }); S.pending = r.proposta;
      if (!S.pending.dono) { S.pending.dono = S.pessoas[0].id; S.pending.pessoa_citada = false; } // admin sem nome no texto: começa na primeira pessoa, troca com um clique
      espera.innerHTML = `<span class="who">Planejador</span>${proposeHtml(S.pending)}`;
    }
    catch (err) { espera.innerHTML = `<span class="who">Planejador</span><p>${esc(err.message)}</p>`; }
  });
  $('#input').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#composer').requestSubmit(); } });
  msgs.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-c]'); if (!b || !S.pending) return; const box = b.closest('.msg'); const p = S.pending;
    if (b.dataset.c === 'who') { const ids = S.pessoas.map((x) => x.id); p.dono = ids[(ids.indexOf(p.dono) + 1) % ids.length]; p.pessoa_citada = true; box.querySelector('.meta').innerHTML = `${av(p.dono)} ${esc(PESSOAS()[p.dono])} <span>· ${p.vence_em ? 'até ' + fmt(p.vence_em) : 'sem prazo no pedido'}</span><span>· ${p.etapas.length} etapas</span>`; return; }
    const corpo = { titulo: p.titulo, area: p.area, dono: p.dono, vence_em: p.vence_em, estado: 'todo', etapas: p.etapas.map((s) => ({ texto: s, feita: false })), notas: p.motivo || '', origem: { tipo: 'chat', ref: '' } };
    if (b.dataset.c === 'edit') { openEditor(null, corpo); box.querySelector('.acts').innerHTML = '<span class="hintline">Aberto no editor.</span>'; S.pending = null; return; }
    if (b.dataset.c === 'create') {
      try { const r = await api('POST', '/api/tarefas', corpo); await carregar(); box.querySelector('.acts').innerHTML = `<span class="hintline">Card ${esc(r.tarefa.id)} criado em "A fazer" para ${esc(PESSOAS()[p.dono])}.</span>`; addMsg(`<p>Criado. ${esc(PESSOAS()[p.dono])} vê o card no quadro${p.vence_em ? ' e no calendário de ' + fmt(p.vence_em) : ''}. Marque as etapas conforme andar.</p>`); S.pending = null; }
      catch (err) { toast(err.message); }
    }
  });

  // ---------- vistas, sessão, carga ----------
  $('.views').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; document.querySelectorAll('.views button').forEach((x) => x.classList.toggle('on', x === b)); document.querySelectorAll('.view').forEach((v) => v.classList.toggle('on', v.id === 'v-' + b.dataset.v)); try { localStorage.setItem('compasso-view', b.dataset.v); } catch { /* opcional */ } });
  function renderAll() { renderFiltros(); renderBoard(); renderCal(); }
  async function carregar() {
    const r = await api('GET', '/api/tarefas'); S.tarefas = r.tarefas; S.hoje = r.hoje;
    renderAll();
    $('#rodape').textContent = `${r.resumo.abertas} abertas · ${r.resumo.atrasadas} atrasadas · ${r.resumo.concluidas_7d} concluídas em 7 dias`;
  }
  function mostrarLogin() { $('#app').hidden = true; $('#login').hidden = false; }
  async function iniciar() {
    const eu = await api('GET', '/api/eu');
    S.pessoas = eu.pessoas; // quem pode ser dono de tarefa (sempre as três)
    $('#lUser').innerHTML = (eu.usuarios || eu.pessoas).map((p) => `<option value="${p.id}">${esc(p.nome)}</option>`).join(''); // quem pode entrar
    if (!eu.usuario) return mostrarLogin();
    S.eu = eu.usuario; $('#login').hidden = true; $('#app').hidden = false;
    $('#euAv').className = `av ${S.eu.id}`; $('#euAv').textContent = S.eu.nome.slice(0, 2).toUpperCase();
    $('#chatHint').textContent = eu.modelo === 'ligado' ? 'O planejador divide em etapas e sugere quem assume. Você confirma antes de virar card.' : 'Modelo desligado neste ambiente: as etapas vêm do padrão da área. Você confirma antes de virar card.';
    try { S.who = localStorage.getItem('compasso-who') || 'all'; } catch { S.who = 'all'; }
    try { const v = localStorage.getItem('compasso-view'); if (v) document.querySelector(`.views [data-v="${v}"]`)?.click(); } catch { /* opcional */ }
    await carregar();
    try { S.sug = await api('GET', '/api/sugestoes'); $('#sugCount').textContent = S.sug.itens.length; } catch { /* sem sugestões */ }
    if (!msgs.children.length) { const r = S.tarefas; const late = r.filter((t) => dueClass(t) === 'late').length; const hoje = r.filter((t) => t.vence_em === S.hoje && t.estado !== 'done').length; addMsg(`<p>Olá, ${esc(S.eu.nome)}. Hoje há <b>${late} atrasada${late === 1 ? '' : 's'}</b> e <b>${hoje} para hoje</b>. Escreva o que precisa ser feito, com prazo e nome se já souber.</p>`); }
  }
  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault(); $('#lErr').textContent = '';
    try { await api('POST', '/api/login', { usuario: $('#lUser').value, senha: $('#lPass').value }); $('#lPass').value = ''; await iniciar(); }
    catch (err) { $('#lErr').textContent = err.message; }
  });
  $('#euBtn').addEventListener('click', async () => { if ($('#euBtn').dataset.confirm !== '1') { $('#euBtn').dataset.confirm = '1'; toast('Clique de novo para sair.'); setTimeout(() => { $('#euBtn').dataset.confirm = ''; }, 3000); return; } await api('POST', '/api/logout', {}); location.reload(); });

  let tm; function toast(s) { const t = $('#toast'); t.textContent = s; t.classList.add('show'); clearTimeout(tm); tm = setTimeout(() => t.classList.remove('show'), 3200); }
  iniciar().catch((err) => { if (!/sessão/.test(err.message)) { $('#login').hidden = false; $('#lErr').textContent = err.message; } });
})();
