#!/usr/bin/env node
'use strict';
/**
 * Campanha de fundadores — e-mail para AI MERCANTI (Veneza, restaurant_id 18546), SÓ PREVIEW.
 * Não há caminho de envio neste script: o envio exige autorização do fundador e passa pelo fluxo normal.
 *
 *   node fundadores-ai-mercanti-2026-09-14.js            → italiano (padrão: a casa fica em Veneza)
 *   node fundadores-ai-mercanti-2026-09-14.js --idioma fr → francês (pedido do fundador, 14/09)
 *
 * Por que uma variante: os segmentos do Extrato (A/B/C) pressupõem uma casa que RESPONDE (aceites,
 * recusas). O Ai Mercanti nunca respondeu pela plataforma — o único "aceito" no banco (4XKE87EE) é o
 * clique acidental de 14/09, retirado por carta. Usar esse número seria mentir. O argumento honesto
 * é a DEMANDA: 4 clientes escolheram a casa desde dez/2024.
 *
 * Mantido do Extrato aprovado (PLANO-FUNDADORES-50, 9% de conversão): mesmo renderizador e visual,
 * número da casa em destaque, reconhecimento e nunca cobrança (tokens de pendência proibidos, validados),
 * um botão, três passos com o e-mail mascarado, assinatura de pessoa, opt-out obrigatório (guardrail 8).
 * NÃO entram, por não existirem hoje ou dependerem de decisão do fundador: selo Founding Partner,
 * prioridade na listagem, comissão zero. Escassez de teatro também não ("founder" é token proibido).
 * Pedido do fundador (14/09): nenhum reservation@ visível; o único contato exposto é o support@ do rodapé.
 */
const fs = require('node:fs');
const path = require('node:path');
const X = require('./extratos.js');

const a = process.argv.slice(2);
const idioma = (() => { const i = a.indexOf('--idioma'); return i >= 0 ? a[i + 1] : 'it'; })();

const RAIZ = path.resolve(__dirname, '..', '..', '..');
const PREV = path.join(RAIZ, 'orchestrator', 'state', 'chave-girada', 'previews-fundadores');
fs.mkdirSync(PREV, { recursive: true });

const restaurant_id = '18546';
// Fonte: reservations, restaurant_id 18546, consulta de 2026-09-14. Acidental 4XKE87EE excluído.
const PEDIDOS = 4;

const TEXTOS = {
  it: {
    casa: { name: 'AI MERCANTI', city: 'Venezia' },
    desde: 'dicembre 2024',
    E: {
      assunto: (c, k) => `${c}: ${k.pedidos} ospiti vi hanno scelto su The World Keys. Ecco la vostra chiave.`,
      hero: (k) => ({ big: `${k.pedidos}`, label: `ospiti hanno chiesto un tavolo da voi, da ${k.desde}` }),
      titulo: () => `Gli ospiti vi cercano già. L'account del locale li riunisce in un unico posto.`,
      corpo: (c, k) => [
        `Da ${k.desde}, ${k.pedidos} ospiti hanno scelto ${c} su The World Keys e vi hanno chiesto un tavolo. È una domanda che arriva da sola: la vostra pagina è già pubblicata, e i clienti la trovano.`,
        `Oggi queste richieste vi arrivano per e-mail, una alla volta, ed è facile che si confondano tra le altre. L'account professionale del locale esiste proprio per questo: tutte le richieste in un unico pannello, risposta con un tocco dal telefono, e gli orari e la politica di prenotazione della vostra pagina nelle vostre mani.`,
      ],
      cta: "Attivare l'account del locale",
    },
    preheader: (c, k) => `${c}: ${k.pedidos} ospiti vi hanno chiesto un tavolo su The World Keys — e la vostra chiave è pronta.`,
    fecho: `È un piacere portare i nostri ospiti da voi, a Venezia.`,
    assinatura: ['Márlon Andrade', 'Responsabile commerciale · The World Keys'],
  },
  fr: {
    casa: { name: 'AI MERCANTI', city: 'Venise' },
    desde: 'décembre 2024',
    E: {
      assunto: (c, k) => `${c} : ${k.pedidos} clients vous ont choisis sur The World Keys. Voici votre clé.`,
      hero: (k) => ({ big: `${k.pedidos}`, label: `clients vous ont demandé une table, depuis ${k.desde}` }),
      titulo: () => `Les clients vous cherchent déjà. Le compte de la maison les réunit en un seul endroit.`,
      corpo: (c, k) => [
        `Depuis ${k.desde}, ${k.pedidos} clients ont choisi ${c} sur The World Keys et vous ont demandé une table. C'est une demande qui arrive d'elle-même : votre page est déjà en ligne, et les clients la trouvent.`,
        `Aujourd'hui, ces demandes vous parviennent par e-mail, une par une, et elles se perdent facilement parmi les autres. Le compte professionnel de la maison existe précisément pour cela : toutes les demandes dans un seul tableau de bord, une réponse en un geste depuis le téléphone, et les horaires et la politique de réservation de votre page entre vos mains.`,
      ],
      cta: 'Activer le compte de la maison',
    },
    preheader: (c, k) => `${c} : ${k.pedidos} clients vous ont demandé une table sur The World Keys — et votre clé est prête.`,
    fecho: `C'est un plaisir de vous amener nos clients, à Venise.`,
    assinatura: ['Márlon Andrade', 'Responsable commercial · The World Keys'],
    // Elisão: "l'équipe d'AI MERCANTI", nunca "de AI". O padrão compartilhado não elide.
    saudacao: (c) => (/^[aeiouhàâéèêëîïôûœ]/i.test(c) ? `Bonjour, l'équipe d'${c}.` : `Bonjour, l'équipe de ${c}.`),
  },
  // Português do Brasil, coerente do assunto ao rodapé (o rodapé de opt-out 'pt' já é pt-BR).
  // O padrão 'pt' do gerador é pt-PT (Lagos): passos, título e ajuda são sobrescritos aqui.
  pt: {
    casa: { name: 'AI MERCANTI', city: 'Veneza' },
    desde: 'dezembro de 2024',
    E: {
      assunto: (c, k) => `${c}: ${k.pedidos} clientes escolheram vocês na The World Keys. Aqui está a sua chave.`,
      hero: (k) => ({ big: `${k.pedidos}`, label: `clientes pediram mesa a vocês, desde ${k.desde}` }),
      titulo: () => `Os clientes já procuram vocês. A conta da casa reúne todos num só lugar.`,
      corpo: (c, k) => [
        `Desde ${k.desde}, ${k.pedidos} clientes escolheram o ${c} na The World Keys e pediram mesa a vocês. É uma procura que chega sozinha: a página de vocês já está publicada, e os clientes a encontram.`,
        `Hoje esses pedidos chegam por e-mail, um de cada vez, e se perdem facilmente entre os outros. A conta profissional da casa existe exatamente para isso: todos os pedidos num único painel, resposta com um toque pelo celular, e os horários e a política de reserva da página nas mãos de vocês.`,
      ],
      cta: 'Ativar a conta da casa',
    },
    preheader: (c, k) => `${c}: ${k.pedidos} clientes pediram mesa a vocês na The World Keys — e a sua chave está pronta.`,
    fecho: `É um prazer levar nossos clientes até vocês, em Veneza.`,
    assinatura: ['Márlon Andrade', 'Gerente Comercial · The World Keys'],
    saudacao: (c) => `Olá, equipe do ${c}.`,
    passos_titulo: 'Como funciona',
    passos: (ctx) => [
      `Abram o link e escolham "Meu restaurante já está no site".`,
      `Um código de 6 dígitos chega em ${ctx.email_mascarado || 'o e-mail de reservas da casa'}.`,
      `Digitem o código, criem a senha — e a página é de vocês. Dois minutos, gratuito, sem cartão.`,
    ],
    ajuda: `Se preferirem, respondam a este e-mail e ativamos junto com vocês.`,
  },
};

const L = TEXTOS[idioma];
if (!L || !X.T[idioma]) { console.error(`idioma não suportado: ${idioma} (use it, fr ou pt)`); process.exit(2); }

// Sobrescritas só neste processo; o módulo em disco não muda.
const T = X.T[idioma];
const orig = { fecho: T.fecho, preheader: T.preheader, assinatura: T.assinatura, saudacao: T.saudacao, passos: T.passos, passos_titulo: T.passos_titulo, ajuda: T.ajuda };
T.E = L.E;
T.fecho = L.fecho;
T.preheader = L.preheader;
T.assinatura = L.assinatura;
if (L.saudacao) T.saudacao = L.saudacao;
if (L.passos) T.passos = L.passos;
if (L.passos_titulo) T.passos_titulo = L.passos_titulo;
if (L.ajuda) T.ajuda = L.ajuda;

try {
  const r = X.gerarExtrato({
    segmento: 'E',
    idioma,
    casa: L.casa,
    n: { pedidos: PEDIDOS, desde: L.desde },
    restaurant_id,
    ctx: {
      email: 'info_aimercanti@libero.it',
      // Link rastreado pelo /go (rid com prefixo r: imune ao defeito quoted-printable).
      cta_url: `https://theworldkeys-n8n.xis4ee.easypanel.host/webhook/go?c=fundadores-extrato&rid=r${restaurant_id}`,
    },
  });
  const arq = path.join(PREV, `E-${restaurant_id}-${idioma}.html`);
  fs.writeFileSync(arq, r.html);
  console.log(`idioma    : ${idioma}`);
  console.log(`assunto   : ${r.assunto}`);
  console.log(`preheader : ${r.preheader}`);
  console.log(`preview   : ${arq}`);
  console.log('\nSÓ PREVIEW — este script não envia nada.');
} finally {
  T.fecho = orig.fecho;
  T.preheader = orig.preheader;
  T.assinatura = orig.assinatura;
  T.saudacao = orig.saudacao;
  T.passos = orig.passos;
  T.passos_titulo = orig.passos_titulo;
  T.ajuda = orig.ajuda;
  delete T.E;
}
