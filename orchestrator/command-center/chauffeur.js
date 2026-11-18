'use strict';
/**
 * Central · Pedidos de corrida do Wanted Chauffeur (leads da página /ride).
 *
 * O que guarda de cada pedido: só o código (WTD-<origem>-XXXX), a origem, o produto, a data e a hora pedidas,
 * o número de pessoas e o idioma. NUNCA nome nem telefone: isso vai só na mensagem do WhatsApp, e a planilha de
 * clientes (fora do site e fora do banco) é quem guarda a pessoa. Cards T-20261109-0024, 0027 e 0023 (plano B).
 *
 *   POST /api/chauffeur/lead            ← a página /ride, antes de abrir o WhatsApp (sendBeacon). SEM chave da Central:
 *                                          a página roda no navegador do cliente. Protegido por origem permitida
 *                                          (CHAUFFEUR_ORIGINS), formato estrito do corpo e teto por endereço.
 *   GET  /api/chauffeur/leads?dias=30   → lista + contagens por origem, produto, dia e resultado (chave da Central)
 *   POST /api/chauffeur/lead/resultado  → { codigo, resultado: orcado|confirmado|feito|perdido, nota? } (chave)
 *   GET  /api/chauffeur/links           → os links por rede, cada um com a sua letra (chave)
 *
 * Arquivos (STATE_DIR): chauffeur-leads.jsonl (append-only, um pedido por linha) e
 * chauffeur-leads-resultados.jsonl (append-only; o último resultado de um código é o que vale).
 * Quando a tabela chauffeur_leads existir (DDL em orchestrator/agents/dba-escrita/exemplos/chauffeur-leads.sql,
 * exige a frase do fundador), estes dois arquivos migram sem perder linha.
 */
const fs = require('node:fs');
const path = require('node:path');

const ORIGENS = { T: 'TikTok', I: 'Instagram', Y: 'YouTube', W: 'Twitch', H: 'Hotel', S: 'Site', R: 'Direto' };
const PRODUTOS = ['transfer', 'mad', 'night', 'game', 'soiree'];
const PRODUTO_NOME = { transfer: 'Transfer', mad: 'Mise à disposition', night: 'Night Ride', game: 'Game Night', soiree: 'Soirée' };
const RESULTADOS = ['orcado', 'confirmado', 'feito', 'perdido'];
const RE_CODIGO = /^WTD-([TIYWHSR])-([ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4})$/;
const RE_DATA = /^\d{4}-\d{2}-\d{2}$/;
const RE_HORA = /^(1[0-2]|[1-9]):[0-5][05] (AM|PM)$/; // sempre AM/PM, passos de 5 min (decisão do fundador, 05/11)
const PAGINA = 'https://theworldkeys.com/ride';

function criar({ stateDir, env = process.env, agora = () => Date.now() }) {
  const arqLeads = () => path.join(stateDir, 'chauffeur-leads.jsonl');
  const arqResultados = () => path.join(stateDir, 'chauffeur-leads-resultados.jsonl');
  const origensPermitidas = String(env.CHAUFFEUR_ORIGINS || 'https://theworldkeys.com,https://www.theworldkeys.com')
    .split(',').map((s) => s.trim()).filter(Boolean);
  const TETO_POR_IP = Number(env.CHAUFFEUR_TETO_HORA || 30);
  const porIp = new Map(); // ip → [timestamps da última hora]

  const lerLinhas = (f) => { try { return fs.readFileSync(f, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; } };
  const anexar = (f, obj) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.appendFileSync(f, JSON.stringify(obj) + '\n', 'utf8'); };

  function excedeuTeto(ip) {
    const t = agora(); const lista = (porIp.get(ip) || []).filter((x) => t - x < 3_600_000);
    lista.push(t); porIp.set(ip, lista);
    if (porIp.size > 5000) porIp.clear(); // memória limitada: zera e recomeça
    return lista.length > TETO_POR_IP;
  }

  /** Valida o corpo vindo da página. Qualquer campo fora da lista é descartado; nome e telefone nunca entram. */
  function validarLead(corpo) {
    if (!corpo || typeof corpo !== 'object') return { erro: 'corpo inválido' };
    const codigo = String(corpo.codigo || '').toUpperCase().trim();
    const m = RE_CODIGO.exec(codigo);
    if (!m) return { erro: 'codigo no formato WTD-<T|I|Y|W|H|S|R>-XXXX' };
    const produto = String(corpo.produto || '').toLowerCase().trim();
    if (!PRODUTOS.includes(produto)) return { erro: `produto: ${PRODUTOS.join(', ')}` };
    const data = corpo.data ? String(corpo.data).trim() : null;
    if (data && !RE_DATA.test(data)) return { erro: 'data AAAA-MM-DD' };
    const hora = corpo.hora ? String(corpo.hora).trim().toUpperCase() : null;
    if (hora && !RE_HORA.test(hora)) return { erro: 'hora em AM/PM, passos de 5 min (ex.: 9:00 PM)' };
    const pessoas = corpo.pessoas == null ? null : Number(corpo.pessoas);
    if (pessoas != null && !(Number.isInteger(pessoas) && pessoas >= 1 && pessoas <= 6)) return { erro: 'pessoas de 1 a 6' };
    const horas = corpo.horas == null ? null : Number(corpo.horas);
    if (horas != null && !(Number.isInteger(horas) && horas >= 2 && horas <= 12)) return { erro: 'horas de 2 a 12' };
    const idioma = /^(fr|en|pt)$/.test(String(corpo.idioma || '')) ? String(corpo.idioma) : null;
    const imagens = corpo.imagens === true || corpo.imagens === 'ok' ? 'ok' : 'privadas';
    return { lead: { codigo, origem: m[1], produto, data, hora, pessoas, horas, idioma, imagens } };
  }

  function gravarLead(lead) {
    const existentes = lerLinhas(arqLeads());
    if (existentes.some((l) => l.codigo === lead.codigo)) return { status: 200, ok: true, codigo: lead.codigo, repetido: true };
    anexar(arqLeads(), { ...lead, criado_em: new Date(agora()).toISOString() });
    return { status: 201, ok: true, codigo: lead.codigo };
  }

  function marcarResultado(corpo) {
    const codigo = String(corpo && corpo.codigo || '').toUpperCase().trim();
    if (!RE_CODIGO.test(codigo)) return { status: 400, erro: 'codigo no formato WTD-<letra>-XXXX' };
    const resultado = String(corpo.resultado || '').toLowerCase();
    if (!RESULTADOS.includes(resultado)) return { status: 400, erro: `resultado: ${RESULTADOS.join(', ')}` };
    if (!lerLinhas(arqLeads()).some((l) => l.codigo === codigo)) return { status: 404, erro: `${codigo} não está nos pedidos` };
    const nota = corpo.nota ? String(corpo.nota).slice(0, 200) : undefined;
    if (nota && /\+?\d[\d .-]{7,}\d/.test(nota)) return { status: 400, erro: 'a nota não pode ter telefone' };
    const ev = { codigo, resultado, nota, em: new Date(agora()).toISOString() };
    anexar(arqResultados(), ev);
    return { status: 200, ok: true, ...ev };
  }

  /** Lista e contagens. `dias` conta pela data de criação do pedido. */
  function painel({ dias = 30 } = {}) {
    const limite = agora() - Math.max(1, Math.min(365, Number(dias) || 30)) * 86_400_000;
    const ultimo = new Map();
    for (const r of lerLinhas(arqResultados())) ultimo.set(r.codigo, r); // o último vale
    const todos = lerLinhas(arqLeads());
    const leads = todos.filter((l) => Date.parse(l.criado_em) >= limite).map((l) => ({ ...l, origem_nome: ORIGENS[l.origem] || l.origem, produto_nome: PRODUTO_NOME[l.produto] || l.produto, resultado: (ultimo.get(l.codigo) || {}).resultado || 'novo', resultado_em: (ultimo.get(l.codigo) || {}).em || null }))
      .sort((a, b) => (a.criado_em < b.criado_em ? 1 : -1));
    const contar = (chave) => { const c = {}; for (const l of leads) { const k = l[chave] || '—'; c[k] = (c[k] || 0) + 1; } return c; };
    const porDia = {}; for (const l of leads) { const d = l.criado_em.slice(0, 10); porDia[d] = (porDia[d] || 0) + 1; }
    const resultados = contar('resultado');
    const viraram = (resultados.confirmado || 0) + (resultados.feito || 0);
    return {
      gerado_em: new Date(agora()).toISOString(), dias: Number(dias) || 30, total_historico: todos.length,
      total: leads.length, viraram_corrida: viraram, taxa_conversao_pct: leads.length ? Math.round((viraram / leads.length) * 100) : 0,
      por_origem: Object.fromEntries(Object.entries(contar('origem')).map(([k, v]) => [ORIGENS[k] || k, v])),
      por_produto: Object.fromEntries(Object.entries(contar('produto')).map(([k, v]) => [PRODUTO_NOME[k] || k, v])),
      por_dia: Object.entries(porDia).sort().map(([dia, n]) => ({ dia, n })),
      por_resultado: resultados,
      pedidos: leads.slice(0, 500),
      origens: ORIGENS, resultados_possiveis: RESULTADOS,
      lacunas: leads.length ? [] : ['Nenhum pedido no período: ou a página /ride ainda não envia à Central, ou ninguém pediu.'],
    };
  }

  function links() {
    const base = env.CHAUFFEUR_PAGINA || PAGINA;
    return { pagina: base, links: Object.entries(ORIGENS).filter(([k]) => k !== 'R').map(([k, nome]) => ({ origem: k, rede: nome, url: `${base}?o=${k}`, uso: k === 'H' ? 'cartão e QR entregues aos hotéis' : k === 'S' ? 'botões do site theworldkeys.com' : `link na bio do @wantedchauffeur no ${nome}` })) };
  }

  function cors(req, res) {
    const origem = req.headers.origin || '';
    if (!origensPermitidas.includes(origem)) return false;
    res.setHeader('access-control-allow-origin', origem);
    res.setHeader('access-control-allow-methods', 'POST, OPTIONS');
    res.setHeader('access-control-allow-headers', 'content-type');
    res.setHeader('access-control-max-age', '600');
    res.setHeader('vary', 'origin');
    return true;
  }

  /** Rota PÚBLICA (antes da chave): só o POST do lead. Devolve true se tratou. */
  function tratarPublico(req, res, u, json) {
    if (u.pathname !== '/api/chauffeur/lead') return false;
    const permitido = cors(req, res);
    if (req.method === 'OPTIONS') { res.writeHead(permitido ? 204 : 403); res.end(); return true; }
    if (req.method !== 'POST') { json(res, 405, { error: 'POST' }); return true; }
    // sendBeacon manda sem Origin em alguns navegadores antigos? Não: sempre manda Origin em POST cross-site.
    if (!permitido && origensPermitidas.length) { json(res, 403, { error: 'origem não permitida' }); return true; }
    const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
    if (excedeuTeto(ip)) { json(res, 429, { error: 'muitos pedidos deste endereço; tente mais tarde' }); return true; }
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 2_000) req.destroy(); });
    req.on('end', () => {
      let corpo; try { corpo = JSON.parse(body); } catch { return json(res, 400, { error: 'JSON inválido' }); }
      const v = validarLead(corpo);
      if (v.erro) return json(res, 400, { error: v.erro });
      const r = gravarLead(v.lead);
      json(res, r.status, { ok: true, codigo: r.codigo, repetido: !!r.repetido });
    });
    return true;
  }

  /** Rotas COM chave da Central (o servidor já conferiu). Devolve true se tratou. */
  function tratar(req, res, u, json) {
    if (!u.pathname.startsWith('/api/chauffeur')) return false;
    if (u.pathname === '/api/chauffeur/leads' && req.method === 'GET') { json(res, 200, painel({ dias: u.searchParams.get('dias') || 30 })); return true; }
    if (u.pathname === '/api/chauffeur/links' && req.method === 'GET') { json(res, 200, links()); return true; }
    if (u.pathname === '/api/chauffeur/lead/resultado' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => { body += c; if (body.length > 4_000) req.destroy(); });
      req.on('end', () => { let corpo; try { corpo = JSON.parse(body); } catch { return json(res, 400, { error: 'JSON inválido' }); } const r = marcarResultado(corpo); json(res, r.status, r); });
      return true;
    }
    json(res, 404, { error: 'rota desconhecida em /api/chauffeur' });
    return true;
  }

  return { tratarPublico, tratar, validarLead, gravarLead, marcarResultado, painel, links, ORIGENS, PRODUTOS, RESULTADOS };
}

module.exports = { criar, ORIGENS, PRODUTOS, RESULTADOS, RE_CODIGO };
