'use strict';
/**
 * Disponibilidade de datas e horários do Wanted Chauffeur (22/11/2026).
 *
 * Um carro, um motorista: um horário está livre quando a corrida pedida, com a folga antes e depois, não encosta em
 * nenhuma corrida CONFIRMADA nem num bloqueio do Julien (folga, manutenção, viagem). Pedidos ainda sem resposta não
 * ocupam a agenda: dois clientes podem pedir o mesmo horário, e o Julien escolhe.
 *
 * Tudo em hora de Paris (relógio de parede), em minutos desde a meia-noite, para casar com o seletor da página
 * ("9:00 PM" = 1260). Uma corrida que passa da meia-noite ocupa o fim de um dia e o começo do seguinte.
 *
 * Fonte: as reservas (reservas.js) e os bloqueios (bloqueios.json no mesmo diretório). Nada de terceiros.
 * A resposta pública não diz POR QUE um horário está ocupado (nem nome, nem motivo do bloqueio): só "ocupado".
 *
 * Ajustes (ambiente da Central), todos com padrão:
 *   CHAUFFEUR_FOLGA_MIN=30          minutos livres antes e depois de cada corrida confirmada
 *   CHAUFFEUR_ANTECEDENCIA_MIN=120  pedido só a partir de agora + 2 h
 *   CHAUFFEUR_HORIZONTE_DIAS=90     até quantos dias à frente se pode pedir
 *   CHAUFFEUR_DURACOES="transfer=90,night=60,game=180,soiree=300"  minutos que cada produto ocupa (MAD = horas × 60)
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { instanteParis } = require('./cliente.js');
const { RE_HORA, PRODUTOS } = require('./reservas.js');

const DURACOES_PADRAO = { transfer: 90, mad: 120, night: 60, game: 180, soiree: 300 };
const RE_DATA = /^\d{4}-\d{2}-\d{2}$/;
const DIA_MIN = 1440;

function config(env = process.env) {
  const n = (k, padrao, min, max) => { const v = Number(env[k]); return Number.isFinite(v) && v >= min && v <= max ? Math.round(v) : padrao; };
  const duracoes = { ...DURACOES_PADRAO };
  for (const par of String(env.CHAUFFEUR_DURACOES || '').split(',')) {
    const [k, v] = par.split('=').map((s) => s && s.trim());
    if (PRODUTOS.includes(k) && Number(v) >= 15 && Number(v) <= 720) duracoes[k] = Math.round(Number(v));
  }
  return {
    folga: n('CHAUFFEUR_FOLGA_MIN', 30, 0, 240),
    antecedencia: n('CHAUFFEUR_ANTECEDENCIA_MIN', 120, 0, 2880),
    horizonte: n('CHAUFFEUR_HORIZONTE_DIAS', 90, 1, 365),
    duracoes,
  };
}

/** Minutos que a corrida ocupa. Mise à disposition: as horas pedidas (mínimo 2). */
function duracao(produto, horas, cfg = config()) {
  if (produto === 'mad') return Math.max(2, Number(horas) || 2) * 60;
  return cfg.duracoes[produto] || 60;
}

// ---------------------------------------------------------------- relógio de Paris
const fmtParis = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
/** Instante (ms) → { data: 'AAAA-MM-DD', min: minutos desde a meia-noite em Paris }. */
function paris(ms) {
  const o = Object.fromEntries(fmtParis.formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  return { data: `${o.year}-${o.month}-${o.day}`, min: (Number(o.hour) % 24) * 60 + Number(o.minute) };
}
function somarDias(iso, n) { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function horaParaMin(h) { const m = RE_HORA.exec(h || ''); if (!m) return null; let hh = Number(m[1]) % 12; if (m[2] === 'PM') hh += 12; return hh * 60 + Number(h.slice(h.indexOf(':') + 1, h.indexOf(':') + 3)); }
function minParaHora(min) { const h = Math.floor(min / 60) % 24, m = min % 60; return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; }

/** Espalha um intervalo de instantes [ini, fim) pelos dias de Paris que ele toca: { 'AAAA-MM-DD': [[a, b], …] }. */
function espalhar(ini, fim, mapa) {
  if (!(fim > ini)) return mapa;
  const a = paris(ini), b = paris(fim);
  const add = (d, x, y) => { if (y > x) (mapa[d] ||= []).push([x, y]); };
  if (a.data === b.data) { add(a.data, a.min, b.min); return mapa; }
  add(a.data, a.min, DIA_MIN);
  for (let d = somarDias(a.data, 1); d < b.data; d = somarDias(d, 1)) add(d, 0, DIA_MIN);
  add(b.data, 0, b.min);
  return mapa;
}
/** Junta intervalos que se tocam ou se sobrepõem. */
function juntar(lista) {
  const s = [...lista].sort((x, y) => x[0] - y[0]); const out = [];
  for (const [a, b] of s) { const u = out[out.length - 1]; if (u && a <= u[1]) u[1] = Math.max(u[1], b); else out.push([a, b]); }
  return out;
}

// ---------------------------------------------------------------- bloqueios do Julien
function arquivoBloqueios(dir) { return path.join(dir, 'bloqueios.json'); }
function lerBloqueios(dir) { try { const j = JSON.parse(fs.readFileSync(arquivoBloqueios(dir), 'utf8')); return Array.isArray(j) ? j : []; } catch { return []; } }
function gravarBloqueios(dir, lista) { fs.mkdirSync(dir, { recursive: true }); const f = arquivoBloqueios(dir); fs.writeFileSync(f + '.tmp', JSON.stringify(lista, null, 1), 'utf8'); fs.renameSync(f + '.tmp', f); }

/**
 * Bloqueio: { data, ate_data?, de?, ate?, motivo? }. Sem `de`/`ate`: o dia inteiro (ou de `data` a `ate_data`).
 * Com `de`/`ate` (AM/PM): só aquela faixa, num dia só. Devolve { status, bloqueio | erro }.
 */
function adicionarBloqueio(dir, corpo, { agora = Date.now(), por = null } = {}) {
  const data = String(corpo && corpo.data || '').trim();
  const ateData = corpo && corpo.ate_data ? String(corpo.ate_data).trim() : data;
  if (!RE_DATA.test(data) || !RE_DATA.test(ateData)) return { status: 400, erro: 'data (e ate_data) no formato AAAA-MM-DD' };
  if (ateData < data) return { status: 400, erro: 'ate_data antes de data' };
  if (somarDias(data, 62) < ateData) return { status: 400, erro: 'no máximo 62 dias por bloqueio' };
  const de = corpo.de ? String(corpo.de).trim().toUpperCase() : null;
  const ate = corpo.ate ? String(corpo.ate).trim().toUpperCase() : null;
  if (!!de !== !!ate) return { status: 400, erro: 'informe de e ate juntos (ou nenhum, para o dia inteiro)' };
  if (de && (horaParaMin(de) == null || horaParaMin(ate) == null)) return { status: 400, erro: 'de e ate em AM/PM, passos de 5 min (ex.: 2:00 PM)' };
  if (de && ateData !== data) return { status: 400, erro: 'faixa de horário só vale para um dia' };
  if (de && horaParaMin(ate) <= horaParaMin(de)) return { status: 400, erro: 'ate depois de de' };
  const motivo = corpo.motivo ? String(corpo.motivo).replace(/\s+/g, ' ').trim().slice(0, 120) : null;
  const b = { id: 'BLQ-' + crypto.randomBytes(4).toString('hex'), data, ate_data: ateData, de, ate, motivo, por, criado_em: new Date(agora).toISOString() };
  const lista = lerBloqueios(dir); lista.push(b); gravarBloqueios(dir, lista);
  return { status: 201, bloqueio: b };
}
function removerBloqueio(dir, id) {
  const lista = lerBloqueios(dir); const resto = lista.filter((b) => b.id !== id);
  if (resto.length === lista.length) return { status: 404, erro: `${id} não existe` };
  gravarBloqueios(dir, resto); return { status: 200, ok: true, id };
}

// ---------------------------------------------------------------- a agenda
/**
 * Ocupação de `dias` dias a partir de `de` (Paris). Devolve, por dia: { data, fechado, ocupado: [[ini, fim], …] em
 * minutos }. `fechado` = o dia inteiro indisponível (bloqueio, fora do horizonte, ou já passou).
 * `interno: true` inclui o código das corridas e o motivo dos bloqueios (só para o painel, com chave).
 */
async function ocupacao({ store, dir, de, dias = 14, agora = Date.now(), env = process.env, interno = false }) {
  const cfg = config(env);
  const hoje = paris(agora).data;
  const inicio = RE_DATA.test(de || '') ? de : hoje;
  const n = Math.max(1, Math.min(62, Number(dias) || 14));
  const fimFaixa = somarDias(inicio, n);
  const mapa = {}; const detalhes = {};

  // corridas confirmadas (a partir do dia anterior, porque uma corrida da véspera pode passar da meia-noite)
  const confirmadas = await store.porStatus('confirmado', { desde: somarDias(inicio, -1) });
  for (const r of confirmadas) {
    const t0 = instanteParis(r.data, r.hora); if (!t0) continue;
    const dur = duracao(r.produto, r.horas, cfg);
    const ini = t0 - cfg.folga * 60_000, fim = t0 + (dur + cfg.folga) * 60_000;
    espalhar(ini, fim, mapa);
    if (interno) (detalhes[r.data] ||= []).push({ tipo: 'corrida', codigo: r.codigo, hora: r.hora, minutos: dur });
  }
  // bloqueios
  for (const b of lerBloqueios(dir)) {
    if (b.ate_data < somarDias(inicio, -1) || b.data > fimFaixa) continue;
    if (b.de) { const ini = instanteParis(b.data, b.de), fim = instanteParis(b.data, b.ate); if (ini && fim) espalhar(ini, fim, mapa); }
    else { const ini = instanteParis(b.data, '12:00 AM'), fim = instanteParis(somarDias(b.ate_data, 1), '12:00 AM'); if (ini && fim) espalhar(ini, fim, mapa); }
    if (interno) for (let d = b.data; d <= b.ate_data; d = somarDias(d, 1)) (detalhes[d] ||= []).push({ tipo: 'bloqueio', id: b.id, de: b.de, ate: b.ate, motivo: b.motivo });
  }
  // antecedência: nada antes de agora + antecedência
  espalhar(instanteParis(hoje, '12:00 AM'), agora + cfg.antecedencia * 60_000, mapa);

  const limite = somarDias(hoje, cfg.horizonte);
  const out = [];
  for (let d = inicio; d < fimFaixa; d = somarDias(d, 1)) {
    const ocupado = juntar(mapa[d] || []);
    const fechado = d < hoje || d > limite || (ocupado.length === 1 && ocupado[0][0] === 0 && ocupado[0][1] >= DIA_MIN);
    const dia = { data: d, fechado, ocupado: fechado ? [[0, DIA_MIN]] : ocupado };
    if (interno && detalhes[d]) dia.detalhes = detalhes[d];
    out.push(dia);
  }
  return {
    fuso: 'Europe/Paris', agora: new Date(agora).toISOString(), hoje, primeiro_dia: inicio, horizonte: limite,
    antecedencia_min: cfg.antecedencia, folga_min: cfg.folga, duracoes_min: cfg.duracoes, passo_min: 5,
    dias: out,
  };
}

/** O horário [min, min + dur) está livre em `agenda` (resposta de ocupacao)? Confere o dia seguinte se passar da meia-noite. */
function livre(agenda, data, min, dur) {
  const dia = (d) => agenda.dias.find((x) => x.data === d);
  const choca = (lista, a, b) => (lista || []).some(([x, y]) => a < y && b > x);
  const d0 = dia(data); if (!d0 || d0.fechado) return false;
  if (choca(d0.ocupado, min, Math.min(min + dur, DIA_MIN))) return false;
  if (min + dur > DIA_MIN) { const d1 = dia(somarDias(data, 1)); if (d1 && choca(d1.ocupado, 0, min + dur - DIA_MIN)) return false; }
  return true;
}

/**
 * Conferência do servidor antes de gravar uma reserva vinda da página. Devolve null se pode, ou { motivo, mensagem }.
 * Sem data ou hora: não confere (a rota antiga do protótipo manda sem). Erro ao calcular: deixa passar e quem chama registra.
 */
async function conferir({ store, dir, reserva, agora = Date.now(), env = process.env }) {
  if (!reserva.data || !reserva.hora) return null;
  const cfg = config(env);
  const hoje = paris(agora).data;
  if (reserva.data < hoje) return { motivo: 'passado', mensagem: 'data no passado' };
  if (reserva.data > somarDias(hoje, cfg.horizonte)) return { motivo: 'horizonte', mensagem: `só até ${cfg.horizonte} dias à frente` };
  const agenda = await ocupacao({ store, dir, de: reserva.data, dias: 2, agora, env });
  const min = horaParaMin(reserva.hora);
  if (agenda.dias[0].fechado) return { motivo: 'dia_fechado', mensagem: 'dia indisponível' };
  const t0 = instanteParis(reserva.data, reserva.hora);
  if (t0 && t0 < agora + cfg.antecedencia * 60_000) return { motivo: 'antecedencia', mensagem: `pedido com pelo menos ${cfg.antecedencia} min de antecedência` };
  if (!livre(agenda, reserva.data, min, duracao(reserva.produto, reserva.horas, cfg))) return { motivo: 'ocupado', mensagem: 'horário já ocupado' };
  return null;
}

module.exports = { config, duracao, ocupacao, livre, conferir, paris, somarDias, horaParaMin, minParaHora, espalhar, juntar, lerBloqueios, adicionarBloqueio, removerBloqueio, DURACOES_PADRAO };
