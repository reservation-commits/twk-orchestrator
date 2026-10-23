'use strict';
/**
 * Sala do WhatsApp — leitura ao vivo do canal (conversas, entregas, funil, casas, clientes, qualidade, escalações).
 *
 * Somente leitura (twk_ro, regencia/db.js) + o /health público da Aria. Cache curto (30 s) porque a página se
 * atualiza sozinha; a conversa aberta é lida na hora. Identificadores saem SEMPRE mascarados (whatsapp-regras.js):
 * a página é da operação, atrás da chave da Central, e ainda assim ninguém precisa do número inteiro para ler.
 *
 *   GET /api/whatsapp              → instantâneo (cache 30 s; ?fresco=1 renova)
 *   GET /api/whatsapp/conversa?id= → a conversa inteira (últimas 80 mensagens, ferramentas, notas do juiz, retenções)
 */
const db = require('./regencia/db.js');
const R = require('./whatsapp-regras.js');

const TTL_MS = Number(process.env.WHATSAPP_CACHE_MS || 30_000);
const ARIA_URL = process.env.AGENT_ARIA_URL || 'https://theworldkeys-aria-whatsapp-agent.xis4ee.easypanel.host';

let cache = null;
let emCurso = null;
const agora = () => new Date().toISOString();

async function saudeAria() {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 6000);
  try {
    const r = await fetch(`${ARIA_URL.replace(/\/$/, '')}/health`, { signal: ctrl.signal });
    if (!r.ok) return { ok: false, http: r.status };
    const j = await r.json();
    return { ok: true, build: j.build, startedAt: j.startedAt, uptimeSeconds: j.uptimeSeconds, etapas: j.etapas || {}, notificacoes: j.notificacoes || null };
  } catch (e) { return { ok: false, erro: String(e && e.message || e).slice(0, 120) }; }
  finally { clearTimeout(t); }
}

async function lerBanco() {
  const EX = db.sqlExcluidos();
  return db.comCliente(async (c) => {
    const q = async (sql, params = []) => (await c.query(sql, params)).rows;
    const [pulso, pulso24, kpi7, kpi30, resp30, funil, entregas, ultimasEntregas, timeline, conversas, casas, clientes, clientesLista, qualidadeSemanas, qualidadeUltimas, escAbertas, escFechadas, compromissos, proximos, ferramentas, custo, pendencias] = await Promise.all([
      q(`SELECT checked_at, db_ok, db_latency_ms, whatsapp_ok, whatsapp_latency_ms, anthropic_ok, overall_ok FROM public.aria_health_checks ORDER BY checked_at DESC LIMIT 1`),
      q(`SELECT count(*)::int checks, count(*) FILTER (WHERE NOT overall_ok)::int falhas, round(avg(db_latency_ms))::int db_ms, round(avg(whatsapp_latency_ms))::int wa_ms FROM public.aria_health_checks WHERE checked_at >= now() - interval '24 hours'`),
      q(`SELECT count(*) FILTER (WHERE direction='inbound')::int recebidas, count(*) FILTER (WHERE direction='outbound')::int respondidas, count(DISTINCT chat_id)::int conversas, count(DISTINCT chat_id) FILTER (WHERE chat_id NOT LIKE 'email:%')::int conversas_wa FROM public.aria_messages WHERE created_at >= now() - interval '7 days'`),
      q(`SELECT count(*) FILTER (WHERE direction='inbound')::int recebidas, count(*) FILTER (WHERE direction='outbound')::int respondidas, count(DISTINCT chat_id)::int conversas, count(DISTINCT chat_id) FILTER (WHERE chat_id NOT LIKE 'email:%')::int conversas_wa FROM public.aria_messages WHERE created_at >= now() - interval '30 days'`),
      q(`WITH m AS (SELECT chat_id, direction, created_at, lead(direction) OVER (PARTITION BY chat_id ORDER BY created_at) nd, lead(created_at) OVER (PARTITION BY chat_id ORDER BY created_at) nt FROM public.aria_messages WHERE created_at >= now() - interval '30 days' AND chat_id NOT LIKE 'email:%')
          SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (nt - created_at))) med_s, percentile_cont(0.9) WITHIN GROUP (ORDER BY extract(epoch FROM (nt - created_at))) p90_s, count(*)::int n FROM m WHERE direction='inbound' AND nd='outbound'`),
      q(`SELECT evento, desfecho, motivo, count(*)::int n FROM public.aria_outbound_log WHERE created_at >= now() - interval '30 days' GROUP BY 1,2,3`),
      q(`SELECT template, status, count(*)::int n FROM public.aria_delivery_status WHERE sent_at >= now() - interval '30 days' GROUP BY 1,2`),
      q(`SELECT template, locale, destinatario, evento, status, error_title, sent_at, status_at, reservation_code FROM public.aria_delivery_status ORDER BY sent_at DESC LIMIT 20`),
      q(`WITH d AS (SELECT generate_series((now() - interval '13 days')::date, now()::date, '1 day')::date dia),
               m AS (SELECT created_at::date dia, count(*) FILTER (WHERE direction='inbound')::int recebidas, count(*) FILTER (WHERE direction='outbound')::int respondidas FROM public.aria_messages WHERE created_at >= now() - interval '14 days' GROUP BY 1),
               o AS (SELECT created_at::date dia, count(*)::int tentativas, count(*) FILTER (WHERE desfecho='enviado')::int enviados FROM public.aria_outbound_log WHERE created_at >= now() - interval '14 days' GROUP BY 1),
               f AS (SELECT sent_at::date dia, count(*)::int falhas FROM public.aria_delivery_status WHERE status='failed' AND sent_at >= now() - interval '14 days' GROUP BY 1)
          SELECT d.dia::text dia, COALESCE(m.recebidas,0) recebidas, COALESCE(m.respondidas,0) respondidas, COALESCE(o.tentativas,0) tentativas, COALESCE(o.enviados,0) enviados, COALESCE(f.falhas,0) falhas
            FROM d LEFT JOIN m ON m.dia=d.dia LEFT JOIN o ON o.dia=d.dia LEFT JOIN f ON f.dia=d.dia ORDER BY d.dia`),
      q(`WITH ult AS (SELECT chat_id, max(created_at) t, count(*)::int n, count(*) FILTER (WHERE direction='inbound')::int n_in, min(created_at) desde FROM public.aria_messages WHERE created_at >= now() - interval '90 days' GROUP BY 1)
          SELECT u.chat_id, u.t, u.n, u.n_in, u.desde, m.direction, m.content, m.push_name,
                 (SELECT nota FROM public.aria_quality_scores s WHERE s.chat_id=u.chat_id ORDER BY judged_at DESC LIMIT 1) nota,
                 EXISTS (SELECT 1 FROM public.aria_escalations e WHERE e.status='open' AND (e.phone=u.chat_id OR e.chat_id=u.chat_id OR e.phone = replace(u.chat_id,'email:',''))) escalada,
                 EXISTS (SELECT 1 FROM public.aria_handoffs h WHERE h.phone=u.chat_id AND (h.until IS NULL OR h.until > now())) silenciada,
                 EXISTS (SELECT 1 FROM public.aria_contact_consent cc WHERE cc.tipo='cliente' AND cc.whatsapp_reservas AND regexp_replace(cc.phone,'\\D','','g') = regexp_replace(u.chat_id,'\\D','','g') AND u.chat_id NOT LIKE 'email:%') optin
            FROM ult u JOIN LATERAL (SELECT direction, content, push_name FROM public.aria_messages WHERE chat_id=u.chat_id ORDER BY created_at DESC LIMIT 1) m ON true
           ORDER BY u.t DESC LIMIT 40`),
      q(`SELECT d.restaurant_id, d.name, d.city, upper(btrim(d.country_code)) pais, cc.whatsapp_reservas, COALESCE(cc.whatsapp_indisponivel,false) indisponivel, cc.indisponivel_motivo, cc.idioma, cc.updated_at,
                 (SELECT count(*)::int FROM public.reservations r WHERE r.restaurant_id=d.restaurant_id AND r.created_date >= now() - interval '30 days') pedidos_30d,
                 (SELECT count(*)::int FROM public.reservations r WHERE r.restaurant_id=d.restaurant_id AND r.created_date >= now() - interval '30 days' AND r.booking_status='Accept') aceites_30d,
                 (SELECT count(*)::int FROM public.aria_outbound_log o JOIN public.reservations r ON r.reservation_code=o.reservation_code WHERE r.restaurant_id=d.restaurant_id AND o.evento LIKE '%:estabelecimento' AND o.desfecho='enviado' AND o.created_at >= now() - interval '30 days') envios_30d,
                 (SELECT ds.status FROM public.aria_delivery_status ds JOIN public.reservations r ON r.reservation_code=ds.reservation_code WHERE r.restaurant_id=d.restaurant_id AND ds.destinatario='estabelecimento' ORDER BY ds.sent_at DESC LIMIT 1) ultima_entrega
            FROM public.aria_contact_consent cc JOIN public.db_restaurants d ON d.restaurant_id=cc.restaurant_id
           WHERE cc.tipo='estabelecimento' AND d.restaurant_id NOT IN (${EX})
           ORDER BY pedidos_30d DESC, d.name`),
      q(`SELECT count(*)::int total, count(*) FILTER (WHERE whatsapp_reservas AND NOT COALESCE(outbound_opted_out,false))::int ativos, count(*) FILTER (WHERE COALESCE(outbound_opted_out,false))::int opt_out, count(*) FILTER (WHERE updated_at >= now() - interval '7 days')::int novos_7d FROM public.aria_contact_consent WHERE tipo='cliente'`),
      q(`SELECT phone, idioma, whatsapp_reservas, COALESCE(outbound_opted_out,false) opt_out, source, updated_at FROM public.aria_contact_consent WHERE tipo='cliente' ORDER BY updated_at DESC LIMIT 12`),
      q(`SELECT to_char(date_trunc('week', judged_at),'YYYY-MM-DD') semana, count(*)::int n, round(avg(nota)::numeric,2)::float media, count(*) FILTER (WHERE nota < 5)::int reprovadas FROM public.aria_quality_scores WHERE judged_at >= now() - interval '8 weeks' GROUP BY 1 ORDER BY 1`),
      q(`SELECT judged_at, chat_id, channel, nota, notas, motivo FROM public.aria_quality_scores ORDER BY judged_at DESC LIMIT 12`),
      q(`SELECT id, created_at, tag, COALESCE(assigned_to,'—') dono, left(summary, 240) resumo, phone, reservation_code FROM public.aria_escalations WHERE status='open' ORDER BY created_at`),
      q(`SELECT id, created_at, resolved_at, tag, resolved_by, left(summary, 160) resumo, left(resolution_note, 200) nota FROM public.aria_escalations WHERE status='resolved' ORDER BY resolved_at DESC NULLS LAST LIMIT 10`),
      q(`SELECT status, count(*)::int n FROM public.aria_commitments GROUP BY 1`),
      q(`SELECT id, due_at, channel, chat_id, reservation_code, left(o_que, 160) o_que, status FROM public.aria_commitments WHERE status='pending' ORDER BY due_at LIMIT 8`),
      q(`SELECT tool_name, count(*)::int n, count(*) FILTER (WHERE NOT success)::int falhas, round(avg(latency_ms))::int ms FROM public.aria_tool_calls WHERE created_at >= now() - interval '7 days' GROUP BY 1 ORDER BY 2 DESC LIMIT 14`),
      q(`SELECT model, sum(api_calls)::int chamadas, sum(input_tokens)::bigint entrada, sum(output_tokens)::bigint saida, sum(cache_read_tokens)::bigint cache FROM public.aria_llm_usage WHERE created_at >= now() - interval '7 days' GROUP BY 1 ORDER BY 2 DESC`),
      q(`SELECT count(*)::int vivas, count(*) FILTER (WHERE booking_date <= current_date + 2)::int proximas_48h FROM public.reservations WHERE expired_at IS NULL AND booking_status IN ('Pending','In Treatment') AND restaurant_id NOT IN (${EX})`),
    ]);

    const conv = conversas.map((x) => ({
      id: x.chat_id, rotulo: R.mascarar(x.chat_id), canal: String(x.chat_id).startsWith('email:') ? 'email' : 'whatsapp',
      nome: R.primeiroNome(x.push_name), ultima_em: x.t, desde: x.desde, mensagens: x.n, recebidas: x.n_in,
      direcao: x.direction, trecho: String(x.content || '').replace(/\s+/g, ' ').slice(0, 140),
      nota: x.nota === null ? null : Number(x.nota), escalada: !!x.escalada, silenciada: !!x.silenciada, optin: !!x.optin,
    }));

    return {
      pulso: { ultimo: pulso[0] || null, ultimas24h: pulso24[0] || null },
      kpis: { d7: kpi7[0], d30: kpi30[0], resposta: resp30[0] ? { mediana: R.duracao(resp30[0].med_s), p90: R.duracao(resp30[0].p90_s), n: resp30[0].n } : null },
      funil: R.agregarFunil(funil),
      entregas: { por_template: R.resumoEntregas(entregas), ultimas: ultimasEntregas.map((e) => ({ ...e, destinatario: e.destinatario })) },
      linha_do_tempo: R.linhaDoTempo(timeline, 14),
      conversas: conv,
      casas: casas.map((k) => ({ ...k, estado: k.indisponivel ? 'indisponivel' : k.whatsapp_reservas ? 'ativa' : 'desligada' })),
      clientes: { resumo: clientes[0], ultimos: clientesLista.map((x) => ({ rotulo: R.mascarar(x.phone), idioma: x.idioma, ativo: !!x.whatsapp_reservas && !x.opt_out, opt_out: !!x.opt_out, origem: x.source, em: x.updated_at })) },
      qualidade: { semanas: qualidadeSemanas, ultimas: qualidadeUltimas.map((x) => ({ ...x, chat: R.mascarar(x.chat_id), chat_id: x.chat_id })) },
      escalacoes: { abertas: escAbertas.map((e) => ({ ...e, contato: R.mascarar(e.phone && e.phone.includes('@') ? `email:${e.phone}` : e.phone) })), fechadas: escFechadas },
      compromissos: { por_status: compromissos, proximos: proximos.map((x) => ({ ...x, chat: R.mascarar(x.chat_id) })) },
      ferramentas: ferramentas,
      custo: custo,
      pendencias: pendencias[0],
    };
  });
}

async function renovar() {
  if (emCurso) return emCurso;
  emCurso = (async () => {
    const t0 = Date.now();
    const [aria, banco] = await Promise.all([saudeAria(), lerBanco().then((d) => ({ ok: true, dados: d })).catch((e) => ({ ok: false, erro: String(e && e.message || e).slice(0, 200) }))]);
    const snap = { geradoEm: agora(), ms: Date.now() - t0, cacheSeg: Math.round(TTL_MS / 1000), aria, banco: banco.ok ? 'ok' : 'erro', erro: banco.ok ? null : banco.erro, ...(banco.ok ? banco.dados : {}) };
    cache = { at: Date.now(), data: snap };
    return snap;
  })();
  try { return await emCurso; } finally { emCurso = null; }
}

// Quem abriu a sala nos últimos 10 min mantém o instantâneo quente: a renovação corre em segundo plano a cada
// TTL e a página nunca espera os ~10–25 s da leitura fria (subconsultas das casas) depois da primeira vez.
let ultimoPedido = 0;
let aquecedor = null;
async function snapshot(opts = {}) {
  ultimoPedido = Date.now();
  if (!aquecedor) aquecedor = setInterval(() => { if (Date.now() - ultimoPedido < 10 * 60_000 && !emCurso) renovar().catch(() => {}); }, TTL_MS).unref();
  if (!opts.fresco && cache && Date.now() - cache.at < TTL_MS * 2) { if (Date.now() - cache.at >= TTL_MS && !emCurso) renovar().catch(() => {}); return cache.data; }
  return renovar();
}

async function conversa(chatId) {
  const id = String(chatId || '').trim();
  if (!id || id.length > 120) throw new Error('id inválido');
  return db.comCliente(async (c) => {
    const q = async (sql, params = []) => (await c.query(sql, params)).rows;
    const [mensagens, ferramentas, notas, retidas, escalacoes, consent, handoff] = await Promise.all([
      q(`SELECT id, direction, content, has_media, media_type, created_at, push_name FROM public.aria_messages WHERE chat_id=$1 ORDER BY created_at DESC LIMIT 80`, [id]),
      q(`SELECT tool_name, success, latency_ms, created_at, left(output_summary, 160) resumo, left(error_message, 160) erro FROM public.aria_tool_calls WHERE chat_id=$1 ORDER BY created_at DESC LIMIT 20`, [id]),
      q(`SELECT judged_at, nota, notas, motivo, message_id FROM public.aria_quality_scores WHERE chat_id=$1 ORDER BY judged_at DESC LIMIT 10`, [id]),
      q(`SELECT created_at, layer, left(reason, 200) motivo, left(snippet, 240) trecho FROM public.aria_scope_blocks WHERE chat_id=$1 ORDER BY created_at DESC LIMIT 8`, [id]),
      q(`SELECT id, created_at, tag, status, COALESCE(assigned_to,'—') dono, left(summary, 200) resumo FROM public.aria_escalations WHERE phone=$1 OR chat_id=$1 OR phone=replace($1,'email:','') ORDER BY created_at DESC LIMIT 6`, [id]),
      q(`SELECT whatsapp_reservas, COALESCE(outbound_opted_out,false) opt_out, idioma, tipo, updated_at FROM public.aria_contact_consent WHERE regexp_replace(phone,'\\D','','g') = regexp_replace($1,'\\D','','g') AND $1 NOT LIKE 'email:%' ORDER BY updated_at DESC LIMIT 1`, [id]),
      q(`SELECT operator, until FROM public.aria_handoffs WHERE phone=$1 LIMIT 1`, [id]),
    ]);
    const nome = R.primeiroNome((mensagens.find((m) => m.push_name) || {}).push_name);
    return {
      id, rotulo: R.mascarar(id), canal: id.startsWith('email:') ? 'email' : 'whatsapp', nome,
      mensagens: mensagens.reverse().map((m) => ({ id: m.id, direcao: m.direction, texto: m.content, midia: m.has_media ? m.media_type : null, em: m.created_at })),
      ferramentas, notas, retidas, escalacoes, consentimento: consent[0] || null, silenciada: handoff[0] ? { ate: handoff[0].until, por: handoff[0].operator } : null,
    };
  });
}

module.exports = { snapshot, conversa, TTL_MS };
