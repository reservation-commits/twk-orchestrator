'use strict';
/**
 * Guardião da Reserva — núcleo determinístico (função pura, sem I/O, sem LLM).
 *
 * avaliar(entrada) → { decisoes, propostas, contagens, anomalias, bloqueada }
 *
 * Degraus (spec §2/§5, `docs/agentes/agente-guardiao-reserva.md`):
 *   D0  plataforma/n8n: aviso + lembretes 6h/12h — o Guardião NÃO repete.
 *   1   ≥24h sem resposta → e-mail-template ao restaurante (lote diário, aprovação humana)
 *   2   ≥48h sem resposta OU mesa ≤72h → fila WhatsApp (humano)
 *   3   mesa ≤48h → WhatsApp URGENTE em texto (humano) — mesma fila do degrau 2, com prioridade
 *   4   mesa ≤ d4_mesa_horas (36h por suposição de SLA humano 12h) → mensagem ao cliente (via Aria, aprovação unitária)
 *   5   mesa passou → vencida (pg_cron expira; desculpas = humano)
 * Regras duras (código): opt-out/published=false/do_not_relist → nunca contata restaurante;
 * registro indisponível → execução inteira bloqueada; máx. 2 contatos ao restaurante por reserva;
 * 1 e-mail por restaurante por 24h (agrupa reservas); rate limit diário; janela de horário local.
 */

const IDIOMA_POR_PAIS = {
  portugal: 'pt', brazil: 'pt', brasil: 'pt',
  france: 'fr', monaco: 'fr', belgium: 'fr', morocco: 'fr', tunisia: 'fr', switzerland: 'fr',
  italy: 'it', italia: 'it',
  spain: 'es', espana: 'es', argentina: 'es', mexico: 'es', chile: 'es', colombia: 'es', peru: 'es', uruguay: 'es',
};

const CONFIG_PADRAO = {
  d1_horas: 24, d2_horas: 48, d2_mesa_horas: 72, d3_mesa_horas: 48, d4_mesa_horas: 36, d4_min_pedido_horas: 12,
  maxContatosPorReserva: 2, cooldownRestauranteHoras: 24, maxEmailsDia: 50, maxReservasEsperadas: 500,
  janelaLocal: [8, 22], incluirParceiros: true, cidadesCanario: null, // Set de cidades (lowercase) ou null = todas
};

const H = 3_600_000;

// ---- utilidades de fuso (sem dependências) ----
function offsetMinutos(tz, dateUtc) {
  try {
    const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const p = Object.fromEntries(f.formatToParts(dateUtc).map((x) => [x.type, x.value]));
    const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
    return Math.round((asUtc - dateUtc.getTime()) / 60000);
  } catch { return null; }
}
/** Converte data+hora locais (na tz) para instante UTC. */
function localParaUtc(dataISO, horaHHMM, tz) {
  const [y, m, d] = String(dataISO).slice(0, 10).split('-').map(Number);
  const [hh, mm] = String(horaHHMM || '00:00').split(':').map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d, hh, mm || 0));
  const off = offsetMinutos(tz, guess);
  if (off === null) return null;
  const first = new Date(guess.getTime() - off * 60000);
  const off2 = offsetMinutos(tz, first);
  return off2 === off ? first : new Date(guess.getTime() - off2 * 60000);
}
function horaLocal(tz, dateUtc) {
  const off = offsetMinutos(tz, dateUtc);
  if (off === null) return null;
  return new Date(dateUtc.getTime() + off * 60000).getUTCHours();
}
function idiomaDe(pais) {
  const k = String(pais || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  return IDIOMA_POR_PAIS[k] || 'en';
}

// ---- núcleo ----
function avaliar(entrada) {
  const cfg = { ...CONFIG_PADRAO, ...(entrada.config || {}) };
  const agora = entrada.agora instanceof Date ? entrada.agora : new Date(entrada.agora);
  const reservas = entrada.reservas || [];
  const restaurantes = entrada.restaurantes || {};
  const bloqueios = entrada.bloqueios || {};
  const mortos = entrada.contatosMortos || new Set();
  const eventos = entrada.eventos || [];
  const anomalias = [];
  const decisoes = [];
  const contagens = { avaliadas: reservas.length, email_restaurante: 0, fila_whatsapp: 0, fila_whatsapp_urgente: 0, mensagem_cliente: 0, aguardar: 0, bloqueado: 0, vencida: 0, fora_janela: 0, fora_canario: 0, cooldown: 0 };

  if (!bloqueios.registroDisponivel) {
    return { bloqueada: true, motivo: 'registro de opt-out indisponível — fail-closed: nenhum contato proposto', decisoes: [], propostas: vazio(), contagens, anomalias: ['registro_indisponivel'] };
  }
  if (reservas.length > cfg.maxReservasEsperadas) {
    return { bloqueada: true, motivo: `volume anômalo: ${reservas.length} reservas (> ${cfg.maxReservasEsperadas})`, decisoes: [], propostas: vazio(), contagens, anomalias: ['volume_anomalo'] };
  }

  // Índices de eventos anteriores (só o que contou como contato real).
  const CONTA = new Set(['enviado', 'fila_criada', 'aprovado']);
  const porReserva = new Map(); // code -> [eventos]
  const ultimoEmailRestaurante = new Map(); // rid -> ts
  for (const e of eventos) {
    if (!CONTA.has(e.decisao)) continue;
    if (!porReserva.has(e.reservation_code)) porReserva.set(e.reservation_code, []);
    porReserva.get(e.reservation_code).push(e);
    if (e.acao === 'email_restaurante') {
      const t = Date.parse(e.ts);
      if (!ultimoEmailRestaurante.has(e.restaurant_id) || t > ultimoEmailRestaurante.get(e.restaurant_id)) ultimoEmailRestaurante.set(e.restaurant_id, t);
    }
  }

  const emailsPorRestaurante = new Map(); // rid -> decisões de e-mail (agrupamento)
  const fila = [];
  const clientes = [];

  for (const r of reservas) {
    const rest = restaurantes[String(r.restaurant_id)];
    const base = { reservation_code: r.reservation_code, restaurant_id: String(r.restaurant_id), degrau: null, acao: 'aguardar', canal: null, motivo: '', idioma: 'en', fuso_suposto: false };
    if (!rest) { decisoes.push({ ...base, acao: 'bloqueado', motivo: 'restaurante não encontrado no catálogo' }); contagens.bloqueado++; anomalias.push(`reserva ${r.reservation_code}: restaurante ${r.restaurant_id} ausente`); continue; }

    const tz = rest.timezone || 'Europe/Paris';
    base.fuso_suposto = !rest.timezone;
    base.idioma = idiomaDe(rest.country);
    const mesaUtc = localParaUtc(r.booking_date, r.reservation_time, tz);
    if (!mesaUtc) { decisoes.push({ ...base, acao: 'bloqueado', motivo: `fuso inválido: ${tz}` }); contagens.bloqueado++; anomalias.push(`reserva ${r.reservation_code}: fuso ${tz}`); continue; }
    const hAteMesa = (mesaUtc.getTime() - agora.getTime()) / H;
    const hDesdePedido = (agora.getTime() - Date.parse(r.created_date)) / H;
    Object.assign(base, { horas_ate_mesa: Math.round(hAteMesa), horas_desde_pedido: Math.round(hDesdePedido) });

    if (hAteMesa < 0) { decisoes.push({ ...base, degrau: 5, acao: 'vencida', motivo: 'mesa já passou — pg_cron expira; desculpas ao cliente = humano' }); contagens.vencida++; continue; }
    if (cfg.cidadesCanario && !cfg.cidadesCanario.has(String(rest.city || '').toLowerCase())) { decisoes.push({ ...base, acao: 'fora_canario', motivo: `cidade fora do canário: ${rest.city}` }); contagens.fora_canario++; continue; }
    if (!cfg.incluirParceiros && rest.partner) { decisoes.push({ ...base, acao: 'aguardar', motivo: 'parceiro — coberto pelo fulfillment do CLAVIS' }); contagens.aguardar++; continue; }

    const anteriores = porReserva.get(r.reservation_code) || [];
    const contatosRestaurante = anteriores.filter((e) => ['email_restaurante', 'fila_whatsapp', 'fila_whatsapp_urgente'].includes(e.acao)).length;
    const jaCliente = anteriores.some((e) => e.acao === 'mensagem_cliente');
    const ja = (acao) => anteriores.some((e) => e.acao === acao);

    // Bloqueio de contato ao restaurante (código, não prompt).
    let semRestaurante = null;
    const bl = bloqueios.porRestaurante ? bloqueios.porRestaurante(base.restaurant_id) : null;
    if (bl && bl.bloqueado) semRestaurante = bl.motivo;
    else if (rest.published === false) semRestaurante = 'published=false — casa fora da listagem, não repassar solicitações';
    else if (rest.do_not_relist) semRestaurante = 'do_not_relist';

    if (semRestaurante) {
      if (!jaCliente) { decisoes.push({ ...base, degrau: 4, acao: 'mensagem_cliente', canal: 'aria', motivo: `sem contato ao restaurante (${semRestaurante}) → cliente avisado com alternativas` }); contagens.mensagem_cliente++; clientes.push(decisoes[decisoes.length - 1]); }
      else { decisoes.push({ ...base, acao: 'aguardar', motivo: `cliente já avisado; ${semRestaurante}` }); contagens.aguardar++; }
      continue;
    }

    // Degrau 4 — cliente (prioridade sobre qualquer contato ao restaurante quando a mesa está próxima).
    if (hAteMesa <= cfg.d4_mesa_horas && hDesdePedido >= cfg.d4_min_pedido_horas && !jaCliente) {
      decisoes.push({ ...base, degrau: 4, acao: 'mensagem_cliente', canal: 'aria', motivo: `mesa em ${Math.round(hAteMesa)}h sem resposta → verdade + alternativas` });
      contagens.mensagem_cliente++; clientes.push(decisoes[decisoes.length - 1]);
      continue;
    }
    if (hDesdePedido < cfg.d1_horas) { decisoes.push({ ...base, acao: 'aguardar', motivo: `pedido há ${Math.round(hDesdePedido)}h — n8n cobre D0/6h/12h` }); contagens.aguardar++; continue; }
    if (contatosRestaurante >= cfg.maxContatosPorReserva) { decisoes.push({ ...base, acao: 'aguardar', motivo: `máximo de ${cfg.maxContatosPorReserva} contatos ao restaurante atingido` }); contagens.aguardar++; continue; }

    const emailVivo = rest.tem_email && !mortos.has(base.restaurant_id);
    const hl = horaLocal(tz, agora);
    const dentroJanela = hl !== null && hl >= cfg.janelaLocal[0] && hl < cfg.janelaLocal[1];

    // Degrau 3 — WhatsApp urgente, em texto. NÃO é ligação: o time não fala os idiomas das casas
    // (decisão do fundador, 2026-09-06). Voz saiu do sistema; texto no idioma da casa é o canal.
    if (hAteMesa <= cfg.d3_mesa_horas && !ja('fila_whatsapp_urgente')) {
      if (rest.tem_telefone) { decisoes.push({ ...base, degrau: 3, acao: 'fila_whatsapp_urgente', canal: 'whatsapp', motivo: `mesa em ${Math.round(hAteMesa)}h — mensagem urgente` }); contagens.fila_whatsapp_urgente++; fila.push(decisoes[decisoes.length - 1]); }
      else { decisoes.push({ ...base, degrau: 4, acao: 'mensagem_cliente', canal: 'aria', motivo: 'sem WhatsApp e mesa em ≤48h → cliente avisado' }); contagens.mensagem_cliente++; clientes.push(decisoes[decisoes.length - 1]); }
      continue;
    }
    // Degrau 2 — WhatsApp (humano). Só depois do e-mail (ou e-mail morto), ou com a mesa a ≤72h.
    // Pendência antiga nunca tocada pelo Guardião começa pelo e-mail: fila humana é escassa.
    const precisaPularD1 = !emailVivo;
    const d2 = (ja('email_restaurante') && hDesdePedido >= cfg.d2_horas) || hAteMesa <= cfg.d2_mesa_horas;
    if ((d2 || precisaPularD1) && !ja('fila_whatsapp')) {
      if (rest.tem_telefone) { decisoes.push({ ...base, degrau: 2, acao: 'fila_whatsapp', canal: 'whatsapp', motivo: precisaPularD1 ? 'e-mail morto/ausente → direto ao WhatsApp' : `sem resposta há ${Math.round(hDesdePedido)}h` }); contagens.fila_whatsapp++; fila.push(decisoes[decisoes.length - 1]); continue; }
      if (precisaPularD1) { decisoes.push({ ...base, degrau: 4, acao: 'mensagem_cliente', canal: 'aria', motivo: 'sem canal vivo (e-mail morto, sem WhatsApp) → cliente avisado' }); contagens.mensagem_cliente++; clientes.push(decisoes[decisoes.length - 1]); continue; }
    }
    // Degrau 1 — e-mail template.
    if (!ja('email_restaurante') && emailVivo) {
      if (!dentroJanela) { decisoes.push({ ...base, degrau: 1, acao: 'fora_janela', motivo: `hora local ${hl}h fora de ${cfg.janelaLocal.join('–')}h` }); contagens.fora_janela++; continue; }
      const ult = ultimoEmailRestaurante.get(base.restaurant_id);
      if (ult && agora.getTime() - ult < cfg.cooldownRestauranteHoras * H) { decisoes.push({ ...base, degrau: 1, acao: 'cooldown', motivo: 'restaurante recebeu e-mail nas últimas 24h' }); contagens.cooldown++; continue; }
      const d = { ...base, degrau: 1, acao: 'email_restaurante', canal: 'email', motivo: `sem resposta há ${Math.round(hDesdePedido)}h` };
      decisoes.push(d);
      if (!emailsPorRestaurante.has(base.restaurant_id)) emailsPorRestaurante.set(base.restaurant_id, []);
      emailsPorRestaurante.get(base.restaurant_id).push(d);
      continue;
    }
    decisoes.push({ ...base, acao: 'aguardar', motivo: 'nenhum degrau aplicável agora' }); contagens.aguardar++;
  }

  // Agrupar e-mails por restaurante (1 e-mail/dia/restaurante) + rate limit.
  const emails = [];
  for (const [rid, ds] of emailsPorRestaurante) {
    if (emails.length >= cfg.maxEmailsDia) { ds.forEach((d) => { d.acao = 'bloqueado'; d.motivo = 'rate limit diário de e-mails'; contagens.bloqueado++; }); anomalias.push('rate_limit_emails'); continue; }
    const rest = restaurantes[rid];
    emails.push({ restaurant_id: rid, nome: rest.name, idioma: ds[0].idioma, reservas: ds.map((d) => ({ reservation_code: d.reservation_code, horas_ate_mesa: d.horas_ate_mesa })), decisoes: ds });
    contagens.email_restaurante += ds.length;
  }
  if (anomalias.includes('rate_limit_emails')) anomalias.push(`rate limit: ${cfg.maxEmailsDia} e-mails/dia atingido`);

  fila.sort((a, b) => a.horas_ate_mesa - b.horas_ate_mesa);
  clientes.sort((a, b) => a.horas_ate_mesa - b.horas_ate_mesa);
  return { bloqueada: false, decisoes, propostas: { emails, fila, clientes }, contagens, anomalias };
}

function vazio() { return { emails: [], fila: [], clientes: [] }; }

module.exports = { avaliar, CONFIG_PADRAO, localParaUtc, horaLocal, idiomaDe, offsetMinutos };
