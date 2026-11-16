'use strict';
/**
 * Olheiro do Instagram — coleta. Uma rodada lê, pela API oficial e só com GET:
 *   conta (seguidores, posts) · métricas do dia da conta · público (semanal) · posts e Reels com métricas ·
 *   stories no ar · comentários (sem nome de usuário) · marcações da conta · contas de referência (só login Facebook).
 *
 * Política de chamadas (a Meta limita por hora):
 *   - métricas de post: todo dia nos primeiros 30 dias; depois, uma vez por semana;
 *   - comentários: só de posts com até 30 dias e cuja contagem mudou desde a última rodada;
 *   - público: uma vez por semana;
 *   - métrica recusada por tipo de mídia: não é pedida de novo por 30 dias.
 *
 * Privacidade: o nome de quem comenta é lido só para saber se a resposta veio da própria conta, e é descartado
 * aqui. Nada de nome, foto ou perfil de pessoa física sai desta função.
 */

const DIA = 86_400_000;

const METRICAS = {
  REELS: ['views', 'reach', 'likes', 'comments', 'saved', 'shares', 'total_interactions', 'ig_reels_avg_watch_time', 'ig_reels_video_view_total_time', 'follows', 'profile_visits'],
  FEED: ['views', 'reach', 'likes', 'comments', 'saved', 'shares', 'total_interactions', 'follows', 'profile_visits'],
  STORY: ['views', 'reach', 'replies', 'shares', 'total_interactions', 'follows', 'profile_visits'],
};
const METRICAS_CONTA = ['reach', 'views', 'accounts_engaged', 'total_interactions', 'likes', 'comments', 'shares', 'saves', 'replies', 'follows_and_unfollows', 'profile_links_taps'];
const CAMPOS_POST = 'id,caption,media_type,media_product_type,permalink,timestamp,like_count,comments_count';

const tipoDe = (m) => (m.media_product_type === 'REELS' ? 'REELS' : m.media_product_type === 'STORY' ? 'STORY' : 'FEED');

function metricasPedidas(tipo, anterior, agora) {
  const recusadas = (anterior.metricas_recusadas && anterior.metricas_recusadas[tipo]) || {};
  return METRICAS[tipo].filter((m) => !(recusadas[m] && agora - Date.parse(recusadas[m]) < 30 * DIA));
}

function precisaMetricas(post, anteriorPost, agora) {
  if (!anteriorPost || !anteriorPost.metricas_em) return true;
  const idade = agora - Date.parse(post.timestamp);
  const desde = agora - Date.parse(anteriorPost.metricas_em);
  return idade < 30 * DIA ? desde > 6 * 3600_000 : desde > 7 * DIA;
}

/**
 * Comentários de um post, sem o nome de quem comentou. O nome é lido só para saber se a resposta veio da própria
 * conta (`respondido`) e é descartado aqui. Devolve null quando não deu para ler (a lacuna fica registrada).
 */
async function lerComentariosDoPost(cli, postId, contaUser, lacunas) {
  let lista;
  try {
    lista = await cli.paginar(`${postId}/comments`, { fields: 'id,text,timestamp,like_count,username,replies{username}' }, 200);
  } catch (e) {
    if (e.credencial) throw e;
    try { lista = await cli.paginar(`${postId}/comments`, { fields: 'id,text,timestamp,like_count' }, 200); lacunas.push('comentários sem a informação de resposta (permissão de comentários ausente?)'); }
    catch (e2) { if (e2.credencial) throw e2; lacunas.push(`comentários do post ${postId}: ${e2.message}`); return null; }
  }
  const out = [];
  for (const c of lista) {
    if (c.username && String(c.username).toLowerCase() === contaUser) continue; // a própria conta não é pedido
    const respostas = (c.replies && c.replies.data) || [];
    out.push({
      id: c.id, media_id: postId, texto: String(c.text || '').slice(0, 1000), ts: c.timestamp, curtidas: c.like_count || 0,
      respondido: c.username === undefined ? null : respostas.some((r) => String(r.username || '').toLowerCase() === contaUser),
    });
  }
  return out;
}

/**
 * Vigia de comentários (14/11): rodada curta, a cada poucos minutos. Lê os 25 posts mais recentes e relê os
 * comentários só de quem mudou de contagem ou ainda tem pedido de reserva sem resposta (para saber se o Julien
 * já respondeu). Poucas chamadas por rodada: a Meta limita por hora.
 */
async function coletarComentarios(cli, anterior = {}, opts = {}) {
  const agora = opts.agora || Date.now();
  const lacunas = [];
  const uid = cli.userId;
  let username = anterior.conta && anterior.conta.username;
  if (!username) username = (await cli.get(uid, { fields: 'id,username' })).username;
  const contaUser = String(username || '').toLowerCase();
  const recentes = ((await cli.get(`${uid}/media`, { fields: 'id,permalink,timestamp,comments_count,media_type,media_product_type', limit: 25 })).data) || [];
  const comPendencia = new Set((anterior.comentarios || []).filter((c) => c.classe === 'reserva' && c.respondido !== true && agora - Date.parse(c.ts) <= DIA).map((c) => c.media_id));
  const relidos = []; const comentarios = [];
  for (const m of recentes) {
    if (agora - Date.parse(m.timestamp) > 30 * DIA || !m.comments_count) continue;
    const ant = (anterior.posts || {})[m.id];
    const mudou = !ant || ant.comments_count !== m.comments_count;
    if (!mudou && !comPendencia.has(m.id)) continue;
    const lidos = await lerComentariosDoPost(cli, m.id, contaUser, lacunas);
    if (!lidos) continue;
    relidos.push(m.id);
    comentarios.push(...lidos);
  }
  return { ts: new Date(agora).toISOString(), username, recentes, relidos, comentarios, lacunas, chamadas: cli.chamadas() };
}

/**
 * @param {ReturnType<import('./api').criarCliente>} cli
 * @param {object} anterior estado.json da rodada anterior (ou {})
 * @param {{ agora?: number, maxPosts?: number, concorrentes?: string[] }} opts
 */
async function coletar(cli, anterior = {}, opts = {}) {
  const agora = opts.agora || Date.now();
  const lacunas = [];
  const recusadasNovas = {};
  const marcarRecusa = (tipo, lista) => { for (const m of lista) { (recusadasNovas[tipo] = recusadasNovas[tipo] || {})[m] = new Date(agora).toISOString(); } };
  const anteriorPosts = anterior.posts || {};
  const uid = cli.userId;

  // ── conta ──
  const conta = await cli.get(uid, { fields: 'id,username,name,followers_count,follows_count,media_count' });

  // ── métricas de ontem da conta ──
  let contaDia = null;
  try {
    const ate = Math.floor(new Date(new Date(agora).toISOString().slice(0, 10)).getTime() / 1000);
    const r = await cli.insights(uid, METRICAS_CONTA, { period: 'day', metric_type: 'total_value', since: ate - 86400, until: ate });
    contaDia = r.valores;
    if (r.rejeitadas.length) lacunas.push(`métricas da conta recusadas pela Meta: ${r.rejeitadas.join(', ')}`);
  } catch (e) { if (e.credencial) throw e; lacunas.push(`métricas da conta: ${e.message}`); }

  // ── público (semanal; a Meta só entrega com 100+ seguidores) ──
  let publico = anterior.publico || null;
  const publicoVelho = !publico || agora - Date.parse(publico.em || 0) > 7 * DIA;
  if (publicoVelho) {
    const novo = { em: new Date(agora).toISOString() };
    for (const quebra of ['city', 'country', 'age', 'gender']) {
      try {
        const r = await cli.get(`${uid}/insights`, { metric: 'follower_demographics', period: 'lifetime', metric_type: 'total_value', timeframe: 'this_month', breakdown: quebra });
        const d = (r.data || [])[0];
        const res = d && d.total_value && d.total_value.breakdowns && d.total_value.breakdowns[0] && d.total_value.breakdowns[0].results;
        if (res) novo[quebra] = res.map((x) => ({ valor: (x.dimension_values || []).join(' '), n: x.value })).sort((a, b) => b.n - a.n).slice(0, 10);
      } catch (e) {
        if (e.credencial) throw e;
        novo.lacuna = (conta.followers_count || 0) < 100 ? 'a Meta só mostra o público a partir de 100 seguidores' : `público: ${e.message}`;
        break;
      }
    }
    if (!novo.lacuna && !['city', 'country', 'age', 'gender'].some((q) => novo[q])) novo.lacuna = (conta.followers_count || 0) < 100 ? 'a Meta só mostra o público a partir de 100 seguidores' : 'público: a Meta respondeu sem dados';
    publico = novo;
    if (novo.lacuna) lacunas.push(novo.lacuna);
  }

  // ── posts e Reels ──
  const midias = await cli.paginar(`${uid}/media`, { fields: CAMPOS_POST, limit: 50 }, opts.maxPosts || 100);
  const posts = [];
  for (const m of midias) {
    const tipo = tipoDe(m);
    const ant = anteriorPosts[m.id];
    const p = { ...m, tipo, metricas: ant ? ant.metricas || {} : {}, metricas_em: ant ? ant.metricas_em : null, comentarios_em: ant ? ant.comentarios_em || null : null, comentarios_relidos: false };
    if (precisaMetricas(m, ant, agora)) {
      try {
        const r = await cli.insights(m.id, metricasPedidas(tipo, anterior, agora));
        p.metricas = { ...p.metricas, ...r.valores };
        p.metricas_em = new Date(agora).toISOString();
        marcarRecusa(tipo, r.rejeitadas);
      } catch (e) {
        if (e.credencial) throw e;
        lacunas.push(`métricas do post ${m.id}: ${e.message}`);
      }
    }
    posts.push(p);
  }

  // ── stories no ar (a Meta só mostra enquanto estão no ar: quem não for lido em 24 h se perde) ──
  const stories = [];
  try {
    const st = await cli.paginar(`${uid}/stories`, { fields: CAMPOS_POST.replace(',like_count,comments_count', '') }, 50);
    for (const s of st) {
      const r = await cli.insights(s.id, metricasPedidas('STORY', anterior, agora)).catch((e) => { if (e.credencial) throw e; return { valores: {}, rejeitadas: [] }; });
      marcarRecusa('STORY', r.rejeitadas);
      stories.push({ ...s, tipo: 'STORY', metricas: r.valores, metricas_em: new Date(agora).toISOString() });
    }
  } catch (e) { if (e.credencial) throw e; lacunas.push(`stories: ${e.message}`); }

  // ── comentários (sem nome de quem comentou) ──
  const comentarios = [];
  const contaUser = String(conta.username || '').toLowerCase();
  for (const p of posts) {
    const idade = agora - Date.parse(p.timestamp);
    const ant = anteriorPosts[p.id];
    if (!p.comments_count || idade > 30 * DIA) continue;
    if (ant && ant.comments_count === p.comments_count && ant.comentarios_em) continue;
    const lidos = await lerComentariosDoPost(cli, p.id, contaUser, lacunas);
    if (!lidos) continue;
    comentarios.push(...lidos);
    p.comentarios_em = new Date(agora).toISOString();
    p.comentarios_relidos = true;
  }

  // ── marcações (outras contas que marcaram a nossa) ──
  let marcacoes = [];
  try { marcacoes = (await cli.paginar(`${uid}/tags`, { fields: 'id,permalink,timestamp,media_type' }, 50)).map((t) => ({ id: t.id, link: t.permalink, ts: t.timestamp, tipo: t.media_type })); }
  catch (e) { if (e.credencial) throw e; lacunas.push(`marcações: ${e.message}`); }

  // ── contas de referência (Business Discovery: só com login pelo Facebook) ──
  const concorrentes = [];
  const alvo = (opts.concorrentes || []).map((s) => String(s).replace(/^@/, '').trim()).filter((s) => /^[A-Za-z0-9._]{1,30}$/.test(s));
  if (alvo.length && cli.login !== 'facebook') lacunas.push('contas de referência pedem login pelo Facebook (IG_LOGIN=facebook): com o login do Instagram a Meta não mostra outras contas');
  else for (const u of alvo) {
    try {
      const r = await cli.get(uid, { fields: `business_discovery.username(${u}){username,followers_count,media_count,media.limit(30){caption,like_count,comments_count,timestamp,media_product_type,permalink}}` });
      const b = r.business_discovery || {};
      concorrentes.push({ conta: b.username || u, seguidores: b.followers_count ?? null, posts: ((b.media && b.media.data) || []).map((m) => ({ legenda: String(m.caption || '').slice(0, 300), curtidas: m.like_count ?? null, comentarios: m.comments_count ?? null, ts: m.timestamp, tipo: m.media_product_type || null, link: m.permalink })) });
    } catch (e) { if (e.credencial) throw e; lacunas.push(`conta de referência @${u}: ${e.message}`); }
  }

  const metricasRecusadas = JSON.parse(JSON.stringify(anterior.metricas_recusadas || {}));
  for (const [tipo, mapa] of Object.entries(recusadasNovas)) metricasRecusadas[tipo] = { ...(metricasRecusadas[tipo] || {}), ...mapa };

  return {
    ts: new Date(agora).toISOString(),
    conta: { id: conta.id, username: conta.username, nome: conta.name || null, seguidores: conta.followers_count ?? null, seguindo: conta.follows_count ?? null, posts: conta.media_count ?? null },
    conta_dia: contaDia, publico, posts, stories, comentarios, marcacoes, concorrentes,
    metricas_recusadas: metricasRecusadas, lacunas, chamadas: cli.chamadas(),
  };
}

module.exports = { coletar, coletarComentarios, lerComentariosDoPost, METRICAS, METRICAS_CONTA, tipoDe, precisaMetricas };
