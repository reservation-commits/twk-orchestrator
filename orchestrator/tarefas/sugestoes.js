'use strict';
/**
 * COMPASSO — sugestões de tarefas a partir dos sinais que a operação já produz.
 *
 * Nada aqui usa modelo. Cada leitor olha uma fonte, devolve sugestões com "por quê" numérico e a fonte,
 * e falha SOZINHO (fonte ausente = zero sugestões daquela fonte + lacuna registrada), nunca derruba as outras.
 * Ids são estáveis (hash da chave de origem): sugestão assumida ou descartada não volta enquanto a decisão valer.
 *
 * Fontes (todas opcionais):
 *   - compromissos.jsonl do orquestrador (abertos e vencidos)
 *   - Central: acoes.jsonl (achados críticos abertos), aprovacoes.jsonl (pendentes), perguntas.jsonl (abertas)
 *   - banco twk_auth via twk_ro (escalações do atendimento paradas; pendências que vencem em 48 h) — se houver credencial
 *
 * De onde vêm as filas da Central e os compromissos (03/11, serviço hospedado):
 *   1. API da Central, quando CENTER_URL está definido — GET /api/actions, /api/approvals, /api/perguntas,
 *      /api/compromissos com o cabeçalho X-Center-Key (CENTER_TOKEN). É a fonte viva: a Central hospedada é
 *      onde a Regência roda e para onde o notebook empurra os compromissos.
 *   2. Disco, quando não há CENTER_URL ou a API falhou — CENTRAL_STATE_DIR / command-center/state e
 *      COMPROMISSOS_PATH / orchestrator/state/compromissos.jsonl (máquina do Orquestrador).
 *   A cobertura diz de onde cada fonte veio (origem: 'api' | 'arquivo') e por que falhou quando falhou.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const RAIZ = path.resolve(__dirname, '..', '..');
const id = (chave) => 's-' + crypto.createHash('sha1').update(chave).digest('hex').slice(0, 12);
const lerJsonl = (f) => { try { return fs.readFileSync(f, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return null; } };
const hojeIso = () => new Date().toISOString().slice(0, 10);

function sug(o) {
  return { id: id(o.chave), chave: o.chave, titulo: o.titulo.slice(0, 200), area: o.area || 'Operação', porque: o.porque.slice(0, 300), fonte: o.fonte, dono_sugerido: o.dono_sugerido || null, etapas: (o.etapas || []).slice(0, 6), prioridade_fixa: !!o.prioridade_fixa, severidade: o.severidade || 'media' };
}

// ---------------------------------------------------------------- Central por API
/** GET numa rota da Central com a chave. Devolve o JSON ou lança com motivo curto (vira lacuna). */
async function buscarCentral(ctx, rota) {
  const base = String(ctx.centerUrl || '').replace(/\/+$/, '');
  if (!base) throw new Error('sem CENTER_URL');
  const r = await fetch(base + rota, { headers: { 'X-Center-Key': ctx.centerToken || '', accept: 'application/json' }, signal: AbortSignal.timeout(ctx.timeoutMs || 6000) });
  if (r.status === 401) throw new Error('Central recusou a chave (401)');
  if (r.status === 404) throw new Error(`Central ainda não serve ${rota} (404)`);
  if (!r.ok) throw new Error(`Central respondeu ${r.status} em ${rota}`);
  return r.json();
}

/**
 * Lê uma fila: API da Central primeiro (quando configurada), disco depois.
 * Devolve { linhas, origem: 'api'|'arquivo' } ou { linhas: null, lacuna }.
 */
async function lerFila(ctx, { rota, campo, arquivos }) {
  let lacuna = null;
  if (ctx.centerUrl) {
    try {
      const dados = await buscarCentral(ctx, rota);
      const linhas = dados && Array.isArray(dados[campo]) ? dados[campo] : null;
      if (linhas) return { linhas, origem: 'api' };
      lacuna = `Central devolveu ${rota} sem o campo ${campo}`;
    } catch (e) { lacuna = String(e.name === 'TimeoutError' ? `Central não respondeu em ${rota}` : e.message || e).slice(0, 120); }
  }
  for (const f of arquivos.filter(Boolean)) { const l = lerJsonl(f); if (l) return { linhas: l, origem: 'arquivo' }; }
  return { linhas: null, lacuna: lacuna || 'arquivo ausente neste host (defina CENTER_URL ou o caminho)' };
}

// Caminho explícito é exclusivo (quem define CENTRAL_STATE_DIR/COMPROMISSOS_PATH não quer o estado do repositório por trás).
const dirsCentral = (ctx) => ctx.centralStateDir ? [ctx.centralStateDir] : [path.join(RAIZ, 'orchestrator', 'command-center', 'state')];
const arquivosCompromissos = (ctx) => ctx.compromissosPath ? [ctx.compromissosPath] : [path.join(RAIZ, 'orchestrator', 'state', 'compromissos.jsonl')];
const rotulo = (nome, origem) => origem === 'api' ? `${nome} (Central)` : nome;

// ---------------------------------------------------------------- leitores
async function deCompromissos(ctx) {
  const { linhas, origem, lacuna } = await lerFila(ctx, { rota: '/api/compromissos', campo: 'items', arquivos: arquivosCompromissos(ctx) });
  if (!linhas) return { fonte: 'compromissos', ok: false, itens: [], lacuna };
  const hoje = hojeIso();
  const abertos = linhas.filter((c) => c.status === 'aberto');
  const itens = abertos.filter((c) => c.vence_em && c.vence_em < hoje).map((c) => sug({
    chave: `compromisso:${c.id}`, titulo: String(c.o_que || c.id).split(/[.(]/)[0].trim(), area: /cliente|reserva/i.test(c.tipo + c.o_que) ? 'Clientes' : /restaurante|casa|e-mail morto/i.test(c.o_que) ? 'Catálogo' : /front|site|workflow|produto/i.test(c.tipo + c.o_que) ? 'Site' : 'Operação',
    porque: `Compromisso ${c.id} vencido em ${c.vence_em} (dono registrado: ${c.dono}). Se já foi superado, assuma e feche com o motivo.`, fonte: rotulo('compromissos.jsonl', origem),
    prioridade_fixa: /cliente|reserva/i.test(c.tipo), severidade: /cliente|reserva/i.test(c.tipo) ? 'alta' : 'media',
    etapas: ['Ler o compromisso e o que mudou desde então', 'Fazer, ou fechar como superado com motivo', 'Registrar'],
  }));
  return { fonte: 'compromissos', ok: true, origem, itens, total_abertos: abertos.length };
}

async function deAcoes(ctx) {
  const { linhas: acoes, origem, lacuna } = await lerFila(ctx, { rota: '/api/actions', campo: 'acoes', arquivos: dirsCentral(ctx).map((d) => path.join(d, 'acoes.jsonl')) });
  if (!acoes) return { fonte: 'acoes', ok: false, itens: [], lacuna };
  const abertas = acoes.filter((a) => a.status === 'aberta');
  const criticas = abertas.filter((a) => a.severidade === 'critica');
  // Uma sugestão por achado crítico (as 5 mais antigas) + uma de varredura geral quando a fila está velha.
  const itens = criticas.sort((a, b) => String(a.criado_em || '').localeCompare(String(b.criado_em || ''))).slice(0, 5).map((a) => sug({
    chave: `acao:${a.id || a.chave || a.titulo}`, titulo: a.titulo || a.regra || 'Achado crítico do vigia', area: /suporte|atend|aria|whatsapp/i.test(a.agente || '') ? 'Clientes' : /dba|catalogo|catálogo/i.test(a.agente || '') ? 'Catálogo' : /central|site/i.test(a.agente || '') ? 'Site' : 'Operação',
    porque: `Achado crítico aberto desde ${String(a.criado_em || '').slice(0, 10)} (${a.agente || 'vigia'}). ${String(a.detalhe || a.evidencia || '').slice(0, 140)}`.trim(), fonte: rotulo('acoes.jsonl', origem), severidade: 'alta',
    etapas: ['Confirmar se o achado ainda é verdadeiro', 'Corrigir ou delegar', 'Fechar o achado na Central'],
  }));
  if (abertas.length >= 10) itens.push(sug({ chave: 'acoes:varredura', titulo: `Reler os ${abertas.length} achados abertos do vigia e fechar os que já normalizaram`, area: 'Operação', porque: `${abertas.length} achados abertos, ${criticas.length} críticos; nenhum fechado desde a criação da fila.`, fonte: rotulo('acoes.jsonl', origem), etapas: ['Ler os críticos primeiro', 'Fechar os que normalizaram', 'Dar dono aos que seguem verdadeiros'] }));
  return { fonte: 'acoes', ok: true, origem, itens, abertas: abertas.length, criticas: criticas.length };
}

async function dePerguntasEAprovacoes(ctx) {
  const [p, a] = await Promise.all([
    lerFila(ctx, { rota: '/api/perguntas', campo: 'items', arquivos: dirsCentral(ctx).map((d) => path.join(d, 'perguntas.jsonl')) }),
    lerFila(ctx, { rota: '/api/approvals', campo: 'aprovacoes', arquivos: dirsCentral(ctx).map((d) => path.join(d, 'aprovacoes.jsonl')) }),
  ]);
  if (!p.linhas && !a.linhas) return { fonte: 'central', ok: false, itens: [], lacuna: p.lacuna || a.lacuna };
  const origem = p.origem || a.origem;
  const itens = [];
  const pa = (p.linhas || []).filter((q) => q.status === 'aberta');
  const ap = (a.linhas || []).filter((x) => x.status === 'pendente');
  if (pa.length) itens.push(sug({ chave: 'central:perguntas', titulo: pa.length === 1 ? 'Responder a pergunta aberta na Central' : `Responder as ${pa.length} perguntas abertas na Central`, area: 'Operação', porque: `${pa.length} pergunta${pa.length === 1 ? '' : 's'} sem resposta; a mais antiga é de ${pa.map((q) => String(q.criado_em || '').slice(0, 10)).sort()[0] || '?'}. Cada uma trava uma decisão de agente.`, fonte: rotulo('perguntas.jsonl', p.origem), dono_sugerido: 'marlon', etapas: ['Abrir a Conversa da Central', 'Responder ou marcar como não se aplica', 'Conferir que a fila zerou'] }));
  if (ap.length) itens.push(sug({ chave: 'central:aprovacoes', titulo: ap.length === 1 ? 'Decidir a aprovação pendente na Central' : `Decidir as ${ap.length} aprovações pendentes na Central`, area: 'Operação', porque: `${ap.length} pedido${ap.length === 1 ? '' : 's'} de autorização parado${ap.length === 1 ? '' : 's'}; agentes esperando para agir.`, fonte: rotulo('aprovacoes.jsonl', a.origem), dono_sugerido: 'marlon', etapas: ['Abrir Aprovações', 'Aprovar ou negar cada um', 'Registrar o motivo das negadas'] }));
  const parcial = (!p.linhas && p.lacuna) || (!a.linhas && a.lacuna) || null;
  return { fonte: 'central', ok: true, origem, itens, perguntas: pa.length, aprovacoes: ap.length, lacuna: parcial };
}

/**
 * Biblioteca de conexão dos agentes. No repositório fica em orchestrator/agents/_lib; na imagem do EasyPanel o
 * Dockerfile a copia para ./agents/_lib ao lado deste arquivo (lição de 03/11: só o caminho do repositório fazia a
 * fonte "banco" aparecer como "biblioteca ausente" em produção, mesmo com DATABASE_URL_RO no ambiente).
 */
function carregarConectar() {
  const candidatos = [path.join(__dirname, 'agents', '_lib', 'conectar.js'), path.join(RAIZ, 'orchestrator', 'agents', '_lib', 'conectar.js')];
  for (const p of candidatos) { if (fs.existsSync(p)) { try { return require(p); } catch (e) { return { erro: `${path.basename(p)}: ${e.message}` }; } } }
  return null;
}
async function doBanco(ctx) {
  const conectar = carregarConectar();
  if (!conectar) return { fonte: 'banco', ok: false, itens: [], lacuna: 'biblioteca de conexão ausente' };
  if (conectar.erro) return { fonte: 'banco', ok: false, itens: [], lacuna: `biblioteca de conexão não carregou (${conectar.erro})`.slice(0, 120) };
  if (!conectar.urlRo || !conectar.urlRo()) return { fonte: 'banco', ok: false, itens: [], lacuna: 'sem credencial twk_ro' };
  try {
    return await conectar.comClienteRo(async (c) => {
      const itens = [];
      const esc = await c.query("SELECT count(*)::int AS n, min(created_at)::date::text AS desde FROM aria_escalations WHERE status IN ('open','aberta','pendente') AND created_at < now() - interval '7 days'");
      const ne = esc.rows[0]?.n || 0;
      if (ne > 0) itens.push(sug({ chave: 'banco:escalacoes_paradas', titulo: ne === 1 ? 'Ler e fechar a escalação do atendimento parada há mais de 7 dias' : `Ler e fechar as ${ne} escalações do atendimento paradas há mais de 7 dias`, area: 'Clientes', porque: `${ne} escalaç${ne === 1 ? 'ão aberta' : 'ões abertas'} desde ${esc.rows[0].desde}; cada uma é um cliente ou uma casa esperando.`, fonte: 'aria_escalations (twk_ro)', dono_sugerido: 'marlon', prioridade_fixa: true, severidade: 'alta', etapas: ['Triar por urgência', 'Responder as de cliente primeiro', 'Fechar as resolvidas'] }));
      const pend = await c.query("SELECT count(*)::int AS n FROM reservations WHERE expired_at IS NULL AND booking_status IN ('Pending','In Treatment') AND booking_date BETWEEN current_date AND current_date + 2");
      const np = pend.rows[0]?.n || 0;
      if (np > 0) itens.push(sug({ chave: 'banco:pendencias_48h', titulo: np === 1 ? 'Correr atrás da reserva pendente que acontece nas próximas 48 h' : `Correr atrás das ${np} reservas pendentes que acontecem nas próximas 48 h`, area: 'Clientes', porque: `${np} pedido${np === 1 ? '' : 's'} de mesa sem resposta do restaurante com data até depois de amanhã.`, fonte: 'reservations (twk_ro)', prioridade_fixa: true, severidade: 'alta', etapas: ['Ver a fila do Guardião', 'Ligar ou escrever para as casas', 'Avisar o cliente pela Aria quando não houver resposta'] }));
      return { fonte: 'banco', ok: true, origem: 'banco', itens };
    });
  } catch (e) { return { fonte: 'banco', ok: false, itens: [], lacuna: String(e.message || e).slice(0, 120) }; }
}

/** Gera a lista nova preservando decisões anteriores (assumida/descartada) por id estável. */
async function gerar(ctx = {}, anteriores = []) {
  const leituras = await Promise.all([deCompromissos(ctx), deAcoes(ctx), dePerguntasEAprovacoes(ctx), doBanco(ctx)]);
  const decididas = new Map(anteriores.filter((s) => s.decisao).map((s) => [s.id, s]));
  const vistos = new Set();
  const itens = [];
  for (const l of leituras) for (const s of l.itens) {
    if (vistos.has(s.id)) continue; vistos.add(s.id);
    const ant = decididas.get(s.id);
    if (ant) {
      // descartada volta só depois de 14 dias; assumida nunca volta enquanto a tarefa existir
      const dias = (Date.now() - Date.parse(ant.decidida_em)) / 864e5;
      if (ant.decisao === 'assumida' || dias < 14) { itens.push({ ...s, ...ant }); continue; }
    }
    itens.push(s);
  }
  // prioridade fixa primeiro, depois severidade, depois fonte
  const peso = { alta: 0, media: 1, baixa: 2 };
  itens.sort((a, b) => (b.prioridade_fixa - a.prioridade_fixa) || (peso[a.severidade] - peso[b.severidade]));
  // Foco: no máximo 12 sugestões vivas por vez (as decididas não contam). O resto espera a próxima leitura.
  const vivas = itens.filter((s) => !s.decisao).slice(0, 12);
  const decididasAgora = itens.filter((s) => s.decisao);
  return { itens: [...vivas, ...decididasAgora], cobertura: leituras.map((l) => ({ fonte: l.fonte, ok: l.ok, origem: l.origem || null, lacuna: l.lacuna || null })) };
}

module.exports = { gerar, deCompromissos, deAcoes, dePerguntasEAprovacoes, doBanco, lerFila, carregarConectar, _id: id };
