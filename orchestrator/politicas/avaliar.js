#!/usr/bin/env node
'use strict';
/**
 * Motor de políticas de aprovação — a tabela de escalonamento como código (08/10/2026).
 *
 *   const { avaliar } = require('./avaliar');
 *   avaliar({ classe: 'escrita_reversivel', agente: 'dba', trace_id: 'trc-x', atributos: { backup_declarado: true, ... } })
 *   → { decisao, politica, motivo, faltam[], orcamento }
 *
 *   node orchestrator/politicas/avaliar.js --classe escrita_reversivel --agente dba --atributos '{"backup_declarado":true}' [--trace trc-x] [--registrar]
 *   node orchestrator/politicas/avaliar.js --listar
 *
 * Regras que o código impõe e nenhuma política muda:
 *   1. CLASSES_SEMPRE_HUMANO → requer_aprovacao_humana, sempre.
 *   2. Política com status "proposta" nunca é aplicada: devolve requer_aprovacao_humana e nomeia a proposta.
 *   3. Atributo ausente = condição não atendida (falhar alto). Sem política para a classe = humano.
 *   4. Orçamento mensal estourado → requer_aprovacao_orquestrador (nunca humano a menos; nunca autônomo a mais).
 *   5. Toda avaliação com --registrar vai para orchestrator/logs/audit-AAAA-MM-DD.jsonl (evento politica_avaliada).
 * Zero LLM, zero rede, zero banco.
 */
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.resolve(__dirname, '..', '..');
const ARQ_POLITICAS = path.join(__dirname, 'politicas.json');
const ARQ_ORCAMENTO = path.join(RAIZ, 'orchestrator', 'state', 'politicas-orcamento.json');
const DIR_LOGS = path.join(RAIZ, 'orchestrator', 'logs');

const NIVEIS = ['autonomo', 'autonomo_com_log', 'requer_aprovacao_orquestrador', 'requer_aprovacao_humana'];

// Tabela de escalonamento: as linhas "sempre". Nenhuma política pode cobrir estas classes.
const CLASSES_SEMPRE_HUMANO = Object.freeze([
  'reembolso', 'desconto', 'cancelamento_assinatura', 'valor_ao_cliente', 'compensacao', 'cortesia',
  'ddl', 'drop', 'truncate', 'drop_column', 'migracao', 'restore', 'papel_banco', 'escrita_nextauth', 'create_table_public',
  'publicar', 'republicar', 'despublicar_outro_motivo',
  'envio_externo_massa', 'publicacao_canal_oficial',
  'juridico', 'imprensa', 'novo_fluxo_orquestrado',
  'escrita_sem_backup', 'escrita_acima_do_teto',
]);

function carregarPoliticas(arq = ARQ_POLITICAS) {
  const j = JSON.parse(fs.readFileSync(arq, 'utf8'));
  const ids = new Set();
  for (const p of j.politicas) {
    if (!p.id || !p.classe || !p.status || !p.decisao || !p.fundamento) throw new Error(`política inválida (id/classe/status/decisao/fundamento): ${JSON.stringify(p).slice(0, 80)}`);
    if (ids.has(p.id)) throw new Error(`id de política repetido: ${p.id}`);
    ids.add(p.id);
    if (!NIVEIS.includes(p.decisao)) throw new Error(`${p.id}: decisão desconhecida ${p.decisao}`);
    if (!['ativa', 'proposta', 'revogada'].includes(p.status)) throw new Error(`${p.id}: status desconhecido ${p.status}`);
    if (CLASSES_SEMPRE_HUMANO.includes(p.classe)) throw new Error(`${p.id}: a classe ${p.classe} é SEMPRE humana e não aceita política`);
    if (p.status === 'ativa' && p.decisao !== 'requer_aprovacao_humana' && !p.desfazer) throw new Error(`${p.id}: política ativa sem "desfazer"`);
  }
  return j;
}

// Mês civil em Europe/Paris, formato AAAA-MM.
function mesParis(agora = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit' }).format(agora).slice(0, 7);
}

function lerOrcamento(arq = ARQ_ORCAMENTO) {
  try { return JSON.parse(fs.readFileSync(arq, 'utf8')); } catch { return { meses: {} }; }
}
function consumidoNoMes(orc, id, mes) { return ((orc.meses || {})[mes] || {})[id] || 0; }
function consumir(orc, id, mes, arq = ARQ_ORCAMENTO) {
  orc.meses = orc.meses || {};
  orc.meses[mes] = orc.meses[mes] || {};
  orc.meses[mes][id] = (orc.meses[mes][id] || 0) + 1;
  fs.mkdirSync(path.dirname(arq), { recursive: true });
  fs.writeFileSync(arq, JSON.stringify(orc, null, 2), 'utf8');
}

// Avalia uma condição. Formas: true/false (igualdade estrita), {max}, {min}, {in:[...]}.
// Atributo ausente → não atendida.
function condicaoAtendida(valor, esperado) {
  if (valor === undefined || valor === null) return false;
  if (typeof esperado === 'boolean' || typeof esperado === 'string') return valor === esperado;
  if (typeof esperado === 'number') return valor === esperado;
  if (esperado && typeof esperado === 'object') {
    if ('max' in esperado && !(typeof valor === 'number' && valor <= esperado.max)) return false;
    if ('min' in esperado && !(typeof valor === 'number' && valor >= esperado.min)) return false;
    if ('in' in esperado && !esperado.in.includes(valor)) return false;
    return true;
  }
  return false;
}

function descrever(chave, esperado) {
  if (esperado && typeof esperado === 'object') return `${chave} ${Object.entries(esperado).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(' ')}`;
  return `${chave}=${JSON.stringify(esperado)}`;
}

/**
 * @param {{classe:string, agente?:string, trace_id?:string, atributos?:object}} acao
 * @param {{politicas?:object, orcamento?:object, agora?:Date}} opts
 */
function avaliar(acao, opts = {}) {
  if (!acao || typeof acao.classe !== 'string' || !acao.classe) {
    return { decisao: 'requer_aprovacao_humana', politica: null, motivo: 'ação sem classe — não é possível avaliar (falhar alto)', faltam: ['classe'] };
  }
  const classe = acao.classe.trim();
  const atributos = acao.atributos || {};
  if (CLASSES_SEMPRE_HUMANO.includes(classe)) {
    return { decisao: 'requer_aprovacao_humana', politica: null, motivo: `classe "${classe}" é SEMPRE humana (tabela de escalonamento); nenhuma política a cobre`, faltam: [] };
  }
  const cfg = opts.politicas || carregarPoliticas();
  const candidatas = cfg.politicas.filter((p) => p.classe === classe && p.status !== 'revogada');
  if (candidatas.length === 0) {
    return { decisao: 'requer_aprovacao_humana', politica: null, motivo: `nenhuma política para a classe "${classe}" — humano decide`, faltam: [] };
  }
  const ativa = candidatas.find((p) => p.status === 'ativa');
  const proposta = candidatas.find((p) => p.status === 'proposta');
  if (!ativa) {
    return {
      decisao: 'requer_aprovacao_humana', politica: proposta.id, proposta: true,
      motivo: `a política ${proposta.id} cobriria esta ação, mas está em status "proposta" (aprovar com a frase "${proposta.frase_de_aprovacao || 'Aprovo ' + proposta.id}")`,
      faltam: [],
    };
  }
  const faltam = [];
  for (const [chave, esperado] of Object.entries(ativa.condicoes || {})) {
    if (!condicaoAtendida(atributos[chave], esperado)) faltam.push(descrever(chave, esperado) + (atributos[chave] === undefined ? ' (ausente)' : ` (recebido ${JSON.stringify(atributos[chave])})`));
  }
  if (faltam.length) {
    return { decisao: ativa.fallback || 'requer_aprovacao_humana', politica: ativa.id, motivo: `${ativa.id} não cobre: ${faltam.join('; ')}`, faltam };
  }
  const mes = mesParis(opts.agora);
  const orc = opts.orcamento || lerOrcamento();
  const usado = consumidoNoMes(orc, ativa.id, mes);
  const teto = ativa.orcamento_mensal ?? Infinity;
  if (usado >= teto) {
    return { decisao: 'requer_aprovacao_orquestrador', politica: ativa.id, motivo: `${ativa.id}: orçamento mensal esgotado (${usado}/${teto} em ${mes})`, faltam: [], orcamento: { mes, usado, teto } };
  }
  return { decisao: ativa.decisao, politica: ativa.id, motivo: `${ativa.id} (${ativa.fundamento}) cobre a ação`, faltam: [], desfazer: ativa.desfazer, orcamento: { mes, usado, teto } };
}

// Registra a avaliação no audit e, se autônoma, consome orçamento. Devolve o resultado.
function registrar(acao, resultado, opts = {}) {
  const hoje = new Date().toISOString().slice(0, 10);
  const linha = {
    ts: new Date().toISOString(), trace_id: acao.trace_id || null, agente: acao.agente || 'orquestrador',
    evento: 'politica_avaliada', classe: acao.classe, politica: resultado.politica, decisao: resultado.decisao, motivo: resultado.motivo,
  };
  fs.mkdirSync(DIR_LOGS, { recursive: true });
  fs.appendFileSync(path.join(DIR_LOGS, `audit-${hoje}.jsonl`), JSON.stringify(linha) + '\n');
  if (resultado.decisao === 'autonomo' || resultado.decisao === 'autonomo_com_log') {
    const orc = opts.orcamento || lerOrcamento();
    consumir(orc, resultado.politica, mesParis(opts.agora), opts.arqOrcamento);
  }
  return resultado;
}

module.exports = { avaliar, registrar, carregarPoliticas, condicaoAtendida, mesParis, CLASSES_SEMPRE_HUMANO, NIVEIS };

if (require.main === module) {
  const a = process.argv.slice(2);
  const arg = (k) => (a.includes(k) ? a[a.indexOf(k) + 1] : undefined);
  if (a.includes('--listar')) {
    const cfg = carregarPoliticas();
    for (const p of cfg.politicas) console.log(`${p.id.padEnd(9)} ${p.status.padEnd(8)} ${p.classe.padEnd(28)} → ${p.decisao}  [${p.fundamento}]`);
    console.log(`\nsempre humano: ${CLASSES_SEMPRE_HUMANO.join(', ')}`);
    process.exit(0);
  }
  const classe = arg('--classe');
  if (!classe) { console.error('uso: --classe <classe> [--agente x] [--atributos json] [--trace id] [--registrar] | --listar'); process.exit(2); }
  let atributos = {};
  if (arg('--atributos')) { try { atributos = JSON.parse(arg('--atributos')); } catch (e) { console.error('--atributos não é JSON válido:', e.message); process.exit(2); } }
  const acao = { classe, agente: arg('--agente'), trace_id: arg('--trace'), atributos };
  const r = avaliar(acao);
  if (a.includes('--registrar')) registrar(acao, r);
  console.log(JSON.stringify(r, null, 2));
  process.exit(r.decisao === 'requer_aprovacao_humana' ? 3 : 0);
}
