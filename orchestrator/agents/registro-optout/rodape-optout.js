'use strict';
/**
 * Rodapé de opt-out/correção para TODO e-mail em massa a estabelecimentos
 * (CLAVIS, Guardião). Guardrail 8: nunca contato em massa sem opt-out funcional.
 * O link grava no Registro de Opt-out via n8n /go (c=optout|correcao, rid=<restaurant_id>).
 * BASE do link é configurável — SUPOSIÇÃO a validar: o webhook /go do n8n aceita esses parâmetros.
 */
const BASE = process.env.TWK_GO_BASE || 'https://theworldkeys-n8n.xis4ee.easypanel.host/webhook/go';

const TEXTO = {
  pt: (rid) => `Sua página está listada gratuitamente na The World Keys. Se preferir corrigir os dados ou retirar a página, basta um clique: <a href="${BASE}?c=correcao&rid=${rid}">corrigir informações</a> · <a href="${BASE}?c=optout&rid=${rid}">retirar a página</a>. Nenhuma outra mensagem será enviada após o pedido.`,
  en: (rid) => `Your page is listed free of charge on The World Keys. To correct your details or remove the page, one click is enough: <a href="${BASE}?c=correcao&rid=${rid}">correct information</a> · <a href="${BASE}?c=optout&rid=${rid}">remove the page</a>. No further messages will be sent after your request.`,
  fr: (rid) => `Votre page est référencée gratuitement sur The World Keys. Pour corriger vos informations ou retirer la page, un clic suffit : <a href="${BASE}?c=correcao&rid=${rid}">corriger les informations</a> · <a href="${BASE}?c=optout&rid=${rid}">retirer la page</a>. Aucun autre message ne sera envoyé après votre demande.`,
  es: (rid) => `Su página está incluida gratuitamente en The World Keys. Para corregir sus datos o retirar la página, basta un clic: <a href="${BASE}?c=correcao&rid=${rid}">corregir información</a> · <a href="${BASE}?c=optout&rid=${rid}">retirar la página</a>. No se enviará ningún otro mensaje tras su solicitud.`,
  it: (rid) => `La vostra pagina è presente gratuitamente su The World Keys. Per correggere i dati o rimuovere la pagina basta un clic: <a href="${BASE}?c=correcao&rid=${rid}">correggere le informazioni</a> · <a href="${BASE}?c=optout&rid=${rid}">rimuovere la pagina</a>. Nessun altro messaggio sarà inviato dopo la richiesta.`,
};

function rodape(idioma, restaurantId) {
  const f = TEXTO[idioma] || TEXTO.en;
  return `<p style="font-size:12px;color:#8a8a8a;margin-top:24px">${f(String(restaurantId))}</p>`;
}

/** E-mail PRONTO PARA ENVIO: precisa do id real da casa nos dois links. */
function temOptout(html) {
  return /c=optout&rid=\d+/.test(html) && /c=correcao&rid=\d+/.test(html);
}
/** TEMPLATE (ainda com placeholder): aceita `{{restaurant_id}}`, que o compositor substitui antes do envio. */
function temOptoutTemplate(html) {
  return /c=optout&rid=(\d+|\{\{restaurant_id\}\})/.test(html) && /c=correcao&rid=(\d+|\{\{restaurant_id\}\})/.test(html);
}
/** Guardrail 8: nada sai sem opt-out resolvido. Chame ANTES de qualquer envio em massa. */
function exigirOptout(html, ref = '') {
  if (!temOptout(html)) throw new Error(`bloqueado pelo guardrail 8: e-mail sem link de opt-out resolvido${ref ? ` (${ref})` : ''} — placeholder {{restaurant_id}} não foi substituído`);
  return true;
}

module.exports = { rodape, temOptout, temOptoutTemplate, exigirOptout, BASE };
