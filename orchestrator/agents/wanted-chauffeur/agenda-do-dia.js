'use strict';
/**
 * Agenda do dia para o Julien (card T-20261116-0012) — monta a mensagem das 9:00 AM a partir da planilha de clientes.
 *
 * Uso:
 *   node orchestrator/agents/wanted-chauffeur/agenda-do-dia.js <clientes.csv> [--dia AAAA-MM-DD] [--ideia "texto"] [--hotel "nome"]
 *
 *   <clientes.csv>  exportação da aba "clientes" da planilha (Arquivo → Baixar → CSV). Colunas (cabeçalho obrigatório):
 *                   nome_da_reserva, whatsapp, hotel_ou_bairro, origem_do_pedido, produto, data, hora, codigo, resultado, observacao
 *   --dia           dia da agenda (padrão: hoje em Paris). Entram só as linhas com data = dia e resultado = confirmado.
 *   --ideia         em dia sem corrida, a ideia de vídeo do dia (quem escreve é o Julien ou o estúdio dele; aqui só se repassa).
 *   --hotel         em dia sem corrida, o hotel onde vale deixar o cartão.
 *
 * Saída: a mensagem pronta para colar no WhatsApp, em francês, com a hora em AM/PM e o valor pelo produto da tabela
 * aprovada em 16/11. NADA É ENVIADO: copiar e mandar é passo do Márlon. Nenhum dado sai desta máquina.
 *
 * Sem o arquivo ou sem a coluna certa, para com erro (falhar alto): uma agenda vazia por engano é pior que nenhuma.
 */
const fs = require('node:fs');

const PRECOS = { transfer: 80, 'mise à disposition': 90, 'night ride': 250, 'game night': 350, 'soirée': 390, soiree: 390 }; // € por carro; MAD é por hora (mín. 2 h)
const COLUNAS = ['nome_da_reserva', 'whatsapp', 'hotel_ou_bairro', 'origem_do_pedido', 'produto', 'data', 'hora', 'codigo', 'resultado', 'observacao'];
const RE_HORA = /^(1[0-2]|[1-9]):[0-5]\d (AM|PM)$/;

function lerCsv(texto) {
  const linhas = []; let campo = '', linha = [], aspas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (aspas) { if (c === '"' && texto[i + 1] === '"') { campo += '"'; i++; } else if (c === '"') aspas = false; else campo += c; continue; }
    if (c === '"') aspas = true;
    else if (c === ',') { linha.push(campo); campo = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && texto[i + 1] === '\n') i++; linha.push(campo); linhas.push(linha); linha = []; campo = ''; }
    else campo += c;
  }
  if (campo !== '' || linha.length) { linha.push(campo); linhas.push(linha); }
  const [cab, ...resto] = linhas.filter((l) => l.some((x) => x.trim() !== ''));
  const nomes = (cab || []).map((x) => x.trim().toLowerCase().replace(/^﻿/, ''));
  return { nomes, linhas: resto.map((l) => Object.fromEntries(nomes.map((n, i) => [n, (l[i] || '').trim()]))) };
}

function hojeParis() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function minutos(h) { const m = RE_HORA.exec(h); if (!m) return 9e9; let hh = Number(m[1]) % 12; if (m[2] === 'PM') hh += 12; return hh * 60 + Number(h.slice(h.indexOf(':') + 1, h.indexOf(':') + 3)); }

function diaLongoFr(iso) {
  const d = new Date(iso + 'T12:00:00Z');
  const j = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'][d.getUTCDay()];
  const m = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'][d.getUTCMonth()];
  return `${j} ${d.getUTCDate()} ${m}`;
}

function valor(produto, observacao) {
  const p = String(produto || '').toLowerCase().trim();
  if (!(p in PRECOS)) return null;
  if (p === 'mise à disposition') { const h = /(\d+)\s*h/i.exec(observacao || ''); const n = h ? Math.max(2, Number(h[1])) : 2; return `${90 * n} € (${n} h)`; }
  return `${PRECOS[p]} €${p === 'soirée' || p === 'soiree' ? ' + dîner' : ''}`;
}

function montar({ linhas, nomes }, { dia, ideia, hotel }) {
  const faltam = COLUNAS.filter((c) => !nomes.includes(c));
  if (faltam.length) throw new Error(`a planilha não tem as colunas: ${faltam.join(', ')} (cabeçalho esperado: ${COLUNAS.join(', ')})`);
  const avisos = [];
  const doDia = linhas.filter((l) => l.data === dia && /^confirmad/i.test(l.resultado));
  for (const l of doDia) if (!RE_HORA.test(l.hora)) avisos.push(`hora "${l.hora || '(vazia)'}" de ${l.nome_da_reserva || '(sem nome)'} não está em AM/PM; a linha entra por último`);
  doDia.sort((a, b) => minutos(a.hora) - minutos(b.hora));
  const pendentes = linhas.filter((l) => l.data === dia && !/^confirmad/i.test(l.resultado) && !/^(feito|perdido)/i.test(l.resultado));
  const out = [];
  out.push(`Bonjour Julien, agenda du ${diaLongoFr(dia)} :`);
  if (!doDia.length) {
    out.push('', 'Aucune course confirmée aujourd\'hui.');
    if (ideia) out.push('', `Idée de vidéo du jour : ${ideia}`);
    if (hotel) out.push(`Carte à déposer : ${hotel}`);
    if (!ideia && !hotel) avisos.push('dia sem corrida e sem --ideia nem --hotel: a mensagem fica só com a abertura');
  } else {
    out.push('');
    for (const l of doDia) {
      const v = valor(l.produto, l.observacao);
      if (!v) avisos.push(`produto "${l.produto}" de ${l.nome_da_reserva} não está na tabela aprovada; valor omitido`);
      const nome = l.nome_da_reserva || '(nom manquant)';
      if (!l.nome_da_reserva) avisos.push('corrida sem nome da reserva: o Julien precisa do nome de quem embarca');
      out.push(`${l.hora || '—'} · ${nome} · ${l.produto || '—'}${l.hotel_ou_bairro ? ' · ' + l.hotel_ou_bairro : ''}${l.origem_do_pedido ? ' · ' + l.origem_do_pedido : ''}${v ? ' · ' + v : ''}${l.codigo ? ' · ' + l.codigo : ''}`);
    }
    out.push('', `${doDia.length} course${doDia.length > 1 ? 's' : ''} confirmée${doDia.length > 1 ? 's' : ''}. Réponds « ok » quand tu as lu.`);
  }
  if (pendentes.length) out.push('', `À confirmer encore aujourd'hui : ${pendentes.map((l) => `${l.hora || '—'} ${l.nome_da_reserva || '?'} (${l.resultado || 'sans réponse'})`).join(' · ')}`);
  return { mensagem: out.join('\n'), corridas: doDia.length, pendentes: pendentes.length, avisos, linhas_do_dia: doDia };
}

/**
 * Versão compacta, em UMA linha, para o aviso pela Aria (template de WhatsApp: a Meta não aceita quebra de linha e a
 * Aria corta em 300 caracteres). Mesma regra de seleção da montar(). Se não couber, diz quantas faltam.
 */
function montarCompacta(csv, { dia, max = 290 } = {}) {
  const r = montar(csv, { dia });
  const cab = `Agenda du ${diaLongoFr(dia)}`;
  if (!r.corridas) return { ...r, compacta: `${cab} : aucune course confirmée.` };
  // sem a origem e sem o código: cabem na folha, não no aviso de 300 caracteres
  const itens = r.linhas_do_dia.map((l) => [l.hora || '—', l.nome_da_reserva || '(nom manquant)', l.produto || '—', l.hotel_ou_bairro, valor(l.produto, l.observacao)].filter(Boolean).join(' · '));
  let out = `${cab} : `; let n = 0;
  for (const it of itens) { const cand = out + (n ? ' | ' : '') + it; if (cand.length > max - 24 && n) break; out = cand; n++; }
  if (n < itens.length) out += ` | +${itens.length - n} autre(s), voir la feuille`;
  if (r.pendentes) out += ` | ${r.pendentes} à confirmer`;
  return { ...r, compacta: out.slice(0, max) };
}

function main(argv) {
  const args = argv.slice(2);
  const arq = args.find((a) => !a.startsWith('--'));
  const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
  if (!arq) { console.error('uso: node agenda-do-dia.js <clientes.csv> [--dia AAAA-MM-DD] [--ideia "…"] [--hotel "…"]'); process.exit(2); }
  if (!fs.existsSync(arq)) { console.error(`arquivo não encontrado: ${arq}`); process.exit(2); }
  const dia = opt('--dia') || hojeParis();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) { console.error('--dia no formato AAAA-MM-DD'); process.exit(2); }
  let r;
  try { r = montar(lerCsv(fs.readFileSync(arq, 'utf8')), { dia, ideia: opt('--ideia'), hotel: opt('--hotel') }); }
  catch (e) { console.error(`ERRO: ${e.message}`); process.exit(1); }
  console.log(r.mensagem);
  console.log('');
  console.log(`--- ${r.corridas} corrida(s) confirmada(s), ${r.pendentes} por confirmar. Copiar a mensagem acima e mandar ao Julien pelo WhatsApp. Nada foi enviado.`);
  for (const a of r.avisos) console.log(`AVISO: ${a}`);
}

if (require.main === module) main(process.argv);
module.exports = { lerCsv, montar, montarCompacta, valor, diaLongoFr, hojeParis, COLUNAS };
