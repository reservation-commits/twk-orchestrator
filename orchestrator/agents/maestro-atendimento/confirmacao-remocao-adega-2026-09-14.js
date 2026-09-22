#!/usr/bin/env node
'use strict';
/**
 * Confirmação por escrito da remoção da ADEGA DA MARINA (70626) ao dono, Nuno Maximiano.
 * Pedido de 29/07 (aria_escalations 1), concluído em 14/09 pelo MAESTRO (ADR-016).
 * Em inglês, a língua em que ele escreveu. Sem oferta comercial: ele se opôs formalmente à listagem.
 * Discrição (ADR-015): o atraso se reconhece em uma frase e não se explica.
 * Decisão do fundador (14/09): a carta trata só da ADEGA DA MARINA; a CAMPIMAR fica como está e não é citada.
 *
 *   node confirmacao-remocao-adega-2026-09-14.js                               → preview, não envia
 *   node confirmacao-remocao-adega-2026-09-14.js --apply --aprovacao "<frase>"  → revisa a remoção e envia
 *
 * Antes do envio, fail-closed: a remoção precisa estar de pé (banco: published=false e do_not_relist=true;
 * site: 404 na origem, com cache-buster). Carta que afirma remoção não sai se a remoção não existir.
 * É confirmação de um pedido do próprio dono, não outreach: o opt-out dele não bloqueia esta carta.
 */
const fs = require('node:fs');
const path = require('node:path');
const B = require('../chave-girada/n8n/_blocos-twk.js');

const RAIZ = path.resolve(__dirname, '..', '..', '..');
const STATE = path.join(__dirname, 'state');
const PREV = path.join(STATE, 'previews-remocao-adega-2026-09-14');
const LEDGER = path.join(STATE, 'confirmacao-remocao-adega-2026-09-14.jsonl');
const LOGS = path.join(RAIZ, 'orchestrator', 'logs');
fs.mkdirSync(PREV, { recursive: true });

(function env() {
  const f = path.join(process.env.USERPROFILE || process.env.HOME || '', '.twk', 'regencia.env');
  try {
    for (const l of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
      const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
    }
  } catch {}
})();
const WEBHOOK = process.env.EMAIL_WEBHOOK_URL || '';
const TOKEN = process.env.EMAIL_WEBHOOK_TOKEN || '';

const a = process.argv.slice(2);
const apply = a.includes('--apply');
const aprovacao = (() => { const i = a.indexOf('--aprovacao'); return i >= 0 ? a[i + 1] : null; })();
const hoje = new Date().toISOString().slice(0, 10);
const trace = 'trc-exclusao-20260914';
const audit = (o) => { try { fs.mkdirSync(LOGS, { recursive: true }); fs.appendFileSync(path.join(LOGS, `audit-${hoje}.jsonl`), JSON.stringify({ ts: new Date().toISOString(), trace_id: trace, agente: 'maestro-atendimento', ...o }) + '\n'); } catch {} };

const RESTAURANT_ID = '70626';
const SLUG = 'adega-da-marina';
const PARA = 'nunomaximiano@grupoadm.pt';
const ASSUNTO = 'ADEGA DA MARINA — removal from The World Keys confirmed';

const titulo = 'Your restaurant has been removed';
const rodapeInstitucional = `        <tr><td align="center" style="padding:24px 20px 28px 20px; border-top:1px solid #26200F;">
          <p style="margin:0 0 4px 0; font-family:Georgia,'Times New Roman',serif; font-size:13px; letter-spacing:3px; color:#8F8368;">THE WORLD KEYS</p>
          <p style="margin:0; font-family:Arial,Helvetica,sans-serif; font-size:11px; line-height:1.8; color:#6E6551;">
            <a href="https://theworldkeys.com/terms-of-use/" style="color:#8F8368; text-decoration:none;">Terms &amp; Conditions</a> &nbsp;&#183;&nbsp; <a href="mailto:support@theworldkeys.com" style="color:#8F8368; text-decoration:none;">support@theworldkeys.com</a><br/>
            66, Av. des Champs-&#201;lys&#233;es, 75008 Paris, France<br/>
            VAT: FR24901268326 &#183; R.C.S Paris: 901 268 326 &#183; &#169; 2026 The World Keys
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

const html = [
  B.cabeca(titulo, 'Written confirmation that ADEGA DA MARINA is no longer listed on The World Keys.', 'en'),
  B.paragrafo('Dear Mr Maximiano,'),
  B.paragrafo('I am writing to confirm that ADEGA DA MARINA has been removed from The World Keys, as you asked on 29 July. We are sorry it took us this long to confirm it in writing.'),
  B.cartaoDetalhes([
    B.linha('Restaurant', 'ADEGA DA MARINA, Lagos'),
    B.linha('Page', 'No longer online'),
    B.linha('Requests', 'Stopped'),
    B.linha('Relisting', 'Blocked', true),
  ].join('\n'), 'Removal completed on 14 September 2026'),
  B.paragrafo('The restaurant no longer has a page on the platform and no longer receives booking requests through us. It is also recorded so that it cannot be listed again.'),
  B.paragrafo('We will not contact you or the restaurant again about this listing. If you need anything else regarding your data, you can simply reply to this e-mail.'),
  B.paragrafo('Kind regards,<br/>Aria &#183; The World Keys'),
  rodapeInstitucional,
].join('\n');

async function revisarRemocao() {
  const db = require('../guardiao-reserva/db.js');
  const r = await db.comCliente(async (c) => (await c.query(
    `SELECT published, do_not_relist, ready_pending_photo,
            (SELECT count(*)::int FROM public.reservations WHERE restaurant_id = $1 AND expired_at IS NULL AND booking_status ILIKE 'pend%') AS pendentes_vivas
       FROM public.db_restaurants WHERE restaurant_id = $1`, [RESTAURANT_ID])).rows[0]);
  const url = `https://theworldkeys.com/hospitality/${SLUG}?cb=${Date.now()}`;
  const http = (await fetch(url, { redirect: 'follow', headers: { 'cache-control': 'no-cache' } })).status;
  const falhas = [];
  if (!r) falhas.push('restaurante não encontrado');
  else {
    if (r.published !== false) falhas.push('published não é false');
    if (r.do_not_relist !== true) falhas.push('do_not_relist não é true');
    if (r.ready_pending_photo) falhas.push('ready_pending_photo ligado (republicação em lote reverteria)');
    if (r.pendentes_vivas) falhas.push(`${r.pendentes_vivas} pedido(s) pendente(s) vivo(s)`);
  }
  if (http !== 404) falhas.push(`página responde ${http} na origem, não 404`);
  return { ...r, http, falhas };
}

(async () => {
  const arq = path.join(PREV, 'nuno-maximiano.html');
  fs.writeFileSync(arq, html);
  if (/CAMPIMAR|DOM HENRIQUE/i.test(html)) { console.error('BLOQUEADO: a carta cita outra casa do grupo'); process.exit(5); }

  const rev = await revisarRemocao();
  console.log(`revisão   : published=${rev.published} do_not_relist=${rev.do_not_relist} ready_pending_photo=${rev.ready_pending_photo} pendentes_vivas=${rev.pendentes_vivas} página=${rev.http}`);
  console.log(`para      : ${PARA}`);
  console.log(`assunto   : ${ASSUNTO}`);
  console.log(`preview   : ${arq}`);
  if (rev.falhas.length) { console.error('BLOQUEADO: remoção incompleta — ' + rev.falhas.join('; ')); audit({ evento: 'confirmacao_bloqueada', restaurant_id: RESTAURANT_ID, falhas: rev.falhas }); process.exit(6); }
  if (!apply) { console.log('\nPREVIEW — remoção conferida, nada enviado.'); return; }

  if (!aprovacao || aprovacao.length < 10) { console.error('BLOQUEADO: --apply exige --aprovacao "<frase do fundador>"'); process.exit(3); }
  if (!WEBHOOK || !TOKEN) { console.error('BLOQUEADO: EMAIL_WEBHOOK_URL/TOKEN ausentes'); process.exit(2); }
  const ja = fs.existsSync(LEDGER) && fs.readFileSync(LEDGER, 'utf8').split(/\r?\n/).filter(Boolean).some((l) => JSON.parse(l).ok);
  if (ja) { console.error('BLOQUEADO: confirmação já enviada (ledger) — não reenviar'); process.exit(4); }

  const resp = await fetch(WEBHOOK, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` }, body: JSON.stringify({ para: PARA, assunto: ASSUNTO, html }) });
  const linha = { ts: new Date().toISOString(), tipo: 'confirmacao-remocao', restaurant_id: RESTAURANT_ID, dominio: PARA.replace(/^.*@/, ''), ok: resp.ok, http: resp.status, aprovacao_ref: aprovacao };
  fs.appendFileSync(LEDGER, JSON.stringify(linha) + '\n');
  audit({ evento: 'email_confirmacao_remocao', ...linha });
  console.log(`\nenvio     : HTTP ${resp.status} ${resp.ok ? 'aceito' : 'RECUSADO'}`);
  if (!resp.ok) process.exit(1);
})().catch((e) => { audit({ evento: 'falha', erro: e.message }); console.error('ERRO', e.message); process.exit(1); });
