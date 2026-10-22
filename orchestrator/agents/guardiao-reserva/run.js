#!/usr/bin/env node
'use strict';
/**
 * Guardião da Reserva — runner (cron horário ou manual).
 *
 *   node run.js                       → DRY-RUN: avalia, grava relatório/propostas/fila, NÃO envia, NÃO conta como contato
 *   node run.js --gate                → dry-run + registra o lote do degrau 1 e os rascunhos do degrau 4 na fila de aprovações da Central
 *   node run.js --apply --aprovacao <APR-id>  → envia o lote aprovado via n8n maestro-email (exige aprovação registrada)
 *   node run.js --pause "motivo" | --resume --aprovacao <id>
 *   node run.js --canario "Paris,Athens,Marrakech" --max-emails 20
 *
 * Tudo que o Guardião decide vira uma linha em state/eventos.jsonl com trace_id.
 * Sem registro de opt-out legível → execução inteira bloqueada (fail-closed).
 */
const fs = require('node:fs');
const path = require('node:path');
const { avaliar } = require('./engine');
const templates = require('./templates');
const db = require('./db');
const registro = require('../registro-optout/registro');

const RAIZ = path.resolve(__dirname, '..', '..', '..');
// A1 (2026-10-22): na Central hospedada, TWK_STATE_ROOT aponta para o volume (/app/state) e TUDO que o
// Guardião grava (estado, lote, aprovações, audit) vai para lá — a imagem do container é descartável.
// Sem a variável, os caminhos são os do repositório, como sempre.
const HOSPEDADO = process.env.TWK_STATE_ROOT ? path.resolve(process.env.TWK_STATE_ROOT) : null;
const STATE = HOSPEDADO ? path.join(HOSPEDADO, 'agents', 'guardiao-reserva') : path.join(__dirname, 'state');
const ORCH_STATE = HOSPEDADO || path.join(RAIZ, 'orchestrator', 'state');
const CENTRAL_STATE = HOSPEDADO || path.join(RAIZ, 'orchestrator', 'command-center', 'state');
const LOGS = HOSPEDADO ? path.join(HOSPEDADO, 'logs') : path.join(RAIZ, 'orchestrator', 'logs');
// Credencial do canal de envio: mesma do MAESTRO (n8n maestro-email). Carrega de
// ~/.twk/regencia.env como os demais agentes — antes só olhava process.env com outro
// nome, o que obrigava a passar o token na linha de comando para rodar o lote.
(function env() {
  const f = path.join(process.env.USERPROFILE || process.env.HOME || '', '.twk', 'regencia.env');
  try {
    for (const l of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
      const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
    }
  } catch {}
})();
const N8N_MAESTRO_EMAIL = process.env.N8N_MAESTRO_EMAIL_URL || process.env.EMAIL_WEBHOOK_URL || '';
const N8N_MAESTRO_TOKEN = process.env.N8N_MAESTRO_EMAIL_TOKEN || process.env.EMAIL_WEBHOOK_TOKEN || '';

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const val = (n, d = null) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const hoje = () => new Date().toISOString().slice(0, 10);
const traceId = `trc-guard-${hoje().replace(/-/g, '')}`;

fs.mkdirSync(STATE, { recursive: true });
const appendJsonl = (f, o) => fs.appendFileSync(f, JSON.stringify(o) + '\n', 'utf8');
const audit = (o) => { try { fs.mkdirSync(LOGS, { recursive: true }); appendJsonl(path.join(LOGS, `audit-${hoje()}.jsonl`), { ts: new Date().toISOString(), trace_id: traceId, agente: 'guardiao-reserva', ...o }); } catch {} };
const lerJsonl = (f) => fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) : [];

function contatosMortos() {
  const s = new Set();
  try {
    for (const f of fs.readdirSync(ORCH_STATE).filter((x) => /^contatos-invalidos-.*\.csv$/.test(x))) {
      const linhas = fs.readFileSync(path.join(ORCH_STATE, f), 'utf8').split(/\r?\n/).slice(1);
      for (const l of linhas) { const id = l.split(';')[0].replace(/"/g, '').trim(); if (/^\d+$/.test(id)) s.add(id); }
    }
  } catch {}
  return s;
}

async function main() {
  const pausado = path.join(STATE, 'PAUSADO');
  if (flag('--pause')) { fs.writeFileSync(pausado, JSON.stringify({ ts: new Date().toISOString(), motivo: val('--pause', args[args.indexOf('--pause') + 1] || 'sem motivo') }), 'utf8'); audit({ evento: 'guardiao_pausado' }); console.log('PAUSADO'); return; }
  if (flag('--resume')) { if (!val('--aprovacao')) { console.error('--resume exige --aprovacao <id>'); process.exit(2); } fs.rmSync(pausado, { force: true }); audit({ evento: 'guardiao_retomado', aprovacao_ref: val('--aprovacao') }); console.log('RETOMADO'); return; }
  if (fs.existsSync(pausado)) { const p = JSON.parse(fs.readFileSync(pausado, 'utf8')); audit({ evento: 'execucao_bloqueada', motivo: `pausado: ${p.motivo}` }); console.log('BLOQUEADA: pausado —', p.motivo); process.exit(3); }

  const modo = flag('--apply') ? 'apply' : flag('--gate') ? 'gate' : 'dry-run';
  const aprovacaoRef = val('--aprovacao');
  if (modo === 'apply' && !aprovacaoRef) { console.error('--apply exige --aprovacao <APR-id> (aprovação registrada na Central)'); process.exit(2); }

  // Validação do --apply ANTES de qualquer gravação. Em 11/09 uma execução com aprovação
  // inválida foi barrada só no passo 7, depois de o ledger já ter gravado 68 linhas como
  // 'enviado': nenhum e-mail saiu, mas as casas entraram em cooldown de 24h por um envio
  // que nunca aconteceu — o lote caiu de 42 casas para 1. Um bloqueio não pode deixar rastro
  // de ação executada.
  if (modo === 'apply') {
    if (!N8N_MAESTRO_EMAIL || !N8N_MAESTRO_TOKEN) { audit({ evento: 'execucao_bloqueada', motivo: 'webhook de envio ausente' }); console.error('BLOQUEADA: sem webhook de envio configurado'); process.exit(3); }
    const apr = lerJsonl(path.join(CENTRAL_STATE, 'aprovacoes.jsonl')).find((a) => a.id === aprovacaoRef);
    if (!apr || apr.status !== 'aprovada') {
      audit({ evento: 'execucao_bloqueada', motivo: `aprovação ${aprovacaoRef} inexistente ou não aprovada`, gravou_ledger: false });
      console.error(`BLOQUEADA: aprovação inválida (${aprovacaoRef}) — nada foi gravado.`);
      process.exit(3);
    }
  }
  const agora = new Date(val('--agora') || Date.now());

  // 1. Registro de opt-out (fail-closed).
  let reg = null;
  try { reg = await registro.carregarAuto(); audit({ evento: 'registro_optout_lido', fonte: reg.fonte, registros: reg.atual.size }); }
  catch (e) { audit({ evento: 'execucao_bloqueada', motivo: e.message }); console.error('BLOQUEADA:', e.message); process.exit(3); }

  // 2. Dados (somente leitura).
  const { reservas: reservasBrutas, restaurantes } = await db.carregarPendencias();
  // Reservas resolvidas FORA da plataforma (cliente confirmou por telefone, por exemplo): na base
  // continuam Pending, porque o restaurante nunca respondeu por lá. Sem esta lista, o Guardião cobraria
  // o restaurante por uma mesa já confirmada (caso EVU5Z99H, 14/09). Cada linha exige evidência; nada
  // é forjado no ledger de contatos.
  const resolvidasFora = new Map(lerJsonl(path.join(STATE, 'resolvidas-fora-da-plataforma.jsonl')).map((x) => [x.reservation_code, x]));
  const reservas = reservasBrutas.filter((x) => !resolvidasFora.has(x.reservation_code));
  const ignoradas = reservasBrutas.length - reservas.length;
  if (ignoradas) audit({ evento: 'resolvidas_fora_ignoradas', n: ignoradas, codigos: reservasBrutas.filter((x) => resolvidasFora.has(x.reservation_code)).map((x) => x.reservation_code) });
  const respondedoras = await db.carregarRespondedoras();
  const mortos = contatosMortos();
  const eventos = lerJsonl(path.join(STATE, 'eventos.jsonl'));
  const cfg = { maxEmailsDia: Number(val('--max-emails', 50)) };
  const canario = val('--canario'); if (canario) cfg.cidadesCanario = new Set(canario.split(',').map((s) => s.trim().toLowerCase()));

  // 3. Avaliação (pura).
  const r = avaliar({ agora, reservas, restaurantes, eventos, contatosMortos: mortos, config: cfg,
    bloqueios: { registroDisponivel: true, porRestaurante: (rid) => registro.bloqueiaContato(rid, reg, 'reservations') } });

  if (r.bloqueada) { audit({ evento: 'execucao_bloqueada', motivo: r.motivo }); console.error('BLOQUEADA:', r.motivo); process.exit(3); }

  // 4. Materializar propostas.
  const porCodigo = Object.fromEntries(reservas.map((x) => [x.reservation_code, x]));
  const emails = r.propostas.emails.map((e) => {
    const rest = restaurantes[e.restaurant_id];
    const t = templates.emailRestaurante({ idioma: e.idioma, nome: rest.name, restaurant_id: e.restaurant_id, reservas: e.reservas.map((x) => ({ ...porCodigo[x.reservation_code] })) });
    return { restaurant_id: e.restaurant_id, nome: rest.name, cidade: rest.city, idioma: e.idioma, email_dominio: rest.email_dominio, reservas: e.reservas.map((x) => x.reservation_code), assunto: t.assunto, html: t.html, texto: t.texto };
  });
  const clientes = r.propostas.clientes.map((d) => {
    const rest = restaurantes[d.restaurant_id]; const res = porCodigo[d.reservation_code];
    const alts = respondedoras.filter((a) => a.restaurant_id !== d.restaurant_id && String(a.city || '').toLowerCase() === String(rest.city || '').toLowerCase()).slice(0, 2);
    return { ...templates.rascunhoCliente({ reservation_code: d.reservation_code, restaurante: rest, booking_date: res.booking_date, reservation_time: res.reservation_time, alternativas: alts }), motivo: d.motivo, horas_ate_mesa: d.horas_ate_mesa };
  });
  // Fila de MENSAGENS (não de ligações): inclui o WhatsApp da casa. Voz saiu do sistema em 06/09 — o time não fala os idiomas.
  const fila = r.propostas.fila.map((d) => { const rest = restaurantes[d.restaurant_id]; const res = porCodigo[d.reservation_code]; return { urgencia_h: d.horas_ate_mesa, degrau: d.degrau, canal: d.canal, reservation_code: d.reservation_code, restaurant_id: d.restaurant_id, nome: rest.name, cidade: rest.city, pais: rest.country, idioma: d.idioma, mesa: `${res.booking_date} ${String(res.reservation_time).slice(0, 5)}`, telefone_casa: rest.telefone_casa || '', motivo: d.motivo }; });
  // Urgências de hoje (mesa ≤ 6h): mensagem de WhatsApp pronta, no idioma da casa.
  const urgentes = r.propostas.clientes.filter((d) => d.horas_ate_mesa <= 6).map((d) => { const rest = restaurantes[d.restaurant_id]; const res = porCodigo[d.reservation_code]; return { horas: d.horas_ate_mesa, reservation_code: d.reservation_code, nome: rest.name, cidade: rest.city, telefone_casa: rest.telefone_casa || '', mesa: `${res.booking_date} ${String(res.reservation_time).slice(0, 5)}` }; });

  // 5. Persistir artefatos do dia. Canário grava com sufixo para não sobrescrever a visão completa do dia.
  const dia = hoje() + (canario ? '-canario' : '');
  fs.writeFileSync(path.join(STATE, `propostas-${dia}.json`), JSON.stringify({ trace_id: traceId, modo, canario: canario || null, agora: agora.toISOString(), contagens: r.contagens, anomalias: r.anomalias, emails, clientes, fila }, null, 2), 'utf8');
  fs.writeFileSync(path.join(STATE, `fila-mensagens-${dia}.csv`), ['urgencia_h;degrau;canal;reservation_code;restaurant_id;nome;cidade;pais;idioma;mesa;telefone_casa;motivo', ...urgentes.map((u) => [u.horas, 'HOJE', 'whatsapp', u.reservation_code, '', u.nome, u.cidade, '', '', u.mesa, u.telefone_casa, 'MESA EM ≤6H — mandar a mensagem pronta agora; sem resposta em 2h, avisar o cliente (Aria)'].map((v) => String(v ?? '').replace(/;/g, ',')).join(';')), ...fila.map((f) => [f.urgencia_h, f.degrau, f.canal, f.reservation_code, f.restaurant_id, f.nome, f.cidade, f.pais, f.idioma, f.mesa, f.telefone_casa, f.motivo].map((v) => String(v ?? '').replace(/;/g, ',')).join(';'))].join('\n'), 'utf8');
  fs.writeFileSync(path.join(STATE, `decisoes-${dia}.json`), JSON.stringify(r.decisoes, null, 1), 'utf8');

  // Ledger: dry-run NÃO grava (só decisoes-<data>.json); gate grava 'proposto' e apply 'enviado' — só estes contam como contato.
  // 'enviado' vale SÓ para o degrau 1, que é o único que este runner entrega. O degrau 4
  // (mensagem ao cliente) é rascunho para a Aria e nunca sai daqui — marcá-lo como enviado
  // era registrar ação que não aconteceu, o mesmo defeito da execução barrada de 11/09.
  const decisaoLedger = modo === 'apply' ? 'enviado' : 'proposto';
  const decisaoDe = (acao) => (acao === 'email_restaurante' ? decisaoLedger : 'proposto');
  if (modo !== 'dry-run') for (const d of r.decisoes) appendJsonl(path.join(STATE, 'eventos.jsonl'), { ts: agora.toISOString(), trace_id: traceId, modo, reservation_code: d.reservation_code, restaurant_id: d.restaurant_id, degrau: d.degrau, acao: d.acao, canal: d.canal, motivo: d.motivo, decisao: ['email_restaurante', 'fila_whatsapp', 'fila_whatsapp_urgente', 'mensagem_cliente'].includes(d.acao) ? (d.acao.startsWith('fila') && modo !== 'dry-run' ? 'fila_criada' : decisaoDe(d.acao)) : 'registrado', aprovacao_ref: aprovacaoRef || null, fuso_suposto: d.fuso_suposto });

  // 6. Portão (gate): lote do degrau 1 + rascunhos do degrau 4 na fila da Central.
  if (modo === 'gate') {
    const f = path.join(CENTRAL_STATE, 'aprovacoes.jsonl');
    const id = (p) => `${p}-${agora.toISOString().replace(/[-:TZ.]/g, '').slice(0, 14)}-${Math.random().toString(16).slice(2, 6)}`;
    // Dedup: não repetir cartão pendente do mesmo dia (lote) nem da mesma reserva (degrau 4).
    const pendentes = lerJsonl(f).filter((a) => a.status === 'pendente');
    const jaLote = pendentes.some((a) => a.trace_id === traceId && /Degrau 1/.test(a.titulo));
    const jaCliente = new Set(pendentes.filter((a) => a.handoff && a.handoff.contexto_minimo).map((a) => a.handoff.contexto_minimo.reservation_code));
    const clientesNovos = clientes.filter((c) => !jaCliente.has(c.reservation_code));
    // agente 'guardiao' = o id do Guardião na Central (v4.6): o cartão sai com a identidade dele, não a do MAESTRO.
    if (emails.length && !jaLote) appendJsonl(f, { id: id('APR'), thread_id: traceId, trace_id: traceId, agente: 'guardiao', titulo: `[Guardião] Degrau 1 — lote de ${emails.length} e-mails a restaurantes (${emails.reduce((n, e) => n + e.reservas.length, 0)} reservas)`, tipo: 'envio_externo', justificativa: `Pendências sem resposta ≥24h. Prévia completa em orchestrator/agents/guardiao-reserva/state/propostas-${dia}.json. Aprovar = liberar \`run.js --apply --aprovacao <id>\`. Nenhuma casa com opt-out/published=false incluída (bloqueio por código).`, status: 'pendente', criado_em: agora.toISOString(), lote: emails.map((e) => ({ restaurant_id: e.restaurant_id, nome: e.nome, idioma: e.idioma, reservas: e.reservas, assunto: e.assunto })) });
    for (const c of clientesNovos) appendJsonl(f, { id: id('APR'), thread_id: traceId, trace_id: traceId, agente: 'suporte-concierge', titulo: `[Guardião] Degrau 4 — avisar cliente da reserva ${c.reservation_code} (${c.fatos.restaurante}, mesa em ${c.horas_ate_mesa}h)`, tipo: 'envio_externo', justificativa: `${c.motivo}. Rascunho-base (EN) para a Aria localizar:\n\n${c.texto_base}`, status: 'pendente', criado_em: agora.toISOString(), handoff: { destino: 'suporte-concierge', contexto_minimo: { reservation_code: c.reservation_code, restaurant_id: c.restaurant_id, alternativas: c.fatos.alternativas.map((a) => a.restaurant_id) }, regras: c.regras_para_aria } });
    audit({ evento: 'aprovacao_solicitada', lote: emails.length && !jaLote ? emails.length : 0, clientes: clientesNovos.length, dedup_lote: jaLote, dedup_clientes: clientes.length - clientesNovos.length });
  }

  // 7. Apply: envio do lote do degrau 1 via n8n (Bearer). Só com aprovação. Nunca envia ao cliente (isso é a Aria).
  if (modo === 'apply') {
    if (!N8N_MAESTRO_EMAIL || !N8N_MAESTRO_TOKEN) { audit({ evento: 'execucao_bloqueada', motivo: 'N8N_MAESTRO_EMAIL_URL/TOKEN ausentes' }); console.error('BLOQUEADA: sem webhook de envio configurado'); process.exit(3); }
    const aprs = lerJsonl(path.join(CENTRAL_STATE, 'aprovacoes.jsonl'));
    const apr = aprs.find((a) => a.id === aprovacaoRef);
    if (!apr || apr.status !== 'aprovada') { audit({ evento: 'execucao_bloqueada', motivo: `aprovação ${aprovacaoRef} inexistente ou não aprovada` }); console.error('BLOQUEADA: aprovação inválida'); process.exit(3); }
    let enviados = 0;
    for (const e of emails) {
      // destinatário real só é lido aqui, na hora do envio, e nunca gravado em estado.
      const para = await db.comCliente(async (c) => (await c.query('SELECT email_for_reservations e FROM public.db_restaurants WHERE restaurant_id=$1', [e.restaurant_id])).rows[0]?.e);
      if (!para) continue;
      const resp = await fetch(N8N_MAESTRO_EMAIL, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${N8N_MAESTRO_TOKEN}` }, body: JSON.stringify({ para, assunto: e.assunto, html: e.html }) });
      audit({ evento: 'email_envio', restaurant_id: e.restaurant_id, reservas: e.reservas, ok: resp.ok, http: resp.status, aprovacao_ref: aprovacaoRef });
      if (resp.ok) enviados++;
    }
    console.log(`enviados: ${enviados}/${emails.length}`);
  }

  // 8. Relatório do dia.
  const md = [
    `# Guardião da Reserva — relatório ${dia} (${modo})`,
    `trace \`${traceId}\` · avaliadas ${r.contagens.avaliadas} pendências vivas · agora ${agora.toISOString()}`,
    '', '| Decisão | N |', '|---|---|',
    ...Object.entries(r.contagens).filter(([k]) => k !== 'avaliadas').map(([k, v]) => `| ${k} | ${v} |`),
    '', `Anomalias: ${r.anomalias.length ? r.anomalias.join('; ') : 'nenhuma'}`,
    '', `## Degrau 1 — e-mails propostos (${emails.length} casas)`, '| Casa | Cidade | Idioma | Reservas | Assunto |', '|---|---|---|---|---|',
    ...emails.map((e) => `| ${e.nome} | ${e.cidade} | ${e.idioma} | ${e.reservas.join(', ')} | ${e.assunto.replace(/\|/g, '/')} |`),
    '', `## Fila de mensagens — WhatsApp em texto, no idioma da casa (${fila.length})`, '| h até a mesa | Degrau | Canal | Casa | Cidade | Reserva | Motivo |', '|---|---|---|---|---|---|---|',
    ...fila.map((f) => `| ${f.urgencia_h} | ${f.degrau} | ${f.canal} | ${f.nome} | ${f.cidade} | ${f.reservation_code} | ${f.motivo} |`),
    '', `## Degrau 4 — clientes a avisar via Aria (${clientes.length})`, '| Reserva | Casa | Cidade | h até a mesa | Alternativas | Motivo |', '|---|---|---|---|---|---|',
    ...clientes.map((c) => `| ${c.reservation_code} | ${c.fatos.restaurante} | ${c.fatos.cidade} | ${c.horas_ate_mesa} | ${c.fatos.alternativas.map((a) => a.name).join(' · ') || '—'} | ${c.motivo} |`),
    '', `Fusos supostos (Europe/Paris por falta de timezone): ${r.decisoes.filter((d) => d.fuso_suposto).length}`,
    '', '> Nada foi enviado neste modo.'.replace('neste modo', modo === 'apply' ? 'além do lote aprovado' : 'neste modo'),
  ].join('\n');
  fs.writeFileSync(path.join(STATE, `relatorio-${dia}.md`), md, 'utf8');
  audit({ evento: 'execucao', modo, contagens: r.contagens, anomalias: r.anomalias });
  console.log(md);
}

main().catch((e) => { audit({ evento: 'falha', erro: String(e.message || e) }); console.error('FALHOU:', e.message); process.exit(1); });
