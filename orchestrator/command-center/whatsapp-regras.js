'use strict';
/**
 * Sala do WhatsApp — regras PURAS (sem I/O): mascaramento, agregação do funil, linha do tempo, resumo de entrega.
 * Testadas em regencia/test/whatsapp.test.js. Tudo que toca banco ou rede fica em whatsapp.js.
 */

/** Telefone: país + últimos 4 dígitos; e-mail: 1ª letra + domínio. Nunca devolve o identificador inteiro. */
function mascarar(chatId) {
  const s = String(chatId || '').trim();
  if (!s) return '—';
  if (s.startsWith('email:')) {
    const e = s.slice(6);
    const [u, d] = e.split('@');
    return d ? `${(u || '?').slice(0, 1)}•••@${d}` : 'e-mail';
  }
  const d = s.replace(/\D/g, '');
  if (d.length < 8) return '•••';
  return `+${codigoPais(d)} ••• ${d.slice(-4)}`;
}

/** Código do país em E.164 (1, 2 ou 3 dígitos) sem biblioteca: a tabela de prefixos da UIT. */
function codigoPais(d) {
  const a = d[0]; const ab = d.slice(0, 2);
  if (a === '1' || a === '7') return a;
  const dois = {
    2: ['20', '27'], 3: ['30', '31', '32', '33', '34', '36', '39'], 4: ['40', '41', '43', '44', '45', '46', '47', '48', '49'],
    5: ['51', '52', '53', '54', '55', '56', '57', '58'], 6: ['60', '61', '62', '63', '64', '65', '66'], 8: ['81', '82', '84', '86'],
    9: ['90', '91', '92', '93', '94', '95', '98'],
  }[a] || [];
  return dois.includes(ab) ? ab : d.slice(0, 3);
}

function primeiroNome(nome) {
  const n = String(nome || '').trim();
  return n ? n.split(/\s+/)[0] : '';
}

/** aria_outbound_log agrupado (evento, desfecho, motivo, n) → funil legível. */
function agregarFunil(linhas) {
  const total = linhas.reduce((a, l) => a + Number(l.n || 0), 0);
  const enviados = linhas.filter((l) => l.desfecho === 'enviado').reduce((a, l) => a + Number(l.n || 0), 0);
  const porDesfecho = new Map();
  for (const l of linhas) {
    const k = l.desfecho || '—';
    const e = porDesfecho.get(k) || { desfecho: k, n: 0, motivos: new Map() };
    e.n += Number(l.n || 0);
    const m = l.motivo || '—';
    e.motivos.set(m, (e.motivos.get(m) || 0) + Number(l.n || 0));
    porDesfecho.set(k, e);
  }
  const desfechos = [...porDesfecho.values()]
    .map((e) => ({ desfecho: e.desfecho, n: e.n, pct: total ? Math.round((1000 * e.n) / total) / 10 : 0, motivos: [...e.motivos.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([motivo, n]) => ({ motivo, n })) }))
    .sort((a, b) => b.n - a.n);
  const porEvento = new Map();
  for (const l of linhas) {
    const k = (l.evento || '—').replace(/_(pt_BR|en|fr|es|it|de)$/, '');
    const e = porEvento.get(k) || { evento: k, total: 0, enviados: 0 };
    e.total += Number(l.n || 0);
    if (l.desfecho === 'enviado') e.enviados += Number(l.n || 0);
    porEvento.set(k, e);
  }
  const eventos = [...porEvento.values()].map((e) => ({ ...e, pct: e.total ? Math.round((100 * e.enviados) / e.total) : 0 })).sort((a, b) => b.total - a.total);
  return { total, enviados, pct_enviados: total ? Math.round((1000 * enviados) / total) / 10 : 0, desfechos, eventos };
}

/** Preenche os dias sem dado com zero (últimos `dias` dias, UTC) para o gráfico não "pular". */
function linhaDoTempo(linhas, dias, hoje = new Date()) {
  const idx = new Map(linhas.map((l) => [String(l.dia).slice(0, 10), l]));
  const out = [];
  for (let i = dias - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), hoje.getUTCDate() - i)).toISOString().slice(0, 10);
    const l = idx.get(d) || {};
    out.push({ dia: d, recebidas: Number(l.recebidas || 0), respondidas: Number(l.respondidas || 0), enviados: Number(l.enviados || 0), tentativas: Number(l.tentativas || 0), falhas: Number(l.falhas || 0) });
  }
  return out;
}

/** aria_delivery_status agrupado (template, status, n) → por template com taxa de leitura. */
function resumoEntregas(linhas) {
  const por = new Map();
  for (const l of linhas) {
    const t = l.template || '—';
    const e = por.get(t) || { template: t, total: 0, read: 0, delivered: 0, sent: 0, failed: 0 };
    e.total += Number(l.n || 0);
    if (e[l.status] !== undefined) e[l.status] += Number(l.n || 0);
    por.set(t, e);
  }
  return [...por.values()].map((e) => ({ ...e, pct_lidas: e.total ? Math.round((100 * e.read) / e.total) : 0, pct_falhas: e.total ? Math.round((100 * e.failed) / e.total) : 0 })).sort((a, b) => b.total - a.total);
}

/** Segundos → "12 s", "4 min", "2 h 10", "3 d". */
function duracao(seg) {
  if (seg === null || seg === undefined || seg === '') return '—';
  const s = Number(seg);
  if (!Number.isFinite(s) || s < 0) return '—';
  if (s < 60) return `${Math.round(s)} s`;
  if (s < 3600) return `${Math.round(s / 60)} min`;
  if (s < 86400) { const h = Math.floor(s / 3600); const m = Math.round((s % 3600) / 60); return m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`; }
  return `${Math.round(s / 86400)} d`;
}

module.exports = { mascarar, primeiroNome, agregarFunil, linhaDoTempo, resumoEntregas, duracao };
