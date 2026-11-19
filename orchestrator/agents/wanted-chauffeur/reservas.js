'use strict';
/**
 * Reservas do Wanted Chauffeur — o único lugar onde a reserva mora (Fase 1, 19/11/2026).
 *
 * Até 18/11 a Central guardava só o pedido sem a pessoa (código, origem, produto) e a pessoa ficava numa planilha do
 * Google. Agora a reserva inteira fica aqui: quem embarca, o WhatsApp, partida, destino, recado, consentimento de
 * imagem, valor em centavos e a linha do tempo de status. A planilha vira exportação, não fonte.
 *
 * Dois modos, a mesma interface (todos os métodos são async):
 *   banco   — Postgres da plataforma (twk_auth), papel twk_dba, tabelas chauffeur_reservas / _eventos / _nao_contatar
 *             (DDL em orchestrator/agents/dba-escrita/exemplos/chauffeur-reservas.sql — exige a frase do fundador).
 *   arquivo — <dir>/reservas.jsonl, <dir>/reservas-eventos.jsonl, <dir>/nao-contatar.jsonl no volume da Central.
 *             É o modo em vigor até as tabelas existirem; `migrar.js` passa tudo para o banco sem perder linha.
 *
 * Regras: código WTD-<origem>-XXXX é a chave e vai na mensagem do WhatsApp; status só muda por evento (append-only,
 * o último vale); dinheiro em centavos, nunca em float; telefone normalizado em formato internacional (+33…);
 * dado pessoal apaga 365 dias depois da corrida (`anonimizar`), o código e os números ficam.
 */
const fs = require('node:fs');
const path = require('node:path');

const ORIGENS = { T: 'TikTok', I: 'Instagram', Y: 'YouTube', W: 'Twitch', H: 'Hotel', S: 'Site', R: 'Direto' };
const PRODUTOS = ['transfer', 'mad', 'night', 'game', 'soiree'];
const PRODUTO_NOME = { transfer: 'Transfer', mad: 'Mise à disposition', night: 'Night Ride', game: 'Game Night', soiree: 'Soirée' };
/** Tabela aprovada pelo fundador em 16/11/2026, em centavos de euro, por carro. MAD é por hora (mínimo 2 h). */
const PRECO_CENT = { transfer: 8000, mad: 9000, night: 25000, game: 35000, soiree: 39000 };
const STATUS = ['pedido', 'orcado', 'confirmado', 'feito', 'perdido', 'cancelado'];
const STATUS_FINAL = ['feito', 'perdido', 'cancelado'];
const RE_CODIGO = /^WTD-([TIYWHSR])-([ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4})$/;
const RE_DATA = /^\d{4}-\d{2}-\d{2}$/;
const RE_HORA = /^(1[0-2]|[1-9]):[0-5][05] (AM|PM)$/; // sempre AM/PM, passos de 5 min (decisão do fundador, 05/11)
const RE_TELEFONE_EM_TEXTO = /\+?\d[\d .-]{7,}\d/;

const limpar = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

/** Telefone → formato internacional. "06 12 34 56 78" vira +33612345678 (padrão francês); "0033…" vira "+33…". */
function normalizarWhatsapp(v) {
  let s = String(v || '').replace(/\(0\)/g, '').replace(/[\s().-]/g, ''); // "+33 (0)6…": o (0) é o zero nacional, cai
  if (!s) return null;
  if (s.startsWith('00')) s = '+' + s.slice(2);
  if (/^0\d{9}$/.test(s)) s = '+33' + s.slice(1);
  if (!/^\+\d{8,15}$/.test(s)) return { erro: 'WhatsApp em formato internacional, ex.: +33 6 12 34 56 78' };
  return s;
}

function valorCent(produto, horas) {
  if (produto === 'mad') return PRECO_CENT.mad * Math.max(2, Number(horas) || 2);
  return PRECO_CENT[produto];
}

/**
 * Valida o corpo vindo da página. Qualquer campo fora da lista é descartado.
 * `exigirPessoa`: a rota /reserva exige o nome de quem embarca; a rota antiga /lead (sem PII) não.
 */
function validar(corpo, { exigirPessoa = false } = {}) {
  if (!corpo || typeof corpo !== 'object') return { erro: 'corpo inválido' };
  const codigo = limpar(corpo.codigo, 12).toUpperCase();
  const m = RE_CODIGO.exec(codigo);
  if (!m) return { erro: 'codigo no formato WTD-<T|I|Y|W|H|S|R>-XXXX' };
  const produto = limpar(corpo.produto, 12).toLowerCase();
  if (!PRODUTOS.includes(produto)) return { erro: `produto: ${PRODUTOS.join(', ')}` };
  const data = corpo.data ? limpar(corpo.data, 10) : null;
  if (data && !RE_DATA.test(data)) return { erro: 'data AAAA-MM-DD' };
  const hora = corpo.hora ? limpar(corpo.hora, 8).toUpperCase() : null;
  if (hora && !RE_HORA.test(hora)) return { erro: 'hora em AM/PM, passos de 5 min (ex.: 9:00 PM)' };
  const pessoas = corpo.pessoas == null || corpo.pessoas === '' ? null : Number(corpo.pessoas);
  if (pessoas != null && !(Number.isInteger(pessoas) && pessoas >= 1 && pessoas <= 6)) return { erro: 'pessoas de 1 a 6' };
  const horas = corpo.horas == null || corpo.horas === '' ? null : Number(corpo.horas);
  if (horas != null && !(Number.isInteger(horas) && horas >= 2 && horas <= 12)) return { erro: 'horas de 2 a 12' };
  const idioma = /^(fr|en|pt)$/.test(String(corpo.idioma || '')) ? String(corpo.idioma) : null;
  const imagens = corpo.imagens === true || corpo.imagens === 'ok' ? 'ok' : 'privadas';

  const nome = limpar(corpo.nome, 80);
  if (nome && RE_TELEFONE_EM_TEXTO.test(nome)) return { erro: 'o nome não pode ter telefone' };
  if (exigirPessoa && (nome.length < 2 || !/\p{L}/u.test(nome))) return { erro: 'nome de quem embarca (2 a 80 letras)' };
  let whatsapp = null;
  if (corpo.whatsapp) { const w = normalizarWhatsapp(corpo.whatsapp); if (w && w.erro) return { erro: w.erro }; whatsapp = w; }
  const partida = limpar(corpo.partida, 120) || null;
  const destino = limpar(corpo.destino, 120) || null;
  const recado = limpar(corpo.recado, 300) || null;

  return {
    reserva: {
      codigo, origem: m[1], produto, data, hora, pessoas, horas: produto === 'mad' ? (horas || 2) : null, idioma, imagens,
      nome: nome || null, whatsapp, partida, destino, recado,
      valor_cent: valorCent(produto, horas), moeda: 'EUR',
    },
  };
}

function validarEvento(corpo) {
  const codigo = limpar(corpo && corpo.codigo, 12).toUpperCase();
  if (!RE_CODIGO.test(codigo)) return { erro: 'codigo no formato WTD-<letra>-XXXX' };
  const tipo = corpo.tipo === 'aviso' ? 'aviso' : 'status';
  const valor = limpar(corpo.valor != null ? corpo.valor : corpo.status, 24).toLowerCase();
  if (tipo === 'status' && !STATUS.includes(valor)) return { erro: `status: ${STATUS.join(', ')}` };
  if (tipo === 'aviso' && !/^[a-z_]{3,24}$/.test(valor)) return { erro: 'aviso: identificador curto (ex.: nova_reserva, pendente)' };
  const nota = corpo.nota ? limpar(corpo.nota, 200) : null;
  if (nota && RE_TELEFONE_EM_TEXTO.test(nota)) return { erro: 'a nota não pode ter telefone' };
  const por = corpo.por ? limpar(corpo.por, 40) : null;
  return { evento: { codigo, tipo, valor, nota, por } };
}

/** Enriquece para o painel: nomes legíveis, status atual, valor em euros (inteiro, só para exibir). */
function apresentar(r, eventos) {
  const st = eventos.filter((e) => e.tipo === 'status').sort((a, b) => (a.em < b.em ? -1 : 1));
  const ultimo = st[st.length - 1];
  const avisos = eventos.filter((e) => e.tipo === 'aviso').map((e) => e.valor);
  return {
    ...r,
    origem_nome: ORIGENS[r.origem] || r.origem, produto_nome: PRODUTO_NOME[r.produto] || r.produto,
    valor_eur: Math.round((r.valor_cent || 0) / 100),
    status: ultimo ? ultimo.valor : 'pedido', status_em: ultimo ? ultimo.em : r.criado_em,
    avisos,
    whatsapp_mascarado: r.whatsapp ? r.whatsapp.slice(0, 3) + '…' + r.whatsapp.slice(-4) : null,
  };
}

const minutosDe = (h) => { const m = RE_HORA.exec(h || ''); if (!m) return 9e9; let hh = Number(m[1]) % 12; if (m[2] === 'PM') hh += 12; return hh * 60 + Number(h.slice(h.indexOf(':') + 1, h.indexOf(':') + 3)); };

// ------------------------------------------------------------------------------------------------ modo arquivo
function abrirArquivo({ dir, agora = () => Date.now() }) {
  const arqR = path.join(dir, 'reservas.jsonl');
  const arqE = path.join(dir, 'reservas-eventos.jsonl');
  const arqN = path.join(dir, 'nao-contatar.jsonl');
  const ler = (f) => { try { return fs.readFileSync(f, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; } };
  const anexar = (f, o) => { fs.mkdirSync(dir, { recursive: true }); fs.appendFileSync(f, JSON.stringify(o) + '\n', 'utf8'); };
  const iso = () => new Date(agora()).toISOString();
  const eventosDe = (codigo, todos) => (todos || ler(arqE)).filter((e) => e.codigo === codigo);

  async function criar(reserva) {
    if (ler(arqR).some((r) => r.codigo === reserva.codigo)) return { status: 200, ok: true, codigo: reserva.codigo, repetido: true };
    anexar(arqR, { ...reserva, criado_em: iso() });
    return { status: 201, ok: true, codigo: reserva.codigo };
  }
  async function obter(codigo) {
    const r = ler(arqR).find((x) => x.codigo === codigo);
    return r ? apresentar(r, eventosDe(codigo)) : null;
  }
  async function evento(ev) {
    if (!ler(arqR).some((r) => r.codigo === ev.codigo)) return { status: 404, erro: `${ev.codigo} não está nas reservas` };
    const e = { ...ev, em: iso() };
    anexar(arqE, e);
    return { status: 200, ok: true, ...e };
  }
  async function listar({ dias = 30 } = {}) {
    const limite = agora() - Math.max(1, Math.min(365, Number(dias) || 30)) * 86_400_000;
    const evs = ler(arqE);
    return ler(arqR).filter((r) => Date.parse(r.criado_em) >= limite).map((r) => apresentar(r, eventosDe(r.codigo, evs))).sort((a, b) => (a.criado_em < b.criado_em ? 1 : -1));
  }
  async function total() { return ler(arqR).length; }
  async function doDia(dia) {
    const evs = ler(arqE);
    return ler(arqR).filter((r) => r.data === dia).map((r) => apresentar(r, eventosDe(r.codigo, evs))).sort((a, b) => minutosDe(a.hora) - minutosDe(b.hora));
  }
  /** Reservas ainda em `pedido`, criadas há mais de `minutos`, sem o aviso `pendente` registrado. */
  async function pendentes(minutos) {
    const evs = ler(arqE);
    return ler(arqR).map((r) => apresentar(r, eventosDe(r.codigo, evs)))
      .filter((r) => r.status === 'pedido' && agora() - Date.parse(r.criado_em) >= minutos * 60_000 && !r.avisos.includes('pendente'));
  }
  /** Apaga nome, WhatsApp, partida, destino e recado das reservas encerradas (ou com data) há mais de `dias`. */
  async function anonimizar(dias = 365) {
    const limite = agora() - dias * 86_400_000;
    const evs = ler(arqE); let n = 0;
    const novas = ler(arqR).map((r) => {
      const a = apresentar(r, eventosDe(r.codigo, evs));
      const ref = Date.parse((r.data || r.criado_em.slice(0, 10)) + 'T23:59:59Z');
      const temPii = r.nome || r.whatsapp || r.partida || r.destino || r.recado;
      if (!temPii || ref > limite || !(STATUS_FINAL.includes(a.status) || ref < limite - 30 * 86_400_000)) return r;
      n++; return { ...r, nome: null, whatsapp: null, partida: null, destino: null, recado: null, anonimizado_em: iso() };
    });
    if (n) fs.writeFileSync(arqR, novas.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
    return { anonimizadas: n };
  }
  const naoContatar = {
    async listar() { return ler(arqN); },
    async adicionar({ whatsapp, nome, motivo, por }) {
      const w = whatsapp ? normalizarWhatsapp(whatsapp) : null;
      if (w && w.erro) return { status: 400, erro: w.erro };
      if (!w && !limpar(nome, 80)) return { status: 400, erro: 'informe o WhatsApp ou o nome' };
      const item = { whatsapp: w, nome: limpar(nome, 80) || null, motivo: limpar(motivo, 120) || null, por: limpar(por, 40) || null, em: iso() };
      anexar(arqN, item);
      return { status: 201, ok: true, ...item };
    },
    async bloqueado({ whatsapp, nome }) {
      const w = whatsapp ? normalizarWhatsapp(whatsapp) : null; const nm = limpar(nome, 80).toLowerCase();
      return ler(arqN).some((x) => (w && !w.erro && x.whatsapp === w) || (nm && x.nome && x.nome.toLowerCase() === nm));
    },
  };
  /** Plano B de 18/11: importa chauffeur-leads.jsonl (+ resultados) da raiz do STATE_DIR, uma vez. */
  async function importarLeadsAntigos(arqLeads, arqResultados) {
    const marca = path.join(dir, '.leads-antigos-importados');
    if (fs.existsSync(marca)) return { importados: 0, ja: true };
    const leads = ler(arqLeads); let n = 0;
    for (const l of leads) {
      const v = validar({ ...l });
      if (v.erro) continue;
      const r = await criar({ ...v.reserva, nome: null, whatsapp: null });
      if (r.status === 201) n++;
      // preserva a data original do pedido
      if (r.status === 201 && l.criado_em) { const todas = ler(arqR); const i = todas.findIndex((x) => x.codigo === v.reserva.codigo); if (i >= 0) { todas[i].criado_em = l.criado_em; fs.writeFileSync(arqR, todas.map((x) => JSON.stringify(x)).join('\n') + '\n', 'utf8'); } }
    }
    for (const e of ler(arqResultados)) { const v = validarEvento({ codigo: e.codigo, status: e.resultado, nota: e.nota, por: 'importacao' }); if (!v.erro) anexar(arqE, { ...v.evento, em: e.em || iso() }); }
    if (leads.length) { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(marca, iso(), 'utf8'); }
    return { importados: n };
  }
  return { modo: 'arquivo', dir, criar, obter, evento, listar, total, doDia, pendentes, anonimizar, naoContatar, importarLeadsAntigos, arquivos: { reservas: arqR, eventos: arqE, naoContatar: arqN } };
}

// ------------------------------------------------------------------------------------------------ modo banco
function carregarPg() {
  const RAIZ = path.resolve(__dirname, '..', '..', '..');
  for (const t of [() => require('pg'), () => require(path.join(RAIZ, 'orchestrator', 'command-center', 'node_modules', 'pg')), () => require(path.join(RAIZ, 'Agente Gerenciador do Banco de Dados', 'twk-db-agent', 'node_modules', 'pg'))]) { try { return t(); } catch { /* próximo */ } }
  throw new Error('biblioteca pg não encontrada');
}

async function abrirBanco({ url, agora = () => Date.now(), pool: poolDado }) {
  const pool = poolDado || new (carregarPg().Pool)({ connectionString: url, ssl: { rejectUnauthorized: false }, max: 3, connectionTimeoutMillis: 15_000, statement_timeout: 20_000 });
  const q = (sql, p) => pool.query(sql, p);
  const existe = await q("select to_regclass('public.chauffeur_reservas') r, to_regclass('public.chauffeur_reservas_eventos') e, to_regclass('public.chauffeur_nao_contatar') n");
  const t = existe.rows[0];
  if (!t.r || !t.e || !t.n) throw new Error('tabelas chauffeur_reservas / _eventos / _nao_contatar ausentes: rodar a DDL pela porta única (exige a frase do fundador)');
  const COLS = ['codigo', 'origem', 'produto', 'data', 'hora', 'pessoas', 'horas', 'idioma', 'imagens', 'nome', 'whatsapp', 'partida', 'destino', 'recado', 'valor_cent', 'moeda'];
  const linha = (r) => ({ ...r, data: r.data ? (r.data instanceof Date ? r.data.toISOString().slice(0, 10) : String(r.data)) : null, criado_em: r.criado_em instanceof Date ? r.criado_em.toISOString() : r.criado_em, valor_cent: Number(r.valor_cent) });
  const ev = (e) => ({ ...e, em: e.em instanceof Date ? e.em.toISOString() : e.em });
  const eventosDe = async (codigos) => { if (!codigos.length) return []; const r = await q('select codigo, tipo, valor, nota, por, em from public.chauffeur_reservas_eventos where codigo = any($1) order by em', [codigos]); return r.rows.map(ev); };
  const montar = async (rows) => { const evs = await eventosDe(rows.map((r) => r.codigo)); return rows.map((r) => apresentar(linha(r), evs.filter((e) => e.codigo === r.codigo))); };

  async function criar(reserva) {
    const r = await q(`insert into public.chauffeur_reservas (${COLS.join(',')}) values (${COLS.map((_, i) => '$' + (i + 1)).join(',')}) on conflict (codigo) do nothing returning codigo`, COLS.map((c) => reserva[c] == null ? null : reserva[c]));
    return r.rowCount ? { status: 201, ok: true, codigo: reserva.codigo } : { status: 200, ok: true, codigo: reserva.codigo, repetido: true };
  }
  async function obter(codigo) { const r = await q('select * from public.chauffeur_reservas where codigo = $1', [codigo]); return r.rowCount ? (await montar(r.rows))[0] : null; }
  async function evento(e) {
    const ok = await q('select 1 from public.chauffeur_reservas where codigo = $1', [e.codigo]);
    if (!ok.rowCount) return { status: 404, erro: `${e.codigo} não está nas reservas` };
    const r = await q('insert into public.chauffeur_reservas_eventos (codigo, tipo, valor, nota, por) values ($1,$2,$3,$4,$5) returning em', [e.codigo, e.tipo, e.valor, e.nota, e.por]);
    return { status: 200, ok: true, ...e, em: r.rows[0].em.toISOString() };
  }
  async function listar({ dias = 30 } = {}) { const r = await q('select * from public.chauffeur_reservas where criado_em >= now() - ($1 || \' days\')::interval order by criado_em desc', [String(Math.max(1, Math.min(365, Number(dias) || 30)))]); return montar(r.rows); }
  async function total() { const r = await q('select count(*)::int n from public.chauffeur_reservas'); return r.rows[0].n; }
  async function doDia(dia) { const r = await q('select * from public.chauffeur_reservas where data = $1', [dia]); return (await montar(r.rows)).sort((a, b) => minutosDe(a.hora) - minutosDe(b.hora)); }
  async function pendentes(minutos) { const r = await q('select * from public.chauffeur_reservas where criado_em <= now() - ($1 || \' minutes\')::interval order by criado_em', [String(minutos)]); return (await montar(r.rows)).filter((x) => x.status === 'pedido' && !x.avisos.includes('pendente')); }
  async function anonimizar(dias = 365) {
    const r = await q(`update public.chauffeur_reservas r set nome = null, whatsapp = null, partida = null, destino = null, recado = null, anonimizado_em = now()
      where anonimizado_em is null and (nome is not null or whatsapp is not null or partida is not null or destino is not null or recado is not null)
        and coalesce(r.data, r.criado_em::date) < current_date - $1::int
        and (coalesce((select e.valor from public.chauffeur_reservas_eventos e where e.codigo = r.codigo and e.tipo = 'status' order by em desc limit 1), 'pedido') in ('feito','perdido','cancelado')
             or coalesce(r.data, r.criado_em::date) < current_date - ($1::int + 30))`, [dias]);
    return { anonimizadas: r.rowCount };
  }
  const naoContatar = {
    async listar() { const r = await q('select whatsapp, nome, motivo, por, em from public.chauffeur_nao_contatar order by em'); return r.rows.map(ev); },
    async adicionar({ whatsapp, nome, motivo, por }) {
      const w = whatsapp ? normalizarWhatsapp(whatsapp) : null;
      if (w && w.erro) return { status: 400, erro: w.erro };
      if (!w && !limpar(nome, 80)) return { status: 400, erro: 'informe o WhatsApp ou o nome' };
      const r = await q('insert into public.chauffeur_nao_contatar (whatsapp, nome, motivo, por) values ($1,$2,$3,$4) returning em', [w, limpar(nome, 80) || null, limpar(motivo, 120) || null, limpar(por, 40) || null]);
      return { status: 201, ok: true, whatsapp: w, nome: limpar(nome, 80) || null, em: r.rows[0].em.toISOString() };
    },
    async bloqueado({ whatsapp, nome }) {
      const w = whatsapp ? normalizarWhatsapp(whatsapp) : null; const nm = limpar(nome, 80);
      const r = await q('select 1 from public.chauffeur_nao_contatar where ($1::text is not null and whatsapp = $1) or ($2::text <> \'\' and lower(nome) = lower($2)) limit 1', [w && !w.erro ? w : null, nm]);
      return r.rowCount > 0;
    },
  };
  return { modo: 'banco', criar, obter, evento, listar, total, doDia, pendentes, anonimizar, naoContatar, fechar: () => pool.end() };
}

/**
 * Abre o armazém: banco quando CHAUFFEUR_RESERVAS_BANCO=on e TWK_DBA_URL existir (e as tabelas também); senão arquivo.
 * Nunca falha em silêncio: devolve `aviso` com o motivo de ter ficado no arquivo, para o /health e o log mostrarem.
 */
async function abrir({ dir, env = process.env, agora, log = () => {} }) {
  const querBanco = String(env.CHAUFFEUR_RESERVAS_BANCO || '').trim() === 'on';
  const url = String(env.TWK_DBA_URL || '').trim();
  if (querBanco && url) {
    try { const b = await abrirBanco({ url, agora }); log('[reservas] modo banco (twk_dba, tabelas chauffeur_*)'); return b; }
    catch (e) { const aviso = `banco indisponível (${String(e && e.message || e).slice(0, 160)}): reservas no arquivo`; log(`[reservas] ${aviso}`); return { ...abrirArquivo({ dir, agora }), aviso }; }
  }
  const aviso = querBanco ? 'CHAUFFEUR_RESERVAS_BANCO=on mas TWK_DBA_URL ausente: reservas no arquivo' : null;
  if (aviso) log(`[reservas] ${aviso}`);
  return { ...abrirArquivo({ dir, agora }), aviso };
}

module.exports = { abrir, abrirArquivo, abrirBanco, validar, validarEvento, normalizarWhatsapp, valorCent, apresentar, ORIGENS, PRODUTOS, PRODUTO_NOME, PRECO_CENT, STATUS, STATUS_FINAL, RE_CODIGO, RE_HORA };
