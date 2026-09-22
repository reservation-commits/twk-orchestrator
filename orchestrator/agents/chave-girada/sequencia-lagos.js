#!/usr/bin/env node
'use strict';
/**
 * Operação Lagos por e-mail — SEQUÊNCIA DE 3 TOQUES por casa, em PT-PT, com os números reais de cada uma.
 * Gera, não envia. Envio é outra etapa, com aprovação do fundador por lote.
 *
 *   node sequencia-lagos.js                      → gera a partir de orchestrator/state/lagos/alvos-lagos-2026-09-16.csv
 *   node sequencia-lagos.js --alvos <csv>
 *
 * Saída em orchestrator/state/lagos/emails/:
 *   <id>-T1.html / -T2.html / -T3.html   (+ .txt com a versão em texto)
 *   sequencia-manifesto.csv               casa · toque · dia · assunto · pré-cabeçalho · arquivo · condição de envio
 *   revisao-sequencia-lagos.html          página única para o fundador ler os 75 e-mails
 *
 * Por que assim (evidência no dossiê "A Chave na Mão", 15/09):
 *   - o único e-mail que converteu foi o que trazia o número da própria casa (Extrato: 9% em 13h) → todo toque abre com o número dela;
 *   - e-mail frio a caixa genérica rende <1%; personalização avançada 2×; um follow-up eleva respostas em 66%; três toques, não mais;
 *   - menos de ~120 palavras no corpo, UM botão, um pedido só; a alternativa "responda SIM" é o caminho de menor atrito (ativação assistida);
 *   - prova social só verdadeira: as casas de Lagos que respondem em nome próprio (calculadas da lista, nunca inventadas);
 *   - discrição e reconhecimento: nunca cobrança. TOKENS_PROIBIDOS do Extrato valem aqui, por código;
 *   - rodapé de opt-out obrigatório (guardrail 8); nenhum reservation@ visível; links sem sequência "=XX" hexadecimal.
 *
 * O guardrail de quoted-printable vive no n8n (nó Enviar (Gmail), verificado 07/09); este gerador não compensa.
 * Regras de envio (para o script de envio, quando aprovado):
 *   T1 dia 0 · T2 dia 3 só sem clique/resposta · T3 dia 8 só sem clique/resposta · nunca um 4º. Máx. 20 por dia. Opt-out consultado antes de cada envio.
 */
const fs = require('node:fs');
const path = require('node:path');
const { mascararEmail, TOKENS_PROIBIDOS } = require('./extratos.js');
const B = require('./n8n/_blocos-twk.js');
const { rodape: rodapeOptout, exigirOptout } = require('../registro-optout/rodape-optout');

const RAIZ = path.resolve(__dirname, '..', '..', '..');
const ST = path.join(RAIZ, 'orchestrator', 'state', 'lagos');
const OUT = path.join(ST, 'emails');
const a = process.argv.slice(2);
const val = (n, d) => { const i = a.indexOf(n); return i >= 0 && a[i + 1] ? a[i + 1] : d; };
const alvosCsv = val('--alvos', path.join(ST, 'alvos-lagos-2026-09-16.csv'));
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const cta = (id, t) => `https://manager.theworldkeys.com/register?utm_source=email&utm_campaign=lagos-2026-09&utm_content=r${id}-t${t}`;
const pagina = (slug) => `https://theworldkeys.com/hospitality/${slug}/`;
const ASSINATURA = ['Márlon Andrade', 'Gerente Comercial · The World Keys'];

fs.mkdirSync(OUT, { recursive: true });
const linhas = fs.readFileSync(alvosCsv, 'utf8').split(/\r?\n/).filter(Boolean);
const cols = linhas[0].split(';');
const alvos = linhas.slice(1).map((l) => Object.fromEntries(l.split(';').map((v, i) => [cols[i], v])));
const ativas = alvos.filter((x) => !x.tier.startsWith('X-'));
// prova social verdadeira: casas de Lagos com ≥2 respostas em nome próprio nos últimos 180 dias
const vizinhas = ativas.filter((x) => +x.resp_propria180 >= 2).sort((p, q) => +q.resp_propria180 - +p.resp_propria180).map((x) => x.name);
const lista = (arr) => arr.length <= 1 ? arr.join('') : `${arr.slice(0, -1).join(', ')} e ${arr[arr.length - 1]}`;

// ---------- textos ----------
function textos(x) {
  const casa = x.name, p180 = +x.p180, p90 = +x.p90, dia = +x.mesmo_dia90, ac = +x.aceites180, rp = +x.resp_propria180, rec = +x.recusas180;
  const email = mascararEmail(x.email);
  const responde = x.segmento !== 'S-SILENCIOSA';
  const outras = lista(vizinhas.filter((n) => n !== casa).slice(0, 3));
  const passos = [
    'Abram o link e escolham "My restaurant is already on the site".',
    email ? `Um código de 6 dígitos chega em ${email}.` : 'Um código de 6 dígitos chega ao e-mail de reservas da casa.',
    'Introduzam o código e criem a palavra-passe. A página é vossa.',
  ];
  const sim = 'Preferem que trate eu? Respondam <b>SIM</b> a este e-mail e faço a ativação convosco, por telefone ou WhatsApp, em cinco minutos.';
  const simTxt = 'Preferem que trate eu? Respondam SIM a este e-mail e faço a ativação convosco, por telefone ou WhatsApp, em cinco minutos.';

  // T1 — o número da casa
  const semDemanda = p180 < 3; // número fraco não abre e-mail: entra a variante "página pronta + vizinhas"
  const T1 = semDemanda ? {
    assunto: outras ? `${casa}: a página está pronta, e as vizinhas de Lagos já respondem` : `${casa}: a página está pronta na The World Keys`,
    pre: `A página já está publicada, sem custo; falta estar nas vossas mãos.`,
    titulo: 'A vossa página, já publicada.',
    paras: [
      `Olá, equipa de ${casa}.`,
      `Somos a The World Keys, plataforma de reservas nascida em Paris, com 1.546 restaurantes e mais de 22 mil clientes. ${outras ? `Em Lagos, ${outras} já respondem aos nossos pedidos de mesa em nome próprio.` : ''}`.trim(),
      `A página de ${casa} já está publicada, sem custo. O que falta é que esteja nas vossas mãos: com a conta da casa, gratuita, cada pedido chega num painel só e responde-se num toque pelo telemóvel; os horários, os dias de fecho e a política de reserva passam a ser definidos por vocês.`,
    ],
    cta: 'Ativar a conta da casa',
  } : responde ? {
    assunto: rec === 0 ? (ac === 1 ? `${casa}: 1 de 1 pedido aceite. A vossa chave está pronta.` : `${casa}: ${ac} de ${ac} pedidos aceites. A vossa chave está pronta.`) : `${casa}: ${ac + rec} respostas em seis meses. A vossa chave está pronta.`,
    pre: `Vocês já respondem aos nossos clientes. A conta da casa, gratuita, tira esse trabalho do e-mail e põe-no no telemóvel.`,
    titulo: rec === 0 ? 'Vocês aceitam tudo o que abrem. Isto é para vocês.' : 'Vocês respondem. Quase ninguém responde.',
    numero: { valor: rec === 0 ? `${ac} / ${ac}` : String(ac + rec), baixo: rec === 0 ? (ac === 1 ? 'pedido de mesa aceite nos últimos seis meses' : 'pedidos de mesa aceites nos últimos seis meses') : `respostas nos últimos seis meses · ${ac} sim · ${rec} não` },
    paras: [
      `Olá, equipa de ${casa}.`,
      `Nos últimos seis meses, cada pedido de mesa que abriram na The World Keys foi respondido por vocês, pelo link do e-mail, um a um. Entre 1.546 restaurantes publicados, muito poucos fazem isso, e por isso escrevo primeiro para vocês.`,
      `A conta da casa, gratuita, existe para tirar esse trabalho do e-mail: todos os pedidos num painel só, resposta num toque pelo telemóvel, e os horários, os dias de fecho e a política de reserva nas vossas mãos.`,
    ],
    cta: 'Ativar a conta da casa',
  } : {
    assunto: `${p180} clientes pediram mesa em ${casa} pela The World Keys. A conta da casa está pronta.`,
    pre: `Só este verão foram ${p90}. A página já está publicada, sem custo; falta estar nas vossas mãos.`,
    titulo: `${p180} clientes escolheram ${casa}.`,
    numero: { valor: String(p180), baixo: `clientes pediram mesa em ${casa} pela The World Keys nos últimos seis meses` },
    paras: [
      `Olá, equipa de ${casa}.`,
      `Somos a The World Keys, plataforma de reservas nascida em Paris, com 1.546 restaurantes e mais de 22 mil clientes. ${p90 >= 5 ? `Só entre junho e setembro, ${p90} clientes pediram mesa na vossa casa pelo nosso site${dia >= 3 ? `, ${dia} deles para o próprio dia` : ''}.` : `Uma parte desses pedidos é para o próprio dia.`}`,
      `A página de ${casa} já está publicada, sem custo. O que falta é que esteja nas vossas mãos: com a conta da casa, gratuita, cada pedido chega num painel só e responde-se num toque pelo telemóvel; os horários, os dias de fecho e a política de reserva passam a ser definidos por vocês.`,
    ],
    cta: 'Ativar a conta da casa',
  };

  // T2 — a página, já pronta (dia 3)
  const T2 = {
    assunto: `A página de ${casa} está pronta. Confiram os horários.`,
    pre: `Está no ar em theworldkeys.com. Se algo estiver errado, respondam com a correção e nós corrigimos.`,
    titulo: 'A vossa página, já pronta.',
    paras: [
      `Olá de novo, equipa de ${casa}.`,
      `A página da casa está publicada aqui: <a href="${pagina(x.slug)}" style="color:#E6C87A; text-decoration:underline;">${pagina(x.slug).replace('https://', '')}</a>. Se os horários, os dias de fecho ou qualquer dado estiverem errados, respondam a este e-mail com a correção e nós corrigimos, sem custo.`,
      responde
        ? `Com a conta da casa, o que hoje fazem pelo link de cada e-mail passa a ser um toque no telemóvel, e os horários e dias de fecho ficam nas vossas mãos.`
        : `${dia >= 3 ? `Este verão, ${dia} dos pedidos que vos chegaram foram para o próprio dia. ` : ''}Por isso a conta da casa faz diferença: o pedido chega ao telemóvel e responde-se num toque; nos dias de fecho, o formulário não aceita pedidos.`,
    ],
    cta: 'Ativar a conta da casa',
  };

  // T3 — as vizinhas e o fecho (dia 8)
  const T3 = {
    assunto: outras && !semDemanda ? `Última mensagem: ${casa} e as casas de Lagos que já respondem` : `Última mensagem sobre a conta de ${casa}`,
    pre: `Não volto a escrever sobre isto. A conta fica disponível quando quiserem, gratuita.`,
    titulo: 'A última mensagem sobre isto.',
    paras: [
      `Olá, equipa de ${casa}.`,
      outras && !semDemanda
        ? `Em Lagos, ${outras} já respondem aos pedidos da The World Keys em nome próprio. Queremos que ${casa} tenha o mesmo controlo: os pedidos num painel só, resposta num toque, horários e fechos nas vossas mãos, sem custo e sem contrato.`
        : `Queremos que ${casa} tenha o controlo total da própria página: os pedidos num painel só, resposta num toque, horários e fechos nas vossas mãos, sem custo e sem contrato.`,
      `Esta é a última mensagem que envio sobre isto. A conta fica disponível quando quiserem; e se preferirem que a página saia do ar, basta um clique no rodapé.`,
    ],
    cta: 'Ativar a conta da casa',
  };
  return { T1, T2, T3, passos, sim, simTxt };
}

// ---------- render ----------
const rodapeInstitucional = (rid) => `        <tr><td align="center" style="padding:24px 20px 28px 20px; border-top:1px solid #26200F;">
          <p style="margin:0 0 4px 0; font-family:Georgia,'Times New Roman',serif; font-size:13px; letter-spacing:3px; color:#8F8368;">THE WORLD KEYS</p>
          <p style="margin:0 0 10px 0; font-family:Arial,Helvetica,sans-serif; font-size:11px; line-height:1.8; color:#6E6551;">
            <a href="https://theworldkeys.com/terms-of-use/" style="color:#8F8368; text-decoration:none;">Terms &amp; Conditions</a> &nbsp;&#183;&nbsp; <a href="mailto:support@theworldkeys.com" style="color:#8F8368; text-decoration:none;">support@theworldkeys.com</a><br/>
            66, Av. des Champs-&#201;lys&#233;es, 75008 Paris, France<br/>
            VAT: FR24901268326 &#183; R.C.S Paris: 901 268 326 &#183; &#169; 2026 The World Keys
          </p>
          ${rodapeOptout('pt', rid).replace('color:#8a8a8a', 'color:#6E6551').replace('font-size:12px', 'font-size:11px').replace(/<a /g, '<a style="color:#8F8368;" ')}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
const assinaturaHtml = `        <tr><td style="padding:18px 28px 8px 28px;">
          <p style="margin:0; font-family:Georgia,'Times New Roman',serif; font-size:16px; color:#F5EFE3;">${esc(ASSINATURA[0])}</p>
          <p style="margin:2px 0 0 0; font-family:Arial,Helvetica,sans-serif; font-size:12px; color:#8F8368;">${esc(ASSINATURA[1])}</p>
        </td></tr>`;

function render(x, t, T, extras) {
  const partes = [B.cabeca(T.titulo, T.pre, 'pt')];
  if (T.numero) partes.push(B.cartaoNumero(esc(x.name), esc(T.numero.valor), esc(T.numero.baixo)));
  partes.push(...T.paras.map((p) => B.paragrafo(p)));
  partes.push(B.botao(cta(x.restaurant_id, t), T.cta));
  partes.push(B.paragrafo(extras.sim, '#B5AB93', 14));
  if (t === 1) partes.push(B.passos('Como ativar, em três passos', extras.passos.map(esc)));
  partes.push(assinaturaHtml, rodapeInstitucional(x.restaurant_id));
  const html = partes.join('\n');
  const visivel = html.replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const hit = TOKENS_PROIBIDOS.find((re) => re.test(visivel));
  if (hit) throw new Error(`${x.name} T${t}: token proibido ${hit}`);
  if (/reservation@/i.test(html)) throw new Error(`${x.name} T${t}: reservation@ visível`);
  // Sequências "=XX" nos links (ex.: rid=69949) são compensadas no nó de envio do n8n (verificado em 07/09); a releitura pós-envio continua obrigatória.
  exigirOptout(html, `${x.name} T${t}`);
  const strip = (s) => String(s).replace(/<[^>]+>/g, '');
  const txt = [T.titulo, '', ...T.paras.map(strip), '', `${T.cta}: ${cta(x.restaurant_id, t)}`, '', extras.simTxt, '', ...(t === 1 ? ['Como ativar, em três passos:', ...extras.passos.map((p, i) => `${i + 1}. ${p}`), ''] : []), ...ASSINATURA].join('\n');
  return { html, txt, palavras: T.paras.map(strip).join(' ').split(/\s+/).length };
}

const manifesto = ['tier;segmento;restaurant_id;nome;toque;dia;condicao;assunto;preheader;arquivo_html;arquivo_txt;palavras;email_destino_tipo'];
const cards = [];
let n = 0;
for (const x of ativas) {
  const { T1, T2, T3, passos, sim, simTxt } = textos(x);
  const emailTipo = /gmail|hotmail|yahoo|sapo|outlook|live\./i.test(x.email) ? 'gratuito' : x.email ? 'proprio' : 'sem';
  const seq = [[1, 0, 'sempre', T1], [2, 3, 'sem clique nem resposta ao T1', T2], [3, 8, 'sem clique nem resposta ao T1 e T2', T3]];
  const blocos = [];
  for (const [t, dia, cond, T] of seq) {
    const r = render(x, t, T, { passos, sim, simTxt });
    const fh = path.join(OUT, `${x.restaurant_id}-T${t}.html`), ft = path.join(OUT, `${x.restaurant_id}-T${t}.txt`);
    fs.writeFileSync(fh, r.html); fs.writeFileSync(ft, r.txt); n++;
    manifesto.push([x.tier, x.segmento, x.restaurant_id, x.name, `T${t}`, dia, cond, T.assunto.replace(/;/g, ","), T.pre.replace(/;/g, ","), path.relative(RAIZ, fh).replace(/\\/g, '/'), path.relative(RAIZ, ft).replace(/\\/g, '/'), r.palavras, emailTipo].join(';'));
    blocos.push(`<div class="toque"><div class="meta">T${t} · dia ${dia} · ${esc(cond)} · ${r.palavras} palavras</div><div class="assunto">${esc(T.assunto)}</div><div class="pre">${esc(T.pre)}</div><pre>${esc(r.txt)}</pre><a class="abrir" href="emails/${x.restaurant_id}-T${t}.html">abrir HTML</a></div>`);
  }
  cards.push(`<section class="casa"><h2>${esc(x.name)} <small>${esc(x.tier)} · ${esc(x.segmento)} · ${esc(x.email)} (${emailTipo}) · ${x.p180} pedidos/180d · ${x.resp_propria180} respostas próprias</small></h2>${blocos.join('')}</section>`);
}
fs.writeFileSync(path.join(OUT, 'sequencia-manifesto.csv'), manifesto.join('\n') + '\n');
fs.writeFileSync(path.join(ST, 'revisao-sequencia-lagos.html'), `<!DOCTYPE html><html lang="pt"><head><meta charset="utf-8"><title>Revisão · sequência de e-mails · Lagos</title>
<style>body{font-family:Georgia,serif;color:#1d2029;background:#fff;margin:0;padding:24px;max-width:960px}h1{font-weight:normal}
.intro{font-family:Arial,sans-serif;font-size:13px;color:#5f5d6e;margin-bottom:20px}.casa{border-top:2px solid #9e7c48;padding:14px 0 18px}.casa h2{font-weight:normal;font-size:22px;margin:0 0 8px}.casa small{display:block;font-family:Arial,sans-serif;font-size:12px;color:#5f5d6e}
.toque{border:1px solid #d6cfbf;padding:10px 12px;margin:8px 0;background:#fbf9f4}.meta{font-family:Arial,sans-serif;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#9e7c48}.assunto{font-size:17px;margin:4px 0 2px}.pre{font-family:Arial,sans-serif;font-size:12px;color:#5f5d6e}
pre{white-space:pre-wrap;font-family:Arial,sans-serif;font-size:13px;line-height:1.5;margin:8px 0;color:#1d2029}.abrir{font-family:Arial,sans-serif;font-size:12px;color:#9e7c48}</style></head><body>
<h1>Sequência de e-mails · Lagos · revisão do fundador</h1>
<div class="intro">${ativas.length} casas × 3 toques = ${n / 1} e-mails (HTML + texto) · gerado em ${new Date().toISOString().slice(0, 10)} · T1 dia 0 · T2 dia 3 só sem clique/resposta · T3 dia 8 só sem clique/resposta · nunca um 4º · máx. 20/dia · opt-out consultado antes de cada envio · prova social calculada da lista: ${esc(lista(vizinhas))} · NADA foi enviado.</div>
${cards.join('\n')}
</body></html>`);
console.log(`e-mails gerados : ${n} (${ativas.length} casas × 3 toques) em orchestrator/state/lagos/emails/`);
console.log(`prova social    : ${lista(vizinhas)} (respostas próprias ≥2 em 180 d)`);
console.log(`revisão         : orchestrator/state/lagos/revisao-sequencia-lagos.html`);
console.log(`manifesto       : orchestrator/state/lagos/emails/sequencia-manifesto.csv`);
console.log('\nNADA foi enviado. Envio é outra etapa, com aprovação do fundador por lote.');
