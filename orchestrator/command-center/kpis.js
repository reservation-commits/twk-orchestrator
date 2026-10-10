/**
 * MAESTRO — Proxy de KPIs dos 5 agentes (SOMENTE LEITURA).
 *
 * Por que server-side: os agentes têm CSP/CORS fechados e exigem credenciais.
 * O navegador nunca vê token de agente — a Central busca, normaliza e devolve só números.
 *
 * Endpoints e autenticação foram mapeados no código-fonte de cada agente (2026-08-13):
 *   CLAVIS  GET /api/snapshot, /api/actions/pending, /api/outreach/pending  → Authorization: Bearer
 *   ARIA    GET /dashboard/api/{overview,escalations,catalog/quality}       → Authorization: Basic
 *   QUILL   GET /api/kpis                                                    → Authorization: Basic
 *   ATLAS   GET /api/overview, /actions/pending                              → x-atlas-key
 *   DBA     (ver adaptador abaixo)                                           → Authorization: Bearer
 *
 * Doutrina: nunca inventa número. Sem credencial → status "sem_credencial".
 * Endpoint ausente → "sem_endpoint". Falha → "erro" com a mensagem real.
 */
const TIMEOUT_MS = Number(process.env.KPI_TIMEOUT_MS || 7000);
const TTL_MS = Number(process.env.KPI_CACHE_MS || 60_000);

const cache = new Map(); // id -> { at, data }

function basic(user, pass) {
  return 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
}

async function get(base, path, headers) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(new URL(path, base), { headers, signal: ctrl.signal, redirect: 'follow' });
    if (!r.ok) throw new Error(`HTTP ${r.status} em ${path}`);
    return await r.json();
  } finally { clearTimeout(to); }
}

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

// ---------------------------------------------------------------- adaptadores
const ADAPTERS = {
  // ---- CLAVIS (Comercial) -------------------------------------------------
  async comercial(base) {
    const token = process.env.AGENT_CLAVIS_TOKEN;
    if (!token) return { status: 'sem_credencial', envs: ['AGENT_CLAVIS_TOKEN'] };
    const h = { authorization: `Bearer ${token}` };
    const [snap, acts, lotes, health] = await Promise.all([
      get(base, '/api/snapshot', h),
      get(base, '/api/actions/pending', h).catch(() => null),
      get(base, '/api/outreach/pending', h).catch(() => null),
      get(base, '/health', {}).catch(() => null),
    ]);
    const hl = (snap && snap.headline) || {};
    const stage = (arr, name) => {
      const s = (arr || []).find((x) => x.stage === name);
      return s ? s.count : null;
    };
    return {
      status: 'ok',
      fonte: snap && snap.source,
      demo: snap && snap.source === 'mock', // o CLAVIS avisa quando está em dados fictícios
      publicados: num(hl.publicados),
      catalogo: num(hl.estabelecimentos_total),
      parceiros: num(hl.parceiros),
      parceirosMonetizados: num(hl.parceiros_monetizados),
      reservasTotal: num(hl.reservas_total),
      reservas90d: num(hl.reservas_ultimos_90d),
      taxaResposta: hl.taxa_resposta_restaurante ?? null, // string com % (do agente)
      funilOferta: (snap && snap.supplyFunnel) || [],
      funilDemanda: (snap && snap.demandFunnel) || [],
      // Pending = solicitações que ainda não foram respondidas (derivado, o agente não expõe direto)
      reservasPendentes: (() => {
        const sol = stage(snap && snap.demandFunnel, 'solicitações');
        const resp = stage(snap && snap.demandFunnel, 'respondidas');
        return sol !== null && resp !== null ? sol - resp : null;
      })(),
      propostasPendentes: acts && Array.isArray(acts.pending) ? acts.pending.length : null,
      lotesPendentes: Array.isArray(lotes) ? lotes.length : null,
      orcamento: health && health.budget ? health.budget : null,
      lacunas: (snap && snap.instrumentationGaps) || [],
      geradoEm: snap && snap.generatedAt,
    };
  },

  // ---- ARIA (Suporte) -----------------------------------------------------
  async suporte(base) {
    const u = process.env.AGENT_ARIA_USER, p = process.env.AGENT_ARIA_PASSWORD;
    if (!u || !p) return { status: 'sem_credencial', envs: ['AGENT_ARIA_USER', 'AGENT_ARIA_PASSWORD'] };
    const h = { authorization: basic(u, p) };
    const [ov, esc, rev, qual] = await Promise.all([
      get(base, '/dashboard/api/overview', h),
      get(base, '/dashboard/api/escalations?limit=200', h).catch(() => null),
      get(base, '/dashboard/api/reviews?limit=1', h).catch(() => null),
      get(base, '/dashboard/api/catalog/quality', h).catch(() => null),
    ]);
    const escRows = Array.isArray(esc) ? esc : (esc && esc.rows) || [];
    return {
      status: 'ok',
      mensagensHoje: num(ov && ov.messages_today),
      conversasAtivas7d: num(ov && ov.active_conversations_7d),
      reservasHoje: num(ov && ov.reservations_today),
      latenciaFerramentaMs: num(ov && ov.avg_tool_latency_today_ms),
      serie7d: (ov && ov.messages_7d) || [],
      escalacoesAbertas: escRows.length ? escRows.filter((r) => r.status === 'open').length : null,
      escalacoesTruncadas: escRows.length >= 200, // o endpoint limita em 200
      csatEstabelecimento: rev && rev.summary ? num(rev.summary.avg_establishment) : null,
      csatPlataforma: rev && rev.summary ? num(rev.summary.avg_platform) : null,
      catalogo: (qual && qual.totals) || null,
    };
  },

  // ---- QUILL (Editorial) --------------------------------------------------
  async editorial(base) {
    const u = process.env.AGENT_QUILL_USER, p = process.env.AGENT_QUILL_PASSWORD;
    if (!u || !p) return { status: 'sem_credencial', envs: ['AGENT_QUILL_USER', 'AGENT_QUILL_PASSWORD'] };
    let k;
    try {
      k = await get(base, '/api/kpis', { authorization: basic(u, p) });
    } catch (e) {
      // O endpoint /api/kpis foi adicionado ao admin do Quill em 2026-08-13.
      // Se ainda não foi implantado, o agente responde 404 — dizemos isso, não "erro genérico".
      if (String(e.message).includes('404')) {
        return { status: 'sem_endpoint', detalhe: 'o admin do Quill precisa ser redeployado com app/api/kpis/route.ts' };
      }
      throw e;
    }
    return {
      status: 'ok',
      clicks28d: num(k.meta && k.meta.clicks28d),
      impressoes28d: num(k.meta && k.meta.impressions28d),
      posicao28d: num(k.meta && k.meta.position28d),
      baselineMensal: num(k.meta && k.meta.baselineMonthly),
      metaMensal: num(k.meta && k.meta.goalMonthly),
      filaAguardando: num(k.fila && k.fila.aguardandoRevisao),
      comandos: (k.fila && k.fila.comandos) || null,
      vazaoSemanal: k.vazaoSemanal || null,
      custoHojeUsd: num(k.custo && k.custo.hojeUsd),
      capDiarioUsd: num(k.custo && k.custo.capDiarioUsd),
      custoMesUsd: num(k.custo && k.custo.mesUsd),
      workerOnline: k.saude && k.saude.worker ? k.saude.worker.online : null,
      gscAtrasoDias: k.saude && k.saude.gsc ? num(k.saude.gsc.daysBehind) : null,
      errosInternos: k.errors || [],
    };
  },

  // ---- ATLAS (Financeiro) -------------------------------------------------
  async financeiro(base) {
    const key = process.env.AGENT_ATLAS_KEY;
    if (!key) return { status: 'sem_credencial', envs: ['AGENT_ATLAS_KEY'] };
    const h = { 'x-atlas-key': key };
    const [ov, acts] = await Promise.all([
      get(base, '/api/overview', h),
      get(base, '/actions/pending', h).catch(() => null),
    ]);
    const k = (ov && ov.kpis) || {};
    return {
      status: 'ok',
      moeda: (ov && ov.currency) || 'EUR',
      // O Atlas devolve dinheiro como string decimal exata (nunca float) — preservamos a string.
      mrr: k.mrr ?? null,
      arr: k.arr ?? null,
      arpu: k.arpu ?? null,
      assinantes: num(k.subscribers),
      saldoDisponivel: k.balanceAvailable ?? null,
      aging: (ov && ov.aging) || [],
      diario: (ov && ov.daily) || [],
      healthScore: ov && ov.health ? num(ov.health.score) : null,
      healthFatores: ov && ov.health ? ov.health.factors || [] : [],
      propostasPendentes: acts && Array.isArray(acts.pending) ? acts.pending.length : null,
      propostas: acts && Array.isArray(acts.pending) ? acts.pending.slice(0, 5) : [],
      geradoEm: ov && ov.computedAt,
    };
  },

  // ---- DB ARCHITECT -------------------------------------------------------
  // Duas rotas de LEITURA: /api/crm?action=overview (catálogo e contatos) e
  // /api/seo (cobertura de foto + score). NÃO usar /api/cron/snapshot: ela GRAVA.
  async dba(base) {
    const token = process.env.AGENT_DBA_TOKEN;
    if (!token) return { status: 'sem_credencial', envs: ['AGENT_DBA_TOKEN'] };
    const h = { authorization: `Bearer ${token}` };
    const [crm, seo] = await Promise.all([
      get(base, '/api/crm?action=overview', h),
      get(base, '/api/seo', h).catch(() => null),
    ]);
    const k = (crm && crm.kpis) || {};
    const pub = num(k.published);
    const pct = (n) => (pub && n !== null ? Math.round((n / pub) * 100) : null);
    return {
      status: 'ok',
      total: num(k.total),
      publicados: pub,
      parceiros: num(k.partners),
      paises: num(k.countries),
      cidades: num(k.cities),
      verificados30d: num(k.verified_30d),
      mutacoes7d: num(crm && crm.recentActivity),
      reservas: crm && crm.reservations ? num(crm.reservations.total) : null,
      // Completude por campo crítico, em % dos publicados
      completude: {
        email: pct(num(k.with_email)),
        telefone: pct(num(k.with_phone)),
        site: pct(num(k.with_site)),
        coordenadas: pct(num(k.with_geo)),
        texto: pct(num(k.with_about)),
        foto: seo && seo.covers ? num(seo.covers.coverage) : null,
      },
      semFoto: seo && seo.covers ? num(seo.covers.missing) : null,
      seoScore: seo && seo.audit ? num(seo.audit.score) : null,
      tendencia: (seo && seo.trend) || [],
    };
  },

  // ---- GUARDIÃO DA RESERVA (agente LOCAL, sem HTTP) ------------------------
  // Núcleo determinístico que roda na máquina do Orquestrador; a leitura vem dos arquivos de
  // estado dele (ou da cópia sincronizada por push-state.ps1). Ver guardiao.js.
  async guardiao() {
    return require('./guardiao.js').kpis();
  },
};

// ---------------------------------------------------------------- fachada
async function kpisFor(agent) {
  if (!agent.url && !agent.local) return { status: 'sem_url', envs: [`AGENT_${agent.env}_URL`] };
  const hit = cache.get(agent.id);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data;
  const adapter = ADAPTERS[agent.id];
  if (!adapter) return { status: 'sem_endpoint' };
  let data;
  try {
    data = await adapter(agent.url);
  } catch (e) {
    data = { status: 'erro', erro: String((e && e.message) || e).slice(0, 200) };
  }
  data.atualizadoEm = new Date().toISOString();
  cache.set(agent.id, { at: Date.now(), data });
  return data;
}

module.exports = { kpisFor, TTL_MS };
