'use strict';
/**
 * Regência — coletores autônomos: um relato por agente, no contrato relato.schema.json.
 * Zero LLM. Cada coletor devolve SEMPRE um relato; falta de fonte/credencial vira status e lacuna
 * (falhar alto), nunca "ok" silencioso.
 *
 * Fontes: banco (twk_ro), estado local do Orquestrador (quando roda no repositório), estado da
 * Central (STATE_DIR) e KPIs das APIs dos agentes (quando o servidor da Central injeta `kpis`).
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const db = require('./db');

const REPO = path.resolve(__dirname, '..', '..', '..');

/**
 * Sonda a ficha pública de um restaurante. Existe porque, entre 28/08 e 07/09, a Regência repetiu
 * todo dia "a página continua acessível" a partir de uma conclusão antiga — e o front já havia
 * corrigido. Conclusão herdada não é evidência. Nunca lança; status null = não deu para verificar.
 * Atenção: /hospitality/{slug}/ com barra final devolve 308; é preciso seguir o redirecionamento.
 */
async function fichaNoAr(slug) {
  if (!slug) return { status: null, erro: 'restaurante sem slug' };
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch(`https://theworldkeys.com/hospitality/${encodeURIComponent(slug)}`, { redirect: "follow", signal: ctrl.signal });
    return { status: r.status };
  } catch (e) { return { status: null, erro: e.message }; } finally { clearTimeout(t); }
}
const ORCH = path.join(REPO, 'orchestrator');
const localDisponivel = () => fs.existsSync(path.join(ORCH, 'state'));
const hoje = () => new Date().toISOString().slice(0, 10);
const lerJsonl = (f) => { try { return fs.readFileSync(f, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; } };
const lerJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const lerCsv = (f) => { try { const [h, ...ls] = fs.readFileSync(f, 'utf8').split(/\r?\n/).filter(Boolean); const cols = h.split(';').map((s) => s.replace(/"/g, '').trim()); return ls.map((l) => Object.fromEntries(l.split(';').map((v, i) => [cols[i], v.replace(/"/g, '').trim()]))); } catch { return null; } };

function base(agente, trace) {
  return { agente, ts: new Date().toISOString(), trace_id: trace, status: 'ok', kpis: {}, sinais_conversao: [], experiencia: [], achados: [], acoes_autonomas: [], aprovacoes_pendentes: [], custo: { eur_e4: 0, tokens: 0 }, cobertura: { fontes: [], lacunas: [] } };
}
const TAG_PT = { PARCEIRO_B2B: 'restaurante querendo parceria', MODIFICACAO: 'mudança de reserva', PEDIDO_ESPECIAL: 'pedido especial', CANCELAMENTO: 'cancelamento', REEMBOLSO: 'reembolso', ACESSIBILIDADE: 'acessibilidade', REMOCAO_LISTAGEM: 'pedido de remoção', CORRECAO_LISTAGEM: 'correção de dados' };
const achado = (o) => ({ autonomia: 'requer_aprovacao_humana', dono: 'você', fonte: '', ...o });

// ---------------- DBA (catálogo + reservas: a fonte de verdade) ----------------
async function dba(ctx) {
  const r = base('dba', ctx.trace);
  if (!db.disponivel()) { r.status = 'sem_credencial'; r.cobertura.lacunas.push('DATABASE_URL_RO/pg ausentes — sem leitura do twk_auth'); return r; }
  let s; try { s = await db.snapshot(); } catch (e) { r.status = 'falhou'; r.cobertura.lacunas.push(`twk_ro: ${e.message}`); return r; }
  ctx.snapshot = s;
  r.cobertura.fontes.push('twk_auth via twk_ro (somente leitura)');
  const taxaNP = s.naoParc.pedidos ? Math.round(100 * s.naoParc.aceitos / s.naoParc.pedidos) : null;
  const taxaP = s.parc.pedidos ? Math.round(100 * s.parc.aceitos / s.parc.pedidos) : null;
  Object.assign(r.kpis, { publicados: s.cat.publicados, parceiros: s.cat.parceiros, contas_profissionais: s.contas.contas, contas_novas_24h: s.contas.novas_24h, contas_novas_7d: s.contas.novas_7d, pedidos_24h: s.fluxo.pedidos_24h, pedidos_7d: s.fluxo.pedidos_7d, aceitos_7d: s.fluxo.aceitos_7d, pendencias_vivas: s.pend.vivas, casas_com_pendencia: s.pend.casas, mesa_hoje_sem_resposta: s.pend.mesa_hoje, mesa_amanha_sem_resposta: s.pend.mesa_amanha, aceite_nao_parceiros_30d_pct: taxaNP, aceite_parceiros_30d_pct: taxaP, horarios_genericos_publicados: s.generic.genericos });
  r.sinais_conversao.push({ tipo: 'contas_profissionais_novas_7d', valor: s.contas.novas_7d, detalhe: `${s.contas.contas} no total desde o início`, fonte: 'restaurant_users' });
  r.sinais_conversao.push({ tipo: 'reservas_aceitas_7d', valor: s.fluxo.aceitos_7d, detalhe: `de ${s.fluxo.pedidos_7d} pedidos recebidos`, fonte: 'reservations' });
  r.experiencia.push({ tipo: 'clientes_com_mesa_hoje_sem_resposta', valor: s.pend.mesa_hoje, fonte: 'reservations' });
  r.experiencia.push({ tipo: 'clientes_com_mesa_amanha_sem_resposta', valor: s.pend.mesa_amanha, fonte: 'reservations' });
  if (s.pend.mesa_hoje > 0) r.achados.push(achado({ chave: 'dba.mesa_hoje_sem_resposta', severidade: 'critica', titulo: `${s.pend.mesa_hoje} cliente(s) jantam hoje e o restaurante ainda não respondeu`, evidencia: `pedidos de mesa marcados para hoje que seguem sem resposta`, fonte: 'twk_ro', acao_proposta: 'mandar agora a mensagem de WhatsApp pronta, no idioma da casa; sem resposta em 2 horas, avisamos o cliente e oferecemos outra casa (com a sua aprovação)', autonomia: 'requer_aprovacao_humana', dono: 'você + atendimento', prazo: 'hoje' }));
  if (s.despub.length) {
    const sondas = [];
    for (const d of s.despub) sondas.push({ ...d, ...(await fichaNoAr(d.slug)) });
    const noAr = sondas.filter((x) => x.status === 200);
    const fora = sondas.filter((x) => x.status === 404);
    const incerto = sondas.filter((x) => x.status !== 200 && x.status !== 404);
    const ultimo = sondas.map((x) => x.ultimo_pedido).filter(Boolean).sort().pop();

    if (noAr.length) r.achados.push(achado({ chave: 'dba.despublicadas_no_ar', severidade: 'critica',
      titulo: `${noAr.length} restaurante(s) despublicados continuam com a página no ar (${noAr.map((d) => d.name).join(", ")})`,
      evidencia: `sondado agora: ${noAr.map((d) => `/hospitality/${d.slug} devolveu ${d.status}`).join("; ")}`,
      fonte: 'twk_ro + sonda HTTP', acao_proposta: 'o site precisa tirar essas páginas do ar; até lá, avisamos o cliente e não incomodamos a casa',
      autonomia: 'requer_aprovacao_humana', dono: 'time do site' }));

    if (fora.length) r.achados.push(achado({ chave: 'dba.despublicadas_com_pendencia', severidade: 'media',
      titulo: `${fora.reduce((a, d) => a + d.n, 0)} pedido(s) em aberto em ${fora.length} casa(s) que já saíram do ar`,
      evidencia: `as fichas respondem 404 (sondado agora), então não entram pedidos novos; o mais recente é de ${ultimo ? String(ultimo).slice(0, 10) : "data desconhecida"} — são pedidos anteriores à remoção, com cliente ainda esperando`,
      fonte: 'twk_ro + sonda HTTP', acao_proposta: 'decidir o que dizer a esses clientes: avisar que a casa saiu da plataforma e oferecer alternativa',
      autonomia: 'requer_aprovacao_humana', dono: 'atendimento' }));

    if (incerto.length) {
      r.cobertura.lacunas.push(`não consegui sondar ${incerto.length} ficha(s) de restaurante despublicado — estado das páginas desconhecido nesta rodada`);
      r.achados.push(achado({ chave: 'dba.despublicadas_nao_verificadas', severidade: 'media',
        titulo: `Não consegui verificar se ${incerto.length} página(s) de restaurante despublicado ainda estão no ar`,
        evidencia: `sonda HTTP falhou: ${incerto.map((d) => `${d.name}: ${d.erro || d.status}`).join("; ")}`,
        fonte: 'sonda HTTP', acao_proposta: 'conferir à mão; checagem que não rodou não vira "ok"',
        autonomia: 'requer_aprovacao_humana', dono: 'você' }));
    }
  }
  if (taxaNP !== null && taxaNP < 12) r.achados.push(achado({ chave: 'dba.aceite_nao_parceiros_baixo', severidade: 'alta', titulo: `Restaurantes sem parceria confirmam só ${taxaNP}% dos pedidos (parceiros confirmam ${taxaP}%)`, evidencia: `${s.naoParc.aceitos} confirmados em ${s.naoParc.pedidos} pedidos nos últimos 30 dias`, fonte: 'twk_ro', acao_proposta: 'liberar a cobrança automática por e-mail para mais restaurantes', autonomia: 'requer_aprovacao_humana', dono: 'acompanhamento de reservas' }));
  if (s.generic.genericos > 0) r.achados.push(achado({ chave: 'dba.horarios_genericos', severidade: 'media', titulo: `${s.generic.genericos} restaurantes com o mesmo horário repetido todos os dias — provavelmente errado`, evidencia: 'o site pode estar oferecendo horários que a casa não atende', fonte: 'twk_ro', acao_proposta: 'conferir com o Google e corrigir em lote, com a sua aprovação', autonomia: 'requer_aprovacao_humana', dono: 'catálogo' }));
  // --- Cadastros de restaurante: concluídos (a conquista) e em aberto (o risco) ---
  // ATENÇÃO (07/09): a automação do e-mail de aprovação é SUPOSIÇÃO, não fato verificado — não há
  // workflow de aprovação no n8n e o `send-token` não roda desde 06/09. No caso ELEOS o link saiu à
  // mão e chegou quebrado. Enquanto o teste de aceite não passar, um cadastro parado pode significar
  // "a pessoa não voltou" OU "o sistema não avisou". Não afirmar nenhum dos dois.
  r.sinais_conversao.push({ tipo: 'cadastros_concluidos_7d', valor: (s.concl || []).length, detalhe: (s.concl || []).map((x) => x.restaurant_name).join(', '), fonte: 'cadastros' });
  for (const x of (s.concl || [])) {
    r.achados.push(achado({ chave: 'dba.cadastro_concluido.' + x.restaurant_name, severidade: 'info',
      titulo: `${x.restaurant_name} assumiu a própria página`,
      evidencia: `cadastro concluído em ${new Date(x.completed_at).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long' })}`,
      fonte: 'cadastros', acao_proposta: 'nada a fazer — acompanhar se a casa passa a responder mais rápido', autonomia: 'autonomo', dono: 'acompanhamento de reservas' }));
  }
  // Cadastro vindo de restaurante cujo domínio de contato pode ser comprado por qualquer um: risco de invasão.
  let compraveis = new Set();
  try { compraveis = new Set(JSON.parse(fs.readFileSync(path.join(ORCH, 'state', 'dominios-compraveis-2026-09-06.json'), 'utf8')).map((x) => String(x.name).toUpperCase())); } catch {}
  for (const q of (s.cand || [])) {
    const h = q.horas_para_vencer;
    const aprovado = q.status === 'approved';
    const venceu = h !== null && h <= 0;
    const venceLogo = h !== null && h > 0 && h <= 24;
    const quem = q.full_name || 'Um responsável';
    r.achados.push(achado({ chave: 'dba.cadastro_aberto.' + q.restaurant_name,
      severidade: venceLogo ? 'critica' : 'alta', // vencido continua alto: exige emitir convite novo
      titulo: venceu
        ? `O convite do ${q.restaurant_name} venceu sem que a conta fosse criada`
        : aprovado
          ? `${quem} do ${q.restaurant_name} está aprovado e ainda não criou a senha`
          : `${quem} do ${q.restaurant_name} se cadastrou e espera a nossa aprovação`,
      evidencia: venceu
        ? `pedido feito há ${q.horas_desde_pedido} hora(s); o prazo terminou há ${Math.abs(h)} hora(s) e a conta continua sem ser criada`
        : `pedido feito há ${q.horas_desde_pedido} hora(s)${h !== null ? `; o prazo vence em ${h} hora(s)` : ''}`,
      fonte: 'cadastros',
      acao_proposta: venceu
        ? 'emitir um convite novo e enviar com um pedido de desculpas — o prazo correu do nosso lado'
        : aprovado
          ? (venceLogo ? 'o prazo está acabando: confirmar que o e-mail com o link saiu de fato e, se preciso, renovar' : 'confirmar que o e-mail com o link chegou; sem prova de envio, tratar como falha nossa, não da pessoa')
          : 'aprovar o cadastro e confirmar que o e-mail com o link saiu (a automação ainda não foi verificada ponta a ponta)',
      autonomia: 'requer_aprovacao_humana', dono: 'você', prazo: venceLogo ? 'hoje' : '24h' }));
    if (compraveis.has(String(q.restaurant_name).toUpperCase())) {
      r.achados.push(achado({ chave: 'dba.cadastro_dominio_compravel.' + q.restaurant_name, severidade: 'critica',
        titulo: 'NÃO APROVAR direto: pedido de acesso ao ' + q.restaurant_name,
        evidencia: 'o e-mail de contato desta casa usa um domínio que não está registrado — qualquer pessoa pode comprá-lo e receber o código de acesso',
        fonte: 'verificação de domínio', acao_proposta: 'pedir por escrito uma prova que só a casa tem (foto do salão com um código nosso, ou mensagem do WhatsApp oficial do restaurante) antes de aprovar', autonomia: 'requer_aprovacao_humana', dono: 'você', prazo: 'agora' }));
    }
  }
  r.acoes_autonomas.push(...s.audit.map((a) => ({ acao: `ajuste automático no catálogo (${a.agent})`, n: a.n, evidencia: 'agent_audit_log 24h' })));
  return r;
}

// ---------------- Guardião da Reserva ----------------
function guardiao(ctx) {
  const r = base('guardiao-reserva', ctx.trace);
  if (!localDisponivel()) { r.status = 'sem_fonte'; r.cobertura.lacunas.push('estado do Guardião não está nesta máquina (só via push-state)'); return r; }
  const dir = path.join(ORCH, 'agents', 'guardiao-reserva');
  const st = path.join(dir, 'state');
  if (fs.existsSync(path.join(st, 'PAUSADO'))) { r.status = 'parcial'; r.achados.push(achado({ chave: 'guardiao.pausado', severidade: 'alta', titulo: 'O acompanhamento de reservas está pausado', evidencia: lerJson(path.join(st, 'PAUSADO'))?.motivo || '', acao_proposta: 'me diga `pode retomar` para religar', dono: 'você' })); }
  let prop = lerJson(path.join(st, `propostas-${hoje()}.json`));
  if (!prop && !ctx.semExecutar) {
    try { execFileSync(process.execPath, [path.join(dir, 'run.js')], { cwd: REPO, stdio: 'ignore', timeout: 170000 }); prop = lerJson(path.join(st, `propostas-${hoje()}.json`)); r.acoes_autonomas.push({ acao: 'revisão diária dos pedidos de mesa parados', n: 1, evidencia: `state/relatorio-${hoje()}.md` }); }
    catch (e) { r.status = 'falhou'; r.cobertura.lacunas.push(`run.js falhou: ${String(e.message).slice(0, 120)}`); return r; }
  }
  if (!prop) { r.status = 'sem_fonte'; r.cobertura.lacunas.push('sem propostas de hoje'); return r; }
  r.cobertura.fontes.push(`orchestrator/agents/guardiao-reserva/state/propostas-${hoje()}.json`);
  const c = prop.contagens || {};
  Object.assign(r.kpis, { avaliadas: c.avaliadas, email_restaurante: c.email_restaurante, fila_humana: (c.fila_whatsapp || 0) + (c.fila_whatsapp_urgente || 0), clientes_a_avisar: c.mensagem_cliente, vencidas: c.vencidas, bloqueado: c.bloqueado, modo: prop.modo });
  r.experiencia.push({ tipo: 'clientes_a_avisar_degrau4', valor: c.mensagem_cliente || 0, detalhe: (prop.clientes || []).slice(0, 5).map((x) => `${x.fatos?.restaurante} (em ${x.horas_ate_mesa}h)`).join("; "), fonte: 'propostas' });
  const urgentes = (prop.clientes || []).filter((x) => x.horas_ate_mesa <= 6);
  if (urgentes.length) r.achados.push(achado({ chave: 'guardiao.clientes_mesa_6h', severidade: 'critica', titulo: `${urgentes.length} cliente(s) jantam em menos de 6 horas e a casa não respondeu`, evidencia: urgentes.map((x) => `${x.fatos?.restaurante} (em ${x.horas_ate_mesa}h)`).join("; "), fonte: 'guardiao', acao_proposta: 'mandar a mensagem de WhatsApp pronta agora; sem resposta em 2 horas, avisamos o cliente e oferecemos outra opção', dono: 'você' , prazo: 'agora' }));
  if ((prop.emails || []).length) { r.achados.push(achado({ chave: 'guardiao.lote_degrau1', severidade: 'alta', titulo: `${prop.emails.length} restaurante(s) com ${c.email_restaurante} pedido(s) de mesa parados: posso cobrá-los por e-mail?`, evidencia: `nenhum e-mail sai sem a sua palavra`, fonte: 'guardiao', acao_proposta: 'responda `pode cobrar` e eu envio hoje (Paris, Atenas e Marrakech, até 20 por dia)', dono: 'você', prazo: '24h' })); }
  if ((prop.fila || []).length) r.experiencia.push({ tipo: 'fila_humana_whatsapp_telefone', valor: prop.fila.length, detalhe: prop.fila.slice(0, 5).map((f) => `${f.nome} (${f.urgencia_h}h)`).join('; '), fonte: `fila-mensagens-${hoje()}.csv` });
  if (prop.anomalias && prop.anomalias.length) r.achados.push(achado({ chave: 'guardiao.anomalias', severidade: 'alta', titulo: `Algo fora do normal no acompanhamento de reservas: ${prop.anomalias.join("; ")}`, evidencia: 'propostas.anomalias', acao_proposta: 'investigar', dono: 'MAESTRO', autonomia: 'requer_aprovacao_orquestrador' }));
  return r;
}

// ---------------- Registro de Opt-out ----------------
async function registroOptout(ctx) {
  const r = base('registro-optout', ctx.trace);
  let reg;
  try { reg = await require(path.join(ORCH, 'agents', 'registro-optout', 'registro.js')).carregarAuto(); }
  catch (e) { r.status = 'sem_fonte'; r.cobertura.lacunas.push(e.message); r.achados.push(achado({ chave: 'optout.registro_ausente', severidade: 'critica', titulo: 'A lista de quem pediu remoção está inacessível — por segurança, nenhum contato a restaurante vai sair', evidencia: e.message, acao_proposta: 'restaurar acesso ao banco ou ao arquivo interino', dono: 'MAESTRO' })); return r; }
  r.cobertura.fontes.push(`registro de opt-out — ${reg.fonte}`);
  if (/arquivo interino/.test(reg.fonte)) r.achados.push(achado({ chave: 'optout.fonte_degradada', severidade: 'alta', titulo: 'A lista de quem pediu remoção foi lida de uma cópia, não da fonte principal', evidencia: reg.fonte, acao_proposta: 'restaurar leitura de public.v_listing_consent_atual', dono: 'catálogo', autonomia: 'requer_aprovacao_orquestrador' }));
  // 14/09: três remoções viveram só no arquivo e a tabela vazia as escondia de quem contata restaurantes.
  else if ((reg.so_no_arquivo || []).length) r.achados.push(achado({ chave: 'optout.so_no_arquivo', severidade: 'alta', titulo: `${reg.so_no_arquivo.length} pedido(s) de remoção ainda não chegaram ao banco — hoje só a leitura combinada os protege`, evidencia: `restaurant_id: ${reg.so_no_arquivo.join(', ')}`, acao_proposta: 'gravar os eventos em public.listing_consent pelo executor do DBA', dono: 'MAESTRO', autonomia: 'requer_aprovacao_humana' }));
  const arr = [...reg.atual.values()];
  Object.assign(r.kpis, { registros: arr.length, opted_out: arr.filter((e) => e.status === 'opted_out').length, correction_requested: arr.filter((e) => e.status === 'correction_requested').length, sla_execucao_aberto: arr.filter((e) => e.status !== 'listed' && !e.sla_done_at).length });
  // A conclusão de um pedido de remoção é a página fora do ar — então sondamos, em vez de repetir a
  // nota gravada no registro. Em 07/09 essa nota (de 28/08) ainda dizia "responde 200" quando o front
  // já devolvia 404 há dias, e o Despacho publicava isso como crítico todo dia.
  const abertos = arr.filter((x) => x.status !== 'listed' && !x.sla_done_at);
  let mapaSlug = {};
  if (abertos.length && db.disponivel()) { try { mapaSlug = await db.slugs(abertos.map((x) => x.restaurant_id)); } catch {} }
  for (const e of abertos) {
    const h = Math.round((Date.now() - Date.parse(e.requested_at)) / 3600000);
    const dias = Math.round(h / 24);
    const info = mapaSlug[String(e.restaurant_id)] || {};
    const quem = info.name ? `${info.name} (${e.restaurant_id})` : `restaurante ${e.restaurant_id}`;
    const sonda = info.slug ? await fichaNoAr(info.slug) : { status: null, erro: 'slug desconhecido' };

    if (sonda.status === 404) {
      r.achados.push(achado({ chave: `optout.sla.${e.restaurant_id}`, severidade: 'media',
        titulo: `A página do ${quem} já saiu do ar — falta só dar o pedido por concluído`,
        evidencia: `pedido há ${dias} dia(s); /hospitality/${info.slug} devolve 404 (sondado agora). A nota gravada no registro é anterior e diz o contrário`,
        fonte: 'listing-consent + sonda HTTP',
        acao_proposta: 'registrar a conclusão (sla_done_at) e corrigir a nota — e avisar quem pediu que está feito',
        autonomia: 'requer_aprovacao_humana', dono: 'catálogo' }));
    } else if (sonda.status === 200) {
      r.achados.push(achado({ chave: `optout.sla.${e.restaurant_id}`, severidade: h > 48 ? 'alta' : 'media',
        titulo: `Pedido de remoção do ${quem} há ${dias} dia(s) sem conclusão`,
        evidencia: `/hospitality/${info.slug} ainda devolve 200 (sondado agora)`,
        fonte: 'listing-consent + sonda HTTP',
        acao_proposta: 'tirar a página do ar de verdade — só assim o pedido está atendido', dono: 'time do site + catálogo' }));
    } else {
      r.achados.push(achado({ chave: `optout.sla.${e.restaurant_id}`, severidade: h > 48 ? 'alta' : 'media',
        titulo: `Pedido de remoção do ${quem} há ${dias} dia(s): não consegui verificar se a página saiu do ar`,
        evidencia: `sonda falhou (${sonda.erro || sonda.status}); a nota do registro é de quando o pedido entrou e não vale como estado atual`,
        fonte: 'listing-consent',
        acao_proposta: 'conferir a ficha à mão; checagem que não rodou não vira "concluído"', dono: 'catálogo' }));
    }
  }
  const varr = localDisponivel() ? path.join(ORCH, 'agents', 'registro-optout', 'state', `varredura-${hoje()}.md`) : null;
  if (varr && fs.existsSync(varr)) r.acoes_autonomas.push({ acao: 'leitura das caixas de e-mail em busca de pedidos de remoção', n: 1, evidencia: varr }); else r.cobertura.lacunas.push('varredura de hoje não rodou (exige export de mensagens ou Aria FLUXO 7 em produção)');
  return r;
}

// ---------------- Comercial (CLAVIS) ----------------
function comercial(ctx) {
  const r = base('comercial', ctx.trace);
  const s = ctx.snapshot;
  if (localDisponivel()) {
    const ledger = lerCsv(path.join(ORCH, 'state', 'envios-fundadores-2026-08.csv'));
    if (ledger) { const reais = ledger.filter((l) => l.recipient && l.touch_no !== '0'); const antiga = reais.filter((l) => l.campaign_key !== 'chave_girada_2026_09'); const nova = reais.filter((l) => l.campaign_key === 'chave_girada_2026_09'); Object.assign(r.kpis, { campanha_envios: antiga.length, campanha_casas: new Set(antiga.map((l) => l.restaurant_id)).size, respondedores_envios: nova.length, respondedores_casas: new Set(nova.map((l) => l.restaurant_id)).size, ultimo_envio: reais.map((l) => l.sent_at).sort().pop() }); r.cobertura.fontes.push('envios-fundadores-2026-08.csv'); }
    const funil = lerCsv(path.join(ORCH, 'state', 'funil-campanha-fundadores-2026-08-31.csv'));
    if (funil) { const st = {}; funil.forEach((l) => { st[l.status_funil] = (st[l.status_funil] || 0) + 1; }); r.kpis.funil_31_08 = JSON.stringify(st); }
  } else r.cobertura.lacunas.push('ledger da campanha não está nesta máquina');
  if (s) { r.sinais_conversao.push({ tipo: 'contas_profissionais_novas_7d', valor: s.contas.novas_7d, fonte: 'restaurant_users' }); if (r.kpis.campanha_envios && s.contas.novas_7d === 0) r.achados.push(achado({ chave: 'comercial.campanha_sem_conversao', severidade: 'alta', titulo: `${r.kpis.campanha_envios} e-mails enviados a ${r.kpis.campanha_casas} restaurantes e nenhuma conta criada em 7 dias`, evidencia: 'nenhuma conta de restaurante foi criada no período', fonte: 'twk_ro + ledger', acao_proposta: 'não enviar novas ondas até o site ter uma página para restaurantes; priorizar contato direto com quem tem pedidos parados', autonomia: 'requer_aprovacao_humana', dono: 'comercial + time do site' })); }
  if (ctx.kpis?.comercial && ctx.kpis.comercial.status === 'ok') { r.cobertura.fontes.push('CLAVIS /api/snapshot'); Object.assign(r.kpis, { api: 'ok' }); } else r.cobertura.lacunas.push('CLAVIS API não lida (AGENT_CLAVIS_URL/TOKEN)');
  r.achados.push(achado({ chave: 'comercial.optout_templates', severidade: 'alta', titulo: 'Modelos de e-mail da campanha sem link de descadastro', evidencia: 'todo e-mail em massa precisa oferecer saída com um clique', fonte: 'orchestrator/evals', acao_proposta: 'incluir o link de descadastro antes de qualquer nova onda', autonomia: 'autonomo_com_log', dono: 'time comercial' }));
  return r;
}

// ---------------- Suporte (Aria) ----------------
/**
 * Compromissos com data que vencem até amanhã (orchestrator/state/compromissos.jsonl), status "aberto".
 * Nunca lança: arquivo ausente ou ilegível devolve lista vazia (o compromisso em si fica no log).
 */
function compromissosVencendo(hojeIso = new Date().toISOString().slice(0, 10)) {
  try {
    const arq = path.join(REPO, 'orchestrator', 'state', 'compromissos.jsonl');
    if (!fs.existsSync(arq)) return [];
    const amanha = new Date(Date.parse(`${hojeIso}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
    return fs.readFileSync(arq, 'utf8').split(/\r?\n/).filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter((x) => x && x.status === 'aberto' && x.vence_em && x.vence_em <= amanha);
  } catch { return []; }
}

function suporte(ctx) {
  const r = base('suporte-concierge', ctx.trace);
  const s = ctx.snapshot;
  if (s) {
    r.cobertura.fontes.push('aria_escalations/aria_handoffs/aria_contact_consent via twk_ro');
    Object.assign(r.kpis, { escalacoes_abertas: s.esc.abertas, escalacoes_abertas_24h: s.esc.abertas_24h, escalacoes_novas_24h: s.esc.novas_24h, handoffs_ativos: s.hand.ativos, consent_linhas: s.consent.linhas });
    r.experiencia.push({ tipo: 'escalacoes_abertas', valor: s.esc.abertas, detalhe: s.escTags.map((t) => `${TAG_PT[t.tag] || t.tag.toLowerCase().replace(/_/g, " ")}: ${t.n}`).join(", "), fonte: 'aria_escalations' });
    if (s.aria) {
      Object.assign(r.kpis, { aria_inbound_24h: s.aria.inbound_24h, aria_outbound_24h: s.aria.outbound_24h, aria_horas_sem_envio: s.aria.horas_sem_envio, aria_fila_pendente: s.aria.fila_pendente });
      const muda = s.aria.horas_sem_envio !== null && s.aria.horas_sem_envio >= 24 && (s.aria.inbound_24h > 0 || s.aria.fila_pendente > 0);
      if (muda) r.achados.push(achado({ chave: 'suporte.aria_muda', severidade: 'critica', titulo: `A Aria não responde ninguém há ${s.aria.horas_sem_envio} hora(s)`, evidencia: `recebeu ${s.aria.inbound_24h} mensagem(ns) nas últimas 24h e não enviou nenhuma; ${s.aria.fila_pendente} e-mail(s) na fila. Causas prováveis: créditos da API esgotados (aviso da Anthropic na caixa) ou serviço parado`, fonte: 'aria_messages + aria_pending_emails', acao_proposta: 'conferir créditos da API no console da Anthropic e o serviço da Aria no EasyPanel; enquanto isso, o MAESTRO responde a fila', autonomia: 'requer_aprovacao_humana', dono: 'você', prazo: 'agora' }));
    }
    // ADR-014: a fila não espera "uma pessoa" — quem resolve é o MAESTRO. Enquanto ela
    // cresce, cada linha é alguém a quem a Aria prometeu retorno (incidente de 11/09).
    if (s.esc.abertas_24h > 0) r.achados.push(achado({ chave: 'suporte.escalacoes_24h', severidade: 'alta', titulo: `${s.esc.abertas_24h} atendimento(s) na fila há mais de um dia, sem ninguém trabalhando neles`, evidencia: s.escTags.map((t) => `${TAG_PT[t.tag] || t.tag.toLowerCase().replace(/_/g, " ")} desde ${new Date(t.desde).toLocaleDateString("pt-BR", { day: "2-digit", month: "long" })}`).join("; "), fonte: 'aria_escalations', acao_proposta: 'o MAESTRO resolve cada caso ponta a ponta e fecha a linha; jurídico, imprensa e valores continuam vindo a você', autonomia: 'autonomo_com_log', dono: 'MAESTRO', prazo: 'hoje' }));

    if (s.semCobranca && s.semCobranca.em_3_dias > 0) r.achados.push(achado({ chave: 'suporte.pendencias_sem_cobranca', severidade: 'critica', titulo: `${s.semCobranca.em_3_dias} pedido(s) com mesa em até 3 dias e nenhuma cobrança ao restaurante`, evidencia: `${s.semCobranca.total} pendências vivas com data futura em ${s.semCobranca.casas} casa(s); a coluna followup_6h_sent_at está vazia em toda a base, ou seja, a cobrança automática nunca rodou. A Aria, enquanto isso, promete retorno ao cliente`, fonte: 'reservations.followup_6h_sent_at', acao_proposta: 'aprovar o lote do Guardião da Reserva para que a cobrança ao restaurante saia de verdade; sem isso a promessa ao cliente é vazia', autonomia: 'requer_aprovacao_humana', dono: 'você', prazo: 'hoje' }));

    // Compromissos com data (orchestrator/state/compromissos.jsonl). Nasceu em 14/09: prometi a uma
    // cliente escrever de novo antes do jantar dela, e o agendador local já falhou antes. Promessa com
    // data que ninguém lembra é a mesma promessa sem lastro do incidente de 11/09.
    for (const cmp of compromissosVencendo()) {
      const atrasado = cmp.vence_em < new Date().toISOString().slice(0, 10);
      r.achados.push(achado({ chave: `suporte.compromisso.${cmp.id}`, severidade: atrasado ? 'critica' : 'alta', titulo: atrasado ? `Compromisso vencido em ${cmp.vence_em}: ${cmp.tipo} (${cmp.reservation_code || cmp.id})` : `Compromisso vence em ${cmp.vence_em}: ${cmp.tipo} (${cmp.reservation_code || cmp.id})`, evidencia: cmp.o_que, fonte: 'orchestrator/state/compromissos.jsonl', acao_proposta: 'o MAESTRO cumpre e marca o compromisso como cumprido', autonomia: 'autonomo_com_log', dono: cmp.dono || 'MAESTRO', prazo: atrasado ? 'agora' : cmp.vence_em }));
    }
  } else r.cobertura.lacunas.push('sem snapshot do banco');
  if (ctx.kpis?.suporte && ctx.kpis.suporte.status === 'ok') { r.cobertura.fontes.push('Aria /dashboard/api/overview'); Object.assign(r.kpis, { api: 'ok', conversas_7d: ctx.kpis.suporte.conversas7d ?? null }); } else r.cobertura.lacunas.push('Aria API não lida (AGENT_ARIA_URL/USER/PASSWORD) — volume de conversas e custo desconhecidos');
  if (ctx.ariaDesatualizada) r.achados.push(achado({ chave: 'suporte.redeploy_fluxo7', severidade: 'media', titulo: 'Atendimento em produção sem as instruções novas', evidencia: 'a versão publicada não reconhece pedidos de remoção nem orienta sobre a conta do restaurante', fonte: 'repo', acao_proposta: 'publicar a nova versão do atendimento', dono: 'você' }));
  return r;
}

// ---------------- Editorial / Financeiro (só via API) ----------------
function viaApi(agente, chave, ctx, urlEnv) {
  const r = base(agente, ctx.trace);
  const k = ctx.kpis?.[chave];
  if (k && k.status === 'ok') { r.cobertura.fontes.push(`${chave} API`); Object.assign(r.kpis, Object.fromEntries(Object.entries(k).filter(([, v]) => typeof v !== 'object').slice(0, 20))); }
  else { r.status = 'sem_credencial'; r.cobertura.lacunas.push(`falta a senha de acesso para eu enxergar esta área`); }
  return r;
}

// ---------------- Central ----------------
function central(ctx) {
  const r = base('central', ctx.trace);
  const S = ctx.stateDir;
  const apr = lerJsonl(path.join(S, 'aprovacoes.jsonl')).filter((a) => a.status === 'pendente');
  const acoes = lerJsonl(path.join(S, 'acoes.jsonl')).filter((a) => a.status === 'aberta');
  const perguntas = lerJsonl(path.join(S, 'perguntas.jsonl')).filter((q) => q.status === 'aberta');
  const backlog = lerJsonl(path.join(S, 'backlog.jsonl'));
  r.cobertura.fontes.push('aprovacoes.jsonl, acoes.jsonl, perguntas.jsonl, backlog.jsonl');
  Object.assign(r.kpis, { aprovacoes_pendentes: apr.length, acoes_abertas: acoes.length, perguntas_abertas: perguntas.length, perguntas_bloqueantes: perguntas.filter((q) => /bloqueante/.test(q.tipo)).length, backlog_em_construcao: backlog.filter((b) => b.status === 'em_construcao').length });
  r.aprovacoes_pendentes = apr.map((a) => ({ id: a.id, titulo: a.titulo, tipo: a.tipo, desde: a.criado_em }));
  for (const q of perguntas.filter((x) => /bloqueante/.test(x.tipo))) r.achados.push(achado({ chave: `central.pergunta.${q.id}`, severidade: 'media', titulo: `Pergunta esperando sua resposta: ${q.pergunta}`, evidencia: `por enquanto seguimos assumindo: ${q.suposicao}`, fonte: 'perguntas.jsonl', acao_proposta: 'responder este e-mail', dono: 'você' }));
  const antigas = apr.filter((a) => Date.now() - Date.parse(a.criado_em) > 48 * 3600000);
  if (antigas.length) r.achados.push(achado({ chave: 'central.aprovacoes_paradas', severidade: 'alta', titulo: `${antigas.length} pedido(s) de autorização parados há mais de 2 dias`, evidencia: antigas.map((a) => a.titulo).join('; ').slice(0, 300), fonte: 'aprovacoes.jsonl', acao_proposta: 'responder sim ou não a este e-mail', dono: 'você' }));
  return r;
}

async function coletarTudo(ctx) {
  const relatos = [];
  ctx.ariaDesatualizada = await ariaDesatualizada();
  relatos.push(await dba(ctx));
  relatos.push(guardiao(ctx));
  relatos.push(await registroOptout(ctx));
  relatos.push(comercial(ctx));
  relatos.push(suporte(ctx));
  relatos.push(viaApi('editorial', 'editorial', ctx, 'AGENT_QUILL_URL'));
  relatos.push(viaApi('financeiro', 'financeiro', ctx, 'AGENT_ATLAS_URL'));
  relatos.push(central(ctx));
  return relatos;
}

/** A versão publicada do atendimento reconhece pedidos de remoção? (2 s de timeout; na dúvida, não acusa) */
async function ariaDesatualizada() {
  const base = process.env.AGENT_ARIA_URL || 'https://theworldkeys-aria-whatsapp-agent.xis4ee.easypanel.host';
  try {
    const ctl = AbortSignal.timeout(4000);
    const r = await fetch(base + '/health', { signal: ctl });
    if (!r.ok) return false;
    const j = await r.json().catch(() => ({}));
    return j.fluxo7 === false;
  } catch { return false; }
}

module.exports = { coletarTudo, dba, guardiao, registroOptout, comercial, suporte, central, compromissosVencendo };
