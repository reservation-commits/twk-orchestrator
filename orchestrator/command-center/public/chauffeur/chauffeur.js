/* Pedidos de corrida do Wanted Chauffeur — front (sem framework). Lê /api/chauffeur/leads e /api/chauffeur/links; marca resultados por código. */
(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const S = { token: localStorage.getItem('mc_key') || '', snap: null, links: null, periodo: 30, carregando: false };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const n = (v) => Number(v || 0).toLocaleString('pt-BR');
  const pct = (a, b) => (b ? Math.round((100 * a) / b) : 0);
  const headers = () => (S.token ? { 'x-center-key': S.token } : {});
  const dataBr = (iso) => (iso ? new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'Europe/Paris' }) : '—');
  const quandoBr = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' }) : '—');
  const RES = { pedido: 'pedido', orcado: 'orçado', confirmado: 'confirmado', feito: 'feito', perdido: 'perdido', cancelado: 'cancelado' };
  const eur = (cent) => (Math.round(Number(cent || 0) / 100)).toLocaleString('pt-BR') + ' €';

  function barras(obj, total) {
    const ent = Object.entries(obj).sort((a, b) => b[1] - a[1]);
    if (!ent.length) return '<p class="vazio">Nenhum pedido no período.</p>';
    return `<div class="barras">${ent.map(([k, v]) => `<div class="barra ok"><span class="t" title="${esc(k)}">${esc(k)}</span><span class="b"><i style="width:${pct(v, total)}%"></i></span><span class="n">${n(v)} · ${pct(v, total)}%</span></div>`).join('')}</div>`;
  }
  function serieDias(por_dia) {
    if (!por_dia.length) return '';
    const W = 720, H = 120, p = { l: 28, r: 8, t: 10, b: 22 }; const max = Math.max(1, ...por_dia.map((d) => d.n)); const bw = (W - p.l - p.r) / por_dia.length;
    const y = (v) => p.t + (H - p.t - p.b) * (1 - v / max);
    let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="pedidos por dia">`;
    for (const g of [0, 0.5, 1]) { const yy = p.t + (H - p.t - p.b) * (1 - g); s += `<line x1="${p.l}" x2="${W - p.r}" y1="${yy}" y2="${yy}" stroke="var(--grid)"/><text x="0" y="${yy + 4}">${Math.round(max * g)}</text>`; }
    por_dia.forEach((d, i) => { const x = p.l + i * bw + 3; const w = Math.max(2, bw - 6); s += `<rect x="${x}" y="${y(d.n)}" width="${w}" height="${y(0) - y(d.n)}" fill="var(--gold)" rx="1"><title>${d.dia}: ${d.n}</title></rect>`; if (i % 2 === 0 || por_dia.length <= 7) s += `<text x="${x + w / 2}" y="${H - 6}" text-anchor="middle">${d.dia.slice(8)}/${d.dia.slice(5, 7)}</text>`; });
    return s + '</svg>';
  }

  function pulso(s) {
    $('#pulso-lede').textContent = `${n(s.total)} pedido(s) em ${s.dias} dias · ${n(s.total_historico)} desde o início · lido em ${quandoBr(s.gerado_em)} (hora de Paris)`;
    const r = s.por_resultado || {};
    const cls = s.total === 0 ? 'bad' : s.taxa_conversao_pct >= 30 ? 'good' : 'warn';
    $('#pulso-body').className = '';
    $('#pulso-body').innerHTML = `
      <div class="kpis">
        <div class="kpi"><div class="v">${n(s.total)}</div><div class="l">pedidos</div><div class="s">reservas gravadas pela página /ride</div></div>
        <div class="kpi ${cls}"><div class="v">${n(s.viraram_corrida)}</div><div class="l">viraram corrida</div><div class="s">confirmados ou feitos · ${s.taxa_conversao_pct}% dos pedidos · ${eur(s.valor_confirmado_cent)}</div></div>
        <div class="kpi"><div class="v">${n(r.pedido)}</div><div class="l">sem resultado marcado</div><div class="s">${n(r.orcado)} orçados · ${n(r.perdido)} perdidos · ${n(r.cancelado)} cancelados</div></div>
        <div class="kpi"><div class="v">${Object.keys(s.por_origem).length}</div><div class="l">redes trazendo pedido</div><div class="s">${Object.entries(s.por_origem).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k, v]) => `${esc(k)} ${n(v)}`).join(' · ') || '—'}</div></div>
      </div>
      ${serieDias(s.por_dia)}
      ${(s.lacunas || []).map((l) => `<p class="nota">${esc(l)}</p>`).join('')}`;
  }
  function origem(s) { $('#origem-body').className = ''; $('#origem-body').innerHTML = barras(s.por_origem, s.total); }
  function produto(s) { $('#produto-body').className = ''; $('#produto-body').innerHTML = barras(s.por_produto, s.total); }
  function pedidos(s) {
    $('#pedidos-body').className = '';
    if (!s.pedidos.length) { $('#pedidos-body').innerHTML = '<p class="vazio">Nenhum pedido no período.</p>'; return; }
    const sel = (p) => `<select data-codigo="${esc(p.codigo)}" aria-label="resultado de ${esc(p.codigo)}">${Object.entries(RES).filter(([k]) => k !== 'pedido' || p.status === 'pedido').map(([k, v]) => `<option value="${k}" ${p.status === k ? 'selected' : ''}>${v}</option>`).join('')}</select>`;
    const PILLS = [['nova_reserva', 'ok', 'J', 'Julien avisado pela Aria'], ['nova_reserva_falhou', 'bad', 'J', 'aviso ao Julien falhou'], ['confirmacao_cliente', 'ok', 'C', 'cliente recebeu a confirmação no WhatsApp'], ['confirmacao_cliente_falhou', 'bad', 'C', 'confirmação ao cliente recusada pela Meta'], ['lembrete_vespera', 'ok', 'V', 'lembrete da véspera enviado'], ['lembrete_2h', 'ok', '2h', 'lembrete de 2 h enviado'], ['sem_canal', 'bad', '—', 'mensagens ao cliente desligadas (sem canal da Meta)'], ['nao_contatar', 'bad', '⊘', 'cliente pediu para não ser contatado'], ['sem_whatsapp', 'bad', '?', 'reserva sem WhatsApp']];
    const aviso = (p) => PILLS.filter(([k]) => (p.avisos || []).includes(k)).map(([, cls, txt, tit]) => `<span class="pill ${cls}" title="${esc(tit)}">${esc(txt)}</span>`).join('');
    const pessoa = (p) => p.anonimizado_em ? '<i>apagado</i>' : `${esc(p.nome || '—')}${p.whatsapp_mascarado ? `<br><small>${esc(p.whatsapp_mascarado)}</small>` : ''}`;
    const trajeto = (p) => p.partida ? `${esc(p.partida)}${p.destino ? ` → ${esc(p.destino)}` : ''}${p.recado ? `<br><small title="${esc(p.recado)}">“${esc(p.recado.slice(0, 60))}${p.recado.length > 60 ? '…' : ''}”</small>` : ''}` : '—';
    $('#pedidos-body').innerHTML = `<div class="scroll"><table class="ped"><thead><tr><th>Código</th><th>Origem</th><th>Produto</th><th>Para quando</th><th>Quem embarca</th><th>Trajeto</th><th>Valor</th><th>Chegou</th><th>Resultado</th></tr></thead><tbody>
      ${s.pedidos.map((p) => `<tr><td class="cod">${esc(p.codigo)} ${aviso(p)}</td><td>${esc(p.origem_nome)}</td><td>${esc(p.produto_nome)}${p.horas ? ` · ${p.horas} h` : ''}${p.pessoas ? ` · ${p.pessoas} pess.` : ''}${p.imagens === 'ok' ? ' · 📷' : ''}</td><td>${p.data ? dataBr(p.data + 'T12:00:00') : '—'}${p.hora ? ` · ${esc(p.hora)}` : ''}</td><td>${pessoa(p)}</td><td>${trajeto(p)}</td><td>${eur(p.valor_cent)}${p.produto === 'soiree' ? ' + dîner' : ''}</td><td>${quandoBr(p.criado_em)}</td><td class="res-${esc(p.status)}">${sel(p)}</td></tr>`).join('')}
    </tbody></table></div>`;
    document.querySelectorAll('#pedidos-body select').forEach((el) => el.addEventListener('change', async () => {
      const codigo = el.dataset.codigo, resultado = el.value;
      if (resultado === 'pedido') return;
      el.disabled = true;
      try {
        const r = await fetch('/api/chauffeur/lead/resultado', { method: 'POST', headers: { 'content-type': 'application/json', ...headers() }, body: JSON.stringify({ codigo, resultado }) });
        if (!r.ok) { const j = await r.json().catch(() => ({})); alert(`Não marcou: ${j.erro || r.status}`); }
        await carregar(true);
      } finally { el.disabled = false; }
    }));
  }
  function links() {
    $('#links-body').className = '';
    if (!S.links) { $('#links-body').innerHTML = '<p class="vazio">Sem links.</p>'; return; }
    $('#links-body').innerHTML = S.links.links.map((l) => `<div class="linkrow"><span class="pill">${esc(l.origem)} · ${esc(l.rede)}</span><code>${esc(l.url)}</code><button class="chip" data-copy="${esc(l.url)}">Copiar</button><span class="uso">${esc(l.uso)}</span></div>`).join('') +
      `<p class="nota">A página é ${esc(S.links.pagina)}. Trocar o endereço: variável CHAUFFEUR_PAGINA na Central.</p>`;
    document.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', async () => { try { await navigator.clipboard.writeText(b.dataset.copy); b.textContent = 'Copiado'; setTimeout(() => { b.textContent = 'Copiar'; }, 1500); } catch { prompt('Copie o link:', b.dataset.copy); } }));
  }
  function render(s) {
    $('#live').dataset.s = 'ok'; $('#live-t').textContent = 'ao vivo';
    pulso(s); origem(s); produto(s); pedidos(s); links();
    $('#rodape').textContent = s.modo === 'banco'
      ? 'Reservas nas tabelas chauffeur_reservas do banco da plataforma. Status marcado à mão, pelo código; ✓ = Julien avisado pela Aria.'
      : 'Reservas no volume da Central (agents/wanted-chauffeur/reservas.jsonl) até a DDL chauffeur-reservas.sql rodar com a frase do fundador. Status marcado à mão, pelo código; ✓ = Julien avisado pela Aria.';
  }

  async function carregar(fresco) {
    if (S.carregando) return; S.carregando = true;
    try {
      const r = await fetch(`/api/chauffeur/leads?dias=${S.periodo}`, { headers: headers() });
      if (r.status === 401) return gate(true);
      S.snap = await r.json();
      if (!S.links || fresco) { const l = await fetch('/api/chauffeur/links', { headers: headers() }); if (l.ok) S.links = await l.json(); }
      gate(false); render(S.snap);
    } catch (e) { $('#live').dataset.s = 'erro'; $('#live-t').textContent = 'falha: ' + e.message; }
    finally { S.carregando = false; }
  }
  function gate(on) { $('#gate').hidden = !on; $('#app').style.visibility = on ? 'hidden' : 'visible'; }
  function tema(t) { document.documentElement.dataset.theme = t; $('#tema').textContent = t === 'dark' ? 'Tema claro' : 'Tema escuro'; localStorage.setItem('pn_tema', t); }

  tema(localStorage.getItem('pn_tema') || 'dark');
  $('#tema').addEventListener('click', () => tema(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));
  $('#atualizar').addEventListener('click', () => carregar(true));
  $('#periodo').addEventListener('click', () => { S.periodo = S.periodo === 30 ? 7 : 30; $('#periodo').textContent = `${S.periodo} dias`; carregar(true); });
  $('#menu').addEventListener('click', () => { document.body.dataset.menu = document.body.dataset.menu === '1' ? '0' : '1'; });
  $('#gate form').addEventListener('submit', (e) => { e.preventDefault(); S.token = $('#gate input').value.trim(); localStorage.setItem('mc_key', S.token); gate(false); carregar(true); });
  document.querySelectorAll('#nav a').forEach((a) => a.addEventListener('click', () => { document.querySelectorAll('#nav a').forEach((x) => x.classList.toggle('on', x === a)); document.body.dataset.menu = '0'; }));
  const obs = new IntersectionObserver((es) => { for (const x of es) if (x.isIntersecting) { $('#crumb').textContent = x.target.querySelector('h1').textContent; document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('on', a.getAttribute('href') === '#' + x.target.id)); } }, { rootMargin: '-40% 0px -55% 0px' });
  document.querySelectorAll('.sec').forEach((s) => obs.observe(s));
  carregar(false);
  setInterval(() => { if (!document.hidden) carregar(false); }, 60_000);
})();
