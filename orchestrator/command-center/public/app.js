/* MAESTRO Command Center — SPA sem dependências.
   Dados reais: /api/* (estado do Orquestrador + health dos agentes).
   Painéis por agente sem conexão configurada mostram AGUARDANDO CONEXÃO;
   o modo DEMO (selo fixo) usa fixtures determinísticos claramente fictícios. */
(() => {
  const $ = (s, el) => (el || document).querySelector(s);
  const S = { lang: localStorage.getItem('mc_lang') || 'pt', demo: localStorage.getItem('mc_demo') === '1', token: localStorage.getItem('mc_key') || '', data: { overview: null, agents: null, logs: null } };
  const t = (k) => (window.I18N[S.lang] && window.I18N[S.lang][k]) || k;
  const PAL = { s1: '#3987e5', s2: '#d95926', s3: '#199e70', s4: '#c98500', s5: '#d55181', s7: '#9085e9' };
  const AG = [
    { id: 'comercial', nome: 'CLAVIS', roleKey: 'clavis_role', hue: PAL.s1 },
    { id: 'suporte', nome: 'ARIA', roleKey: 'aria_role', hue: PAL.s3 },
    { id: 'editorial', nome: 'QUILL', roleKey: 'quill_role', hue: PAL.s5 },
    { id: 'financeiro', nome: 'ATLAS', roleKey: 'atlas_role', hue: PAL.s4 },
    { id: 'dba', nome: 'DB ARCHITECT', roleKey: 'dba_role', hue: PAL.s2 },
    // v4.6: o Guardião é agente LOCAL (sem URL) — saúde = varredura recente e não pausado
    { id: 'guardiao', nome: 'GUARDIÃO', roleKey: 'guardiao_role', hue: PAL.s7, local: true },
  ];
  // Texto de saúde válido para os dois tipos de agente: HTTP (latência) e local (idade da varredura).
  function healthTxt(live, comMs) {
    if (!live || !live.configured) return t('not_conf');
    const h = live.health || {};
    if (h.local) {
      if (h.pausado) return t('g_pausado');
      const idade = h.idade_h === null || h.idade_h === undefined ? '—' : h.idade_h;
      return `${h.ok ? t('online') : t('offline')} · ${t('g_varredura')} ${idade} h`;
    }
    return h.ok ? (comMs ? `${t('online')} · ${h.ms} ms` : t('online')) : t('offline');
  }

  // ---------- fetch ----------
  async function api(p, opts) {
    const o = opts || {};
    const headers = Object.assign({}, S.token ? { 'x-center-key': S.token } : {}, o.body ? { 'content-type': 'application/json' } : {});
    const r = await fetch(p, { method: o.method || 'GET', headers, body: o.body ? JSON.stringify(o.body) : undefined });
    if (r.status === 401) { gate(true); throw new Error('401'); }
    if (!r.ok) {
      // Erro do servidor é dado, não mistério: propaga a mensagem real (e a dica) para a tela.
      let detail = '';
      try { const j = await r.json(); detail = [j.error, j.hint].filter(Boolean).join(' — '); } catch {}
      throw new Error(detail || ('http ' + r.status));
    }
    return r.json();
  }
  let lastSig = null;
  let fastPoll = null;
  function dataSig() {
    const ov = S.data.overview ? { ...S.data.overview, generated_at: null } : null;
    const kp = S.data.kpis ? Object.fromEntries(Object.entries(S.data.kpis).map(([k, v]) => [k, { ...v, atualizadoEm: null }])) : null;
    return JSON.stringify([ov, S.data.agents, S.data.logs ? S.data.logs.length : 0, S.data.inbox, (S.data.missions || []).map((m) => m.file), kp,
      (S.data.acoes || []).map((a) => a.id + a.status + (a.atualizado_em || '')),
      (S.data.aprovacoes || []).map((a) => a.id + a.status)]);
  }
  async function refresh(force) {
    try {
      const [ov, ags, lg, ib, ms, kp, ac, ap] = await Promise.all([
        api('/api/overview'), api('/api/agents'), api('/api/logs'), api('/api/inbox'), api('/api/missions'),
        // KPIs reais dos agentes: nunca deve derrubar o resto do painel se um agente estiver fora.
        api('/api/kpis').catch(() => ({ kpis: {} })),
        // fila de Ações do vigia (builds antigos do servidor não têm a rota: degrada para vazio)
        api('/api/actions').catch(() => ({ acoes: [] })),
        // aprovações do fundador (v4)
        api('/api/approvals').catch(() => ({ aprovacoes: [] })),
      ]);
      S.data = { overview: ov, agents: ags.agents, logs: lg.eventos, inbox: ib.items, missions: ms.missions, kpis: kp.kpis, acoes: ac.acoes, aprovacoes: ap.aprovacoes };
      $('#conn .dot').className = 'dot ok'; $('#conn span:last-child').textContent = t('live');
      // Missão em processamento no cérebro → acompanhar de perto (5s) até entregar
      const processing = (ib.items || []).some((i) => i.status === 'processando' || i.status === 'fila');
      clearTimeout(fastPoll);
      if (processing) fastPoll = setTimeout(() => refresh(false), 5000);
    } catch (e) {
      if (String(e.message) !== '401') { $('#conn .dot').className = 'dot bad'; $('#conn span:last-child').textContent = 'offline'; }
    }
    // Nunca redesenhar durante a leitura de um relatório (perderia a posição de rolagem);
    // a Conversa gerencia o próprio DOM (streaming) — nunca redesenhar por cima dela;
    // nas demais telas, só redesenhar se os dados mudaram de verdade.
    const reading = location.hash.includes('?f=') || location.hash.startsWith('#/conversa');
    const ae = document.activeElement;
    const typing = (ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName) && ae.closest('#view')) ||
      (($('#nm-titulo') && $('#nm-titulo').value) || ($('#nm-desc') && $('#nm-desc').value));
    const sig = dataSig();
    if (force || (!reading && !typing && sig !== lastSig)) { lastSig = sig; render(); }
    else buildHeader();
  }

  // ---------- tooltip ----------
  const tip = () => $('#tip');
  function showTip(html, x, y) { const el = tip(); el.innerHTML = html; el.style.display = 'block'; el.style.left = Math.min(x + 14, innerWidth - 180) + 'px'; el.style.top = (y + 14) + 'px'; }
  function hideTip() { tip().style.display = 'none'; }

  // ---------- charts (SVG) ----------
  const NS = 'http://www.w3.org/2000/svg';
  function el(n, at) { const e = document.createElementNS(NS, n); for (const k in at) e.setAttribute(k, at[k]); return e; }
  function fmt(v) { return Number(v).toLocaleString(S.lang === 'fr' ? 'fr-FR' : 'pt-BR'); }

  // sparkline/linha com crosshair + tooltip
  function lineChart(values, { color = PAL.s1, h = 120, unit = '' } = {}) {
    const w = 560, padL = 6, padR = 6, padT = 12, padB = 18;
    const max = Math.max(...values, 1), min = Math.min(...values, 0);
    const X = (i) => padL + (i * (w - padL - padR)) / (values.length - 1);
    const Y = (v) => padT + (1 - (v - min) / (max - min || 1)) * (h - padT - padB);
    const svg = el('svg', { viewBox: `0 0 ${w} ${h}` });
    for (const fr of [0, 0.5, 1]) svg.appendChild(el('line', { x1: padL, x2: w - padR, y1: Y(min + fr * (max - min)), y2: Y(min + fr * (max - min)), class: 'gridline' }));
    svg.appendChild(el('line', { x1: padL, x2: w - padR, y1: Y(min), y2: Y(min), class: 'baseline' }));
    const d = values.map((v, i) => `${i ? 'L' : 'M'}${X(i)},${Y(v)}`).join('');
    const area = el('path', { d: `${d}L${X(values.length - 1)},${Y(min)}L${X(0)},${Y(min)}Z`, fill: color, opacity: 0.10 });
    svg.appendChild(area);
    svg.appendChild(el('path', { d, fill: 'none', stroke: color, 'stroke-width': 2, 'stroke-linejoin': 'round' }));
    const last = values.length - 1;
    svg.appendChild(el('circle', { cx: X(last), cy: Y(values[last]), r: 4, fill: color, stroke: '#10151c', 'stroke-width': 2 }));
    const lbl = el('text', { x: w - padR, y: Y(values[last]) - 8, 'text-anchor': 'end', class: 'hbar-val' }); lbl.textContent = fmt(values[last]) + unit; svg.appendChild(lbl);
    const cross = el('line', { y1: padT, y2: h - padB, class: 'baseline', style: 'display:none' }); svg.appendChild(cross);
    const dotc = el('circle', { r: 4, fill: color, stroke: '#10151c', 'stroke-width': 2, style: 'display:none' }); svg.appendChild(dotc);
    svg.addEventListener('mousemove', (ev) => {
      const r = svg.getBoundingClientRect();
      const i = Math.max(0, Math.min(values.length - 1, Math.round(((ev.clientX - r.left) / r.width * w - padL) / ((w - padL - padR) / (values.length - 1)))));
      cross.style.display = dotc.style.display = 'block';
      cross.setAttribute('x1', X(i)); cross.setAttribute('x2', X(i));
      dotc.setAttribute('cx', X(i)); dotc.setAttribute('cy', Y(values[i]));
      showTip(`<b>${fmt(values[i])}${unit}</b> · D-${values.length - 1 - i}`, ev.clientX, ev.clientY);
    });
    svg.addEventListener('mouseleave', () => { cross.style.display = dotc.style.display = 'none'; hideTip(); });
    return svg;
  }

  // barras horizontais finas, cantos 4px, gap 2px, rótulo direto
  function hBars(items, { color = PAL.s1, h } = {}) {
    const w = 560, rowH = 30, padT = 4; h = h || items.length * rowH + padT;
    const max = Math.max(...items.map((i) => i.v), 1);
    const svg = el('svg', { viewBox: `0 0 ${w} ${h}` });
    const x0 = 170, bw = w - x0 - 64;
    items.forEach((it, i) => {
      const y = padT + i * rowH;
      const lbl = el('text', { x: x0 - 10, y: y + 17, 'text-anchor': 'end', class: 'hbar-lbl' }); lbl.textContent = it.label; svg.appendChild(lbl);
      svg.appendChild(el('rect', { x: x0, y: y + 8, width: bw, height: 12, rx: 4, fill: 'var(--grid)' }));
      const bar = el('rect', { x: x0, y: y + 8, width: Math.max(4, (it.v / max) * bw), height: 12, rx: 4, fill: it.color || color });
      svg.appendChild(bar);
      const val = el('text', { x: x0 + Math.max(4, (it.v / max) * bw) + 8, y: y + 18, class: 'hbar-val' }); val.textContent = it.fmt || fmt(it.v); svg.appendChild(val);
      const hit = el('rect', { x: 0, y, width: w, height: rowH, fill: 'transparent' });
      hit.addEventListener('mousemove', (ev) => showTip(`${it.label}: <b>${it.fmt || fmt(it.v)}</b>`, ev.clientX, ev.clientY));
      hit.addEventListener('mouseleave', hideTip);
      svg.appendChild(hit);
    });
    return svg;
  }

  function meter(value, max, { label = '', unit = '', color } = {}) {
    const pct = Math.min(100, (value / (max || 1)) * 100);
    const c = color || (pct > 90 ? 'var(--critical)' : pct > 70 ? 'var(--warning)' : 'var(--accent)');
    const d = document.createElement('div'); d.className = 'meter';
    d.innerHTML = `<div class="track"><div class="fill" style="width:${pct.toFixed(1)}%;background:${c}"></div></div>
      <div class="lbl"><span>${label}</span><span>${fmt(value)}${unit} / ${fmt(max)}${unit}</span></div>`;
    return d;
  }

  // ---------- fixtures DEMO (deterministicos, claramente ficticios) ----------
  const wave = (n, base, amp, ph) => Array.from({ length: n }, (_, i) => Math.round(base + amp * Math.sin(i / 2.1 + ph) + (i % 3)));
  const DEMO = {
    comercial: { funil: [120, 46, 31, 28, 9], budget: [412000, 600000], pending: 37, replies: wave(14, 6, 4, 1), gate: 5 },
    suporte: { conv: 48, first: '2,4 min', esc: 3, csat: '4,7', conv14: wave(14, 40, 12, 0.4), tags: [['URGENTE', 1], ['PENDENTE_12H', 2], ['MODIFICACAO', 4], ['PEDIDO_ESPECIAL', 3]], langs: [['PT', 21], ['EN', 14], ['FR', 8], ['ES', 5]] },
    editorial: { clicks: 1642, clicks28: wave(28, 52, 16, 0.9), queue: [['q_pend', 240], ['q_prog', 12], ['q_rev', 31], ['q_apr', 402], ['q_rej', 17]], cost: [11.4, 30] },
    financeiro: { mrr: '€ 18.240', nrr: '104%', churn: '1,8%', props: 2, mrr6: [14100, 14950, 15600, 16400, 17300, 18240], aging: [['a_030', 5210], ['a_3160', 1240], ['a_6190', 380], ['a_90', 190]], recon: true },
    dba: { pub: 1228, limbo: 812, compl: '78%', mut: 14, fields: [['d_email', 81], ['d_phone', 88], ['d_hours', 93], ['d_photo', 63], ['d_price', 71]], pub30: wave(30, 1210, 14, 0.2) },
    guardiao: {
      avaliadas: 64, cobrar: 46, avisar: 5, urgentes: 1, aprov: 1, idade: 3,
      contagens: { email_restaurante: 34, fila_whatsapp: 12, mensagem_cliente: 5, aguardar: 9, fora_janela: 3, bloqueado: 1 },
      serie: wave(14, 62, 9, 0.7), lote: { casas: 27, reservas: 34 },
      emails: [['Casa Demo Um', 'Paris', 'fr', 2], ['Trattoria Demo', 'Roma', 'it', 1], ['Demo Bistro', 'Lisboa', 'pt', 3]],
      fila: [[4, 'Casa Demo Um', 'Paris', '2026-10-10 20:00', 'whatsapp'], [29, 'Demo Bistro', 'Lisboa', '2026-10-11 21:00', 'telefone']],
      ledger: { env7: 0, envTot: 68, casas: 42 },
    },
  };

  // ---------- header ----------
  function buildHeader() {
    const nav = $('#agent-nav'); nav.innerHTML = '';
    AG.forEach((a) => {
      const live = (S.data.agents || []).find((x) => x.id === a.id);
      const st = healthTxt(live, false);
      const dot = !live || !live.configured ? '' : (live.health && live.health.ok ? 'ok' : 'bad');
      const b = document.createElement('button');
      b.className = 'agent-card' + (location.hash === '#/' + a.id ? ' active' : '');
      b.innerHTML = `<span class="nm"><span class="hue" style="background:${a.hue}"></span>${a.nome}<span class="dot ${dot}" style="margin-left:auto"></span></span><span class="rl">${t(a.roleKey)} · ${st}</span>`;
      b.onclick = () => { location.hash = '#/' + a.id; };
      nav.appendChild(b);
    });
    const cb = $('#conv-btn'); cb.textContent = '⌘ ' + t('conv_title');
    cb.className = 'demo-btn conv' + (location.hash.startsWith('#/conversa') ? ' on' : '');
    const aprPend = (S.data.aprovacoes || []).filter((a) => a.status === 'pendente').length;
    const apb = $('#apr-btn');
    apb.textContent = '⛔ ' + t('apr_title') + (aprPend ? ` (${aprPend})` : '');
    apb.className = 'demo-btn' + (location.hash.startsWith('#/aprovacoes') ? ' on' : '') + (aprPend ? ' crit-pulse' : '');
    apb.style.display = aprPend || location.hash.startsWith('#/aprovacoes') ? '' : 'none';
    const mb = $('#missions-btn'); mb.textContent = '◈ ' + t('missions_title');
    mb.className = 'demo-btn' + (location.hash.startsWith('#/missoes') ? ' on' : '');
    const abertas = (S.data.acoes || []).filter((a) => a.status === 'aberta' || a.status === 'adiada');
    const criticas = abertas.filter((a) => a.severidade === 'critica').length;
    const ab = $('#actions-btn');
    ab.textContent = '⚑ ' + t('acts_title') + (abertas.length ? ` (${abertas.length})` : '');
    ab.className = 'demo-btn' + (location.hash.startsWith('#/acoes') ? ' on' : '') + (criticas ? ' crit-pulse' : '');
    $('#lang-pt').className = S.lang === 'pt' ? 'on' : ''; $('#lang-fr').className = S.lang === 'fr' ? 'on' : '';
    $('#demo-btn').className = 'demo-btn' + (S.demo ? ' on' : ''); $('#demo-btn').textContent = t('demo_toggle');
    $('#demo-seal').textContent = t('demo_on');
    document.body.classList.toggle('demo', S.demo);
    $('#brand-sub').textContent = t('subtitle');
    buildTicker();
  }

  // ---------- fita de telemetria ----------
  function buildTicker() {
    const parts = [];
    const ov = S.data.overview;
    (S.data.agents || []).forEach((la) => {
      const meta = AG.find((x) => x.id === la.id) || { nome: la.nome };
      if (!la.configured) parts.push(`<b>${meta.nome}</b> —`);
      else if (la.health && la.health.local) parts.push(`<b>${meta.nome}</b> <span class="${la.health.ok ? 'up' : 'crit'}">● ${esc(healthTxt(la, false))}</span>`);
      else if (la.health && la.health.ok) parts.push(`<b>${meta.nome}</b> <span class="up">● ${t('online')}</span> ${la.health.ms}ms`);
      else parts.push(`<b>${meta.nome}</b> <span class="crit">● ${t('offline')}</span>`);
    });
    if (ov) {
      parts.push(`${t('tiles_done')}: <b>${fmt(ov.tasks.concluidas)}</b>`);
      parts.push(`${t('tiles_running')}: <b>${fmt(ov.tasks.em_andamento)}</b>`);
      if (ov.tasks.aguardando_humano) parts.push(`<span class="warn">▲ ${t('tiles_human')}: <b>${fmt(ov.tasks.aguardando_humano)}</b></span>`);
      parts.push(`${t('tiles_blocks')}: <b>${fmt(ov.guardrail_blocks_hoje)}</b>`);
    }
    (S.data.inbox || []).filter((i) => i.status === 'processando').forEach((i) => {
      parts.push(`<span class="warn">◈ ${t('st_processando')}: <b>${esc(i.titulo).slice(0, 40)}</b></span>`);
    });
    const acAb = (S.data.acoes || []).filter((a) => a.status === 'aberta' || a.status === 'adiada');
    const acCr = acAb.filter((a) => a.severidade === 'critica').length;
    if (acCr) parts.unshift(`<span class="crit">⚑ ${t('acts_crit_ticker')}: <b>${acCr}</b></span>`);
    else if (acAb.length) parts.push(`<span class="warn">⚑ ${t('acts_title')}: <b>${acAb.length}</b></span>`);
    const last = (S.data.missions || [])[0];
    if (last) parts.push(`📄 ${esc(last.title).slice(0, 48)}`);
    if (!parts.length) parts.push('MAESTRO');
    const seq = parts.join('<span style="color:var(--baseline)"> · </span>');
    const track = $('#tk-track');
    if (track) track.innerHTML = seq + '<span style="color:var(--baseline)"> · </span>' + seq;
  }

  // ---------- views ----------
  function panel(title, bodyEl, { live = false, src = '' } = {}) {
    const p = document.createElement('section'); p.className = 'panel';
    const h = document.createElement('h3'); h.textContent = title;
    if (live) { const tg = document.createElement('span'); tg.className = 'live-tag'; tg.textContent = t('live'); h.appendChild(tg); }
    p.appendChild(h); p.appendChild(bodyEl);
    if (src) { const s = document.createElement('div'); s.className = 'src'; s.textContent = src; p.appendChild(s); }
    return p;
  }
  function tile(label, value, extra) {
    const d = document.createElement('section'); d.className = 'panel tile';
    d.innerHTML = `<h3>${label}</h3><div class="big">${value}</div>${extra ? `<div class="delta ${extra.cls || ''}">${extra.txt}</div>` : ''}`;
    // contagem animada para valores puramente numéricos
    const big = d.querySelector('.big');
    const num = Number(String(value).replace(/[.\s]/g, '').replace(',', '.'));
    if (Number.isFinite(num) && /^[\d.,\s]+$/.test(String(value)) && num > 0 && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const dur = 600, start = performance.now();
      const step = (now) => {
        const p = Math.min(1, (now - start) / dur), eased = 1 - Math.pow(1 - p, 3);
        big.textContent = fmt(Math.round(num * eased));
        if (p < 1) requestAnimationFrame(step); else big.textContent = value;
      };
      requestAnimationFrame(step);
    }
    return d;
  }
  function waiting() {
    const d = document.createElement('div'); d.className = 'waiting';
    d.innerHTML = `<b>${t('waiting_conn')}</b><span>${t('waiting_hint')}</span>`;
    return d;
  }

  // constelação da orquestração (v3.4.1) — núcleo radiante à esquerda, fluxos
  // luminosos em curva até os nós hexagonais dos agentes (inspirado na referência do fundador)
  function constellation() {
    const W = 560, H = 440, cx = 118, cy = H / 2;
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}` });
    const defs = el('defs', {});
    let dh = `
      <radialGradient id="coreG"><stop offset="0%" stop-color="#f4e7c3" stop-opacity=".9"/><stop offset="38%" stop-color="#c9a96e" stop-opacity=".45"/><stop offset="100%" stop-color="#0d1218" stop-opacity="0"/></radialGradient>
      <filter id="softGlow" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`;
    AG.forEach((a, i) => {
      dh += `<linearGradient id="wireG${i}" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="#c9a96e" stop-opacity=".06"/><stop offset="55%" stop-color="#c9a96e" stop-opacity=".4"/><stop offset="100%" stop-color="${a.hue}" stop-opacity=".95"/></linearGradient>`;
    });
    defs.innerHTML = dh;
    svg.appendChild(defs);

    // núcleo: brilho radial + anéis concêntricos tracejados em rotação lenta
    svg.appendChild(el('circle', { cx, cy, r: 104, fill: 'url(#coreG)', opacity: .55 }));
    [{ r: 58, dash: '26 14', w: 1.4, dur: 42, cw: 1, op: .30 }, { r: 74, dash: '3 10', w: 1, dur: 58, cw: -1, op: .26 }, { r: 90, dash: '2 7', w: 1, dur: 90, cw: 1, op: .12 }]
      .forEach((rg) => {
        const ring = el('circle', { cx, cy, r: rg.r, fill: 'none', stroke: `rgba(201,169,110,${rg.op})`, 'stroke-width': rg.w, 'stroke-dasharray': rg.dash, 'stroke-linecap': 'round' });
        const rot = el('animateTransform', { attributeName: 'transform', type: 'rotate', from: `0 ${cx} ${cy}`, to: `${rg.cw * 360} ${cx} ${cy}`, dur: rg.dur + 's', repeatCount: 'indefinite' });
        ring.appendChild(rot); svg.appendChild(ring);
      });
    svg.appendChild(el('circle', { cx, cy, r: 44, fill: '#0d1218', stroke: 'var(--gold)', 'stroke-width': 1.8, filter: 'url(#softGlow)' }));
    svg.appendChild(el('circle', { cx, cy, r: 37, fill: 'none', stroke: 'rgba(201,169,110,.35)', 'stroke-width': 1 }));
    const ct = el('text', { x: cx, y: cy + 4, 'text-anchor': 'middle', style: 'fill:var(--ink);font-size:11px;font-weight:900;letter-spacing:.16em' });
    ct.textContent = 'MAESTRO'; svg.appendChild(ct);

    const hex = (x, y, r) => {
      const p = [];
      for (let k = 0; k < 6; k++) { const a = Math.PI / 180 * (60 * k - 90); p.push((x + r * Math.cos(a)).toFixed(1) + ',' + (y + r * Math.sin(a)).toFixed(1)); }
      return p.join(' ');
    };
    // nós distribuídos na altura disponível — cabem 5, 6 ou mais agentes sem mexer aqui
    const X = 452, yTop = 46, yBot = H - 58; // 58 embaixo: sobra lugar para o rótulo do último nó
    const ys = AG.map((_, i) => Math.round(AG.length === 1 ? H / 2 : yTop + (i * (yBot - yTop)) / (AG.length - 1)));
    AG.forEach((a, i) => {
      const y = ys[i];
      // fluxo luminoso: sai do núcleo, ondula e pousa no hexágono do agente
      const d = `M ${cx + 45} ${cy} C ${248 + i * 10} ${cy}, ${340 - i * 6} ${y}, ${X - 26} ${y}`;
      svg.appendChild(el('path', { d, fill: 'none', stroke: `url(#wireG${i})`, 'stroke-width': 1.6, filter: 'url(#softGlow)' }));
      const pid = 'flw' + i;
      svg.appendChild(el('path', { id: pid, d, fill: 'none', stroke: 'none' }));
      const flow = el('circle', { r: 2.4, style: `fill:${a.hue};filter:drop-shadow(0 0 4px ${a.hue})` });
      const am = el('animateMotion', { dur: (3.4 + i * 0.55) + 's', repeatCount: 'indefinite', begin: (i * 0.45) + 's' });
      am.appendChild(el('mpath', { href: '#' + pid }));
      flow.appendChild(am); svg.appendChild(flow);

      // nó hexagonal do agente — a luz CENTRAL é o sinal de status (verde=online, vermelho=offline)
      const live = (S.data.agents || []).find((v) => v.id === a.id);
      const ok = live && live.configured && live.health && live.health.ok;
      const stCol = !live || !live.configured ? 'var(--muted)' : ok ? 'var(--good)' : 'var(--critical)';
      const g = el('g', { class: 'c-node' });
      g.appendChild(el('polygon', { class: 'halo', points: hex(X, y, 22), fill: 'none', stroke: a.hue, 'stroke-width': 1 }));
      g.appendChild(el('polygon', { points: hex(X, y, 16), fill: '#0d1218', stroke: a.hue, 'stroke-width': 1.8, filter: 'url(#softGlow)' }));
      g.appendChild(el('circle', { cx: X, cy: y, r: 5, style: `fill:${stCol};filter:drop-shadow(0 0 5px ${stCol})` }));
      const lbl = el('text', { x: X, y: y + 33, 'text-anchor': 'middle' }); lbl.textContent = a.nome; g.appendChild(lbl);
      g.addEventListener('click', () => { location.hash = '#/' + a.id; });
      g.addEventListener('mousemove', (ev) => {
        showTip(`<b>${a.nome}</b> · ${t(a.roleKey)}<br>${esc(healthTxt(live, true))}`, ev.clientX, ev.clientY);
      });
      g.addEventListener('mouseleave', hideTip);
      svg.appendChild(g);
    });
    const wrap = document.createElement('div'); wrap.className = 'constellation'; wrap.appendChild(svg);
    return wrap;
  }

  function viewHome(m) {
    const ov = S.data.overview;

    // HERO: constelação + manifesto
    const hero = document.createElement('div'); hero.className = 'hero';
    hero.appendChild(panel(t('net_title'), constellation(), { live: true, src: t('net_src') }));
    const right = document.createElement('div'); right.className = 'hero-right';
    right.innerHTML = `
      <div class="h-title">${t('hero_title')}</div>
      <div class="h-sub">${t('hero_sub')}</div>
      <div class="cta-row">
        <button class="cta primary" id="cta-new">✍ ${t('cta_new')}</button>
        <button class="cta ghost" id="cta-rep">◈ ${t('cta_reports')}</button>
      </div>
      <div class="src">${t('hero_hint')}<span class="kbd-chip">Ctrl+K</span></div>`;
    hero.appendChild(right);
    m.appendChild(hero);
    $('#cta-new', right).onclick = () => { location.hash = '#/missoes'; setTimeout(() => { const e2 = $('#nm-titulo'); if (e2) e2.focus(); }, 300); };
    $('#cta-rep', right).onclick = () => { location.hash = '#/missoes'; };

    const tiles = document.createElement('div'); tiles.className = 'grid g-tiles';
    if (ov) {
      tiles.appendChild(tile(t('tiles_done'), fmt(ov.tasks.concluidas)));
      tiles.appendChild(tile(t('tiles_running'), fmt(ov.tasks.em_andamento)));
      tiles.appendChild(tile(t('tiles_human'), fmt(ov.tasks.aguardando_humano), ov.tasks.aguardando_humano ? { txt: '● ' + t('pending_title'), cls: 'warn' } : null));
      tiles.appendChild(tile(t('tiles_blocks'), fmt(ov.guardrail_blocks_hoje)));
      tiles.appendChild(tile(t('tiles_events'), fmt(ov.eventos_hoje)));
    }
    m.appendChild(tiles);

    // superpoderes
    const pw = document.createElement('div'); pw.className = 'grid g-powers';
    const hues = [PAL.s1, PAL.s3, PAL.s2, PAL.s4, PAL.s5, PAL.s1, PAL.s3, PAL.s2];
    for (let i = 1; i <= 8; i++) {
      const c = document.createElement('section'); c.className = 'panel power'; c.style.setProperty('--pw', hues[i - 1]);
      c.innerHTML = `<span class="idx">0${i}</span><h4>${t('p' + i + 't')}</h4><p>${t('p' + i + 'd')}</p>`;
      pw.appendChild(c);
    }
    m.appendChild(panel(t('powers_title'), pw));

    // frota + pendências
    const two = document.createElement('div'); two.className = 'grid g-2';
    const fleet = document.createElement('div'); fleet.className = 'fleet';
    AG.forEach((a) => {
      const live = (S.data.agents || []).find((x) => x.id === a.id);
      const ok = live && live.configured && live.health && live.health.ok;
      const st = esc(healthTxt(live, true));
      const f = document.createElement('button'); f.className = 'fl';
      f.innerHTML = `<span class="dot ${!live || !live.configured ? '' : ok ? 'ok' : 'bad'}"></span><span><b style="color:${a.hue}">${a.nome}</b><div class="st">${st}</div></span>`;
      f.onclick = () => { location.hash = '#/' + a.id; };
      fleet.appendChild(f);
    });
    two.appendChild(panel(t('fleet_title'), fleet, { live: true }));

    const rows = document.createElement('div'); rows.className = 'rows';
    const pend = (ov && ov.pendencias) || [];
    if (!pend.length) rows.innerHTML = `<div class="src">${t('no_pending')}</div>`;
    pend.forEach((p) => {
      const r = document.createElement('div'); r.className = 'row';
      r.innerHTML = `<span class="id">${p.task_id}</span><span>${p.objetivo}</span><span class="st-badge st-${p.status}">${p.status}</span>`;
      rows.appendChild(r);
    });
    two.appendChild(panel(t('pending_title'), rows, { live: true, src: t('src_state') + (ov ? ` · ${t('updated')} ${new Date(ov.generated_at).toLocaleTimeString(S.lang === 'fr' ? 'fr-FR' : 'pt-BR')}` : '') }));
    m.appendChild(two);
  }

  // Diagnóstico honesto: diz exatamente POR QUE não há dado, em vez de "aguardando".
  function waitingReason(real) {
    const d = document.createElement('div'); d.className = 'waiting';
    if (!real || real.status === 'sem_url') {
      d.innerHTML = `<b>${t('waiting_conn')}</b><span>${t('why_no_url')}${real && real.envs ? ' <code>' + real.envs.join('</code>, <code>') + '</code>' : ''}</span>`;
    } else if (real.status === 'sem_credencial') {
      d.innerHTML = `<b>${t('why_no_cred_t')}</b><span>${t('why_no_cred')}</span><span><code>${(real.envs || []).join('</code> · <code>')}</code></span>`;
    } else if (real.status === 'sem_endpoint') {
      d.innerHTML = `<b>${t('why_no_ep_t')}</b><span>${esc(real.detalhe || '')}</span>`;
    } else if (real.status === 'sem_sincronizacao') {
      d.innerHTML = `<b>${t('why_no_sync_t')}</b><span>${t('why_no_sync')}</span><span><code>powershell -File orchestrator\\command-center\\push-state.ps1</code></span>`;
    } else {
      d.innerHTML = `<b>${t('why_err_t')}</b><span>${esc(real.erro || '')}</span>`;
    }
    return d;
  }

  function money(v, cur) {
    if (v === null || v === undefined) return '—';
    const n = Number(v);
    if (!Number.isFinite(n)) return String(v);
    return n.toLocaleString(S.lang === 'fr' ? 'fr-FR' : 'pt-BR', { style: 'currency', currency: cur || 'EUR', maximumFractionDigits: 0 });
  }
  const val = (v, suf) => (v === null || v === undefined ? '—' : fmt(v) + (suf || ''));

  function agentShell(m, a, buildDemo, buildReal) {
    const live = (S.data.agents || []).find((x) => x.id === a.id);
    const real = (S.data.kpis || {})[a.id];
    const ok = live && live.configured && live.health && live.health.ok;
    const head = document.createElement('div'); head.className = 'view-head';
    head.innerHTML = `<h2 style="color:${a.hue}">${a.nome}</h2><span class="sub">${t(a.roleKey)} · ${t('health')}: ${esc(healthTxt(live, true))}</span>`;
    m.appendChild(head);

    // Dado real vence demo: se o agente respondeu com números, é isso que se mostra.
    if (real && real.status === 'ok' && !S.demo) {
      const src = document.createElement('div'); src.className = 'src';
      src.innerHTML = `<span class="st-badge st-concluida">${t('live_data')}</span> ${t('live_data_src')} ${real.atualizadoEm ? new Date(real.atualizadoEm).toLocaleTimeString(S.lang === 'fr' ? 'fr-FR' : 'pt-BR') : ''}${real.demo ? ' · <span style="color:var(--warning)">' + t('agent_mock') + '</span>' : ''}`;
      m.appendChild(src);
      buildReal(m, real);
      return;
    }
    if (S.demo) {
      const n = document.createElement('div'); n.className = 'src'; n.textContent = t('demo_note'); m.appendChild(n);
      buildDemo(m, DEMO[a.id]);
      return;
    }
    m.appendChild(waitingReason(real));
  }

  const VIEWS = {
    comercial(m) {
      agentShell(m, AG[0], (mm, d) => {
        if (!d) { mm.appendChild(waiting()); return; }
        const tiles = document.createElement('div'); tiles.className = 'grid g-tiles';
        tiles.appendChild(tile(t('clavis_pending'), fmt(d.pending)));
        tiles.appendChild(tile(t('gate_queue'), fmt(d.gate), { txt: '● ' + t('pending_title'), cls: 'warn' }));
        mm.appendChild(tiles);
        const two = document.createElement('div'); two.className = 'grid g-2';
        two.appendChild(panel(t('clavis_funnel'), hBars([
          { label: t('f_alvos'), v: d.funil[0] }, { label: t('f_prop'), v: d.funil[1] },
          { label: t('f_aprov'), v: d.funil[2] }, { label: t('f_env'), v: d.funil[3] }, { label: t('f_resp'), v: d.funil[4] },
        ], { color: PAL.s1 })));
        const bd = document.createElement('div'); bd.appendChild(meter(d.budget[0], d.budget[1], { label: 'tokens', unit: '' }));
        two.appendChild(panel(t('clavis_budget'), bd));
        mm.appendChild(two);
        mm.appendChild(panel(t('clavis_replies'), lineChart(d.replies, { color: PAL.s1 })));
      }, (mm, r) => {
        const tiles = document.createElement('div'); tiles.className = 'grid g-tiles';
        tiles.appendChild(tile(t('dba_pub'), val(r.publicados)));
        tiles.appendChild(tile(t('c_parceiros'), val(r.parceiros)));
        tiles.appendChild(tile(t('c_reservas90'), val(r.reservas90d)));
        tiles.appendChild(tile(t('clavis_pending'), val(r.reservasPendentes), r.reservasPendentes ? { txt: '●', cls: 'warn' } : null));
        tiles.appendChild(tile(t('gate_queue'), val(r.propostasPendentes), r.propostasPendentes ? { txt: '● ' + t('pending_title'), cls: 'warn' } : null));
        mm.appendChild(tiles);
        const two = document.createElement('div'); two.className = 'grid g-2';
        if ((r.funilOferta || []).length) two.appendChild(panel(t('c_funil_oferta'), hBars(r.funilOferta.map((s) => ({ label: s.stage, v: s.count })), { color: PAL.s1 })));
        if ((r.funilDemanda || []).length) two.appendChild(panel(t('c_funil_demanda'), hBars(r.funilDemanda.map((s) => ({ label: s.stage, v: s.count })), { color: PAL.s3 })));
        mm.appendChild(two);
        if (r.orcamento && r.orcamento.dailyLimit) {
          const bd = document.createElement('div');
          bd.appendChild(meter(r.orcamento.spentToday || 0, r.orcamento.dailyLimit, { label: 'tokens · ' + (r.orcamento.gate || 'ok') }));
          mm.appendChild(panel(t('clavis_budget'), bd));
        }
        if ((r.lacunas || []).length) {
          const rows = document.createElement('div'); rows.className = 'rows';
          r.lacunas.slice(0, 5).forEach((g) => { const x = document.createElement('div'); x.className = 'row'; x.innerHTML = `<span>${esc(String(g))}</span>`; rows.appendChild(x); });
          mm.appendChild(panel(t('c_lacunas'), rows));
        }
      });
    },
    suporte(m) {
      agentShell(m, AG[1], (mm, d) => {
        if (!d) { mm.appendChild(waiting()); return; }
        const tiles = document.createElement('div'); tiles.className = 'grid g-tiles';
        tiles.appendChild(tile(t('aria_conv'), fmt(d.conv)));
        tiles.appendChild(tile(t('aria_first'), d.first));
        tiles.appendChild(tile(t('aria_esc'), fmt(d.esc), d.esc ? { txt: '●', cls: 'warn' } : null));
        tiles.appendChild(tile(t('aria_csat'), d.csat + ' / 5'));
        mm.appendChild(tiles);
        mm.appendChild(panel(t('aria_conv14'), lineChart(d.conv14, { color: PAL.s3 })));
        const two = document.createElement('div'); two.className = 'grid g-2';
        two.appendChild(panel(t('aria_esc_tag'), hBars(d.tags.map(([k, v]) => ({ label: k, v })), { color: PAL.s3 })));
        two.appendChild(panel(t('aria_lang'), hBars(d.langs.map(([k, v]) => ({ label: k, v })), { color: PAL.s3 })));
        mm.appendChild(two);
      }, (mm, r) => {
        const tiles = document.createElement('div'); tiles.className = 'grid g-tiles';
        tiles.appendChild(tile(t('aria_conv'), val(r.mensagensHoje)));
        tiles.appendChild(tile(t('a_ativas'), val(r.conversasAtivas7d)));
        tiles.appendChild(tile(t('aria_esc'), val(r.escalacoesAbertas), r.escalacoesAbertas ? { txt: '●', cls: 'warn' } : null));
        tiles.appendChild(tile(t('aria_csat'), r.csatPlataforma !== null ? r.csatPlataforma + ' / 5' : '—'));
        tiles.appendChild(tile(t('a_reservas_hoje'), val(r.reservasHoje)));
        mm.appendChild(tiles);
        const serie = (r.serie7d || []).map((x) => Number(x.n) || 0);
        if (serie.length > 1) mm.appendChild(panel(t('a_serie7d'), lineChart(serie, { color: PAL.s3 })));
        if (r.catalogo) {
          const c = r.catalogo;
          mm.appendChild(panel(t('a_catalogo'), hBars([
            { label: t('a_sem_link'), v: Number(c.missing_link) || 0 },
            { label: t('a_sem_texto'), v: Number(c.missing_about) || 0 },
            { label: t('a_sem_coord'), v: Number(c.missing_coords) || 0 },
            { label: t('a_sem_horario'), v: Number(c.missing_hours) || 0 },
          ], { color: PAL.s2 }), { src: t('a_catalogo_src') + ' ' + val(c.total) }));
        }
      });
    },
    editorial(m) {
      agentShell(m, AG[2], (mm, d) => {
        if (!d) { mm.appendChild(waiting()); return; }
        const goal = document.createElement('div');
        goal.appendChild(meter(d.clicks, 4500, { label: t('quill_goal_sub'), unit: '' , color: PAL.s5 }));
        mm.appendChild(panel(t('quill_goal'), goal));
        mm.appendChild(panel(t('quill_clicks28'), lineChart(d.clicks28, { color: PAL.s5 })));
        const two = document.createElement('div'); two.className = 'grid g-2';
        two.appendChild(panel(t('quill_queue'), hBars(d.queue.map(([k, v]) => ({ label: t(k), v })), { color: PAL.s5 })));
        const cd = document.createElement('div'); cd.appendChild(meter(d.cost[0], d.cost[1], { label: 'USD', unit: '' }));
        two.appendChild(panel(t('quill_cost'), cd));
        mm.appendChild(two);
      }, (mm, r) => {
        if (r.clicks28d !== null) {
          const goal = document.createElement('div');
          goal.appendChild(meter(r.clicks28d, r.metaMensal || 4500, { label: `${t('q_baseline')} ${val(r.baselineMensal)} · ${t('q_meta')} ${val(r.metaMensal || 4500)}`, color: PAL.s5 }));
          mm.appendChild(panel(t('quill_goal'), goal));
        }
        const tiles = document.createElement('div'); tiles.className = 'grid g-tiles';
        tiles.appendChild(tile(t('q_fila'), val(r.filaAguardando), r.filaAguardando ? { txt: '● ' + t('pending_title'), cls: 'warn' } : null));
        tiles.appendChild(tile(t('q_pos'), r.posicao28d !== null ? String(r.posicao28d) : '—'));
        tiles.appendChild(tile(t('quill_cost'), r.custoHojeUsd !== null ? '$' + r.custoHojeUsd : '—', r.capDiarioUsd ? { txt: `cap $${r.capDiarioUsd}` } : null));
        tiles.appendChild(tile(t('q_worker'), r.workerOnline === null ? '—' : (r.workerOnline ? t('online') : t('offline')), r.workerOnline === false ? { txt: '●', cls: 'warn' } : null));
        tiles.appendChild(tile(t('q_gsc'), r.gscAtrasoDias !== null ? val(r.gscAtrasoDias, ' d') : '—'));
        mm.appendChild(tiles);
        if (r.vazaoSemanal) {
          const v = r.vazaoSemanal;
          mm.appendChild(panel(t('q_vazao'), hBars([
            { label: t('q_apr'), v: Number(v.published) || 0 },
            { label: t('q_rej'), v: Number(v.rejected) || 0 },
            { label: t('q_pend'), v: Number(v.pending) || 0 },
          ], { color: PAL.s5 })));
        }
        if ((r.errosInternos || []).length) {
          const rows = document.createElement('div'); rows.className = 'rows';
          r.errosInternos.forEach((e) => { const x = document.createElement('div'); x.className = 'row'; x.innerHTML = `<span style="color:var(--warning)">${esc(String(e))}</span>`; rows.appendChild(x); });
          mm.appendChild(panel(t('q_erros'), rows));
        }
      });
    },
    financeiro(m) {
      agentShell(m, AG[3], (mm, d) => {
        if (!d) { mm.appendChild(waiting()); return; }
        const tiles = document.createElement('div'); tiles.className = 'grid g-tiles';
        tiles.appendChild(tile(t('atlas_mrr'), d.mrr));
        tiles.appendChild(tile(t('atlas_nrr'), d.nrr, { txt: '▲', cls: 'up' }));
        tiles.appendChild(tile(t('atlas_churn'), d.churn));
        tiles.appendChild(tile(t('atlas_props'), fmt(d.props), d.props ? { txt: '● ' + t('pending_title'), cls: 'warn' } : null));
        mm.appendChild(tiles);
        mm.appendChild(panel(t('atlas_mrr6'), lineChart(d.mrr6, { color: PAL.s4, unit: '' })));
        const two = document.createElement('div'); two.className = 'grid g-2';
        const rc = document.createElement('div'); rc.className = 'rows';
        rc.innerHTML = d.recon ? `<div class="row"><span class="dot ok"></span><span>${t('atlas_recon_ok')}</span></div>` : '';
        two.appendChild(panel(t('atlas_recon'), rc));
        two.appendChild(panel(t('atlas_aging'), hBars(d.aging.map(([k, v]) => ({ label: t(k), v, fmt: '€ ' + fmt(v) })), { color: PAL.s4 })));
        mm.appendChild(two);
      }, (mm, r) => {
        const cur = r.moeda || 'EUR';
        const tiles = document.createElement('div'); tiles.className = 'grid g-tiles';
        tiles.appendChild(tile(t('atlas_mrr'), money(r.mrr, cur)));
        tiles.appendChild(tile('ARR', money(r.arr, cur)));
        tiles.appendChild(tile(t('f_assinantes'), val(r.assinantes)));
        tiles.appendChild(tile('ARPU', money(r.arpu, cur)));
        tiles.appendChild(tile(t('atlas_props'), val(r.propostasPendentes), r.propostasPendentes ? { txt: '● ' + t('pending_title'), cls: 'warn' } : null));
        mm.appendChild(tiles);
        const serie = (r.diario || []).map((x) => Number(x.gross) || 0);
        if (serie.length > 1) mm.appendChild(panel(t('f_receita_diaria'), lineChart(serie, { color: PAL.s4 })));
        const two = document.createElement('div'); two.className = 'grid g-2';
        if ((r.aging || []).length) {
          two.appendChild(panel(t('atlas_aging'), hBars(r.aging.map((a) => ({
            label: a.label, v: Number(a.total) || 0, fmt: money(a.total, cur) + (a.count ? ` (${a.count})` : ''),
          })), { color: PAL.s4 })));
        }
        const hs = document.createElement('div'); hs.className = 'rows';
        hs.innerHTML = `<div class="row"><span class="dot ${r.healthScore >= 90 ? 'ok' : 'bad'}"></span><span><b>${val(r.healthScore)}/100</b></span></div>` +
          (r.healthFatores || []).slice(0, 4).map((f) => `<div class="row"><span>${esc(String(f))}</span></div>`).join('');
        two.appendChild(panel(t('f_health'), hs));
        mm.appendChild(two);
        if ((r.propostas || []).length) {
          const rows = document.createElement('div'); rows.className = 'rows';
          r.propostas.forEach((p) => { const x = document.createElement('div'); x.className = 'row'; x.innerHTML = `<span class="id">${esc(String(p.id))}</span><span>${esc(String(p.action))}</span><span class="st-badge st-bloqueada">${esc(String(p.actor || ''))}</span>`; rows.appendChild(x); });
          mm.appendChild(panel(t('f_propostas'), rows, { src: t('f_propostas_src') }));
        }
      });
    },
    dba(m) {
      agentShell(m, AG[4], (mm, d) => {
        const logs = (S.data.logs || []).filter((e) => e.evento === 'guardrail_block').slice(-6).reverse();
        if (!d) {
          // mesmo sem conexão, os bloqueios de guardrail são dados REAIS do Orquestrador
          const rows = document.createElement('div'); rows.className = 'rows';
          if (!logs.length) rows.innerHTML = `<div class="src">${t('no_blocks')}</div>`;
          logs.forEach((e) => { const r = document.createElement('div'); r.className = 'row'; r.innerHTML = `<span class="id">${new Date(e.ts).toLocaleTimeString()}</span><span>${e.motivo || ''}</span>`; rows.appendChild(r); });
          mm.appendChild(panel(t('dba_guard'), rows, { live: true, src: t('src_state') }));
          mm.appendChild(waiting());
          return;
        }
        const tiles = document.createElement('div'); tiles.className = 'grid g-tiles';
        tiles.appendChild(tile(t('dba_pub'), fmt(d.pub)));
        tiles.appendChild(tile(t('dba_limbo'), fmt(d.limbo), { txt: '●', cls: 'warn' }));
        tiles.appendChild(tile(t('dba_compl'), d.compl));
        tiles.appendChild(tile(t('dba_mut'), fmt(d.mut)));
        mm.appendChild(tiles);
        mm.appendChild(panel(t('dba_pub_hist'), lineChart(d.pub30, { color: PAL.s2 })));
        const two = document.createElement('div'); two.className = 'grid g-2';
        two.appendChild(panel(t('dba_fields'), hBars(d.fields.map(([k, v]) => ({ label: t(k), v, fmt: v + '%' })), { color: PAL.s2 })));
        const rows = document.createElement('div'); rows.className = 'rows';
        if (!logs.length) rows.innerHTML = `<div class="src">${t('no_blocks')}</div>`;
        logs.forEach((e) => { const r = document.createElement('div'); r.className = 'row'; r.innerHTML = `<span class="id">${new Date(e.ts).toLocaleTimeString()}</span><span>${e.motivo || ''}</span>`; rows.appendChild(r); });
        two.appendChild(panel(t('dba_guard'), rows, { live: true, src: t('src_state') }));
        mm.appendChild(two);
      }, (mm, r) => {
        const tiles = document.createElement('div'); tiles.className = 'grid g-tiles';
        tiles.appendChild(tile(t('dba_pub'), val(r.publicados)));
        tiles.appendChild(tile(t('d_catalogo'), val(r.total)));
        tiles.appendChild(tile(t('d_sem_foto'), val(r.semFoto), r.semFoto ? { txt: '●', cls: 'warn' } : null));
        tiles.appendChild(tile(t('d_parceiros'), val(r.parceiros)));
        tiles.appendChild(tile(t('dba_mut'), val(r.mutacoes7d)));
        mm.appendChild(tiles);
        const c = r.completude || {};
        const campos = [
          { label: t('d_email'), v: c.email }, { label: t('d_phone'), v: c.telefone },
          { label: t('d_photo'), v: c.foto }, { label: t('d_coord'), v: c.coordenadas },
          { label: t('d_texto'), v: c.texto }, { label: t('d_site'), v: c.site },
        ].filter((x) => x.v !== null && x.v !== undefined);
        const two = document.createElement('div'); two.className = 'grid g-2';
        if (campos.length) two.appendChild(panel(t('dba_fields'), hBars(campos.map((x) => ({ label: x.label, v: x.v, fmt: x.v + '%' })), { color: PAL.s2 })));
        // Bloqueios de guardrail são dados REAIS do próprio Orquestrador — sempre exibidos.
        const logs = (S.data.logs || []).filter((e) => e.evento === 'guardrail_block').slice(-6).reverse();
        const rows = document.createElement('div'); rows.className = 'rows';
        if (!logs.length) rows.innerHTML = `<div class="src">${t('no_blocks')}</div>`;
        logs.forEach((e) => { const x = document.createElement('div'); x.className = 'row'; x.innerHTML = `<span class="id">${new Date(e.ts).toLocaleTimeString()}</span><span>${esc(e.motivo || '')}</span>`; rows.appendChild(x); });
        two.appendChild(panel(t('dba_guard'), rows, { live: true, src: t('src_state') }));
        mm.appendChild(two);
      });
    },
    // ---------- Guardião da Reserva (v4.6) — dono do pedido de mesa sem resposta ----------
    guardiao(m) {
      const a = AG.find((x) => x.id === 'guardiao');
      const hue = a.hue;
      const acaoLbl = (k) => (window.I18N[S.lang] && window.I18N[S.lang]['g_acao_' + k]) ? t('g_acao_' + k) : k;
      const linhas = (items, fn) => { const rows = document.createElement('div'); rows.className = 'rows'; if (!items.length) rows.innerHTML = `<div class="src">—</div>`; items.forEach((it) => { const r = document.createElement('div'); r.className = 'row'; r.innerHTML = fn(it); rows.appendChild(r); }); return rows; };
      const paraAprov = () => { const b = document.createElement('button'); b.className = 'nm-send'; b.textContent = '⛔ ' + t('apr_title'); b.onclick = () => { location.hash = '#/aprovacoes'; }; return b; };

      // relatório da última varredura (markdown do próprio Guardião), em tela cheia
      if (new URLSearchParams(location.hash.split('?')[1] || '').get('f') === 'relatorio') {
        const head = document.createElement('div'); head.className = 'view-head';
        head.innerHTML = `<h2 style="color:${hue}">${a.nome}</h2><span class="sub">${t('g_relatorio')}</span>`;
        m.appendChild(head);
        const back = document.createElement('button'); back.className = 'demo-btn'; back.textContent = '← ' + a.nome;
        back.onclick = () => { location.hash = '#/guardiao'; };
        m.appendChild(back);
        api('/api/guardiao/relatorio').then((doc) => {
          const p = document.createElement('section'); p.className = 'panel md-doc'; p.innerHTML = mdToHtml(doc.content || '');
          m.appendChild(p);
          m.appendChild(Object.assign(document.createElement('div'), { className: 'src', textContent: `${t('g_varredura_de')} ${doc.dia || '—'} · ${doc.fonte || ''}` }));
        }).catch((e) => { const w = document.createElement('div'); w.className = 'waiting'; w.innerHTML = `<b>${t('why_err_t')}</b><span>${esc(String(e.message || e))}</span>`; m.appendChild(w); });
        return;
      }

      agentShell(m, a, (mm, d) => {
        if (!d) { mm.appendChild(waiting()); return; }
        const tiles = document.createElement('div'); tiles.className = 'grid g-tiles';
        tiles.appendChild(tile(t('g_avaliadas'), fmt(d.avaliadas)));
        tiles.appendChild(tile(t('g_cobrar'), fmt(d.cobrar)));
        tiles.appendChild(tile(t('g_avisar'), fmt(d.avisar), d.avisar ? { txt: '● Aria', cls: 'warn' } : null));
        tiles.appendChild(tile(t('g_urgentes'), fmt(d.urgentes), d.urgentes ? { txt: '●', cls: 'warn' } : null));
        tiles.appendChild(tile(t('g_aprov'), fmt(d.aprov), d.aprov ? { txt: '● ' + t('pending_title'), cls: 'warn' } : null));
        tiles.appendChild(tile(t('g_ultima'), `${d.idade} h`));
        mm.appendChild(tiles);
        const two = document.createElement('div'); two.className = 'grid g-2';
        two.appendChild(panel(t('g_decisoes'), hBars(Object.entries(d.contagens).map(([k, v]) => ({ label: acaoLbl(k), v })), { color: hue })));
        two.appendChild(panel(t('g_serie'), lineChart(d.serie, { color: hue })));
        mm.appendChild(two);
        const two2 = document.createElement('div'); two2.className = 'grid g-2';
        two2.appendChild(panel(`${t('g_lote')} · ${d.lote.casas} / ${d.lote.reservas} ${t('g_reservas')}`, linhas(d.emails, ([n, c, i, r]) => `<span class="id">${i}</span><span><b>${esc(n)}</b> · ${esc(c)}</span><span class="st-badge st-fila">${r} ${t('g_reservas')}</span>`), { src: t('g_nada_enviado') }));
        two2.appendChild(panel(t('g_fila'), linhas(d.fila, ([h, n, c, mesa, canal]) => `<span class="id">${h} h</span><span><b>${esc(n)}</b> · ${esc(c)} · ${t('g_mesa')} ${mesa}</span><span class="st-badge st-bloqueada">${canal}</span>`)));
        mm.appendChild(two2);
        const lg = document.createElement('div'); lg.className = 'grid g-tiles';
        lg.appendChild(tile(t('g_env7'), fmt(d.ledger.env7))); lg.appendChild(tile(t('g_envtot'), fmt(d.ledger.envTot))); lg.appendChild(tile(t('g_casas'), fmt(d.ledger.casas)));
        mm.appendChild(panel(t('g_ledger'), lg));
      }, (mm, r) => {
        // pausado / anomalias: o que precisa de olho antes dos números
        if (r.pausado) {
          const w = document.createElement('div'); w.className = 'waiting';
          w.innerHTML = `<b>${t('g_pausado_t')}</b><span>${esc(r.pausado.motivo || '')}${r.pausado.ts ? ' · ' + new Date(r.pausado.ts).toLocaleString(S.lang === 'fr' ? 'fr-FR' : 'pt-BR') : ''}</span>`;
          mm.appendChild(w);
        }
        const ue = r.ultimaExecucao || {};
        const ap = r.aprovacoes || { pendentes: 0, itens: [] };
        const tiles = document.createElement('div'); tiles.className = 'grid g-tiles';
        tiles.appendChild(tile(t('g_avaliadas'), val(r.avaliadas)));
        tiles.appendChild(tile(t('g_cobrar'), val(r.cobrarCasa), r.lote && r.lote.casas ? { txt: `${r.lote.casas} ${t('g_casas_lbl')} · ${r.lote.reservas} ${t('g_reservas')}` } : null));
        tiles.appendChild(tile(t('g_avisar'), val(r.avisarCliente), r.avisarCliente ? { txt: '● Aria', cls: 'warn' } : null));
        tiles.appendChild(tile(t('g_urgentes'), val(r.urgentes), r.urgentes ? { txt: '●', cls: 'warn' } : null));
        tiles.appendChild(tile(t('g_aprov'), val(ap.pendentes), ap.pendentes ? { txt: `● ${t('pending_title')}${ap.mais_antiga_h ? ' · ' + ap.mais_antiga_h + ' h' : ''}`, cls: 'warn' } : null));
        tiles.appendChild(tile(t('g_ultima'), r.idadeHoras === null || r.idadeHoras === undefined ? '—' : `${fmt(r.idadeHoras)} h`, ue.dia ? { txt: `${ue.dia} · ${ue.modo || ''}${ue.canario ? ' · ' + t('g_canario') + ' ' + esc(String(ue.canario)) : ''}`, cls: r.idadeHoras > 30 ? 'warn' : '' } : null));
        mm.appendChild(tiles);

        // barra de ações do fundador: relatório do dia + fila de aprovações
        const bar = document.createElement('div'); bar.className = 'act-toolbar';
        const rel = document.createElement('button'); rel.className = 'nm-send'; rel.textContent = '📄 ' + t('g_relatorio'); rel.onclick = () => { location.hash = '#/guardiao?f=relatorio'; };
        bar.appendChild(rel);
        if (ap.pendentes) bar.appendChild(paraAprov());
        const src = document.createElement('span'); src.className = 'src';
        src.textContent = (r.fonte === 'sincronizado' ? `${t('g_fonte_sinc')} ${r.sincronizadoEm ? new Date(r.sincronizadoEm).toLocaleString(S.lang === 'fr' ? 'fr-FR' : 'pt-BR') : '—'} · ` : '') + `${t('g_execucoes')}: ${val(r.execucoes)} · trace ${ue.trace_id || '—'}`;
        bar.appendChild(src);
        mm.appendChild(bar);

        if ((r.anomalias || []).length) {
          mm.appendChild(panel(t('g_anomalias'), linhas(r.anomalias, (x) => `<span style="color:var(--warning)">${esc(String(x))}</span>`)));
        }

        const two = document.createElement('div'); two.className = 'grid g-2';
        const cont = Object.entries(r.contagens || {}).filter(([k, v]) => k !== 'avaliadas' && Number(v) > 0).sort((x, y) => y[1] - x[1]);
        if (cont.length) two.appendChild(panel(t('g_decisoes'), hBars(cont.map(([k, v]) => ({ label: acaoLbl(k), v: Number(v) })), { color: hue })));
        const serie = (r.serie || []).map((x) => Number(x.avaliadas) || 0);
        if (serie.length > 1) two.appendChild(panel(t('g_serie'), lineChart(serie, { color: hue }), { src: (r.serie || []).map((x) => x.dia.slice(5)).join(' · ') }));
        mm.appendChild(two);

        const two2 = document.createElement('div'); two2.className = 'grid g-2';
        two2.appendChild(panel(`${t('g_lote')} · ${(r.lote && r.lote.casas) || 0} / ${(r.lote && r.lote.reservas) || 0} ${t('g_reservas')}`,
          linhas((r.emails || []).slice(0, 40), (e) => `<span class="id">${esc(e.idioma || '')}</span><span><b>${esc(e.nome)}</b> · ${esc(e.cidade || '')}<div class="src">${(e.codigos || []).join(', ')}</div></span><span class="st-badge st-fila">${e.reservas} ${t('g_reservas')}</span>`),
          { src: t('g_nada_enviado') + ((r.lote && r.lote.idiomas || []).length ? ' · ' + r.lote.idiomas.map((x) => `${x.idioma} ${x.casas}`).join(' · ') : '') }));
        two2.appendChild(panel(t('g_fila'),
          linhas((r.fila || []).slice(0, 40), (f) => `<span class="id">${f.urgencia_h === null ? '—' : f.urgencia_h + ' h'}</span><span><b>${esc(f.nome)}</b> · ${esc(f.cidade || '')} · ${t('g_mesa')} ${esc(f.mesa || '')}<div class="src">${esc(f.reservation_code || '')} · ${t('g_degrau')} ${f.degrau ?? '—'} · ${esc(f.motivo || '')}</div></span><span class="st-badge st-bloqueada">${esc(f.canal || '')}</span>`),
          { src: t('g_fila_src') }));
        mm.appendChild(two2);

        mm.appendChild(panel(t('g_clientes'),
          linhas((r.clientes || []).slice(0, 40), (c) => `<span class="id">${c.horas_ate_mesa === null ? '—' : c.horas_ate_mesa + ' h'}</span><span><b>${esc(c.reservation_code)}</b> · ${esc(c.restaurante)} · ${esc(c.cidade || '')}<div class="src">${esc(c.motivo || '')}</div></span><span class="st-badge ${c.horas_ate_mesa !== null && c.horas_ate_mesa <= 6 ? 'st-erro' : 'st-bloqueada'}">${c.alternativas} ${t('g_alternativas')}</span>`),
          { src: t('g_clientes_src') }));

        if (ap.itens && ap.itens.length) {
          mm.appendChild(panel(`${t('g_aprov')} (${ap.pendentes})`,
            linhas(ap.itens, (x) => `<span class="id">${esc(x.id)}</span><span>${esc(x.titulo)}<div class="src">${new Date(x.criado_em).toLocaleString(S.lang === 'fr' ? 'fr-FR' : 'pt-BR')}</div></span><span class="st-badge st-bloqueada">${esc(x.tipo || '')}</span>`),
            { src: t('g_aprov_src') }));
        }

        const l = r.ledger || {};
        const lg = document.createElement('div'); lg.className = 'grid g-tiles';
        lg.appendChild(tile(t('g_env7'), val(l.enviados_7d)));
        lg.appendChild(tile(t('g_envtot'), val(l.enviados_total)));
        lg.appendChild(tile(t('g_casas'), val(l.casas_contatadas)));
        lg.appendChild(tile(t('g_ultenv'), l.ultimo_envio ? new Date(l.ultimo_envio).toLocaleDateString(S.lang === 'fr' ? 'fr-FR' : 'pt-BR') : '—'));
        mm.appendChild(panel(t('g_ledger'), lg, { src: t('g_ledger_src') }));
      });
    },
  };

  // ---------- ações (vigia de desempenho) ----------
  const AGENT_HUE = (id) => { const a = AG.find((x) => x.id === id); return a ? a.hue : 'var(--gold)'; };
  const AGENT_NAME = (id) => { const a = AG.find((x) => x.id === id); return a ? a.nome : 'OPERAÇÃO'; };

  async function decideAction(id, decisao) {
    let motivo;
    if (decisao === 'descartar') {
      motivo = prompt(t('act_motivo_prompt'));
      if (motivo === null) return;                       // cancelou
      if (motivo.trim().length < 5) { alert(t('act_motivo_curto')); return; }
    }
    try {
      await api('/api/actions/decide', { method: 'POST', body: { id, decisao, motivo } });
      refresh(true);
    } catch (e) { alert('✕ ' + String((e && e.message) || e)); }
  }

  function actCard(a) {
    const hue = AGENT_HUE(a.agente);
    const card = document.createElement('section');
    card.className = 'panel act-card sev-' + a.severidade;
    const rec = a.recomendacao || {};
    const dt = (s) => (s ? new Date(s).toLocaleString(S.lang === 'fr' ? 'fr-FR' : 'pt-BR') : '');
    card.innerHTML = `
      <div class="act-head">
        <span class="act-agent" style="color:${hue}"><span class="hue" style="background:${hue}"></span>${AGENT_NAME(a.agente)}</span>
        <span class="sev-badge sev-${a.severidade}">${t('sev_' + a.severidade)}</span>
        <span class="origem-badge">${a.origem === 'analista' ? '🧠 ' + t('origem_analista') : '👁 ' + t('origem_vigia')}</span>
        ${a.status === 'adiada' ? `<span class="st-badge st-bloqueada">${t('st_adiada')}</span>` : ''}
        <span class="act-meta">${dt(a.atualizado_em)}${a.ocorrencias > 1 ? ` · ${a.ocorrencias}× ${t('act_ocorrencias')}` : ''}</span>
      </div>
      <h4 class="act-title">${esc(a.titulo || '')}</h4>
      ${a.detalhe ? `<p class="act-det">${esc(a.detalhe)}</p>` : ''}
      ${(a.evidencia || []).length ? `<div class="act-evid">${a.evidencia.map((e) =>
        `<span class="ev"><b>${esc(String(e.metrica))}</b>: ${esc(String(e.antes))} → ${esc(String(e.depois))}${e.variacao_pct != null ? ` <em>(${e.variacao_pct}%)</em>` : ''}</span>`).join('')}</div>` : ''}
      ${rec.correcao ? `<div class="act-rec">
        ${rec.causa_provavel ? `<div><b>${t('act_causa')}:</b> ${esc(rec.causa_provavel)}</div>` : ''}
        <div><b>${t('act_correcao')}:</b> ${esc(rec.correcao)}</div>
        ${rec.impacto_estimado ? `<div><b>${t('act_impacto')}:</b> ${esc(rec.impacto_estimado)}</div>` : ''}
        ${rec.requer_aprovacao_humana !== false ? `<div class="rah">⛔ ${t('act_rah')}</div>` : ''}
      </div>` : ''}
      <div class="act-btns">
        <button class="act-btn ok" data-d="aprovar">✓ ${t('act_aprovar')}</button>
        <button class="act-btn" data-d="adiar">◷ ${t('act_adiar')}</button>
        <button class="act-btn bad" data-d="descartar">✕ ${t('act_descartar')}</button>
      </div>`;
    card.querySelectorAll('.act-btn').forEach((b) => { b.onclick = () => decideAction(a.id, b.dataset.d); });
    return card;
  }

  function viewAcoes(m) {
    const head = document.createElement('div'); head.className = 'view-head';
    head.innerHTML = `<h2>⚑ ${t('acts_title')}</h2><span class="sub">${t('acts_sub')}</span>`;
    m.appendChild(head);

    const all = S.data.acoes || [];
    const rank = { critica: 0, alta: 1, media: 2 };
    const open = all.filter((a) => a.status === 'aberta' || a.status === 'adiada')
      .sort((x, y) => (rank[x.severidade] ?? 9) - (rank[y.severidade] ?? 9) || String(y.atualizado_em || '').localeCompare(String(x.atualizado_em || '')));
    const closed = all.filter((a) => ['aprovada', 'descartada', 'resolvida'].includes(a.status))
      .sort((x, y) => String(y.atualizado_em || '').localeCompare(String(x.atualizado_em || ''))).slice(0, 12);

    const bar = document.createElement('div'); bar.className = 'act-toolbar';
    bar.innerHTML = `
      <span class="act-count">${open.length ? `${open.length} ${t('acts_open')} · <b class="crit-txt">${open.filter((a) => a.severidade === 'critica').length} ${t('acts_crit')}</b>` : ''}</span>
      <button class="nm-send" id="ac-analyze">🧠 ${t('acts_analyze')}</button>
      <span class="src" id="ac-status"></span>`;
    m.appendChild(bar);
    $('#ac-analyze', bar).onclick = async () => {
      const st = $('#ac-status', bar);
      st.textContent = '…';
      try { await api('/api/actions/analyze', { method: 'POST', body: {} }); st.textContent = '✓ ' + t('acts_analyzing'); setTimeout(() => refresh(true), 8000); }
      catch (e) { st.textContent = '✕ ' + String((e && e.message) || e); }
    };

    if (!open.length) {
      const ok = document.createElement('section'); ok.className = 'panel act-empty';
      ok.innerHTML = `<div class="ok-mark">✓</div><b>${t('acts_empty_t')}</b><p>${t('acts_empty')}</p>`;
      m.appendChild(ok);
    } else {
      open.forEach((a) => m.appendChild(actCard(a)));
    }

    if (closed.length) {
      const rows = document.createElement('div'); rows.className = 'rows';
      closed.forEach((a) => {
        const r = document.createElement('div'); r.className = 'row';
        const stCls = a.status === 'aprovada' ? 'st-concluida' : a.status === 'resolvida' ? 'st-concluida' : 'st-erro';
        r.innerHTML = `<span class="id" style="color:${AGENT_HUE(a.agente)}">${AGENT_NAME(a.agente)}</span>
          <span>${esc(a.titulo || '')}${a.motivo_descarte ? `<div class="src">${t('act_motivo')}: ${esc(a.motivo_descarte)}</div>` : ''}${a.handoff_id ? `<div class="src">handoff: ${esc(a.handoff_id)}</div>` : ''}</span>
          <span class="st-badge ${stCls}">${t('st_' + a.status)}</span>`;
        rows.appendChild(r);
      });
      m.appendChild(panel(t('acts_hist'), rows, { src: t('acts_hist_src') }));
    }
  }

  // ---------- missões ----------
  function esc(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function mdToHtml(md) {
    const lines = esc(md).split(/\r?\n/);
    let html = '', inTable = false, inList = false;
    const inline = (s) => s
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>');
    const closeAll = () => { if (inTable) { html += '</tbody></table></div>'; inTable = false; } if (inList) { html += '</ul>'; inList = false; } };
    for (const ln of lines) {
      if (/^\s*\|/.test(ln)) {
        const cells = ln.replace(/^\s*\||\|\s*$/g, '').split('|').map((c) => c.trim());
        if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue;
        if (!inTable) { if (inList) { html += '</ul>'; inList = false; } html += '<div class="md-tbl"><table><tbody>'; inTable = true; html += '<tr>' + cells.map((c) => `<th>${inline(c)}</th>`).join('') + '</tr>'; continue; }
        html += '<tr>' + cells.map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>'; continue;
      }
      if (inTable) { html += '</tbody></table></div>'; inTable = false; }
      const h = ln.match(/^(#{1,4})\s+(.*)/);
      if (h) { closeAll(); html += `<h${h[1].length + 1}>${inline(h[2])}</h${h[1].length + 1}>`; continue; }
      const li = ln.match(/^\s*[-*]\s+(.*)/);
      if (li) { if (!inList) { html += '<ul>'; inList = true; } html += `<li>${inline(li[1])}</li>`; continue; }
      if (inList) { html += '</ul>'; inList = false; }
      if (/^\s*---+\s*$/.test(ln)) { html += '<hr>'; continue; }
      if (ln.trim()) html += `<p>${inline(ln)}</p>`;
    }
    closeAll();
    return html;
  }
  async function viewMissoes(m, seq) {
    const stale = () => seq !== renderSeq;
    const head = document.createElement('div'); head.className = 'view-head';
    head.innerHTML = `<h2>${t('missions_title')}</h2><span class="sub">${t('missions_sub')}</span>`;
    m.appendChild(head);
    let list = { missions: S.data.missions || [] };
    if (!S.data.missions) { try { list = await api('/api/missions'); } catch {} }
    if (stale()) return;
    const file = new URLSearchParams(location.hash.split('?')[1] || '').get('f');
    if (file) {
      try {
        const doc = await api('/api/mission?f=' + encodeURIComponent(file));
        if (stale()) return;
        const back = document.createElement('button'); back.className = 'demo-btn'; back.textContent = '← ' + t('missions_title');
        back.onclick = () => { location.hash = '#/missoes'; };
        m.appendChild(back);
        const p = document.createElement('section'); p.className = 'panel md-doc'; p.innerHTML = mdToHtml(doc.content);
        m.appendChild(p);
      } catch { m.appendChild(waiting()); }
      return;
    }
    // --- Nova Missão: onde o fundador explica o conteúdo e faz o pedido ao MAESTRO ---
    const nm = document.createElement('section'); nm.className = 'panel';
    nm.innerHTML = `
      <h3>${t('nm_title')}</h3>
      <p class="src" style="margin:0">${t('nm_hint')}</p>
      <input id="nm-titulo" class="nm-in" maxlength="160" placeholder="${t('nm_titulo_ph')}">
      <textarea id="nm-desc" class="nm-in" rows="5" maxlength="8000" placeholder="${t('nm_desc_ph')}"></textarea>
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
        <select id="nm-prio" class="nm-in" style="flex:0 0 auto">
          <option value="normal">${t('prio_normal')}</option>
          <option value="alta">${t('prio_alta')}</option>
          <option value="critica">${t('prio_critica')}</option>
          <option value="baixa">${t('prio_baixa')}</option>
        </select>
        <button id="nm-send" class="nm-send">${t('nm_send')}</button>
        <span id="nm-status" class="src"></span>
      </div>`;
    m.appendChild(nm);
    $('#nm-send', nm).onclick = async () => {
      const titulo = $('#nm-titulo', nm).value.trim();
      const descricao = $('#nm-desc', nm).value.trim();
      const st = $('#nm-status', nm);
      if (!titulo || !descricao) { st.textContent = t('nm_missing'); return; }
      st.textContent = '…';
      try {
        const resp = await api('/api/missions/new', { method: 'POST', body: { titulo, descricao, prioridade: $('#nm-prio', nm).value } });
        $('#nm-titulo', nm).value = ''; $('#nm-desc', nm).value = '';
        st.textContent = '✓ ' + (resp.brain ? t('nm_ok_brain') : t('nm_ok'));
        refresh(true);
      } catch (err) {
        const msg = String((err && err.message) || '');
        st.textContent = msg && msg !== '401' ? '✕ ' + msg : t('nm_fail');
        st.style.color = 'var(--critical)';
      }
    };

    // --- Fila do MAESTRO (com status ao vivo do cérebro) ---
    let inbox = { items: S.data.inbox || [] };
    if (!S.data.inbox) { try { inbox = await api('/api/inbox'); } catch {} }
    if (stale()) return;
    const visiveis = inbox.items.filter((i) => i.status !== 'entregue');
    if (visiveis.length) {
      const q = document.createElement('div'); q.className = 'rows';
      visiveis.forEach((it) => {
        const st = it.status || 'fila';
        const badge = st === 'processando'
          ? `<span class="st-badge st-processando"><span class="spin"></span> ${t('st_processando')}${it.modelo ? ' · ' + esc(it.modelo) : ''}</span>`
          : st === 'erro'
            ? `<span class="st-badge st-erro" title="${esc(it.erro || '')}">${t('st_erro')}</span>`
            : `<span class="st-badge st-fila">${t('st_fila')} · ${it.prioridade}</span>`;
        const r = document.createElement('div'); r.className = 'row';
        r.innerHTML = `<span class="id">${it.id}</span><span><b>${esc(it.titulo)}</b> — ${esc(it.descricao).slice(0, 120)}${it.descricao.length > 120 ? '…' : ''}${st === 'erro' && it.erro ? `<div class="src">${esc(it.erro)}</div>` : ''}</span>${badge}`;
        q.appendChild(r);
      });
      m.appendChild(panel(t('nm_queue'), q, { live: true, src: t('nm_queue_src') }));
    }

    const rows = document.createElement('div'); rows.className = 'rows';
    if (!list.missions.length) rows.innerHTML = `<div class="src">${t('missions_empty')}</div>`;
    list.missions.forEach((mi) => {
      const r = document.createElement('button'); r.className = 'row mission-row';
      r.innerHTML = `<span class="id">${mi.file.replace('.md', '')}</span><span>${mi.title}</span><span class="st-badge st-concluida">${t('missions_open')}</span>`;
      r.onclick = () => { location.hash = '#/missoes?f=' + encodeURIComponent(mi.file); };
      rows.appendChild(r);
    });
    m.appendChild(panel(t('missions_list'), rows, { live: true, src: t('missions_src') }));
  }

  // ---------- router / render ----------
  let renderSeq = 0;
  function render() {
    buildHeader();
    const seq = ++renderSeq;
    const m = $('#view'); m.innerHTML = '';
    const route = location.hash.replace('#/', '').split('?')[0];
    if (route === 'conversa' && window.V4) { window.V4.viewConversa(m); return; }
    if (route === 'aprovacoes' && window.V4) { window.V4.viewAprovacoes(m); return; }
    if (route === 'missoes') { viewMissoes(m, seq); return; }
    if (route === 'acoes') { viewAcoes(m); return; }
    if (VIEWS[route]) VIEWS[route](m); else viewHome(m);
  }

  // ---------- backup (baixar conversas + aprovações) ----------
  async function baixarBackup() {
    try {
      const r = await fetch('/api/backup', { headers: S.token ? { 'x-center-key': S.token } : {} });
      if (!r.ok) throw new Error('http ' + r.status);
      const blob = await r.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'maestro-backup-' + new Date().toISOString().slice(0, 10) + '.json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    } catch (e) { alert('✕ ' + String((e && e.message) || e)); }
  }

  // ---------- paleta de comandos (Cmd/Ctrl+K) ----------
  function palActions() {
    const acts = [
      { k: 'H', label: '◆ ' + t('nav_home'), run: () => { location.hash = ''; } },
      ...AG.map((a, i) => ({ k: String(i + 1), label: '● ' + a.nome + ' — ' + t(a.roleKey), run: () => { location.hash = '#/' + a.id; } })),
      { k: 'C', label: '⌘ ' + t('conv_title'), run: () => { location.hash = '#/conversa'; } },
      { k: 'P', label: '⛔ ' + t('apr_title'), run: () => { location.hash = '#/aprovacoes'; } },
      { k: 'M', label: '◈ ' + t('missions_title'), run: () => { location.hash = '#/missoes'; } },
      { k: 'A', label: '⚑ ' + t('acts_title'), run: () => { location.hash = '#/acoes'; } },
      { k: 'N', label: '✍ ' + t('nm_title'), run: () => { location.hash = '#/missoes'; setTimeout(() => { const el = $('#nm-titulo'); if (el) el.focus(); }, 250); } },
      { k: 'D', label: '◐ ' + t('demo_toggle') + ' on/off', run: () => { S.demo = !S.demo; localStorage.setItem('mc_demo', S.demo ? '1' : '0'); render(); } },
      { k: 'L', label: '🌐 PT ⇄ FR', run: () => { S.lang = S.lang === 'pt' ? 'fr' : 'pt'; localStorage.setItem('mc_lang', S.lang); render(); } },
    ];
    const last = (S.data.missions || [])[0];
    if (last) acts.push({ k: 'R', label: '📄 ' + last.title, run: () => { location.hash = '#/missoes?f=' + encodeURIComponent(last.file); } });
    acts.push({ k: 'B', label: '💾 ' + t('backup_label'), run: () => baixarBackup() });
    return acts;
  }
  let palSel = 0;
  function palRender() {
    const q = $('#pal-input').value.trim().toLowerCase();
    const items = palActions().filter((a) => !q || a.label.toLowerCase().includes(q));
    palSel = Math.min(palSel, Math.max(0, items.length - 1));
    const list = $('#pal-list'); list.innerHTML = '';
    items.forEach((a, i) => {
      const d = document.createElement('div'); d.className = 'pal-item' + (i === palSel ? ' sel' : '');
      d.innerHTML = `<span>${a.label}</span><span class="kbd">${a.k}</span>`;
      d.onclick = () => { palClose(); a.run(); };
      list.appendChild(d);
    });
    list._items = items;
  }
  function palOpen() { palSel = 0; $('#palette').className = 'on'; $('#pal-input').value = ''; palRender(); $('#pal-input').focus(); }
  function palClose() { $('#palette').className = ''; }
  addEventListener('keydown', (e) => {
    const pal = $('#palette').className === 'on';
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); pal ? palClose() : palOpen(); return; }
    if (pal) {
      const items = $('#pal-list')._items || [];
      if (e.key === 'Escape') { palClose(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); palSel = Math.min(items.length - 1, palSel + 1); palRender(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); palSel = Math.max(0, palSel - 1); palRender(); }
      else if (e.key === 'Enter') { e.preventDefault(); const a = items[palSel]; if (a) { palClose(); a.run(); } }
      return;
    }
    // atalhos de uma tecla (fora de campos de texto)
    const ae = document.activeElement;
    if (ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName)) return;
    const map = { h: '', 1: '#/comercial', 2: '#/suporte', 3: '#/editorial', 4: '#/financeiro', 5: '#/dba', 6: '#/guardiao', m: '#/missoes', a: '#/acoes', c: '#/conversa', p: '#/aprovacoes' };
    if (e.key.toLowerCase() in map && !e.ctrlKey && !e.metaKey && !e.altKey) location.hash = map[e.key.toLowerCase()];
  });
  $('#palette').addEventListener('click', (e) => { if (e.target.id === 'palette') palClose(); });
  $('#pal-input').addEventListener('input', () => { palSel = 0; palRender(); });

  // ---------- gate ----------
  function gate(on) { $('#gate').className = on ? 'on' : ''; if (on) $('#gate input').focus(); }
  $('#gate button').onclick = () => {
    S.token = $('#gate input').value.trim(); localStorage.setItem('mc_key', S.token); gate(false); refresh();
  };
  $('#gate input').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#gate button').click(); });

  // ---------- wiring ----------
  $('#lang-pt').onclick = () => { S.lang = 'pt'; localStorage.setItem('mc_lang', 'pt'); render(); };
  $('#lang-fr').onclick = () => { S.lang = 'fr'; localStorage.setItem('mc_lang', 'fr'); render(); };
  $('#demo-btn').onclick = () => { S.demo = !S.demo; localStorage.setItem('mc_demo', S.demo ? '1' : '0'); render(); };
  $('#missions-btn').onclick = () => { location.hash = '#/missoes'; };
  $('#actions-btn').onclick = () => { location.hash = '#/acoes'; };
  $('#conv-btn').onclick = () => { location.hash = '#/conversa'; };
  $('#apr-btn').onclick = () => { location.hash = '#/aprovacoes'; };
  $('#brand').onclick = () => { location.hash = ''; };
  addEventListener('hashchange', render);

  // Carimbo de build no rodapé: /health é público, então isto funciona mesmo antes de
  // informar a chave — é a forma mais rápida de saber se o deploy realmente subiu.
  fetch('/health').then((r) => r.json()).then((h) => {
    const f = document.querySelector('footer');
    if (f && h && h.build) {
      f.innerHTML = `MAESTRO · THE WORLD KEYS · COORDENA, NÃO EXECUTA · <span style="color:var(--gold)">build ${h.build}</span>` +
        (h.kpi_proxy === 'ok' ? ' · KPI proxy ativo' : '');
    }
  }).catch(() => {});

  // abertura cinematográfica (1x por sessão do navegador)
  const boot = document.getElementById('boot');
  if (boot) {
    if (sessionStorage.getItem('mc_boot') || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      boot.remove();
    } else {
      sessionStorage.setItem('mc_boot', '1');
      setTimeout(() => boot.classList.add('done'), 950);
      setTimeout(() => boot.remove(), 1400);
    }
  }

  // hooks compartilhados com a Conversa v4 (chat.js)
  window.MC = { api, t, esc, mdToHtml, fmt, S, refresh };

  render();
  refresh(true);
  setInterval(() => refresh(false), 30_000);
})();
