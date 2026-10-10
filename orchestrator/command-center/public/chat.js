/* MAESTRO v4 — Conversa (chat multimodal), Ateliê de entregas e Aprovações do fundador.
   Sem dependências. Integra com app.js via window.MC (api, t, esc, mdToHtml, S). */
(() => {
  const $ = (s, el) => (el || document).querySelector(s);
  const MC = () => window.MC; // hooks do app.js (definidos antes deste arquivo rodar render)

  const AGENTES = [
    { id: 'orquestrador', nome: 'MAESTRO', hue: 'var(--gold)', hex: '#c9a96e' },
    { id: 'comercial', nome: 'CLAVIS', hue: '#3987e5', hex: '#3987e5' },
    { id: 'suporte', nome: 'ARIA', hue: '#199e70', hex: '#199e70' },
    { id: 'editorial', nome: 'QUILL', hue: '#d55181', hex: '#d55181' },
    { id: 'financeiro', nome: 'ATLAS', hue: '#c98500', hex: '#c98500' },
    { id: 'dba', nome: 'DB ARCHITECT', hue: '#d95926', hex: '#d95926' },
    { id: 'guardiao', nome: 'GUARDIÃO', hue: '#9085e9', hex: '#9085e9' },
  ];
  // Os cartões do Guardião e os handoffs à Aria chegam com os ids do contrato de handoff; mapeia para a frota da Central.
  const ALIAS = { 'guardiao-reserva': 'guardiao', 'suporte-concierge': 'suporte' };
  const AG = (id) => AGENTES.find((a) => a.id === (ALIAS[id] || id)) || AGENTES[0];

  // estado local da conversa (sobrevive a re-render do router, não ao reload)
  const CS = {
    agente: localStorage.getItem('mc_cv_agente') || 'orquestrador',
    prioridade: 'normal',
    threadId: null,
    anexos: [],          // [{id, nome, mime, kind, bytes}]
    entregas: [],        // [{id, lang, code, origem}]
    entregaSel: null,
    sending: false,
    mic: null,
  };
  window.CS = CS;

  const t = (k) => MC().t(k);
  const esc = (s) => MC().esc(String(s == null ? '' : s));

  // ---------- dinheiro (unidades mínimas → exibição; nunca float na conta) ----------
  function eur(e4) {
    const cents = Math.round((e4 || 0) / 100); // e4 → centavos
    const s = (cents / 100).toLocaleString(MC().S.lang === 'fr' ? 'fr-FR' : 'pt-BR', { style: 'currency', currency: 'EUR' });
    return s;
  }
  const LIMITE_E4 = 10 * 10_000; // €10 em unidades de 0,0001 (constituição: revisão acima disso)

  // ---------- fences: texto ↔ entregas ----------
  const ENTREGA_LANGS = ['html', 'svg', 'csv', 'markdown', 'md'];
  function splitFences(text) {
    const parts = [];
    const re = /```([\w-]*)[ \t]*\n([\s\S]*?)(?:```|$)/g;
    let last = 0, m;
    while ((m = re.exec(text))) {
      if (m.index > last) parts.push({ type: 'text', md: text.slice(last, m.index) });
      const closed = /```\s*$/.test(m[0]);
      parts.push({ type: 'fence', lang: (m[1] || '').toLowerCase(), code: m[2], open: !closed });
      last = re.lastIndex;
    }
    if (last < text.length) parts.push({ type: 'text', md: text.slice(last) });
    return parts;
  }

  function entregaTitulo(lang) {
    return { html: t('ent_html'), svg: t('ent_svg'), csv: t('ent_csv'), markdown: t('ent_md'), md: t('ent_md') }[lang] || lang;
  }

  // renderiza texto rico (markdown + cartões de entrega) dentro de um container
  function renderRich(container, text, { collect = false } = {}) {
    container.innerHTML = '';
    for (const p of splitFences(String(text || ''))) {
      if (p.type === 'text') {
        if (!p.md.trim()) continue;
        const d = document.createElement('div');
        d.innerHTML = MC().mdToHtml(p.md);
        container.appendChild(d);
        continue;
      }
      if (p.lang === 'aprovacao') {
        const d = document.createElement('div'); d.className = 'apr-inline';
        d.innerHTML = `⛔ <b>${t('apr_solicitada')}</b> — <a href="#/aprovacoes">${t('apr_ver_fila')}</a>`;
        container.appendChild(d);
        continue;
      }
      if (ENTREGA_LANGS.includes(p.lang) && !p.open) {
        let ent = null;
        if (collect) {
          ent = { id: 'ENT-' + (CS.entregas.length + 1), lang: p.lang === 'md' ? 'markdown' : p.lang, code: p.code };
          CS.entregas.push(ent);
        } else {
          ent = CS.entregas.find((e) => e.code === p.code) ||
            (CS.entregas.push({ id: 'ENT-' + (CS.entregas.length + 1), lang: p.lang === 'md' ? 'markdown' : p.lang, code: p.code }), CS.entregas[CS.entregas.length - 1]);
        }
        container.appendChild(entregaCard(ent));
        continue;
      }
      if (p.open) {
        const d = document.createElement('div'); d.className = 'ent-card building';
        d.innerHTML = `<span class="spin"></span> ${t('ent_construindo')}${p.lang ? ' · ' + esc(p.lang) : ''}`;
        container.appendChild(d);
        continue;
      }
      const pre = document.createElement('pre'); pre.className = 'code-block';
      pre.textContent = p.code;
      container.appendChild(pre);
    }
  }

  function entregaCard(ent) {
    const d = document.createElement('div'); d.className = 'ent-card';
    d.innerHTML = `
      <div class="ent-head"><span class="ent-kind">${esc(entregaTitulo(ent.lang))}</span>
        <span class="src">${(ent.code.length / 1024).toFixed(1)} KB</span></div>
      <div class="ent-btns">
        <button class="ent-b primary" data-a="abrir">◫ ${t('atelie_abrir')}</button>
        <button class="ent-b" data-a="pdf">PDF</button>
        <button class="ent-b" data-a="png">PNG</button>
        <button class="ent-b" data-a="baixar">↓ ${t('atelie_baixar')}</button>
      </div>`;
    d.querySelectorAll('.ent-b').forEach((b) => {
      b.onclick = () => {
        if (b.dataset.a === 'abrir') { CS.entregaSel = ent.id; renderAtelie(); }
        if (b.dataset.a === 'pdf') exportPdf(ent);
        if (b.dataset.a === 'png') exportPng(ent);
        if (b.dataset.a === 'baixar') exportRaw(ent);
      };
    });
    return d;
  }

  // ---------- Ateliê: preview + exportação ----------
  function previewHtml(ent) {
    if (ent.lang === 'html') return ent.code;
    if (ent.lang === 'svg') return `<!doctype html><body style="margin:0;display:grid;place-items:center;background:#fff">${ent.code}</body>`;
    if (ent.lang === 'markdown') {
      return `<!doctype html><body style="margin:0;padding:28px;font-family:Georgia,serif;color:#1c1c22;background:#fff;line-height:1.6">${MC().mdToHtml(ent.code)}</body>`;
    }
    if (ent.lang === 'csv') return `<!doctype html><body style="margin:0;padding:20px;background:#fff;color:#1c1c22;font-family:system-ui">${csvParaTabela(ent.code)}</body>`;
    return '<!doctype html><body></body>';
  }
  function csvParaTabela(csv) {
    const linhas = csv.trim().split(/\r?\n/).map((l) => {
      // parser simples com aspas
      const out = []; let cur = '', q = false;
      for (let i = 0; i < l.length; i++) {
        const c = l[i];
        if (q) { if (c === '"' && l[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
        else if (c === '"') q = true;
        else if (c === ',' || c === ';') { out.push(cur); cur = ''; }
        else cur += c;
      }
      out.push(cur); return out;
    });
    const e2 = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
    let h = '<table style="border-collapse:collapse;width:100%;font-size:14px">';
    linhas.forEach((cells, i) => {
      h += '<tr>' + cells.map((c) => `<${i ? 'td' : 'th'} style="border:1px solid #d5d2c8;padding:6px 10px;text-align:left">${e2(c)}</${i ? 'td' : 'th'}>`).join('') + '</tr>';
    });
    return h + '</table>';
  }

  const TIMBRE = () => `
    <div style="display:flex;justify-content:space-between;align-items:baseline;border-bottom:2px solid #c9a96e;padding-bottom:10px;margin-bottom:22px;font-family:Georgia,serif">
      <div style="font-size:20px;letter-spacing:.18em">THE WORLD KEYS</div>
      <div style="font-size:11px;color:#8a8578;letter-spacing:.14em">MAESTRO · ${new Date().toLocaleDateString('pt-BR')} · PARIS</div>
    </div>`;

  function exportRaw(ent) {
    const ext = { html: 'html', svg: 'svg', csv: 'csv', markdown: 'md' }[ent.lang] || 'txt';
    const mime = { html: 'text/html', svg: 'image/svg+xml', csv: 'text/csv', markdown: 'text/markdown' }[ent.lang] || 'text/plain';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([ent.code], { type: mime + ';charset=utf-8' }));
    a.download = `twk-${ent.id.toLowerCase()}.${ext}`;
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }
  function exportPdf(ent) {
    const w = window.open('', '_blank');
    if (!w) return alert(t('atelie_popup'));
    const corpo = ent.lang === 'html' ? ent.code
      : ent.lang === 'svg' ? ent.code
        : ent.lang === 'csv' ? csvParaTabela(ent.code)
          : MC().mdToHtml(ent.code);
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>TWK · ${ent.id}</title>
      <style>@page{margin:18mm}body{font-family:Georgia,serif;color:#1c1c22;line-height:1.55}
      table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:6px 10px}</style></head>
      <body>${ent.lang === 'html' ? corpo : TIMBRE() + corpo}</body></html>`);
    w.document.close();
    w.onload = () => setTimeout(() => w.print(), 250);
    setTimeout(() => { try { w.print(); } catch {} }, 900);
  }
  function exportPng(ent) {
    const W = 1200;
    const done = (canvas) => canvas.toBlob((blob) => {
      if (!blob) return alert(t('atelie_png_falha'));
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = `twk-${ent.id.toLowerCase()}.png`; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    });
    try {
      let svgTxt;
      if (ent.lang === 'svg') {
        svgTxt = ent.code;
      } else {
        const corpo = ent.lang === 'html' ? ent.code : ent.lang === 'csv' ? csvParaTabela(ent.code) : MC().mdToHtml(ent.code);
        // medir a altura real num iframe oculto seria mais preciso; 1600 cobre a maioria — PDF é a rota fiel
        svgTxt = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="1600">
          <foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml"
            style="background:#ffffff;color:#1c1c22;font-family:Georgia,serif;padding:32px;width:${W - 64}px;line-height:1.55">${corpo}</div></foreignObject></svg>`;
      }
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = img.width || W; c.height = img.height || 1600;
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, c.width, c.height);
        ctx.drawImage(img, 0, 0);
        try { done(c); } catch { alert(t('atelie_png_falha')); }
      };
      img.onerror = () => alert(t('atelie_png_falha'));
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgTxt);
    } catch { alert(t('atelie_png_falha')); }
  }

  function renderAtelie() {
    const panel = $('#cv-atelie');
    if (!panel) return;
    const ent = CS.entregas.find((e) => e.id === CS.entregaSel);
    if (!ent) {
      panel.className = 'cv-atelie';
      panel.innerHTML = `<div class="at-empty"><div class="at-mark">◫</div><b>${t('atelie_title')}</b><p>${t('atelie_empty')}</p></div>`;
      return;
    }
    panel.className = 'cv-atelie on';
    panel.innerHTML = `
      <div class="at-bar">
        <span class="at-title">${esc(entregaTitulo(ent.lang))} · ${ent.id}</span>
        <span style="flex:1"></span>
        <button class="ent-b" id="at-code">‹/› ${t('atelie_codigo')}</button>
        <button class="ent-b" id="at-pdf">PDF</button>
        <button class="ent-b" id="at-png">PNG</button>
        <button class="ent-b" id="at-raw">↓</button>
        <button class="ent-b" id="at-close">✕</button>
      </div>
      <div class="at-body"><iframe id="at-frame" sandbox="allow-same-origin" title="preview"></iframe><pre id="at-src" class="code-block" style="display:none"></pre></div>
      ${CS.entregas.length > 1 ? `<div class="at-vers">${CS.entregas.map((e) =>
        `<button class="at-v ${e.id === ent.id ? 'sel' : ''}" data-id="${e.id}">${e.id.replace('ENT-', 'v')}</button>`).join('')}</div>` : ''}`;
    $('#at-frame', panel).srcdoc = previewHtml(ent);
    $('#at-src', panel).textContent = ent.code;
    $('#at-code', panel).onclick = () => {
      const src = $('#at-src', panel), fr = $('#at-frame', panel);
      const showCode = src.style.display === 'none';
      src.style.display = showCode ? 'block' : 'none';
      fr.style.display = showCode ? 'none' : 'block';
    };
    $('#at-pdf', panel).onclick = () => exportPdf(ent);
    $('#at-png', panel).onclick = () => exportPng(ent);
    $('#at-raw', panel).onclick = () => exportRaw(ent);
    $('#at-close', panel).onclick = () => { CS.entregaSel = null; renderAtelie(); };
    panel.querySelectorAll('.at-v').forEach((b) => { b.onclick = () => { CS.entregaSel = b.dataset.id; renderAtelie(); }; });
  }

  // ---------- estado do MAESTRO (imponência com verdade: o estado é real) ----------
  function setEstado(mode, extra) {
    const el = $('#cv-state'); if (!el) return;
    const nome = AG(CS.agente).nome;
    if (mode === 'stream') { el.className = 'cv-state busy'; el.innerHTML = `<span class="pulse"></span>${nome} · ${t('cv_orquestrando')}`; }
    else if (mode === 'think') { el.className = 'cv-state busy'; el.innerHTML = `<span class="pulse"></span>${nome} · ${t('cv_analisando')}`; }
    else if (mode === 'apr') { el.className = 'cv-state warn'; el.innerHTML = `⛔ ${t('cv_aguardando_decisao')}${extra ? ' (' + extra + ')' : ''}`; }
    else { el.className = 'cv-state'; el.innerHTML = `<span class="dot ok"></span>${nome} · ${t('cv_em_escuta')}`; }
  }

  // ---------- mensagens ----------
  function msgEl(role, agenteId) {
    const a = AG(agenteId);
    const d = document.createElement('div');
    d.className = 'cv-msg ' + (role === 'user' ? 'me' : 'bot');
    d.innerHTML = role === 'user'
      ? `<div class="cv-bubble"></div>`
      : `<div class="cv-who" style="color:${a.hex}">${a.nome}</div><div class="cv-bubble"></div>`;
    return d;
  }
  function anexoChipHtml(x) {
    const ico = x.kind === 'img' ? '🖼' : x.kind === 'pdf' ? '📄' : '📎';
    return `<span class="anx-chip">${ico} ${esc(x.nome)} <i>${(x.bytes / 1024).toFixed(0)} KB</i></span>`;
  }
  function appendUserMsg(list, texto, anexos) {
    const d = msgEl('user');
    const b = $('.cv-bubble', d);
    if (anexos && anexos.length) {
      const imgs = anexos.filter((x) => x.kind === 'img').map((x) => `<img class="anx-img" src="/api/anexo?id=${x.id}" alt="${esc(x.nome)}">`).join('');
      const chips = anexos.filter((x) => x.kind !== 'img').map(anexoChipHtml).join('');
      b.innerHTML = (imgs ? `<div class="anx-imgs">${imgs}</div>` : '') + (chips ? `<div>${chips}</div>` : '');
    }
    if (texto) { const p = document.createElement('div'); p.innerHTML = MC().mdToHtml(texto); b.appendChild(p); }
    list.appendChild(d);
    return d;
  }

  function scrollBottom() { const l = $('#cv-list'); if (l) l.scrollTop = l.scrollHeight; }

  // imagens de anexo precisam da chave: busca com header e injeta blob
  function hydrateAnexoImgs(root) {
    (root || document).querySelectorAll('img.anx-img[src^="/api/anexo"]').forEach(async (img) => {
      try {
        const r = await fetch(img.getAttribute('src'), { headers: MC().S.token ? { 'x-center-key': MC().S.token } : {} });
        if (r.ok) img.src = URL.createObjectURL(await r.blob());
      } catch {}
    });
  }

  // ---------- envio com streaming SSE ----------
  async function enviar() {
    if (CS.sending) return;
    const ta = $('#cv-input');
    const texto = ta.value.trim();
    if (!texto && !CS.anexos.length) return;
    CS.sending = true;
    $('#cv-send').disabled = true;
    const list = $('#cv-list');
    $('#cv-hero') && $('#cv-hero').remove();
    appendUserMsg(list, texto, CS.anexos);
    hydrateAnexoImgs(list);
    const anexosEnviados = CS.anexos.slice();
    CS.anexos = []; renderAnexos();
    ta.value = ''; ta.style.height = 'auto';
    setEstado('think');

    const bot = msgEl('assistant', CS.agente);
    const bubble = $('.cv-bubble', bot);
    bubble.innerHTML = `<div class="cv-tools"></div><div class="cv-rich"><span class="spin"></span></div>`;
    const toolsBox = $('.cv-tools', bubble);
    const rich = $('.cv-rich', bubble);
    list.appendChild(bot); scrollBottom();

    let full = '';
    let raf = null;
    const paint = () => { raf = null; renderRich(rich, full); scrollBottom(); };
    const toolChip = (data) => {
      if (data.status === 'executando') {
        const c = document.createElement('span'); c.className = 'tool-chip run';
        c.innerHTML = `<span class="spin"></span> ${esc(data.resumo || data.name)}`;
        c.dataset.name = data.name; toolsBox.appendChild(c);
      } else {
        const run = [...toolsBox.querySelectorAll('.tool-chip.run')].find((c) => c.dataset.name === data.name);
        const c = run || document.createElement('span');
        c.className = 'tool-chip ok'; c.innerHTML = `🔧 ${esc(data.resumo || data.name)}`;
        if (!run) toolsBox.appendChild(c);
      }
      scrollBottom();
    };

    try {
      const r = await fetch('/api/chat/send', {
        method: 'POST',
        headers: Object.assign({ 'content-type': 'application/json' }, MC().S.token ? { 'x-center-key': MC().S.token } : {}),
        body: JSON.stringify({
          thread_id: CS.threadId, agente: CS.agente, texto,
          prioridade: CS.prioridade, anexos: anexosEnviados.map((x) => ({ id: x.id })),
        }),
      });
      if (!r.ok || !r.body) {
        let d = ''; try { d = (await r.json()).error || ''; } catch {}
        throw new Error(d || 'http ' + r.status);
      }
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      let firstDelta = true;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const raw = buf.slice(0, idx); buf = buf.slice(idx + 2);
          const evM = raw.match(/^event: (.+)$/m); const dtM = raw.match(/^data: (.+)$/m);
          if (!evM || !dtM) continue;
          const ev = evM[1]; let data = {};
          try { data = JSON.parse(dtM[1]); } catch {}
          if (ev === 'meta') {
            CS.threadId = data.thread_id;
            history.replaceState(null, '', '#/conversa?id=' + data.thread_id);
          } else if (ev === 'delta') {
            if (firstDelta) { firstDelta = false; setEstado('stream'); }
            full += data.t;
            if (!raf) raf = requestAnimationFrame(paint);
          } else if (ev === 'tool') {
            setEstado('think');
            toolChip(data);
          } else if (ev === 'done') {
            if (raf) cancelAnimationFrame(raf);
            if (data.offline) {
              rich.innerHTML = `<div class="cv-offline">◈ ${esc(data.aviso)}</div>`;
            } else {
              renderRich(rich, full);
              const meta = document.createElement('div'); meta.className = 'cv-meta';
              meta.innerHTML = `${esc(data.modelo)} · ${MC().fmt(data.usage.input)}→${MC().fmt(data.usage.output)} tok · ${eur(data.custo_e4.eur)} <i title="${esc(data.metodologia)}">est.</i>`;
              bot.appendChild(meta);
              atualizaCusto(data.custo_total_e4, data.metodologia);
              if ((data.aprovacoes || []).length) { setEstado('apr', data.aprovacoes.length); MC().refresh(true); }
            }
            scrollBottom();
          } else if (ev === 'error') {
            if (raf) cancelAnimationFrame(raf);
            rich.innerHTML = `<div class="cv-err">✕ ${esc(data.error)}</div>` + (full ? rich.innerHTML : '');
          }
        }
      }
      if (full && !$('.cv-err', bubble)) renderRich(rich, full);
    } catch (e) {
      rich.innerHTML = `<div class="cv-err">✕ ${esc(String((e && e.message) || e))}</div>`;
    } finally {
      CS.sending = false;
      const sb = $('#cv-send'); if (sb) sb.disabled = false;
      if (!$('#cv-state') || !$('#cv-state').className.includes('warn')) setEstado('idle');
      carregarThreads();
      scrollBottom();
    }
  }

  function atualizaCusto(totalE4, metodologia) {
    const el = $('#cv-cost'); if (!el || !totalE4) return;
    el.style.display = 'inline-flex';
    el.className = 'cv-cost' + (totalE4.eur >= LIMITE_E4 ? ' over' : '');
    el.innerHTML = `${eur(totalE4.eur)} <i>est.</i>${totalE4.eur >= LIMITE_E4 ? ' ⚠ >€10' : ''}`;
    el.title = (metodologia || '') + (totalE4.eur >= LIMITE_E4 ? ' · Constituição: tarefa acima de €10 pede revisão antes de continuar.' : '');
  }

  // ---------- anexos (upload/colar) ----------
  function renderAnexos() {
    const box = $('#cv-anx'); if (!box) return;
    box.innerHTML = CS.anexos.map((x, i) =>
      `<span class="anx-chip">${x.kind === 'img' ? '🖼' : x.kind === 'pdf' ? '📄' : '📎'} ${esc(x.nome)} <i>${(x.bytes / 1024).toFixed(0)} KB</i><button data-i="${i}">✕</button></span>`).join('');
    box.querySelectorAll('button').forEach((b) => { b.onclick = () => { CS.anexos.splice(Number(b.dataset.i), 1); renderAnexos(); }; });
  }
  async function subirArquivo(file) {
    const st = $('#cv-status');
    if (file.size > 8 * 1024 * 1024) { st.textContent = '✕ ' + t('cv_anexo_grande'); return; }
    st.textContent = '⇡ ' + esc(file.name) + '…';
    try {
      const b64 = await new Promise((ok, bad) => {
        const fr = new FileReader();
        fr.onload = () => ok(String(fr.result).split(',')[1] || '');
        fr.onerror = bad;
        fr.readAsDataURL(file);
      });
      const mime = file.type || (file.name.endsWith('.md') ? 'text/markdown' : file.name.endsWith('.csv') ? 'text/csv' : 'text/plain');
      const resp = await MC().api('/api/chat/upload', { method: 'POST', body: { nome: file.name, mime, data_base64: b64 } });
      CS.anexos.push(resp.anexo); renderAnexos();
      st.textContent = '';
    } catch (e) { st.textContent = '✕ ' + esc(String((e && e.message) || e)); }
  }

  // ---------- voz (Web Speech API — transcrição gratuita no navegador) ----------
  function toggleMic() {
    const btn = $('#cv-mic');
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { $('#cv-status').textContent = t('cv_mic_indisponivel'); return; }
    if (CS.mic) { CS.mic.stop(); return; }
    const rec = new SR();
    rec.lang = MC().S.lang === 'fr' ? 'fr-FR' : 'pt-BR';
    rec.continuous = true; rec.interimResults = true;
    const ta = $('#cv-input');
    const base = ta.value ? ta.value.replace(/\s+$/, '') + ' ' : '';
    rec.onresult = (e) => {
      let fin = '', tmp = '';
      for (let i = 0; i < e.results.length; i++) {
        (e.results[i].isFinal ? (fin += e.results[i][0].transcript) : (tmp += e.results[i][0].transcript));
      }
      ta.value = base + fin + tmp;
      ta.dispatchEvent(new Event('input'));
    };
    rec.onend = () => { CS.mic = null; if (btn) btn.className = 'cv-tool'; $('#cv-status').textContent = ''; };
    rec.onerror = (e) => { $('#cv-status').textContent = '✕ mic: ' + e.error; };
    CS.mic = rec; btn.className = 'cv-tool rec';
    $('#cv-status').textContent = '● ' + t('cv_gravando');
    rec.start();
  }

  // ---------- threads ----------
  async function carregarThreads() {
    try {
      const r = await MC().api('/api/chat/threads');
      const box = $('#cv-threads'); if (!box) return;
      box.innerHTML = '';
      if (!r.threads.length) { box.innerHTML = `<div class="src" style="padding:10px">${t('cv_sem_threads')}</div>`; return; }
      r.threads.forEach((th) => {
        const a = AG(th.agente);
        const d = document.createElement('button');
        d.className = 'cv-th' + (th.id === CS.threadId ? ' sel' : '');
        d.innerHTML = `<span class="hue" style="background:${a.hex}"></span>
          <span class="th-tx"><b>${esc(th.titulo)}</b><i>${esc(th.preview)}</i></span>
          <span class="th-cost">${th.custo_total_e4 && th.custo_total_e4.eur ? eur(th.custo_total_e4.eur) : ''}</span>`;
        d.onclick = () => { location.hash = '#/conversa?id=' + th.id; };
        box.appendChild(d);
      });
    } catch {}
  }
  async function abrirThread(id) {
    try {
      const r = await MC().api('/api/chat/thread?id=' + encodeURIComponent(id));
      const th = r.thread;
      CS.threadId = th.id; CS.agente = th.agente; CS.entregas = []; CS.entregaSel = null;
      localStorage.setItem('mc_cv_agente', CS.agente);
      const list = $('#cv-list'); list.innerHTML = '';
      th.mensagens.forEach((m) => {
        if (m.role === 'user') appendUserMsg(list, m.texto, m.anexos);
        else {
          const d = msgEl('assistant', th.agente);
          const bb = $('.cv-bubble', d);
          if ((m.ferramentas || []).length) {
            const tb = document.createElement('div'); tb.className = 'cv-tools';
            tb.innerHTML = m.ferramentas.map((f) => `<span class="tool-chip ok">🔧 ${esc(f.resumo || f.name)}</span>`).join('');
            bb.appendChild(tb);
          }
          const rr = document.createElement('div'); rr.className = 'cv-rich';
          bb.appendChild(rr);
          renderRich(rr, m.texto);
          if (m.usage) {
            const meta = document.createElement('div'); meta.className = 'cv-meta';
            meta.innerHTML = `${esc(m.modelo || '')} · ${MC().fmt(m.usage.input)}→${MC().fmt(m.usage.output)} tok · ${m.custo_e4 ? eur(m.custo_e4.eur) : ''} <i>est.</i>`;
            d.appendChild(meta);
          }
          list.appendChild(d);
        }
      });
      hydrateAnexoImgs(list);
      atualizaCusto(th.custo_total_e4, th.metodologia_custo);
      marcarAgente();
      renderAtelie();
      scrollBottom();
    } catch {
      // thread não existe mais: volta para conversa nova (nunca deixa um id morto no envio)
      CS.threadId = null;
      history.replaceState(null, '', '#/conversa');
    }
  }

  function marcarAgente() {
    document.querySelectorAll('.cv-ag').forEach((b) => {
      b.className = 'cv-ag' + (b.dataset.id === CS.agente ? ' sel' : '');
    });
    setEstado('idle');
  }

  // ---------- view: Conversa ----------
  function viewConversa(m) {
    CS.entregas = []; CS.entregaSel = null;
    const qid = new URLSearchParams(location.hash.split('?')[1] || '').get('id');
    if (!qid) CS.threadId = null;

    const wrap = document.createElement('div'); wrap.className = 'cv-wrap';
    wrap.innerHTML = `
      <aside class="cv-side">
        <button class="nm-send" id="cv-new" style="width:100%">✍ ${t('cv_nova')}</button>
        <div id="cv-threads" class="cv-threads"></div>
      </aside>
      <section class="cv-main">
        <div class="cv-top">
          <div class="cv-ags">${AGENTES.map((a) =>
            `<button class="cv-ag" data-id="${a.id}" style="--ah:${a.hex}">${a.nome}</button>`).join('')}</div>
          <span style="flex:1"></span>
          <span id="cv-cost" class="cv-cost" style="display:none"></span>
          <span id="cv-state" class="cv-state"></span>
        </div>
        <div id="cv-list" class="cv-list">
          <div id="cv-hero" class="cv-hero">
            <div class="ch-sigil">◈</div>
            <div class="ch-t">${t('cv_hero_t')}</div>
            <div class="ch-s">${t('cv_hero_s')}</div>
          </div>
        </div>
        <div class="cv-composer">
          <div id="cv-anx" class="cv-anxrow"></div>
          <div class="cv-inrow">
            <button class="cv-tool" id="cv-attach" title="${t('cv_anexar')}">📎</button>
            <button class="cv-tool" id="cv-mic" title="${t('cv_ditar')}">🎙</button>
            <textarea id="cv-input" rows="1" placeholder="${t('cv_placeholder')}"></textarea>
            <select id="cv-prio" class="cv-prio" title="${t('cv_prio_tip')}">
              <option value="normal">${t('prio_normal')}</option>
              <option value="alta">${t('prio_alta')} · Fable 5</option>
              <option value="critica">${t('prio_critica')} · Fable 5</option>
            </select>
            <button id="cv-send" class="cv-sendbtn">➤</button>
          </div>
          <div class="cv-hintrow"><span id="cv-status" class="src"></span><span class="src">${t('cv_hint')}</span></div>
          <input type="file" id="cv-file" multiple style="display:none" accept="image/jpeg,image/png,image/webp,image/gif,.pdf,.txt,.md,.csv,.json">
        </div>
      </section>
      <aside id="cv-atelie" class="cv-atelie"></aside>`;
    m.appendChild(wrap);

    // wiring
    wrap.querySelectorAll('.cv-ag').forEach((b) => {
      b.onclick = () => {
        if (CS.sending) return;
        if (CS.threadId && b.dataset.id !== CS.agente) {
          // trocar de especialista abre conversa nova — cada thread tem um dono claro
          CS.threadId = null; $('#cv-list').innerHTML = '';
          history.replaceState(null, '', '#/conversa');
        }
        CS.agente = b.dataset.id; localStorage.setItem('mc_cv_agente', CS.agente);
        marcarAgente();
      };
    });
    $('#cv-new', wrap).onclick = () => { location.hash = '#/conversa'; CS.threadId = null; };
    $('#cv-send', wrap).onclick = enviar;
    const ta = $('#cv-input', wrap);
    ta.addEventListener('input', () => { ta.style.height = 'auto'; ta.style.height = Math.min(200, ta.scrollHeight) + 'px'; });
    ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar(); } });
    ta.addEventListener('paste', (e) => {
      const items = [...(e.clipboardData || {}).items || []].filter((i) => i.kind === 'file');
      if (items.length) { e.preventDefault(); items.forEach((i) => { const f = i.getAsFile(); if (f) subirArquivo(f); }); }
    });
    $('#cv-attach', wrap).onclick = () => $('#cv-file', wrap).click();
    $('#cv-file', wrap).addEventListener('change', (e) => { [...e.target.files].forEach(subirArquivo); e.target.value = ''; });
    $('#cv-mic', wrap).onclick = toggleMic;
    $('#cv-prio', wrap).onchange = (e) => { CS.prioridade = e.target.value; };
    $('#cv-prio', wrap).value = CS.prioridade;
    // arrastar-e-soltar
    const listEl = $('#cv-list', wrap);
    ['dragover', 'drop'].forEach((ev) => wrap.addEventListener(ev, (e) => { e.preventDefault(); }));
    wrap.addEventListener('drop', (e) => { [...(e.dataTransfer || {}).files || []].forEach(subirArquivo); });

    marcarAgente();
    renderAtelie();
    carregarThreads();
    if (qid) { CS.threadId = qid; abrirThread(qid); }
    setTimeout(() => ta.focus(), 150);
  }

  // ---------- view: Aprovações ----------
  const TIPO_LBL = { reembolso: 'apr_t_reembolso', ddl: 'apr_t_ddl', published: 'apr_t_published', envio_externo: 'apr_t_envio', compensacao: 'apr_t_comp', novo_fluxo: 'apr_t_fluxo', orcamento: 'apr_t_orc', outro: 'apr_t_outro' };
  async function decidir(a, decisao) {
    let motivo; let confirmacao_destrutiva;
    if (decisao === 'negar') {
      motivo = prompt(t('apr_motivo_prompt'));
      if (motivo === null) return;
      if (motivo.trim().length < 5) { alert(t('apr_motivo_curto')); return; }
    } else if (a.dbop) {
      // correção no banco: confirmação diferente para destrutivo
      if (a.dbop.tipo === 'destrutivo') {
        const typed = prompt(t('apr_db_destrutivo_prompt'));
        if (typed === null) return;
        if (typed.trim().toUpperCase() !== 'CONFIRMAR') { alert(t('apr_db_destrutivo_falta')); return; }
        confirmacao_destrutiva = 'CONFIRMAR';
      } else if (!confirm(t('apr_db_confirmar'))) return;
    } else if (!confirm(a.email ? t('apr_confirmar_envio').replace('{para}', a.email.para) : t('apr_confirmar'))) return;
    try {
      await MC().api('/api/approvals/decide', { method: 'POST', body: { id: a.id, decisao, motivo, confirmacao_destrutiva } });
      MC().refresh(true);
      if (location.hash.startsWith('#/aprovacoes')) window.V4.viewAprovacoes(document.querySelector('#view'), true);
    } catch (e) { alert('✕ ' + String((e && e.message) || e)); }
  }
  function verEmail(a) {
    const w = window.open('', '_blank');
    if (!w) return alert(t('atelie_popup'));
    w.document.write(a.email.corpo_html);
    w.document.close();
  }
  async function viewAprovacoes(m, replace) {
    if (replace) m.innerHTML = '';
    const head = document.createElement('div'); head.className = 'view-head';
    head.innerHTML = `<h2>⛔ ${t('apr_title')}</h2><span class="sub">${t('apr_sub')}</span>`;
    m.appendChild(head);
    let items = [];
    try { items = (await MC().api('/api/approvals')).aprovacoes; } catch {}
    const pend = items.filter((a) => a.status === 'pendente').sort((x, y) => String(y.criado_em).localeCompare(String(x.criado_em)));
    const hist = items.filter((a) => a.status !== 'pendente').sort((x, y) => String(y.decidido_em || '').localeCompare(String(x.decidido_em || ''))).slice(0, 15);
    if (!pend.length) {
      const ok = document.createElement('section'); ok.className = 'panel act-empty';
      ok.innerHTML = `<div class="ok-mark">✓</div><b>${t('apr_vazio_t')}</b><p>${t('apr_vazio')}</p>`;
      m.appendChild(ok);
    }
    pend.forEach((a) => {
      const ag = AG(a.agente === 'orquestrador' ? 'orquestrador' : a.agente);
      const c = document.createElement('section'); c.className = 'panel apr-card';
      c.innerHTML = `
        <div class="act-head">
          <span class="act-agent" style="color:${ag.hex}"><span class="hue" style="background:${ag.hex}"></span>${ag.nome}</span>
          <span class="sev-badge sev-alta">${t(TIPO_LBL[a.tipo] || 'apr_t_outro')}</span>
          <span class="act-meta">${new Date(a.criado_em).toLocaleString(MC().S.lang === 'fr' ? 'fr-FR' : 'pt-BR')} · <a href="#/conversa?id=${esc(a.thread_id)}">${esc(a.thread_id)}</a></span>
        </div>
        <h4 class="act-title">${esc(a.titulo)}</h4>
        <p class="act-det">${esc(a.justificativa)}</p>
        ${a.email ? `<div class="apr-mail">✉ <b>${esc(a.email.para)}</b> — ${esc(a.email.assunto)} <button class="ent-b" data-a="ver">${t('apr_ver_email')}</button></div>` : ''}
        ${a.email_invalido ? `<div class="cv-err">✕ ${esc(a.email_invalido)}</div>` : ''}
        ${a.dbop ? `<div class="apr-db ${a.dbop.tipo === 'destrutivo' ? 'destr' : ''}">
          <div class="apr-db-h">🗄 ${t('apr_db_correcao')} ${a.dbop.tipo === 'destrutivo' ? `<span class="sev-badge sev-critica">${t('apr_db_destrutivo')}</span>` : `<span class="st-badge st-concluida">${t('apr_db_dados')}</span>`}</div>
          <pre class="code-block">${esc(a.dbop.sql)}</pre>
          ${a.dbop.erro_classificacao ? `<div class="cv-err">✕ ${esc(a.dbop.erro_classificacao)}</div>` : ''}
        </div>` : ''}
        <div class="act-btns">
          <button class="act-btn ok">${a.email ? '➤ ' + t('apr_aprovar_enviar') : a.dbop ? '🗄 ' + t('apr_aprovar_corrigir') : '✓ ' + t('apr_aprovar')}</button>
          <button class="act-btn bad">✕ ${t('apr_negar')}</button>
        </div>`;
      const [bo, bn] = c.querySelectorAll('.act-btn');
      bo.onclick = () => decidir(a, 'aprovar');
      bn.onclick = () => decidir(a, 'negar');
      const bv = c.querySelector('[data-a="ver"]');
      if (bv) bv.onclick = () => verEmail(a);
      m.appendChild(c);
    });
    if (hist.length) {
      const rows = document.createElement('div'); rows.className = 'rows';
      hist.forEach((a) => {
        const ag = AG(a.agente);
        const r = document.createElement('div'); r.className = 'row';
        r.innerHTML = `<span class="id" style="color:${ag.hex}">${ag.nome}</span>
          <span>${esc(a.titulo)}${a.envio ? `<div class="src">${a.envio.ok ? '✓ ' + t('apr_enviado') + ' · ' + esc(a.envio.provedor || '') : '✕ ' + esc(a.envio.detalhe || '')} · ${esc((a.email && a.email.para) || '')}</div>` : ''}${a.execucao_db ? `<div class="src">${a.execucao_db.ok ? '✓ ' + t('apr_db_aplicado') + ' · ' + esc(a.execucao_db.detalhe || '') + (a.execucao_db.tem_backup ? ' · ' + t('apr_db_backup') : '') : '✕ ' + esc(a.execucao_db.detalhe || '')}</div>` : ''}${a.motivo ? `<div class="src">${t('apr_motivo')}: ${esc(a.motivo)}</div>` : ''}${a.handoff_id ? `<div class="src">handoff: ${esc(a.handoff_id)}</div>` : ''}</span>
          <span class="st-badge ${a.status === 'aprovada' ? 'st-concluida' : 'st-erro'}">${t('apr_st_' + a.status)}</span>`;
        rows.appendChild(r);
      });
      const p = document.createElement('section'); p.className = 'panel';
      const h = document.createElement('h3'); h.textContent = t('apr_hist'); p.appendChild(h); p.appendChild(rows);
      m.appendChild(p);
    }
  }

  window.V4 = { viewConversa, viewAprovacoes };
})();
