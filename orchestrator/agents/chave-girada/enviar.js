#!/usr/bin/env node
'use strict';
/**
 * Chave Girada — envio do lote de Extratos por E-MAIL, pelo canal do MAESTRO (webhook n8n "MAESTRO — Enviar email",
 * Gmail da casa). Quem RESPONDE ao restaurante depois é a Aria (a resposta cai em reservation@/support@ → FLUXO 6/7).
 *
 *   node enviar.js                                   → DRY-RUN: lista o que sairia, valida tudo, não envia
 *   node enviar.js --apply --aprovacao "<ref>"       → envia; <ref> = referência da aprovação do fundador (ex.: "chat 2026-09-04 'aprovo os Extratos dos confirmadores'")
 *   node enviar.js --segmento A-CONFIRMADOR          → restringe o lote (padrão: todos os segmentos)
 *   node enviar.js --excluir 35219,17986             → exclui casas (ex.: SRI TRAT até a variante C ser revisada)
 *
 * Guardrails em código: aprovação obrigatória para --apply · Registro de Opt-out consultado (escopo outreach) · exigirOptout()
 * em cada HTML · anti-duplicata pelo ledger (campanha+restaurante) · máx. 40 envios por execução · destinatário lido do banco
 * na hora do envio e NUNCA gravado em estado (só o domínio) · ledger no mesmo formato da campanha de fundadores.
 */
const fs = require('node:fs');
const path = require('node:path');
const { exigirOptout } = require('../registro-optout/rodape-optout');
const registro = require('../registro-optout/registro');
const db = require('../guardiao-reserva/db');

// segredos fora do OneDrive (mesmo arquivo da Regência)
(function env() { const f = process.env.TWK_REGENCIA_ENV || path.join(process.env.USERPROFILE || process.env.HOME || '', '.twk', 'regencia.env'); try { for (const l of fs.readFileSync(f, 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim(); } } catch {} })();

const RAIZ = path.resolve(__dirname, '..', '..', '..');
const ST = path.join(RAIZ, 'orchestrator', 'state', 'chave-girada');
const LEDGER = path.join(RAIZ, 'orchestrator', 'state', 'envios-fundadores-2026-08.csv'); // ledger único de envios a estabelecimentos
const LOGS = path.join(RAIZ, 'orchestrator', 'logs');
const CAMPANHA = 'chave_girada_2026_09';
const MAX_POR_EXECUCAO = 40;
const WEBHOOK = process.env.EMAIL_WEBHOOK_URL || '';
const TOKEN = process.env.EMAIL_WEBHOOK_TOKEN || '';

const a = process.argv.slice(2);
const flag = (n) => a.includes(n);
const val = (n, d = null) => { const i = a.indexOf(n); return i >= 0 && a[i + 1] ? a[i + 1] : d; };
const apply = flag('--apply');
const aprovacao = val('--aprovacao');
const segmento = val('--segmento');
const excluir = new Set((val('--excluir', '') || '').split(',').map((s) => s.trim()).filter(Boolean));
const apenas = new Set((val('--apenas', '') || '').split(',').map((s) => s.trim()).filter(Boolean)); // --apenas 253542 → só estas casas
const teste = flag('--teste'); // envio de teste: entra no ledger com touch 0 e nota "teste", não bloqueia envio real futuro
const paraOverride = val('--para'); // --teste --para <email>: destino alternativo (ex.: caixa da equipe), nunca em envio real
const hoje = () => new Date().toISOString().slice(0, 10);
const trace = `trc-chave-${hoje().replace(/-/g, '')}`;
const audit = (o) => { try { fs.mkdirSync(LOGS, { recursive: true }); fs.appendFileSync(path.join(LOGS, `audit-${hoje()}.jsonl`), JSON.stringify({ ts: new Date().toISOString(), trace_id: trace, agente: 'chave-girada', ...o }) + '\n'); } catch {} };

async function main() {
  if (apply && !aprovacao) { console.error('--apply exige --aprovacao "<referência da aprovação do fundador>"'); process.exit(2); }
  const manifesto = fs.readFileSync(path.join(ST, 'manifesto-extratos.csv'), 'utf8').split(/\r?\n/).filter(Boolean);
  const cols = manifesto[0].split(';');
  let itens = manifesto.slice(1).map((l) => Object.fromEntries(l.split(';').map((v, i) => [cols[i], v])));
  if (segmento) itens = itens.filter((x) => x.segmento === segmento);
  if (apenas.size) itens = itens.filter((x) => apenas.has(x.restaurant_id));
  itens = itens.filter((x) => !excluir.has(x.restaurant_id));
  if (paraOverride && !teste) { console.error('--para só é permitido junto com --teste'); process.exit(2); }

  // 1. Registro de opt-out — fail-closed
  const reg = await registro.carregarAuto();
  // 2. anti-duplicata
  const ledger = fs.existsSync(LEDGER) ? fs.readFileSync(LEDGER, 'utf8').split(/\r?\n/).slice(1).filter(Boolean).map((l) => l.split(';')) : [];
  const jaEnviados = new Set(ledger.filter((l) => l[2] === CAMPANHA && l[4] !== '0').map((l) => l[0])); // touch 0 = teste, não conta

  const plano = []; const bloqueados = [];
  for (const it of itens) {
    const b = registro.bloqueiaContato(it.restaurant_id, reg, 'outreach');
    if (b.bloqueado) { bloqueados.push({ ...it, motivo: b.motivo }); continue; }
    if (jaEnviados.has(it.restaurant_id)) { bloqueados.push({ ...it, motivo: 'já enviado nesta campanha (ledger)' }); continue; }
    const html = fs.readFileSync(path.join(ST, 'extratos', it.arquivo), 'utf8').replace(/^<!--[\s\S]*?-->\s*<!--[\s\S]*?-->\s*/, '');
    try { exigirOptout(html, it.nome); } catch (e) { bloqueados.push({ ...it, motivo: e.message }); continue; }
    plano.push({ ...it, html });
    if (plano.length >= MAX_POR_EXECUCAO) break;
  }

  console.log(`modo: ${apply ? 'APPLY' : 'DRY-RUN'} · registro: ${reg.fonte} · candidatos: ${itens.length} · a enviar: ${plano.length} · bloqueados: ${bloqueados.length}`);
  for (const b of bloqueados) console.log(`  ✗ ${b.nome} (${b.restaurant_id}): ${b.motivo}`);
  for (const p of plano) console.log(`  → [${p.segmento}] ${p.nome} · ${p.cidade} · ${p.idioma} · "${p.assunto.slice(0, 70)}"`);
  if (!apply) { audit({ evento: 'dry_run', candidatos: itens.length, a_enviar: plano.length, bloqueados: bloqueados.length }); return; }
  if (!WEBHOOK || !TOKEN) { console.error('EMAIL_WEBHOOK_URL/TOKEN ausentes'); process.exit(3); }

  // 3. envio. Destinatários lidos numa ÚNICA conexão antes do loop: abrir uma conexão por e-mail
  // derrubou o lote de 06/09 no meio (timeout). O ledger passa a ser gravado A CADA ENVIO — se o
  // script morrer, o que já saiu está registrado e a retomada não duplica.
  let destinos = {};
  if (!paraOverride) {
    destinos = await db.comCliente(async (c) => {
      const r = await c.query('SELECT restaurant_id, email_for_reservations e FROM public.db_restaurants WHERE restaurant_id = ANY($1)', [plano.map((p) => p.restaurant_id)]);
      return Object.fromEntries(r.rows.map((x) => [String(x.restaurant_id), x.e]));
    });
  }
  let ok = 0; const linhas = [];
  for (const p of plano) {
    const para = paraOverride || destinos[p.restaurant_id];
    if (!para || !/@/.test(para)) { audit({ evento: 'email_pulado', restaurant_id: p.restaurant_id, motivo: 'sem e-mail no catálogo' }); continue; }
    const assunto = teste ? `[TESTE] ${p.assunto}` : p.assunto;
    const r = await fetch(WEBHOOK, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` }, body: JSON.stringify({ para, assunto, html: p.html }) });
    audit({ evento: teste ? 'email_teste' : 'email_envio', restaurant_id: p.restaurant_id, segmento: p.segmento, ok: r.ok, http: r.status, aprovacao_ref: aprovacao, destino_dominio: String(para).split('@')[1] });
    if (r.ok) {
      ok++;
      const linha = [p.restaurant_id, p.nome, CAMPANHA, `EXTRATO-${p.segmento}`, teste ? 0 : 1, 'email', para, p.idioma, `n8n-${r.status}`, hoje(), 'maestro', aprovacao, trace, p.pedidos_180d, p.aceitos, '', '', teste ? 'TESTE a pedido do fundador; não conta como toque' : `extrato ${p.segmento}; opt-out no rodapé`].join(';');
      linhas.push(linha);
      fs.appendFileSync(LEDGER, '\n' + linha); // grava JÁ: se cair, não reenvia
    }
    await new Promise((res) => setTimeout(res, 1500));
  }
  console.log(`enviados: ${ok}/${plano.length} · ledger: ${path.relative(RAIZ, LEDGER)}`);
  audit({ evento: 'lote_concluido', enviados: ok, planejados: plano.length, aprovacao_ref: aprovacao });
}
main().catch((e) => { audit({ evento: 'falha', erro: e.message }); console.error('FALHOU:', e.message); process.exit(1); });
