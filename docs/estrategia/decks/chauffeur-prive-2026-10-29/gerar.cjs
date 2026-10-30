#!/usr/bin/env node
'use strict';
/**
 * Gera o deck "Chauffeur privé · formulário" (10 slides, 1920×1080) a partir dos prints em img/ e dos mocks
 * escritos aqui, e converte com docs/site/deck-html.js numa página única (imagens embutidas em base64).
 *
 *   node docs/estrategia/decks/chauffeur-prive-2026-10-29/gerar.cjs
 *
 * Saída: pt/project/{deck.json,slides/*.html} (fonte do deck) e docs/estrategia/deck-chauffeur-prive-2026-10-29.html
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const RAIZ = path.resolve(__dirname, '..', '..', '..', '..');
const AQUI = __dirname;
const PROJ = path.join(AQUI, 'pt', 'fontes');
const SAIDA = path.join(RAIZ, 'docs', 'estrategia', 'deck-chauffeur-prive-2026-10-29.html');
const SAIDA_FR = SAIDA.replace(/\.html$/, '.fr.html');

// Nas fontes (pt/fontes, fr/fontes) a imagem fica como caminho curto "img/<nome>", legível e traduzível;
// embutir() troca por data URI ao gerar <lang>/project, que é o que deck-html.js lê.
const img = (nome) => `img/${nome}`;
const dataUri = (nome) => {
  const arq = path.join(AQUI, 'img', nome);
  const b64 = fs.readFileSync(arq).toString('base64');
  const tipo = nome.endsWith('.png') ? 'image/png' : 'image/jpeg';
  return `data:${tipo};base64,${b64}`;
};
const embutir = (lang) => {
  const fontes = path.join(AQUI, lang, 'fontes');
  const proj = path.join(AQUI, lang, 'project');
  if (!fs.existsSync(path.join(fontes, 'deck.json'))) return false;
  fs.mkdirSync(path.join(proj, 'slides'), { recursive: true });
  fs.copyFileSync(path.join(fontes, 'deck.json'), path.join(proj, 'deck.json'));
  for (const f of fs.readdirSync(path.join(fontes, 'slides'))) {
    const html = fs.readFileSync(path.join(fontes, 'slides', f), 'utf8')
      .replace(/(src="|url\(')img\/([^"')]+)/g, (m, pre, nome) => pre + dataUri(nome));
    fs.writeFileSync(path.join(proj, 'slides', f), html);
  }
  return true;
};

// ---------- tokens ----------
const C = {
  ink: '#070b10', charcoal: '#0f1218', warm: '#181c24', border: '#2a2f40',
  gold: '#c9a96e', goldL: '#e4c990', goldD: '#7a5c2c',
  cream: '#ede9df', creamD: '#b8b3a6', white: '#f7f4ef', silver: '#9a97a8',
  slideBg: '#f7f4ef', text: '#1f232c', muted: '#6b6f7a', rule: '#d9d2c3',
  hoje: '#c8695c', ok: '#3f7d5a', wa: '#25d366',
};
const SERIF = "'Cormorant Garamond', Georgia, serif";
const SANS = "'Jost', Arial, sans-serif";
const TOTAL = 10;
const RODAPE = 'The World Keys · Chauffeur privé · auditoria de 28 de outubro de 2026';

// ---------- peças ----------
const cab = (eyebrow, titulo, sub) => `
<div style="display:flex;flex-direction:column;gap:10px">
<p style="font-size:22px;letter-spacing:6px;text-transform:uppercase;color:${C.goldD};font-weight:500">${eyebrow}</p>
<h2 style="font-family:${SERIF};font-size:60px;font-weight:500;line-height:1.08;color:${C.text}">${titulo}</h2>
${sub ? `<p style="font-size:26px;line-height:1.4;color:${C.muted};width:1600px">${sub}</p>` : ''}
</div>`;

const rodape = (n) => `
<div style="position:absolute;left:96px;right:96px;bottom:48px;display:flex;justify-content:space-between"><p style="font-size:22px;color:${C.muted}">${RODAPE}</p><p style="font-size:22px;color:${C.muted}">${n} / ${TOTAL}</p></div>`;

const tag = (texto, cor) => `<p style="display:inline-block;font-size:18px;letter-spacing:4px;text-transform:uppercase;color:${cor};font-weight:500;border:2px solid ${cor};padding:6px 14px;align-self:flex-start">${texto}</p>`;

// coluna "hoje" com print e callouts (coordenadas no espaço da imagem já escalada)
const print = (src, w, h, callouts = []) => `
<div style="display:block;position:relative;width:${w}px;height:${h}px;border:1px solid ${C.rule};box-shadow:0 10px 30px rgba(0,0,0,.18);background:#000">
<img src="${src}" style="display:block;width:${w}px;height:${h}px">
${callouts.map((c) => `<div style="display:block;position:absolute;left:${c.x}px;top:${c.y}px;width:${c.w}px;height:${c.h}px;border:4px solid ${C.hoje};box-shadow:0 0 0 3px rgba(200,105,92,.25)"></div>
<p style="position:absolute;left:${c.lx != null ? c.lx : c.x}px;top:${c.ly != null ? c.ly : c.y + c.h + 10}px;font-size:20px;line-height:1.25;color:#fff;background:${C.hoje};padding:6px 12px;max-width:${c.lw || 360}px;font-weight:500">${c.t}</p>`).join('')}
</div>`;

const coluna = (rotulo, cor, corpo, largura) => `
<div style="display:flex;flex-direction:column;gap:18px;width:${largura}px">
${tag(rotulo, cor)}
${corpo}
</div>`;

// mock no visual do site (cartão escuro)
const cartao = (conteudo, w = 760, extra = '') => `
<div style="display:flex;flex-direction:column;gap:18px;width:${w}px;background:${C.charcoal};border:1px solid ${C.border};border-radius:14px;padding:30px 32px;${extra}">${conteudo}</div>`;

const rot = (t) => `<p style="font-size:14px;letter-spacing:3px;text-transform:uppercase;color:${C.gold};font-weight:500">${t}</p>`;
const campo = (label, valor, opts = {}) => `
<div style="display:flex;flex-direction:column;gap:8px;${opts.w ? `width:${opts.w}px;` : 'flex:1;'}">
${rot(label + (opts.opcional ? ` <span style="color:${C.silver};letter-spacing:1px;text-transform:none;font-weight:400">· opcional</span>` : ''))}
<div style="display:flex;align-items:center;justify-content:space-between;height:${opts.h || 52}px;background:${C.ink};border:1px solid ${opts.foco ? C.gold : opts.erro ? C.hoje : C.border};${opts.foco ? `box-shadow:0 0 0 3px rgba(201,169,110,.35);` : ''}border-radius:8px;padding:0 16px;color:${valor ? C.cream : '#585668'};font-size:${opts.fs || 20}px">${valor || opts.placeholder || ''}${opts.icone ? `<span style="color:${C.silver};font-size:18px">${opts.icone}</span>` : ''}</div>
${opts.erro ? `<p style="font-size:16px;color:${C.hoje}">${opts.erro}</p>` : ''}
${opts.nota ? `<p style="font-size:15px;color:${C.silver};line-height:1.35">${opts.nota}</p>` : ''}
</div>`;
const stepper = (label, valor) => `
<div style="display:flex;flex-direction:column;gap:8px;flex:1">${rot(label)}
<div style="display:flex;align-items:center;justify-content:space-between;height:46px;background:${C.ink};border:1px solid ${C.border};border-radius:8px;padding:0 6px">
<span style="display:flex;align-items:center;justify-content:center;width:36px;height:36px;border:1px solid ${C.border};border-radius:6px;color:${C.cream};font-size:22px">−</span>
<span style="color:${C.cream};font-size:22px">${valor}</span>
<span style="display:flex;align-items:center;justify-content:center;width:36px;height:36px;border:1px solid ${C.border};border-radius:6px;color:${C.cream};font-size:22px">+</span></div></div>`;
const segmento = (opcoes, ativa) => `
<div style="display:flex;gap:6px;background:${C.ink};border:1px solid ${C.border};border-radius:10px;padding:6px">
${opcoes.map((o) => `<p style="flex:1;text-align:center;font-size:17px;letter-spacing:1px;padding:10px 6px;border-radius:7px;${o === ativa ? `background:${C.warm};color:${C.white};box-shadow:inset 0 0 0 1px ${C.border};font-weight:500` : `color:${C.creamD}`}">${o}</p>`).join('')}
</div>`;
const toggle = (label, on, nota) => `
<div style="display:flex;align-items:center;justify-content:space-between;gap:16px;padding:6px 0">
<div style="display:flex;flex-direction:column;gap:4px"><p style="font-size:19px;color:${C.cream}">${label}</p>${nota ? `<p style="font-size:15px;color:${C.silver}">${nota}</p>` : ''}</div>
<div style="display:flex;align-items:center;width:62px;height:34px;border-radius:17px;background:${on ? C.gold : C.border};padding:3px;justify-content:${on ? 'flex-end' : 'flex-start'}"><span style="display:block;width:28px;height:28px;border-radius:14px;background:${on ? C.ink : C.creamD}"></span></div>
</div>`;
const botao = (texto, opts = {}) => `<div style="display:flex;align-items:center;justify-content:center;height:${opts.h || 58}px;border-radius:8px;${opts.wa ? `background:${C.wa};color:#06281a` : opts.ghost ? `background:transparent;border:1px solid ${C.border};color:${C.cream}` : `background:linear-gradient(180deg,${C.goldL},${C.gold});color:${C.ink}`};font-size:${opts.fs || 20}px;letter-spacing:${opts.ghost ? 1 : 4}px;text-transform:${opts.ghost ? 'none' : 'uppercase'};font-weight:500;${opts.w ? `width:${opts.w}px;` : ''}">${texto}</div>`;
const chip = (t, ativo) => `<p style="font-size:16px;letter-spacing:1px;padding:9px 16px;border-radius:999px;border:1px solid ${ativo ? C.gold : C.border};color:${ativo ? C.ink : C.creamD};${ativo ? `background:${C.gold};font-weight:500` : ''}">${t}</p>`;
const lista = (itens, cor = C.text, fs = 24) => `<div style="display:flex;flex-direction:column;gap:12px">${itens.map((i) => `<div style="display:flex;gap:14px;align-items:flex-start"><span style="display:block;width:10px;height:10px;border-radius:5px;background:${C.gold};margin-top:${Math.round(fs * 0.55)}px;flex:none"></span><p style="font-size:${fs}px;line-height:1.4;color:${cor}">${i}</p></div>`).join('')}</div>`;

const secao = (id, corpo, notas, escuro = false) => `<section id="${id}" data-transition="fade" style="background:${escuro ? '#141821' : C.slideBg};color:${escuro ? C.cream : C.text};font-family:${SANS};padding:88px 96px 120px;display:flex;flex-direction:column;gap:36px">
${corpo}
${rodape(ORDER.indexOf(id) + 1)}
<aside>${notas}</aside>
</section>`;

const linha = (hoje, depois) => `<div style="display:flex;gap:56px;align-items:flex-start">${hoje}${depois}</div>`;

// ---------- slides ----------
const ORDER = ['cover', 'hoje', 'registro', 'campos', 'autocompletar', 'preco', 'mensagem', 'mobile', 'peso', 'ordem'];
const S = {};

S.cover = `<section id="cover" data-transition="fade" style="background:#141821;color:${C.cream};font-family:${SANS};padding:128px;display:flex;flex-direction:column;justify-content:space-between">
<p style="font-size:24px;letter-spacing:6px;text-transform:uppercase;color:${C.gold};font-weight:500">The World Keys · Site · 29 de outubro de 2026</p>
<div style="display:flex;flex-direction:column;gap:28px">
<h1 style="font-family:${SERIF};font-size:112px;font-weight:500;line-height:1.02;width:1560px">O formulário do chauffeur: registrar, perguntar o certo, mostrar o preço</h1>
<hr style="border-top:3px solid ${C.gold};width:160px">
<p style="font-family:${SERIF};font-size:46px;font-style:italic;line-height:1.25;color:${C.cream};width:1500px">Auditoria de theworldkeys.com/pt/chauffeur-prive, com o print de cada área como está hoje e como deve ficar.</p>
</div>
<div style="display:flex;justify-content:space-between;align-items:flex-end">
<p style="font-size:28px;color:#b5b1a7">${TOTAL} slides · 8 minutos · cada otimização em um slide: hoje à esquerda, depois à direita</p>
<p style="font-size:24px;color:#b5b1a7">Preparado para The World Keys SAS</p>
</div>
<aside>Abertura (20 s): « A página do chauffeur é a melhor do site, e por isso vale otimizar o único ponto onde ela converte: o formulário. Testei de ponta a ponta em 28/10, sem mandar nada no WhatsApp. Cada slide mostra o print de hoje e o desenho de como deve ficar. »</aside>
</section>`;

S.hoje = secao('hoje', `
${cab('O que a página faz hoje', 'Quatro campos, um clique, e o cliente vai embora para o WhatsApp', 'Verificado em 28/10/2026 no navegador, desktop e mobile. A página é boa: título, carro, área, nome do chauffeur, FAQ e dados estruturados corretos. O formulário é o que pede trabalho.')}
${linha(
  coluna('Hoje', C.hoje, print(img('hero-desktop.jpg'), 800, 454, [{ x: 10, y: 352, w: 180, h: 44, t: '"Reservar" só rola até o formulário', lx: 200, ly: 356, lw: 330 }]), 800),
  `<div style="display:flex;flex-direction:column;gap:22px;width:860px;padding-top:58px">
  ${lista([
    '<b>Formulário:</b> Partida, Destino, Data, Horário. Validação em linha funciona.',
    '<b>Envio:</b> abre <b>api.whatsapp.com</b> na mesma aba com a mensagem pronta (inclui a distância calculada).',
    '<b>Nada fica registrado:</b> nenhuma gravação no servidor, nenhum evento de analytics no clique.',
    '<b>Faltam perguntas:</b> passageiros (a FAQ promete), tipo de serviço, ida e volta, voo, nome.',
    '<b>Autocompletar sem fronteira:</b> sugere Ajaccio, Nantes e Lille para "Aeroporto de N".',
    '<b>Peso:</b> 4,9 MB por visita; a imagem de compartilhamento (og:image) responde 404.',
  ], C.text, 25)}
  <p style="font-size:22px;line-height:1.4;color:${C.muted};border-left:3px solid ${C.gold};padding-left:18px">Fato × suposição: tudo acima é fato verificado na página. As telas "como deve ficar" dos próximos slides são proposta.</p>
  </div>`)}
`, '45 s. O print é a primeira tela da página. O botão dourado não reserva: rola até o formulário. A lista da direita é o resumo da auditoria de 28/10 (docs/auditoria/chauffeur-prive-2026-10-28.md).');

S.registro = secao('registro', `
${cab('Otimização 1 · prioridade máxima', 'O pedido precisa existir antes de o cliente sair para o WhatsApp', 'Hoje o lead só existe se o cliente concluir dentro do WhatsApp. No desktop sem o app, ele cai nesta tela e, se fechar, some sem rastro.')}
${linha(
  coluna('Hoje · depois do clique', C.hoje, print(img('whatsapp-intersticio-800.jpg'), 700, 624, [{ x: 232, y: 410, w: 236, h: 108, t: 'Saiu do site, na mesma aba. Nenhum registro nosso.', lx: 10, ly: 540, lw: 420 }]), 700),
  coluna('Como deve ficar · a página fica, o WhatsApp abre ao lado', C.goldD, cartao(`
    <div style="display:flex;align-items:center;justify-content:space-between"><p style="font-family:${SERIF};font-size:34px;color:${C.white}">Mensagem preparada</p><p style="font-size:16px;letter-spacing:2px;color:${C.gold};border:1px solid ${C.gold};padding:6px 12px">REF. CH-4F2K</p></div>
    <p style="font-size:19px;line-height:1.45;color:${C.creamD}">Aeroporto de Nice → Hôtel de Paris, Mônaco · 5 de novembro, 2:30 PM · 2 passageiros</p>
    ${botao('Abrir o WhatsApp com a mensagem', { wa: true })}
    <div style="display:flex;gap:14px">${botao('Copiar a mensagem', { ghost: true, h: 52, w: 345 })}${botao('Ligar +33 7 81 93 72 70', { ghost: true, h: 52, w: 345 })}</div>
    <p style="font-size:16px;line-height:1.45;color:${C.silver}">Se o WhatsApp não abrir, a mensagem já está copiada. Julien responde pelo mesmo número.</p>
  `, 760) + `
  <div style="display:flex;flex-direction:column;gap:10px;width:760px">
  ${lista([
    'Antes de abrir o WhatsApp, <b>gravar o pedido</b> (trajeto, data, hora, idioma, origem; sem dados pessoais) e devolver a referência curta, que vai na mensagem.',
    'Evento de conversão <b>generate_lead</b> no GA4 e contador próprio que não depende de cookie.',
    'WhatsApp em <b>nova aba</b>; o botão volta a ficar ativo; "copiar" e "ligar" como saídas de emergência.',
  ], C.text, 21)}</div>`, 760))}
`, '1 min. Fato: testei o envio com cookies "apenas necessários" e nenhum evento disparou; nenhuma chamada ao nosso servidor antes do redirecionamento. A referência CH-4F2K é o elo entre a conversa de Julien e o registro. Esforço: 1 dia de dev.');

S.campos = secao('campos', `
${cab('Otimização 2 · prioridade máxima', 'Perguntar o que Julien precisa para orçar em uma só resposta', 'A FAQ da própria página diz "informe partida, chegada, data e número de passageiros". O campo de passageiros não existe. Cada falta vira uma pergunta de volta.')}
${linha(
  coluna('Hoje · o formulário completo', C.hoje, print(img('form-800.jpg'), 640, 560, [
    { x: 44, y: 70, w: 548, h: 160, t: 'Só ponto a ponto: não serve para "hora ou dia" nem evento', lx: 60, ly: 118, lw: 420 },
    { x: 44, y: 238, w: 548, h: 100, t: 'Sem passageiros · bagagens · ida e volta · voo · nome', lx: 60, ly: 346, lw: 480 },
  ]), 640),
  coluna('Como deve ficar', C.goldD, cartao(`
    ${segmento(['Transfer', 'À disposição · hora ou dia', 'Evento · noite'], 'Transfer')}
    <div style="display:flex;gap:16px">${campo('Partida', 'Aeroporto de Nice (NCE)', { icone: '◎', h: 46 })}${campo('Destino', 'Hôtel de Paris, Mônaco', { icone: '◎', h: 46 })}</div>
    <div style="display:flex;gap:16px">${campo('Data', '5 de novembro de 2026', { icone: '▦', h: 46 })}${campo('Horário', '2:30 PM', { icone: '◷', h: 46, nota: 'Só de 5 em 5 minutos: 2:25, 2:30, 2:35 PM. Nunca 2:33.' })}</div>
    <div style="display:flex;gap:16px">${stepper('Passageiros', '2')}${stepper('Bagagens', '2')}${campo('Nº do voo', 'AF 1234', { opcional: true, h: 46 })}</div>
    ${toggle('Ida e volta', true, 'Retorno: 9 de novembro, 11:00 AM · do hotel ao aeroporto')}
    ${campo('Seu nome', 'Ana Ribeiro', { opcional: true, h: 44, fs: 19 })}
    ${botao('Pedir orçamento no WhatsApp', { h: 54 })}
  `, 900, 'gap:10px;padding:20px 28px'), 900))}
`, '1 min 15. Tipo de serviço muda o formulário: em "à disposição" o destino vira duração (3 h, 6 h, dia). Voo aparece quando partida ou destino é aeroporto ou estação. O horário é escolhido em passos de 5 minutos (2:30, 2:35, 2:40), nunca minuto quebrado: facilita a agenda de Julien e evita erro de digitação. Acima de 6 passageiros, mensagem "fale com Julien". O botão passa a dizer o que acontece: é orçamento, não reserva confirmada.');

S.autocompletar = secao('autocompletar', `
${cab('Otimização 3', 'O autocompletar precisa conhecer a Riviera', 'Para "Aeroporto de N" o Google sugere Nice, mas também Ajaccio, Nantes, Lille e Nancy. O cliente pode seguir ao WhatsApp com um trajeto que não atendemos.')}
${linha(
  coluna('Hoje · celular, 375 px', C.hoje, print(img('mobile-autocomplete.jpg'), 260, 563, [{ x: 29, y: 329, w: 203, h: 106, t: 'Quatro das cinco sugestões ficam fora da área', lx: 29, ly: 442, lw: 203 }]), 260),
  `<div style="display:flex;gap:40px;align-items:flex-start">
  ${coluna('Como deve ficar', C.goldD, cartao(`
    ${rot('Partida')}
    <div style="display:flex;flex-wrap:wrap;gap:8px">${chip('Aeroporto de Nice (NCE)', true)}${chip('Estação Nice-Ville')}${chip('Cannes · Croisette')}${chip('Mônaco · Monte-Carlo')}${chip('Heliporto de Mônaco')}</div>
    ${campo('', 'Aeroporto de N', { foco: true, h: 52 })}
    <div style="display:flex;flex-direction:column;background:${C.ink};border:1px solid ${C.border};border-radius:8px">
      ${['<b>Aeroporto de N</b>ice Côte d’Azur (NCE) · Terminal 1 e 2', 'Estação <b>N</b>ice-Ville · Av. Thiers', 'Hôtel <b>N</b>egresco · Promenade des Anglais, Nice', 'Port de <b>N</b>ice · Quai Lunel'].map((t, i) => `<p style="font-size:18px;color:${C.cream};padding:13px 16px;${i < 3 ? `border-bottom:1px solid ${C.border}` : ''}">${t}</p>`).join('')}
    </div>
    <p style="font-size:15px;color:${C.silver};line-height:1.4">Só França e Mônaco, com prioridade entre Saint-Tropez e Menton. Endereço fora da área: "Somente Côte d’Azur — fale com Julien".</p>
  `, 560), 560)}
  <div style="display:flex;flex-direction:column;gap:14px;width:380px;padding-top:58px">
  ${lista([
    '<b>Restringir</b> a FR + MC e dar viés geográfico à Riviera (bounds + strictBounds).',
    '<b>Atalhos de um toque</b> para os cinco pontos mais pedidos.',
    'Trocar a API legada (<b>AutocompleteService</b>, aviso no console) pela atual.',
    'Carregar o Google Maps <b>só quando o campo recebe foco</b>, não na abertura da página.',
  ], C.text, 20)}</div></div>`)}
`, '45 s. O print é real: digitei "Aeroporto de N" no celular. Esforço: meio dia. Carregar o Maps sob demanda também tira um script de bloqueio da primeira pintura.');

S.preco = secao('preco', `
${cab('Otimização 4', 'Mostrar o preço antes do clique, e dizer quando respondemos', 'A página já calcula a distância (33 km no teste). Quem vê "a partir de 130 €" manda a mensagem decidido; Julien confirma em vez de orçar.')}
${linha(
  coluna('Hoje · promessa sem preço nem horário', C.hoje, print(img('secao-pedido-800.jpg'), 640, 567, [{ x: 20, y: 205, w: 330, h: 40, t: '"Em geral em poucos minutos" — às 3 h da manhã não é verdade', lx: 20, ly: 255, lw: 380 }, { x: 20, y: 60, w: 600, h: 120, t: 'Nenhum valor em toda a página', lx: 370, ly: 92, lw: 240 }]), 640),
  coluna('Como deve ficar · estimativa ao escolher o trajeto', C.goldD, cartao(`
    <div style="display:flex;justify-content:space-between;align-items:flex-end;border-bottom:1px solid ${C.border};padding-bottom:16px">
      <div style="display:flex;flex-direction:column;gap:6px"><p style="font-size:16px;letter-spacing:3px;text-transform:uppercase;color:${C.gold}">Transfer · 33 km · ~45 min</p><p style="font-family:${SERIF};font-size:30px;color:${C.white}">Aeroporto de Nice → Mônaco</p></div>
      <div style="display:flex;flex-direction:column;align-items:flex-end"><p style="font-size:15px;color:${C.silver}">a partir de</p><p style="font-family:${SERIF};font-size:54px;line-height:1;color:${C.goldL}">130 €</p></div>
    </div>
    <div style="display:flex;flex-direction:column;gap:6px">
      ${[['Tesla Model X · até 6 passageiros, 6 bagagens', 'incluído'], ['Espera no aeroporto · acompanhamento do voo', 'incluído'], ['Noite (22h–6h) · feriados', '+ 20 %']].map(([k, v]) => `<div style="display:flex;justify-content:space-between"><p style="font-size:18px;color:${C.creamD}">${k}</p><p style="font-size:18px;color:${C.cream}">${v}</p></div>`).join('')}
    </div>
    <p style="font-size:16px;line-height:1.45;color:${C.silver}">Valor confirmado por Julien no WhatsApp antes de qualquer cobrança.</p>
    <div style="display:flex;align-items:center;gap:14px;background:${C.ink};border:1px solid ${C.border};border-radius:8px;padding:14px 16px"><span style="display:block;width:12px;height:12px;border-radius:6px;background:${C.ok}"></span><p style="font-size:18px;color:${C.cream}">Atendimento das 7h às 23h · fora disso, respondemos a partir das 7h</p></div>
    ${botao('Pedir orçamento no WhatsApp')}
  `, 820), 820))}
`, '1 min. Os valores são os da tabela proposta na premissa de 08/10 (Nice–Cannes / Nice–Mônaco 130 €); o fundador confirma a tabela antes de publicar. O horário de atendimento precisa ser o real. Nunca prometer resposta de terceiro: Julien é da casa, então aqui a promessa é nossa.');

S.mensagem = secao('mensagem', `
${cab('Otimização 5', 'A mensagem que chega a Julien precisa dizer tudo, inclusive o idioma', 'O texto gerado hoje é anônimo, sem passageiros, sem voo e sem dizer em que língua o cliente escreveu. Julien lê sete idiomas de formulário.')}
${linha(
  coluna('Hoje · texto real gerado pelo formulário', C.hoje, `
  <div style="display:flex;flex-direction:column;gap:14px;width:640px">
  <div style="display:flex;flex-direction:column;gap:8px;background:#e7ffdb;border-radius:14px;padding:20px 24px;color:#111;font-size:22px;line-height:1.4;width:600px;box-shadow:0 6px 18px rgba(0,0,0,.12)">
  <p style="font-size:22px;line-height:1.4">Olá Julien,</p><p style="font-size:22px;line-height:1.4">Gostaria de reservar um motorista particular com a The World Keys.</p>
  <p style="font-size:22px;line-height:1.4">Partida: Aeroporto de Nice<br>Destino: Hôtel de Paris, Mônaco<br>Distância: 33 km<br>Data: 5 de novembro de 2026<br>Horário: 14:30</p>
  <p style="font-size:14px;color:#6b6f7a;text-align:right">14:31 ✓✓</p>
  </div>
  ${lista(['Quem é? Quantos são? Que voo? Volta?', 'Em que idioma responder?', 'Qual registro corresponde a esta conversa?'], C.hoje, 21)}
  </div>`, 640),
  coluna('Como deve ficar · rótulos fixos em francês, valores do cliente', C.goldD, `
  <div style="display:flex;flex-direction:column;gap:14px;width:760px">
  <div style="display:flex;flex-direction:column;gap:8px;background:#e7ffdb;border-radius:14px;padding:20px 24px;color:#111;font-size:22px;line-height:1.4;width:640px;box-shadow:0 6px 18px rgba(0,0,0,.12)">
  <p style="font-size:22px;line-height:1.4"><b>TWK · Réf. CH-4F2K · [PT] · theworldkeys.com</b></p>
  <p style="font-size:22px;line-height:1.4">Service : Transfert<br>Départ : Aéroport de Nice (NCE)<br>Arrivée : Hôtel de Paris, Monaco · 33 km<br>Date : 05/11/2026 · 14:30<br>Retour : 09/11/2026 · 11:00<br>Passagers : 2 · Bagages : 2<br>Vol : AF 1234<br>Nom : Ana Ribeiro</p>
  <p style="font-size:22px;line-height:1.4">Olá Julien, gostaria de um orçamento para este trajeto.</p>
  <p style="font-size:14px;color:#6b6f7a;text-align:right">14:31 ✓✓</p>
  </div>
  ${lista(['Cabeçalho fixo com referência e etiqueta de idioma; rótulos sempre em francês, na mesma ordem: Julien lê igual em 7 idiomas.', 'Última linha no idioma do cliente, para ele reconhecer a própria mensagem.'], C.text, 20)}
  </div>`, 760))}
`, '45 s. O balão da esquerda é o texto exato que o formulário gerou no teste de 28/10. A etiqueta [PT] vem do idioma da página; a referência vem do registro do slide 3. Nenhum dado pessoal além do que o cliente digitou.');

S.mobile = secao('mobile', `
${cab('Otimização 6', 'No celular: erro que leva ao campo, letra que não dispara zoom', 'A validação existe e está certa. Falta levar o foco ao primeiro campo com erro, e os campos têm letra de 14 px: no iPhone, isso faz a tela dar zoom sozinha ao tocar.')}
${linha(
  coluna('Hoje · após "Enviar" com tudo vazio', C.hoje, print(img('form-validacao-800.jpg'), 640, 560, [{ x: 44, y: 130, w: 548, h: 20, t: 'Mensagem certa, mas o foco não vai ao campo', lx: 60, ly: 158, lw: 400 }, { x: 44, y: 272, w: 548, h: 44, t: 'Letra 14 px → zoom automático no iOS', lx: 60, ly: 322, lw: 340 }]), 640),
  coluna('Como deve ficar', C.goldD, cartao(`
    ${campo('Partida', '', { placeholder: 'Aeroporto de Nice, hotel, endereço…', foco: true, erro: 'Informe o local de partida.', h: 52, fs: 22 })}
    ${campo('Destino', '', { placeholder: 'Cannes, Mônaco, Saint-Tropez…', h: 52, fs: 22 })}
    <div style="display:flex;gap:16px">${campo('Data', 'Hoje, 29 de outubro', { h: 52, fs: 22 })}${campo('Horário', '7:30 PM', { h: 52, fs: 22, nota: 'De 5 em 5 minutos (7:25, 7:30, 7:35 PM). Para hoje, a partir das 4:40 PM. Antes disso, ligue.' })}</div>
    ${botao('Pedir orçamento no WhatsApp', { h: 54 })}
  `, 760, 'gap:12px;padding:24px 28px') + `<div style="display:flex;flex-direction:column;gap:8px;width:760px">${lista(['Ao falhar: foco e rolagem até o <b>primeiro campo inválido</b>.', 'Campos com <b>16 px</b> no celular; altura 48–56 px (já está).', 'Horário só em passos de <b>5 minutos</b>, nunca 7:33; hora mínima quando a data é hoje.'], C.text, 19)}</div>`, 760))}
`, '40 s. Detalhe pequeno, custo pequeno (meio dia junto com o slide 4), mas é onde o celular perde gente: o zoom involuntário desorienta e o erro sem foco parece que o botão não funcionou.');

S.peso = secao('peso', `
${cab('Otimização 7', 'Peso da página e o cartão de compartilhamento', 'A página transfere 4,9 MB. As duas versões da foto do Tesla são baixadas juntas no desktop, e a imagem que aparece ao compartilhar o link no WhatsApp não existe (404).')}
${linha(
  `<div style="display:flex;flex-direction:column;gap:18px;width:820px">${tag('Hoje · medido com curl em 28/10', C.hoje)}
  <table style="font-size:22px;color:${C.text}">
  <tr><th style="font-size:16px;letter-spacing:3px;text-transform:uppercase;color:${C.muted};font-weight:500">Arquivo</th><th style="font-size:16px;letter-spacing:3px;text-transform:uppercase;color:${C.muted};font-weight:500;text-align:right">Peso</th><th style="font-size:16px;letter-spacing:3px;text-transform:uppercase;color:${C.muted};font-weight:500">Observação</th></tr>
  <tr><td>tesla-model-x-mobile.png</td><td style="text-align:right;color:${C.hoje};font-weight:500">1,49 MB</td><td>941×1672, baixado também no desktop</td></tr>
  <tr><td>tesla-model-x.png</td><td style="text-align:right">704 KB</td><td>carregado duas vezes na página</td></tr>
  <tr><td>nice.jpg</td><td style="text-align:right">634 KB</td><td>cartão pequeno da cidade</td></tr>
  <tr><td>saint-tropez.jpg + monaco.jpg</td><td style="text-align:right">760 KB</td><td>idem</td></tr>
  <tr><td>twk-logo.gif</td><td style="text-align:right">146 KB</td><td>logo animado</td></tr>
  <tr><td>og-default.jpg</td><td style="text-align:right;color:${C.hoje};font-weight:500">404</td><td>sem imagem ao compartilhar o link</td></tr>
  <tr><td><b>Total transferido</b></td><td style="text-align:right"><b>4,9 MB</b></td><td>cache das imagens: 4 horas</td></tr>
  </table></div>`,
  coluna('Como deve ficar', C.goldD, `
  <div style="display:flex;flex-direction:column;gap:18px;width:780px">
  ${lista(['<b>Uma</b> foto do Tesla por tela (&lt;picture&gt; ou next/image), WebP/AVIF, ≤ 150 KB cada; cidades ≤ 120 KB; logo em SVG.', 'Cache de 1 ano com nome versionado; Google Maps só quando o campo recebe foco.', 'Criar <b>og-default.jpg</b> 1200×630 com o Tesla; ideal, uma imagem por página.'], C.text, 21)}
  <p style="font-size:16px;letter-spacing:3px;text-transform:uppercase;color:${C.goldD};font-weight:500;margin-top:6px">Como o link passa a aparecer no WhatsApp</p>
  <div style="display:flex;gap:24px">
    <div style="display:flex;flex-direction:column;width:360px;border:1px solid ${C.rule};border-radius:12px;overflow:hidden;background:#fff"><div style="display:flex;align-items:center;justify-content:center;height:150px;background:#e5e2da"><p style="font-size:16px;color:${C.muted}">hoje: sem imagem (404)</p></div><div style="display:flex;flex-direction:column;gap:4px;padding:12px 14px"><p style="font-size:17px;font-weight:500;color:#111">Motorista particular na Côte d’Azur</p><p style="font-size:14px;color:${C.muted}">theworldkeys.com</p></div></div>
    <div style="display:flex;flex-direction:column;width:360px;border:1px solid ${C.rule};border-radius:12px;overflow:hidden;background:#fff"><div style="display:block;height:150px;background:url('${img('hero-desktop.jpg')}') center/cover"></div><div style="display:flex;flex-direction:column;gap:4px;padding:12px 14px"><p style="font-size:17px;font-weight:500;color:#111">Motorista particular na Côte d’Azur</p><p style="font-size:14px;color:${C.muted}">theworldkeys.com</p></div></div>
  </div></div>`, 780))}
`, '40 s. Os pesos vêm de curl -I em 28/10; o og:image 404 já estava na auditoria do site de 07/10 e continua. O cartão do WhatsApp é justamente o canal da conversão: um link compartilhado sem foto parece abandonado.');

S.ordem = secao('ordem', `
${cab('Ordem de implementação', 'Seis entregas, cerca de seis dias de dev, começando pelo que hoje se perde', 'Cada linha é independente da seguinte. A primeira muda a operação no mesmo dia: passa a existir medição.')}
<div style="display:flex;gap:56px;align-items:flex-start">
<table style="font-size:23px;color:${C.text};width:1160px">
<tr><th style="font-size:16px;letter-spacing:3px;text-transform:uppercase;color:${C.muted};font-weight:500;width:60px">#</th><th style="font-size:16px;letter-spacing:3px;text-transform:uppercase;color:${C.muted};font-weight:500">Entrega</th><th style="font-size:16px;letter-spacing:3px;text-transform:uppercase;color:${C.muted};font-weight:500;width:160px">Esforço</th><th style="font-size:16px;letter-spacing:3px;text-transform:uppercase;color:${C.muted};font-weight:500">Efeito</th></tr>
<tr><td style="color:${C.goldD};font-weight:500">1</td><td>Registrar o pedido + evento GA4 + WhatsApp em nova aba com "copiar" e "ligar"</td><td>1 dia</td><td>nenhum pedido se perde; passa a existir medição</td></tr>
<tr><td style="color:${C.goldD};font-weight:500">2</td><td>Campos: tipo de serviço, passageiros, bagagens, ida e volta, voo, nome</td><td>1–2 dias</td><td>orçamento em uma resposta</td></tr>
<tr><td style="color:${C.goldD};font-weight:500">3</td><td>Autocompletar restrito à Riviera, atalhos, Maps sob demanda</td><td>½ dia</td><td>menos erro, página mais leve</td></tr>
<tr><td style="color:${C.goldD};font-weight:500">4</td><td>Imagens em WebP, cache de 1 ano, og-default.jpg</td><td>½ dia</td><td>carregamento e cartão no WhatsApp</td></tr>
<tr><td style="color:${C.goldD};font-weight:500">5</td><td>Estimativa de preço, horário de atendimento, mensagem com idioma e referência</td><td>1–2 dias</td><td>decisão antes do clique</td></tr>
<tr><td style="color:${C.goldD};font-weight:500">6</td><td>Mobile: foco no erro, 16 px, hora mínima; redirecionar /driver; "Explorar" → Riviera</td><td>½ dia</td><td>acabamento</td></tr>
</table>
<div style="display:flex;flex-direction:column;gap:16px;width:520px;background:#141821;padding:30px 34px">
<p style="font-size:18px;letter-spacing:4px;text-transform:uppercase;color:${C.goldL};font-weight:500">O que medir depois</p>
${lista(['Pedidos registrados por dia (hoje: desconhecido).', 'Pedidos registrados → conversas abertas no WhatsApp.', 'Abandono por campo (form_start → form_submit).', 'Perguntas de volta de Julien por pedido (meta: zero).'], C.cream, 20)}
<p style="font-size:17px;line-height:1.45;color:#b5b1a7">Decisão pedida: aprovar a tabela de preços "a partir de" e o horário de atendimento antes do item 5.</p>
</div></div>
`, '40 s. Fechamento: « O item 1 é o que eu faria hoje. O resto é uma semana de dev. A única decisão que precisa do fundador é a tabela de preços e o horário que vamos publicar. »');

// ---------- grava projeto ----------
fs.mkdirSync(path.join(PROJ, 'slides'), { recursive: true });
for (const id of ORDER) {
  if (!S[id]) { console.error('slide sem conteúdo: ' + id); process.exit(2); }
  fs.writeFileSync(path.join(PROJ, 'slides', `${id}.html`), S[id].trim() + '\n');
}
const deck = {
  v: 4,
  createdOnFiles: { v: 1, at: '2026-10-29T09:00:00Z' },
  lists: 'css',
  title: 'Chauffeur privé · O formulário que registra, pergunta o certo e mostra o preço',
  order: ORDER,
  sections: {
    s1: { description: 'O que a página faz hoje e por que o formulário é o ponto a otimizar.', start: 'cover' },
    s2: { description: 'Sete otimizações, cada uma com o print de hoje e o desenho de como deve ficar.', start: 'registro' },
    s3: { description: 'Ordem de implementação e o que medir.', start: 'ordem' },
  },
  faces: {
    'cormorant-garamond': { family: 'Cormorant Garamond', href: 'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400..700;1,400..700&display=swap' },
    jost: { family: 'Jost', href: 'https://fonts.googleapis.com/css2?family=Jost:wght@300..600&display=swap' },
  },
  designSystems: [],
};
fs.writeFileSync(path.join(PROJ, 'deck.json'), JSON.stringify(deck, null, 2) + '\n');

// PT sempre; FR quando fr/fontes existir (tradução manual ou por subagente, mesmas tags e números).
embutir('pt');
execFileSync(process.execPath, [path.join(RAIZ, 'docs', 'site', 'deck-html.js'), path.join(AQUI, 'pt'), SAIDA, '--lang', 'pt'], { stdio: 'inherit' });
if (embutir('fr')) {
  execFileSync(process.execPath, [path.join(RAIZ, 'docs', 'site', 'deck-html.js'), path.join(AQUI, 'fr'), SAIDA_FR, '--lang', 'fr'], { stdio: 'inherit' });
} else {
  console.log('fr/fontes ausente: deck francês não gerado');
}
