'use strict';
/**
 * Chave Girada — "Extrato de Resposta": um e-mail por casa, por segmento, com os números DELA.
 *
 * Estratégia de conversão (evidência em PLANO-CHAVE-GIRADA.md):
 *  1. Mesma identidade visual dos e-mails transacionais que estas casas já clicaram ~289 vezes (fundo #0B0A08, dourado #CE9E3C, Georgia) → familiaridade = confiança.
 *  2. O número DELES em destaque (cartão-extrato), não o nosso pedido. Reconhecimento, nunca cobrança: tokens de "pendência" são proibidos por teste.
 *  3. Exclusividade por MÉRITO e verdadeira ("uma das 11 casas, em 1.548") — nunca escassez de teatro.
 *  4. Um botão, um destino real, três passos com o e-mail (mascarado) para onde o código vai → remove a incerteza que travou o WOO TENDER.
 *  5. Assinatura de pessoa (Márlon), não de robô. Grátis, sem cartão — dito uma vez, sem gritar.
 *  6. Só promete o que existe hoje. Selo "Responde rápido" só entra com config.seloDisponivel (front publicado).
 *  7. Rodapé de opt-out obrigatório (guardrail 8, código).
 * Sem LLM.
 */
const { rodape, exigirOptout } = require('../registro-optout/rodape-optout');

const REGISTER = process.env.TWK_REGISTER_URL || 'https://manager.theworldkeys.com/register';
const TOKENS_PROIBIDOS = [/pendent/i, /pending/i, /esperando/i, /aguardando/i, /sem resposta/i, /waiting/i, /en attente/i, /pendiente/i, /in attesa/i, /garantid/i, /guaranteed/i, /imediat/i, /immediate/i, /última chance/i, /last chance/i, /vagas? de fundador/i, /founder/i, /urgente/i, /urgent/i];

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmtN = (n, lang) => Number(n).toLocaleString({ pt: 'pt-PT', en: 'en-GB', fr: 'fr-FR', es: 'es-ES', it: 'it-IT' }[lang] || 'en-GB');

// ---- textos por idioma e segmento ---------------------------------------------------------
// n = { pedidos, aceitos, recusados }  ·  ctx = { confirmadores, publicados, email_mascarado, seloDisponivel }
const T = {
  pt: {
    preheader: (c, n, s) => s === 'A' ? `${c}: ${n.aceitos} de ${n.aceitos} pedidos aceitos. A sua chave está pronta.` : `${c}: o seu extrato de respostas na The World Keys — e a sua chave.`,
    saudacao: (c) => `Olá, equipe do ${c}.`,
    A: {
      assunto: (c, n) => `${c}: ${n.aceitos} de ${n.aceitos} pedidos aceitos. Isto é para vocês.`,
      hero: (n) => ({ big: `${n.aceitos} / ${n.aceitos}`, label: 'pedidos de mesa aceitos nos últimos 6 meses' }),
      titulo: (n, ctx) => `Uma das ${ctx.confirmadores} casas, em ${fmtN(ctx.publicados, 'pt')}, que aceita tudo o que vê.`,
      corpo: (c, n, ctx) => [
        `Cada pedido de mesa que vocês abriram na The World Keys nos últimos seis meses foi aceito. Entre ${fmtN(ctx.publicados, 'pt')} restaurantes publicados, só ${ctx.confirmadores} fazem isso — e por isso escrevemos primeiro para vocês.`,
        `Hoje esse trabalho é feito pelo link de cada e-mail, um a um. A conta profissional da casa existe para isso: todos os pedidos num painel só, resposta num toque pelo telemóvel, histórico completo, e os horários e a política de reserva da vossa página nas vossas mãos.`,
        ctx.seloDisponivel ? `Com a conta ativa, a vossa página passa a mostrar aos clientes o selo "Responde rápido" — calculado com os vossos números reais.` : `Queremos que os clientes vejam o que vocês já fazem. A conta é o primeiro passo para isso aparecer na vossa página.`,
      ],
      cta: 'Ativar a conta da casa',
    },
    B: {
      assunto: (c, n) => `${c}: ${n.aceitos} sim, ${n.recusados} não. O vosso extrato — e a vossa chave.`,
      hero: (n) => ({ big: `${n.aceitos + n.recusados}`, label: `respostas nos últimos 6 meses · ${n.aceitos} sim · ${n.recusados} não` }),
      titulo: () => `Responder já vos coloca à frente de quase todo o catálogo.`,
      corpo: (c, n, ctx) => [
        `Nos últimos seis meses vocês responderam a ${n.aceitos + n.recusados} pedidos de mesa pela The World Keys — ${n.aceitos} aceitos, ${n.recusados} recusados. A maioria dos restaurantes nunca responde. Vocês respondem, e é por isso que escrevemos primeiro para vocês.`,
        `Cada "não" custa a vocês e a nós. Com a conta profissional gratuita, vocês veem todos os pedidos num painel só, respondem num toque pelo telemóvel e definem os horários e a política de reserva da vossa página — para que o que chega seja o que podem aceitar.`,
      ],
      cta: 'Ativar a conta e assumir a página',
    },
    C: {
      assunto: (c, n) => `${c}: ${n.recusados} vezes "não" em seis meses. Isto pode mudar.`,
      hero: (n) => ({ big: `${n.recusados}`, label: `pedidos que tiveram de recusar nos últimos 6 meses` }),
      titulo: () => `Vocês respondem a quase tudo. Recusar quase tudo é um problema nosso para resolver com vocês.`,
      corpo: (c, n, ctx) => [
        `Nos últimos seis meses vocês responderam a ${n.aceitos + n.recusados} pedidos pela The World Keys — e tiveram de recusar ${n.recusados}. Responder a tantos é raro; ter de dizer não a quase todos significa que a nossa página está a pedir algo que a casa não pode dar.`,
        `Com a conta profissional gratuita, vocês passam a definir o que a vossa página oferece — horários e política de reserva — e a ver cada pedido num painel só. O objetivo é simples: que chegue só o que vocês podem aceitar.`,
      ],
      cta: 'Ativar a conta e assumir a página',
    },
    passos: (ctx) => [`Abram o link e escolham "O meu restaurante já está no site".`, `Um código de 6 dígitos chega em ${ctx.email_mascarado || 'o e-mail de reservas da casa'}.`, `Inserem o código, criam a senha — e a página é vossa. Dois minutos, gratuito, sem cartão.`],
    passos_titulo: 'Como funciona',
    ajuda: `Se preferirem, respondam a este e-mail e ativamos com vocês.`,
    fecho: `Obrigado por responderem aos nossos clientes. É isso que faz a plataforma valer — para eles e para vocês.`,
    assinatura: ['Márlon Andrade', 'Gerente Comercial · The World Keys', 'reservation@theworldkeys.com'],
  },
  en: {
    preheader: (c, n, s) => s === 'A' ? `${c}: ${n.aceitos} of ${n.aceitos} requests accepted. Your key is ready.` : `${c}: your reply statement on The World Keys — and your key.`,
    saudacao: (c) => `Hello, ${c} team.`,
    A: {
      assunto: (c, n) => `${c}: ${n.aceitos} of ${n.aceitos} requests accepted. This is for you.`,
      hero: (n) => ({ big: `${n.aceitos} / ${n.aceitos}`, label: 'table requests accepted in the last 6 months' }),
      titulo: (n, ctx) => `One of ${ctx.confirmadores} restaurants, out of ${fmtN(ctx.publicados, 'en')}, that accepts everything it opens.`,
      corpo: (c, n, ctx) => [
        `Every table request you opened on The World Keys in the last six months was accepted. Among ${fmtN(ctx.publicados, 'en')} listed restaurants, only ${ctx.confirmadores} do that — which is why we are writing to you first.`,
        `Today that work happens through the link in each email, one at a time. The restaurant's professional account exists for exactly this: every request in one dashboard, a one-tap reply from your phone, the full history, and your page's hours and reservation policy in your hands.`,
        ctx.seloDisponivel ? `With the account active, your page shows guests a "Replies fast" badge — computed from your real numbers.` : `We want guests to see what you already do. The account is the first step to making it visible on your page.`,
      ],
      cta: 'Activate the restaurant account',
    },
    B: {
      assunto: (c, n) => `${c}: ${n.aceitos} yes, ${n.recusados} no. Your statement — and your key.`,
      hero: (n) => ({ big: `${n.aceitos + n.recusados}`, label: `replies in the last 6 months · ${n.aceitos} yes · ${n.recusados} no` }),
      titulo: () => `Replying already puts you ahead of almost the entire catalogue.`,
      corpo: (c, n, ctx) => [
        `In the last six months you replied to ${n.aceitos + n.recusados} table requests through The World Keys — ${n.aceitos} accepted, ${n.recusados} declined. Most restaurants never reply. You do, and that is why we are writing to you first.`,
        `Every "no" costs you and us. With the free professional account you see every request in one dashboard, reply in one tap from your phone, and set your page's hours and reservation policy — so what arrives is what you can accept.`,
      ],
      cta: 'Activate the account and take over the page',
    },
    C: {
      assunto: (c, n) => `${c}: "no" ${n.recusados} times in six months. This can change.`,
      hero: (n) => ({ big: `${n.recusados}`, label: `requests you had to decline in the last 6 months` }),
      titulo: () => `You reply to almost everything. Declining almost everything is our problem to fix with you.`,
      corpo: (c, n, ctx) => [
        `In the last six months you replied to ${n.aceitos + n.recusados} requests through The World Keys — and had to decline ${n.recusados}. Replying to that many is rare; having to say no to almost all of them means our page is asking for something the restaurant cannot give.`,
        `With the free professional account you define what your page offers — hours and reservation policy — and see every request in one dashboard. The goal is simple: only what you can accept should arrive.`,
      ],
      cta: 'Activate the account and take over the page',
    },
    passos: (ctx) => [`Open the link and choose "My restaurant is already on the site".`, `A 6-digit code arrives at ${ctx.email_mascarado || "the restaurant's reservations email"}.`, `Enter the code, set a password — and the page is yours. Two minutes, free, no card.`],
    passos_titulo: 'How it works',
    ajuda: `If you prefer, reply to this email and we will activate it with you.`,
    fecho: `Thank you for replying to our guests. That is what makes the platform worth it — for them and for you.`,
    assinatura: ['Márlon Andrade', 'Commercial Manager · The World Keys', 'reservation@theworldkeys.com'],
  },
  fr: {
    preheader: (c, n, s) => s === 'A' ? `${c} : ${n.aceitos} demandes sur ${n.aceitos} acceptées. Votre clé est prête.` : `${c} : votre relevé de réponses sur The World Keys — et votre clé.`,
    saudacao: (c) => `Bonjour, l'équipe de ${c}.`,
    A: {
      assunto: (c, n) => `${c} : ${n.aceitos} demandes sur ${n.aceitos} acceptées. Ceci est pour vous.`,
      hero: (n) => ({ big: `${n.aceitos} / ${n.aceitos}`, label: 'demandes de table acceptées ces 6 derniers mois' }),
      titulo: (n, ctx) => `L'une des ${ctx.confirmadores} maisons, sur ${fmtN(ctx.publicados, 'fr')}, qui accepte tout ce qu'elle ouvre.`,
      corpo: (c, n, ctx) => [
        `Chaque demande de table que vous avez ouverte sur The World Keys ces six derniers mois a été acceptée. Parmi ${fmtN(ctx.publicados, 'fr')} restaurants référencés, seuls ${ctx.confirmadores} le font — c'est pourquoi nous vous écrivons en premier.`,
        `Aujourd'hui ce travail passe par le lien de chaque e-mail, un par un. Le compte professionnel de la maison existe pour cela : toutes les demandes dans un seul tableau de bord, une réponse en un geste depuis le téléphone, l'historique complet, et les horaires et la politique de réservation de votre page entre vos mains.`,
        ctx.seloDisponivel ? `Avec le compte actif, votre page affiche aux clients le badge « Répond vite » — calculé sur vos chiffres réels.` : `Nous voulons que les clients voient ce que vous faites déjà. Le compte est la première étape pour le rendre visible sur votre page.`,
      ],
      cta: 'Activer le compte de la maison',
    },
    B: {
      assunto: (c, n) => `${c} : ${n.aceitos} oui, ${n.recusados} non. Votre relevé — et votre clé.`,
      hero: (n) => ({ big: `${n.aceitos + n.recusados}`, label: `réponses ces 6 derniers mois · ${n.aceitos} oui · ${n.recusados} non` }),
      titulo: () => `Répondre vous place déjà devant presque tout le catalogue.`,
      corpo: (c, n, ctx) => [
        `Ces six derniers mois vous avez répondu à ${n.aceitos + n.recusados} demandes de table via The World Keys — ${n.aceitos} acceptées, ${n.recusados} refusées. La plupart des restaurants ne répondent jamais. Vous répondez, et c'est pourquoi nous vous écrivons en premier.`,
        `Chaque « non » vous coûte, et nous aussi. Avec le compte professionnel gratuit, vous voyez toutes les demandes dans un seul tableau de bord, répondez en un geste depuis le téléphone, et définissez les horaires et la politique de réservation de votre page — pour que ce qui arrive soit ce que vous pouvez accepter.`,
      ],
      cta: 'Activer le compte et reprendre la page',
    },
    C: {
      assunto: (c, n) => `${c} : « non » ${n.recusados} fois en six mois. Cela peut changer.`,
      hero: (n) => ({ big: `${n.recusados}`, label: `demandes que vous avez dû refuser ces 6 derniers mois` }),
      titulo: () => `Vous répondez à presque tout. Refuser presque tout est notre problème, à régler avec vous.`,
      corpo: (c, n, ctx) => [
        `Ces six derniers mois vous avez répondu à ${n.aceitos + n.recusados} demandes via The World Keys — et dû en refuser ${n.recusados}. Répondre à autant est rare ; devoir dire non à presque toutes signifie que notre page demande quelque chose que la maison ne peut pas donner.`,
        `Avec le compte professionnel gratuit, vous définissez ce que votre page propose — horaires et politique de réservation — et voyez chaque demande dans un seul tableau de bord. L'objectif est simple : que n'arrive que ce que vous pouvez accepter.`,
      ],
      cta: 'Activer le compte et reprendre la page',
    },
    passos: (ctx) => [`Ouvrez le lien et choisissez « Mon restaurant est déjà sur le site ».`, `Un code à 6 chiffres arrive à ${ctx.email_mascarado || "l'e-mail de réservation de la maison"}.`, `Saisissez le code, créez un mot de passe — et la page est à vous. Deux minutes, gratuit, sans carte.`],
    passos_titulo: 'Comment ça marche',
    ajuda: `Si vous préférez, répondez à cet e-mail et nous l'activons avec vous.`,
    fecho: `Merci de répondre à nos clients. C'est ce qui donne sa valeur à la plateforme — pour eux et pour vous.`,
    assinatura: ['Márlon Andrade', 'Responsable commercial · The World Keys', 'reservation@theworldkeys.com'],
  },
  es: {
    preheader: (c, n, s) => s === 'A' ? `${c}: ${n.aceitos} de ${n.aceitos} solicitudes aceptadas. Su llave está lista.` : `${c}: su extracto de respuestas en The World Keys — y su llave.`,
    saudacao: (c) => `Hola, equipo de ${c}.`,
    A: {
      assunto: (c, n) => `${c}: ${n.aceitos} de ${n.aceitos} solicitudes aceptadas. Esto es para ustedes.`,
      hero: (n) => ({ big: `${n.aceitos} / ${n.aceitos}`, label: 'solicitudes de mesa aceptadas en los últimos 6 meses' }),
      titulo: (n, ctx) => `Una de las ${ctx.confirmadores} casas, entre ${fmtN(ctx.publicados, 'es')}, que acepta todo lo que abre.`,
      corpo: (c, n, ctx) => [
        `Cada solicitud de mesa que abrieron en The World Keys en los últimos seis meses fue aceptada. Entre ${fmtN(ctx.publicados, 'es')} restaurantes publicados, solo ${ctx.confirmadores} lo hacen — por eso les escribimos primero.`,
        `Hoy ese trabajo pasa por el enlace de cada correo, uno a uno. La cuenta profesional de la casa existe para esto: todas las solicitudes en un solo panel, respuesta en un toque desde el móvil, historial completo, y los horarios y la política de reserva de su página en sus manos.`,
        ctx.seloDisponivel ? `Con la cuenta activa, su página muestra a los clientes el sello "Responde rápido" — calculado con sus números reales.` : `Queremos que los clientes vean lo que ustedes ya hacen. La cuenta es el primer paso para que se vea en su página.`,
      ],
      cta: 'Activar la cuenta de la casa',
    },
    B: {
      assunto: (c, n) => `${c}: ${n.aceitos} sí, ${n.recusados} no. Su extracto — y su llave.`,
      hero: (n) => ({ big: `${n.aceitos + n.recusados}`, label: `respuestas en los últimos 6 meses · ${n.aceitos} sí · ${n.recusados} no` }),
      titulo: () => `Responder ya los pone por delante de casi todo el catálogo.`,
      corpo: (c, n, ctx) => [
        `En los últimos seis meses respondieron a ${n.aceitos + n.recusados} solicitudes de mesa por The World Keys — ${n.aceitos} aceptadas, ${n.recusados} rechazadas. La mayoría de los restaurantes nunca responde. Ustedes sí, y por eso les escribimos primero.`,
        `Cada "no" les cuesta a ustedes y a nosotros. Con la cuenta profesional gratuita ven todas las solicitudes en un panel, responden en un toque desde el móvil y definen los horarios y la política de reserva de su página — para que lo que llega sea lo que pueden aceptar.`,
      ],
      cta: 'Activar la cuenta y asumir la página',
    },
    C: {
      assunto: (c, n) => `${c}: "no" ${n.recusados} veces en seis meses. Esto puede cambiar.`,
      hero: (n) => ({ big: `${n.recusados}`, label: `solicitudes que tuvieron que rechazar en los últimos 6 meses` }),
      titulo: () => `Responden a casi todo. Rechazar casi todo es un problema nuestro para resolver con ustedes.`,
      corpo: (c, n, ctx) => [
        `En los últimos seis meses respondieron a ${n.aceitos + n.recusados} solicitudes por The World Keys — y tuvieron que rechazar ${n.recusados}. Responder a tantas es raro; tener que decir no a casi todas significa que nuestra página pide algo que la casa no puede dar.`,
        `Con la cuenta profesional gratuita definen lo que su página ofrece — horarios y política de reserva — y ven cada solicitud en un solo panel. El objetivo es simple: que llegue solo lo que pueden aceptar.`,
      ],
      cta: 'Activar la cuenta y asumir la página',
    },
    passos: (ctx) => [`Abran el enlace y elijan "Mi restaurante ya está en el sitio".`, `Un código de 6 dígitos llega a ${ctx.email_mascarado || 'el correo de reservas de la casa'}.`, `Introducen el código, crean la contraseña — y la página es suya. Dos minutos, gratis, sin tarjeta.`],
    passos_titulo: 'Cómo funciona',
    ajuda: `Si prefieren, respondan a este correo y la activamos con ustedes.`,
    fecho: `Gracias por responder a nuestros clientes. Eso es lo que hace que la plataforma valga — para ellos y para ustedes.`,
    assinatura: ['Márlon Andrade', 'Gerente Comercial · The World Keys', 'reservation@theworldkeys.com'],
  },
  it: {
    preheader: (c, n, s) => s === 'A' ? `${c}: ${n.aceitos} richieste su ${n.aceitos} accettate. La vostra chiave è pronta.` : `${c}: il vostro estratto delle risposte su The World Keys — e la vostra chiave.`,
    saudacao: (c) => `Buongiorno, team di ${c}.`,
    A: {
      assunto: (c, n) => `${c}: ${n.aceitos} richieste su ${n.aceitos} accettate. Questo è per voi.`,
      hero: (n) => ({ big: `${n.aceitos} / ${n.aceitos}`, label: 'richieste di tavolo accettate negli ultimi 6 mesi' }),
      titulo: (n, ctx) => `Uno dei ${ctx.confirmadores} locali, su ${fmtN(ctx.publicados, 'it')}, che accetta tutto ciò che apre.`,
      corpo: (c, n, ctx) => [
        `Ogni richiesta di tavolo che avete aperto su The World Keys negli ultimi sei mesi è stata accettata. Tra ${fmtN(ctx.publicados, 'it')} ristoranti pubblicati, solo ${ctx.confirmadores} lo fanno — per questo scriviamo prima a voi.`,
        `Oggi quel lavoro passa dal link di ogni e-mail, una alla volta. L'account professionale del locale esiste proprio per questo: tutte le richieste in un unico pannello, risposta con un tocco dal telefono, cronologia completa, e gli orari e la politica di prenotazione della vostra pagina nelle vostre mani.`,
        ctx.seloDisponivel ? `Con l'account attivo, la vostra pagina mostra ai clienti il badge "Risponde subito" — calcolato sui vostri numeri reali.` : `Vogliamo che i clienti vedano ciò che già fate. L'account è il primo passo perché sia visibile sulla vostra pagina.`,
      ],
      cta: "Attivare l'account del locale",
    },
    B: {
      assunto: (c, n) => `${c}: ${n.aceitos} sì, ${n.recusados} no. Il vostro estratto — e la vostra chiave.`,
      hero: (n) => ({ big: `${n.aceitos + n.recusados}`, label: `risposte negli ultimi 6 mesi · ${n.aceitos} sì · ${n.recusados} no` }),
      titulo: () => `Rispondere vi mette già davanti a quasi tutto il catalogo.`,
      corpo: (c, n, ctx) => [
        `Negli ultimi sei mesi avete risposto a ${n.aceitos + n.recusados} richieste di tavolo tramite The World Keys — ${n.aceitos} accettate, ${n.recusados} rifiutate. La maggior parte dei ristoranti non risponde mai. Voi sì, ed è per questo che scriviamo prima a voi.`,
        `Ogni "no" costa a voi e a noi. Con l'account professionale gratuito vedete tutte le richieste in un unico pannello, rispondete con un tocco dal telefono e definite gli orari e la politica di prenotazione della vostra pagina — così che arrivi ciò che potete accettare.`,
      ],
      cta: "Attivare l'account e prendere in mano la pagina",
    },
    C: {
      assunto: (c, n) => `${c}: "no" ${n.recusados} volte in sei mesi. Questo può cambiare.`,
      hero: (n) => ({ big: `${n.recusados}`, label: `richieste che avete dovuto rifiutare negli ultimi 6 mesi` }),
      titulo: () => `Rispondete a quasi tutto. Rifiutare quasi tutto è un problema nostro, da risolvere con voi.`,
      corpo: (c, n, ctx) => [
        `Negli ultimi sei mesi avete risposto a ${n.aceitos + n.recusados} richieste tramite The World Keys — e avete dovuto rifiutarne ${n.recusados}. Rispondere a così tante è raro; dover dire no a quasi tutte significa che la nostra pagina chiede qualcosa che il locale non può dare.`,
        `Con l'account professionale gratuito definite ciò che la vostra pagina offre — orari e politica di prenotazione — e vedete ogni richiesta in un unico pannello. L'obiettivo è semplice: che arrivi solo ciò che potete accettare.`,
      ],
      cta: "Attivare l'account e prendere in mano la pagina",
    },
    passos: (ctx) => [`Aprite il link e scegliete "Il mio ristorante è già sul sito".`, `Un codice a 6 cifre arriva a ${ctx.email_mascarado || "l'e-mail prenotazioni del locale"}.`, `Inserite il codice, create la password — e la pagina è vostra. Due minuti, gratis, senza carta.`],
    passos_titulo: 'Come funziona',
    ajuda: `Se preferite, rispondete a questa e-mail e lo attiviamo insieme a voi.`,
    fecho: `Grazie per rispondere ai nostri clienti. È questo che dà valore alla piattaforma — per loro e per voi.`,
    assinatura: ['Márlon Andrade', 'Responsabile commerciale · The World Keys', 'reservation@theworldkeys.com'],
  },
};

const SEGMENTOS = { 'A-CONFIRMADOR': 'A', 'B-MISTO': 'B', 'C-RECUSADOR': 'C', 'D-OCASIONAL': 'B' };

/** Mascara a parte local do e-mail: info@casa.it → i***@casa.it (a casa reconhece o próprio endereço; ninguém mais). */
function mascararEmail(e) {
  if (!e || !/@/.test(e)) return null;
  const [l, d] = e.split('@');
  return `${l.slice(0, 1)}***@${d}`;
}

function gerarExtrato({ segmento, idioma, casa, n, ctx, restaurant_id }) {
  const seg = SEGMENTOS[segmento] || segmento;
  const t = T[idioma] || T.en;
  const s = t[seg];
  if (!s) throw new Error(`segmento desconhecido: ${segmento}`);
  const c = ctx || {};
  const contexto = { confirmadores: c.confirmadores ?? 11, publicados: c.publicados ?? 1548, email_mascarado: c.email_mascarado || mascararEmail(c.email) || null, seloDisponivel: !!c.seloDisponivel };
  const paras = s.corpo(casa.name, n, contexto).filter(Boolean);
  const assunto = s.assunto(casa.name, n);
  const hero = s.hero(n);
  const titulo = s.titulo(n, contexto);
  const passos = t.passos(contexto);
  const pre = t.preheader(casa.name, n, seg);
  const cta = c.cta_url || REGISTER;

  const html = `<!DOCTYPE html>
<html lang="${idioma}"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><meta name="color-scheme" content="dark" /><title>${esc(assunto)}</title></head>
<body style="margin:0; padding:0; background-color:#0B0A08;">
  <div style="display:none; max-height:0; overflow:hidden; mso-hide:all;">${esc(pre)}</div>
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

        <!-- cartão-extrato: o número DELES -->
        <tr><td style="padding:28px 16px 0 16px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#1A1611; border:1px solid #CE9E3C; border-radius:12px; border-collapse:separate;">
            <tr><td align="center" style="padding:26px 20px 22px 20px;">
              <div style="font-family:Arial,Helvetica,sans-serif; font-size:11px; letter-spacing:3px; color:#8F8368;">${esc(casa.name).toUpperCase()}</div>
              <div style="font-family:Georgia,'Times New Roman',serif; font-size:56px; line-height:1.1; color:#E6C87A; padding:10px 0 6px 0;">${esc(hero.big)}</div>
              <div style="font-family:Arial,Helvetica,sans-serif; font-size:13px; color:#B5AB93;">${esc(hero.label)}</div>
            </td></tr>
          </table>
        </td></tr>

        <tr><td align="center" style="padding:26px 24px 8px 24px;">
          <h1 style="margin:0; font-family:Georgia,'Times New Roman',serif; font-weight:normal; font-size:24px; line-height:1.35; color:#F5EFE3;">${esc(titulo)}</h1>
        </td></tr>
        <tr><td style="padding:8px 28px 0 28px;">
          <p style="margin:0 0 14px 0; font-family:Arial,Helvetica,sans-serif; font-size:15px; line-height:1.65; color:#B5AB93;">${esc(t.saudacao(casa.name))}</p>
          ${paras.map((p) => `<p style="margin:0 0 14px 0; font-family:Arial,Helvetica,sans-serif; font-size:15px; line-height:1.65; color:#B5AB93;">${esc(p)}</p>`).join('\n          ')}
        </td></tr>

        <!-- botão único -->
        <tr><td align="center" style="padding:18px 20px 6px 20px;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" style="background-color:#CE9E3C;">
            <a href="${esc(cta)}" target="_blank" style="display:inline-block; padding:15px 38px; font-family:Arial,Helvetica,sans-serif; font-size:14px; font-weight:600; color:#12100C; text-decoration:none;">${esc(s.cta)}</a>
          </td></tr></table>
        </td></tr>

        <!-- três passos -->
        <tr><td style="padding:22px 28px 0 28px;">
          <div style="font-family:Arial,Helvetica,sans-serif; font-size:11px; letter-spacing:2px; color:#8F8368; padding-bottom:10px;">${esc(t.passos_titulo).toUpperCase()}</div>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
            ${passos.map((p, i) => `<tr><td valign="top" style="width:28px; padding:6px 0; font-family:Georgia,serif; font-size:18px; color:#E6C87A;">${i + 1}</td><td style="padding:6px 0; font-family:Arial,Helvetica,sans-serif; font-size:14px; line-height:1.55; color:#B5AB93;${i < passos.length - 1 ? ' border-bottom:1px solid #26200F;' : ''}">${esc(p)}</td></tr>`).join('\n            ')}
          </table>
          <p style="margin:14px 0 0 0; font-family:Arial,Helvetica,sans-serif; font-size:13px; line-height:1.6; color:#8F8368;">${esc(t.ajuda)}</p>
        </td></tr>

        <!-- fecho e assinatura de pessoa -->
        <tr><td style="padding:26px 28px 8px 28px;">
          <p style="margin:0 0 18px 0; font-family:Arial,Helvetica,sans-serif; font-size:14px; line-height:1.65; color:#B5AB93;">${esc(t.fecho)}</p>
          <p style="margin:0; font-family:Georgia,'Times New Roman',serif; font-size:16px; color:#F5EFE3;">${esc(t.assinatura[0])}</p>
          <p style="margin:2px 0 0 0; font-family:Arial,Helvetica,sans-serif; font-size:12px; color:#8F8368;">${esc(t.assinatura[1])}${t.assinatura[2] ? ` · <a href="mailto:${esc(t.assinatura[2])}" style="color:#E6C87A; text-decoration:none;">${esc(t.assinatura[2])}</a>` : ''}</p>
        </td></tr>

        <tr><td align="center" style="padding:24px 20px 28px 20px; border-top:1px solid #26200F;">
          <p style="margin:0 0 4px 0; font-family:Georgia,'Times New Roman',serif; font-size:13px; letter-spacing:3px; color:#8F8368;">THE WORLD KEYS</p>
          <p style="margin:0 0 10px 0; font-family:Arial,Helvetica,sans-serif; font-size:11px; line-height:1.8; color:#6E6551;">
            <a href="https://theworldkeys.com/terms-of-use/" style="color:#8F8368; text-decoration:none;">Terms &amp; Conditions</a> &nbsp;&#183;&nbsp; <a href="mailto:support@theworldkeys.com" style="color:#8F8368; text-decoration:none;">support@theworldkeys.com</a><br/>
            66, Av. des Champs-&#201;lys&#233;es, 75008 Paris, France<br/>
            VAT: FR24901268326 &#183; R.C.S Paris: 901 268 326 &#183; &#169; 2026 The World Keys
          </p>
          ${rodape(idioma, restaurant_id).replace('color:#8a8a8a', 'color:#6E6551').replace('font-size:12px', 'font-size:11px').replace(/<a /g, '<a style="color:#8F8368;" ')}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  const texto = [t.saudacao(casa.name), '', `${hero.big} — ${hero.label}`, titulo, '', ...paras, '', `${s.cta}: ${cta}`, '', t.passos_titulo + ':', ...passos.map((p, i) => `${i + 1}. ${p}`), t.ajuda, '', t.fecho, '', ...t.assinatura].join('\n');
  validar(texto);
  exigirOptout(html, `${casa.name} ${idioma}`);
  return { assunto, preheader: pre, html, texto, segmento: seg, idioma };
}

function validar(texto) {
  const hit = TOKENS_PROIBIDOS.find((re) => re.test(texto));
  if (hit) throw new Error(`Extrato contém token proibido para respondedores: ${hit}`);
}

module.exports = { gerarExtrato, mascararEmail, TOKENS_PROIBIDOS, SEGMENTOS, REGISTER, T };
