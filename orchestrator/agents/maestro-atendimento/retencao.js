'use strict';
/**
 * Retenção antes da exclusão — lógica PURA (sem I/O): motivo, carta, prazo, decisão, leitura da resposta.
 *
 * ADR-018 (fundador, 2026-10-22): quando um estabelecimento pede para sair, o MAESTRO (1) avalia o motivo,
 * (2) manda UMA carta profissional e honesta que tenta reverter — não custa nada ser apresentado, receber
 * pedidos e respondê-los — e (3) se a casa mantiver o pedido, ou não responder em 48 h, exclui sozinho.
 *
 * O que NÃO se tenta reverter (a carta é só o reconhecimento e a exclusão segue no prazo): base jurídica ou
 * regulatória citada (GDPR/CNIL/advogado), casa que fechou ou mudou de dono, "não nos contatem mais", e o
 * segundo pedido da mesma casa. Pedido de remoção tem prioridade sobre qualquer meta comercial (ADR-010):
 * a carta nunca condiciona a saída, nunca pede motivo, e a data de saída está escrita nela.
 */

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ');

const MOTIVOS = ['juridico', 'fechou', 'nao_contatar', 'segunda_vez', 'dados_errados', 'custo', 'nao_consentiu', 'sem_interesse', 'indefinido'];
const SEM_RETENCAO = new Set(['juridico', 'fechou', 'nao_contatar', 'segunda_vez']);
const PRAZO_HORAS = 48;

const SINAIS = {
  juridico: [/\b(gdpr|rgpd|dsgvo|cnil|aepd|garante (della )?privacy|dpo|data protection|protection des donnees|proteccion de datos|protezione dei dati|protecao de dados|datenschutz)\b/, /\b(lawyer|attorney|solicitor|avocat|abogado|avvocato|advogad[oa]s?|rechtsanwalt|legal (action|notice|department)|mise en demeure|notificacion (legal|judicial)|diffida|injunction|cease and desist|tribunal|court)\b/],
  fechou: [/\b(permanently|definitively|definitely) closed\b/, /\b(we|the restaurant) (have |has )?closed( down)?\b/, /\b(no longer (open|operating|in business|exists?)|out of business|ceased (trading|operations))\b/, /\b(ferme definitivement|fermeture definitive|a ferme|avons ferme|cerrado definitivamente|hemos cerrado|cerro definitivamente|chiuso definitivamente|abbiamo chiuso|ha chiuso|fechamos|encerr(ou|amos) (as )?atividades|fechou definitivamente|geschlossen|haben geschlossen)\b/, /\b(changed (hands|ownership)|under new (ownership|management)|new owners?|nouveau proprietaire|nouvelle direction|change de proprietaire|changement de proprietaire|nuevo propietario|nuevos duenos|cambio de (dueno|propietario)|nuovo proprietario|nuova gestione|cambio di (proprieta|gestione)|novo (dono|proprietario)|mud(ou|anca) de dono|neuer (besitzer|inhaber)|inhaberwechsel)\b/],
  nao_contatar: [/\b(do not|don'?t|never) contact (us|me)( again)?\b/, /\bstop (contacting|emailing|writing to) (us|me)\b/, /\bno (further|more) (contact|emails?|messages?)\b/, /\b(ne nous contactez plus|ne plus nous (contacter|ecrire)|arretez de nous (ecrire|contacter)|no nos (contacten|escriban) mas|no vuelvan a (contactar|escribir)|non contattateci (piu)?|smettete di (scriverci|contattarci)|nao (nos )?(contatem|contactem|escrevam) mais|parem de (nos )?(escrever|contatar)|kontaktieren sie uns nicht (mehr)?|nicht mehr kontaktieren)\b/, /\b(remove|delete) (us|me) from (your|all|the) (mailing )?lists?\b/, /\bunsubscribe\b/],
  segunda_vez: [/\b(second|third) (time|request|reminder)\b/, /\b(as )?(already|previously) (asked|requested|told|informed|written)\b/, /\bfollow[- ]?up to (my|our) (earlier|previous|last) (request|email|message)\b/, /\b(still (online|listed|there|up)|encore en ligne|toujours en ligne|sigue (en linea|publicad|apareciendo)|ancora online|e ancora (li|visibile)|ainda (esta|continua) (online|publicad|no ar))\b/, /\b(deuxieme (fois|demande)|de nouveau|une nouvelle fois|deja demande|otra vez|segunda vez|ya (lo )?(pedimos|solicitamos|hemos pedido)|seconda volta|di nuovo|gia (richiesto|chiesto)|segunda vez|ja (pedimos|solicitamos|tinhamos pedido)|erneut|zum zweiten mal|bereits (gebeten|beantragt))\b/],
  dados_errados: [/\b(wrong|incorrect|inaccurate|outdated|false|erroneous|not (correct|accurate|right))\b.{0,50}\b(hours?|times?|phone|number|address|photos?|pictures?|prices?|menu|information|details|data)\b/, /\b(hours?|times?|phone|number|address|photos?|pictures?|prices?|menu|information|details)\b.{0,40}\b(wrong|incorrect|inaccurate|outdated|not (correct|accurate|right))\b/, /\b(horaires?|telephone|numero|adresse|photos?|prix|informations?)\b.{0,40}\b(faux|fausses?|erron[ée]s?|incorrects?|pas (bons?|corrects?|a jour))\b/, /\b(faux|fausses?|erron[ée]s?|incorrects?)\b.{0,40}\b(horaires?|telephone|adresse|photos?|prix|informations?)\b/, /\b(horarios?|telefono|direccion|fotos?|precios?|datos|informacion)\b.{0,40}\b(incorrect[oa]s?|equivocad[oa]s?|err[oó]ne[oa]s?|mal|desactualizad[oa]s?)\b/, /\b(orari|telefono|indirizzo|foto|prezzi|dati|informazioni)\b.{0,40}\b(sbagliat[oi]|errat[oi]|non (corrett[oi]|aggiornat[oi]))\b/, /\b(horarios?|telefone|endereco|morada|fotos?|precos?|dados|informacoes?)\b.{0,40}\b(errad[oa]s?|incorret[oa]s?|desatualizad[oa]s?)\b/, /\b(offnungszeiten|telefon(nummer)?|adresse|fotos?|preise|daten|informationen)\b.{0,40}\b(falsch|veraltet|nicht (korrekt|richtig|aktuell))\b/],
  custo: [/\b(fees?|costs?|charges?|subscriptions?|payments?|invoices?|billing|pricing|paying|pay for|commission)\b/, /\b(frais|cout|couts|abonnement|facture|paiement|payer|tarif(s)?|commission)\b/, /\b(coste|costo|tarifa|cuota|suscripcion|factura|pago|pagar|cobro|cobran|comision)\b/, /\b(costi|costo|tariffa|abbonamento|fattura|pagamento|pagare|commissione)\b/, /\b(custos?|cobranca|cobram|mensalidade|assinatura|fatura|pagamento|pagar|comissao|taxa)\b/, /\b(gebuhr(en)?|kosten|abo|abonnement|rechnung|zahlung|bezahlen|provision)\b/],
  nao_consentiu: [/\b(never|not) (asked|requested|agreed|authori[sz]ed|signed up|gave (our |my )?consent|consented|registered)\b/, /\bwithout (our|my|any) (consent|permission|authori[sz]ation|knowledge|agreement)\b/, /\b(did not|didn'?t|do not|don'?t) (consent|authori[sz]e|agree|ask|request|know)\b/, /\b(no consent|non[- ]consent|who are you|how did you (get|obtain)|where did you (get|find))\b/, /\b(jamais (demande|autorise|accepte|donne|consenti|inscrit)|sans (notre|mon|aucun) (accord|autorisation|consentement)|n'avons (pas|jamais) (demande|autorise|donne)|a notre insu|qui etes[- ]vous)\b/, /\b(nunca (pedimos|autorizamos|solicitamos|consentimos|dimos|hemos (dado|autorizado|pedido))|sin (nuestro|mi|ningun) (consentimiento|autorizacion|permiso)|no hemos (dado|autorizado|solicitado)|quienes son)\b/, /\b(mai (autorizzato|richiesto|chiesto|dato|acconsentito)|senza (il nostro |la nostra |alcun[ao] )?(consenso|autorizzazione|permesso)|non abbiamo (mai )?(autorizzato|richiesto|dato)|chi siete)\b/, /\b(nunca (pedimos|autorizamos|solicitamos|consentimos|demos)|nao (autorizamos|pedimos|solicitamos|consentimos|demos)|sem (a nossa|o nosso|nossa|nosso|qualquer) (autorizacao|consentimento|permissao)|quem sao voces)\b/, /\b(nie (zugestimmt|beantragt|autorisiert|angefordert)|ohne (unsere|unser|meine|mein) (zustimmung|einverstandnis|erlaubnis|wissen)|wer sind sie)\b/],
  sem_interesse: [/\b(not interested|no interest|don'?t (want|need|wish)|do not (want|wish|need)|too many (emails|requests|messages)|stop sending|we are not looking)\b/, /\b(ne (souhaitons|voulons|desirons) pas|pas interesses?|trop de (mails|demandes|messages)|arretez d'envoyer)\b/, /\b(no (queremos|deseamos|nos interesa|estamos interesados)|demasiados (correos|mensajes|pedidos)|dejen de enviar)\b/, /\b(non (vogliamo|siamo interessati|desideriamo)|troppe (email|richieste|mail)|smettete di inviare)\b/, /\b(nao (queremos|temos interesse|desejamos|pretendemos)|demasiados (emails|pedidos|mensagens)|parem de enviar)\b/, /\b(kein interesse|nicht interessiert|nicht erwunscht|zu viele (e-?mails|anfragen))\b/],
};
const PRIORIDADE = ['juridico', 'fechou', 'nao_contatar', 'segunda_vez', 'dados_errados', 'custo', 'nao_consentiu', 'sem_interesse'];

/**
 * @param {{texto:string, assunto?:string, jaPedido?:boolean}} p  jaPedido = registro já tem opt-out ou carta de retenção anterior desta casa
 * @returns {{motivo:string, retencao:boolean, sinais:Record<string,number>, porque:string}}
 */
function avaliarMotivo(p) {
  const t = norm(`${p.assunto || ''}\n${p.texto || ''}`);
  const sinais = {};
  for (const m of PRIORIDADE) sinais[m] = (SINAIS[m] || []).filter((re) => re.test(t)).length;
  if (p.jaPedido) sinais.segunda_vez = (sinais.segunda_vez || 0) + 1;
  const motivo = PRIORIDADE.find((m) => sinais[m] > 0) || 'indefinido';
  const retencao = !SEM_RETENCAO.has(motivo);
  const porque = retencao
    ? (motivo === 'indefinido' ? 'nenhum sinal específico: carta genérica (custo zero + números da casa)' : `sinal "${motivo}": carta ajustada ao motivo`)
    : `sinal "${motivo}": sem tentativa de reversão — só reconhecimento e exclusão no prazo`;
  return { motivo, retencao, sinais, porque };
}

/** Prazo de execução: 48 h depois do registro (ADR-010: executado em ≤ 48 h). */
function prazoExecucao(agora) {
  return new Date(new Date(agora).getTime() + PRAZO_HORAS * 3_600_000);
}

function dataLonga(d, idioma) {
  const loc = { pt: 'pt-PT', en: 'en-GB', fr: 'fr-FR', es: 'es-ES', it: 'it-IT', de: 'de-DE' }[idioma] || 'en-GB';
  return new Intl.DateTimeFormat(loc, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Paris' }).format(new Date(d));
}

/**
 * A carta de retenção (uma só). Devolve texto estruturado; o HTML é montado por quem envia (_blocos-twk).
 * @param {{idioma:string, motivo:string, dossie:{casa:{name:string,city:string}, hist:{total:number,aceitos:number,ultimo_ano:number}}, prazo:Date|string}} p
 */
function cartaRetencao(p) {
  const idioma = CARTAS[p.idioma] ? p.idioma : 'en';
  const t = CARTAS[idioma];
  const n = Number(p.dossie.hist.total || 0);
  const ano = Number(p.dossie.hist.ultimo_ano || 0);
  const nome = p.dossie.casa.name;
  const data = `<strong>${dataLonga(p.prazo, idioma)}</strong>`;
  const motivo = CARTAS[idioma].motivo[p.motivo] ? p.motivo : 'indefinido';
  const paragrafos = [
    t.saudacao,
    t.reconhecimento(data),
    t.motivo[motivo](),
    ...(motivo === 'custo' || motivo === 'indefinido' ? [] : [t.custoZero()]),
    n > 0 ? t.numeros(n, ano) : t.semNumeros(),
    t.escolha(data),
    t.responder,
  ];
  return { assunto: t.assunto(nome), titulo: t.titulo(nome), paragrafos, fecho: t.fecho, rodapeWa: t.rodapeWa, rodapePrefixo: t.rodapePrefixo, idioma, palavras: t.palavras };
}

const CARTAS = {
  en: {
    palavras: { ficar: 'STAY', remover: 'REMOVE' },
    assunto: (nome) => `${nome} — before your page comes down`,
    titulo: (nome) => `Your request about ${nome}`,
    saudacao: 'Hello,',
    reconhecimento: (data) => `Your request is noted, and it comes first: your page will be taken down from The World Keys on ${data}, and after that you will receive no further booking request from us. There is no condition attached to this.`,
    motivo: {
      nao_consentiu: () => `You are right to ask how your restaurant came to be listed. The World Keys is a guide: it presents addresses we consider worth the trip, from public information, and it was never meant to oblige you to anything.`,
      custo: () => `One point I want to make clear, because it changes the picture: being presented on The World Keys, receiving booking requests and answering them costs you nothing. No fee, no subscription, nothing to pay now or later.`,
      dados_errados: () => `If the problem is the information on the page — hours, phone, address, photos — I correct it myself. Tell me what is wrong and the page will say what you say.`,
      sem_interesse: () => `If the requests are reaching the wrong inbox, I can send them to a phone number or e-mail of your choosing, or to none at all. The page can also stay without any request ever reaching you.`,
      indefinido: () => `One point I want to make clear before anything happens: being presented on The World Keys, receiving booking requests and answering them costs you nothing. No fee, no subscription, nothing to pay now or later.`,
    },
    custoZero: () => `Being presented on The World Keys, receiving booking requests and answering them costs you nothing: no fee, no subscription, nothing to pay now or later.`,
    numeros: (n, ano) => `For your information only: since your page went up, <strong>${n} guest${n === 1 ? '' : 's'}</strong> asked for a table at your restaurant through us${ano > 0 && ano < n ? `, ${ano} of them in the last twelve months` : ''}. These are travellers who looked for you by name. Answering them takes one tap from your phone.`,
    semNumeros: () => `For your information only: travellers who search your city on The World Keys find your address among the places we recommend, and any request they make reaches you directly.`,
    escolha: (data) => `The decision is yours, and both answers are good ones. Reply <strong>STAY</strong> and the page stays, with your requests going wherever you want them. Reply <strong>REMOVE</strong> and I take the page down the same day. Without a reply, it comes down on ${data}, as noted above.`,
    responder: 'Reply to this e-mail; it reaches me directly.',
    fecho: 'With my respects,<br/>Aria &#183; The World Keys',
    rodapeWa: 'Message our concierge on WhatsApp',
    rodapePrefixo: 'Any questions?',
  },
  pt: {
    palavras: { ficar: 'FICAR', remover: 'REMOVER' },
    assunto: (nome) => `${nome} — antes de a sua página sair do ar`,
    titulo: (nome) => `O seu pedido sobre ${nome}`,
    saudacao: 'Bom dia,',
    reconhecimento: (data) => `O seu pedido está registado e vem em primeiro lugar: a sua página sai da The World Keys em ${data} e, a partir daí, não receberá mais nenhum pedido de reserva por nosso intermédio. Não há qualquer condição ligada a isto.`,
    motivo: {
      nao_consentiu: () => `Tem toda a razão em perguntar como o seu restaurante foi parar à nossa lista. A The World Keys é um guia: apresenta moradas que consideramos merecerem a viagem, a partir de informação pública, e nunca pretendeu obrigá-lo a nada.`,
      custo: () => `Um ponto que faço questão de esclarecer, porque muda tudo: ser apresentado na The World Keys, receber pedidos de reserva e respondê-los não lhe custa nada. Sem taxa, sem assinatura, nada a pagar agora ou mais tarde.`,
      dados_errados: () => `Se o problema é a informação da página (horários, telefone, morada, fotografias), corrijo eu própria: diga-me o que está errado e a página passa a dizer o que o senhor disser.`,
      sem_interesse: () => `Se os pedidos estão a chegar à caixa errada, posso enviá-los para um telemóvel ou e-mail à sua escolha, ou para nenhum. A página também pode ficar sem que nenhum pedido lhe chegue.`,
      indefinido: () => `Um ponto que faço questão de esclarecer antes de qualquer coisa: ser apresentado na The World Keys, receber pedidos de reserva e respondê-los não lhe custa nada. Sem taxa, sem assinatura, nada a pagar agora ou mais tarde.`,
    },
    custoZero: () => `Ser apresentado na The World Keys, receber pedidos de reserva e respondê-los não lhe custa nada: sem taxa, sem assinatura, nada a pagar agora ou mais tarde.`,
    numeros: (n, ano) => `Só a título de informação: desde que a página existe, <strong>${n} cliente${n === 1 ? '' : 's'}</strong> pediram mesa no seu restaurante por nosso intermédio${ano > 0 && ano < n ? `, ${ano} deles nos últimos doze meses` : ''}. São viajantes que o procuraram pelo nome. Responder-lhes é um toque no telemóvel.`,
    semNumeros: () => `Só a título de informação: quem procura a sua cidade na The World Keys encontra a sua morada entre os lugares que recomendamos, e qualquer pedido chega-lhe diretamente.`,
    escolha: (data) => `A decisão é sua, e as duas respostas são boas. Responda <strong>FICAR</strong> e a página fica, com os pedidos a chegarem onde o senhor quiser. Responda <strong>REMOVER</strong> e retiro a página no próprio dia. Sem resposta, sai em ${data}, como está dito acima.`,
    responder: 'Responda a este e-mail; chega-me diretamente.',
    fecho: 'Com os meus cumprimentos,<br/>Aria &#183; The World Keys',
    rodapeWa: 'Falar com a nossa concierge no WhatsApp',
    rodapePrefixo: 'Alguma dúvida?',
  },
  fr: {
    palavras: { ficar: 'RESTER', remover: 'RETIRER' },
    assunto: (nome) => `${nome} — avant le retrait de votre page`,
    titulo: (nome) => `Votre demande concernant ${nome}`,
    saudacao: 'Bonjour,',
    reconhecimento: (data) => `Votre demande est enregistrée et passe avant tout : votre page sera retirée de The World Keys le ${data} et, à partir de là, vous ne recevrez plus aucune demande de réservation par notre intermédiaire. Aucune condition n'y est attachée.`,
    motivo: {
      nao_consentiu: () => `Vous avez raison de demander comment votre restaurant s'est retrouvé chez nous. The World Keys est un guide : il présente des adresses que nous jugeons dignes du voyage, à partir d'informations publiques, et n'a jamais eu vocation à vous engager à quoi que ce soit.`,
      custo: () => `Un point que je tiens à préciser, parce qu'il change tout : être présenté sur The World Keys, recevoir des demandes de réservation et y répondre ne vous coûte rien. Ni frais, ni abonnement, rien à payer ni maintenant ni plus tard.`,
      dados_errados: () => `Si le problème vient des informations de la page (horaires, téléphone, adresse, photos), je les corrige moi-même : dites-moi ce qui est faux et la page dira ce que vous dites.`,
      sem_interesse: () => `Si les demandes arrivent dans la mauvaise boîte, je peux les diriger vers un téléphone ou un e-mail de votre choix, ou vers aucun. La page peut aussi rester sans qu'aucune demande ne vous parvienne.`,
      indefinido: () => `Un point que je tiens à préciser avant toute chose : être présenté sur The World Keys, recevoir des demandes de réservation et y répondre ne vous coûte rien. Ni frais, ni abonnement, rien à payer ni maintenant ni plus tard.`,
    },
    custoZero: () => `Être présenté sur The World Keys, recevoir des demandes de réservation et y répondre ne vous coûte rien : ni frais, ni abonnement, rien à payer ni maintenant ni plus tard.`,
    numeros: (n, ano) => `Pour votre information seulement : depuis la mise en ligne de votre page, <strong>${n} client${n === 1 ? '' : 's'}</strong> ont demandé une table chez vous par notre intermédiaire${ano > 0 && ano < n ? `, dont ${ano} ces douze derniers mois` : ''}. Ce sont des voyageurs qui vous ont cherché par votre nom. Leur répondre tient en un geste depuis votre téléphone.`,
    semNumeros: () => `Pour votre information seulement : les voyageurs qui cherchent votre ville sur The World Keys trouvent votre adresse parmi celles que nous recommandons, et toute demande vous parvient directement.`,
    escolha: (data) => `La décision vous appartient, et les deux réponses sont bonnes. Répondez <strong>RESTER</strong> et la page reste, avec vos demandes dirigées où vous le souhaitez. Répondez <strong>RETIRER</strong> et je retire la page le jour même. Sans réponse, elle sera retirée le ${data}, comme indiqué plus haut.`,
    responder: 'Répondez à cet e-mail ; il m\'arrive directement.',
    fecho: 'Avec mes respects,<br/>Aria &#183; The World Keys',
    rodapeWa: 'Écrire à notre concierge sur WhatsApp',
    rodapePrefixo: 'Une question ?',
  },
  es: {
    palavras: { ficar: 'QUEDARSE', remover: 'ELIMINAR' },
    assunto: (nome) => `${nome} — antes de retirar su página`,
    titulo: (nome) => `Su solicitud sobre ${nome}`,
    saudacao: 'Buenos días,',
    reconhecimento: (data) => `Su solicitud está registrada y es lo primero: su página se retirará de The World Keys el ${data} y, a partir de entonces, no recibirá ninguna solicitud de reserva a través nuestro. No hay ninguna condición.`,
    motivo: {
      nao_consentiu: () => `Tiene razón en preguntar cómo llegó su restaurante a nuestra guía. The World Keys es una guía: presenta direcciones que consideramos que merecen el viaje, a partir de información pública, y nunca pretendió obligarle a nada.`,
      custo: () => `Un punto que quiero dejar claro, porque lo cambia todo: estar presente en The World Keys, recibir solicitudes de reserva y responderlas no le cuesta nada. Sin cuota, sin suscripción, nada que pagar ahora ni después.`,
      dados_errados: () => `Si el problema es la información de la página (horarios, teléfono, dirección, fotos), la corrijo yo misma: dígame qué está mal y la página dirá lo que usted diga.`,
      sem_interesse: () => `Si las solicitudes llegan al buzón equivocado, puedo enviarlas a un teléfono o correo que usted elija, o a ninguno. La página también puede quedarse sin que le llegue ninguna solicitud.`,
      indefinido: () => `Un punto que quiero dejar claro antes de nada: estar presente en The World Keys, recibir solicitudes de reserva y responderlas no le cuesta nada. Sin cuota, sin suscripción, nada que pagar ahora ni después.`,
    },
    custoZero: () => `Estar presente en The World Keys, recibir solicitudes de reserva y responderlas no le cuesta nada: sin cuota, sin suscripción, nada que pagar ahora ni después.`,
    numeros: (n, ano) => `Solo a título informativo: desde que existe su página, <strong>${n} cliente${n === 1 ? '' : 's'}</strong> pidieron mesa en su restaurante a través nuestro${ano > 0 && ano < n ? `, ${ano} de ellos en los últimos doce meses` : ''}. Son viajeros que le buscaron por su nombre. Responderles es un toque en el teléfono.`,
    semNumeros: () => `Solo a título informativo: quien busca su ciudad en The World Keys encuentra su dirección entre los lugares que recomendamos, y cualquier solicitud le llega directamente.`,
    escolha: (data) => `La decisión es suya, y las dos respuestas son buenas. Responda <strong>QUEDARSE</strong> y la página se queda, con las solicitudes llegando adonde usted quiera. Responda <strong>ELIMINAR</strong> y retiro la página el mismo día. Sin respuesta, se retira el ${data}, como indico arriba.`,
    responder: 'Responda a este correo; me llega directamente.',
    fecho: 'Con mis respetos,<br/>Aria &#183; The World Keys',
    rodapeWa: 'Escribir a nuestra concierge por WhatsApp',
    rodapePrefixo: '¿Alguna duda?',
  },
  it: {
    palavras: { ficar: 'RESTARE', remover: 'RIMUOVERE' },
    assunto: (nome) => `${nome} — prima che la sua pagina venga rimossa`,
    titulo: (nome) => `La sua richiesta su ${nome}`,
    saudacao: 'Buongiorno,',
    reconhecimento: (data) => `La sua richiesta è registrata e viene prima di tutto: la sua pagina sarà rimossa da The World Keys ${data} e, da quel momento, non riceverà più alcuna richiesta di prenotazione tramite noi. Non c'è alcuna condizione.`,
    motivo: {
      nao_consentiu: () => `Ha ragione a chiedere come il suo ristorante sia finito nella nostra guida. The World Keys è una guida: presenta indirizzi che riteniamo valgano il viaggio, a partire da informazioni pubbliche, e non ha mai voluto obbligarla a nulla.`,
      custo: () => `Un punto che tengo a chiarire, perché cambia tutto: essere presenti su The World Keys, ricevere richieste di prenotazione e rispondere non le costa nulla. Nessuna tariffa, nessun abbonamento, niente da pagare ora o in seguito.`,
      dados_errados: () => `Se il problema sono le informazioni della pagina (orari, telefono, indirizzo, foto), le correggo io stessa: mi dica cosa è sbagliato e la pagina dirà ciò che dice lei.`,
      sem_interesse: () => `Se le richieste arrivano nella casella sbagliata, posso inviarle a un telefono o a un'e-mail di sua scelta, oppure a nessuno. La pagina può anche restare senza che le arrivi alcuna richiesta.`,
      indefinido: () => `Un punto che tengo a chiarire prima di tutto: essere presenti su The World Keys, ricevere richieste di prenotazione e rispondere non le costa nulla. Nessuna tariffa, nessun abbonamento, niente da pagare ora o in seguito.`,
    },
    custoZero: () => `Essere presenti su The World Keys, ricevere richieste di prenotazione e rispondere non le costa nulla: nessuna tariffa, nessun abbonamento, niente da pagare ora o in seguito.`,
    numeros: (n, ano) => `Solo a titolo informativo: da quando la pagina esiste, <strong>${n} client${n === 1 ? 'e' : 'i'}</strong> hanno chiesto un tavolo nel suo ristorante tramite noi${ano > 0 && ano < n ? `, ${ano} negli ultimi dodici mesi` : ''}. Sono viaggiatori che l'hanno cercata per nome. Rispondere è un tocco sul telefono.`,
    semNumeros: () => `Solo a titolo informativo: chi cerca la sua città su The World Keys trova il suo indirizzo tra i luoghi che consigliamo, e ogni richiesta le arriva direttamente.`,
    escolha: (data) => `La decisione è sua, ed entrambe le risposte vanno bene. Risponda <strong>RESTARE</strong> e la pagina resta, con le richieste indirizzate dove preferisce. Risponda <strong>RIMUOVERE</strong> e rimuovo la pagina il giorno stesso. Senza risposta, viene rimossa ${data}, come indicato sopra.`,
    responder: 'Risponda a questa e-mail; mi arriva direttamente.',
    fecho: 'Con i miei rispetti,<br/>Aria &#183; The World Keys',
    rodapeWa: 'Scrivere alla nostra concierge su WhatsApp',
    rodapePrefixo: 'Qualche domanda?',
  },
  de: {
    palavras: { ficar: 'BLEIBEN', remover: 'ENTFERNEN' },
    assunto: (nome) => `${nome} — bevor Ihre Seite offline geht`,
    titulo: (nome) => `Ihre Anfrage zu ${nome}`,
    saudacao: 'Guten Tag,',
    reconhecimento: (data) => `Ihre Anfrage ist vermerkt und hat Vorrang: Ihre Seite wird am ${data} von The World Keys entfernt, und danach erhalten Sie über uns keine Reservierungsanfrage mehr. Daran ist keine Bedingung geknüpft.`,
    motivo: {
      nao_consentiu: () => `Sie fragen zu Recht, wie Ihr Restaurant in unseren Guide gekommen ist. The World Keys ist ein Guide: Er stellt Adressen vor, die wir für die Reise wert halten, aus öffentlichen Informationen, und sollte Sie nie zu etwas verpflichten.`,
      custo: () => `Ein Punkt, den ich klarstellen möchte, weil er alles ändert: Auf The World Keys präsentiert zu werden, Reservierungsanfragen zu erhalten und zu beantworten kostet Sie nichts. Keine Gebühr, kein Abo, nichts zu zahlen, weder jetzt noch später.`,
      dados_errados: () => `Wenn das Problem die Angaben auf der Seite sind (Öffnungszeiten, Telefon, Adresse, Fotos), korrigiere ich sie selbst: Sagen Sie mir, was falsch ist, und die Seite sagt, was Sie sagen.`,
      sem_interesse: () => `Wenn die Anfragen im falschen Postfach landen, kann ich sie an eine Telefonnummer oder E-Mail Ihrer Wahl schicken, oder an keine. Die Seite kann auch bleiben, ohne dass Sie je eine Anfrage erreicht.`,
      indefinido: () => `Ein Punkt, den ich vorab klarstellen möchte: Auf The World Keys präsentiert zu werden, Reservierungsanfragen zu erhalten und zu beantworten kostet Sie nichts. Keine Gebühr, kein Abo, nichts zu zahlen, weder jetzt noch später.`,
    },
    custoZero: () => `Auf The World Keys präsentiert zu werden, Reservierungsanfragen zu erhalten und zu beantworten kostet Sie nichts: keine Gebühr, kein Abo, nichts zu zahlen, weder jetzt noch später.`,
    numeros: (n, ano) => `Nur zu Ihrer Information: Seit Ihre Seite online ist, haben <strong>${n} Gast${n === 1 ? '' : 'e'}</strong> über uns einen Tisch in Ihrem Restaurant angefragt${ano > 0 && ano < n ? `, ${ano} davon in den letzten zwölf Monaten` : ''}. Das sind Reisende, die Sie namentlich gesucht haben. Ihnen zu antworten ist ein Tipp auf dem Telefon.`,
    semNumeros: () => `Nur zu Ihrer Information: Wer Ihre Stadt auf The World Keys sucht, findet Ihre Adresse unter den Orten, die wir empfehlen, und jede Anfrage erreicht Sie direkt.`,
    escolha: (data) => `Die Entscheidung liegt bei Ihnen, und beide Antworten sind gut. Antworten Sie <strong>BLEIBEN</strong>, und die Seite bleibt, mit Ihren Anfragen dort, wo Sie sie haben möchten. Antworten Sie <strong>ENTFERNEN</strong>, und ich nehme die Seite noch am selben Tag offline. Ohne Antwort geht sie am ${data} offline, wie oben vermerkt.`,
    responder: 'Antworten Sie einfach auf diese E-Mail; sie erreicht mich direkt.',
    fecho: 'Mit freundlichen Grüßen,<br/>Aria &#183; The World Keys',
    rodapeWa: 'Unserer Concierge auf WhatsApp schreiben',
    rodapePrefixo: 'Fragen?',
  },
};

/** Termos que não saem em carta nenhuma (ADR-015 + verdade): fragilidade exposta, promessa sem lastro, "sem comissão". */
const PROIBIDO = [/not a partner/i, /n[ãa]o (é|e) parceir/i, /pas .{0,12}partenaire/i, /cannot promise/i, /garantimos/i, /confirmada/i, /confirmed table/i,
  /instant(ly)?\s+(availability|confirmation|booking)/i, /confirmation in hand/i, /disponibilit[ée]\s+imm[ée]diate/i, /confirmation\s+imm[ée]diate/i,
  /sans commission/i, /no commission/i, /sem comiss[ãa]o/i, /sin comisi[óo]n/i, /senza commissione/i, /ohne provision/i, /en deux minutes/i, /in two minutes/i,
  /unforgettable|inesquec[ií]vel|inoubliable|inolvidable|indimenticabile|unvergesslich/i];
function termosProibidos(texto) {
  const t = String(texto).replace(/<[^>]+>/g, ' ');
  return PROIBIDO.filter((re) => re.test(t)).map(String);
}

/**
 * O que a casa respondeu: 'remover' | 'ficar' | 'outro'. Remoção prevalece (ADR-010), exceto quando negada
 * ("não remover", "ne pas retirer"). Palavras-chave da própria carta valem em qualquer idioma.
 */
function classificarResposta(texto) {
  const t = norm(texto);
  if (!t.trim()) return 'outro';
  // Radicais, não infinitivos: "retirez", "eliminen", "rimuovete", "supprimez" são as formas que a casa escreve.
  const negaRemocao = /\b(don'?t|do not|not|never|ne pas|ne .{0,14} pas|no|nao|nicht|non)\s+(remov|delet|take .{0,6}down|retir|supprim|elimin|rimuov|exclu|losch|loesch|entfern)/.test(t);
  const remover = /\b(remov\w*|removal|delet\w*|take (it |the page |us )?down|retir\w*|retrait|supprim\w*|suppression|elimin\w*|baja|rimuov\w*|rimozione|cancell\w*|remocao|exclus(ao|ion)|exclu(ir|a|am|em)|entfern\w*|losch\w*|loesch\w*)\b/.test(t);
  const ficar = /\b(stay|keep (it|the page|us)|leave it (up|online)|rester|garder|conserver|laissez(-la)?|quedarse|quedamos|mantener|dejarla|mantenerla|restare|mantenere|lasciatela|ficar|ficamos|manter|mantenham|deixem|bleiben|behalten|lassen sie (sie|es))\b/.test(t);
  if (negaRemocao) return 'ficar';
  if (remover) return 'remover';
  if (ficar) return 'ficar';
  return 'outro';
}

/**
 * Máquina de estados do caso. estado.status: 'novo' | 'carta_enviada' | 'reter' | 'executar' | 'executado' | 'retida'
 * @returns {{acao:'enviar_carta'|'aguardar'|'executar'|'reter'|'nada', porque:string}}
 */
function decidir({ estado, avaliacao, respostas = [], agora }) {
  const t = new Date(agora).getTime();
  if (!estado || estado.status === 'novo') {
    return avaliacao.retencao ? { acao: 'enviar_carta', porque: avaliacao.porque } : { acao: 'executar', porque: avaliacao.porque };
  }
  if (estado.status === 'executado' || estado.status === 'retida') return { acao: 'nada', porque: `caso já ${estado.status}` };
  if (estado.status === 'carta_enviada') {
    const depois = respostas.filter((r) => new Date(r.em).getTime() > new Date(estado.carta_enviada_em).getTime());
    const ultima = depois.length ? depois[depois.length - 1] : null;
    if (ultima) {
      const c = classificarResposta(ultima.texto);
      if (c === 'remover') return { acao: 'executar', porque: 'a casa respondeu que quer a remoção' };
      if (c === 'ficar') return { acao: 'reter', porque: 'a casa respondeu que quer ficar' };
    }
    if (t >= new Date(estado.prazo).getTime()) return { acao: 'executar', porque: `prazo de ${PRAZO_HORAS} h vencido sem resposta que mude o pedido` };
    return { acao: 'aguardar', porque: ultima ? 'resposta sem decisão clara — aguarda o prazo' : 'sem resposta — aguarda o prazo' };
  }
  if (estado.status === 'executar') return { acao: 'executar', porque: 'execução pendente' };
  if (estado.status === 'reter') return { acao: 'reter', porque: 'retenção pendente de registro' };
  return { acao: 'nada', porque: `estado desconhecido: ${estado.status}` };
}

module.exports = { avaliarMotivo, cartaRetencao, prazoExecucao, decidir, classificarResposta, termosProibidos, dataLonga, MOTIVOS, SEM_RETENCAO, PRAZO_HORAS, IDIOMAS: Object.keys(CARTAS) };
