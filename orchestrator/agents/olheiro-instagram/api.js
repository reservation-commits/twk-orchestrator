'use strict';
/**
 * Olheiro do Instagram — cliente da API oficial da Meta (Instagram Platform). SÓ LEITURA.
 *
 * Dois caminhos de login, os dois oficiais:
 *   - IG_LOGIN=instagram (padrão): graph.instagram.com, token da própria conta profissional (Instagram Login).
 *     Lê conta, posts, stories, métricas, comentários e marcações. NÃO tem Business Discovery.
 *   - IG_LOGIN=facebook: graph.facebook.com, conta ligada a uma Página e token de usuário do sistema do
 *     Business Manager (não vence). Lê tudo acima e também os números públicos de outras contas profissionais.
 *
 * Regras deste arquivo:
 *   - Só GET. Nenhuma função aqui publica, comenta, responde ou manda mensagem. Escrever na conta é outra fase,
 *     com aprovação do fundador (tabela de escalonamento: envio externo e publicação em canal oficial).
 *   - O token nunca aparece em mensagem de erro, log ou estado: a URL com o token não sai desta função.
 *   - Métrica que a Meta recusa não derruba a coleta: cai para uma por uma e volta como `rejeitadas` (lacuna).
 *     A lista de métricas da Meta muda a cada versão (abril/2025 tirou impressions e plays); falhar alto aqui
 *     significa declarar o que não veio, não parar tudo.
 */

const HOSTS = { instagram: 'https://graph.instagram.com', facebook: 'https://graph.facebook.com' };
// Códigos da Meta: 190 token inválido/vencido · 10/200-299 permissão · 4/17/32/613 limite de chamadas · 1/2 temporário.
const CODIGOS_CREDENCIAL = new Set([190, 102, 10]);
const CODIGOS_LIMITE = new Set([4, 17, 32, 613, 80002]);
const CODIGOS_TEMPORARIOS = new Set([1, 2]);

class ErroMeta extends Error {
  constructor({ status, code, subcode, tipo, mensagem }) {
    super(`Meta ${status || '?'} código ${code ?? '?'}${subcode ? `/${subcode}` : ''}: ${String(mensagem || 'sem mensagem').slice(0, 200)}`);
    this.status = status; this.code = code; this.subcode = subcode; this.tipo = tipo;
    this.credencial = CODIGOS_CREDENCIAL.has(code) || (code >= 200 && code <= 299) || status === 401;
    this.limite = CODIGOS_LIMITE.has(code) || status === 429;
    this.transitorio = this.limite || CODIGOS_TEMPORARIOS.has(code) || (status >= 500 && status <= 599);
    // 100 = parâmetro inválido. Em /insights quase sempre é "métrica não suportada para este tipo de mídia".
    this.metricaRecusada = code === 100 && /metric|métrica/i.test(String(mensagem || ''));
  }
}

function limparMensagem(texto, token) {
  let s = String(texto || '');
  if (token) s = s.split(token).join('[token]');
  return s.replace(/access_token=[^&\s"]+/g, 'access_token=[token]');
}

/**
 * @param {{ token: string, userId: string, login?: 'instagram'|'facebook', versao?: string, fetchImpl?: Function, timeoutMs?: number }} cfg
 */
function criarCliente(cfg) {
  const login = cfg.login === 'facebook' ? 'facebook' : 'instagram';
  const versao = cfg.versao || 'v24.0';
  const host = HOSTS[login];
  const fetchImpl = cfg.fetchImpl || globalThis.fetch;
  const timeoutMs = cfg.timeoutMs || 15000;
  const token = String(cfg.token || '');
  let chamadas = 0;
  if (!token) throw new Error('sem token do Instagram');
  if (!cfg.userId) throw new Error('sem IG_USER_ID');

  async function get(caminho, params = {}) {
    const url = new URL(`${host}/${versao}/${String(caminho).replace(/^\/+/, '')}`);
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
    url.searchParams.set('access_token', token);
    chamadas += 1;
    let r;
    try {
      r = await fetchImpl(url.toString(), { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
    } catch (e) {
      const err = new ErroMeta({ status: 0, code: null, mensagem: `rede: ${limparMensagem(e && e.message, token)}` });
      err.transitorio = true;
      throw err;
    }
    let corpo = null;
    try { corpo = await r.json(); } catch { corpo = null; }
    if (!r.ok || (corpo && corpo.error)) {
      const e = (corpo && corpo.error) || {};
      throw new ErroMeta({ status: r.status, code: e.code, subcode: e.error_subcode, tipo: e.type, mensagem: limparMensagem(e.message || `HTTP ${r.status}`, token) });
    }
    return corpo || {};
  }

  /** Segue `paging.next` até `limite` itens. A URL de `next` traz o token: reaproveitamos só o cursor `after`. */
  async function paginar(caminho, params = {}, limite = 100) {
    const itens = [];
    let after;
    for (let volta = 0; volta < 20 && itens.length < limite; volta++) {
      const p = await get(caminho, { ...params, after });
      for (const x of p.data || []) { itens.push(x); if (itens.length >= limite) break; }
      after = p.paging && p.paging.cursors && p.paging.cursors.after;
      if (!after || !(p.paging && p.paging.next)) break;
    }
    return itens;
  }

  /**
   * Pede várias métricas de uma vez; se a Meta recusar uma, refaz uma por uma.
   * Devolve { valores: {metrica: numero|objeto}, rejeitadas: [metrica] }.
   */
  async function insights(objetoId, metricas, extra = {}) {
    const ler = (lista) => get(`${objetoId}/insights`, { metric: lista.join(','), ...extra });
    const extrair = (corpo) => {
      const v = {};
      for (const m of corpo.data || []) {
        if (m.total_value && m.total_value.breakdowns) v[m.name] = m.total_value.breakdowns;
        else if (m.total_value && Number.isFinite(m.total_value.value)) v[m.name] = m.total_value.value;
        else if (Array.isArray(m.values) && m.values.length) {
          const ult = m.values[m.values.length - 1].value;
          v[m.name] = typeof ult === 'number' ? ult : ult;
        }
      }
      return v;
    };
    if (!metricas.length) return { valores: {}, rejeitadas: [] };
    try {
      return { valores: extrair(await ler(metricas)), rejeitadas: [] };
    } catch (e) {
      if (!(e instanceof ErroMeta) || !(e.metricaRecusada || e.code === 100)) throw e;
    }
    const valores = {}; const rejeitadas = [];
    for (const m of metricas) {
      try { Object.assign(valores, extrair(await ler([m]))); }
      catch (e) { if (e instanceof ErroMeta && (e.metricaRecusada || e.code === 100)) rejeitadas.push(m); else throw e; }
    }
    return { valores, rejeitadas };
  }

  return { get, paginar, insights, login, versao, userId: String(cfg.userId), chamadas: () => chamadas };
}

module.exports = { criarCliente, ErroMeta, HOSTS, limparMensagem };
