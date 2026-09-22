'use strict';
/**
 * Fonte única dos textos dos templates de WhatsApp da notificação de reserva.
 *
 * Estavam em prosa no markdown. Viraram dado por um motivo: o eval
 * (orchestrator/evals/notificacao-reserva) checa cada frase contra o ADR-015 a
 * cada rodada. Um texto editado para prometer prazo, disponibilidade ou
 * confirmação inexistente REPROVA a suíte antes de chegar ao cliente.
 *
 * `params` é o contrato com montarParametros() em
 * "Agente de Suporte e Concierge/src/eventFormat.ts" — a ordem aqui é a ordem
 * de {{1}}, {{2}}… lá. O eval cruza os dois.
 *
 * Idioma: inglês primeiro, pela distribuição real dos telefones entregáveis
 * (US 3.938 · GB 1.713 · SG 1.215 · CA 722 · AU 709 · HK 648). Ver
 * docs/notificacoes/fase0-validacao-telefones.md.
 */

/** Rodapé comum. A promessa é cumprida por src/consent.ts, que reconhece "stop". */
const RODAPE_EN = 'Reply STOP to stop receiving reservation updates.';

const TEMPLATES = [
  {
    nome: 'twk_reservation_received',
    evento: 'pedido_recebido',
    categoria: 'UTILITY',
    idioma: 'en',
    params: ['primeiro_nome', 'restaurante', 'data', 'hora'],
    corpo:
      "Hello {{1}}, we have your request for {{2}} on {{3}} at {{4}} and we're working on it now. " +
      "There's nothing you need to do — I'll write to you here as soon as I have news. " +
      'If anything changes on your side, just reply to this message.',
    rodape: RODAPE_EN,
    // Não afirma mesa. Não promete prazo. Diz o que ele recebe e como agir.
    confirmaMesa: false,
  },
  {
    nome: 'twk_reservation_accepted',
    evento: 'aceito',
    categoria: 'UTILITY',
    idioma: 'en',
    params: ['primeiro_nome', 'restaurante', 'data', 'hora'],
    corpo:
      'Wonderful news, {{1}} — your table at {{2}} is confirmed for {{3}} at {{4}}. ' +
      'Everything is arranged. If you need to change the time, the date or the number of guests, ' +
      'just reply to this message.',
    rodape: RODAPE_EN,
    // ÚNICO template que pode afirmar mesa: o restaurante confirmou de fato.
    confirmaMesa: true,
  },
  {
    nome: 'twk_reservation_declined',
    evento: 'recusado',
    categoria: 'UTILITY',
    idioma: 'en',
    params: ['primeiro_nome', 'restaurante', 'data'],
    corpo:
      "{{1}}, I'm sorry — {{2}} isn't able to host you on {{3}}. I know that's a disappointment. " +
      "Reply to this message and I'll look for an equally special table for the same evening.",
    rodape: RODAPE_EN,
    // "look for", nunca "find": não se promete disponibilidade.
    confirmaMesa: false,
  },
  {
    nome: 'twk_reschedule_proposed',
    evento: 'reagendamento_proposto',
    categoria: 'UTILITY',
    idioma: 'en',
    params: ['primeiro_nome', 'restaurante', 'data_proposta', 'hora_proposta'],
    corpo:
      '{{1}}, {{2}} can offer you {{3}} at {{4}} instead. Reply YES to take it, ' +
      "or tell me what would suit you better and I'll see what I can do.",
    rodape: RODAPE_EN,
    confirmaMesa: false,
    // BLOQUEADO: reschedule_proposed_date/time estão vazias em 100% das linhas
    // de `reservations` (verificado 2026-09-21). Só submeter depois de
    // descobrir onde a plataforma guarda a proposta de reagendamento.
    bloqueado: 'sem fonte de dados: reschedule_proposed_date vazia em toda a tabela',
  },
  {
    nome: 'twk_reservation_cancelled',
    evento: 'cancelado',
    categoria: 'UTILITY',
    idioma: 'en',
    params: ['primeiro_nome', 'restaurante', 'data'],
    corpo:
      '{{1}}, your reservation at {{2}} on {{3}} has been cancelled. ' +
      "Nothing further is needed from you. Whenever you'd like another evening, " +
      'just reply to this message.',
    rodape: RODAPE_EN,
    confirmaMesa: false,
  },
];

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

module.exports = { TEMPLATES, RODAPE_EN, contarPlaceholders, placeholdersContiguos, porEvento };
