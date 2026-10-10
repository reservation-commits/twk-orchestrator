'use strict';
/** Eval do medidor de autonomia — linhas sintéticas, nada lido do disco. */
const { classificar, medir, semanaISO } = require('../../medidor-autonomia/medir');
const EXP = (cond, msg) => (cond ? [] : [msg]);
const agora = new Date('2026-10-08T12:00:00Z');
const L = (dias, o) => ({ ts: new Date(agora.getTime() - dias * 86400_000).toISOString(), ...o });

const casos = [
  { nome: 'telemetria é ignorada', run: () => ['tool_use', 'subagent_stop', 'registro_optout_lido'].flatMap((e) => EXP(classificar({ evento: e }).classe === 'ignorada', `${e} não ignorado`)) },
  { nome: 'dry-run nunca conta como ação', run: () => EXP(classificar({ evento: 'execucao', modo: 'dry-run' }).classe === 'ignorada', 'dry-run contou') },
  { nome: 'execução diária/gate/autonomo é autônoma', run: () => ['diario', 'gate', 'horario', 'autonomo'].flatMap((m) => EXP(classificar({ evento: 'execucao', modo: m }).classe === 'autonoma', `modo ${m}`)) },
  { nome: 'sql_escrita com frase é humana; modo autonomo é autônoma', run: () => [...EXP(classificar({ evento: 'sql_escrita', aprovacao_ref: 'fundador…' }).classe === 'humana', 'frase'), ...EXP(classificar({ evento: 'sql_escrita', modo: 'autonomo' }).classe === 'autonoma', 'autonomo')] },
  { nome: 'email_envio com aprovacao_ref é humano', run: () => EXP(classificar({ evento: 'email_envio', aprovacao_ref: 'chat' }).classe === 'humana', 'email aprovado contou como autônomo') },
  { nome: 'aprovacao_solicitada, escrita_bloqueada, execucao_bloqueada, aprovacao_adr são paradas humanas', run: () => ['aprovacao_solicitada', 'escrita_bloqueada', 'execucao_bloqueada', 'aprovacao_adr'].flatMap((e) => EXP(classificar({ evento: e }).classe === 'humana', e)) },
  { nome: 'guardrail_block é trava, fora do denominador (a suíte dos hooks também grava)', run: () => { const m = medir([L(1, { evento: 'guardrail_block', motivo: 'DROP' }), L(1, { evento: 'execucao', modo: 'diario', agente: 'a' })], { dias: 30, agora }); return [...EXP(classificar({ evento: 'guardrail_block' }).classe === 'trava', 'classe'), ...EXP(m.acoes === 1 && m.contagens.trava === 1 && m.lacunas.some((x) => /guardrail/.test(x)), JSON.stringify(m.contagens))]; } },
  { nome: 'resposta a cliente (ADR-014) e exclusão (ADR-016) são autônomas', run: () => ['resposta_cliente_enviada', 'exclusao_carta', 'resposta_restaurante_enviada'].flatMap((e) => EXP(classificar({ evento: e }).classe === 'autonoma', e)) },
  { nome: 'despacho ao fundador é aviso, não ação', run: () => EXP(classificar({ evento: 'despacho_email' }).classe === 'aviso', 'despacho entrou no denominador') },
  { nome: 'falha fica fora do denominador', run: () => EXP(classificar({ evento: 'falha', erro: 'x' }).classe === 'falha', 'falha') },
  { nome: 'politica_avaliada segue a decisão', run: () => [...EXP(classificar({ evento: 'politica_avaliada', decisao: 'autonomo_com_log' }).classe === 'autonoma', 'auto'), ...EXP(classificar({ evento: 'politica_avaliada', decisao: 'requer_aprovacao_humana' }).classe === 'humana', 'humana')] },
  { nome: 'evento desconhecido é ignorado e nomeado (nunca somado em silêncio)', run: () => { const c = classificar({ evento: 'coisa_nova' }); return EXP(c.classe === 'ignorada' && /coisa_nova/.test(c.motivo), JSON.stringify(c)); } },
  { nome: 'taxa = autônomas / (autônomas + humanas), janela respeitada', run: () => {
    const linhas = [L(1, { evento: 'execucao', modo: 'diario', agente: 'a' }), L(2, { evento: 'execucao', modo: 'diario', agente: 'a' }), L(3, { evento: 'aprovacao_solicitada', agente: 'a' }), L(4, { evento: 'despacho_email' }), L(5, { evento: 'tool_use' }), L(40, { evento: 'aprovacao_solicitada', agente: 'a' })];
    const m = medir(linhas, { dias: 30, agora });
    return [...EXP(m.acoes === 3, `acoes=${m.acoes}`), ...EXP(m.taxa_autonomia_pct === 66.7, `taxa=${m.taxa_autonomia_pct}`), ...EXP(m.contagens.aviso === 1 && m.contagens.ignorada === 1, JSON.stringify(m.contagens)), ...EXP(m.por_agente.a.humana === 1, 'janela de 30 dias ignorada')];
  } },
  { nome: 'sem ações → taxa null e lacuna declarada', run: () => { const m = medir([L(1, { evento: 'tool_use' })], { dias: 30, agora }); return EXP(m.taxa_autonomia_pct === null && m.lacunas.some((x) => /indefinida/.test(x)), JSON.stringify(m.lacunas)); } },
  { nome: 'linha ilegível é contada', run: () => { const m = medir([{ evento: '__ilegivel__', ts: '2026-10-07T00:00:00Z' }], { dias: 30, agora }); return EXP(m.contagens.ilegivel === 1 && m.lacunas.some((x) => /ilegíveis/.test(x)), 'ilegível sumiu'); } },
  { nome: 'semana ISO', run: () => EXP(semanaISO(new Date('2026-10-08T00:00:00Z')) === '2026-W41' && semanaISO(new Date('2026-01-01T00:00:00Z')) === '2026-W01', 'semana errada') },
];
module.exports = { casos };
