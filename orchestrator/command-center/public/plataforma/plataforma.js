/* PANORAMA — leitura unificada do sistema de agentes (front-end, sem dependências).
 *
 * Duas fontes: /plataforma/registro.json (o QUE cada página mostra e explica — texto, estático)
 * e /api/plataforma (os NÚMEROS, lidos ao vivo pela Central: banco em somente leitura, saúde e
 * APIs dos agentes, arquivos de estado). Esta camada só desenha: nenhum número nasce aqui, e
 * número que não pôde ser lido aparece como "sem leitura", com o motivo — nunca como zero.
 * Todo texto vindo de dados entra por textContent (nada de innerHTML com dado).
 */
(() => {
  'use strict';

  const S = { reg: null, snap: null, erro: null, token: localStorage.getItem('mc_key') || '', carregando: false };
  const $ = (s, el = document) => el.querySelector(s);
  const NS = 'http://www.w3.org/2000/svg';

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style') el.setAttribute('style', v);
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const k of kids.flat(Infinity)) if (k !== null && k !== undefined && k !== false) el.append(k.nodeType ? k : document.createTextNode(String(k)));
    return el;
  }
  function s(tag, attrs, ...kids) {
    const el = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs || {})) if (v !== null && v !== undefined && v !== false) el.setAttribute(k, v);
    for (const k of kids.flat(Infinity)) if (k !== null && k !== undefined && k !== false) el.append(k.nodeType ? k : document.createTextNode(String(k)));
    return el;
  }
  const ICO = {
    ok: 'M3 8.5l3.2 3.2L13 4.8',
    atencao: 'M8 2.2l6.3 11H1.7L8 2.2zM8 6.6v3.2M8 11.6v.4',
    fora: 'M4 4l8 8M12 4l-8 8',
    neutro: 'M3.5 8h9',
    info: 'M8 1.8a6.2 6.2 0 100 12.4A6.2 6.2 0 008 1.8zM8 7.2v4M8 4.6v.4',
  };
  const ico = (n) => s('svg', { viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.7, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' }, s('path', { d: ICO[n] || ICO.info }));
  const pill = (estado, texto) => h('span', { class: 'pill', 'data-s': estado }, ico(estado === 'serio' ? 'atencao' : estado), texto);

  // ───────────── formatação ─────────────
  const nfInt = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
  const nf1 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const nf2 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  const vazio = (v) => v === null || v === undefined || v === '';
  function haQuanto(iso) {
    const t = new Date(iso).getTime();
    if (!Number.isFinite(t)) return '—';
    const min = Math.round((Date.now() - t) / 60000);
    if (min < 1) return 'agora';
    if (min < 60) return `há ${min} min`;
    const hrs = Math.round(min / 60);
    if (hrs < 48) return `há ${hrs} h`;
    return `há ${Math.round(hrs / 24)} dias`;
  }
  function fmt(v, f) {
    if (vazio(v)) return '—';
    const n = Number(v);
    switch (f) {
      case 'pct': return Number.isFinite(n) ? `${nf1.format(n)}%` : String(v);
      case 'pct0': return Number.isFinite(n) ? `${nfInt.format(n)}%` : String(v);
      case 'dec1': return Number.isFinite(n) ? nf1.format(n) : String(v);
      case 'dec2': return Number.isFinite(n) ? nf2.format(n) : String(v);
      case 'horas': return Number.isFinite(n) ? (n >= 48 ? `${nfInt.format(n / 24)} dias` : `${Number.isInteger(n) ? nfInt.format(n) : nf1.format(n)} h`) : String(v);
      case 'min': return Number.isFinite(n) ? (n >= 90 ? `${nf1.format(n / 60)} h` : `${nfInt.format(n)} min`) : String(v);
      case 'ms': return Number.isFinite(n) ? (n >= 1000 ? `${nf1.format(n / 1000)} s` : `${nfInt.format(n)} ms`) : String(v);
      case 'usd': return Number.isFinite(n) ? `US$ ${nf2.format(n)}` : String(v);
      case 'eur': return Number.isFinite(n) ? `€ ${nf2.format(n)}` : `€ ${v}`;
      case 'idade': return haQuanto(v);
      case 'dia': { const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}/${m[2]}/${m[1]}` : String(v); }
      case 'data': { const d = new Date(v); return Number.isFinite(d.getTime()) ? d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : String(v); }
      case 'texto': return String(v);
      case 'simnao': return v === true || v === 't' || v === 'true' ? 'sim' : 'não';
      default: return Number.isFinite(n) && String(v).trim() !== '' ? nfInt.format(n) : String(v);
    }
  }
  function rotuloX(x) {
    const t = String(x ?? '');
    let m = t.match(/^(\d{4})-(\d{2})$/);
    if (m) return `${MES[Number(m[2]) - 1]}/${m[1].slice(2)}`;
    m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[3]}/${m[2]}`;
    return t;
  }

  // ───────────── acesso aos números ─────────────
  /** "metrica" → linhas; "metrica.campo" → valor da primeira linha. Devolve { ok, v|linhas, motivo }. */
  function ler(ref) {
    const [id, campo] = String(ref).split('.');
    const m = S.snap && S.snap.metricas && S.snap.metricas[id];
    if (!m) return { ok: false, motivo: S.snap ? 'métrica ainda não publicada pela Central' : 'carregando' };
    if (m.s !== 'ok') return { ok: false, motivo: m.erro || 'sem leitura' };
    const linhas = m.linhas || [];
    if (!campo) return { ok: true, linhas, em: m.em };
    if (!linhas.length) return { ok: false, motivo: 'a consulta não devolveu linhas' };
    const v = linhas[0][campo];
    if (v === undefined) return { ok: false, motivo: `campo "${campo}" ausente` };
    return { ok: true, v, em: m.em };
  }
  const cor = (c) => `var(--${c || 'seq'})`;

  // ───────────── blocos ─────────────
  function tile(t) {
    const r = ler(t.ref);
    const el = h('article', { class: 'card tile' + (t.destaque ? ' destaque' : '') });
    el.append(h('div', { class: 'lbl' }, t.t));
    if (r.ok && !vazio(r.v)) {
      const txt = fmt(r.v, t.f);
      el.append(h('div', { class: 'val' + (t.f === 'texto' || txt.length > 9 ? ' txt' : '') }, txt, t.u ? h('small', {}, t.u) : null));
    } else if (!r.ok && r.motivo === 'carregando') {
      el.append(h('div', { class: 'skel', style: 'height:46px;width:58%', 'aria-label': 'lendo' }));
    } else {
      el.append(h('div', { class: 'val' }, h('span', { class: 'falta' }, r.ok ? 'sem dado' : 'sem leitura')));
    }
    if (t.e) el.append(h('p', { class: 'exp' }, t.e));
    if (!r.ok && r.motivo !== 'carregando') el.append(h('p', { class: 'src' }, `Motivo: ${r.motivo}`));
    else if (t.fonte) el.append(h('p', { class: 'src' }, `Fonte: ${t.fonte}`));
    return el;
  }
  const blocoNumeros = (b) => h('div', { class: 'grid g4' }, (b.tiles || []).map(tile));

  function semLeitura(titulo, motivo) {
    if (motivo === 'carregando') return h('div', { class: 'skel', style: 'height:180px', 'aria-label': 'lendo os números' });
    return h('div', { class: 'nota', 'data-s': 'atencao' }, ico('atencao'), h('div', {}, h('b', {}, titulo || 'Sem leitura'), ' — ', motivo));
  }
  function figura(b, corpo, tabela) {
    const fig = h('figure', { class: 'card fig' });
    const plot = h('div', {}, corpo);
    const tb = tabela ? h('div', { class: 'scroll', hidden: true }, tabela) : null;
    const btn = tabela ? h('button', { class: 'tog', 'aria-pressed': 'false', onclick: () => {
      const on = btn.getAttribute('aria-pressed') !== 'true';
      btn.setAttribute('aria-pressed', String(on)); btn.textContent = on ? 'Ver gráfico' : 'Ver tabela';
      plot.hidden = on; tb.hidden = !on;
    } }, 'Ver tabela') : null;
    fig.append(h('div', { class: 'fig-head' }, h('div', {}, h('h3', {}, b.titulo), b.texto ? h('p', {}, b.texto) : null), btn ? h('div', { class: 'fig-tools' }, btn) : null));
    fig.append(plot);
    if (tb) fig.append(tb);
    if (b.fonte) fig.append(h('figcaption', { class: 'tile' }, h('p', { class: 'src' }, `Fonte: ${b.fonte}`)));
    return fig;
  }
  function tabelaDe(linhas, colunas) {
    return h('table', { class: 't' },
      h('thead', {}, h('tr', {}, colunas.map((c) => h('th', { class: c.f && c.f !== 'texto' ? 'n' : null }, c.rotulo)))),
      h('tbody', {}, linhas.map((l) => h('tr', {}, colunas.map((c) => h('td', { class: c.f && c.f !== 'texto' ? 'n' : null }, c.x ? rotuloX(l[c.campo]) : fmt(l[c.campo], c.f || (typeof l[c.campo] === 'number' ? 'int' : 'texto'))))))));
  }

  function passos(max) {
    if (max <= 0) return [0, 1];
    const bruto = max / 4, pot = Math.pow(10, Math.floor(Math.log10(bruto)));
    const passo = [1, 2, 2.5, 5, 10].map((m) => m * pot).find((p) => p >= bruto) || bruto;
    const out = [];
    for (let v = 0; v <= max + passo * 0.999; v += passo) out.push(Math.round(v * 1000) / 1000);
    return out;
  }

  function blocoLinha(b) {
    const r = ler(b.id);
    if (!r.ok) return figura(b, semLeitura(null, r.motivo));
    const xk = b.x || 'periodo';
    const linhas = r.linhas.filter((l) => !vazio(l[xk]));
    if (linhas.length < 2) return figura(b, semLeitura('Ainda não há série', 'são necessários pelo menos dois pontos para desenhar a linha'));
    const series = b.series || [{ campo: 'valor', rotulo: b.titulo, cor: 's1' }];
    const W = 760, H = 280, M = { t: 16, r: series.length <= 4 ? 96 : 20, b: 30, l: 46 };
    const iw = W - M.l - M.r, ih = H - M.t - M.b;
    const max = Math.max(1, ...linhas.flatMap((l) => series.map((sr) => Number(l[sr.campo]) || 0)));
    const ticks = passos(max), top = ticks[ticks.length - 1] || 1;
    const X = (i) => M.l + (linhas.length === 1 ? iw / 2 : (i * iw) / (linhas.length - 1));
    const Y = (v) => M.t + ih - ((Number(v) || 0) / top) * ih;
    const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `${b.titulo}. ${series.map((sr) => sr.rotulo).join(', ')} por período.` });
    const eixo = s('g', { class: 'axis' });
    for (const t of ticks) {
      eixo.append(s('line', { class: t === 0 ? 'base' : 'gridl', x1: M.l, x2: M.l + iw, y1: Y(t), y2: Y(t) }));
      eixo.append(s('text', { x: M.l - 10, y: Y(t) + 4, 'text-anchor': 'end' }, fmt(t, b.f === 'pct' ? 'pct0' : b.f === 'dec1' ? 'dec1' : 'int')));
    }
    // Rótulos do eixo: no máximo ~8, sempre o primeiro e o último; o penúltimo some se encostar no último.
    const cada = Math.max(1, Math.ceil(linhas.length / 8));
    const ult = linhas.length - 1;
    linhas.forEach((l, i) => {
      const marca = i === ult || (i % cada === 0 && ult - i >= cada * 0.7);
      if (marca) eixo.append(s('text', { x: X(i), y: H - 8, 'text-anchor': i === 0 ? 'start' : i === ult ? 'end' : 'middle' }, rotuloX(l[xk])));
    });
    svg.append(eixo);
    series.forEach((sr) => {
      const pts = linhas.map((l, i) => `${X(i).toFixed(1)},${Y(l[sr.campo]).toFixed(1)}`);
      if (series.length === 1) svg.append(s('path', { class: 'ar', fill: cor(sr.cor), d: `M${X(0)},${Y(0)} L${pts.join(' L')} L${X(linhas.length - 1)},${Y(0)} Z` }));
      svg.append(s('path', { class: 'ln', stroke: cor(sr.cor), d: `M${pts.join(' L')}` }));
      if (series.length <= 4) {
        const ult = linhas[linhas.length - 1];
        svg.append(s('circle', { class: 'pt', cx: X(linhas.length - 1), cy: Y(ult[sr.campo]), r: 4, fill: cor(sr.cor) }));
        svg.append(s('text', { class: 'dl', x: X(linhas.length - 1) + 10, y: Y(ult[sr.campo]) + 4 }, `${fmt(ult[sr.campo], b.f)}${series.length > 1 ? ' ' + sr.rotulo.toLowerCase().slice(0, 9) : ''}`));
      }
    });
    // camada de leitura: mira + pontos + dica
    const mira = s('line', { class: 'cross', y1: M.t, y2: M.t + ih, x1: 0, x2: 0, visibility: 'hidden' });
    const marcas = series.map((sr) => s('circle', { class: 'pt', r: 4.5, fill: cor(sr.cor), visibility: 'hidden' }));
    const alvo = s('rect', { x: M.l, y: M.t, width: iw, height: ih, fill: 'transparent' });
    svg.append(mira, ...marcas, alvo);
    const tip = h('div', { class: 'tip', role: 'status' });
    const caixa = h('div', { class: 'plot' }, svg, tip);
    const mostrar = (ev) => {
      const box = svg.getBoundingClientRect();
      const px = ((ev.clientX - box.left) / box.width) * W;
      const i = Math.max(0, Math.min(linhas.length - 1, Math.round(((px - M.l) / iw) * (linhas.length - 1))));
      mira.setAttribute('x1', X(i)); mira.setAttribute('x2', X(i)); mira.setAttribute('visibility', 'visible');
      series.forEach((sr, k) => { marcas[k].setAttribute('cx', X(i)); marcas[k].setAttribute('cy', Y(linhas[i][sr.campo])); marcas[k].setAttribute('visibility', 'visible'); });
      tip.replaceChildren(h('b', {}, rotuloX(linhas[i][xk])), ...series.map((sr) => h('div', {}, h('span', {}, h('i', { style: `--c:${cor(sr.cor)}` }), sr.rotulo), h('span', {}, fmt(linhas[i][sr.campo], b.f)))));
      tip.style.left = `${(X(i) / W) * 100}%`;
      tip.style.top = `${(Math.min(...series.map((sr) => Y(linhas[i][sr.campo]))) / H) * 100}%`;
      tip.dataset.on = '1';
    };
    const esconder = () => { tip.dataset.on = '0'; mira.setAttribute('visibility', 'hidden'); marcas.forEach((m) => m.setAttribute('visibility', 'hidden')); };
    alvo.addEventListener('pointermove', mostrar); alvo.addEventListener('pointerdown', mostrar); alvo.addEventListener('pointerleave', esconder);
    const corpo = h('div', { class: 'grid', style: 'gap:12px' },
      series.length > 1 ? h('div', { class: 'legend' }, series.map((sr) => h('span', {}, h('i', { style: `--c:${cor(sr.cor)}` }), sr.rotulo))) : null, caixa);
    return figura(b, corpo, tabelaDe(linhas, [{ campo: xk, rotulo: 'Período', x: true }, ...series.map((sr) => ({ campo: sr.campo, rotulo: sr.rotulo, f: b.f || 'int' }))]));
  }

  function blocoRanking(b) {
    const r = ler(b.id);
    if (!r.ok) return figura(b, semLeitura(null, r.motivo));
    const rk = b.rotulo || 'rotulo', vk = b.valor || 'valor';
    const linhas = r.linhas.slice(0, b.max || 15);
    if (!linhas.length) return figura(b, semLeitura('Nada a listar', 'a consulta não devolveu linhas'));
    const max = Math.max(1, ...linhas.map((l) => Number(l[vk]) || 0));
    const lista = h('div', { class: 'rank' }, linhas.map((l) => h('div', { class: 'row', title: `${l[rk]}: ${fmt(l[vk], b.f)}` },
      h('span', {}, String(l[rk] ?? '—')),
      h('div', { class: 'trk' }, h('div', { class: 'bar', style: `width:${Math.max(0.6, ((Number(l[vk]) || 0) / max) * 100)}%;--c:${cor(b.cor)}` })),
      h('span', { class: 'v' }, fmt(l[vk], b.f), b.extra && !vazio(l[b.extra.campo]) ? h('small', {}, `${fmt(l[b.extra.campo], b.extra.f)} ${b.extra.rotulo}`) : null))));
    const cols = [{ campo: rk, rotulo: b.rotuloTitulo || 'Item', f: 'texto' }, { campo: vk, rotulo: b.valorTitulo || 'Valor', f: b.f || 'int' }];
    if (b.extra) cols.push({ campo: b.extra.campo, rotulo: b.extra.rotulo, f: b.extra.f || 'int' });
    return figura(b, lista, tabelaDe(linhas, cols));
  }

  function blocoFunil(b) {
    const r = ler(b.id);
    if (!r.ok) return figura(b, semLeitura(null, r.motivo));
    const linha = r.linhas[0] || {};
    const etapas = (b.passos || []).map((p) => ({ ...p, v: Number(linha[p.campo]) || 0 }));
    const base = Math.max(1, etapas.length ? etapas[0].v : 1, ...etapas.map((e) => e.v));
    const corpo = h('div', { class: 'funil' }, etapas.map((e) => h('div', { class: 'step' },
      h('div', { class: 't' }, e.rotulo, e.nota ? h('small', {}, e.nota) : null),
      h('div', { class: 'b' }, h('i', { style: `width:${Math.max(0.5, (e.v / base) * 78)}%;--c:${cor(e.cor || b.cor)}` }),
        h('span', {}, fmt(e.v, 'int'), etapas[0].v > 0 && e !== etapas[0] ? h('small', {}, `${nf1.format((e.v / etapas[0].v) * 100)}% do total`) : null)))));
    return figura(b, corpo, tabelaDe(etapas.map((e) => ({ etapa: e.rotulo, valor: e.v })), [{ campo: 'etapa', rotulo: 'Etapa', f: 'texto' }, { campo: 'valor', rotulo: 'Quantidade', f: 'int' }]));
  }

  function blocoTabela(b) {
    const r = ler(b.id);
    if (!r.ok) return figura(b, semLeitura(null, r.motivo));
    if (!r.linhas.length) return figura(b, h('p', { class: 'exp', style: 'color:var(--muted)' }, b.vazio || 'Nada a listar agora.'));
    return figura(b, h('div', { class: 'scroll' }, tabelaDe(r.linhas.slice(0, b.max || 40), b.colunas)));
  }

  const blocoNota = (b) => h('div', { class: 'nota', 'data-s': b.s || null }, ico(b.s === 'fora' ? 'fora' : b.s === 'atencao' ? 'atencao' : 'info'), h('div', {}, b.titulo ? h('b', {}, b.titulo + ' ') : null, b.texto));

  function listaComBusca(itens, desenhar, rotuloBusca) {
    const caixa = h('div', { class: 'card' });
    const lista = h('div', { class: 'itens' });
    const pintar = (q) => {
      const f = q ? itens.filter((i) => JSON.stringify(i).toLowerCase().includes(q)) : itens;
      lista.replaceChildren(...(f.length ? f.map(desenhar) : [h('p', { class: 'exp', style: 'padding:14px 0;color:var(--muted)' }, 'Nada encontrado com esse termo.')]));
    };
    if (itens.length > 8) caixa.append(h('input', { class: 'busca', type: 'search', placeholder: `${rotuloBusca} (${itens.length})`, 'aria-label': rotuloBusca, oninput: (e) => pintar(e.target.value.trim().toLowerCase()) }));
    caixa.append(lista); pintar('');
    return caixa;
  }
  const blocoFuncoes = (ag) => listaComBusca(ag.funcoes || [], (f) => h('div', { class: 'it' },
    h('b', {}, f.nome), f.como_roda ? h('span', { class: 'tag como' }, f.como_roda) : null, h('p', {}, f.descricao_leiga), f.arquivo ? h('code', {}, f.arquivo) : null), 'Buscar nas funções');
  const blocoFerramentas = (ag) => listaComBusca(ag.ferramentas || [], (f) => h('div', { class: 'it' },
    h('b', {}, f.nome), f.tipo ? h('span', { class: 'tag como' }, f.tipo) : null, h('p', {}, f.descricao)), 'Buscar nas ferramentas');
  const blocoDados = (ag) => h('div', { class: 'card' }, h('div', { class: 'itens' }, (ag.dados || []).map((d) => h('div', { class: 'it' }, h('b', {}, d.onde), h('p', {}, d.o_que)))));
  function blocoAutonomia(ag) {
    const a = ag.autonomia || {};
    return h('div', { class: 'grid g2' },
      h('div', { class: 'card tile' }, h('div', { class: 'lbl' }, 'O que faz sozinho'), h('p', { class: 'exp', style: 'font-size:16px' }, a.teto || '—')),
      h('div', { class: 'card tile' }, h('div', { class: 'lbl' }, 'O que só acontece com aprovação humana'),
        h('ul', { style: 'padding-left:18px;display:grid;gap:6px' }, (a.exige_aprovacao || []).map((x) => h('li', { class: 'exp' }, x)))));
  }
  const blocoLacunas = (ag) => h('div', { class: 'card' }, h('ul', { style: 'padding-left:18px;display:grid;gap:8px' }, (ag.lacunas || []).map((x) => h('li', { class: 'exp' }, x))));
  const blocoSinais = (ag) => h('div', { class: 'card' }, h('div', { class: 'itens' }, (ag.sinais_de_vida || []).map((d) => h('div', { class: 'it' }, h('b', {}, d.nome), h('p', {}, d.como_ver)))));

  // ───────────── saúde ─────────────
  function saudeDe(agenteId) {
    const x = S.snap && S.snap.saude && S.snap.saude[agenteId];
    if (!x) return { s: 'neutro', t: 'sem verificação' };
    if (x.estado === 'ok') return { s: 'ok', t: x.texto || 'no ar' };
    if (x.estado === 'atencao') return { s: 'atencao', t: x.texto || 'atenção' };
    if (x.estado === 'fora') return { s: 'fora', t: x.texto || 'fora do ar' };
    return { s: 'neutro', t: x.texto || 'sem verificação' };
  }

  function blocoAgentes() {
    const pgs = S.reg.paginas.filter((p) => p.tipo === 'agente');
    return h('div', { class: 'agentes' }, pgs.map((p) => {
      const sd = saudeDe(p.agenteId);
      return h('a', { class: 'card ag', href: `#/${p.id}`, style: `--c:${cor(p.cor)}` },
        h('header', {}, h('div', {}, h('b', {}, p.agente.codinome), h('small', {}, p.agente.papel)), pill(sd.s, sd.t)),
        h('p', {}, p.agente.resumo),
        h('dl', {}, (p.resumo || []).map((t) => { const r = ler(t.ref); return h('div', {}, h('dt', {}, t.t), h('dd', {}, r.ok && !vazio(r.v) ? fmt(r.v, t.f) : '—', t.u ? h('small', {}, ' ' + t.u) : null)); })));
    }));
  }

  function blocoMapa() {
    const ags = S.reg.paginas.filter((p) => p.tipo === 'agente' && p.id !== 'maestro');
    const W = 1000, H = 430, cx = W / 2, larg = 150, alt = 58;
    const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Mapa do sistema: o fundador fala com o MAESTRO, que distribui o trabalho aos agentes; todos leem e escrevem no banco da plataforma por portas controladas.' });
    const no = (x, y, t1, t2, cls, c) => s('g', { class: 'no ' + (cls || '') },
      s('rect', { x: x - larg / 2, y: y - alt / 2, width: larg, height: alt, rx: 10 }),
      c ? s('rect', { x: x - larg / 2, y: y - alt / 2, width: 4, height: alt, rx: 2, style: `fill:${cor(c)};stroke:none` }) : null,
      s('text', { x, y: y - 2, 'text-anchor': 'middle' }, t1), s('text', { class: 's', x, y: y + 16, 'text-anchor': 'middle' }, t2));
    const yF = 40, yM = 140, yA = 270, yB = 392;
    svg.append(s('path', { class: 'fio ouro', d: `M${cx},${yF + alt / 2} V${yM - alt / 2}` }));
    svg.append(s('text', { class: 'rot', x: cx + 12, y: (yF + yM) / 2 + 4 }, 'PEDE · APROVA'));
    const n = ags.length, passo = (W - 120) / Math.max(1, n - 1);
    ags.forEach((p, i) => {
      const x = 60 + passo * i + (n === 1 ? (W - 120) / 2 : 0);
      svg.append(s('path', { class: 'fio ouro', d: `M${cx},${yM + alt / 2} C${cx},${yM + 80} ${x},${yA - 90} ${x},${yA - alt / 2}` }));
      svg.append(s('path', { class: 'fio', d: `M${x},${yA + alt / 2} C${x},${yA + 80} ${cx},${yB - 80} ${cx},${yB - alt / 2}` }));
    });
    svg.append(s('text', { class: 'rot', x: cx + 12, y: yM + 62 }, 'DELEGA · RECEBE RELATOS'));
    svg.append(s('text', { class: 'rot', x: cx + 12, y: yB - 44 }, 'LEITURA LIVRE · ESCRITA PELA PORTA ÚNICA'));
    svg.append(no(cx, yF, 'Fundador', 'decide e aprova'));
    svg.append(no(cx, yM, 'MAESTRO', 'orquestra, nunca executa', 'centro'));
    ags.forEach((p, i) => svg.append(no(60 + passo * i, yA, p.agente.codinome, p.agente.papel, '', p.cor)));
    svg.append(no(cx, yB, 'Banco da plataforma', 'reservas · catálogo · clientes'));
    return h('div', { class: 'card mapa' }, h('div', { class: 'scroll' }, h('div', { style: 'min-width:760px' }, svg)));
  }

  function blocoGlossario() {
    return listaComBusca(S.reg.glossario || [], (g) => h('div', { class: 'it' }, h('b', {}, g.termo), h('p', {}, g.definicao)), 'Buscar no glossário');
  }

  function blocoFontes() {
    const f = (S.snap && S.snap.fontes) || {};
    const linhas = Object.entries(f).map(([k, v]) => h('div', { class: 'it' }, h('b', {}, v.nome || k),
      h('span', { class: 'como' }, pill(v.status === 'ok' ? 'ok' : v.status === 'parcial' ? 'atencao' : 'neutro', v.status === 'ok' ? 'lendo' : v.status === 'parcial' ? 'parcial' : 'sem leitura')),
      h('p', {}, v.detalhe || '')));
    return h('div', { class: 'card' }, h('div', { class: 'itens' }, linhas.length ? linhas : h('p', { class: 'exp' }, 'Carregando…')));
  }

  function item(b, pg) {
    switch (b.tipo) {
      case 'numeros': return blocoNumeros(b);
      case 'linha': return blocoLinha(b);
      case 'ranking': return blocoRanking(b);
      case 'funil': return blocoFunil(b);
      case 'tabela': return blocoTabela(b);
      case 'nota': return blocoNota(b);
      case 'agentes': return blocoAgentes();
      case 'mapa': return blocoMapa();
      case 'glossario': return blocoGlossario();
      case 'fontes': return blocoFontes();
      case 'funcoes': return blocoFuncoes(pg.agente);
      case 'ferramentas': return blocoFerramentas(pg.agente);
      case 'dados': return blocoDados(pg.agente);
      case 'autonomia': return blocoAutonomia(pg.agente);
      case 'lacunas': return blocoLacunas(pg.agente);
      case 'sinais': return blocoSinais(pg.agente);
      case 'dupla': return h('div', { class: 'grid g2' }, (b.itens || []).map((x) => item(x, pg)));
      default: return h('div', {});
    }
  }

  // ───────────── página ─────────────
  function pagina(pg) {
    const el = h('div', { class: 'page' });
    const sd = pg.tipo === 'agente' ? saudeDe(pg.agenteId) : null;
    el.append(h('header', { class: 'page-head', style: `--c:${cor(pg.cor || 'gold')}` },
      h('div', { class: 'kicker' }, pg.tipo === 'agente' ? h('i', {}) : null, h('span', { class: 'micro' }, pg.kicker || ''), sd ? pill(sd.s, sd.t) : null),
      h('h1', {}, pg.h1 || pg.titulo),
      pg.lede ? h('p', { class: 'lede' }, pg.lede) : null));
    (pg.blocos || []).forEach((bl, i) => {
      const sec = h('section', { class: 'bloco', id: `b${i + 1}` });
      sec.append(h('header', {}, h('h2', {}, h('span', { class: 'n' }, String(i + 1).padStart(2, '0')), bl.titulo), bl.texto ? h('p', {}, bl.texto) : null));
      const corpo = h('div', { class: 'grid', style: 'gap:18px' }, (bl.itens || []).map((b) => item(b, pg)));
      sec.append(corpo);
      el.append(sec);
    });
    el.append(h('footer', { class: 'rodape' },
      h('span', {}, S.snap ? `Números lidos ${haQuanto(S.snap.geradoEm)} · renovados a cada ${Math.round((S.snap.cacheSeg || 300) / 60)} min` : 'Lendo os números…'),
      h('span', {}, 'Somente leitura: esta plataforma não altera nada no sistema.'),
      h('span', {}, 'Número sem leitura aparece como "sem leitura", nunca como zero.')));
    return el;
  }

  function navegar() {
    const id = (location.hash.replace(/^#\/?/, '') || S.reg.paginas[0].id).split('?')[0];
    const pg = S.reg.paginas.find((p) => p.id === id) || S.reg.paginas[0];
    document.title = `${pg.titulo} · Panorama The World Keys`;
    $('#crumb').textContent = `${pg.grupo} · ${pg.titulo}`;
    document.querySelectorAll('.nav a').forEach((a) => a.toggleAttribute('aria-current', false));
    const at = $(`.nav a[data-id="${pg.id}"]`);
    if (at) at.setAttribute('aria-current', 'page');
    const y = window.scrollY, mesma = $('#conteudo').dataset.pg === pg.id;
    $('#conteudo').replaceChildren(pagina(pg));
    $('#conteudo').dataset.pg = pg.id;
    document.body.dataset.menu = '0';
    window.scrollTo(0, mesma ? y : 0);
  }

  function menu() {
    const nav = $('#nav');
    nav.replaceChildren();
    let grupo = null;
    for (const p of S.reg.paginas) {
      if (p.grupo !== grupo) { grupo = p.grupo; nav.append(h('div', { class: 'micro nav-group' }, grupo)); }
      const sd = p.tipo === 'agente' ? saudeDe(p.agenteId) : null;
      nav.append(h('a', { href: `#/${p.id}`, 'data-id': p.id },
        p.tipo === 'agente' ? h('span', { class: 'dot', style: `--c:${cor(p.cor)}` }) : h('span', { class: 'ic' }, '·'),
        h('span', { class: 'nm' }, p.titulo, p.sub ? h('small', {}, p.sub) : null),
        sd ? h('span', { class: 'st', 'data-s': sd.s, title: sd.t, role: 'img', 'aria-label': sd.t }) : null));
    }
  }

  function selo() {
    const c = $('#selo');
    c.dataset.s = S.carregando ? 'carregando' : S.erro ? 'erro' : 'ok';
    $('#selo-t').textContent = S.carregando ? 'Lendo os números…' : S.erro ? S.erro : S.snap ? `Atualizado ${haQuanto(S.snap.geradoEm)}` : '—';
  }

  async function carregar(fresco) {
    S.carregando = true; S.erro = null; selo();
    try {
      const r = await fetch(`/api/plataforma${fresco ? '?fresco=1' : ''}`, { headers: S.token ? { 'x-center-key': S.token } : {} });
      if (r.status === 401) { portao(true); return; }
      if (!r.ok) throw new Error(`a Central respondeu ${r.status}`);
      S.snap = await r.json();
    } catch (e) {
      S.erro = `Sem conexão com a Central (${String(e.message || e).slice(0, 60)})`;
    } finally {
      S.carregando = false; selo();
      if (S.reg) { menu(); navegar(); }
    }
  }

  function portao(on) {
    $('#gate').hidden = !on; $('#app').hidden = on;
    if (on) $('#gate input').focus();
  }

  function tema(t) {
    document.documentElement.dataset.theme = t;
    localStorage.setItem('pn_tema', t);
    $('#tema').textContent = t === 'light' ? 'Tema escuro' : 'Tema claro';
  }

  async function iniciar() {
    tema(localStorage.getItem('pn_tema') || 'dark');
    $('#tema').addEventListener('click', () => tema(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light'));
    $('#atualizar').addEventListener('click', () => carregar(true));
    $('#imprimir').addEventListener('click', () => window.print());
    $('#menu').addEventListener('click', () => { document.body.dataset.menu = document.body.dataset.menu === '1' ? '0' : '1'; });
    $('#gate form').addEventListener('submit', (e) => { e.preventDefault(); S.token = $('#gate input').value.trim(); localStorage.setItem('mc_key', S.token); tentarAbrir(); });
    let antes = null;
    window.addEventListener('beforeprint', () => { antes = document.documentElement.dataset.theme; document.documentElement.dataset.theme = 'light'; });
    window.addEventListener('afterprint', () => { if (antes) document.documentElement.dataset.theme = antes; });
    window.addEventListener('hashchange', () => { if (S.reg) navegar(); });
    await tentarAbrir();
    setInterval(() => { if (S.reg) carregar(); }, 5 * 60_000);
    setInterval(selo, 60_000);
  }

  /**
   * O texto das páginas descreve o sistema por dentro: vem da API, atrás da mesma chave dos números.
   * Devolve false quando a chave falta ou não vale (o portão aparece).
   */
  async function abrir() {
    const r = await fetch('/api/plataforma/registro', { headers: S.token ? { 'x-center-key': S.token } : {} });
    if (r.status === 401 || r.status === 503) { portao(true); return false; }
    if (!r.ok) throw new Error(`a Central respondeu ${r.status}`);
    S.reg = await r.json();
    if (!S.reg.paginas || !S.reg.paginas.length) throw new Error('nenhuma página publicada');
    portao(false);
    menu(); navegar();
    await carregar();
    return true;
  }
  async function tentarAbrir() {
    try { await abrir(); }
    catch (e) { $('#conteudo').replaceChildren(h('div', { class: 'page' }, semLeitura('A plataforma não carregou', `não foi possível ler o conteúdo das páginas (${String(e.message || e).slice(0, 80)}).`))); }
  }
  document.addEventListener('DOMContentLoaded', iniciar);
})();
