#!/usr/bin/env node
'use strict';
/**
 * Operação Lagos por e-mail — ENVIO de um toque da sequência (T1, T2 ou T3), pelo canal do MAESTRO
 * (webhook n8n "MAESTRO — Enviar email", que compensa o quoted-printable e envia pelo Gmail da casa).
 *
 *   node sequencia-enviar.js --toque 1                                  → DRY-RUN: lista o que sairia, valida, não envia
 *   node sequencia-enviar.js --toque 1 --apply --aprovacao "<ref>"      → envia
 *   node sequencia-enviar.js --toque 1 --teste --para <email>           → cópia [TESTE] de UMA casa (--apenas <id>) para a caixa indicada
 *   --apenas 69949,70105   → só estas casas · --excluir 70041 → menos estas
 *
 * Guardrails em código (falhar alto):
 *   1. --apply exige --aprovacao; 2. Registro de Opt-out consultado por casa (escopo outreach; registro ilegível = nenhum envio);
 *   3. casa publicada e e-mail lido do banco NA HORA (nunca gravado em estado, só o domínio); 4. anti-duplicata pelo ledger
 *   (campanha+casa+toque); 5. T2/T3 só saem se não houver resposta registrada no manifesto (coluna `resultado`) — a leitura de
 *   cliques/respostas é humana ou do MAESTRO antes do lote; 6. exigirOptout() em cada HTML; 7. máx. 25 por execução;
 *   8. corpo sem cercas de markdown; 9. auditoria em orchestrator/logs/audit-<data>.jsonl.
 */
const fs = require('node:fs');
const path = require('node:path');
const { exigirOptout } = require('../registro-optout/rodape-optout');
const registro = require('../registro-optout/registro');
const db = require('../guardiao-reserva/db');
(function env() { const f = process.env.TWK_REGENCIA_ENV || path.join(process.env.USERPROFILE || process.env.HOME || '', '.twk', 'regencia.env'); try { for (const l of fs.readFileSync(f, 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim(); } } catch {} })();

const RAIZ = path.resolve(__dirname, '..', '..', '..');
const ST = path.join(RAIZ, 'orchestrator', 'state', 'lagos');
const MANIFESTO = path.join(ST, 'emails', 'sequencia-manifesto.csv');
const LEDGER = path.join(RAIZ, 'orchestrator', 'state', 'envios-fundadores-2026-08.csv');
const LOGS = path.join(RAIZ, 'orchestrator', 'logs');
const CAMPANHA = 'lagos_sequencia_2026_09';
const MAX = 25;
const WEBHOOK = process.env.EMAIL_WEBHOOK_URL || '';
const TOKEN = process.env.EMAIL_WEBHOOK_TOKEN || '';
const a = process.argv.slice(2);
const flag = (n) => a.includes(n);
const val = (n, d = null) => { const i = a.indexOf(n); return i >= 0 && a[i + 1] ? a[i + 1] : d; };
const toque = `T${val('--toque', '1')}`;
const apply = flag('--apply'), teste = flag('--teste');
const aprovacao = val('--aprovacao');
const paraTeste = val('--para');
const apenas = new Set((val('--apenas', '') || '').split(',').map((s) => s.trim()).filter(Boolean));
const excluir = new Set((val('--excluir', '') || '').split(',').map((s) => s.trim()).filter(Boolean));
const hoje = () => new Date().toISOString().slice(0, 10);
const trace = 'trc-lagos-20260916';
const audit = (o) => { try { fs.mkdirSync(LOGS, { recursive: true }); fs.appendFileSync(path.join(LOGS, `audit-${hoje()}.jsonl`), JSON.stringify({ ts: new Date().toISOString(), trace_id: trace, agente: 'chave-girada', campanha: CAMPANHA, toque, ...o }) + '\n'); } catch {} };

function lerCsv(p) { const L = fs.readFileSync(p, 'utf8').split(/\r?\n/).filter(Boolean); const c = L[0].split(';'); return L.slice(1).map((l) => Object.fromEntries(l.split(';').map((v, i) => [c[i], v]))); }

async function main() {
  if (apply && !aprovacao) { console.error('BLOQUEADO: --apply exige --aprovacao "<referência da aprovação do fundador>"'); process.exit(2); }
  if (teste && (!paraTeste || !/@/.test(paraTeste) || apenas.size !== 1)) { console.error('BLOQUEADO: --teste exige --para <email> e --apenas <um id>'); process.exit(2); }
  if ((apply || teste) && (!WEBHOOK || !TOKEN)) { console.error('BLOQUEADO: EMAIL_WEBHOOK_URL/TOKEN ausentes'); process.exit(2); }
  const RES = path.join(ST, 'emails', 'resultados.csv');
  const resultados = fs.existsSync(RES) ? Object.fromEntries(lerCsv(RES).map((r) => [r.restaurant_id, r.resultado])) : {};
  const linhas = lerCsv(MANIFESTO).filter((r) => r.toque === toque).map((r) => ({ ...r, resultado: r.resultado || resultados[r.restaurant_id] || '' }));
  const ledger = fs.existsSync(LEDGER) ? fs.readFileSync(LEDGER, 'utf8').split(/\r?\n/).slice(1).filter(Boolean).map((l) => l.split(';')) : [];
  const jaEnviado = (rid, t) => ledger.some((l) => l[0] === rid && l[2] === CAMPANHA && l[3] === t && l[4] !== '0');
  const reg = await registro.carregarAuto();
  console.log(`registro de opt-out: ${reg.fonte}`);
  const fila = [];
  for (const r of linhas) {
    const rid = r.restaurant_id;
    if (apenas.size && !apenas.has(rid)) continue;
    if (excluir.has(rid)) { console.log(`  - ${r.nome}: excluída por --excluir`); continue; }
    if (r.tier.startsWith('X-')) { console.log(`  - ${r.nome}: fora de contato (tier ${r.tier})`); continue; }
    if (!teste && jaEnviado(rid, toque)) { console.log(`  - ${r.nome}: ${toque} já enviado (ledger)`); continue; }
    if ((r.resultado || '').trim() === 'bounce') { console.log(`  - ${r.nome}: e-mail devolvido em envio anterior; não sai até o contato ser corrigido`); continue; }
    if (toque !== 'T1' && (r.resultado || '').trim()) { console.log(`  - ${r.nome}: já reagiu (${r.resultado}); ${toque} não sai`); continue; }
    const b = registro.bloqueiaContato(rid, reg, 'outreach');
    if (b.bloqueado) { console.log(`  - ${r.nome}: BLOQUEADA pelo registro (${b.motivo})`); audit({ evento: 'bloqueado_optout', restaurant_id: rid }); continue; }
    const html = fs.readFileSync(path.join(RAIZ, r.arquivo_html), 'utf8');
    if (/```/.test(html)) { console.error(`BLOQUEADO: ${r.nome} contém cerca de markdown`); process.exit(5); }
    exigirOptout(html, `${r.nome} ${toque}`);
    fila.push({ ...r, html });
  }
  if (fila.length > MAX) { console.error(`BLOQUEADO: ${fila.length} > máximo ${MAX} por execução`); process.exit(5); }
  console.log(`\n${toque}: ${fila.length} e-mail(s) na fila${apply ? '' : teste ? ' (teste)' : ' (dry-run)'}`);
  for (const r of fila) console.log(`  · ${r.nome} — ${r.assunto}`);
  if (!apply && !teste) { console.log('\nDRY-RUN — nada enviado.'); return; }

  const destinos = await db.comCliente(async (c) => (await c.query('SELECT restaurant_id, published, email_for_reservations e FROM public.db_restaurants WHERE restaurant_id = ANY($1)', [fila.map((r) => r.restaurant_id)])).rows);
  let ok = 0, falhas = 0;
  for (const r of fila) {
    const d = destinos.find((x) => String(x.restaurant_id) === r.restaurant_id);
    if (!teste && (!d || d.published !== true)) { console.log(`  ✗ ${r.nome}: não publicada`); falhas++; continue; }
    if (!teste && (!d.e || !/@/.test(d.e))) { console.log(`  ✗ ${r.nome}: sem e-mail no catálogo`); falhas++; continue; }
    const para = teste ? paraTeste : d.e.trim();
    const assunto = teste ? `[TESTE] ${r.assunto}` : r.assunto;
    const resp = await fetch(WEBHOOK, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` }, body: JSON.stringify({ para, assunto, html: r.html }) });
    audit({ evento: teste ? 'email_teste' : 'email_envio', restaurant_id: r.restaurant_id, ok: resp.ok, http: resp.status, aprovacao_ref: aprovacao, destino_dominio: String(para).split('@')[1] });
    if (resp.ok) {
      ok++;
      const linha = [r.restaurant_id, r.nome, CAMPANHA, toque, teste ? 0 : 1, 'email', para, 'pt', `n8n-${resp.status}`, hoje(), 'maestro', aprovacao || 'teste', trace, '', '', '', '', teste ? 'TESTE; não conta como toque' : `sequência Lagos ${toque}; opt-out no rodapé`].join(';');
      fs.appendFileSync(LEDGER, '\n' + linha);
      console.log(`  ✓ ${r.nome} → ${String(para).replace(/^[^@]*/, '***')} (HTTP ${resp.status})`);
    } else { falhas++; console.log(`  ✗ ${r.nome}: HTTP ${resp.status}`); }
  }
  console.log(`\nenviados: ${ok} · falhas: ${falhas}. CONFERIR na caixa (pasta Enviados) o link de pelo menos uma mensagem.`);
  if (falhas) process.exit(1);
}
main().catch((e) => { audit({ evento: 'falha', erro: e.message }); console.error('ERRO', e.message); process.exit(1); });
