#!/usr/bin/env node
'use strict';
/**
 * Auditor Interno (08/10/2026) — confere, por código, que as regras da constituição e dos ADRs
 * continuam implementadas na frota. Roda na Porta de Qualidade e sozinho:
 *
 *   node orchestrator/auditor/verificar.js [--json]
 *
 * Grava orchestrator/state/auditor.json e orchestrator/logs/auditor/AAAA-MM-DD.md.
 * Sai com 1 se qualquer checagem `hard` reprovar. Checagem que não consegue rodar = reprovada.
 * Zero LLM, zero rede, zero banco (lê só arquivos do repositório e do estado).
 *
 * É o que permite subir o teto de autonomia dos outros com prova em vez de confiança:
 * se uma trava some do código, este arquivo acusa antes de qualquer agente usá-la.
 */
const fs = require('node:fs');
const path = require('node:path');

const RAIZ_PADRAO = path.resolve(__dirname, '..', '..');

const ler = (raiz, rel) => { const p = path.join(raiz, rel); return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null; };
const existe = (raiz, rel) => fs.existsSync(path.join(raiz, rel));
const linhasDeCodigo = (src) => String(src || '').split(/\r?\n/).filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l));

const CHECAGENS = [
  { id: 'A01_outbound_gate', sev: 'hard', regra: 'ADR-015: toda resposta da Aria passa por outboundGate (revisão e opt-in)', run: (raiz) => {
    const rev = ler(raiz, 'Agente de Suporte e Concierge/src/revisao.ts'); const opt = ler(raiz, 'Agente de Suporte e Concierge/src/optIn.ts'); const fmt = ler(raiz, 'Agente de Suporte e Concierge/src/format.ts');
    const ok = !!(fmt && /export function outboundGate/.test(fmt) && rev && /outboundGate\(/.test(rev) && opt && /outboundGate\(/.test(opt));
    return { ok, detalhe: ok ? 'format.ts exporta; revisao.ts e optIn.ts chamam' : `format=${!!fmt} revisao=${!!rev && /outboundGate\(/.test(rev)} optIn=${!!opt && /outboundGate\(/.test(opt)}` };
  } },
  { id: 'A02_aria_sem_prazo', sev: 'hard', regra: 'ADR-015: o prompt da Aria proíbe prometer prazo humano ou de terceiro', run: (raiz) => {
    const sp = ler(raiz, 'Agente de Suporte e Concierge/src/systemPrompt.ts');
    const ok = !!(sp && /NUNCA prometa/.test(sp) && /não tem prazo garantido/.test(sp));
    return { ok, detalhe: ok ? 'regras presentes' : 'systemPrompt.ts sem as frases "NUNCA prometa" / "não tem prazo garantido"' };
  } },
  { id: 'A03_porta_unica_backup', sev: 'hard', regra: 'ADR-013/017: a porta única exige -- backup: e verifica reversibilidade', run: (raiz) => {
    const ex = ler(raiz, 'orchestrator/agents/dba-escrita/executar.js');
    const ok = !!(ex && /function verificarReversibilidade/.test(ex) && /-- backup:/.test(ex) && /nextauth/i.test(ex));
    return { ok, detalhe: ok ? 'verificarReversibilidade + -- backup: + bloqueio nextauth' : 'executar.js sem verificarReversibilidade / -- backup: / nextauth' };
  } },
  { id: 'A04_politicas_validas', sev: 'hard', regra: 'motor de políticas carrega; ativa tem desfazer; nenhuma cobre classe sempre-humana', run: (raiz) => {
    const { carregarPoliticas } = require(path.join(raiz, 'orchestrator/politicas/avaliar.js'));
    const cfg = carregarPoliticas(path.join(raiz, 'orchestrator/politicas/politicas.json'));
    const ativas = cfg.politicas.filter((p) => p.status === 'ativa').length; const props = cfg.politicas.filter((p) => p.status === 'proposta').map((p) => p.id);
    return { ok: true, detalhe: `${ativas} ativas · propostas pendentes: ${props.join(', ') || 'nenhuma'}` };
  } },
  { id: 'A05_clavis_supressao', sev: 'hard', regra: 'ADR-010: CLAVIS consulta supressão/opt-out antes de compor envio', run: (raiz) => {
    const sup = existe(raiz, 'Agente Comercial/service/src/outreach/suppression.ts'); const comp = ler(raiz, 'Agente Comercial/service/src/outreach/composer.ts');
    const ok = sup && !!comp && /suppress|consent|optout|opt_out/i.test(comp);
    return { ok, detalhe: ok ? 'suppression.ts existe e composer.ts a referencia' : `suppression=${sup} composer_referencia=${!!comp && /suppress|consent/i.test(comp)}` };
  } },
  { id: 'A06_quill_sem_rating_falso', sev: 'hard', regra: 'matriz item 01: o gerador de JSON-LD não emite aggregateRating sem review real', run: (raiz) => {
    const j = ler(raiz, 'Agente Editorial/packages/shared/src/seo/jsonld.ts');
    if (!j) return { ok: false, detalhe: 'jsonld.ts não encontrado' };
    const emite = linhasDeCodigo(j).filter((l) => /aggregateRating/.test(l));
    return { ok: emite.length === 0, detalhe: emite.length ? `${emite.length} linha(s) de código emitem aggregateRating — conferir se há review real` : 'aggregateRating só em comentário' };
  } },
  { id: 'A07_reparos_aprovados', sev: 'soft', regra: 'ADR-017: ao menos um reparo determinístico aprovado (senão a autonomia de reparo nunca existe)', run: (raiz) => {
    const r = JSON.parse(ler(raiz, 'orchestrator/agents/sentinela-silencio/reparos-aprovados.json') || '{}');
    const aprovados = Object.entries(r).filter(([k, v]) => k !== '_doc' && v === true).map(([k]) => k);
    return { ok: aprovados.length > 0, detalhe: aprovados.length ? aprovados.join(', ') : 'nenhum procedimento aprovado — todos false' };
  } },
  { id: 'A08_compromissos', sev: 'soft', regra: 'ADR-015: nenhum compromisso com data vencida em aberto', run: (raiz) => {
    const txt = ler(raiz, 'orchestrator/state/compromissos.jsonl'); if (txt === null) return { ok: false, detalhe: 'compromissos.jsonl ausente' };
    const hoje = new Date().toISOString().slice(0, 10); const porId = new Map(); let ilegiveis = 0;
    // O arquivo é append-only: a última linha de cada id é o estado atual.
    for (const l of txt.split(/\r?\n/)) { if (!l.trim()) continue; try { const c = JSON.parse(l); porId.set(c.id, c); } catch { ilegiveis++; } }
    const vencidos = [...porId.values()].filter((c) => c.status === 'aberto' && c.vence_em && c.vence_em < hoje).map((c) => `${c.id} (${c.vence_em}, ${c.dono})`);
    if (ilegiveis) vencidos.push(`${ilegiveis} linha(s) ilegível(is)`);
    return { ok: vencidos.length === 0, detalhe: vencidos.length ? `${vencidos.length} em aberto e vencido(s): ${vencidos.join('; ')}` : `nenhum vencido (${porId.size} compromissos)` };
  } },
  { id: 'A09_hooks_presentes', sev: 'hard', regra: 'ADR-005: guardrails são código — hook de SQL presente e ligado no settings', run: (raiz) => {
    const hook = existe(raiz, '.claude/hooks/guard-sql.ps1'); const st = ler(raiz, '.claude/settings.json') || '';
    const ok = hook && /guard-sql/.test(st);
    return { ok, detalhe: ok ? 'guard-sql.ps1 presente e referenciado' : `hook=${hook} settings_referencia=${/guard-sql/.test(st)}` };
  } },
  { id: 'A10_dba_sem_postgres', sev: 'hard', regra: 'auditoria 21/09: scripts do DBA recusam o papel postgres e preferem ~/.twk/dba.env', run: (raiz) => {
    const c = ler(raiz, 'Agente Gerenciador do Banco de Dados/db-config.js');
    const ok = !!(c && /USUARIO === 'postgres'/.test(c) && /dba\.env/.test(c));
    return { ok, detalhe: ok ? 'recusa postgres; lê dba.env' : 'db-config.js sem a recusa de postgres ou sem dba.env' };
  } },
  { id: 'A11_evals_injecao', sev: 'hard', regra: 'regra 4: há eval de injeção (dado observado não é comando)', run: (raiz) => {
    const dir = path.join(raiz, 'orchestrator/evals'); let n = 0;
    for (const s of fs.readdirSync(dir)) { const f = path.join(dir, s, 'casos.js'); if (fs.existsSync(f) && /inje[cç]/i.test(fs.readFileSync(f, 'utf8'))) n++; }
    return { ok: n >= 1, detalhe: `${n} suíte(s) com casos de injeção` };
  } },
  { id: 'A12_porta_recente', sev: 'soft', regra: 'Porta de Qualidade verde nos últimos 7 dias', run: (raiz) => {
    const p = JSON.parse(ler(raiz, 'orchestrator/state/porta-qualidade.json') || 'null'); if (!p) return { ok: false, detalhe: 'porta-qualidade.json ausente' };
    const idadeH = (Date.now() - new Date(p.rodou_em).getTime()) / 3600_000;
    return { ok: p.verde === true && idadeH <= 168, detalhe: `verde=${p.verde} há ${Math.round(idadeH)}h (${p.checagens_ok} checagens)` };
  } },
  { id: 'A13_autonomia_medida', sev: 'soft', regra: 'taxa de autonomia medida nos últimos 7 dias', run: (raiz) => {
    const a = JSON.parse(ler(raiz, 'orchestrator/state/autonomia.json') || 'null'); if (!a) return { ok: false, detalhe: 'autonomia.json ausente — rodar medidor-autonomia/medir.js' };
    const idadeH = (Date.now() - new Date(a.medido_em).getTime()) / 3600_000;
    return { ok: idadeH <= 168, detalhe: `taxa ${a.taxa_autonomia_pct}% (meta ${a.meta_pct}%) medida há ${Math.round(idadeH)}h` };
  } },
  { id: 'A14_niveis_alinhados', sev: 'hard', regra: 'enum autonomia do contrato de handoff = níveis do motor de políticas', run: (raiz) => {
    const schema = JSON.parse(ler(raiz, 'orchestrator/contracts/handoff.schema.json')); const { NIVEIS } = require(path.join(raiz, 'orchestrator/politicas/avaliar.js'));
    const e = schema.properties.autonomia.enum; const ok = JSON.stringify([...e].sort()) === JSON.stringify([...NIVEIS].sort());
    return { ok, detalhe: ok ? NIVEIS.join(', ') : `contrato=${e.join(',')} motor=${NIVEIS.join(',')}` };
  } },
  { id: 'A15_cadencias', sev: 'soft', regra: 'Sentinela vigia medidor de autonomia e auditor', run: (raiz) => {
    const c = JSON.parse(ler(raiz, 'orchestrator/agents/sentinela-silencio/cadencias.json') || '{"fontes":[]}'); const chaves = c.fontes.map((f) => f.chave);
    const ok = chaves.includes('autonomia_medida') && chaves.includes('auditor_rodou');
    return { ok, detalhe: ok ? 'autonomia_medida e auditor_rodou presentes' : `faltam: ${['autonomia_medida', 'auditor_rodou'].filter((k) => !chaves.includes(k)).join(', ')}` };
  } },
  { id: 'A16_published_nao_derruba', sev: 'soft', regra: 'glossário: despublicar não tira a página do ar — o pedido de remoção só fecha com 404 (correção no front pendente)', run: (raiz) => {
    const rb = ler(raiz, 'docs/runbooks/pedido-de-remocao-estabelecimento.md') || ''; const rd = ler(raiz, 'orchestrator/agents/registro-optout/README.md') || '';
    const ok = /404/.test(rb) || /404/.test(rd);
    return { ok, detalhe: ok ? `critério 404 em ${/404/.test(rd) ? 'registro-optout/README.md' : 'runbook'}; a correção no front continua pendente (Agente de Produto, PROP-104)` : 'nem o runbook de remoção nem o README do registro de opt-out exigem 404' };
  } },
];

function executarChecagens(raiz = RAIZ_PADRAO) {
  return CHECAGENS.map((c) => {
    let r;
    try { r = c.run(raiz) || { ok: false, detalhe: 'sem resultado' }; } catch (e) { r = { ok: false, detalhe: `não rodou: ${e.message}` }; }
    return { id: c.id, sev: c.sev, regra: c.regra, ok: !!r.ok, detalhe: r.detalhe || '' };
  });
}

function relatorioMd(res, quando) {
  const hard = res.filter((r) => r.sev === 'hard'); const hf = hard.filter((r) => !r.ok).length; const sf = res.filter((r) => r.sev === 'soft' && !r.ok).length;
  return [`# Auditor Interno · ${quando.slice(0, 10)}`, '', `hard ${hard.length - hf}/${hard.length} · soft reprovadas ${sf} · **${hf ? 'REPROVADO' : 'APROVADO'}**`, '', '| Checagem | Sev | Resultado | Regra | Detalhe |', '|---|---|---|---|---|', ...res.map((r) => `| ${r.id} | ${r.sev} | ${r.ok ? 'ok' : 'FALHOU'} | ${r.regra} | ${r.detalhe.replace(/\|/g, '/')} |`), ''].join('\n');
}

module.exports = { executarChecagens, relatorioMd, CHECAGENS };

if (require.main === module) {
  const quando = new Date().toISOString();
  const res = executarChecagens();
  const hf = res.filter((r) => r.sev === 'hard' && !r.ok).length;
  fs.mkdirSync(path.join(RAIZ_PADRAO, 'orchestrator/state'), { recursive: true });
  fs.writeFileSync(path.join(RAIZ_PADRAO, 'orchestrator/state/auditor.json'), JSON.stringify({ rodou_em: quando, aprovado: hf === 0, checagens: res }, null, 2), 'utf8');
  const dir = path.join(RAIZ_PADRAO, 'orchestrator/logs/auditor'); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${quando.slice(0, 10)}.md`), relatorioMd(res, quando), 'utf8');
  if (process.argv.includes('--json')) console.log(JSON.stringify(res, null, 2)); else console.log(relatorioMd(res, quando));
  process.exit(hf ? 1 : 0);
}
