/* Sala do WhatsApp — front (sem framework). Lê /api/whatsapp a cada 30 s e /api/whatsapp/conversa ao abrir uma conversa. */
(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const S = { token: localStorage.getItem('mc_key') || '', snap: null, periodo: 30, canal: 'whatsapp', aberta: null, vistas: new Map(), timer: null, carregando: false };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const n = (v) => Number(v || 0).toLocaleString('pt-BR');
  const pct = (a, b) => (b ? Math.round((100 * a) / b) : 0);
  const quando = (iso) => {
    if (!iso) return '—';
    const d = new Date(iso); const diff = (Date.now() - d.getTime()) / 1000;
    if (diff < 60) return 'agora';
    if (diff < 3600) return `${Math.round(diff / 60)} min`;
    if (diff < 86400) return `${Math.round(diff / 3600)} h`;
    if (diff < 7 * 86400) return `${Math.round(diff / 86400)} d`;
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
  };
  const hora = (iso) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });
  const diaLongo = (iso) => new Date(iso).toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Paris' });
  const headers = () => (S.token ? { 'x-center-key': S.token } : {});

  // ── gráficos SVG ──
  function barrasDuplas(serie, chaves, cores) {
    const W = 720, H = 150, p = { l: 28, r: 8, t: 10, b: 22 };
    const max = Math.max(1, ...serie.flatMap((d) => chaves.map((k) => d[k])));
    const bw = (W - p.l - p.r) / serie.length;
    const y = (v) => p.t + (H - p.t - p.b) * (1 - v / max);
    let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="série diária">`;
    for (const g of [0, 0.5, 1]) { const yy = p.t + (H - p.t - p.b) * (1 - g); s += `<line x1="${p.l}" x2="${W - p.r}" y1="${yy}" y2="${yy}" stroke="var(--grid)"/><text x="0" y="${yy + 4}">${Math.round(max * g)}</text>`; }
    serie.forEach((d, i) => {
      const x0 = p.l + i * bw;
      chaves.forEach((k, j) => { const w = Math.max(2, (bw - 6) / chaves.length); const x = x0 + 3 + j * w; const h = y(0) - y(d[k]); s += `<rect x="${x}" y="${y(d[k])}" width="${w - 1}" height="${h}" fill="${cores[j]}" rx="1"><title>${d.dia}: ${k} ${d[k]}</title></rect>`; });
      if (i % 2 === 0 || serie.length <= 7) s += `<text x="${x0 + bw / 2}" y="${H - 6}" text-anchor="middle">${d.dia.slice(8)}/${d.dia.slice(5, 7)}</text>`;
    });
    return s + '</svg>';
  }
  function sparkline(vals, cor) {
    const W = 90, H = 28; const max = Math.max(1, ...vals); const step = W / Math.max(1, vals.length - 1);
    const pts = vals.map((v, i) => `${(i * step).toFixed(1)},${(H - 2 - (H - 4) * (v / max)).toFixed(1)}`).join(' ');
    return `<svg class="spark" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><polyline points="${pts}" fill="none" stroke="${cor}" stroke-width="1.5"/></svg>`;
  }
  function barra(rotulo, v, total, ok, extra = '') {
    return `<div class="barra ${ok ? 'ok' : ''}"><span class="t" title="${esc(rotulo)}">${esc(rotulo)}</span><span class="b"><i style="width:${pct(v, total)}%"></i></span><span class="n">${n(v)} · ${pct(v, total)}%</span></div>${extra}`;
  }
  const pill = (t, cls = '') => `<span class="pill ${cls}">${esc(t)}</span>`;

  // ── seções ──
  function pulso(s) {
    const a = s.aria || {}; const u = (s.pulso && s.pulso.ultimo) || {}; const h24 = (s.pulso && s.pulso.ultimas24h) || {};
    const k = S.periodo === 7 ? s.kpis.d7 : s.kpis.d30;
    const lt = s.linha_do_tempo || [];
    $('#pulso-lede').textContent = a.ok ? `Aria ${a.build} no ar há ${Math.round((a.uptimeSeconds || 0) / 3600)} h · ${h24.checks || 0} verificações nas últimas 24 h, ${h24.falhas || 0} falha(s) · banco ${h24.db_ms || '—'} ms · Meta ${h24.wa_ms || '—'} ms` : `A Aria não respondeu ao /health (${a.erro || a.http || '?'}).`;
    const etapas = Object.entries(a.etapas || {}).map(([k2, v]) => `<span class="${v ? 'on' : ''}">${k2}</span>`).join('');
    $('#pulso-body').className = '';
    $('#pulso-body').innerHTML = `
      <div class="kpis">
        <div class="kpi"><div class="v">${n(k.recebidas)}</div><div class="l">mensagens recebidas</div><div class="s">${S.periodo} dias · ${n(k.conversas)} conversas (${n(k.conversas_wa)} no WhatsApp)</div>${sparkline(lt.map((d) => d.recebidas), 'var(--s1)')}</div>
        <div class="kpi"><div class="v">${n(k.respondidas)}</div><div class="l">respostas da Aria</div><div class="s">resposta mediana ${s.kpis.resposta ? s.kpis.resposta.mediana : '—'} · p90 ${s.kpis.resposta ? s.kpis.resposta.p90 : '—'}</div>${sparkline(lt.map((d) => d.respondidas), 'var(--wa)')}</div>
        <div class="kpi ${s.funil.pct_enviados < 20 ? 'bad' : s.funil.pct_enviados < 50 ? 'warn' : 'good'}"><div class="v">${s.funil.pct_enviados}%</div><div class="l">saídas que viraram mensagem</div><div class="s">${n(s.funil.enviados)} de ${n(s.funil.total)} tentativas em 30 d</div>${sparkline(lt.map((d) => d.enviados), 'var(--gold)')}</div>
        <div class="kpi ${(s.clientes.resumo.ativos || 0) > 0 ? 'good' : 'bad'}"><div class="v">${n(s.clientes.resumo.ativos)}</div><div class="l">clientes com opt-in</div><div class="s">${n(s.clientes.resumo.novos_7d)} novos em 7 d · ${n(s.casas.filter((c) => c.estado === 'ativa').length)} casas ativas, ${n(s.casas.filter((c) => c.estado === 'indisponivel').length)} indisponíveis</div></div>
        <div class="kpi ${s.escalacoes.abertas.length ? 'warn' : 'good'}"><div class="v">${n(s.escalacoes.abertas.length)}</div><div class="l">escalações abertas</div><div class="s">${n(s.pendencias.vivas)} pedidos vivos, ${n(s.pendencias.proximas_48h)} nas próximas 48 h</div></div>
      </div>
      <div class="caixa"><h3>Últimos 14 dias <small>recebidas · respostas · saídas proativas</small></h3>${barrasDuplas(lt, ['recebidas', 'respondidas', 'enviados'], ['var(--s1)', 'var(--wa)', 'var(--gold)'])}
        <div class="legend"><span><i style="background:var(--s1)"></i>recebidas</span><span><i style="background:var(--wa)"></i>respostas da Aria</span><span><i style="background:var(--gold)"></i>proativas enviadas (lembretes, pendências, casas)</span></div></div>
      <div class="caixa"><h3>Etapas ligadas no container <small>${Object.values(a.etapas || {}).filter(Boolean).length} de ${Object.keys(a.etapas || {}).length}</small></h3><div class="etapas">${etapas || '<span>sem leitura</span>'}</div>
        ${a.notificacoes ? `<p class="micro" style="margin:10px 0 0">Idiomas: ${a.notificacoes.idiomas.join(', ')} · teto diário ${a.notificacoes.tetoDiario} · ${Object.values(a.notificacoes.templates).filter(Boolean).length} modelos configurados</p>` : ''}
      </div>`;
  }

  function conversas(s) {
    const lista = s.conversas.filter((c) => S.canal === 'todas' || c.canal === 'whatsapp');
    const el = $('#conv-lista'); el.className = 'conv-lista';
    if (!lista.length) { el.innerHTML = '<div class="vazio">Nenhuma conversa no período.</div>'; return; }
    el.innerHTML = lista.map((c) => {
      const nova = S.vistas.has(c.id) && S.vistas.get(c.id) !== c.ultima_em; S.vistas.set(c.id, c.ultima_em);
      const ini = (c.nome || c.rotulo).replace(/[^A-Za-zÀ-ÿ0-9]/g, '').slice(0, 1).toUpperCase() || '•';
      return `<div class="conv ${c.canal} ${S.aberta === c.id ? 'on' : ''} ${nova ? 'nova' : ''}" data-id="${esc(c.id)}">
        <div class="av">${esc(ini)}</div>
        <div><div class="q">${esc(c.nome || '')}<span class="id">${esc(c.rotulo)}</span>${c.escalada ? pill('escalada', 'warn') : ''}${c.silenciada ? pill('humano', 'gold') : ''}${c.optin ? pill('opt-in', 'ok') : ''}${c.nota !== null ? pill(`juiz ${c.nota}/6`, c.nota >= 5 ? 'ok' : 'bad') : ''}</div>
          <div class="tr">${c.direcao === 'outbound' ? '<b>Aria:</b> ' : ''}${esc(c.trecho)}</div></div>
        <div class="meta"><span>${quando(c.ultima_em)}</span><span>${c.mensagens} msg</span><span>${c.canal === 'email' ? '✉' : '◉'}</span></div></div>`;
    }).join('');
    el.querySelectorAll('.conv').forEach((d) => d.addEventListener('click', () => abrir(d.dataset.id)));
  }

  async function abrir(id) {
    S.aberta = id;
    document.querySelectorAll('.conv').forEach((d) => d.classList.toggle('on', d.dataset.id === id));
    const th = $('#conv-thread'); th.innerHTML = '<div class="vazio">Abrindo a conversa…</div>';
    try {
      const r = await fetch(`/api/whatsapp/conversa?id=${encodeURIComponent(id)}`, { headers: headers() });
      if (r.status === 401) return gate(true);
      const c = await r.json();
      if (c.error) throw new Error(c.error);
      let ultimoDia = ''; const corpo = [];
      for (const m of c.mensagens) {
        const d = new Date(m.em).toDateString();
        if (d !== ultimoDia) { ultimoDia = d; corpo.push(`<div class="dia-sep">${diaLongo(m.em)}</div>`); }
        corpo.push(`<div class="msg ${m.direcao === 'inbound' ? 'in' : 'out'}">${m.midia ? `<span class="mid">[${esc(m.midia)}] </span>` : ''}${esc(m.texto)}<time>${hora(m.em)} · ${m.direcao === 'inbound' ? (c.nome || 'cliente') : 'Aria'}</time></div>`);
      }
      const cons = c.consentimento;
      th.innerHTML = `
        <div class="th-head"><div class="who">${esc(c.nome || (c.canal === 'email' ? 'E-mail' : 'WhatsApp'))}<small>${esc(c.rotulo)} · ${c.mensagens.length} mensagens</small></div>
          <div class="tags">${c.silenciada ? pill('humano assumiu' + (c.silenciada.ate ? ' até ' + new Date(c.silenciada.ate).toLocaleDateString('pt-BR') : ''), 'gold') : ''}${cons ? pill(cons.opt_out ? 'pediu para parar' : cons.whatsapp_reservas ? 'opt-in de reservas' : 'sem opt-in', cons.opt_out ? 'bad' : cons.whatsapp_reservas ? 'ok' : 'mute') : ''}${c.escalacoes.filter((e) => e.status === 'open').map((e) => pill(`${e.tag} · ${e.dono}`, 'warn')).join('')}</div></div>
        <div class="th-body" id="th-body">${corpo.join('') || '<div class="vazio">Sem mensagens.</div>'}</div>
        <div class="th-foot">
          ${c.notas.length ? `<details open><summary>Juiz de Conversa · ${c.notas.length} nota(s)</summary><ul>${c.notas.map((x) => `<li><b style="color:${x.nota >= 5 ? 'var(--wa)' : 'var(--serious)'}">${x.nota}/6</b> · ${esc(x.motivo)} <span class="micro">(${quando(x.judged_at)})</span></li>`).join('')}</ul></details>` : ''}
          ${c.retidas.length ? `<details><summary>Respostas retidas pela porta de saída · ${c.retidas.length}</summary><ul>${c.retidas.map((x) => `<li>${esc(x.motivo)} <span class="micro">(${quando(x.created_at)})</span><br><span class="micro">${esc(x.trecho)}</span></li>`).join('')}</ul></details>` : ''}
          ${c.ferramentas.length ? `<details><summary>Ferramentas usadas · ${c.ferramentas.length}</summary><ul>${c.ferramentas.map((x) => `<li>${x.success ? '✓' : '✗'} ${esc(x.tool_name)} · ${x.latency_ms} ms${x.erro ? ' · ' + esc(x.erro) : ''}</li>`).join('')}</ul></details>` : ''}
          ${c.escalacoes.length ? `<details><summary>Escalações · ${c.escalacoes.length}</summary><ul>${c.escalacoes.map((x) => `<li>${esc(x.tag)} · ${esc(x.status)} · ${esc(x.dono)} · ${esc(x.resumo)}</li>`).join('')}</ul></details>` : ''}
        </div>`;
      const b = $('#th-body'); b.scrollTop = b.scrollHeight;
    } catch (e) { th.innerHTML = `<div class="vazio erro">Não consegui abrir: ${esc(e.message)}</div>`; }
  }

  function funil(s) {
    const f = s.funil;
    $('#funil-body').className = '';
    $('#funil-body').innerHTML = `
      <div class="g2">
        <div class="caixa"><h3>Por desfecho <small>30 dias · ${n(f.total)} tentativas</small></h3><div class="barras">${f.desfechos.map((d) => barra(d.desfecho.replace(/_/g, ' '), d.n, f.total, d.desfecho === 'enviado', d.motivos.length && d.desfecho !== 'enviado' ? `<div class="motivos">${d.motivos.map((m) => `${esc(m.motivo)} (${n(m.n)})`).join(' · ')}</div>` : '')).join('')}</div></div>
        <div class="caixa"><h3>Por momento <small>quantas de cada tipo saíram</small></h3><div class="barras">${f.eventos.slice(0, 14).map((e) => barra(e.evento.replace(/_/g, ' ').replace(':estabelecimento', ' → casa'), e.enviados, e.total, e.pct >= 50, `<div class="motivos">${n(e.enviados)} enviadas de ${n(e.total)}</div>`)).join('')}</div></div>
      </div>`;
  }

  function entregas(s) {
    const e = s.entregas;
    $('#entregas-body').className = '';
    $('#entregas-body').innerHTML = `
      <div class="caixa"><h3>Por modelo <small>30 dias</small></h3>
        <table class="t"><thead><tr><th>Modelo</th><th class="num">enviadas</th><th class="num">entregues</th><th class="num">lidas</th><th class="num">falharam</th><th class="num">leitura</th></tr></thead>
        <tbody>${e.por_template.map((t) => `<tr><td>${esc(t.template)}</td><td class="num">${n(t.total)}</td><td class="num">${n(t.delivered)}</td><td class="num">${n(t.read)}</td><td class="num">${t.failed ? `<span class="pill bad">${n(t.failed)}</span>` : '0'}</td><td class="num">${t.pct_lidas}%</td></tr>`).join('') || '<tr><td colspan="6" class="vazio-sec">Nenhuma entrega rastreada em 30 dias.</td></tr>'}</tbody></table></div>
      <div class="caixa"><h3>Últimas 20 <small>o que a Meta devolveu</small></h3>
        <table class="t"><thead><tr><th>quando</th><th>modelo</th><th>para</th><th>idioma</th><th>reserva</th><th>estado</th></tr></thead>
        <tbody>${e.ultimas.map((x) => `<tr><td>${quando(x.sent_at)}</td><td>${esc(x.template)}</td><td>${esc(x.destinatario)}</td><td>${esc(x.locale)}</td><td>${esc(x.reservation_code || '—')}</td><td>${pill(x.status + (x.error_title ? ' · ' + x.error_title : ''), x.status === 'read' ? 'ok' : x.status === 'failed' ? 'bad' : x.status === 'delivered' ? 'ok' : 'warn')}</td></tr>`).join('')}</tbody></table></div>`;
  }

  function casas(s) {
    $('#casas-body').className = '';
    $('#casas-body').innerHTML = `<div class="caixa"><table class="t"><thead><tr><th>Casa</th><th>cidade</th><th>estado do número</th><th class="num">pedidos 30 d</th><th class="num">aceites</th><th class="num">avisos enviados</th><th>última entrega</th><th>idioma</th></tr></thead>
      <tbody>${s.casas.map((c) => `<tr><td>${esc(c.name)}</td><td>${esc(c.city)} ${c.pais ? `<span class="micro">${esc(c.pais)}</span>` : ''}</td><td>${pill(c.estado === 'ativa' ? 'ativa' : c.estado === 'indisponivel' ? 'sem WhatsApp (Meta)' : 'desligada', c.estado === 'ativa' ? 'ok' : c.estado === 'indisponivel' ? 'bad' : 'mute')}${c.indisponivel_motivo ? `<div class="micro">${esc(c.indisponivel_motivo)}</div>` : ''}</td><td class="num">${n(c.pedidos_30d)}</td><td class="num">${n(c.aceites_30d)}</td><td class="num">${n(c.envios_30d)}</td><td>${c.ultima_entrega ? pill(c.ultima_entrega, c.ultima_entrega === 'read' ? 'ok' : c.ultima_entrega === 'failed' ? 'bad' : 'warn') : '—'}</td><td>${esc(c.idioma || '—')}</td></tr>`).join('') || '<tr><td colspan="8" class="vazio-sec">Nenhuma casa marcada.</td></tr>'}</tbody></table></div>`;
  }

  function clientes(s) {
    const r = s.clientes.resumo;
    $('#clientes-body').className = '';
    $('#clientes-body').innerHTML = `
      <div class="kpis"><div class="kpi ${r.ativos ? 'good' : 'bad'}"><div class="v">${n(r.ativos)}</div><div class="l">com opt-in ativo</div></div><div class="kpi"><div class="v">${n(r.novos_7d)}</div><div class="l">novos em 7 dias</div></div><div class="kpi"><div class="v">${n(r.opt_out)}</div><div class="l">pediram para parar</div></div></div>
      ${s.clientes.ultimos.length ? `<div class="caixa"><table class="t"><thead><tr><th>número</th><th>idioma</th><th>origem</th><th>estado</th><th>quando</th></tr></thead><tbody>${s.clientes.ultimos.map((c) => `<tr><td>${esc(c.rotulo)}</td><td>${esc(c.idioma || '—')}</td><td>${esc(c.origem || '—')}</td><td>${pill(c.opt_out ? 'parou' : c.ativo ? 'ativo' : 'inativo', c.opt_out ? 'bad' : c.ativo ? 'ok' : 'mute')}</td><td>${quando(c.em)}</td></tr>`).join('')}</tbody></table></div>` : `<div class="caixa vazio-sec">Nenhum cliente fez opt-in ainda. O botão "Receive updates on WhatsApp" entrou no e-mail de solicitação em 22/10/2026; cada toque que vira mensagem aparece aqui.</div>`}`;
  }

  function qualidade(s) {
    const q = s.qualidade; const crit = ['idioma_ok', 'sem_prazo', 'sem_vocabulario_interno', 'discricao', 'resolve_agora', 'tom_marca'];
    const semanas = q.semanas.map((w) => ({ dia: w.semana, media: Number(w.media), n: w.n }));
    $('#qualidade-body').className = '';
    $('#qualidade-body').innerHTML = `
      <div class="g2">
        <div class="caixa"><h3>Média por semana <small>0 a 6 · mínimo 5</small></h3>${semanas.length ? `<table class="t"><thead><tr><th>semana</th><th class="num">respostas</th><th class="num">média</th><th class="num">reprovadas</th></tr></thead><tbody>${q.semanas.map((w) => `<tr><td>${w.semana}</td><td class="num">${w.n}</td><td class="num" style="color:${Number(w.media) >= 5 ? 'var(--wa)' : 'var(--serious)'}">${Number(w.media).toFixed(2)}</td><td class="num">${w.reprovadas}</td></tr>`).join('')}</tbody></table>` : '<div class="vazio-sec">Sem notas em 8 semanas.</div>'}</div>
        <div class="caixa"><h3>Últimas notas <small>clique no número para abrir a conversa</small></h3><div class="notas">${q.ultimas.map((x) => `<div class="nota-l"><div class="n ${x.nota >= 5 ? 'ok' : 'bad'}">${x.nota}</div><div><a href="#conversas" data-abrir="${esc(x.chat_id)}" style="color:var(--ink)">${esc(x.chat)}</a> <span class="micro">· ${esc(x.channel)} · ${quando(x.judged_at)}</span><div>${esc(x.motivo)}</div><div class="crit">${crit.map((c) => `<span class="${x.notas && x.notas[c] === 0 ? 'x' : ''}">${c.replace(/_/g, ' ')}</span>`).join('')}</div></div></div>`).join('') || '<div class="vazio-sec">Sem notas.</div>'}</div></div>
      </div>`;
    $('#qualidade-body').querySelectorAll('[data-abrir]').forEach((a) => a.addEventListener('click', () => { S.canal = 'todas'; conversas(S.snap); abrir(a.dataset.abrir); }));
  }

  function escalacoes(s) {
    const e = s.escalacoes;
    $('#escalacoes-body').className = '';
    $('#escalacoes-body').innerHTML = `
      <div class="caixa"><h3>Abertas <small>${e.abertas.length}</small></h3>${e.abertas.length ? `<table class="t"><thead><tr><th>desde</th><th>tipo</th><th>dono</th><th>contato</th><th>o que</th></tr></thead><tbody>${e.abertas.map((x) => `<tr><td>${quando(x.created_at)}</td><td>${pill(x.tag, 'warn')}</td><td>${esc(x.dono)}</td><td>${esc(x.contato)}</td><td>${esc(x.resumo)}</td></tr>`).join('')}</tbody></table>` : '<div class="vazio-sec">Fila vazia: nada espera uma pessoa.</div>'}</div>
      <div class="caixa"><h3>Fechadas recentemente <small>quem resolveu e como</small></h3><table class="t"><thead><tr><th>quando</th><th>tipo</th><th>por</th><th>resumo</th><th>nota de fechamento</th></tr></thead><tbody>${e.fechadas.map((x) => `<tr><td>${quando(x.resolved_at || x.created_at)}</td><td>${pill(x.tag, 'mute')}</td><td>${esc(x.resolved_by || '—')}</td><td>${esc(x.resumo)}</td><td class="micro">${esc(x.nota || '')}</td></tr>`).join('')}</tbody></table></div>`;
  }

  function compromissos(s) {
    const c = s.compromissos; const por = Object.fromEntries(c.por_status.map((x) => [x.status, x.n]));
    $('#compromissos-body').className = '';
    $('#compromissos-body').innerHTML = `
      <div class="kpis"><div class="kpi"><div class="v">${n(por.pending)}</div><div class="l">a cumprir</div></div><div class="kpi good"><div class="v">${n(por.cumprido)}</div><div class="l">cumpridos</div></div><div class="kpi ${(por.sem_canal || por.retido) ? 'warn' : ''}"><div class="v">${n((por.sem_canal || 0) + (por.retido || 0))}</div><div class="l">sem canal ou retidos</div></div></div>
      ${c.proximos.length ? `<div class="caixa"><table class="t"><thead><tr><th>vence</th><th>canal</th><th>conversa</th><th>reserva</th><th>prometido</th></tr></thead><tbody>${c.proximos.map((x) => `<tr><td>${new Date(x.due_at).toLocaleDateString('pt-BR')}</td><td>${esc(x.channel)}</td><td>${esc(x.chat)}</td><td>${esc(x.reservation_code || '—')}</td><td>${esc(x.o_que || '')}</td></tr>`).join('')}</tbody></table></div>` : '<div class="caixa vazio-sec">Nenhum compromisso pendente.</div>'}`;
  }

  function motor(s) {
    $('#motor-body').className = '';
    $('#motor-body').innerHTML = `
      <div class="g2">
        <div class="caixa"><h3>Ferramentas <small>7 dias</small></h3><table class="t"><thead><tr><th>ferramenta</th><th class="num">chamadas</th><th class="num">falhas</th><th class="num">ms</th></tr></thead><tbody>${s.ferramentas.map((f) => `<tr><td>${esc(f.tool_name)}</td><td class="num">${n(f.n)}</td><td class="num">${f.falhas ? `<span class="pill bad">${f.falhas}</span>` : '0'}</td><td class="num">${n(f.ms)}</td></tr>`).join('') || '<tr><td colspan="4" class="vazio-sec">Nenhuma chamada em 7 dias.</td></tr>'}</tbody></table></div>
        <div class="caixa"><h3>Modelo <small>7 dias</small></h3><table class="t"><thead><tr><th>modelo</th><th class="num">chamadas</th><th class="num">entrada</th><th class="num">saída</th><th class="num">cache lido</th></tr></thead><tbody>${s.custo.map((c) => `<tr><td>${esc(c.model)}</td><td class="num">${n(c.chamadas)}</td><td class="num">${n(c.entrada)}</td><td class="num">${n(c.saida)}</td><td class="num">${n(c.cache)}</td></tr>`).join('') || '<tr><td colspan="5" class="vazio-sec">Sem uso em 7 dias.</td></tr>'}</tbody></table></div>
      </div>`;
  }

  function render(s) {
    if (!s || s.banco !== 'ok') {
      $('#live').dataset.s = 'erro'; $('#live-t').textContent = 'sem leitura do banco';
      $('#pulso-body').className = 'caixa erro'; $('#pulso-body').textContent = (s && s.erro) || 'A Central está sem a credencial de leitura (DATABASE_URL_RO).';
      return;
    }
    $('#live').dataset.s = 'ok'; $('#live-t').textContent = `ao vivo · ${new Date(s.geradoEm).toLocaleTimeString('pt-BR')} · ${s.ms} ms`;
    pulso(s); conversas(s); funil(s); entregas(s); casas(s); clientes(s); qualidade(s); escalacoes(s); compromissos(s); motor(s);
    $('#rodape').textContent = `Gerado ${new Date(s.geradoEm).toLocaleString('pt-BR')} · cache ${s.cacheSeg} s · atualização automática a cada 30 s · Casas de teste excluídas das contagens · Identificadores mascarados por regra (whatsapp-regras.js).`;
  }

  async function carregar(fresco) {
    if (S.carregando) return; S.carregando = true;
    try {
      const r = await fetch(`/api/whatsapp${fresco ? '?fresco=1' : ''}`, { headers: headers() });
      if (r.status === 401) return gate(true);
      S.snap = await r.json(); gate(false); render(S.snap);
      if (S.aberta && fresco) abrir(S.aberta);
    } catch (e) { $('#live').dataset.s = 'erro'; $('#live-t').textContent = 'falha: ' + e.message; }
    finally { S.carregando = false; }
  }

  function gate(on) { $('#gate').hidden = !on; $('#app').style.visibility = on ? 'hidden' : 'visible'; }
  function tema(t) { document.documentElement.dataset.theme = t; $('#tema').textContent = t === 'dark' ? 'Tema claro' : 'Tema escuro'; localStorage.setItem('pn_tema', t); }

  // ── arranque ──
  tema(localStorage.getItem('pn_tema') || 'dark');
  $('#tema').addEventListener('click', () => tema(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));
  $('#atualizar').addEventListener('click', () => carregar(true));
  $('#periodo').addEventListener('click', () => { S.periodo = S.periodo === 30 ? 7 : 30; $('#periodo').textContent = `${S.periodo} dias`; if (S.snap) pulso(S.snap); });
  $('#canal').addEventListener('click', () => { S.canal = S.canal === 'whatsapp' ? 'todas' : 'whatsapp'; $('#canal').textContent = S.canal === 'whatsapp' ? 'só WhatsApp' : 'WhatsApp + e-mail'; $('#canal').classList.toggle('on', S.canal === 'whatsapp'); if (S.snap) conversas(S.snap); });
  $('#menu').addEventListener('click', () => { document.body.dataset.menu = document.body.dataset.menu === '1' ? '0' : '1'; });
  $('#gate form').addEventListener('submit', (e) => { e.preventDefault(); S.token = $('#gate input').value.trim(); localStorage.setItem('mc_key', S.token); gate(false); carregar(true); });
  document.querySelectorAll('#nav a').forEach((a) => a.addEventListener('click', () => { document.querySelectorAll('#nav a').forEach((x) => x.classList.toggle('on', x === a)); document.body.dataset.menu = '0'; }));
  const obs = new IntersectionObserver((es) => { for (const x of es) if (x.isIntersecting) { $('#crumb').textContent = x.target.querySelector('h1').textContent; document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('on', a.getAttribute('href') === '#' + x.target.id)); } }, { rootMargin: '-40% 0px -55% 0px' });
  document.querySelectorAll('.sec').forEach((s) => obs.observe(s));
  carregar(false);
  S.timer = setInterval(() => { if (!document.hidden) carregar(false); }, 30_000);
})();
