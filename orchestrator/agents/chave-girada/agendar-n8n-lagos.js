#!/usr/bin/env node
'use strict';
/**
 * Agenda um toque da sequência Lagos NO n8n HOSPEDADO (não no notebook: o agendador local já falhou em 04/09 e 11/09).
 * Cria um workflow "Lagos — sequência <toque> — <data> <hora> <fuso>" com:
 *   Schedule Trigger (cron no fuso pedido) → Code (trava de data/hora + corpos) → Postgres (e-mail lido do banco NA HORA,
 *   casa publicada, sem opt-out em listing_consent) → Code (junta) → HTTP Request (webhook "MAESTRO — Enviar email",
 *   que compensa quoted-printable e envia pelo Gmail da casa) → Code (resumo).
 *
 *   node agendar-n8n-lagos.js --toque 1 --quando 2026-09-17T10:00 --fuso America/Sao_Paulo                → DRY-RUN (monta, não cria)
 *   node agendar-n8n-lagos.js --toque 1 --quando 2026-09-17T10:00 --fuso America/Sao_Paulo --apply --aprovacao "<ref>"
 *   node agendar-n8n-lagos.js --desativar <workflowId>                                                      → desliga depois de rodar
 *
 * Correção de 17/09: o nó IF "Tem envio?" mandava TODOS os itens ao ramo falso (condição booleana sobre campo ausente).
 * O IF foi removido: o Code "Juntar" devolve lista vazia quando não há nada a enviar, e o n8n para o ramo sozinho.
 * Guardrails: aprovação obrigatória · Registro de Opt-out consultado na montagem (e listing_consent de novo na execução) ·
 * exigirOptout() em cada HTML · nenhum endereço de destinatário gravado no workflow (o Postgres lê na hora) · trava de data
 * dentro do Code (o cron de dia/mês repetiria no ano seguinte se ninguém desativasse) · ledger é escrito DEPOIS, pela leitura
 * da execução (registrar-execucao-n8n.js), nunca antes do envio real.
 */
const fs = require('node:fs');
const path = require('node:path');
const { exigirOptout } = require('../registro-optout/rodape-optout');
const registro = require('../registro-optout/registro');
(function env() { const f = process.env.TWK_REGENCIA_ENV || path.join(process.env.USERPROFILE || process.env.HOME || '', '.twk', 'regencia.env'); try { for (const l of fs.readFileSync(f, 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim(); } } catch {} })();

const RAIZ = path.resolve(__dirname, '..', '..', '..');
const ST = path.join(RAIZ, 'orchestrator', 'state', 'lagos');
const MANIFESTO = path.join(ST, 'emails', 'sequencia-manifesto.csv');
const LOGS = path.join(RAIZ, 'orchestrator', 'logs');
const N8N = 'https://theworldkeys-n8n.xis4ee.easypanel.host';
const envN8n = Object.fromEntries(fs.readFileSync(path.join(RAIZ, 'Agente Gerenciador do Banco de Dados', 'twk-db-agent', '.env.n8n.local'), 'utf8').split(/[\r\n]+/).filter((l) => l && !l.startsWith('#')).map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
const H = { 'X-N8N-API-KEY': envN8n.N8N_API_KEY, accept: 'application/json', 'content-type': 'application/json' };
const WEBHOOK = process.env.EMAIL_WEBHOOK_URL || `${N8N}/webhook/maestro-email`;
const TOKEN = process.env.EMAIL_WEBHOOK_TOKEN || '';
const POSTGRES_CRED = { id: 'QSEOM0Wb5DzGkuXy', name: 'Postgres account 2' }; // mesma credencial do fluxo 1 (nova reserva)

const a = process.argv.slice(2);
const flag = (n) => a.includes(n);
const val = (n, d = null) => { const i = a.indexOf(n); return i >= 0 && a[i + 1] ? a[i + 1] : d; };
const apply = flag('--apply');
const aprovacao = val('--aprovacao');
const toque = `T${val('--toque', '1')}`;
const quando = val('--quando'); // 2026-09-17T10:00 (hora local do fuso)
const fuso = val('--fuso', 'America/Sao_Paulo');
const desativar = val('--desativar');
const hoje = () => new Date().toISOString().slice(0, 10);
const audit = (o) => { try { fs.mkdirSync(LOGS, { recursive: true }); fs.appendFileSync(path.join(LOGS, `audit-${hoje()}.jsonl`), JSON.stringify({ ts: new Date().toISOString(), trace_id: 'trc-lagos-20260916', agente: 'chave-girada', ...o }) + '\n'); } catch {} };
const lerCsv = (p) => { const L = fs.readFileSync(p, 'utf8').split(/\r?\n/).filter(Boolean); const c = L[0].split(';'); return L.slice(1).map((l) => Object.fromEntries(l.split(';').map((v, i) => [c[i], v]))); };

async function main() {
  if (desativar) {
    const r = await fetch(`${N8N}/api/v1/workflows/${desativar}/deactivate`, { method: 'POST', headers: H });
    console.log(`desativar ${desativar}: HTTP ${r.status}`); audit({ evento: 'n8n_workflow_desativado', workflowId: desativar, http: r.status }); return;
  }
  if (!quando || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(quando)) { console.error('--quando exige AAAA-MM-DDTHH:MM (hora local do --fuso)'); process.exit(2); }
  if (apply && !aprovacao) { console.error('BLOQUEADO: --apply exige --aprovacao'); process.exit(2); }
  if (!TOKEN) { console.error('BLOQUEADO: EMAIL_WEBHOOK_TOKEN ausente'); process.exit(2); }
  const [data, hora] = quando.split('T'); const [Y, M, D] = data.split('-').map(Number); const [hh, mm] = hora.split(':').map(Number);
  const reg = await registro.carregarAuto();
  const RES = path.join(ST, 'emails', 'resultados.csv');
  const resultados = fs.existsSync(RES) ? Object.fromEntries(lerCsv(RES).map((r) => [r.restaurant_id, r.resultado])) : {};
  const linhas = lerCsv(MANIFESTO).map((r) => ({ ...r, resultado: r.resultado || resultados[r.restaurant_id] || '' }))
    .filter((r) => r.toque === toque && !r.tier.startsWith('X-') && (r.resultado || '').trim() !== 'bounce' && !(toque !== 'T1' && (r.resultado || '').trim()));
  const corpos = [];
  for (const r of linhas) {
    const b = registro.bloqueiaContato(r.restaurant_id, reg, 'outreach');
    if (b.bloqueado) { console.log(`  - ${r.nome}: BLOQUEADA pelo registro (${b.motivo})`); continue; }
    const html = fs.readFileSync(path.join(RAIZ, r.arquivo_html), 'utf8');
    if (/```/.test(html)) { console.error(`BLOQUEADO: ${r.nome} contém cerca de markdown`); process.exit(5); }
    exigirOptout(html, `${r.nome} ${toque}`);
    corpos.push({ rid: r.restaurant_id, nome: r.nome, assunto: r.assunto, html });
  }
  if (!corpos.length || corpos.length > 25) { console.error(`BLOQUEADO: ${corpos.length} corpos (esperado 1–25)`); process.exit(5); }
  console.log(`registro: ${reg.fonte} · ${toque} · ${corpos.length} casas · ${quando} ${fuso}`);
  for (const c of corpos) console.log(`  · ${c.nome} — ${c.assunto}`);

  const nome = `Lagos — sequência ${toque} — ${data} ${hora} ${fuso}`;
  const guard = `const tz='${fuso}'; const now=new Date(); const p=new Intl.DateTimeFormat('en-CA',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hour12:false}).formatToParts(now); const g=(t)=>p.find(x=>x.type===t).value; const data=g('year')+'-'+g('month')+'-'+g('day'); const hora=Number(g('hour'));\nif (data!=='${data}' || hora!==${hh}) { return [{ json: { skip: true, motivo: 'fora da janela '+data+' '+hora } }]; }\n`;
  const nodes = [
    { parameters: { rule: { interval: [{ field: 'cronExpression', expression: `${mm} ${hh} ${D} ${M} *` }] } }, name: 'Agenda', type: 'n8n-nodes-base.scheduleTrigger', typeVersion: 1.2, position: [0, 0] },
    { parameters: { jsCode: `${guard}const corpos = ${JSON.stringify(corpos)};\nreturn corpos.map(c => ({ json: c }));` }, name: 'Corpos + trava de data', type: 'n8n-nodes-base.code', typeVersion: 2, position: [240, 0] },
    { parameters: { operation: 'executeQuery', query: `SELECT restaurant_id, email_for_reservations AS para FROM public.db_restaurants WHERE published = true AND restaurant_id IN (${corpos.map((c) => `'${c.rid}'`).join(',')}) AND restaurant_id NOT IN (SELECT restaurant_id::text FROM public.listing_consent WHERE status = 'opted_out')`, options: {} }, name: 'Destinos (banco, na hora)', type: 'n8n-nodes-base.postgres', typeVersion: 2.5, position: [480, 200], credentials: { postgres: POSTGRES_CRED }, alwaysOutputData: true, executeOnce: true },
    { parameters: { jsCode: `const corpos = $('Corpos + trava de data').all().map(i => i.json).filter(c => !c.skip);\nif (!corpos.length) return [];\nconst dest = $input.all().map(i => i.json).filter(d => d && d.para && /@/.test(d.para));\nconst out = [];\nfor (const c of corpos) { const d = dest.find(x => String(x.restaurant_id) === String(c.rid)); if (d) out.push({ json: { rid: c.rid, nome: c.nome, para: String(d.para).trim(), assunto: c.assunto, html: c.html } }); }\nreturn out;` }, name: 'Juntar', type: 'n8n-nodes-base.code', typeVersion: 2, position: [720, 0] },
    { parameters: { method: 'POST', url: WEBHOOK, sendHeaders: true, headerParameters: { parameters: [{ name: 'authorization', value: `Bearer ${TOKEN}` }] }, sendBody: true, specifyBody: 'json', jsonBody: '={{ JSON.stringify({ para: $json.para, assunto: $json.assunto, html: $json.html }) }}', options: { batching: { batch: { batchSize: 1, batchInterval: 4000 } } } }, name: 'MAESTRO — Enviar email', type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, position: [1200, -100], onError: 'continueRegularOutput' },
    { parameters: { jsCode: `return $input.all().map((i, k) => ({ json: { k, rid: $('Juntar').all()[k]?.json.rid, nome: $('Juntar').all()[k]?.json.nome, dominio: String($('Juntar').all()[k]?.json.para || '').split('@')[1], ok: !i.json.error, resposta: i.json } }));` }, name: 'Resumo', type: 'n8n-nodes-base.code', typeVersion: 2, position: [1440, -100] },
  ];
  const connections = {
    Agenda: { main: [[{ node: 'Corpos + trava de data', type: 'main', index: 0 }]] },
    'Corpos + trava de data': { main: [[{ node: 'Destinos (banco, na hora)', type: 'main', index: 0 }]] },
    'Destinos (banco, na hora)': { main: [[{ node: 'Juntar', type: 'main', index: 0 }]] },
    Juntar: { main: [[{ node: 'MAESTRO — Enviar email', type: 'main', index: 0 }]] },
    'MAESTRO — Enviar email': { main: [[{ node: 'Resumo', type: 'main', index: 0 }]] },
  };
  const wf = { name: nome, nodes, connections, settings: { executionOrder: 'v1', timezone: fuso, saveManualExecutions: true, saveDataSuccessExecution: 'all', saveDataErrorExecution: 'all' } };
  fs.mkdirSync(path.join(ST, 'n8n'), { recursive: true });
  const dump = path.join(ST, 'n8n', `workflow-${toque}-${data}.json`);
  fs.writeFileSync(dump, JSON.stringify({ ...wf, nodes: wf.nodes.map((n) => n.name === 'MAESTRO — Enviar email' ? { ...n, parameters: { ...n.parameters, headerParameters: { parameters: [{ name: 'authorization', value: 'Bearer <EMAIL_WEBHOOK_TOKEN>' }] } } } : n) }, null, 2));
  console.log(`\nworkflow montado: ${path.relative(RAIZ, dump)} (cron "${mm} ${hh} ${D} ${M} *" em ${fuso}; trava de data no Code)`);
  if (!apply) { console.log('DRY-RUN — nada criado no n8n.'); return; }
  const cr = await fetch(`${N8N}/api/v1/workflows`, { method: 'POST', headers: H, body: JSON.stringify(wf) });
  const cj = await cr.json().catch(() => ({}));
  if (!cr.ok || !cj.id) { audit({ evento: 'n8n_workflow_falha', http: cr.status, erro: JSON.stringify(cj).slice(0, 300) }); console.error(`FALHA ao criar: HTTP ${cr.status} ${JSON.stringify(cj).slice(0, 300)}`); process.exit(1); }
  const ar = await fetch(`${N8N}/api/v1/workflows/${cj.id}/activate`, { method: 'POST', headers: H });
  audit({ evento: 'n8n_workflow_agendado', workflowId: cj.id, nome, toque, quando, fuso, casas: corpos.map((c) => c.rid), aprovacao_ref: aprovacao, ativado: ar.ok });
  fs.appendFileSync(path.join(ST, 'n8n', 'agendamentos.jsonl'), JSON.stringify({ ts: new Date().toISOString(), workflowId: cj.id, nome, toque, quando, fuso, casas: corpos.length, aprovacao_ref: aprovacao, ativado: ar.ok }) + '\n');
  console.log(`\nCRIADO e ${ar.ok ? 'ATIVADO' : 'NÃO ativado (HTTP ' + ar.status + ')'}: ${cj.id} — ${nome}\n${N8N}/workflow/${cj.id}`);
  if (!ar.ok) process.exit(1);
}
main().catch((e) => { audit({ evento: 'falha', erro: e.message }); console.error('ERRO', e.message); process.exit(1); });
