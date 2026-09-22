#!/usr/bin/env node
'use strict';
/**
 * Lote 2 de templates no padrão TWK (auditoria de 10/09):
 *   8sKe89Lz5Vzpy3a5 "4 - resposta ao reagendamento": Confirmado/Recusado × Cliente/Estabelecimento (4 nós)
 *   1pc2qJX4kYkBni3s "envia email resetar senha" (cliente): Send a message
 *   6ONkRN-zDsy0qpvXBn6NH "candidatura recebida": Send a message
 *   TkC4zLu3uA6B01Ii "candidatura aprovada": Send a message
 * Saída: orchestrator/agents/chave-girada/n8n/lote2/<arquivo>.html (campo message completo, com "=") + preview.
 * Os "antes" vêm do scratchpad (old-*.html), lidos pela API na auditoria.
 */
const fs = require('node:fs');
const path = require('node:path');
const B = require('./_blocos-twk.js');

const SAIDA = path.join(__dirname, 'lote2');
fs.mkdirSync(SAIDA, { recursive: true });
const SP = process.env.TWK_SCRATCH || 'C:/Users/bianc/AppData/Local/Temp/claude/C--Users-bianc-OneDrive--rea-de-Trabalho-Agentes-IA/b2c588fb-a525-439a-ab06-7c5b82f07e6e/scratchpad';
const E = (x) => `{{ ${x} }}`;
const W = "$('Webhook').item.json.body";
const C = "$('Code in JavaScript').item.json";
const NOME_OURO = (expr) => `<span style="color:#E6C87A;">${expr}</span>`;

// ---------- Fluxo 4 · resposta ao reagendamento ----------
const detalhesReag = (comProposto) =>
  B.linha('DATE', E(C + '.formattedDate')) +
  (comProposto ? B.linha('NEW TIME', E(C + '.formattedProposedTime')) : B.linha('TIME', E(C + '.formattedTime'))) +
  B.linha('GUESTS', E(C + '.formattedPeople')) +
  B.linha('NOTES', E(C + '.formattedDetails'), true);

const confirmadoCliente = '=' + B.cabeca('Your new time is confirmed.', 'Your table at ' + E(W + '.restaurant.name') + ' is booked at the new time.') +
  B.paragrafo(`Dear ${E(W + '.user.name')}, you accepted the new time proposed by ${NOME_OURO(E(W + '.restaurant.name'))}. Your table is booked — the restaurant has been informed and is expecting you.`) +
  B.cartaoNumero('YOUR TABLE', E(C + '.formattedProposedTime'), E(C + '.formattedDate')) +
  B.cartaoDetalhes(detalhesReag(true), E(W + '.reservation.reservation_code')) +
  B.botao('https://theworldkeys.com/users/reservations', 'My reservations') +
  B.paragrafo('If your plans change, you can update or cancel from your reservations page — the restaurant is notified automatically.', '#8F8368', 13) +
  B.rodape('Message our concierge on WhatsApp');

const confirmadoEstab = '=' + B.cabeca('The guest accepted your new time.', E(W + '.user.name') + ' confirmed the new time. The reservation is set.') +
  B.paragrafo(`Dear ${E(W + '.restaurant.name')}, ${NOME_OURO(E(W + '.user.name'))} accepted the time you proposed. The reservation is confirmed at the new time — nothing else is needed from you.`) +
  B.cartaoNumero('CONFIRMED FOR', E(C + '.formattedProposedTime'), E(C + '.formattedDate')) +
  B.cartaoDetalhes(B.linha('GUEST', E(W + '.user.name')) + detalhesReag(true), E(W + '.reservation.reservation_code')) +
  B.paragrafo('For security and data protection, guest contact details are available only through the response page.', '#8F8368', 12) +
  B.cartaoConta(E(W + '.restaurant.name'), E(W + '.restaurant.restaurant_id'), 'reag-aceite') +
  B.rodape('Message our team on WhatsApp');

const recusadoCliente = '=' + B.cabeca("The new time didn't work — let's find you a table.", 'You declined the new time at ' + E(W + '.restaurant.name') + '. Here is what happens next.') +
  B.paragrafo(`Dear ${E(W + '.user.name')}, you declined the time proposed by ${NOME_OURO(E(W + '.restaurant.name'))}, so this request is now released. No table is held — and we would like to help you find one.`) +
  B.cartaoDetalhes(B.linha('RESTAURANT', E(W + '.restaurant.name')) + B.linha('REQUESTED', E(C + '.formattedDate') + ' &middot; ' + E(C + '.formattedTime')) + B.linha('PROPOSED', E(C + '.formattedProposedTime')) + B.linha('GUESTS', E(C + '.formattedPeople'), true), E(W + '.reservation.reservation_code')) +
  B.botao('https://theworldkeys.com/hospitality/', 'Find another table') +
  B.paragrafo('Prefer a hand? Our concierge knows the city — tell us the occasion and we will suggest two or three places with a fast confirmation.', '#8F8368', 13) +
  B.rodape('Message our concierge on WhatsApp');

const recusadoEstab = '=' + B.cabeca('The guest declined the new time.', E(W + '.user.name') + ' could not make the proposed time. The request is closed.') +
  B.paragrafo(`Dear ${E(W + '.restaurant.name')}, ${NOME_OURO(E(W + '.user.name'))} could not make the time you proposed. The request is closed on our side — the table is free and there is nothing else to do.`) +
  B.cartaoDetalhes(B.linha('GUEST', E(W + '.user.name')) + B.linha('REQUESTED', E(C + '.formattedDate') + ' &middot; ' + E(C + '.formattedTime')) + B.linha('YOU PROPOSED', E(C + '.formattedProposedTime')) + B.linha('GUESTS', E(C + '.formattedPeople'), true), E(W + '.reservation.reservation_code')) +
  B.paragrafo('Thank you for replying — guests choose restaurants that answer. We will keep sending them your way.', '#8F8368', 13) +
  B.cartaoConta(E(W + '.restaurant.name'), E(W + '.restaurant.restaurant_id'), 'reag-recusa') +
  B.rodape('Message our team on WhatsApp');

// ---------- Reset de senha (cliente) — mantém a compensação QP na URL ----------
const RESET = "{{ $json.body.resetUrl.replace(/=([0-9A-Fa-f]{2})/g, '=3D$1') }}";
const resetCliente = '=' + B.cabeca('Reset your password.', 'Use the link below to choose a new password for your The World Keys account.') +
  B.paragrafo(`Dear ${E('$json.body.name')}, we received a request to reset the password of your The World Keys account. Choose a new one with the button below.`) +
  B.botao(RESET, 'Choose a new password') +
  B.linkTexto(RESET, 'If the button does not work, copy this address into your browser:') +
  B.paragrafo('This link is valid for <span style="color:#F5EFE3;">1 hour</span>. If you did not ask for a new password, you can safely ignore this e-mail — your current password stays unchanged.', '#8F8368', 13) +
  B.rodape('Message our concierge on WhatsApp');

// ---------- Candidatura a parceiro: recebida ----------
const NOME_CASA = E("$json.body.restaurantName || $json.body.publicListingSlug");
const recebida = '=' + B.cabeca('We received your application.', 'Your request to manage ' + NOME_CASA + ' on The World Keys is with our team.') +
  B.paragrafo(`Dear ${E("$json.body.fullName.split(' ')[0]")}, thank you — your request to manage ${NOME_OURO(NOME_CASA)} on The World Keys has been received.`) +
  B.cartaoDetalhes(B.linha('RESTAURANT', NOME_CASA) + B.linha('NAME', E('$json.body.fullName')) + B.linha('ROLE', E('$json.body.jobTitle')) + B.linha('E-MAIL', E('$json.body.email'), true)) +
  B.passos('WHAT HAPPENS NEXT', [
    'Our team reviews the request — usually within one business day.',
    'You receive an e-mail titled <span style="color:#F5EFE3;">"Create your restaurant account"</span> with your personal link.',
    'Set your password and the page is yours: every request in one place, answered in one tap.',
  ]) +
  B.paragrafo('Until then, nothing changes: you can keep answering table requests through the link in each e-mail.', '#8F8368', 13) +
  B.rodape('Message our team on WhatsApp', 'If you did not make this request, reply to this e-mail and we will close it.');

// ---------- Candidatura a parceiro: aprovada ----------
const aprovada = '=' + B.cabeca('Approved — your access link is on its way.', 'Your application for ' + E('$json.body.restaurantName') + ' was approved. Look for the e-mail with your link.') +
  B.paragrafo(`Dear ${E("$json.body.fullName.split(' ')[0]")}, good news: your request to manage ${NOME_OURO(E('$json.body.restaurantName'))} on The World Keys has been approved.`) +
  B.cartaoNumero('ONE LAST STEP', 'Set your password', 'the link arrives in a separate e-mail') +
  B.passos('HOW TO FINISH', [
    'Open the e-mail titled <span style="color:#F5EFE3;">"Create your restaurant account"</span> — it is sent to <span style="color:#F5EFE3;">' + E('$json.body.email') + '</span> right after this one.',
    'Click the link and choose your password. The link is valid for 48 hours.',
    'That is it: your requests, your hours and your page are in your hands.',
  ]) +
  B.paragrafo('Did the link not arrive within 10 minutes? Check the spam folder, then reply to this e-mail — we will send a fresh one the same day.', '#8F8368', 13) +
  B.rodape('Message our team on WhatsApp');

// ---------- gravação ----------
const ARQ = {
  'reag-confirmado-cliente.html': confirmadoCliente,
  'reag-confirmado-estabelecimento.html': confirmadoEstab,
  'reag-recusado-cliente.html': recusadoCliente,
  'reag-recusado-estabelecimento.html': recusadoEstab,
  'reset-senha-cliente.html': resetCliente,
  'candidatura-recebida.html': recebida,
  'candidatura-aprovada.html': aprovada,
};
for (const [f, h] of Object.entries(ARQ)) { if (!h.startsWith('=')) throw new Error(f + ' sem "="'); fs.writeFileSync(path.join(SAIDA, f), h); }

// ---------- preview com dados de exemplo ----------
const AM = [
  [/\{\{\s*\$\('Webhook'\)\.item\.json\.body\.user\.name\s*\}\}/g, 'Lara Yu'],
  [/\{\{\s*\$\('Webhook'\)\.item\.json\.body\.restaurant\.name\s*\}\}/g, 'PESKA BY LA TERRASSE'],
  [/\{\{\s*\$\('Webhook'\)\.item\.json\.body\.restaurant\.restaurant_id\s*\}\}/g, '14730'],
  [/\{\{\s*\$\('Webhook'\)\.item\.json\.body\.reservation\.reservation_code\s*\}\}/g, '5QTQ8DYC'],
  [/\{\{\s*\$\('Code in JavaScript'\)\.item\.json\.formattedDate\s*\}\}/g, 'Mon, 21 Sept 2026'],
  [/\{\{\s*\$\('Code in JavaScript'\)\.item\.json\.formattedTime\s*\}\}/g, '6:00 PM'],
  [/\{\{\s*\$\('Code in JavaScript'\)\.item\.json\.formattedProposedTime\s*\}\}/g, '6:30 PM'],
  [/\{\{\s*\$\('Code in JavaScript'\)\.item\.json\.formattedPeople\s*\}\}/g, '1 guest'],
  [/\{\{\s*\$\('Code in JavaScript'\)\.item\.json\.formattedDetails\s*\}\}/g, 'Table at the terrace, front row'],
  [/\{\{\s*\$json\.formattedDate\s*\}\}/g, 'Mon, 21 Sept 2026'],
  [/\{\{\s*\$json\.formattedProposedTime\s*\}\}/g, '6:30 PM'],
  [/\{\{\s*\$json\.formattedPeople\s*\}\}/g, '1 guest'],
  [/\{\{\s*\$json\.formattedDetails\s*\}\}/g, 'Table at the terrace, front row'],
  [/\{\{\s*\$json\.body\.name\s*\}\}/g, 'Lara Yu'],
  [/\{\{\s*\$json\.body\.resetUrl[^}]*\}\}/g, 'https://theworldkeys.com/reset-password?token=example'],
  [/\{\{\s*\$json\.body\.fullName\.split\(' '\)\[0\]\s*\}\}/g, 'Lucas'],
  [/\{\{\s*\$json\.body\.fullName\s*\}\}/g, 'Lucas Peixoto da Cruz'],
  [/\{\{\s*\$json\.body\.restaurantName \|\| \$json\.body\.publicListingSlug\s*\}\}/g, 'BOTECO BELMONTE'],
  [/\{\{\s*\$json\.body\.restaurantName\s*\}\}/g, 'BOTECO BELMONTE'],
  [/\{\{\s*\$json\.body\.jobTitle\s*\}\}/g, 'MANAGER'],
  [/\{\{\s*\$json\.body\.email\s*\}\}/g, 'l***@example.com'],
  [/\{\{[^}]*\}\}/g, ''],
];
const ex = (h) => AM.reduce((a, [re, v]) => a.replace(re, v), h.replace(/^=/, ''));
const antes = (f) => { try { return fs.readFileSync(path.join(SP, f), 'utf8'); } catch { return '<p style="color:#fff">(sem cópia do template anterior)</p>'; } };
const pares = [
  { rotulo: 'Reagendamento aceito — cliente', antes: ex(antes('old-8sKe89Lz5Vzpy3a5-Confirmado_Cliente.html')), depois: ex(confirmadoCliente) },
  { rotulo: 'Reagendamento aceito — restaurante', antes: ex(antes('old-8sKe89Lz5Vzpy3a5-Confirmado_Estabelecimento.html')), depois: ex(confirmadoEstab) },
  { rotulo: 'Reagendamento recusado — cliente', antes: ex(antes('old-8sKe89Lz5Vzpy3a5-Recusado_Cliente.html')), depois: ex(recusadoCliente) },
  { rotulo: 'Reagendamento recusado — restaurante', antes: ex(antes('old-8sKe89Lz5Vzpy3a5-Recusado_Estabelecimento.html')), depois: ex(recusadoEstab) },
  { rotulo: 'Reset de senha — cliente', antes: ex(antes('old-1pc2qJX4kYkBni3s-Send_a_message.html')), depois: ex(resetCliente) },
  { rotulo: 'Candidatura recebida', antes: '<p style="color:#fff;font-family:Arial;padding:20px">(aviso em texto simples, sem template)</p>', depois: ex(recebida) },
  { rotulo: 'Candidatura aprovada', antes: '<p style="color:#fff;font-family:Arial;padding:20px">(aviso em texto simples: "nossa equipe entrará em contato")</p>', depois: ex(aprovada) },
];
for (const p of pares) fs.writeFileSync(path.join(SAIDA, '_p-' + p.rotulo.replace(/[^\w]+/g, '-').toLowerCase() + '.html'), p.depois);
fs.writeFileSync(path.join(SAIDA, '_preview-aprovacao.html'), B.paginaAprovacao('Lote 2 — sete e-mails no padrão TWK', '10/09/2026 · dados de exemplo', 'Fecha o ciclo do reagendamento (4), o reset de senha do cliente (1) e o funil de candidatura (2). Restaurantes ganham o cartão da conta rastreado (reag-aceite / reag-recusa). O "aprovada" passa a dizer a verdade: o link chega num e-mail à parte.', pares));
console.log('lote 2 gerado em', SAIDA, '·', Object.keys(ARQ).length, 'templates ·', pares.length, 'pares no preview');
