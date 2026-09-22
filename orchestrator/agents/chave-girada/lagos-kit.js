#!/usr/bin/env node
'use strict';
/**
 * Operação Lagos — gera o KIT DE VISITA para as casas de Lagos (sem enviar nada).
 *
 *   node lagos-kit.js                    → gera tudo a partir de orchestrator/state/lagos/alvos-lagos-2026-09-16.csv
 *   node lagos-kit.js --alvos <csv>      → outra lista
 *
 * Saída em orchestrator/state/lagos/:
 *   cartas/E-<id>-pt.html   Extrato de Resposta (casas que respondem em nome próprio: segmentos A/B) — renderizador aprovado (extratos.js)
 *   cartas/P-<id>-pt.html   Apresentação (casas silenciosas) — blocos TWK, argumento = demanda real, sem cobrança
 *   ficha-visita-lagos.html Caderno interno de rota (uma página por casa: números, contato, argumento, checklist)
 *   manifesto-lagos.csv     o que foi gerado, para quem, com que números
 *
 * Regras (código, não prompt):
 *   - casa com tier X-* (opt-out / grupo com opt-out) → nada é gerado; entra no manifesto como EXCLUIDA;
 *   - tokens de cobrança proibidos nas cartas às casas (TOKENS_PROIBIDOS do Extrato); a ficha é interna e pode dizer "sem resposta";
 *   - rodapé de opt-out obrigatório em toda carta (guardrail 8);
 *   - só promete o que existe hoje no painel: pedidos num painel, resposta num toque pelo telemóvel, horários/fechamentos, política de reserva.
 *     NÃO promete WhatsApp, selo, comissão zero nem "dois minutos" (o cadastro passa por revisão até a correção 5 do cadrage).
 *   - o botão aponta para /register com utm; quando o front publicar o link pré-verificado (?claim=<token>), regerar com --claim.
 * Envio é SEMPRE outra etapa, com aprovação do fundador.
 */
const fs = require('node:fs');
const path = require('node:path');
const { gerarExtrato, mascararEmail, TOKENS_PROIBIDOS } = require('./extratos.js');
const B = require('./n8n/_blocos-twk.js');
const { rodape: rodapeOptout, exigirOptout } = require('../registro-optout/rodape-optout');

const RAIZ = path.resolve(__dirname, '..', '..', '..');
const ST = path.join(RAIZ, 'orchestrator', 'state', 'lagos');
const a = process.argv.slice(2);
const val = (n, d) => { const i = a.indexOf(n); return i >= 0 && a[i + 1] ? a[i + 1] : d; };
const alvosCsv = val('--alvos', path.join(ST, 'alvos-lagos-2026-09-16.csv'));
const PUBLICADOS = 1546;      // db_restaurants published=true, banco 15/09/2026
const CONFIRMADORES = 11;     // casas que aceitam tudo o que veem (PLANO-CHAVE-GIRADA)
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const mesAno = (iso) => { if (!iso) return null; const [y, m] = iso.split('-'); return `${MESES[+m - 1]} de ${y}`; };
const cta = (id) => `https://manager.theworldkeys.com/register?utm_source=visita&utm_campaign=lagos-2026-09&utm_content=r${id}`;

const linhas = fs.readFileSync(alvosCsv, 'utf8').split(/\r?\n/).filter(Boolean);
const cols = linhas[0].split(';');
const alvos = linhas.slice(1).map((l) => Object.fromEntries(l.split(';').map((v, i) => [cols[i], v])));
fs.mkdirSync(path.join(ST, 'cartas'), { recursive: true });

// ---------- Apresentação PT-PT para casa silenciosa (argumento: demanda real; nunca cobrança) ----------
function apresentacao(x) {
  const casa = x.name;
  const desde = mesAno(x.primeiro);
  const n180 = +x.p180, n90 = +x.p90, total = +x.pedidos_total;
  const email = mascararEmail(x.email);
  const numero = n180 >= 3
    ? { valor: String(n180), baixo: `clientes pediram mesa em ${casa} pela The World Keys nos últimos seis meses` }
    : { valor: String(total), baixo: `clientes pediram mesa em ${casa} pela The World Keys${desde ? `, desde ${desde}` : ''}` };
  const verao = n90 >= 5 ? `Só entre junho e setembro foram ${n90}, muitos deles para o próprio dia.` : `Uma parte deles pede mesa para o próprio dia.`;
  const L = {
    titulo: 'Muito prazer: somos a The World Keys.',
    preheader: `A plataforma que já leva clientes a ${casa}, e a conta da casa, gratuita, para gerir tudo num toque.`,
    saudacao: `Olá, equipa de ${casa}!`,
    empresa: [
      `Somos uma plataforma de reservas gastronómicas nascida em Paris. O nosso trabalho é aproximar quem gosta de comer bem dos restaurantes que valem a viagem: de mesas premiadas pelo Guia Michelin a pequenas joias locais.`,
      `Hoje reunimos 1.546 restaurantes em mais de 200 cidades de mais de 40 países, e mais de 22 mil clientes usam a plataforma para encontrar e reservar a próxima mesa. Em Lagos são 25 casas, e ${casa} é uma delas.`,
    ],
    depois: [
      verao,
      `A página de ${casa} já está publicada, sem nenhum custo. O que falta é que ela esteja nas vossas mãos: os horários reais, os dias de fecho, a política de reserva, e cada pedido respondido por vocês.`,
      `A conta da casa, gratuita, serve exatamente para isso. Não substitui a forma como reservam hoje: complementa-a, para os clientes que descobrem ${casa} pela The World Keys.`,
    ],
    contaTitulo: 'A conta da casa',
    contaItens: [
      'Horários de funcionamento e períodos de fecho na página: nos dias fechados, o formulário não aceita pedidos.',
      'Todos os pedidos num único painel, com o histórico completo, e resposta com um toque pelo telemóvel.',
      'A política de reserva e os dados da página nas vossas mãos.',
    ],
    cta: 'Ativar a conta da casa',
    ativarTitulo: 'Como ativar, em três passos',
    ativarItens: [
      'Abram o link e escolham "My restaurant is already on the site".',
      email ? `Um código de 6 dígitos chega em ${email}.` : 'Um código de 6 dígitos chega ao e-mail de reservas da casa.',
      'Introduzam o código e criem a palavra-passe.',
    ],
    ajuda: 'Se preferirem, respondam a este e-mail ou digam-nos quando passar por aí: ativamos a conta consigo e acertamos horários e fechos da página.',
    fecho: `É um prazer ter ${casa} na The World Keys.`,
    abraco: 'Um abraço,',
    assinatura: ['Márlon Andrade', 'Gerente Comercial · The World Keys'],
  };
  const rodapeInstitucional = `        <tr><td align="center" style="padding:24px 20px 28px 20px; border-top:1px solid #26200F;">
          <p style="margin:0 0 4px 0; font-family:Georgia,'Times New Roman',serif; font-size:13px; letter-spacing:3px; color:#8F8368;">THE WORLD KEYS</p>
          <p style="margin:0 0 10px 0; font-family:Arial,Helvetica,sans-serif; font-size:11px; line-height:1.8; color:#6E6551;">
            <a href="https://theworldkeys.com/terms-of-use/" style="color:#8F8368; text-decoration:none;">Terms &amp; Conditions</a> &nbsp;&#183;&nbsp; <a href="mailto:support@theworldkeys.com" style="color:#8F8368; text-decoration:none;">support@theworldkeys.com</a><br/>
            66, Av. des Champs-&#201;lys&#233;es, 75008 Paris, France<br/>
            VAT: FR24901268326 &#183; R.C.S Paris: 901 268 326 &#183; &#169; 2026 The World Keys
          </p>
          ${rodapeOptout('pt', x.restaurant_id).replace('color:#8a8a8a', 'color:#6E6551').replace('font-size:12px', 'font-size:11px').replace(/<a /g, '<a style="color:#8F8368;" ')}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
  const assinaturaHtml = `        <tr><td style="padding:22px 28px 8px 28px;">
          <p style="margin:0 0 18px 0; font-family:Arial,Helvetica,sans-serif; font-size:15px; line-height:1.65; color:#B5AB93;">${esc(L.fecho)}</p>
          <p style="margin:0 0 6px 0; font-family:Arial,Helvetica,sans-serif; font-size:15px; color:#B5AB93;">${esc(L.abraco)}</p>
          <p style="margin:0; font-family:Georgia,'Times New Roman',serif; font-size:16px; color:#F5EFE3;">${esc(L.assinatura[0])}</p>
          <p style="margin:2px 0 0 0; font-family:Arial,Helvetica,sans-serif; font-size:12px; color:#8F8368;">${esc(L.assinatura[1])}</p>
        </td></tr>`;
  const html = [
    B.cabeca(L.titulo, L.preheader, 'pt'),
    B.paragrafo(esc(L.saudacao)),
    ...L.empresa.map((p) => B.paragrafo(esc(p))),
    B.cartaoNumero(esc(casa), esc(numero.valor), esc(numero.baixo)),
    ...L.depois.map((p) => B.paragrafo(esc(p))),
    B.passos(L.contaTitulo, L.contaItens.map(esc)),
    B.botao(cta(x.restaurant_id), L.cta),
    B.passos(L.ativarTitulo, L.ativarItens.map(esc)),
    B.paragrafo(esc(L.ajuda), '#8F8368', 13),
    assinaturaHtml,
    rodapeInstitucional,
  ].join('\n');
  const visivel = html.replace(/<[^>]+>/g, ' ');
  const hit = TOKENS_PROIBIDOS.find((re) => re.test(visivel));
  if (hit) throw new Error(`${casa}: token proibido na apresentação: ${hit}`);
  if (/reservation@/i.test(html)) throw new Error(`${casa}: reservation@ visível`);
  exigirOptout(html, `${casa} pt`);
  return { html, assunto: `${casa}, muito prazer: somos a The World Keys`, tipo: 'P' };
}

// ---------- Ficha interna de visita ----------
function fichaCasa(x, i) {
  const email = String(x.email || '');
  const emailTipo = /gmail|hotmail|yahoo|sapo|outlook|live\./i.test(email) ? 'gratuito' : email ? 'próprio' : 'sem e-mail';
  const arg = x.segmento === 'S-SILENCIOSA'
    ? `${x.p180} clientes escolheram ${x.name} pela The World Keys em seis meses; ${x.vencidos180} ficaram sem resposta. Com a conta, o pedido chega e vocês respondem num toque.`
    : x.segmento === 'A-CONFIRMADOR'
      ? `Vocês aceitaram ${x.aceites180} pedidos em nome próprio pelo link. Poucas casas fazem isso. A conta tira o trabalho do e-mail e põe no telemóvel.`
      : `Vocês responderam a ${x.resp_propria180} pedidos pelo link (${x.aceites180} sim, ${x.recusas180} não). A conta deixa a página pedir só o que a casa pode dar.`;
  const mapa = x.latitude && x.longitude ? `https://maps.google.com/?q=${x.latitude},${x.longitude}` : '';
  return `<article class="casa">
  <header><span class="n">${i + 1}</span><h2>${esc(x.name)}</h2><span class="tier">${esc(x.tier)} · ${esc(x.segmento)}</span></header>
  <div class="grid">
    <div class="nums">
      <div><b>${esc(x.p180)}</b><span>pedidos · 180 d</span></div>
      <div><b>${esc(x.p90)}</b><span>pedidos · 90 d</span></div>
      <div><b>${esc(x.mesmo_dia90)}</b><span>para o próprio dia · 90 d</span></div>
      <div><b>${esc(x.vencidos180)}</b><span>sem resposta · 180 d</span></div>
      <div><b>${esc(x.resp_propria180)}</b><span>respostas em nome próprio</span></div>
      <div><b>${esc(x.vivos)}</b><span>pedidos vivos hoje</span></div>
    </div>
    <dl>
      <dt>Telefone</dt><dd>${esc(x.tel)}</dd>
      <dt>E-mail do catálogo</dt><dd>${esc(email)} <em>(${emailTipo})</em></dd>
      <dt>Endereço</dt><dd>${esc(x.endereco)} ${mapa ? `· <a href="${mapa}">mapa</a>` : ''}</dd>
      <dt>Site</dt><dd>${esc(x.site_url)}</dd>
      <dt>Ativação</dt><dd><a href="${cta(x.restaurant_id)}">${cta(x.restaurant_id)}</a></dd>
      ${x.nota ? `<dt>Atenção</dt><dd class="warn">${esc(x.nota)}</dd>` : ''}
    </dl>
  </div>
  <p class="arg"><b>Argumento em uma frase:</b> ${esc(arg)}</p>
  <ul class="check">
    <li>☐ Atendeu? ☐ sim ☐ não ☐ recado · Quem trata das reservas: ________ · melhor hora: ________ · WhatsApp: ________</li>
    <li>☐ Como recebem reservas hoje? ☐ WhatsApp ☐ telefone ☐ sistema próprio: ________ ☐ e-mail</li>
    <li>☐ Horários reais confirmados · ☐ dias de fecho · ☐ tamanho máximo de grupo</li>
    <li>☐ Link enviado por WhatsApp durante a chamada · ☐ conta ativada na chamada · ☐ ativação assistida marcada: ____/__ às ____ · ☐ travou no passo: ________</li>
    <li>☐ Fotos pedidas por WhatsApp (se as atuais forem fracas) · ☐ autorização para citar a casa</li>
    <li>☐ "Quem mais em Lagos deveria ter isto?" ________</li>
  </ul>
</article>`;
}

const manifesto = ['tier;segmento;restaurant_id;nome;tipo_carta;arquivo;assunto;p180;p90;aceites180;recusas180;resp_propria180;vencidos180;email_tipo;nota'];
const fichas = [];
let gerados = 0, excluidas = 0;
for (const [i, x] of alvos.entries()) {
  if (x.tier.startsWith('X-')) { excluidas++; manifesto.push([x.tier, x.segmento, x.restaurant_id, x.name, 'EXCLUIDA', '', '', x.p180, x.p90, x.aceites180, x.recusas180, x.resp_propria180, x.vencidos180, '', x.nota].join(';')); continue; }
  let carta;
  if (x.segmento === 'S-SILENCIOSA') {
    carta = apresentacao(x);
  } else {
    const r = gerarExtrato({ segmento: x.segmento, idioma: 'pt', casa: { name: x.name }, n: { pedidos: +x.p180, aceitos: +x.aceites180, recusados: +x.recusas180 }, ctx: { confirmadores: CONFIRMADORES, publicados: PUBLICADOS, email: x.email, cta_url: cta(x.restaurant_id) }, restaurant_id: x.restaurant_id });
    carta = { html: r.html, assunto: r.assunto, tipo: 'E' };
  }
  const arq = path.join(ST, 'cartas', `${carta.tipo}-${x.restaurant_id}-pt.html`);
  fs.writeFileSync(arq, carta.html);
  gerados++;
  const emailTipo = /gmail|hotmail|yahoo|sapo|outlook|live\./i.test(x.email) ? 'gratuito' : x.email ? 'proprio' : 'sem';
  manifesto.push([x.tier, x.segmento, x.restaurant_id, x.name, carta.tipo, path.relative(RAIZ, arq).replace(/\\/g, '/'), carta.assunto, x.p180, x.p90, x.aceites180, x.recusas180, x.resp_propria180, x.vencidos180, emailTipo, x.nota].join(';'));
  fichas.push(fichaCasa(x, fichas.length));
}
fs.writeFileSync(path.join(ST, 'manifesto-lagos.csv'), manifesto.join('\n') + '\n');

const ficha = `<!DOCTYPE html><html lang="pt"><head><meta charset="utf-8"><title>Operação Lagos · caderno de ligações · 2026-09</title>
<style>
body{font-family:Georgia,serif;color:#1d2029;background:#fff;margin:0;padding:24px;max-width:900px}
h1{font-weight:normal;font-size:28px;margin:0 0 4px}.sub{color:#5f5d6e;font-family:Arial,sans-serif;font-size:13px;margin-bottom:24px}
.casa{border-top:2px solid #9e7c48;padding:18px 0 22px;page-break-inside:avoid}
.casa header{display:flex;align-items:baseline;gap:12px}.casa h2{margin:0;font-weight:normal;font-size:22px}.n{font-size:20px;color:#9e7c48}.tier{font-family:Arial,sans-serif;font-size:11px;color:#5f5d6e;letter-spacing:.05em}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:10px}
.nums{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.nums div{border:1px solid #d6cfbf;padding:8px}.nums b{display:block;font-size:22px;font-weight:normal}.nums span{font-family:Arial,sans-serif;font-size:11px;color:#5f5d6e}
dl{margin:0;font-family:Arial,sans-serif;font-size:13px}dt{color:#5f5d6e;font-size:11px;letter-spacing:.06em;text-transform:uppercase;margin-top:6px}dd{margin:0;word-break:break-word}.warn{color:#a8463a;font-weight:bold}
.arg{background:#f4f1ea;padding:10px 12px;font-size:15px}.check{font-family:Arial,sans-serif;font-size:13px;list-style:none;padding:0;margin:8px 0 0}.check li{margin:4px 0}
@media print{body{padding:0}.casa{page-break-after:always}}
</style></head><body>
<h1>Operação Lagos · caderno de ligações</h1>
<div class="sub">Gerado em ${new Date().toISOString().slice(0, 10)} · fonte: alvos-lagos-2026-09-16.csv (banco twk_auth via twk_ro, 15/09) · ${fichas.length} casas na lista · ${excluidas} fora de contato (opt-out de grupo) · ligar terça a quinta, 14h30–17h de Lagos (15h30–18h Paris) · documento interno</div>
${fichas.join('\n')}
</body></html>`;
fs.writeFileSync(path.join(ST, 'ficha-visita-lagos.html'), ficha);
console.log(`cartas geradas : ${gerados} (E = Extrato, P = Apresentação) em orchestrator/state/lagos/cartas/`);
console.log(`excluídas      : ${excluidas} (ver manifesto)`);
console.log(`ficha de visita: orchestrator/state/lagos/ficha-visita-lagos.html`);
console.log(`manifesto      : orchestrator/state/lagos/manifesto-lagos.csv`);
console.log('\nNADA foi enviado. Envio é outra etapa, com aprovação do fundador.');
