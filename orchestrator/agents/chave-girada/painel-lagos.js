#!/usr/bin/env node
'use strict';
/**
 * Painel da Operação Lagos — uma página com o estado de cada casa.
 *
 *   node painel-lagos.js            → gera orchestrator/state/lagos/painel-lagos.html e resume no terminal
 *
 * DUAS CAMADAS, e a página diz qual é qual:
 *   · FOTOGRAFIA (gerada aqui, muda só quando este script roda): envio, entrega, devolução registrada,
 *     candidatura, conta, respostas a pedidos, pendências — vêm do ledger, do resultados.csv, da API do n8n
 *     e do banco por papel somente-leitura. Nada disso é alcançável de dentro de uma página publicada:
 *     exige credenciais que uma página nunca deve carregar.
 *   · AO VIVO (dentro da página publicada): respostas dos restaurantes e devoluções, lidas do Gmail do próprio
 *     leitor pela capacidade `mcp` (conector "Gmail", ferramenta search_threads), com atualização automática.
 *     Publicar com: capabilities {"mcp": {"servers": [{"server": "Gmail", "tools": ["search_threads"]}]}}
 *
 * O que não existe em lugar nenhum: ABERTURA (não há pixel) e CLIQUE NO BOTÃO PRINCIPAL (o botão vai direto
 * para /register; o /webhook/go só cobre os links do rodapé porque redireciona para /admin, a tela de login).
 */
const fs = require('node:fs');
const path = require('node:path');
const RAIZ = path.resolve(__dirname, '..', '..', '..');
const ST = path.join(RAIZ, 'orchestrator', 'state', 'lagos');
const LEDGER = path.join(RAIZ, 'orchestrator', 'state', 'envios-fundadores-2026-08.csv');
const CAMPANHA = 'lagos_sequencia_2026_09';
const N8N = 'https://theworldkeys-n8n.xis4ee.easypanel.host';
const GO_WF = 'HoFjhfqzPmCAkrnZ';

const lerCsv = (p) => { if (!fs.existsSync(p)) return []; const L = fs.readFileSync(p, 'utf8').split(/\r?\n/).filter(Boolean); const c = L[0].replace(/^﻿/, '').split(';'); return L.slice(1).map((l) => Object.fromEntries(l.split(';').map((v, i) => [c[i], (v || '').replace(/^"|"$/g, '')]))); };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function cliquesGo() {
  try {
    const env = Object.fromEntries(fs.readFileSync(path.join(RAIZ, 'Agente Gerenciador do Banco de Dados', 'twk-db-agent', '.env.n8n.local'), 'utf8').split(/[\r\n]+/).filter((l) => l && !l.startsWith('#')).map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
    const H = { 'X-N8N-API-KEY': env.N8N_API_KEY, accept: 'application/json' };
    const ex = await (await fetch(`${N8N}/api/v1/executions?workflowId=${GO_WF}&limit=100`, { headers: H })).json();
    const porCasa = {};
    for (const e of ex.data || []) {
      const full = await (await fetch(`${N8N}/api/v1/executions/${e.id}?includeData=true`, { headers: H })).json();
      const q = (JSON.stringify(full.data || {}).match(/"query":\{[^}]*\}/) || [])[0] || '';
      const rid = (q.match(/"rid":"(\d+)"/) || [])[1];
      const c = (q.match(/"c":"([^"]+)"/) || [])[1] || '?';
      if (!rid) continue;
      (porCasa[rid] = porCasa[rid] || []).push({ quando: e.startedAt, tipo: c });
    }
    return { ok: true, porCasa };
  } catch (e) { return { ok: false, erro: e.message, porCasa: {} }; }
}

async function doBanco(ids, slugs, desde) {
  const envp = path.join(RAIZ, 'Agente Gerenciador do Banco de Dados', 'twk-db-agent', '.env.readonly.local');
  const env = Object.fromEntries(fs.readFileSync(envp, 'utf8').split(/\r?\n/).filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')]; }));
  const { Client } = require(path.resolve(RAIZ, 'Agente Gerenciador do Banco de Dados', 'twk-db-agent', 'node_modules', 'pg'));
  const c = new Client({ connectionString: env.DATABASE_URL_RO, ssl: { rejectUnauthorized: false }, statement_timeout: 60000 });
  await c.connect();
  const q = async (sql, p) => (await c.query(sql, p)).rows;
  const convites = await q(`select public_listing_slug, restaurant_name, status, created_at::text, completed_at::text, expires_at::text from restaurant_invitations where public_listing_slug = ANY($1) or restaurant_name = ANY($2)`, [slugs, slugs]);
  const contas = await q(`select restaurant_id, count(*)::int n from restaurant_users where restaurant_id = ANY($1) group by 1`, [ids]);
  const respostas = await q(`select restaurant_id::text rid, count(*)::int n, max(created_date)::text ultimo from reservations where restaurant_id::text = ANY($1) and booking_status in ('Accept','Decline') and modified_by is not null and created_date >= $2 group by 1`, [ids, desde]);
  const vivas = await q(`select restaurant_id::text rid, count(*)::int n from reservations where restaurant_id::text = ANY($1) and expired_at is null and booking_status in ('Pending','In Treatment') group by 1`, [ids]);
  const novos = await q(`select restaurant_id::text rid, count(*)::int n from reservations where restaurant_id::text = ANY($1) and created_date >= $2 group by 1`, [ids, desde]);
  await c.end();
  return { convites, contas: Object.fromEntries(contas.map((r) => [String(r.restaurant_id), r.n])), respostas: Object.fromEntries(respostas.map((r) => [r.rid, r])), vivas: Object.fromEntries(vivas.map((r) => [r.rid, r.n])), novos: Object.fromEntries(novos.map((r) => [r.rid, r.n])) };
}

/* ---- runtime da página publicada: lê o Gmail do leitor pela capacidade mcp ----
   Escrito como função real (sem escapes) e injetado por toString(). Nunca assume window.claude.mcp:
   só `claude.use("mcp")`, e desenha tudo sem ele quando resolve null. */
function runtimeAoVivo(D) {
  const $ = (id) => document.getElementById(id);
  const estado = (txt, extra) => { const e = $('vivo-estado'); if (e) e.innerHTML = '<b>' + txt + '</b>' + (extra ? ' ' + extra : ''); };
  const dominio = (end) => String(end || '').split('@')[1] || '';
  const endOf = (q) => { const m = String(q || '').match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/); return m ? m[0].toLowerCase() : ''; };
  const casaDe = (quem) => { const e = endOf(quem); if (!e) return null; return D.casasPorEmail[e] || D.dominiosUnicos[dominio(e)] || null; };
  const quando = (iso) => { try { return new Date(iso).toLocaleString('pt-PT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); } catch (e) { return String(iso || '').slice(0, 16).replace('T', ' '); } };
  const ultimo = {};

  function pinta(secao, itens, carimbo) {
    const alvo = $(secao === 'respostas' ? 'lista-respostas' : 'lista-devolucoes');
    const cont = $(secao === 'respostas' ? 'n-respostas' : 'n-devolucoes');
    if (!alvo) return;
    if (cont) cont.textContent = String(itens.length);
    alvo.innerHTML = itens.length
      ? itens.map((i) => '<li><span class="casa">' + i.casa + '</span> <span class="quando">' + quando(i.data) + '</span><br><span class="assunto">' + i.assunto + '</span>' + (i.trecho ? '<br><span class="trecho">' + i.trecho + '</span>' : '') + '</li>').join('')
      : '<li class="vazio">nada até agora</li>';
    const c = $(secao === 'respostas' ? 'carimbo-respostas' : 'carimbo-devolucoes');
    if (c) c.textContent = carimbo ? 'lido às ' + quando(carimbo) : 'lido agora';
  }

  function porErro(secao, err) {
    const alvo = $(secao === 'respostas' ? 'lista-respostas' : 'lista-devolucoes');
    if (!alvo) return;
    const code = err && err.code;
    const retrata = code === 'needs_reauth' || code === 'server_not_connected' || code === 'blocked_by_policy' || code === 'approval_required' || code === 'not_in_manifest' || code === 'consent_required';
    const copy = {
      needs_reauth: 'A ligação ao Gmail expirou. Reconecte em claude.ai, Definições, Conectores.',
      server_not_connected: 'Não há conector Gmail nesta conta. Adicione em claude.ai, Definições, Conectores.',
      selection_required: 'Há mais de um Gmail ligado. Escolha um quando o aviso aparecer.',
      not_in_manifest: 'Esta vista não tem permissão para ler o Gmail.',
      consent_required: 'Falta autorizar o Gmail para esta página.',
      blocked_by_policy: 'A política da organização bloqueia esta leitura.',
      approval_required: 'Esta leitura precisa de aprovação da organização.',
      server_unavailable: 'Gmail indisponível por instantes. A última leitura fica visível.',
      rate_limited: 'Demasiados pedidos. A última leitura fica visível.',
    }[code] || 'Não foi possível ler o Gmail agora. A última leitura fica visível.';
    if (retrata || !ultimo[secao]) alvo.innerHTML = '<li class="erro">' + copy + '</li>';
    else { const c = $(secao === 'respostas' ? 'carimbo-respostas' : 'carimbo-devolucoes'); if (c) c.textContent = copy; }
  }

  function trata(secao, ev, filtro) {
    if (ev.type === 'error') { porErro(secao, ev.error); return; }
    const p = ev.result && ev.result.payload;
    const fios = (p && p.threads) || [];
    const itens = [];
    for (const fio of fios) {
      for (const m of fio.messages || []) {
        const it = filtro(m, fio);
        if (it) itens.push(it);
      }
    }
    itens.sort((a, b) => String(b.data).localeCompare(String(a.data)));
    ultimo[secao] = itens;
    pinta(secao, itens, ev.result && ev.result.cache && ev.result.cache.storedAt);
  }

  const filtroResposta = (m) => {
    const de = String(m.sender || '');
    const casa = casaDe(de);
    if (!casa) return null;
    return { casa: casa, data: m.date, assunto: String(m.subject || '(sem assunto)'), trecho: String(m.snippet || '').slice(0, 160) };
  };
  const filtroDevolucao = (m, fio) => {
    if (!/mailer-daemon/i.test(String(m.sender || ''))) return null;
    let casa = null;
    for (const x of fio.messages || []) { const alvo = (x.toRecipients || []).find((t) => casaDe(t)); if (alvo) { casa = casaDe(alvo); break; } }
    if (!casa) return null;
    return { casa: casa, data: m.date, assunto: 'devolvido pelo servidor', trecho: String(m.snippet || '').slice(0, 160) };
  };

  (async function ligar() {
    let mcp = null;
    try { mcp = window.claude && window.claude.use ? await window.claude.use('mcp') : null; } catch (e) { mcp = null; }
    if (!mcp) { estado('Sem leitura ao vivo nesta vista.', 'Os números abaixo são a fotografia de ' + D.geradoEm + ' UTC.'); return; }
    estado('Ao vivo pelo Gmail.', 'Atualiza sozinho a cada minuto. Os números da fotografia abaixo só mudam quando o painel é gerado de novo.');
    const btn = $('btn-atualizar');
    if (btn) {
      btn.hidden = false;
      btn.addEventListener('click', async () => {
        btn.disabled = true; btn.textContent = 'a ler…';
        try { await mcp.invalidate('Gmail', 'search_threads'); } catch (e) { /* nada em cache: segue */ }
        setTimeout(() => { btn.disabled = false; btn.textContent = 'Atualizar agora'; }, 2500);
      });
    }
    const opts = { refetchInterval: 60000 };
    try {
      mcp.watchTool('Gmail', 'search_threads', { query: 'in:inbox after:' + D.desdeGmail + ' -from:mailer-daemon', pageSize: 25 }, (ev) => trata('respostas', ev, filtroResposta), opts);
      mcp.watchTool('Gmail', 'search_threads', { query: 'from:mailer-daemon after:' + D.desdeGmail, pageSize: 25 }, (ev) => trata('devolucoes', ev, filtroDevolucao), opts);
    } catch (e) {
      estado('Sem leitura ao vivo nesta vista.', 'Os números abaixo são a fotografia de ' + D.geradoEm + ' UTC.');
    }
  })();
}

(async () => {
  const alvos = lerCsv(path.join(ST, 'alvos-lagos-2026-09-16.csv'));
  const resultados = Object.fromEntries(lerCsv(path.join(ST, 'emails', 'resultados.csv')).map((r) => [r.restaurant_id, r]));
  const ledger = fs.readFileSync(LEDGER, 'utf8').split(/\r?\n/).slice(1).filter(Boolean).map((l) => l.split(';')).filter((l) => l[2] === CAMPANHA && l[4] !== '0');
  const envios = {};
  for (const l of ledger) (envios[l[0]] = envios[l[0]] || []).push({ toque: l[3], quando: l[9], destino: l[6] });
  const desde = ledger.map((l) => l[9]).sort()[0] || '2026-09-17';
  const ids = alvos.map((a) => a.restaurant_id);
  const slugs = alvos.flatMap((a) => [a.slug, a.name]).filter(Boolean);
  const [go, banco] = await Promise.all([cliquesGo(), doBanco(ids, slugs, desde)]);
  const convitePorCasa = {};
  for (const cv of banco.convites) { const a = alvos.find((x) => x.slug === cv.public_listing_slug || x.name === cv.restaurant_name); if (a) convitePorCasa[a.restaurant_id] = cv; }

  // domínio do e-mail de cada casa → nome, para o bloco ao vivo casar remetente com casa
  const casasPorEmail = {};
  const porDominio = {};
  for (const a of alvos) {
    const e = String(a.email || '').trim().toLowerCase();
    if (!e.includes('@')) continue;
    casasPorEmail[e] = a.name;
    const d = e.split('@')[1];
    (porDominio[d] = porDominio[d] || []).push(a.name);
  }
  const dominiosUnicos = {};
  for (const [d, nomes] of Object.entries(porDominio)) if (nomes.length === 1) dominiosUnicos[d] = nomes[0];

  const linhas = alvos.map((a) => {
    const rid = a.restaurant_id;
    const env = envios[rid] || [];
    const res = resultados[rid] || {};
    const bounce = (res.resultado || '') === 'bounce';
    return {
      rid, nome: a.name, tier: a.tier, segmento: a.segmento, fora: a.tier.startsWith('X-'),
      enviado: env.map((e) => `${e.toque} ${e.quando}`).join(' · '),
      entrega: env.length ? (bounce ? 'devolvido' : 'entregue') : '—',
      motivo: bounce ? (res.nota || '') : '',
      cliques: (go.porCasa[rid] || []).map((c) => `${c.tipo} ${String(c.quando).slice(0, 16).replace('T', ' ')}`).join(' · '),
      resposta: (res.resultado || '') && !bounce ? res.resultado : '',
      convite: convitePorCasa[rid] ? `${convitePorCasa[rid].status} (${String(convitePorCasa[rid].created_at).slice(0, 10)})` : '',
      conta: banco.contas[rid] ? `${banco.contas[rid]} conta(s)` : '',
      respondeu: banco.respostas[rid] ? `${banco.respostas[rid].n} desde o envio` : '',
      novos: banco.novos[rid] || 0,
      vivas: banco.vivas[rid] || 0,
      p180: a.p180,
    };
  });

  const enviados = linhas.filter((l) => l.enviado).length;
  const devolvidos = linhas.filter((l) => l.entrega === 'devolvido').length;
  const entregues = enviados - devolvidos;
  const comResposta = linhas.filter((l) => l.resposta).length;
  const comClique = linhas.filter((l) => l.cliques).length;
  const candidaturas = linhas.filter((l) => l.convite).length;
  const contas = linhas.filter((l) => l.conta).length;
  const respondendo = linhas.filter((l) => l.respondeu).length;
  const cliquesForaDaLista = Object.keys(go.porCasa).filter((rid) => !ids.includes(rid)).length;
  const geradoEm = new Date().toISOString().replace('T', ' ').slice(0, 16);
  const dados = { casasPorEmail, dominiosUnicos, desdeGmail: desde.replace(/-/g, '/'), geradoEm };

  const chip = (t, k) => t ? `<span class="chip ${k}">${esc(t)}</span>` : '<span class="na">—</span>';
  const html = `<!DOCTYPE html><html lang="pt"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Painel · Operação Lagos</title>
<style>
:root{--ink:#f4f1ea;--surface:#fbf9f4;--surface-2:#ece7db;--border:#d6cfbf;--gold:#9e7c48;--text:#1d2029;--muted:#5f5d6e;--ok:#4f7a4f;--bleed:#a8463a;--sans:"Jost","Segoe UI",Helvetica,Arial,sans-serif;--serif:"Cormorant Garamond",Georgia,serif;color-scheme:light}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--ink:#070b10;--surface:#0f1218;--surface-2:#181c24;--border:#232838;--gold:#c9a96e;--text:#ede9df;--muted:#9a97a8;--ok:#86a985;--bleed:#c8695c;color-scheme:dark}}
:root[data-theme="dark"]{--ink:#070b10;--surface:#0f1218;--surface-2:#181c24;--border:#232838;--gold:#c9a96e;--text:#ede9df;--muted:#9a97a8;--ok:#86a985;--bleed:#c8695c;color-scheme:dark}
*{box-sizing:border-box}body{margin:0;background:var(--ink);color:var(--text);font-family:var(--sans);font-weight:300;padding-block:24px 40px;padding-inline:16px;font-size:15px}
.wrap{max-width:1180px;margin:0 auto}h1{font-family:var(--serif);font-weight:500;font-size:2.2rem;margin:0 0 4px;text-wrap:balance}
h2{font-family:var(--serif);font-weight:500;font-size:1.4rem;margin:0 0 2px}
.sub{color:var(--muted);font-size:13px;margin-bottom:20px}
.vivo{border:1px solid var(--gold);background:var(--surface);padding:14px 16px;margin-bottom:18px}
.vivo-topo{display:flex;flex-wrap:wrap;gap:8px 14px;align-items:baseline;justify-content:space-between}
#vivo-estado{font-size:13px;color:var(--muted)}#vivo-estado b{color:var(--gold);font-weight:500}
button{font-family:inherit;font-size:13px;padding:6px 14px;border:1px solid var(--gold);background:transparent;color:var(--gold);cursor:pointer;border-radius:2px}
button:disabled{opacity:.5;cursor:default}button:focus-visible{outline:2px solid var(--gold);outline-offset:2px}
.duas{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:18px;margin-top:12px}
.duas h3{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);font-weight:500;margin:0 0 6px;display:flex;justify-content:space-between;align-items:baseline}
.duas h3 b{font-family:var(--serif);font-size:1.4rem;color:var(--gold);font-weight:500}
.duas ul{list-style:none;padding:0;margin:0;font-size:13px}
.duas li{padding:7px 0;border-top:1px solid var(--border)}
.duas .casa{font-weight:500}.duas .quando{color:var(--muted);font-size:12px}.duas .assunto{color:var(--text)}.duas .trecho{color:var(--muted);font-size:12px}
.duas .vazio,.duas .erro{color:var(--muted)}.duas .erro{color:var(--bleed)}
.carimbo{font-size:11px;color:var(--muted);margin-top:6px}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:1px;background:var(--border);border:1px solid var(--border);margin-bottom:18px}
.tile{background:var(--surface);padding:12px 14px}.tile b{display:block;font-family:var(--serif);font-size:2rem;line-height:1;color:var(--gold)}.tile span{font-size:12px;color:var(--muted)}
.lacuna{border-left:2px solid var(--bleed);background:var(--surface);padding:10px 14px;margin:16px 0;font-size:14px}
.lacuna b{color:var(--bleed)}
.tbl{overflow-x:auto;border:1px solid var(--border)}table{border-collapse:collapse;width:100%;font-size:13px;background:var(--surface)}
th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--border);vertical-align:top}
th{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);font-weight:500;background:var(--surface-2);position:sticky;top:0}
td.num{text-align:right;font-variant-numeric:tabular-nums}
.chip{display:inline-block;padding:1px 7px;border-radius:2px;font-size:12px;border:1px solid var(--border)}
.chip.ok{color:var(--ok);border-color:var(--ok)}.chip.bad{color:var(--bleed);border-color:var(--bleed)}.chip.warn{color:var(--gold);border-color:var(--gold)}
.na{color:var(--muted)}tr.fora td{opacity:.5}
footer{margin-top:20px;font-size:12px;color:var(--muted)}
</style></head><body><div class="wrap">
<h1>Operação Lagos · painel</h1>
<div class="sub">Campanha <code>${CAMPANHA}</code> · 25 casas · primeiro toque em ${esc(desde)}. Nenhum número é estimado.</div>

<section class="vivo">
  <div class="vivo-topo">
    <div><h2>Respostas e devoluções</h2><div id="vivo-estado">a ligar ao Gmail…</div></div>
    <button id="btn-atualizar" type="button" hidden>Atualizar agora</button>
  </div>
  <div class="duas">
    <div>
      <h3>Respostas das casas <b id="n-respostas">—</b></h3>
      <ul id="lista-respostas"><li class="vazio">a carregar…</li></ul>
      <div class="carimbo" id="carimbo-respostas"></div>
    </div>
    <div>
      <h3>Devoluções <b id="n-devolucoes">—</b></h3>
      <ul id="lista-devolucoes"><li class="vazio">a carregar…</li></ul>
      <div class="carimbo" id="carimbo-devolucoes"></div>
    </div>
  </div>
</section>

<h2>Fotografia de ${esc(geradoEm)} UTC</h2>
<div class="sub">Estes números vêm do ledger, da API do n8n e do banco por papel somente-leitura. Uma página publicada não alcança nenhum dos três, porque exigiria carregar credenciais. Mudam quando o painel é gerado de novo.</div>
<div class="tiles">
  <div class="tile"><b>${enviados}</b><span>e-mails enviados</span></div>
  <div class="tile"><b>${entregues}</b><span>entregues</span></div>
  <div class="tile"><b>${devolvidos}</b><span>devolvidos</span></div>
  <div class="tile"><b>${comClique}</b><span>casas com clique no rodapé</span></div>
  <div class="tile"><b>${comResposta}</b><span>respostas registadas</span></div>
  <div class="tile"><b>${candidaturas}</b><span>candidaturas</span></div>
  <div class="tile"><b>${contas}</b><span>contas criadas</span></div>
  <div class="tile"><b>${respondendo}</b><span>passaram a responder pedidos</span></div>
</div>
<div class="lacuna"><b>O que não é medido</b> — e por isso aparece como traço, nunca como zero:<br>
· <b>Abertura</b>: não existe pixel em nenhum e-mail da plataforma. Não sabemos quem abriu, e nunca soubemos.<br>
· <b>Clique no botão principal</b>: o botão aponta direto para <code>/register</code>. O rastreador <code>/webhook/go</code> só cobre os dois links do rodapé, porque ele redireciona para <code>/admin</code>, que é a tela de login, e não serviria de destino para o botão. Correção proposta ao fundador: fazer o <code>/go</code> aceitar o destino, e passar o botão do T2 por ele.</div>
<div class="tbl"><table>
<thead><tr><th>Casa</th><th>Segmento</th><th class="num">Pedidos 180d</th><th>Enviado</th><th>Entrega</th><th>Clique rodapé</th><th>Resposta</th><th>Candidatura</th><th>Conta</th><th>Respondeu pedidos</th><th class="num">Novos pedidos</th><th class="num">Pendências vivas</th></tr></thead>
<tbody>
${linhas.map((l) => `<tr class="${l.fora ? 'fora' : ''}">
  <td><b>${esc(l.nome)}</b>${l.motivo ? `<br><span class="na">${esc(l.motivo)}</span>` : ''}</td>
  <td><span class="na">${esc(l.segmento)}</span></td>
  <td class="num">${esc(l.p180)}</td>
  <td>${l.fora ? '<span class="na">fora de contato</span>' : esc(l.enviado) || '<span class="na">—</span>'}</td>
  <td>${l.entrega === 'entregue' ? chip('entregue', 'ok') : l.entrega === 'devolvido' ? chip('devolvido', 'bad') : '<span class="na">—</span>'}</td>
  <td>${l.cliques ? chip(l.cliques, 'warn') : '<span class="na">—</span>'}</td>
  <td>${l.resposta ? chip(l.resposta, 'ok') : '<span class="na">—</span>'}</td>
  <td>${l.convite ? chip(l.convite, 'ok') : '<span class="na">—</span>'}</td>
  <td>${l.conta ? chip(l.conta, 'ok') : '<span class="na">—</span>'}</td>
  <td>${l.respondeu ? chip(l.respondeu, 'ok') : '<span class="na">—</span>'}</td>
  <td class="num">${l.novos || '<span class="na">—</span>'}</td>
  <td class="num">${l.vivas || '<span class="na">—</span>'}</td>
</tr>`).join('\n')}
</tbody></table></div>
<footer>Cliques do rodapé: ${go.ok ? `lidos da API do n8n · ${comClique} casa(s) desta lista${cliquesForaDaLista ? ` (há ainda ${cliquesForaDaLista} registo(s) de campanhas anteriores, de casas fora de Lagos)` : ''}` : 'INDISPONÍVEL — ' + esc(go.erro)} · "Respondeu pedidos" conta respostas em nome próprio a pedidos de mesa desde ${esc(desde)}: é o sinal mais forte de que o e-mail funcionou, mesmo sem conta criada. Gerar de novo: <code>node orchestrator/agents/chave-girada/painel-lagos.js</code></footer>
</div>
<script>
const DADOS = ${JSON.stringify(dados)};
(${runtimeAoVivo.toString()})(DADOS);
</script>
</body></html>`;
  fs.writeFileSync(path.join(ST, 'painel-lagos.html'), html);
  console.log(`enviados ${enviados} · entregues ${entregues} · devolvidos ${devolvidos} · cliques ${comClique} · respostas ${comResposta} · candidaturas ${candidaturas} · contas ${contas} · passaram a responder ${respondendo}`);
  console.log(`cliques no rodapé: ${comClique} casa(s) desta lista${cliquesForaDaLista ? ` · ${cliquesForaDaLista} registo(s) de campanhas anteriores (fora da lista)` : ''}`);
  console.log(`bloco ao vivo: ${Object.keys(casasPorEmail).length} endereço(s) + ${Object.keys(dominiosUnicos).length} domínio(s) exclusivo(s) · janela do Gmail a partir de ${dados.desdeGmail}`);
  console.log(`painel: orchestrator/state/lagos/painel-lagos.html`);
})().catch((e) => { console.error('ERRO', e.message); process.exit(1); });
