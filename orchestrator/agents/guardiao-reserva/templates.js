'use strict';
/**
 * Templates do Guardião — 5 idiomas. Sem LLM.
 * Degrau 1: e-mail ao restaurante (lote diário). Degrau 4: rascunho estruturado ao cliente,
 * que a Aria localiza e envia após aprovação humana.
 *
 * Tokens proibidos no texto ao cliente (validados por teste): nada que soe como mesa
 * garantida/confirmada nem como cancelamento. Alternativas sempre "sujeitas a confirmação".
 * SUPOSIÇÃO (validar): link de resposta sem conta = https://theworldkeys.com/r/{código} (usado nos nudges de 31/08).
 */
const { rodape } = require('../registro-optout/rodape-optout');

const LINK_RESPOSTA = (process.env.TWK_LINK_RESPOSTA || 'https://theworldkeys.com/r/') ;
// Link da conta, rastreado: o clique passa pelo /go do n8n (workflow HoFjhfqzPmCAkrnZ), que registra
// c=guardiao + rid e redireciona ao manager. Sem isso, nunca saberíamos se alguém clicou (foi a
// cegueira dos Extratos de 04-05/09, cujo botão ia direto ao destino).
const LINK_CONTA = (rid) => `https://theworldkeys-n8n.xis4ee.easypanel.host/webhook/go?c=guardiao&rid=${encodeURIComponent(rid)}`;
// As duas primeiras famílias protegem o cliente de uma promessa falsa; a terceira (ADR-015)
// protege a marca: nunca revelar ao cliente que a casa não é parceira ou que não temos
// meios de forçar a resposta — ele responderia "então por que oferecem no site?".
const TOKENS_PROIBIDOS_CLIENTE = [/confirmad/i, /garantid/i, /reservamos/i, /assegurad/i, /guaranteed/i, /confirmed/i, /booked for you/i, /cancel(ad|ed|é|ado)/i, /annul/i,
  /not a partner/i, /n[ãa]o (é|e) (uma )?(casa |restaurante )?parceir/i, /pas (une maison |un restaurant )?partenaire/i,
  /cannot promise/i, /can.?t promise/i, /n[ãa]o (podemos|posso) (prometer|garantir)/i, /the reply depends on them/i, /depende (deles|do restaurante)/i];
const TOKENS_PROIBIDOS_RESTAURANTE = [/urgente!!/i, /última chance/i, /last chance/i, /garantimos/i, /clientes furiosos/i];

const T = {
  pt: {
    assunto: (n, k) => k === 1 ? `${n}: 1 pedido de mesa aguarda a sua resposta` : `${n}: ${k} pedidos de mesa aguardam a sua resposta`,
    abertura: (n) => `Olá, equipe do ${n}.`,
    corpo: (k) => k === 1 ? `Um cliente escolheu a sua casa pela The World Keys e o pedido ainda está sem resposta. A sua página está listada gratuitamente na plataforma e vocês ainda não são parceiros — por isso a resposta depende de vocês.` : `${k} clientes escolheram a sua casa pela The World Keys e os pedidos ainda estão sem resposta. A sua página está listada gratuitamente na plataforma e vocês ainda não são parceiros — por isso a resposta depende de vocês.`,
    instrucao: `Responder leva um minuto e não exige conta: basta abrir o link de cada pedido e escolher aceitar, recusar ou propor outro horário. Se nada for feito, avisaremos o cliente antes da data que não houve confirmação.`,
    linha: (c, d, h) => `Pedido ${c} — ${d} às ${h}`,
    conta: {
      chamada: `Para não repetir isto a cada pedido:`,
      botao: `Ativar a conta gratuita da casa`,
      beneficio: `Todos os pedidos num único painel, resposta num toque pelo telemóvel, e os horários e a política de reserva da vossa página nas vossas mãos. Leva dois minutos.`,
    },
    fecho: `Obrigado.`,
    assinatura: `Equipe The World Keys · reservation@theworldkeys.com`,
    responder: `Responder`,
    datas: 'pt-PT',
  },
  en: {
    assunto: (n, k) => k === 1 ? `${n}: 1 table request is waiting for your reply` : `${n}: ${k} table requests are waiting for your reply`,
    abertura: (n) => `Hello, ${n} team.`,
    corpo: (k) => k === 1 ? `A guest chose your restaurant through The World Keys and the request is still unanswered. Your page is listed free of charge on the platform and you are not yet a partner — so the reply depends on you.` : `${k} guests chose your restaurant through The World Keys and their requests are still unanswered. Your page is listed free of charge on the platform and you are not yet a partner — so the reply depends on you.`,
    instrucao: `Replying takes a minute and needs no account: open each request link and choose accept, decline or propose another time. If nothing is done, we will tell the guest before the date that there was no confirmation.`,
    linha: (c, d, h) => `Request ${c} — ${d} at ${h}`,
    conta: {
      chamada: `So you never have to do this one request at a time:`,
      botao: `Activate the restaurant's free account`,
      beneficio: `Every request in one dashboard, a one-tap reply from your phone, and your page's hours and booking policy in your hands. It takes two minutes.`,
    },
    fecho: `Thank you.`,
    assinatura: `The World Keys team · reservation@theworldkeys.com`,
    responder: `Reply`,
    datas: 'en-GB',
  },
  fr: {
    assunto: (n, k) => k === 1 ? `${n} : 1 demande de table attend votre réponse` : `${n} : ${k} demandes de table attendent votre réponse`,
    abertura: (n) => `Bonjour, l'équipe de ${n}.`,
    corpo: (k) => k === 1 ? `Un client a choisi votre maison via The World Keys et la demande est toujours sans réponse. Votre page est référencée gratuitement sur la plateforme et vous n'êtes pas encore partenaire — la réponse dépend donc de vous.` : `${k} clients ont choisi votre maison via The World Keys et leurs demandes sont toujours sans réponse. Votre page est référencée gratuitement sur la plateforme et vous n'êtes pas encore partenaire — la réponse dépend donc de vous.`,
    instrucao: `Répondre prend une minute et ne nécessite aucun compte : ouvrez le lien de chaque demande et choisissez accepter, refuser ou proposer un autre horaire. Sans action de votre part, nous préviendrons le client avant la date qu'il n'y a pas eu de confirmation.`,
    linha: (c, d, h) => `Demande ${c} — ${d} à ${h}`,
    conta: {
      chamada: `Pour ne plus répondre demande par demande :`,
      botao: `Activer le compte gratuit de la maison`,
      beneficio: `Toutes les demandes dans un seul tableau de bord, une réponse en un geste depuis votre téléphone, et les horaires et la politique de réservation de votre page entre vos mains. Deux minutes suffisent.`,
    },
    fecho: `Merci.`,
    assinatura: `L'équipe The World Keys · reservation@theworldkeys.com`,
    responder: `Répondre`,
    datas: 'fr-FR',
  },
  es: {
    assunto: (n, k) => k === 1 ? `${n}: 1 solicitud de mesa espera su respuesta` : `${n}: ${k} solicitudes de mesa esperan su respuesta`,
    abertura: (n) => `Hola, equipo de ${n}.`,
    corpo: (k) => k === 1 ? `Un cliente eligió su casa a través de The World Keys y la solicitud sigue sin respuesta. Su página está incluida gratuitamente en la plataforma y aún no son socios — por eso la respuesta depende de ustedes.` : `${k} clientes eligieron su casa a través de The World Keys y las solicitudes siguen sin respuesta. Su página está incluida gratuitamente en la plataforma y aún no son socios — por eso la respuesta depende de ustedes.`,
    instrucao: `Responder lleva un minuto y no requiere cuenta: abran el enlace de cada solicitud y elijan aceptar, rechazar o proponer otro horario. Si no se hace nada, avisaremos al cliente antes de la fecha de que no hubo confirmación.`,
    linha: (c, d, h) => `Solicitud ${c} — ${d} a las ${h}`,
    conta: {
      chamada: `Para no repetir esto con cada solicitud:`,
      botao: `Activar la cuenta gratuita de la casa`,
      beneficio: `Todas las solicitudes en un solo panel, respuesta con un toque desde el móvil, y los horarios y la política de reservas de su página en sus manos. Lleva dos minutos.`,
    },
    fecho: `Gracias.`,
    assinatura: `Equipo The World Keys · reservation@theworldkeys.com`,
    responder: `Responder`,
    datas: 'es-ES',
  },
  it: {
    assunto: (n, k) => k === 1 ? `${n}: 1 richiesta di tavolo attende la vostra risposta` : `${n}: ${k} richieste di tavolo attendono la vostra risposta`,
    abertura: (n) => `Buongiorno, team di ${n}.`,
    corpo: (k) => k === 1 ? `Un cliente ha scelto il vostro locale tramite The World Keys e la richiesta è ancora senza risposta. La vostra pagina è presente gratuitamente sulla piattaforma e non siete ancora partner — per questo la risposta dipende da voi.` : `${k} clienti hanno scelto il vostro locale tramite The World Keys e le richieste sono ancora senza risposta. La vostra pagina è presente gratuitamente sulla piattaforma e non siete ancora partner — per questo la risposta dipende da voi.`,
    instrucao: `Rispondere richiede un minuto e nessun account: aprite il link di ogni richiesta e scegliete accettare, rifiutare o proporre un altro orario. Senza una vostra azione, avviseremo il cliente prima della data che non c'è stata conferma.`,
    linha: (c, d, h) => `Richiesta ${c} — ${d} alle ${h}`,
    conta: {
      chamada: `Per non ripetere questo a ogni richiesta:`,
      botao: `Attivare l'account gratuito del locale`,
      beneficio: `Tutte le richieste in un unico pannello, risposta con un tocco dal telefono, e orari e politica di prenotazione della vostra pagina nelle vostre mani. Bastano due minuti.`,
    },
    fecho: `Grazie.`,
    assinatura: `Il team The World Keys · reservation@theworldkeys.com`,
    responder: `Rispondere`,
    datas: 'it-IT',
  },
};

function fmtData(dataISO, locale) {
  const [y, m, d] = String(dataISO).slice(0, 10).split('-').map(Number);
  try { return new Intl.DateTimeFormat(locale, { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, d))); }
  catch { return String(dataISO).slice(0, 10); }
}
const fmtHora = (h) => String(h || '').slice(0, 5);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** E-mail do degrau 1 para um restaurante com N reservas. reservas: [{reservation_code, booking_date, reservation_time}]
 *  Visual no padrão TWK (cartão escuro, dourado), pedido do fundador em 08/09: o mesmo desenho dos
 *  e-mails transacionais que o restaurante já clica toda semana — nada de bloco de texto solto. */
function emailRestaurante({ idioma, nome, restaurant_id, reservas }) {
  const t = T[idioma] || T.en;
  const k = reservas.length;
  const linhas = reservas.map((r) => `
            <tr><td style="padding:11px 14px; border-bottom:1px solid #26200F;">
              <div style="font-family:Arial,Helvetica,sans-serif; font-size:14px; line-height:1.55; color:#F5EFE3;">${esc(t.linha(r.reservation_code, fmtData(r.booking_date, t.datas), fmtHora(r.reservation_time)))}</div>
            </td><td align="right" style="padding:11px 14px; border-bottom:1px solid #26200F; white-space:nowrap;">
              <a href="${LINK_RESPOSTA}${encodeURIComponent(r.reservation_code)}" target="_blank" style="display:inline-block; padding:8px 18px; background-color:#CE9E3C; color:#12100C; font-family:Arial,Helvetica,sans-serif; font-size:13px; font-weight:600; text-decoration:none;">${esc(t.responder)}</a>
            </td></tr>`).join('');
  const html = `<!DOCTYPE html>
<html lang="${idioma}"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><meta name="color-scheme" content="dark" /><title>${esc(t.assunto(nome, k))}</title></head>
<body style="margin:0; padding:0; background-color:#0B0A08;">
  <div style="display:none; max-height:0; overflow:hidden; mso-hide:all;">${esc(t.corpo(k))}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#0B0A08; border-collapse:collapse;">
    <tr><td align="center" style="padding:12px 6px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%; max-width:600px; background-color:#12100C; border:1px solid #26200F; border-radius:16px; border-collapse:separate; overflow:hidden;">

        <tr><td align="center" style="padding:36px 20px 0 20px;">
          <a href="https://theworldkeys.com/" target="_blank" style="text-decoration:none;">
            <img src="https://theworldkeys.com/images/twk-logo.gif" width="56" alt="" style="display:block; margin:0 auto 14px auto; width:56px; height:auto; border:0;" border="0" />
            <img src="https://img.mailinblue.com/6331555/images/content_library/original/661430b29475332809dc25ad.png" width="220" alt="THE WORLD KEYS" style="display:block; margin:0 auto; width:220px; height:auto; border:0;" border="0" />
          </a>
          <div style="font-family:Arial,Helvetica,sans-serif; font-size:10px; letter-spacing:4px; color:#8F8368; padding-top:10px;">PARIS</div>
        </td></tr>
        <tr><td align="center" style="padding:20px 20px 0 20px;"><table role="presentation" width="48" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-top:1px solid #CE9E3C; font-size:0; line-height:0;">&nbsp;</td></tr></table></td></tr>

        <tr><td align="center" style="padding:26px 24px 8px 24px;">
          <h1 style="margin:0; font-family:Georgia,'Times New Roman',serif; font-weight:normal; font-size:24px; line-height:1.35; color:#F5EFE3;">${esc(t.assunto(nome, k))}</h1>
        </td></tr>

        <tr><td style="padding:8px 28px 0 28px;">
          <p style="margin:0 0 14px 0; font-family:Arial,Helvetica,sans-serif; font-size:15px; line-height:1.65; color:#B5AB93;">${esc(t.abertura(nome))}</p>
          <p style="margin:0 0 14px 0; font-family:Arial,Helvetica,sans-serif; font-size:15px; line-height:1.65; color:#B5AB93;">${esc(t.corpo(k))}</p>
        </td></tr>

        <tr><td style="padding:6px 16px 0 16px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#1A1611; border:1px solid #26200F; border-radius:12px; border-collapse:separate; overflow:hidden;">${linhas}
          </table>
        </td></tr>

        <tr><td style="padding:14px 28px 0 28px;">
          <p style="margin:0 0 14px 0; font-family:Arial,Helvetica,sans-serif; font-size:13px; line-height:1.6; color:#8F8368;">${esc(t.instrucao)}</p>
        </td></tr>

        <tr><td style="padding:8px 16px 0 16px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#1A1611; border:1px solid #CE9E3C; border-radius:12px; border-collapse:separate;">
            <tr><td align="center" style="padding:20px 20px 18px 20px;">
              <div style="font-family:Georgia,'Times New Roman',serif; font-size:17px; color:#F5EFE3; padding-bottom:12px;">${esc(t.conta.chamada)}</div>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;"><tr><td align="center" style="background-color:#CE9E3C;">
                <a href="${LINK_CONTA(restaurant_id)}" target="_blank" style="display:inline-block; padding:13px 32px; font-family:Arial,Helvetica,sans-serif; font-size:14px; font-weight:600; color:#12100C; text-decoration:none;">${esc(t.conta.botao)}</a>
              </td></tr></table>
              <div style="font-family:Arial,Helvetica,sans-serif; font-size:12px; line-height:1.6; color:#8F8368; padding-top:12px;">${esc(t.conta.beneficio)}</div>
            </td></tr>
          </table>
        </td></tr>

        <tr><td style="padding:18px 28px 0 28px;">
          <p style="margin:0 0 4px 0; font-family:Arial,Helvetica,sans-serif; font-size:14px; line-height:1.65; color:#B5AB93;">${esc(t.fecho)}</p>
          <p style="margin:0; font-family:Arial,Helvetica,sans-serif; font-size:12px; color:#8F8368;">${esc(t.assinatura)}</p>
        </td></tr>

        <tr><td align="center" style="padding:22px 20px 0 20px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-top:1px solid #26200F; font-size:0; line-height:0;">&nbsp;</td></tr></table></td></tr>

        <tr><td align="center" style="padding:16px 24px 28px 24px;">
          <p style="margin:0 0 4px 0; font-family:Georgia,'Times New Roman',serif; font-size:13px; letter-spacing:3px; color:#8F8368;">THE WORLD KEYS</p>
          <p style="margin:0; font-family:Arial,Helvetica,sans-serif; font-size:11px; line-height:1.8; color:#6E6551;">
            <a href="https://theworldkeys.com/terms-of-use/" style="color:#8F8368; text-decoration:none;">Terms &amp; Conditions</a> &nbsp;&#183;&nbsp; <a href="mailto:support@theworldkeys.com" style="color:#8F8368; text-decoration:none;">support@theworldkeys.com</a><br/>
            66, Av. des Champs-&#201;lys&#233;es, 75008 Paris, France<br/>
            VAT: FR24901268326 &#183; R.C.S Paris: 901 268 326 &#183; &#169; 2026 The World Keys
          </p>
          ${rodape(idioma, restaurant_id)}
        </td></tr>

      </table>
    </td></tr>
  </table>
</body></html>`;
  const texto = `${t.abertura(nome)}\n\n${t.corpo(k)}\n\n${reservas.map((r) => `- ${t.linha(r.reservation_code, fmtData(r.booking_date, t.datas), fmtHora(r.reservation_time))}: ${LINK_RESPOSTA}${r.reservation_code}`).join('\n')}\n\n${t.instrucao}\n\n${t.conta.chamada} ${t.conta.beneficio}\n${LINK_CONTA(restaurant_id)}\n\n${t.fecho}\n${t.assinatura}`;
  validar(html, TOKENS_PROIBIDOS_RESTAURANTE, 'restaurante');
  return { assunto: t.assunto(nome, k), html, texto };
}

/**
 * Rascunho estruturado do degrau 4 (ao cliente). A Aria recebe isto por handoff,
 * localiza no idioma do cliente e envia após aprovação. O texto-base é EN.
 * alternativas: [{name, city, slug}] — só casas com ≥50% de aceite em 90d (máx. 2).
 */
function rascunhoCliente({ reservation_code, restaurante, booking_date, reservation_time, alternativas = [] }) {
  const alt = alternativas.slice(0, 2);
  // Discrição (ADR-015): nunca dizer ao cliente que a casa não é parceira, que a mesa
  // "não é nossa" ou que não temos como forçar a resposta — isso o faz perguntar por que
  // oferecemos a casa. Dizer o que já fizemos, o que ele recebe sozinho, e a data em que
  // NÓS voltamos com alternativas. Sem nunca afirmar mesa que não existe.
  const texto = [
    `Your request ${reservation_code} for ${restaurante.name} (${fmtData(booking_date, 'en-GB')} at ${fmtHora(reservation_time)}) is with the restaurant, and we have written to them directly about it.`,
    `The moment they confirm, the confirmation reaches you by e-mail and I write to you as well.`,
    alt.length ? `So that you are not left waiting, I can put two addresses in ${restaurante.city} of the same standard in front of you for the same evening: ${alt.map((a) => a.name).join(' · ')}. Say the word and I take care of the arrangements.` : `So that you are not left waiting, I can put forward another house in ${restaurante.city} of the same standard for the same evening — say the word and I take care of the arrangements.`,
    `Your original request stays exactly as it is in the meantime.`,
  ].join('\n\n');
  validar(texto, TOKENS_PROIBIDOS_CLIENTE, 'cliente');
  return {
    reservation_code, restaurant_id: restaurante.restaurant_id, idioma_base: 'en', texto_base: texto,
    fatos: { restaurante: restaurante.name, cidade: restaurante.city, data: String(booking_date).slice(0, 10), hora: fmtHora(reservation_time), parceiro: !!restaurante.partner, alternativas: alt.map((a) => ({ restaurant_id: a.restaurant_id, name: a.name, slug: a.slug })) },
    regras_para_aria: ['traduzir para o idioma do cliente (perfil)', 'não prometer mesa', 'não cancelar nem alterar a reserva', 'alternativas sempre "sujeitas a confirmação"', 'sem emoji', 'assinar como Aria'],
  };
}

function validar(texto, lista, alvo) {
  const hit = lista.find((re) => re.test(texto));
  if (hit) throw new Error(`template ao ${alvo} contém token proibido: ${hit}`);
}

module.exports = { emailRestaurante, rascunhoCliente, TOKENS_PROIBIDOS_CLIENTE, TOKENS_PROIBIDOS_RESTAURANTE, fmtData, LINK_RESPOSTA, T };
