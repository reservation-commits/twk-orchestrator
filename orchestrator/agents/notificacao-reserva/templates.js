'use strict';
/**
 * Fonte única dos textos dos templates de WhatsApp da notificação de reserva — para o eval.
 *
 * Desde 2026-09-30 os textos NÃO vivem mais aqui: vêm do documento aprovado pelo fundador
 * (docs/notificacoes/templates-meta-v2-2026-09-30.md), o mesmo que o meta-templates.mjs
 * manda para a Meta. Uma cópia aqui divergia em silêncio (ficou três versões atrás: sem
 * pessoas, sem cabeçalho, nome antigo do "recusado"). O eval
 * (orchestrator/evals/notificacao-reserva) checa cada frase inglesa contra o ADR-015 a
 * cada rodada: um texto editado para prometer prazo, disponibilidade ou confirmação
 * inexistente REPROVA a suíte antes de chegar ao cliente.
 *
 * `params` é o contrato com montarParametros() em
 * "Agente de Suporte e Concierge/src/eventFormat.ts" — a ordem aqui é a ordem
 * de {{1}}, {{2}}… lá. O eval cruza os dois.
 *
 * Idioma do eval: inglês, pela distribuição real dos telefones entregáveis
 * (US 3.938 · GB 1.713 · SG 1.215 · CA 722 · AU 709 · HK 648). Ver
 * docs/notificacoes/fase0-validacao-telefones.md.
 */

const fs = require('node:fs');
const path = require('node:path');

const DOC = path.resolve(__dirname, '../../../docs/notificacoes/templates-meta-v2-2026-09-30.md');
// require(esm): Node ≥ 22.12 carrega .mjs sem top-level await de forma síncrona.
const { lerDocumento } = require('./meta-templates.mjs');
const documento = lerDocumento(fs.readFileSync(DOC, 'utf8'));

/** Rodapé comum (inglês). A promessa é cumprida por src/consent.ts, que reconhece "stop". */
const RODAPE_EN = documento.rodape.en;

/** O que o documento não sabe: evento, contrato de params e se o texto pode afirmar mesa. */
const CONTRATO = {
  twk_reservation_received: {
    evento: 'pedido_recebido',
    params: ['primeiro_nome', 'restaurante', 'data', 'hora', 'pessoas'],
    // Não afirma mesa. Não promete prazo. Diz o que ele recebe e como agir.
    confirmaMesa: false,
  },
  twk_reservation_accepted: {
    evento: 'aceito',
    params: ['primeiro_nome', 'restaurante', 'data', 'hora', 'pessoas'],
    // ÚNICO template que pode afirmar mesa: o restaurante confirmou de fato.
    confirmaMesa: true,
  },
  twk_reservation_declined_v2: {
    evento: 'recusado',
    params: ['primeiro_nome', 'restaurante', 'data'],
    // "look for", nunca "find": não se promete disponibilidade.
    confirmaMesa: false,
  },
  twk_reservation_cancelled: {
    evento: 'cancelado',
    params: ['primeiro_nome', 'restaurante', 'data'],
    confirmaMesa: false,
  },
};

function doDocumento(nome) {
  const t = documento.templates.find((x) => x.nome === nome);
  if (!t || !t.corpos.en) throw new Error(`template ${nome} (en) não está em ${path.basename(DOC)}`);
  return { nome, categoria: 'UTILITY', idioma: 'en', cabecalho: t.cabecalhos?.en ?? null, corpo: t.corpos.en, rodape: RODAPE_EN, ...CONTRATO[nome] };
}

const TEMPLATES = [
  doDocumento('twk_reservation_received'),
  doDocumento('twk_reservation_accepted'),
  doDocumento('twk_reservation_declined_v2'),
  {
    // Fora do documento v2 de propósito: não foi submetido à Meta.
    nome: 'twk_reschedule_proposed',
    evento: 'reagendamento_proposto',
    categoria: 'UTILITY',
    idioma: 'en',
    params: ['primeiro_nome', 'restaurante', 'data_proposta', 'hora_proposta'],
    corpo:
      'Hello {{1}}, {{2}} can offer you {{3}} at {{4}} instead. Reply YES to take it, ' +
      "or tell me what would suit you better and I'll see what I can do.",
    rodape: RODAPE_EN,
    confirmaMesa: false,
    // BLOQUEADO: reschedule_proposed_date/time estão vazias em 100% das linhas
    // de `reservations` (verificado 2026-09-21). Só submeter depois de
    // descobrir onde a plataforma guarda a proposta de reagendamento.
    bloqueado: 'sem fonte de dados: reschedule_proposed_date vazia em toda a tabela',
  },
  doDocumento('twk_reservation_cancelled'),
];

// ─── v3 (30/09/2026): as cinco mensagens novas ─────────────────────────────
// Não têm evento em eventFormat (saem por varredura), então o eval aplica só as regras de TEXTO
// e o contrato de placeholders. Fonte: o documento v3, o mesmo enviado à Meta.
const DOC_V3 = path.resolve(__dirname, '../../../docs/notificacoes/templates-meta-v3-novas-2026-09-30.md');
const VARS_V3 = {
  twk_request_in_progress: ['primeiro_nome', 'restaurante', 'data', 'hora'],
  twk_request_unconfirmed: ['primeiro_nome', 'restaurante', 'data', 'hora'],
  twk_venue_request_reminder: ['restaurante', 'data', 'hora', 'pessoas', 'cliente'],
  twk_eve_briefing_map: ['primeiro_nome', 'restaurante', 'data', 'hora', 'pessoas', 'endereco'],
  twk_venue_agenda: ['restaurante', 'data', 'quantidade', 'lista'],
};
const documentoV3 = fs.existsSync(DOC_V3) ? lerDocumento(fs.readFileSync(DOC_V3, 'utf8')) : { rodape: {}, templates: [] };
const TEXTOS_V3 = documentoV3.templates
  .filter((t) => t.corpos.en && VARS_V3[t.nome])
  .map((t) => ({
    nome: t.nome, categoria: 'UTILITY', idioma: 'en', cabecalho: t.cabecalhos?.en ?? null,
    corpo: t.corpos.en, rodape: documentoV3.rodape.en, confirmaMesa: false, params: VARS_V3[t.nome],
    respostas: t.respostas?.en ?? null,
  }));

/** Quantos {{n}} distintos o corpo declara. */
function contarPlaceholders(corpo) {
  const achados = new Set();
  for (const m of corpo.matchAll(/\{\{(\d+)\}\}/g)) achados.add(Number(m[1]));
  return achados.size;
}

/** Os {{n}} são 1..N sem buraco nem repetição fora de ordem? */
function placeholdersContiguos(corpo) {
  const nums = [...corpo.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
  const unicos = [...new Set(nums)].sort((a, b) => a - b);
  return unicos.every((n, i) => n === i + 1);
}

const porEvento = (evento) => TEMPLATES.find((t) => t.evento === evento) || null;

module.exports = { TEMPLATES, TEXTOS_V3, RODAPE_EN, DOC, DOC_V3, contarPlaceholders, placeholdersContiguos, porEvento };
