#!/usr/bin/env node
'use strict';
/**
 * Campanha de fundadores — versão de APRESENTAÇÃO para AI MERCANTI (Veneza, 18546).
 * Pedido do fundador (14/09): converter a casa com urgência, apresentando quem somos e oferecendo a conta de
 * gerenciamento de forma amigável e atraente. Sai em italiano (a língua da casa); o pt é a leitura do fundador.
 *
 *   node fundadores-apresentacao-ai-mercanti-2026-09-14.js --idioma it|pt                → preview, não envia
 *   node fundadores-apresentacao-ai-mercanti-2026-09-14.js --teste --para <email>        → cópia [TESTE] (it)
 *   node fundadores-apresentacao-ai-mercanti-2026-09-14.js --apply --aprovacao "<frase>"  → envia à casa (it)
 *
 * Só fatos verificáveis (consulta de 2026-09-14): 1.546 restaurantes publicados, 203 cidades, 43 países,
 * 22.966 clientes (nextauth."User"), 325 casas publicadas com prêmio Michelin (restaurant_awards).
 * Demanda da casa: 5 pedidos de mesa desde dez/2024 (3 clientes); os dois mais recentes são para outubro.
 * Da conta, só o que existe e já foi dito em templates aprovados: painel único com histórico, resposta com
 * um toque pelo celular, horários/política de reserva/dados da página. NÃO: fotos, comissão zero, selo,
 * prioridade, "pronto em dois minutos" (o cadastro passa por revisão da equipe — está escrito na tela).
 *
 * A dor da casa, nas palavras dela (Gmail 193d4aba1b8901ea, 17/12/2024, resposta ao pedido de 24/12/2024):
 * "the restaurant is closed that day. The only way to book in our restaurant is by following this link"
 * (aimercanti.prenota-web.it). Por isso: a conta não substitui o sistema deles, complementa; e o fechamento
 * bloqueia datas no formulário público (verificado no HTML da página: closureBlockedDate / "Restaurant closed
 * during this period"). NÃO se afirma que a conta edita fechamentos (tela não verificada): a ajuda oferece
 * acertar horários e fechamentos junto com eles, sem prazo.
 *
 * Botão direto para /register, não pelo /go: o /go redireciona para /admin, que abre a tela de LOGIN, e os
 * passos mandam escolher "My restaurant is already on the site", opção que só existe em /register
 * (verificado no navegador em 14/09). O rótulo é citado em inglês porque a tela é em inglês.
 * Discrição (ADR-015): nada de "não parceiro". Tokens proibidos do Extrato validados. Opt-out obrigatório.
 * Nenhum reservation@ visível; só support@ no rodapé.
 */
const fs = require('node:fs');
const path = require('node:path');
const B = require('./n8n/_blocos-twk.js');
const { TOKENS_PROIBIDOS, mascararEmail } = require('./extratos.js');
const { rodape: rodapeOptout, exigirOptout } = require('../registro-optout/rodape-optout');

(function env() { const f = process.env.TWK_REGENCIA_ENV || path.join(process.env.USERPROFILE || process.env.HOME || '', '.twk', 'regencia.env'); try { for (const l of fs.readFileSync(f, 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim(); } } catch {} })();

const a = process.argv.slice(2);
const val = (n, d = null) => { const i = a.indexOf(n); return i >= 0 && a[i + 1] ? a[i + 1] : d; };
const apply = a.includes('--apply');
const teste = a.includes('--teste');
const aprovacao = val('--aprovacao');
const paraTeste = val('--para');
const idioma = val('--idioma', apply || teste ? 'it' : 'pt');

const RAIZ = path.resolve(__dirname, '..', '..', '..');
const PREV = path.join(RAIZ, 'orchestrator', 'state', 'chave-girada', 'previews-fundadores');
const LEDGER = path.join(RAIZ, 'orchestrator', 'state', 'envios-fundadores-2026-08.csv');
const LOGS = path.join(RAIZ, 'orchestrator', 'logs');
fs.mkdirSync(PREV, { recursive: true });
const CAMPANHA = 'fundadores_apresentacao_2026_09';
const WEBHOOK = process.env.EMAIL_WEBHOOK_URL || '';
const TOKEN = process.env.EMAIL_WEBHOOK_TOKEN || '';
const hoje = new Date().toISOString().slice(0, 10);
const trace = 'trc-fundadores-ai-mercanti-20260914';
const audit = (o) => { try { fs.mkdirSync(LOGS, { recursive: true }); fs.appendFileSync(path.join(LOGS, `audit-${hoje}.jsonl`), JSON.stringify({ ts: new Date().toISOString(), trace_id: trace, agente: 'chave-girada', ...o }) + '\n'); } catch {} };

const restaurant_id = '18546';
const casa = 'AI MERCANTI';
const EMAIL_CATALOGO = 'info_aimercanti@libero.it';
const emailMascarado = mascararEmail(EMAIL_CATALOGO);
const PEDIDOS = 5;
const CTA = `https://manager.theworldkeys.com/register?utm_source=email&utm_campaign=fundadores-apresentacao&utm_content=r${restaurant_id}`;

const TEXTOS = {
  it: {
    assunto: `${casa}, piacere di conoscervi: siamo The World Keys`,
    preheader: `La piattaforma che vi porta già ospiti — e l'account del locale, gratuito, per gestire tutto con un tocco.`,
    titulo: 'Piacere, siamo The World Keys.',
    saudacao: `Buongiorno, team di ${casa}!`,
    empresa: [
      `Siamo una piattaforma di prenotazioni gastronomiche nata a Parigi. Il nostro lavoro è avvicinare chi ama mangiare bene ai ristoranti che valgono il viaggio: dalle tavole premiate dalla Guida Michelin alle piccole gemme locali.`,
      `Oggi riuniamo 1.546 ristoranti in oltre 200 città di più di 40 paesi, e più di 22.000 clienti usano la piattaforma per trovare e prenotare il prossimo tavolo. ${casa} fa parte di questa selezione, a Venezia.`,
    ],
    numero: { cima: casa, valor: String(PEDIDOS), baixo: 'richieste di tavolo arrivate a voi tramite la piattaforma, da dicembre 2024' },
    ascolto: `A dicembre 2024 ci avevate scritto per una richiesta arrivata per la vigilia di Natale, giorno di chiusura, ricordandoci che prenotate con il vostro sistema. Avevate ragione, ed è proprio da lì che vogliamo ripartire.`,
    hoje: `La vostra pagina è già pubblicata, senza alcun costo, e le richieste più recenti riguardano già le serate di ottobre.`,
    contaIntro: `L'account del locale, gratuito, non sostituisce il vostro sistema di prenotazione: lo affianca, per gli ospiti che vi scoprono tramite The World Keys. E vi dà il controllo di ciò che arriva:`,
    contaTitulo: "L'account del locale",
    contaItens: [
      'Orari di apertura e periodi di chiusura sulla vostra pagina: nei giorni di chiusura il modulo non accetta richieste.',
      'Tutte le richieste in un unico pannello, con la cronologia completa, e risposta con un tocco dal telefono.',
      'La politica di prenotazione e i dati della pagina, nelle vostre mani.',
    ],
    cta: "Attivare l'account del locale",
    ativarTitulo: 'Come attivarlo, in tre passi',
    ativarItens: [
      'Aprite il link e scegliete "My restaurant is already on the site".',
      `Un codice a 6 cifre arriva a ${emailMascarado}.`,
      'Inserite il codice e create la password.',
    ],
    ajuda: "Se preferite, rispondete a questa e-mail: attiviamo l'account insieme a voi e sistemiamo orari e chiusure della pagina.",
    fecho: `È un piacere avere ${casa} su The World Keys.`,
    abraco: 'Un caro saluto,',
    assinatura: ['Márlon Andrade', 'Responsabile commerciale · The World Keys'],
  },
  pt: {
    assunto: `${casa}, muito prazer: somos a The World Keys`,
    preheader: `A plataforma que já leva clientes até vocês — e a conta de gerenciamento, gratuita, para cuidar de tudo com um toque.`,
    titulo: 'Muito prazer: somos a The World Keys.',
    saudacao: `Olá, equipe do ${casa}!`,
    empresa: [
      `Somos uma plataforma de reservas gastronômicas nascida em Paris. O nosso trabalho é aproximar quem ama comer bem dos restaurantes que valem a viagem: de mesas premiadas pelo Guia Michelin a pequenas joias locais.`,
      `Hoje reunimos 1.546 restaurantes em mais de 200 cidades de mais de 40 países, e mais de 22 mil clientes usam a plataforma para encontrar e reservar a próxima mesa. O ${casa} faz parte dessa seleção, em Veneza.`,
    ],
    numero: { cima: casa, valor: String(PEDIDOS), baixo: 'pedidos de mesa chegaram a vocês pela plataforma, desde dezembro de 2024' },
    ascolto: `Em dezembro de 2024, vocês nos escreveram sobre um pedido que chegou para a véspera de Natal, dia em que a casa estava fechada, e lembraram que as reservas de vocês são feitas pelo sistema próprio. Vocês tinham razão, e é exatamente daí que queremos recomeçar.`,
    hoje: `A página de vocês já está publicada, sem nenhum custo, e os pedidos mais recentes já são para as noites de outubro.`,
    contaIntro: `A conta de gerenciamento, gratuita, não substitui o sistema de reservas de vocês: ela o complementa, para os clientes que descobrem a casa pela The World Keys. E dá a vocês o controle do que chega:`,
    contaTitulo: 'A conta de gerenciamento',
    contaItens: [
      'Horários de funcionamento e períodos de fechamento na página: nos dias fechados, o formulário não aceita pedidos.',
      'Todos os pedidos num único painel, com o histórico completo, e resposta com um toque pelo celular.',
      'A política de reserva e os dados da página nas mãos de vocês.',
    ],
    cta: 'Ativar a conta de gerenciamento',
    ativarTitulo: 'Como ativar, em três passos',
    ativarItens: [
      'Abram o link e escolham "My restaurant is already on the site".',
      `Um código de 6 dígitos chega em ${emailMascarado}.`,
      'Digitem o código e criem a senha.',
    ],
    ajuda: 'Se preferirem, é só responder a este e-mail: ativamos a conta junto com vocês e acertamos os horários e fechamentos da página.',
    fecho: `É um prazer ter o ${casa} na The World Keys.`,
    abraco: 'Um abraço,',
    assinatura: ['Márlon Andrade', 'Gerente Comercial · The World Keys'],
  },
};

const L = TEXTOS[idioma];
if (!L) { console.error(`idioma não disponível: ${idioma} (use it ou pt)`); process.exit(2); }
if ((apply || teste) && idioma !== 'it') { console.error('BLOQUEADO: à casa só sai a versão em italiano'); process.exit(2); }

// Rodapé institucional idêntico ao do Extrato aprovado (só support@) + opt-out obrigatório, e fecha o cartão aberto por B.cabeca.
const rodapeInstitucional = `        <tr><td align="center" style="padding:24px 20px 28px 20px; border-top:1px solid #26200F;">
          <p style="margin:0 0 4px 0; font-family:Georgia,'Times New Roman',serif; font-size:13px; letter-spacing:3px; color:#8F8368;">THE WORLD KEYS</p>
          <p style="margin:0 0 10px 0; font-family:Arial,Helvetica,sans-serif; font-size:11px; line-height:1.8; color:#6E6551;">
            <a href="https://theworldkeys.com/terms-of-use/" style="color:#8F8368; text-decoration:none;">Terms &amp; Conditions</a> &nbsp;&#183;&nbsp; <a href="mailto:support@theworldkeys.com" style="color:#8F8368; text-decoration:none;">support@theworldkeys.com</a><br/>
            66, Av. des Champs-&#201;lys&#233;es, 75008 Paris, France<br/>
            VAT: FR24901268326 &#183; R.C.S Paris: 901 268 326 &#183; &#169; 2026 The World Keys
          </p>
          ${rodapeOptout(idioma, restaurant_id).replace('color:#8a8a8a', 'color:#6E6551').replace('font-size:12px', 'font-size:11px').replace(/<a /g, '<a style="color:#8F8368;" ')}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

const assinaturaHtml = `        <tr><td style="padding:22px 28px 8px 28px;">
          <p style="margin:0 0 18px 0; font-family:Arial,Helvetica,sans-serif; font-size:15px; line-height:1.65; color:#B5AB93;">${L.fecho}</p>
          <p style="margin:0 0 6px 0; font-family:Arial,Helvetica,sans-serif; font-size:15px; color:#B5AB93;">${L.abraco}</p>
          <p style="margin:0; font-family:Georgia,'Times New Roman',serif; font-size:16px; color:#F5EFE3;">${L.assinatura[0]}</p>
          <p style="margin:2px 0 0 0; font-family:Arial,Helvetica,sans-serif; font-size:12px; color:#8F8368;">${L.assinatura[1]}</p>
        </td></tr>`;

const html = [
  B.cabeca(L.titulo, L.preheader, idioma),
  B.paragrafo(L.saudacao),
  ...L.empresa.map((p) => B.paragrafo(p)),
  B.cartaoNumero(L.numero.cima, L.numero.valor, L.numero.baixo),
  B.paragrafo(L.ascolto),
  B.paragrafo(L.hoje),
  B.paragrafo(L.contaIntro),
  B.passos(L.contaTitulo, L.contaItens),
  B.botao(CTA, L.cta),
  B.passos(L.ativarTitulo, L.ativarItens),
  B.paragrafo(L.ajuda, '#8F8368', 13),
  assinaturaHtml,
  rodapeInstitucional,
].join('\n');

// Travas: tokens proibidos (texto visível), opt-out no rodapé, nenhum reservation@, link imune a quoted-printable.
const textoVisivel = html.replace(/<[^>]+>/g, ' ');
const hit = TOKENS_PROIBIDOS.find((re) => re.test(textoVisivel));
if (hit) { console.error(`BLOQUEADO: token proibido ${hit}`); process.exit(5); }
exigirOptout(html, `${casa} ${idioma}`);
if (/reservation@/i.test(html)) { console.error('BLOQUEADO: reservation@ visível'); process.exit(5); }
if (/=[0-9A-Fa-f]{2}/.test(CTA)) { console.error('BLOQUEADO: o link tem sequência que o quoted-printable corrompe'); process.exit(5); }

const arq = path.join(PREV, `P-${restaurant_id}-${idioma}.html`);
fs.writeFileSync(arq, html);
console.log(`idioma    : ${idioma}`);
console.log(`assunto   : ${L.assunto}`);
console.log(`preheader : ${L.preheader}`);
console.log(`botão     : ${CTA}`);
console.log(`preview   : ${arq}`);

(async () => {
  if (!apply && !teste) { console.log('\nPREVIEW — nada enviado.'); return; }
  if (teste && (!paraTeste || !/@/.test(paraTeste))) { console.error('BLOQUEADO: --teste exige --para <email>'); process.exit(2); }
  if (apply && (!aprovacao || aprovacao.length < 10)) { console.error('BLOQUEADO: --apply exige --aprovacao "<frase do fundador>"'); process.exit(3); }
  if (!WEBHOOK || !TOKEN) { console.error('BLOQUEADO: EMAIL_WEBHOOK_URL/TOKEN ausentes'); process.exit(2); }

  let para = paraTeste;
  if (apply) {
    // Fail-closed: registro de opt-out legível, casa publicada, e-mail do catálogo lido agora, sem duplicata.
    const registro = require('../registro-optout/registro');
    const reg = await registro.carregarAuto();
    const b = registro.bloqueiaContato(restaurant_id, reg, 'outreach');
    if (b.bloqueado) { console.error(`BLOQUEADO: ${b.motivo}`); process.exit(4); }
    const db = require('../guardiao-reserva/db');
    const r = await db.comCliente(async (c) => (await c.query('SELECT published, email_for_reservations e FROM public.db_restaurants WHERE restaurant_id = $1', [restaurant_id])).rows[0]);
    if (!r || r.published !== true) { console.error('BLOQUEADO: a casa não está publicada'); process.exit(4); }
    if (!r.e || !/@/.test(r.e)) { console.error('BLOQUEADO: sem e-mail no catálogo'); process.exit(4); }
    const ledger = fs.existsSync(LEDGER) ? fs.readFileSync(LEDGER, 'utf8').split(/\r?\n/).slice(1).filter(Boolean).map((l) => l.split(';')) : [];
    if (ledger.some((l) => l[0] === restaurant_id && l[2] === CAMPANHA && l[4] !== '0')) { console.error('BLOQUEADO: já enviado nesta campanha (ledger)'); process.exit(4); }
    para = r.e;
    console.log(`registro  : ${reg.fonte} · livre para contato`);
  }

  const assunto = teste ? `[TESTE] ${L.assunto}` : L.assunto;
  const resp = await fetch(WEBHOOK, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` }, body: JSON.stringify({ para, assunto, html }) });
  audit({ evento: teste ? 'email_teste' : 'email_envio', campanha: CAMPANHA, restaurant_id, ok: resp.ok, http: resp.status, aprovacao_ref: aprovacao, destino_dominio: String(para).split('@')[1] });
  if (resp.ok) {
    const linha = [restaurant_id, casa, CAMPANHA, 'APRESENTACAO', teste ? 0 : 1, 'email', para, idioma, `n8n-${resp.status}`, hoje, 'maestro', aprovacao || 'teste', trace, PEDIDOS, 0, '', '', teste ? 'TESTE; não conta como toque' : 'apresentação + conta de gerenciamento; opt-out no rodapé'].join(';');
    fs.appendFileSync(LEDGER, '\n' + linha);
  }
  console.log(`\nenvio     : HTTP ${resp.status} ${resp.ok ? 'aceito' : 'RECUSADO'} → ${String(para).replace(/^[^@]*/, '***')}`);
  if (!resp.ok) process.exit(1);
})().catch((e) => { audit({ evento: 'falha', erro: e.message }); console.error('ERRO', e.message); process.exit(1); });
