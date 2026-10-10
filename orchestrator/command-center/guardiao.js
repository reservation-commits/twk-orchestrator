'use strict';
/**
 * MAESTRO — Guardião da Reserva como agente de primeira classe da Central (v4.6, 2026-10-10).
 *
 * O Guardião não tem serviço na web: é um núcleo determinístico (sem LLM) que roda na máquina do
 * Orquestrador (orchestrator/agents/guardiao-reserva/run.js) e grava arquivos de estado. Este módulo
 * é o "adaptador de KPIs" dele — o equivalente, para um agente local, do que kpis.js faz por HTTP
 * para CLAVIS, Aria, Quill, Atlas e DB Architect. Com ele o Guardião ganha o mesmo tratamento dos
 * outros cinco: saúde no cabeçalho, página própria, ferramenta frota_kpis, vigia e persona.
 *
 * Fontes, em ordem:
 *   1. o repositório (quando a Central roda na máquina do Orquestrador): state/ do próprio Guardião;
 *   2. a cópia sincronizada (Central hospedada): STATE_DIR/guardiao-sincronizado.json, enviada por
 *      push-state.ps1 (node guardiao.js --exportar) — a mesma leitura, calculada aqui e levada para lá.
 *
 * O que sai daqui é referência, nunca dump: nomes de casas, códigos de reserva e contagens.
 * Nenhum HTML de e-mail, nenhum endereço, nenhum dado de cliente (o Guardião já não os seleciona).
 * Doutrina: sem leitura é status explícito ("sem_sincronizacao"), nunca zero.
 */
const fs = require('node:fs');
const path = require('node:path');

const REPO = path.resolve(__dirname, '..', '..');
const DIR_REPO = path.join(REPO, 'orchestrator', 'agents', 'guardiao-reserva', 'state');
const STATE_DIR = path.resolve(process.env.STATE_DIR || path.join(__dirname, 'state'));
const ARQ_SINC = 'guardiao-sincronizado.json';
const SAIDA_EXPORT = path.join(REPO, 'orchestrator', 'state', ARQ_SINC);
const TTL_MS = Number(process.env.KPI_CACHE_MS || 60_000);
const HORAS_SEM_VARREDURA = Number(process.env.GUARDIAO_MAX_HORAS_SEM_VARREDURA || 30); // varredura é diária (9h); 30h cobre o atraso normal
const TETO_LISTAS = 80;

const lerJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const lerTexto = (f, max) => { try { return fs.readFileSync(f, 'utf8').slice(0, max || 60_000); } catch { return null; } };
const lerJsonl = (f) => { try { return fs.readFileSync(f, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; } };
const listar = (d) => { try { return fs.readdirSync(d); } catch { return []; } };
const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
const horasDesde = (iso, agora) => (iso ? Math.round(((agora || Date.now()) - new Date(iso).getTime()) / 36e5) : null);

// ---------------------------------------------------------------- leitura do repositório
/** Lê o estado do Guardião no repositório. null = o diretório não existe nesta máquina. */
function lerRepositorio(agora = Date.now()) {
  if (!fs.existsSync(DIR_REPO)) return null;
  const arquivos = listar(DIR_REPO);
  // Só as varreduras completas (decisoes-AAAA-MM-DD.json); as de canário têm sufixo e ficam de fora.
  const dias = arquivos.filter((f) => /^decisoes-\d{4}-\d{2}-\d{2}\.json$/.test(f)).map((f) => f.slice(9, 19)).sort();
  const ultimoDia = dias.length ? dias[dias.length - 1] : null;
  const prop = ultimoDia ? lerJson(path.join(DIR_REPO, `propostas-${ultimoDia}.json`)) : null;
  const decisoes = ultimoDia ? lerJson(path.join(DIR_REPO, `decisoes-${ultimoDia}.json`)) : null;
  const pausado = lerJson(path.join(DIR_REPO, 'PAUSADO'));
  const eventos = lerJsonl(path.join(DIR_REPO, 'eventos.jsonl'));

  const contagens = (prop && prop.contagens) || contarDecisoes(decisoes);
  const emails = ((prop && prop.emails) || []).map((e) => ({
    restaurant_id: String(e.restaurant_id || ''), nome: e.nome || '—', cidade: e.cidade || '', idioma: e.idioma || '',
    reservas: Array.isArray(e.reservas) ? e.reservas.length : 0, codigos: Array.isArray(e.reservas) ? e.reservas.slice(0, 10) : [],
  }));
  const fila = ((prop && prop.fila) || []).map((f) => ({
    reservation_code: f.reservation_code || '', restaurant_id: String(f.restaurant_id || ''), nome: f.nome || '—', cidade: f.cidade || '', pais: f.pais || '',
    idioma: f.idioma || '', urgencia_h: num(f.urgencia_h), degrau: num(f.degrau), canal: f.canal || '', mesa: f.mesa || '', motivo: f.motivo || '',
  })).sort((a, b) => (a.urgencia_h ?? 1e9) - (b.urgencia_h ?? 1e9));
  const clientes = ((prop && prop.clientes) || []).map((c) => ({
    reservation_code: c.reservation_code || '', restaurant_id: String(c.restaurant_id || ''),
    restaurante: (c.fatos && c.fatos.restaurante) || '—', cidade: (c.fatos && c.fatos.cidade) || '',
    horas_ate_mesa: num(c.horas_ate_mesa), idioma: c.idioma_base || c.idioma || '',
    alternativas: c.fatos && Array.isArray(c.fatos.alternativas) ? c.fatos.alternativas.length : 0, motivo: c.motivo || '',
  })).sort((a, b) => (a.horas_ate_mesa ?? 1e9) - (b.horas_ate_mesa ?? 1e9));
  const idiomas = Object.entries(emails.reduce((o, e) => { o[e.idioma || '—'] = (o[e.idioma || '—'] || 0) + 1; return o; }, {}))
    .map(([idioma, casas]) => ({ idioma, casas })).sort((a, b) => b.casas - a.casas);

  // Livro-razão: só 'enviado' e 'proposto' contam como contato (dry-run nunca grava).
  const corte7d = agora - 7 * 86_400_000;
  const enviados = eventos.filter((e) => e.decisao === 'enviado');
  const propostos = eventos.filter((e) => e.decisao === 'proposto');
  const ledger = {
    enviados_total: enviados.length,
    enviados_7d: enviados.filter((e) => new Date(e.ts).getTime() >= corte7d).length,
    propostos_7d: propostos.filter((e) => new Date(e.ts).getTime() >= corte7d).length,
    casas_contatadas: new Set(enviados.map((e) => String(e.restaurant_id))).size,
    ultimo_envio: enviados.length ? enviados[enviados.length - 1].ts : null,
    linhas: eventos.length,
  };

  // Série: uma linha por varredura (últimas 14), para o gráfico e para o vigia.
  const serie = dias.slice(-14).map((dia) => {
    const d = dia === ultimoDia ? decisoes : lerJson(path.join(DIR_REPO, `decisoes-${dia}.json`));
    const c = contarDecisoes(d);
    return { dia, avaliadas: c.avaliadas, cobrar: (c.email_restaurante || 0) + (c.fila_whatsapp || 0) + (c.fila_whatsapp_urgente || 0), avisar: c.mensagem_cliente || 0 };
  });

  const quando = (prop && prop.agora) || null;
  return {
    status: 'ok',
    fonte: 'repositorio',
    pausado: pausado ? { ts: pausado.ts || null, motivo: String(pausado.motivo || '').slice(0, 200) } : null,
    ultimaExecucao: ultimoDia ? { dia: ultimoDia, modo: (prop && prop.modo) || null, agora: quando, trace_id: (prop && prop.trace_id) || null, canario: (prop && prop.canario) || null } : null,
    idadeHoras: horasDesde(quando, agora),
    avaliadas: num(contagens.avaliadas),
    contagens,
    cobrarCasa: (contagens.email_restaurante || 0) + (contagens.fila_whatsapp || 0) + (contagens.fila_whatsapp_urgente || 0),
    avisarCliente: contagens.mensagem_cliente || 0,
    urgentes: clientes.filter((c) => c.horas_ate_mesa !== null && c.horas_ate_mesa <= 6).length,
    anomalias: ((prop && prop.anomalias) || []).map((a) => String(a).slice(0, 200)),
    lote: { casas: emails.length, reservas: emails.reduce((n, e) => n + e.reservas, 0), idiomas },
    emails: emails.slice(0, TETO_LISTAS),
    fila: fila.slice(0, TETO_LISTAS),
    clientes: clientes.slice(0, TETO_LISTAS),
    ledger,
    serie,
    execucoes: dias.length,
    relatorio: ultimoDia ? lerTexto(path.join(DIR_REPO, `relatorio-${ultimoDia}.md`), 40_000) : null,
  };
}

function contarDecisoes(decisoes) {
  const c = { avaliadas: Array.isArray(decisoes) ? decisoes.length : null };
  for (const d of Array.isArray(decisoes) ? decisoes : []) { const k = String(d.acao || '—'); c[k] = (c[k] || 0) + 1; }
  return c;
}

// ---------------------------------------------------------------- aprovações (sempre da Central que está rodando)
/** Cartões do Guardião na fila de aprovações desta Central (lote do degrau 1 e avisos do degrau 4). */
function lerAprovacoes(stateDir) {
  const todas = lerJsonl(path.join(stateDir || STATE_DIR, 'aprovacoes.jsonl'))
    .filter((a) => a.agente === 'guardiao' || /^\[Guardi[ãa]o\]/i.test(String(a.titulo || '')));
  const pend = todas.filter((a) => a.status === 'pendente').sort((x, y) => String(x.criado_em).localeCompare(String(y.criado_em)));
  const decididas = todas.filter((a) => a.status !== 'pendente').sort((x, y) => String(y.decidido_em || '').localeCompare(String(x.decidido_em || '')));
  const u = decididas[0];
  return {
    pendentes: pend.length,
    mais_antiga_h: pend.length ? horasDesde(pend[0].criado_em) : null,
    itens: pend.slice(0, 10).map((a) => ({ id: a.id, titulo: String(a.titulo || '').slice(0, 140), criado_em: a.criado_em, tipo: a.tipo || null })),
    ultima_decidida: u ? { id: u.id, titulo: String(u.titulo || '').slice(0, 140), status: u.status, decidido_em: u.decidido_em || null } : null,
  };
}

// ---------------------------------------------------------------- fachada (com cache, como kpis.js)
let cache = null;
/** O instantâneo do Guardião para a Central: repositório se houver, senão a cópia sincronizada. */
function kpis(opts = {}) {
  const stateDir = opts.stateDir || STATE_DIR;
  if (!opts.fresco && cache && Date.now() - cache.at < TTL_MS) return cache.data;
  let data = lerRepositorio();
  if (!data) {
    const sinc = lerJson(path.join(stateDir, ARQ_SINC));
    if (sinc && sinc.snapshot && sinc.snapshot.status === 'ok') {
      data = { ...sinc.snapshot, fonte: 'sincronizado', sincronizadoEm: sinc.exportadoEm || null };
      // idade recalculada agora — o instantâneo envelhece depois de exportado
      data.idadeHoras = horasDesde(data.ultimaExecucao && data.ultimaExecucao.agora);
    } else {
      data = { status: 'sem_sincronizacao', detalhe: 'O Guardião roda na máquina do Orquestrador e não tem serviço na web; a Central hospedada só o vê depois de push-state.ps1.' };
    }
  }
  if (data.status === 'ok') {
    delete data.relatorio; // o relatório sai por relatorio(), não pelo KPI
    data.aprovacoes = lerAprovacoes(stateDir);
  }
  data.atualizadoEm = new Date().toISOString();
  cache = { at: Date.now(), data };
  return data;
}

/** Saúde para o cabeçalho/constelação — o análogo do /health dos agentes HTTP, lido dos arquivos. */
function saude(opts) {
  const t0 = Date.now();
  const k = kpis(opts);
  const base = { local: true, ms: Date.now() - t0, at: new Date().toISOString() };
  if (k.status !== 'ok') return { ...base, configured: false, error: k.detalhe || k.status };
  const idade = k.idadeHoras;
  if (k.pausado) return { ...base, configured: true, ok: false, pausado: k.pausado.motivo || 'sem motivo', idade_h: idade, error: `pausado: ${k.pausado.motivo || 'sem motivo'}` };
  if (idade === null || idade > HORAS_SEM_VARREDURA) return { ...base, configured: true, ok: false, idade_h: idade, error: idade === null ? 'nenhuma varredura registrada' : `última varredura há ${idade} h (teto ${HORAS_SEM_VARREDURA} h)` };
  return { ...base, configured: true, ok: true, idade_h: idade, sincronizado: k.fonte === 'sincronizado' };
}

/** O relatório legível da última varredura (markdown), para a página e para ler_estado("guardiao"). */
function relatorio(opts = {}) {
  const r = lerRepositorio();
  if (r && r.ultimaExecucao) return { dia: r.ultimaExecucao.dia, fonte: 'repositorio', content: r.relatorio || '(relatório do dia ausente)' };
  const sinc = lerJson(path.join(opts.stateDir || STATE_DIR, ARQ_SINC));
  if (sinc && sinc.relatorio) return { dia: sinc.snapshot && sinc.snapshot.ultimaExecucao ? sinc.snapshot.ultimaExecucao.dia : null, fonte: 'sincronizado', content: sinc.relatorio };
  return { dia: null, fonte: null, content: null };
}

/** Pacote para push-state.ps1: o instantâneo + o relatório, calculados aqui, para a Central hospedada. */
function exportar() {
  const r = lerRepositorio();
  if (!r) return null;
  const { relatorio: md, ...snapshot } = r;
  return { exportadoEm: new Date().toISOString(), snapshot, relatorio: md };
}

if (require.main === module && process.argv.includes('--exportar')) {
  const p = exportar();
  if (!p) { console.error('guardiao.js: estado do Guardião não encontrado em', DIR_REPO); process.exit(1); }
  fs.mkdirSync(path.dirname(SAIDA_EXPORT), { recursive: true });
  fs.writeFileSync(SAIDA_EXPORT, JSON.stringify(p), 'utf8');
  console.log(`guardiao-sincronizado.json: varredura de ${p.snapshot.ultimaExecucao ? p.snapshot.ultimaExecucao.dia : '—'} · ${p.snapshot.avaliadas ?? '—'} pedidos · lote ${p.snapshot.lote.casas} casas · ${path.relative(process.cwd(), SAIDA_EXPORT)}`);
}

module.exports = { kpis, saude, relatorio, exportar, lerAprovacoes, DIR_REPO, ARQ_SINC };
