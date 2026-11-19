'use strict';
/**
 * Central · Wanted Chauffeur — a página /ride, as reservas e o painel (Fase 1, 19/11/2026).
 *
 * A reserva mora em agents/wanted-chauffeur/reservas.js (arquivo no volume hoje; Postgres quando a DDL rodar).
 *
 *   POST /api/chauffeur/reserva         ← a página /ride, ao clicar em "Préparer le message": a reserva inteira
 *                                          (código, produto, data, hora, pessoas, partida, destino, NOME de quem embarca,
 *                                          WhatsApp, recado, caixa de imagens). SEM chave: a página roda no navegador do
 *                                          cliente. Protegida por origem permitida, formato estrito e teto por endereço.
 *                                          Grava e avisa o Julien pela Aria (evento reserva:<codigo>), sem bloquear a resposta.
 *   POST /api/chauffeur/lead            ← compatibilidade com o protótipo de 18/11 (sem pessoa). Mesmas proteções.
 *   GET  /api/chauffeur/leads?dias=30   → painel: lista com status, contagens por origem, produto, dia e resultado (chave)
 *   POST /api/chauffeur/lead/resultado  → { codigo, resultado: orcado|confirmado|feito|perdido|cancelado, nota? } (chave)
 *   GET  /api/chauffeur/reserva/:codigo → uma reserva, com a linha do tempo (chave)
 *   GET  /api/chauffeur/links           → os links por rede, cada um com a sua letra (chave)
 *   GET/POST /c/<codigo>?t=<token>      ← Fase 2: a página do Julien (do link no aviso): ficha + "Confirmer"/"Refuser".
 *                                          Confirmar manda ao cliente o template wc_ride_confirmed (cliente.js), uma vez.
 *                                          Marcar `confirmado` no painel tem o mesmo efeito (mudarStatus).
 *
 * A página pública é servida pelo server.js em /ride (public/ride/). Em produção o front de theworldkeys.com faz
 * rewrite de /ride para a Central, ou ride.theworldkeys.com aponta direto para cá.
 */
const fs = require('node:fs');
const path = require('node:path');

const AGENTS_DIR = process.env.TWK_AGENTS_DIR ? path.resolve(process.env.TWK_AGENTS_DIR) : path.join(__dirname, '..', 'agents');
const reservasMod = require(path.join(AGENTS_DIR, 'wanted-chauffeur', 'reservas.js'));
const avisar = require(path.join(AGENTS_DIR, 'wanted-chauffeur', 'avisar.js'));
const confirmar = require(path.join(AGENTS_DIR, 'wanted-chauffeur', 'confirmar.js')); // Fase 2: link de confirmação do Julien (/c/<codigo>?t=…)
const cliente = require(path.join(AGENTS_DIR, 'wanted-chauffeur', 'cliente.js')); // Fase 2: confirmação e lembretes ao cliente pela Meta

const { ORIGENS, PRODUTOS, PRODUTO_NOME, STATUS, RE_CODIGO } = reservasMod;
const RESULTADOS = STATUS.filter((s) => s !== 'pedido');
const PAGINA = 'https://theworldkeys.com/ride';

function criar({ stateDir, env = process.env, agora = () => Date.now(), fetchImpl = globalThis.fetch, log = console.log, sentinels = null }) {
  const dir = path.join(stateDir, 'agents', 'wanted-chauffeur');
  const origensPermitidas = String(env.CHAUFFEUR_ORIGINS || 'https://theworldkeys.com,https://www.theworldkeys.com')
    .split(',').map((s) => s.trim()).filter(Boolean);
  const TETO_POR_IP = Number(env.CHAUFFEUR_TETO_HORA || 30);
  const porIp = new Map(); // ip → [timestamps da última hora]
  const cfgAviso = avisar.config(env);

  // O armazém abre uma vez (banco ou arquivo) e as rotas esperam por ele.
  let store = null;
  const pronto = reservasMod.abrir({ dir, env, agora, log }).then(async (s) => {
    store = s;
    if (s.modo === 'arquivo') {
      try { const r = await s.importarLeadsAntigos(path.join(stateDir, 'chauffeur-leads.jsonl'), path.join(stateDir, 'chauffeur-leads-resultados.jsonl')); if (r.importados) log(`[chauffeur] ${r.importados} pedido(s) do plano B importados para as reservas`); } catch (e) { log(`[chauffeur] importação do plano B falhou: ${e.message}`); }
    }
    return s;
  });
  const armazem = () => pronto;

  function excedeuTeto(ip) {
    const t = agora(); const lista = (porIp.get(ip) || []).filter((x) => t - x < 3_600_000);
    lista.push(t); porIp.set(ip, lista);
    if (porIp.size > 5000) porIp.clear(); // memória limitada: zera e recomeça
    return lista.length > TETO_POR_IP;
  }

  function cors(req, res) {
    const origem = req.headers.origin || '';
    // Mesma origem (a página servida pela própria Central) não manda Origin em POST simples: aceita quando não há Origin
    // e o Host bate, ou quando a origem está na lista.
    if (!origem) return true;
    if (!origensPermitidas.includes(origem) && !mesmaOrigem(req, origem)) return false;
    res.setHeader('access-control-allow-origin', origem);
    res.setHeader('access-control-allow-methods', 'POST, OPTIONS');
    res.setHeader('access-control-allow-headers', 'content-type');
    res.setHeader('access-control-max-age', '600');
    res.setHeader('vary', 'origin');
    return true;
  }
  function mesmaOrigem(req, origem) {
    try { const h = String(req.headers['x-forwarded-host'] || req.headers.host || ''); return !!h && new URL(origem).host === h; } catch { return false; }
  }

  const lerCorpo = (req, max) => new Promise((ok) => { let body = ''; req.on('data', (c) => { body += c; if (body.length > max) req.destroy(); }); req.on('end', () => { try { ok(JSON.parse(body)); } catch { ok(null); } }); });

  /** Aviso ao Julien pela Aria; nunca atrasa a resposta à página. Falha vira evento + Ação na Central. */
  async function avisarNova(reserva) {
    if (!cfgAviso.novaReserva) return;
    const s = await armazem();
    try {
      const link = confirmar.link(reserva.codigo, env); // null sem CHAUFFEUR_CONFIRMA_URL + segredo: o aviso sai sem botão
      const r = await avisar.avisarEquipe({ ...cfgAviso, para: cfgAviso.julien, sistema: 'Wanted Chauffeur · nouvelle demande', situacao: avisar.textoNovaReserva(reserva, link), evento: `reserva:${reserva.codigo}`, fetchImpl });
      if (r.ok) { await s.evento({ codigo: reserva.codigo, tipo: 'aviso', valor: 'nova_reserva', nota: r.desfecho, por: 'central' }); log(`[chauffeur] ${reserva.codigo}: Julien avisado (${r.desfecho})`); return; }
      throw new Error(r.desfecho);
    } catch (e) {
      const motivo = String(e && e.message || e).slice(0, 160);
      log(`[chauffeur] ${reserva.codigo}: aviso ao Julien NÃO saiu (${motivo})`);
      try { await s.evento({ codigo: reserva.codigo, tipo: 'aviso', valor: 'nova_reserva_falhou', nota: motivo.replace(/(\+|\b0)\d(?:[ .-]?\d){8,}/g, '…'), por: 'central' }); } catch { /* registro */ }
      if (sentinels) { try { sentinels.upsert(stateDir, { origem: 'vigia', agente: 'wanted-chauffeur', regra: 'aviso_nova_reserva_falhou', severidade: 'alta', titulo: 'Pedido de corrida chegou e o Julien não foi avisado', detalhe: `${reserva.codigo}: ${motivo}. Conferir ARIA_TEAM_ALERT_SECRET e a lista TEAM_ALERT_TO da Aria.`, evidencia: [{ metrica: 'codigo', antes: '', depois: reserva.codigo }] }); } catch { /* fila */ } }
    }
  }

  /** Mudança de status com os efeitos: confirmado → confirmação ao cliente (uma vez). Devolve o evento + `cliente`. */
  async function mudarStatus({ codigo, status, nota, por }) {
    const s = await armazem();
    const v = reservasMod.validarEvento({ codigo, status, nota, por });
    if (v.erro) return { status: 400, erro: v.erro };
    if (v.evento.valor === 'pedido') return { status: 400, erro: `resultado: ${RESULTADOS.join(', ')}` };
    const r = await s.evento(v.evento);
    if (r.status !== 200) return r;
    if (v.evento.valor === 'confirmado') {
      const reserva = await s.obter(v.evento.codigo);
      const c = await cliente.enviar({ store: s, reserva, tipo: 'confirmacao_cliente', env, fetchImpl, log });
      return { ...r, cliente: c };
    }
    return r;
  }

  /** Página e decisão do Julien pelo link do aviso (público, protegido pelo token). Devolve true se tratou. */
  function tratarConfirmacao(req, res, u) {
    const m = /^\/c\/([A-Za-z0-9-]{10,12})\/?$/.exec(u.pathname);
    if (!m) return false;
    const codigo = m[1].toUpperCase(); const t = u.searchParams.get('t') || '';
    const html = (code, body) => { res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); res.end(body); };
    (async () => {
      if (!RE_CODIGO.test(codigo) || !confirmar.tokenValido(codigo, t, env)) return html(404, confirmar.paginaErro());
      const s = await armazem();
      const r = await s.obter(codigo);
      if (!r) return html(404, confirmar.paginaErro());
      if (req.method === 'GET') return html(200, confirmar.pagina(r, { t }));
      if (req.method !== 'POST') { res.writeHead(405); return res.end(); }
      const corpo = await new Promise((ok) => { let b = ''; req.on('data', (c) => { b += c; if (b.length > 2_000) req.destroy(); }); req.on('end', () => ok(b)); });
      const decisao = new URLSearchParams(corpo).get('decision');
      if (decisao !== 'confirmer' && decisao !== 'refuser') return html(400, confirmar.pagina(r, { t, mensagem: 'Choix inconnu.' }));
      if (r.status !== 'pedido' && r.status !== 'orcado') return html(200, confirmar.pagina(r, { t, mensagem: 'Cette demande a déjà une réponse.' }));
      const novo = decisao === 'confirmer' ? 'confirmado' : 'perdido';
      const x = await mudarStatus({ codigo, status: novo, por: 'julien', nota: decisao === 'refuser' ? 'refusée par Julien (lien)' : 'confirmée par Julien (lien)' });
      if (x.status !== 200) return html(500, confirmar.pagina(r, { t, mensagem: `Erreur : ${x.erro || x.status}` }));
      const depois = await s.obter(codigo);
      log(`[chauffeur] ${codigo}: Julien ${decisao === 'confirmer' ? 'confirmou' : 'recusou'} pelo link${x.cliente ? ` · cliente: ${x.cliente.enviado ? 'confirmação enviada' : x.cliente.motivo}` : ''}`);
      return html(200, confirmar.pagina(depois, { t, mensagem: decisao === 'confirmer' ? 'Course confirmée.' : 'Demande refusée.', envioCliente: decisao === 'confirmer' ? !!(x.cliente && x.cliente.enviado) : null }));
    })().catch((e) => { log(`[chauffeur] /c erro: ${e.message}`); try { html(500, confirmar.paginaErro()); } catch { /* já respondido */ } });
    return true;
  }

  /** Lista e contagens para o painel. `dias` conta pela data de criação. */
  async function painel({ dias = 30 } = {}) {
    const s = await armazem();
    const reservas = await s.listar({ dias });
    const contar = (chave) => { const c = {}; for (const r of reservas) { const k = r[chave] || '—'; c[k] = (c[k] || 0) + 1; } return c; };
    const porDia = {}; for (const r of reservas) { const d = r.criado_em.slice(0, 10); porDia[d] = (porDia[d] || 0) + 1; }
    const resultados = contar('status');
    const viraram = (resultados.confirmado || 0) + (resultados.feito || 0);
    const semAviso = reservas.filter((r) => r.status === 'pedido' && !r.avisos.includes('nova_reserva')).length;
    const lacunas = [];
    if (!reservas.length) lacunas.push('Nenhum pedido no período: ou a página /ride ainda não está no ar, ou ninguém pediu.');
    if (s.aviso) lacunas.push(s.aviso);
    if (!cfgAviso.segredo) lacunas.push('ARIA_TEAM_ALERT_SECRET ausente na Central: o Julien não recebe o aviso de pedido novo.');
    if (semAviso) lacunas.push(`${semAviso} pedido(s) sem o aviso ao Julien registrado.`);
    if (!confirmar.link('WTD-R-AAAA', env)) lacunas.push('Sem CHAUFFEUR_CONFIRMA_URL (+ segredo): o aviso ao Julien sai sem o link de confirmar; o status é marcado aqui.');
    const cl = cliente.statusLinha(cliente.config(env));
    if (cl !== 'on') lacunas.push(`Mensagens ao cliente: ${cl}. Confirmação e lembretes não saem.`);
    return {
      gerado_em: new Date(agora()).toISOString(), dias: Number(dias) || 30, modo: s.modo, total_historico: await s.total(),
      total: reservas.length, viraram_corrida: viraram, taxa_conversao_pct: reservas.length ? Math.round((viraram / reservas.length) * 100) : 0,
      valor_confirmado_cent: reservas.filter((r) => r.status === 'confirmado' || r.status === 'feito').reduce((a, r) => a + (r.valor_cent || 0), 0),
      por_origem: Object.fromEntries(Object.entries(contar('origem')).map(([k, v]) => [ORIGENS[k] || k, v])),
      por_produto: Object.fromEntries(Object.entries(contar('produto')).map(([k, v]) => [PRODUTO_NOME[k] || k, v])),
      por_dia: Object.entries(porDia).sort().map(([dia, n]) => ({ dia, n })),
      por_resultado: resultados,
      // o painel fica atrás da chave; o WhatsApp vai mascarado e o número inteiro só na ficha da reserva
      pedidos: reservas.slice(0, 500).map((r) => ({ ...r, whatsapp: undefined })),
      origens: ORIGENS, resultados_possiveis: RESULTADOS, lacunas,
    };
  }

  function links() {
    const base = env.CHAUFFEUR_PAGINA || PAGINA;
    return { pagina: base, links: Object.entries(ORIGENS).filter(([k]) => k !== 'R').map(([k, nome]) => ({ origem: k, rede: nome, url: `${base}?o=${k}`, uso: k === 'H' ? 'cartão e QR entregues aos hotéis' : k === 'S' ? 'botões do site theworldkeys.com' : `link na bio do @wantedchauffeur no ${nome}` })) };
  }

  /** Rotas PÚBLICAS (antes da chave): o POST da reserva e o POST do lead antigo. Devolve true se tratou. */
  function tratarPublico(req, res, u, json) {
    if (tratarConfirmacao(req, res, u)) return true;
    const rota = u.pathname === '/api/chauffeur/reserva' ? 'reserva' : u.pathname === '/api/chauffeur/lead' ? 'lead' : null;
    if (!rota) return false;
    const permitido = cors(req, res);
    if (req.method === 'OPTIONS') { res.writeHead(permitido ? 204 : 403); res.end(); return true; }
    if (req.method !== 'POST') { json(res, 405, { error: 'POST' }); return true; }
    if (!permitido) { json(res, 403, { error: 'origem não permitida' }); return true; }
    const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
    if (excedeuTeto(ip)) { json(res, 429, { error: 'muitos pedidos deste endereço; tente mais tarde' }); return true; }
    lerCorpo(req, 4_000).then(async (corpo) => {
      if (!corpo) return json(res, 400, { error: 'JSON inválido' });
      const v = reservasMod.validar(corpo, { exigirPessoa: rota === 'reserva' });
      if (v.erro) return json(res, 400, { error: v.erro });
      try {
        const s = await armazem();
        const r = await s.criar(v.reserva);
        json(res, r.status, { ok: true, codigo: r.codigo, repetido: !!r.repetido });
        if (r.status === 201 && rota === 'reserva') avisarNova(v.reserva).catch(() => {});
      } catch (e) { log(`[chauffeur] gravação falhou: ${e.message}`); json(res, 500, { error: 'não foi possível gravar a reserva' }); }
    });
    return true;
  }

  /** Rotas COM chave da Central (o servidor já conferiu). Devolve true se tratou. */
  function tratar(req, res, u, json) {
    if (!u.pathname.startsWith('/api/chauffeur')) return false;
    (async () => {
      if (u.pathname === '/api/chauffeur/leads' && req.method === 'GET') return json(res, 200, await painel({ dias: u.searchParams.get('dias') || 30 }));
      if (u.pathname === '/api/chauffeur/links' && req.method === 'GET') return json(res, 200, links());
      const m = /^\/api\/chauffeur\/reserva\/([A-Z0-9-]{10,12})$/i.exec(u.pathname);
      if (m && req.method === 'GET') {
        const codigo = m[1].toUpperCase();
        if (!RE_CODIGO.test(codigo)) return json(res, 400, { error: 'codigo no formato WTD-<letra>-XXXX' });
        const r = await (await armazem()).obter(codigo);
        return r ? json(res, 200, r) : json(res, 404, { error: `${codigo} não está nas reservas` });
      }
      if (u.pathname === '/api/chauffeur/lead/resultado' && req.method === 'POST') {
        const corpo = await lerCorpo(req, 4_000);
        if (!corpo) return json(res, 400, { error: 'JSON inválido' });
        const r = await mudarStatus({ codigo: corpo.codigo, status: corpo.resultado, nota: corpo.nota, por: corpo.por || 'painel' });
        return json(res, r.status, r);
      }
      json(res, 404, { error: 'rota desconhecida em /api/chauffeur' });
    })().catch((e) => { log(`[chauffeur] erro: ${e.message}`); try { json(res, 500, { error: 'erro interno' }); } catch { /* resposta já enviada */ } });
    return true;
  }

  /** Para o /health: onde as reservas estão e se o aviso ao Julien pode sair. */
  function saude() {
    return {
      reservas: store ? store.modo + (store.aviso ? ` (${store.aviso})` : '') : 'abrindo',
      aviso_julien: cfgAviso.segredo ? `on (${cfgAviso.julien})` : 'off (sem ARIA_TEAM_ALERT_SECRET)', pendente_min: cfgAviso.pendenteMin,
      link_confirmar: confirmar.link('WTD-R-AAAA', env) ? 'on' : 'off (sem CHAUFFEUR_CONFIRMA_URL ou segredo)',
      cliente: cliente.statusLinha(cliente.config(env)),
    };
  }

  return { tratarPublico, tratar, painel, links, saude, armazem, avisarNova, mudarStatus, ORIGENS, PRODUTOS, RESULTADOS };
}

module.exports = { criar, ORIGENS, PRODUTOS, RE_CODIGO };
