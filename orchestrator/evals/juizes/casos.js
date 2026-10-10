'use strict';
/** Eval dos juízes (catálogo, editorial, comercial) — zero LLM. */
const { julgar, detectarIdioma } = require('../../juizes/juiz');
const { julgarCatalogo, horariosGenericos } = require('../../juizes/catalogo');
const { julgarEditorial } = require('../../juizes/editorial');
const { julgarComercial } = require('../../juizes/comercial');
const EXP = (cond, msg) => (cond ? [] : [msg]);

const fichaBoa = () => ({ restaurant_id: '15207', nome: 'BAR CAÑETE', slug: 'bar-canete', published: true, ready_pending_photo: false, phone: '+34 933 10 47 68', email: 'info@barcanete.com', city: 'Barcelona', country: 'ES', lat: 41.38, lng: 2.17, opening_hours: [{ dia: 1, abre: '13:00', fecha: '00:00' }, { dia: 2, abre: '13:00', fecha: '00:00' }, { dia: 5, abre: '13:00', fecha: '01:00' }], opt_out_ativo: false, pedido_remocao_do_estabelecimento: false });
const generico = () => [0, 1, 2, 3, 4, 5, 6].map((dia) => ({ dia, abre: '09:00', fecha: '23:00' }));
const textoFr = 'Bonjour, nous vous écrivons au sujet de votre établissement. Nous souhaitons vous présenter notre plateforme et vous proposer un accès pour gérer vos demandes. Merci pour votre attention.';
const textoEn = 'Hello, we are writing about your restaurant. We would like to present our platform and offer you access to manage your requests. Thank you for your attention and have a great day.';
const corpoEn = '<p>' + 'A refined dining room with a seasonal menu and attentive service. The chef works with local producers and the wine list favours small growers. '.repeat(3) + '</p>';
const corpoFr = '<p>' + 'Une salle raffinée avec une carte de saison et un service attentif. Le chef travaille avec des producteurs locaux et la carte des vins privilégie les petits vignerons. '.repeat(3) + '</p>';
const pecaEd = (x = {}) => ({ locale: 'en', titulo: 'Bar Cañete, Barcelona — tapas by the Rambla', meta_description: 'Classic Barcelona tapas bar near the Rambla: seasonal plates, a long marble counter and a wine list built around small Catalan growers.', corpo: corpoEn, tem_review_real: false, ...x });
const msgOk = (x = {}) => ({ texto: textoFr + ' Le Petit Bistro.', canal: 'email', idioma_casa: 'fr', nome_casa: 'Le Petit Bistro', opt_out_consultado: true, opt_out_ativo: false, tem_rodape_optout: true, links: ['https://theworldkeys.com/hospitality/le-petit-bistro/'], envios_7d: 1, ...x });

const casos = [
  { nome: 'julgar: eliminatório reprovado → nota 0, mesmo com o resto ok', run: () => { const r = julgar([{ id: 'a', eliminatorio: true, avaliar: () => ({ ok: false, detalhe: 'x' }) }, { id: 'b', avaliar: () => ({ ok: true }) }], {}); return EXP(r.nota === 0 && !r.aprovado && r.eliminado === 'a', JSON.stringify(r)); } },
  { nome: 'julgar: critério que lança exceção reprova (checagem que não rodou é finding)', run: () => { const r = julgar([{ id: 'a', avaliar: () => { throw new Error('boom'); } }, { id: 'b', avaliar: () => ({ ok: true }) }], {}); return EXP(r.nota === 5 && /boom/.test(r.reprovados[0]), JSON.stringify(r)); } },
  { nome: 'julgar: aprovado exige nota ≥ 8', run: () => { const r = julgar([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => ({ id: String(i), avaliar: () => ({ ok: i <= 8 }) })), {}); return EXP(r.nota === 8 && r.aprovado, JSON.stringify(r)); } },
  { nome: 'detectarIdioma: fr / en / curto → desconhecido', run: () => [...EXP(detectarIdioma(textoFr) === 'fr', 'fr'), ...EXP(detectarIdioma(textoEn) === 'en', 'en'), ...EXP(detectarIdioma('ok') === 'desconhecido', 'curto')] },
  // Catálogo
  { nome: 'catálogo: ficha boa aprova', run: () => { const r = julgarCatalogo(fichaBoa()); return EXP(r.aprovado && r.nota === 10, JSON.stringify(r.reprovados)); } },
  { nome: 'catálogo: opt-out ativo + publicada → eliminada', run: () => EXP(julgarCatalogo(fichaBoa()).aprovado && julgarCatalogo({ ...fichaBoa(), opt_out_ativo: true }).eliminado === 'C1_optout', 'opt-out passou') },
  { nome: 'catálogo: pedido de remoção + publicada → eliminada', run: () => EXP(julgarCatalogo({ ...fichaBoa(), pedido_remocao_do_estabelecimento: true }).eliminado === 'C2_remocao', 'remoção passou') },
  { nome: 'catálogo: despublicada com ready_pending_photo → eliminada (republish_no_photo)', run: () => EXP(julgarCatalogo({ ...fichaBoa(), published: false, ready_pending_photo: true }).eliminado === 'C3_flag_foto', 'flag passou') },
  { nome: 'catálogo: horários genéricos (7 dias iguais) reprovam o critério', run: () => { const r = julgarCatalogo({ ...fichaBoa(), opening_hours: generico() }); return EXP(!r.criterios.find((c) => c.id === 'C8_horarios').ok && horariosGenericos(generico()).generico, 'genérico passou'); } },
  { nome: 'catálogo: telefone sem "+" reprova o critério', run: () => EXP(!julgarCatalogo({ ...fichaBoa(), phone: '933 10 47 68' }).criterios.find((c) => c.id === 'C6_telefone').ok, 'sem + passou') },
  { nome: 'catálogo: domínio morto reprova e-mail', run: () => EXP(!julgarCatalogo(fichaBoa(), { dominios_mortos: ['barcanete.com'] }).criterios.find((c) => c.id === 'C7_email').ok, 'domínio morto passou') },
  { nome: 'catálogo: três critérios reprovados → nota 7, não aprova (teto do PROP-101 é 8)', run: () => { const r = julgarCatalogo({ ...fichaBoa(), phone: 'x', email: 'x', lat: 0, lng: 0 }); return EXP(r.nota === 7 && !r.aprovado, JSON.stringify(r)); } },
  // Editorial
  { nome: 'editorial: peça boa aprova', run: () => { const r = julgarEditorial(pecaEd()); return EXP(r.aprovado && r.nota === 10, JSON.stringify(r.reprovados)); } },
  { nome: 'editorial: aggregateRating sem review real → eliminada (matriz 01)', run: () => EXP(julgarEditorial(pecaEd({ structured_data: { '@type': 'Restaurant', aggregateRating: { ratingValue: 4.8 } } })).eliminado === 'E1_rating', 'rating passou') },
  { nome: 'editorial: aggregateRating com review real passa', run: () => EXP(julgarEditorial(pecaEd({ tem_review_real: true, structured_data: { aggregateRating: { ratingValue: 4.8 } } })).aprovado, 'rating com review reprovou') },
  { nome: 'editorial: locale fr com corpo em inglês → eliminada (9.276 URLs)', run: () => EXP(julgarEditorial(pecaEd({ locale: 'fr' })).eliminado === 'E2_idioma', 'idioma passou') },
  { nome: 'editorial: locale fr com corpo em francês aprova o idioma', run: () => EXP(julgarEditorial(pecaEd({ locale: 'fr', corpo: corpoFr })).criterios.find((c) => c.id === 'E2_idioma').ok, 'fr reprovou') },
  { nome: 'editorial: "instant confirmation" → eliminada (matriz 02)', run: () => EXP(julgarEditorial(pecaEd({ corpo: corpoEn + '<p>Instant confirmation for every table you book with us tonight.</p>' })).eliminado === 'E4_promessa', 'promessa passou') },
  { nome: 'editorial: vocabulário interno (SLA) → eliminada', run: () => EXP(julgarEditorial(pecaEd({ corpo: corpoEn + '<p>Our SLA guarantees the team replies.</p>' })).eliminado === 'E3_vocab', 'vocab passou') },
  { nome: 'editorial: título curto e meta curta reprovam critérios', run: () => { const r = julgarEditorial(pecaEd({ titulo: 'Bar', meta_description: 'Tapas.' })); return EXP(r.nota === 8 && !r.criterios.find((c) => c.id === 'E6_titulo').ok && !r.criterios.find((c) => c.id === 'E7_meta').ok, JSON.stringify(r.reprovados)); } },
  { nome: 'editorial: HTML desbalanceado reprova critério', run: () => EXP(!julgarEditorial(pecaEd({ corpo: corpoEn + '<p>aberto' })).criterios.find((c) => c.id === 'E9_html').ok, 'html passou') },
  // Comercial
  { nome: 'comercial: mensagem boa aprova', run: () => { const r = julgarComercial(msgOk()); return EXP(r.aprovado && r.nota === 10, JSON.stringify(r.reprovados)); } },
  { nome: 'comercial: opt-out não consultado → eliminada (registro ilegível = nenhum contato)', run: () => EXP(julgarComercial(msgOk({ opt_out_consultado: undefined })).eliminado === 'M1_optout', 'passou sem consultar') },
  { nome: 'comercial: opt-out ativo → eliminada', run: () => EXP(julgarComercial(msgOk({ opt_out_ativo: true })).eliminado === 'M1_optout', 'opt-out ativo passou') },
  { nome: 'comercial: texto em inglês para casa francesa → eliminada', run: () => EXP(julgarComercial(msgOk({ texto: textoEn + ' Le Petit Bistro.' })).eliminado === 'M2_idioma', 'idioma passou') },
  { nome: 'comercial: "The World\'s Kitchen" → eliminada', run: () => EXP(julgarComercial(msgOk({ texto: textoFr + " Le Petit Bistro. The World's Kitchen." })).eliminado === 'M4_marca', 'marca passou') },
  { nome: 'comercial: promessa "dans 24 heures" → eliminada', run: () => EXP(julgarComercial(msgOk({ texto: textoFr + ' Le Petit Bistro. Nous répondons dans 24 heures.' })).eliminado === 'M3_prazo', 'prazo passou') },
  { nome: 'comercial: e-mail sem rodapé de opt-out reprova critério', run: () => EXP(!julgarComercial(msgOk({ tem_rodape_optout: false })).criterios.find((c) => c.id === 'M6_canal').ok, 'rodapé passou') },
  { nome: 'comercial: WhatsApp exige template aprovado e opt-in', run: () => [...EXP(!julgarComercial(msgOk({ canal: 'whatsapp', template_aprovado: true })).criterios.find((c) => c.id === 'M6_canal').ok, 'sem opt-in passou'), ...EXP(julgarComercial(msgOk({ canal: 'whatsapp', template_aprovado: true, opt_in_registrado: true })).criterios.find((c) => c.id === 'M6_canal').ok, 'com ambos reprovou')] },
  { nome: 'comercial: link fora de theworldkeys.com reprova', run: () => EXP(!julgarComercial(msgOk({ links: ['https://bit.ly/x'] })).criterios.find((c) => c.id === 'M7_links').ok, 'link externo passou') },
  { nome: 'comercial: 3 envios em 7 dias reprova', run: () => EXP(!julgarComercial(msgOk({ envios_7d: 3 })).criterios.find((c) => c.id === 'M8_frequencia').ok, 'frequência passou') },
];
module.exports = { casos };
