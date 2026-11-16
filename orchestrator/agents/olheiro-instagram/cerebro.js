'use strict';
/**
 * Olheiro do Instagram — cérebro. Funções puras, sem rede e sem LLM: recebem a coleta e o estado, devolvem
 * estado novo, diário no formato da skill, alertas, fila de comentários, resumo e relato ao MAESTRO.
 *
 * O que cada número significa está escrito ao lado dele. Regras da casa:
 *   - métrica ausente é lacuna declarada, nunca zero;
 *   - alerta de desempenho só com 3+ posts comparáveis na MESMA idade; sem isso, lacuna;
 *   - o relato não leva texto de comentário nem nome de ninguém: só ids, contagens e horas.
 */

const DIA = 86_400_000;
const H = 3_600_000;
/** Minutos sem resposta para um pedido de reserva virar aviso ao Julien e achado no relato (fundador, 14/11). */
const LIMITE_RESERVA_MIN = Number(process.env.OLHEIRO_LIMITE_RESERVA_MIN) > 0 ? Number(process.env.OLHEIRO_LIMITE_RESERVA_MIN) : 30;

// ---------------------------------------------------------------- utilidades
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
function mediana(v) { const a = v.filter((x) => Number.isFinite(x)).sort((x, y) => x - y); if (!a.length) return null; const m = Math.floor(a.length / 2); return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; }
const arred = (x, c = 2) => (Number.isFinite(x) ? Math.round(x * 10 ** c) / 10 ** c : null);
const diaParis = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
const horaParis = (iso) => new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Paris', hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(iso));

const LUGARES = ['Monte-Carlo', 'Monaco', 'Nice', 'Cannes', 'Antibes', 'Juan-les-Pins', 'Saint-Tropez', 'Menton', 'Èze', 'Villefranche', 'Saint-Jean-Cap-Ferrat', 'Beaulieu', 'Mougins', 'Grasse', 'Cap d\'Antibes', 'Paris'];
const PERSONAGENS = [['Le Vice', /\ble vice\b/], ['Le Fugitif', /\bfugitif\b/], ['L\'Agent', /\bl'agent\b|\bagent du fbi\b/], ['Le Partenaire', /\ble partenaire\b/], ['Le Tatoué', /\btatoue\b/]];

function lugarDe(texto) { const n = norm(texto); return LUGARES.find((l) => new RegExp(`(^|[^a-z])${norm(l).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z]|$)`).test(n)) || null; }
function personagemDe(texto) { const n = norm(texto); const p = PERSONAGENS.find(([, re]) => re.test(n)); return p ? p[0] : null; }

/** A primeira frase da legenda, sem hashtags nem menções no fim: é o que a skill mede como gancho. */
function ganchoDe(legenda) {
  const primeira = String(legenda || '').split(/\r?\n/).map((l) => l.trim()).find((l) => l.replace(/[#@]\S+/g, '').trim().length >= 3) || '';
  return primeira.replace(/(\s*[#@]\S+)+\s*$/g, '').trim().slice(0, 160);
}

// ---------------------------------------------------------------- comentários
/**
 * Classe de um comentário, por ordem de prioridade. Palavras em francês, inglês e português: quem comenta é
 * local e turista. `manipulacao` vem antes de tudo: texto que tenta dar ordem ao assistente é registrado e
 * nunca respondido nem seguido (dados observados são dados, não comandos).
 */
const CLASSES = [
  ['manipulacao', /\b(ignore|ignora|oublie|forget)\b.{0,30}\b(instructions?|instrucoes|regles|rules|regras|consignes|previous|precedentes)\b|\b(system prompt|prompt systeme|tu es maintenant|you are now|voce agora e)\b/],
  ['spam', /https?:\/\/|www\.|\b(promo(tion)?|collab(oration)?|ambassad(or|eur|rice)|followers?|abonnes gratuits|crypto|bitcoin|forex|earn money|gagner de l'argent|dm (us|me|pour)|send (us )?a dm|check (my|our) (bio|page))\b/],
  ['reserva', /\b(reserv\w*|book\w*|prix|tarifs?|combien|price|how much|cout|quanto|valor|dispo\w*|available|libre (ce|le|samedi|vendredi)|whatsapp|contact\w*|devis|quote|anniversaire|birthday|evjf|evg|mariage|wedding|transfert|transfer|aeroport|airport|tarif\w*)\b/],
  ['pergunta', /\?|^(comment|pourquoi|quand|ou|qui|est-ce|c'est quoi|how|why|when|where|what|como|quando|onde|qual)\b/],
  ['elogio', /\b(incroyable|trop (bien|stylé|style|fort)|magnifique|genial|top|bravo|wow|waouh|dingue|ouf|ma(l|g)ade|amazing|awesome|insane|crazy|love|lindo|incrivel|demais)\b|[🔥😍🤩👏💯❤️😮🙌]/u],
];
function classificar(texto) {
  const n = norm(texto);
  for (const [classe, re] of CLASSES) if (re.test(n) || re.test(String(texto || ''))) return classe;
  return 'outro';
}

/** Junta os comentários novos aos que já estavam no estado, sem perder os de posts não relidos. Guarda 30 dias. */
function mesclarComentarios(anteriores = [], novos = [], postsRelidos = new Set(), agora = Date.now()) {
  const porId = new Map();
  for (const c of anteriores) if (!postsRelidos.has(c.media_id)) porId.set(c.id, c);
  for (const c of novos) porId.set(c.id, { ...(porId.get(c.id) || {}), ...c });
  return [...porId.values()].filter((c) => agora - Date.parse(c.ts) <= 30 * DIA).map((c) => ({ ...c, classe: classificar(c.texto) }));
}

/** Fila do que espera resposta: reserva primeiro, depois pergunta, depois o resto. Spam e manipulação ficam fora. */
function filaComentarios(comentarios, posts, agora = Date.now()) {
  const ordem = { reserva: 0, pergunta: 1, elogio: 2, outro: 3 };
  const linkDe = new Map(Object.values(posts || {}).map((p) => [p.id, p.permalink]));
  return comentarios
    .filter((c) => c.respondido !== true && ordem[c.classe] !== undefined)
    .map((c) => ({ id: c.id, post: c.media_id, link_post: linkDe.get(c.media_id) || null, classe: c.classe, texto: c.texto, ts: c.ts, horas: Math.round((agora - Date.parse(c.ts)) / H), minutos: Math.floor((agora - Date.parse(c.ts)) / 60_000), resposta_privada_ate: new Date(Date.parse(c.ts) + 7 * DIA).toISOString(), resposta_conhecida: c.respondido !== null }))
    .sort((a, b) => ordem[a.classe] - ordem[b.classe] || b.horas - a.horas);
}

// ---------------------------------------------------------------- estado
/** Estado novo a partir do anterior e da coleta: histórico de métricas por post e da conta. */
function estadoNovo(anterior = {}, coleta, agora = Date.parse(coleta.ts)) {
  const posts = {};
  const antPosts = anterior.posts || {};
  for (const p of coleta.posts) {
    const ant = antPosts[p.id] || {};
    const historico = [...(ant.historico || [])];
    if (p.metricas_em && p.metricas_em !== ant.metricas_em) {
      historico.push({ ts: p.metricas_em, idade_h: Math.round((Date.parse(p.metricas_em) - Date.parse(p.timestamp)) / H), views: p.metricas.views ?? null, reach: p.metricas.reach ?? null, saved: p.metricas.saved ?? null, shares: p.metricas.shares ?? null, likes: p.metricas.likes ?? p.like_count ?? null });
    }
    posts[p.id] = { id: p.id, tipo: p.tipo, media_type: p.media_type, permalink: p.permalink, timestamp: p.timestamp, legenda: String(p.caption || '').slice(0, 2200), like_count: p.like_count ?? null, comments_count: p.comments_count ?? null, metricas: p.metricas, metricas_em: p.metricas_em, comentarios_em: p.comentarios_em || null, historico: historico.slice(-60) };
  }
  const stories = { ...(anterior.stories || {}) };
  for (const s of coleta.stories || []) stories[s.id] = { id: s.id, media_type: s.media_type, permalink: s.permalink, timestamp: s.timestamp, metricas: { ...((stories[s.id] || {}).metricas || {}), ...s.metricas } };
  for (const [id, s] of Object.entries(stories)) if (agora - Date.parse(s.timestamp) > 90 * DIA) delete stories[id];

  const relidos = new Set(coleta.posts.filter((p) => p.comentarios_relidos).map((p) => p.id));
  const dia = diaParis(coleta.ts);
  const contaHist = (anterior.conta_historico || []).filter((x) => x.dia !== dia);
  contaHist.push({ dia, seguidores: coleta.conta.seguidores, posts: coleta.conta.posts, ...(coleta.conta_dia ? { dia_anterior: coleta.conta_dia } : {}) });
  const marc = new Map((anterior.marcacoes || []).map((m) => [m.id, m]));
  for (const m of coleta.marcacoes || []) marc.set(m.id, m);

  return {
    versao: 1, atualizado_em: coleta.ts, conta: coleta.conta, publico: coleta.publico || anterior.publico || null,
    posts, stories, comentarios: mesclarComentarios(anterior.comentarios, coleta.comentarios, relidos, agora),
    marcacoes: [...marc.values()].filter((m) => agora - Date.parse(m.ts) <= 90 * DIA),
    concorrentes: (coleta.concorrentes && coleta.concorrentes.length) ? coleta.concorrentes : anterior.concorrentes || [],
    conta_historico: contaHist.slice(-180), metricas_recusadas: coleta.metricas_recusadas || anterior.metricas_recusadas || {},
    ultima_coleta: { ts: coleta.ts, chamadas: coleta.chamadas, lacunas: coleta.lacunas },
    alertas_reserva: podarAlertados(anterior.alertas_reserva, agora),
    ultima_vigia: anterior.ultima_vigia || null,
  };
}

// ---------------------------------------------------------------- aviso ao Julien (vigia de comentários)
/** Guarda 7 dias de avisos já dados, por id de comentário: o mesmo pedido nunca gera dois avisos. */
function podarAlertados(mapa = {}, agora = Date.now()) {
  const out = {};
  for (const [id, a] of Object.entries(mapa || {})) if (agora - Date.parse(a.em) <= 7 * DIA) out[id] = a;
  return out;
}

/**
 * Pedidos de reserva sem resposta da conta há LIMITE_RESERVA_MIN minutos ou mais, feitos nas últimas 24 h, ainda
 * não avisados. Agrupa por post: um aviso por post, com o link. Comentário de mais de 24 h não gera aviso (ao
 * ligar o Olheiro, o atraso antigo não vira rajada de mensagens; ele aparece no relato).
 */
function pedidosParaAvisar(estado, agora = Date.now(), limiteMin = LIMITE_RESERVA_MIN) {
  const avisados = estado.alertas_reserva || {};
  const fila = filaComentarios(estado.comentarios || [], estado.posts, agora)
    .filter((c) => c.classe === 'reserva' && c.minutos >= limiteMin && c.minutos <= 24 * 60 && !avisados[c.id]);
  const porPost = new Map();
  for (const c of fila) {
    const g = porPost.get(c.post) || { post: c.post, link: c.link_post, comentarios: [] };
    g.comentarios.push(c.id);
    porPost.set(c.post, g);
  }
  return [...porPost.values()];
}

/**
 * Junta o que a vigia leu ao estado: contagens e comentários dos posts relidos, e o esqueleto dos posts novos
 * (publicados depois da leitura diária), para o aviso ter o link do post.
 */
function aplicarVigia(estado = {}, vigia, agora = Date.parse(vigia.ts)) {
  const posts = { ...(estado.posts || {}) };
  for (const m of vigia.recentes || []) {
    const p = posts[m.id] || { id: m.id, tipo: m.media_product_type === 'REELS' ? 'REELS' : 'FEED', media_type: m.media_type, permalink: m.permalink, timestamp: m.timestamp, legenda: '', metricas: {}, historico: [] };
    posts[m.id] = { ...p, permalink: m.permalink || p.permalink, ...(vigia.relidos.includes(m.id) ? { comments_count: m.comments_count, comentarios_em: vigia.ts } : {}) };
  }
  return {
    ...estado, posts, conta: estado.conta || { username: vigia.username },
    comentarios: mesclarComentarios(estado.comentarios, vigia.comentarios, new Set(vigia.relidos), agora),
    alertas_reserva: podarAlertados(estado.alertas_reserva, agora),
    ultima_vigia: { ts: vigia.ts, chamadas: vigia.chamadas, relidos: vigia.relidos.length, lacunas: vigia.lacunas },
  };
}

/**
 * O texto do aviso, como o fundador pediu. Em francês por padrão (14/11: o Julien lê francês; vai no template
 * twk_team_alert); `pt` mantém a frase original. Plural quando há mais de um pedido no mesmo post.
 */
function textoAviso(g, idioma = 'fr') {
  const n = g.comentarios.length;
  const alvo = g.link || `post ${g.post}`;
  if (idioma === 'pt') return n === 1 ? `Tem um pedido de reserva não respondido nesse post: ${alvo}` : `Tem ${n} pedidos de reserva não respondidos nesse post: ${alvo}`;
  return n === 1 ? `Il y a une demande de réservation sans réponse sur ce post : ${alvo}` : `Il y a ${n} demandes de réservation sans réponse sur ce post : ${alvo}`;
}

// ---------------------------------------------------------------- diário no formato da skill
const FORMATO = { REELS: 'reel', FEED: 'post', STORY: 'story' };
/**
 * Uma linha por post no formato do `journal.jsonl` da skill (wc.js): id, date, plateforme, format, accroche,
 * vues, portee, enregistrements, partages, commentaires, abonnes. Campos novos ficam ao lado (a skill ignora o
 * que não conhece). As anotações da pessoa (pilier, personnage, ville, ecran) vencem o que foi inferido.
 */
function linhaDiario(p, anot = {}) {
  const m = p.metricas || {};
  const legenda = p.legenda || '';
  const formato = p.tipo === 'FEED' ? (p.media_type === 'CAROUSEL_ALBUM' ? 'carrousel' : p.media_type === 'VIDEO' ? 'video' : 'post') : FORMATO[p.tipo] || 'post';
  const linha = {
    id: `IG-${p.id}`, ig_media_id: p.id, origem: 'api', date: diaParis(p.timestamp), heure: horaParis(p.timestamp), plateforme: 'instagram', format: formato,
    accroche: anot.accroche || ganchoDe(legenda) || null, ecran: anot.ecran || null,
    personnage: anot.personnage || personagemDe(legenda), pilier: anot.pilier || null, ville: anot.ville || lugarDe(legenda), lien: p.permalink || null,
    vues: m.views ?? null, portee: m.reach ?? null, enregistrements: m.saved ?? null, partages: m.shares ?? null,
    commentaires: m.comments ?? p.comments_count ?? null, likes: m.likes ?? p.like_count ?? null, abonnes: m.follows ?? null, visites_profil: m.profile_visits ?? null,
    temps_moyen_s: Number.isFinite(m.ig_reels_avg_watch_time) ? arred(m.ig_reels_avg_watch_time / 1000, 1) : null,
    mesure_le: p.metricas_em || null,
  };
  for (const k of Object.keys(linha)) if (linha[k] === null) delete linha[k];
  return linha;
}
function diario(estado, anotacoes = {}) {
  return Object.values(estado.posts || {}).sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp))).map((p) => linhaDiario(p, anotacoes[`IG-${p.id}`] || anotacoes[p.id] || {}));
}

// ---------------------------------------------------------------- alertas de desempenho
/** Visualizações de um post quando ele tinha `idade_h` horas (a foto mais próxima, até 12 h de diferença). */
function viewsNaIdade(post, idadeH) {
  let melhor = null;
  for (const h of post.historico || []) if (Number.isFinite(h.views) && Math.abs(h.idade_h - idadeH) <= 12 && (!melhor || Math.abs(h.idade_h - idadeH) < Math.abs(melhor.idade_h - idadeH))) melhor = h;
  return melhor ? melhor.views : null;
}

function alertas(estado, agora = Date.now()) {
  const lista = []; const lacunas = [];
  const posts = Object.values(estado.posts || {});
  for (const p of posts) {
    const idade = (agora - Date.parse(p.timestamp)) / H;
    const atual = p.metricas && p.metricas.views;
    if (idade < 12 || idade > 96 || !Number.isFinite(atual)) continue;
    const ultimo = (p.historico || [])[p.historico.length - 1];
    const idadeMedida = ultimo ? ultimo.idade_h : Math.round(idade);
    const pares = posts.filter((o) => o.id !== p.id && o.tipo === p.tipo && Date.parse(o.timestamp) < Date.parse(p.timestamp)).map((o) => viewsNaIdade(o, idadeMedida)).filter(Number.isFinite);
    if (pares.length < 3) { lacunas.push(`post ${p.id}: só ${pares.length} post(s) comparáveis na mesma idade; alerta precisa de 3`); continue; }
    const med = mediana(pares);
    if (!med) continue;
    const mult = arred(atual / med, 1);
    const base = { post: p.id, link: p.permalink, gancho: ganchoDe(p.legenda), idade_h: idadeMedida, views: atual, mediana_mesma_idade: med, multiplo: mult, comparados: pares.length };
    if (mult >= 2) lista.push({ tipo: 'decolando', ...base, sugestao: 'Gravar a continuação em até 48 h, com o mesmo gancho e a mesma cidade na tela.' });
    else if (idadeMedida >= 48 && mult <= 0.5) lista.push({ tipo: 'abaixo', ...base, sugestao: 'Não repetir este gancho. Comparar com o melhor do mês no Studio antes do próximo.' });
  }
  // seguidores: ganho de ontem contra a mediana dos 14 dias anteriores
  const hist = estado.conta_historico || [];
  const ganhos = []; for (let i = 1; i < hist.length; i++) if (Number.isFinite(hist[i].seguidores) && Number.isFinite(hist[i - 1].seguidores)) ganhos.push({ dia: hist[i].dia, ganho: hist[i].seguidores - hist[i - 1].seguidores });
  if (ganhos.length >= 8) {
    const ult = ganhos[ganhos.length - 1]; const med = mediana(ganhos.slice(-15, -1).map((g) => g.ganho));
    if (ult.ganho >= 20 && med !== null && ult.ganho >= 3 * Math.max(med, 1)) lista.push({ tipo: 'seguidores', dia: ult.dia, ganho: ult.ganho, mediana_14d: med, sugestao: 'Ver qual post puxou os seguidores e fixá-lo no topo do perfil.' });
  }
  return { lista, lacunas };
}

// ---------------------------------------------------------------- contas de referência
/** Posts de outras contas acima de 3× a mediana de curtidas da própria conta. Curtidas, não visualizações: a Meta não mostra as visualizações de outras contas. */
function referencias(concorrentes = []) {
  const sinais = [];
  for (const c of concorrentes) {
    const med = mediana(c.posts.map((p) => p.curtidas));
    if (!med || c.posts.length < 5) continue;
    for (const p of c.posts) { const mult = arred(p.curtidas / med, 1); if (mult >= 3) sinais.push({ conta: c.conta, multiplo: mult, curtidas: p.curtidas, mediana_conta: med, gancho: ganchoDe(p.legenda), tipo: p.tipo, link: p.link, ts: p.ts }); }
  }
  return sinais.sort((a, b) => b.multiplo - a.multiplo).slice(0, 20);
}

// ---------------------------------------------------------------- resumo (o que a Central e o chat leem)
function resumo(estado, { anotacoes = {}, agora = Date.now() } = {}) {
  const posts = Object.values(estado.posts || {});
  const recentes = posts.filter((p) => agora - Date.parse(p.timestamp) <= 30 * DIA);
  const reels30 = recentes.filter((p) => p.tipo === 'REELS');
  const fila = filaComentarios(estado.comentarios || [], estado.posts, agora);
  const al = alertas(estado, agora);
  const hist = estado.conta_historico || [];
  const seteAtras = hist.find((h) => h.dia === diaParis(new Date(agora - 7 * DIA).toISOString()));
  const seg = estado.conta && estado.conta.seguidores;
  const linhas = diario(estado, anotacoes);
  const comViews = linhas.filter((l) => Number.isFinite(l.vues));
  const medGeral = mediana(comViews.map((l) => l.vues));
  const top = comViews.filter((l) => agora - Date.parse(`${l.date}T12:00:00Z`) <= 30 * DIA).map((l) => ({ id: l.id, date: l.date, format: l.format, accroche: l.accroche, vues: l.vues, multiplo: medGeral ? arred(l.vues / medGeral, 1) : null, lien: l.lien })).sort((a, b) => b.vues - a.vues);
  return {
    atualizado_em: estado.atualizado_em, conta: estado.conta,
    numeros: {
      seguidores: seg ?? null, seguidores_7d: seteAtras && Number.isFinite(seg) ? seg - seteAtras.seguidores : null,
      posts_30d: recentes.length, reels_30d: reels30.length, mediana_views_reels_30d: mediana(reels30.map((p) => p.metricas && p.metricas.views)),
      mediana_views_geral: medGeral, comentarios_esperando: fila.length, pedidos_reserva_esperando: fila.filter((c) => c.classe === 'reserva').length,
      tentativas_manipulacao_30d: (estado.comentarios || []).filter((c) => c.classe === 'manipulacao').length,
      marcacoes_7d: (estado.marcacoes || []).filter((m) => agora - Date.parse(m.ts) <= 7 * DIA).length,
      ontem: (hist[hist.length - 1] || {}).dia_anterior || null,
    },
    melhores_30d: top.slice(0, 5), piores_30d: top.slice(-3).reverse(), alertas: al.lista, publico: estado.publico || null,
    referencias: referencias(estado.concorrentes), fila_comentarios: fila.slice(0, 50),
    lacunas: [...((estado.ultima_coleta && estado.ultima_coleta.lacunas) || []), ...al.lacunas.slice(0, 5)],
    diario_posts: linhas.length,
  };
}

// ---------------------------------------------------------------- relato ao MAESTRO (sem PII)
function relato(r, { status = 'ok', erro = null, tokenExpiraEm = null, agora = Date.now() } = {}) {
  const dia = new Date(agora).toISOString().slice(0, 10);
  const rel = { agente: 'olheiro-instagram', ts: new Date(agora).toISOString(), trace_id: `trc-olheiro-${dia.replace(/-/g, '')}`, status, kpis: {}, sinais_conversao: [], experiencia: [], achados: [], acoes_autonomas: [], aprovacoes_pendentes: [], cobertura: { fontes: [], lacunas: [] } };
  const achado = (o) => rel.achados.push({ autonomia: 'requer_aprovacao_humana', dono: 'você', fonte: 'olheiro-instagram', ...o });
  if (tokenExpiraEm) {
    const dias = Math.floor((Date.parse(tokenExpiraEm) - agora) / DIA);
    if (dias < 0) achado({ chave: 'olheiro.token_vencido', severidade: 'critica', titulo: 'A chave do Instagram venceu: o Olheiro parou de ler a conta', evidencia: `IG_TOKEN_EXPIRA_EM=${tokenExpiraEm}`, acao_proposta: 'renovar a chave (runbook olheiro-instagram, passo "Renovar a chave") e trocar no Easypanel', prazo: 'hoje' });
    else if (dias <= 10) achado({ chave: 'olheiro.token_vencendo', severidade: 'alta', titulo: `A chave do Instagram vence em ${dias} dia(s)`, evidencia: `IG_TOKEN_EXPIRA_EM=${tokenExpiraEm}`, acao_proposta: 'renovar a chave (runbook olheiro-instagram) e trocar no Easypanel', prazo: tokenExpiraEm });
  }
  if (!r) {
    rel.cobertura.lacunas.push(erro || 'sem leitura da conta');
    if (status === 'sem_credencial') achado({ chave: 'olheiro.sem_credencial', severidade: 'alta', titulo: 'O Olheiro do Instagram não consegue ler a conta (chave ausente, vencida ou sem permissão)', evidencia: String(erro || '').slice(0, 200), acao_proposta: 'conferir IG_ACCESS_TOKEN e IG_USER_ID no Easypanel (runbook olheiro-instagram)' });
    return rel;
  }
  rel.cobertura.fontes.push(`API do Instagram (só leitura) · conta @${(r.conta && r.conta.username) || '?'}`);
  rel.cobertura.lacunas.push(...r.lacunas.slice(0, 10));
  if (r.lacunas.length && status === 'ok') rel.status = 'parcial';
  const n = r.numeros;
  rel.kpis = { seguidores: n.seguidores, seguidores_7d: n.seguidores_7d, posts_30d: n.posts_30d, reels_30d: n.reels_30d, mediana_views_reels_30d: n.mediana_views_reels_30d, comentarios_esperando: n.comentarios_esperando, pedidos_reserva_esperando: n.pedidos_reserva_esperando, marcacoes_7d: n.marcacoes_7d };
  rel.sinais_conversao.push({ tipo: 'pedidos_reserva_nos_comentarios', valor: n.pedidos_reserva_esperando, detalhe: 'comentários que pedem preço, data ou reserva e ainda sem resposta da conta', fonte: 'instagram' });
  if (Number.isFinite(n.seguidores_7d)) rel.sinais_conversao.push({ tipo: 'seguidores_novos_7d', valor: n.seguidores_7d, fonte: 'instagram' });
  const reservas = r.fila_comentarios.filter((c) => c.classe === 'reserva');
  for (const c of reservas.slice(0, 10)) rel.experiencia.push({ tipo: 'comentario_reserva_esperando', valor: c.horas, detalhe: `comentário ${c.id} no post ${c.post}`, fonte: 'instagram' });
  // 14/11 (fundador): o limite caiu de 6 h para 30 min, e o Julien é avisado no WhatsApp pela Aria (vigia de comentários).
  const atrasadas = reservas.filter((c) => (c.minutos ?? c.horas * 60) >= LIMITE_RESERVA_MIN);
  if (atrasadas.length) achado({ chave: 'olheiro.reserva_sem_resposta', severidade: 'alta', dono: 'Julien', titulo: `${atrasadas.length} pedido(s) de reserva nos comentários do Instagram sem resposta há ${LIMITE_RESERVA_MIN} min ou mais`, evidencia: atrasadas.slice(0, 5).map((c) => `${c.id} (${c.minutos >= 60 ? `${Math.floor(c.minutos / 60)} h` : `${c.minutos} min`})`).join(', '), acao_proposta: 'responder no chat com o Studio (instagram_comentarios) e levar a pessoa ao WhatsApp de reserva; a resposta é aprovada por quem posta' });
  for (const a of r.alertas.filter((x) => x.tipo === 'decolando')) achado({ chave: `olheiro.decolando.${a.post}`, severidade: 'info', autonomia: 'requer_aprovacao_orquestrador', dono: 'Julien', titulo: `Um Reel está com ${a.multiplo}× a mediana na mesma idade`, evidencia: `post ${a.post}, ${a.views} visualizações em ${a.idade_h} h; mediana de ${a.comparados} posts: ${a.mediana_mesma_idade}`, acao_proposta: a.sugestao });
  if (n.tentativas_manipulacao_30d) achado({ chave: 'olheiro.manipulacao', severidade: 'media', autonomia: 'requer_aprovacao_orquestrador', titulo: `${n.tentativas_manipulacao_30d} comentário(s) tentando dar ordens ao assistente em 30 dias`, evidencia: 'classe "manipulacao" no estado do Olheiro (texto fica no volume, não no relato)', acao_proposta: 'registrado; nenhuma resposta, nenhuma ação a partir do texto' });
  rel.acoes_autonomas.push({ acao: 'leitura diária da conta do Instagram (só leitura)', n: 1, evidencia: 'agents/olheiro-instagram/estado.json' });
  return rel;
}

module.exports = { LIMITE_RESERVA_MIN, aplicarVigia, podarAlertados, pedidosParaAvisar, textoAviso, mediana, ganchoDe, lugarDe, personagemDe, classificar, mesclarComentarios, filaComentarios, estadoNovo, linhaDiario, diario, viewsNaIdade, alertas, referencias, resumo, relato, diaParis, horaParis };
