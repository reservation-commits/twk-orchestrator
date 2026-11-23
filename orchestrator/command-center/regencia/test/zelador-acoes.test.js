'use strict';
/** Zelador de Ações (ADR-021): cartões vencidos negados, ações repetidas e estagnadas descartadas, nada aprovado, idempotente; o analista reaproveita tema parecido. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Z = require('../../zelador-acoes.js');
const sentinels = require('../../sentinels.js');

const AGORA = Date.parse('2026-11-23T12:00:00Z');
const d = (dias) => new Date(AGORA - dias * 86_400_000).toISOString();
const acao = (o) => ({ id: 'AC-' + Math.random().toString(36).slice(2, 8), status: 'aberta', origem: 'analista', agente: 'suporte', severidade: 'media', titulo: 'x', criado_em: d(10), atualizado_em: d(10), ocorrencias: 1, ...o });
const apr = (o) => ({ id: 'APR-' + Math.random().toString(36).slice(2, 8), status: 'pendente', tipo: 'envio_externo', agente: 'guardiao', criado_em: d(30), ...o });

test('aprovações: degrau 4 com mesa passada → negada; mesa futura → fica; lote degrau 1 velho → negado; lote de hoje → fica; já decididas não mudam', () => {
  const aprovacoes = [
    apr({ id: 'APR-PASSOU', titulo: '[Guardião] Degrau 4 — avisar cliente da reserva ABC (CASA, mesa em 5h)', criado_em: d(30) }),
    apr({ id: 'APR-FUTURA', titulo: '[Guardião] Degrau 4 — avisar cliente da reserva DEF (LOFOTEN, mesa em 1391h)', criado_em: d(30) }),
    apr({ id: 'APR-LOTE-VELHO', titulo: '[Guardião] Degrau 1 — lote de 17 e-mails a restaurantes (19 reservas)', criado_em: d(3) }),
    apr({ id: 'APR-LOTE-HOJE', titulo: '[Guardião] Degrau 1 — lote de 9 e-mails a restaurantes (10 reservas)', criado_em: d(1) }),
    apr({ id: 'APR-OUTRA', titulo: 'Reembolso ao cliente X', tipo: 'reembolso', agente: 'financeiro' }),
    apr({ id: 'APR-JA', status: 'aprovada', titulo: '[Guardião] Degrau 4 — avisar cliente da reserva GHI (CASA, mesa em 2h)' }),
  ];
  const { decisoes, resumo } = Z.planejar({ acoes: [], aprovacoes, agora: AGORA });
  assert.deepEqual(decisoes.map((x) => [x.id, x.regra, x.decisao]).sort(), [['APR-LOTE-VELHO', 'A2', 'negar'], ['APR-PASSOU', 'A1', 'negar']]);
  assert.equal(resumo.aprovacoes_negadas, 2);
  assert.ok(decisoes.every((x) => x.decisao !== 'aprovar' && x.motivo.length > 20), 'nunca aprova; sempre com motivo');
});

test('ações do analista: mesmo tema no mesmo agente → fica a mais recente; tema diferente fica; estagnada há 22 dias → descartada; vigia não é tocada', () => {
  const acoes = [
    acao({ id: 'AC-QUILL-1', agente: 'editorial', titulo: 'Restaurar o serviço do Quill: /api/kpis responde 502 há 5 colheitas consecutivas', atualizado_em: d(27), criado_em: d(27) }),
    acao({ id: 'AC-QUILL-2', agente: 'editorial', titulo: 'Tratar o 502 do Quill como incidente de disponibilidade, não só falha de colheita', atualizado_em: d(26), criado_em: d(26) }),
    acao({ id: 'AC-QUILL-3', agente: 'editorial', titulo: 'Restaurar o serviço do Quill: /api/kpis responde 502 em 6 de 6 snapshots', atualizado_em: d(4), criado_em: d(4) }),
    acao({ id: 'AC-LAT-1', agente: 'suporte', titulo: 'Consertar medição de latência da Aria: latenciaFerramentaMs=0 em 4 de 5 dias', atualizado_em: d(25), criado_em: d(25) }),
    acao({ id: 'AC-LAT-2', agente: 'suporte', titulo: 'Corrigir telemetria de latência da Aria que reporta 0ms', atualizado_em: d(3), criado_em: d(3) }),
    acao({ id: 'AC-CSAT', agente: 'suporte', titulo: 'Instrumentar CSAT de estabelecimento e plataforma, hoje ambos nulos', atualizado_em: d(30), criado_em: d(30) }),
    acao({ id: 'AC-NOVA', agente: 'dba', titulo: 'Corrigir geodado do LI BAI (20485): cidade Singapore com país Malaysia', atualizado_em: d(2), criado_em: d(2) }),
    acao({ id: 'AC-VIGIA', origem: 'vigia', agente: 'editorial', regra: 'colheita_falhou', titulo: 'Central sem leitura dos KPIs deste agente', atualizado_em: d(40), criado_em: d(40) }),
    acao({ id: 'AC-FECHADA', status: 'descartada', agente: 'suporte', titulo: 'Instrumentar CSAT de estabelecimento', atualizado_em: d(1) }),
  ];
  const { decisoes } = Z.planejar({ acoes, aprovacoes: [], agora: AGORA });
  const por = Object.fromEntries(decisoes.map((x) => [x.id, x]));
  assert.equal(por['AC-QUILL-1'].regra, 'B1'); assert.equal(por['AC-QUILL-1'].mantida, 'AC-QUILL-3');
  assert.ok(['B1', 'B2'].includes(por['AC-QUILL-2'].regra), 'título muito diferente: cai como repetição ou como estagnada, nunca fica'); // régua estrita de propósito: tema vizinho não é o mesmo tema
  assert.equal(por['AC-LAT-1'].regra, 'B1'); assert.equal(por['AC-LAT-1'].mantida, 'AC-LAT-2');
  assert.equal(por['AC-CSAT'].regra, 'B2', 'estagnada há 30 dias, sem par');
  assert.equal(por['AC-QUILL-3'], undefined); assert.equal(por['AC-LAT-2'], undefined); assert.equal(por['AC-NOVA'], undefined);
  assert.equal(por['AC-VIGIA'], undefined, 'vigia não é do zelador'); assert.equal(por['AC-FECHADA'], undefined);
  assert.equal(decisoes.length, 4);
});

test('aplicar grava, audita e é idempotente; ensaio não grava', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'twk-zelador-'));
  const acoes = [
    acao({ id: 'AC-A', agente: 'dba', titulo: 'Retomar verificação de catálogo: zero registros verificados em 30 dias', atualizado_em: d(20) }),
    acao({ id: 'AC-B', agente: 'dba', titulo: 'Retomar verificação de catálogo: zero verificados em 37 dias', atualizado_em: d(2) }),
  ];
  sentinels.writeActions(dir, acoes);
  fs.writeFileSync(path.join(dir, 'aprovacoes.jsonl'), JSON.stringify(apr({ id: 'APR-X', titulo: '[Guardião] Degrau 4 — avisar cliente da reserva ABC (CASA, mesa em 5h)' })) + '\n');
  const ensaio = Z.aplicar(dir, { agora: AGORA, ensaio: true });
  assert.equal(ensaio.acoes_descartadas, 1); assert.equal(ensaio.aprovacoes_negadas, 1);
  assert.equal(sentinels.readActions(dir).find((x) => x.id === 'AC-A').status, 'aberta', 'ensaio não grava');
  const r1 = Z.aplicar(dir, { agora: AGORA });
  assert.equal(r1.acoes_descartadas, 1); assert.equal(r1.aprovacoes_negadas, 1);
  const depois = sentinels.readActions(dir);
  assert.equal(depois.find((x) => x.id === 'AC-A').status, 'descartada'); assert.equal(depois.find((x) => x.id === 'AC-A').descartada_por, 'zelador'); assert.equal(depois.find((x) => x.id === 'AC-A').mantida_em, 'AC-B');
  assert.equal(depois.find((x) => x.id === 'AC-B').status, 'aberta');
  const aprs = fs.readFileSync(path.join(dir, 'aprovacoes.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(aprs[0].status, 'negada'); assert.equal(aprs[0].decidido_por, 'zelador'); assert.match(aprs[0].motivo, /já passou/);
  const audit = fs.readdirSync(path.join(dir, 'logs')).filter((f) => f.startsWith('audit-'));
  assert.equal(audit.length, 1);
  const eventos = fs.readFileSync(path.join(dir, 'logs', audit[0]), 'utf8').trim().split('\n').map(JSON.parse).filter((e) => e.evento === 'zelador_acoes');
  assert.equal(eventos.length, 2);
  const r2 = Z.aplicar(dir, { agora: AGORA });
  assert.equal(r2.acoes_descartadas, 0); assert.equal(r2.aprovacoes_negadas, 0, 'segunda passada não muda nada');
  assert.equal(Z.ultimo(dir).em, new Date(AGORA).toISOString());
});

test('temaParecido: o analista reaproveita a ação aberta do mesmo tema e agente; tema diferente ou agente diferente não', () => {
  const abertas = [
    acao({ id: 'AC-1', agente: 'editorial', regra: 'analista:restaurar-o-servico-do-quill', titulo: 'Restaurar o serviço do Quill: /api/kpis responde 502 há 5 colheitas consecutivas' }),
    acao({ id: 'AC-2', agente: 'financeiro', regra: 'analista:healthscore', titulo: 'Recalibrar healthScore: 90 pontos com 30 dias de receita zero mascara a realidade' }),
  ];
  const p = Z.temaParecido('Restaurar o serviço do Quill: /api/kpis em 502 nos 7 snapshots consecutivos', 'editorial', abertas);
  assert.ok(p && p.acao.id === 'AC-1' && p.semelhanca >= 0.45, JSON.stringify(p));
  assert.equal(Z.temaParecido('Restaurar o serviço do Quill: /api/kpis em 502', 'operacao', abertas), null, 'outro agente');
  assert.equal(Z.temaParecido('Conectar leitura de saldo Stripe: saldoDisponivel nulo', 'financeiro', abertas), null, 'outro tema');
  assert.ok(Z.semelhanca('Corrigir fuso da agregação diária do Atlas', 'Corrigir fuso da agregação diária do Atlas: o diário inclui dia futuro') >= 0.45);
});
