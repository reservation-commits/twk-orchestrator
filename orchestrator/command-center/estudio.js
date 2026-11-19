'use strict';
/**
 * Estúdio Viral na Central — o painel /estudio, a página do Julien e a API (19/11/2026; painel completo em 4.11.0).
 *
 * PÚBLICO, com link assinado (HMAC do dia, mesmo segredo do link de confirmar). Token errado → 404 mudo.
 *   GET  /studio/<dia>?t=                 a página do Julien (celular): roteiros, prévia, teleprompter, legenda, .srt
 *   GET  /studio/<dia>/data?t=            os dados da página (sem nada interno: sem lacunas, sem tradução, sem custo)
 *   GET  /studio/<dia>/srt/<reel>?t=      legendas .srt do Reel (o CapCut importa)
 *   POST /studio/<dia>/etat?t=            { reel, status: filme|publie|ecarte|a_filmer, lien? } — o Julien marca o que fez
 *
 * COM A CHAVE DA CENTRAL (X-Center-Key):
 *   GET  /api/estudio/saude | dias | pacote?dia= | radar?dia= | desempenho | formulas | link?dia= | srt?dia=&reel= | progresso
 *   POST /api/estudio/medir       { tipo: ganchos|legenda|travas|reel, … }   medida na hora, sem modelo
 *   POST /api/estudio/reel        { dia, reel }                              salva um Reel editado (só se passar pelas travas)
 *   POST /api/estudio/estado      { dia, reel, status, lien? }
 *   POST /api/estudio/gerar       { dia?, sem_veille? }                      roda o Estúdio agora (modelo); progresso em /progresso
 *   POST /api/estudio/ganchos     { ideia, pilier? }                         IA: 10 ganchos medidos e ordenados
 *   POST /api/estudio/reescrever  { dia, reel, instrucao }                   IA: proposta de reescrita (não salva)
 *   POST /api/estudio/quadro      { imagem: dataURL, dia?, reel? }           IA com visão: juiz do primeiro quadro (não grava a imagem)
 *
 * Nada aqui publica, comenta ou manda mensagem a cliente. O único envio é o aviso ao Julien, feito pela rotina (run.js --avisar).
 */
const fs = require('node:fs');
const path = require('node:path');

const AGENTS_DIR = process.env.TWK_AGENTS_DIR || path.join(__dirname, '..', 'agents');
const A = (f) => require(path.join(AGENTS_DIR, 'estudio-viral', f));
const render = A('render.js');
const runMod = A('run.js');
const contexto = A('contexto.js');
const pacoteMod = A('pacote.js');
const timelineMod = A('timeline.js');
const estadoMod = A('estado.js');
const labMod = A('laboratorio.js');
const iaMod = A('ia.js');
const desempenhoMod = A('desempenho.js');
const llmMod = A('llm.js');
const sincMod = A('sincronizar-skill.js');

const RE_DIA = /^\d{4}-\d{2}-\d{2}$/;
const PUBLIC_DIR = path.join(__dirname, 'public');
const txt = (v, max) => String(v == null ? '' : v).replace(/\u0000/g, '').slice(0, max);

function criar({ stateDir, env = process.env, llm: llmInjetado = null } = {}) {
  const dir = path.join(stateDir, 'agents', 'estudio-viral');
  const est = estadoMod.abrir(dir);
  let skill = null; let lab = null; let llm = llmInjetado;
  const getSkill = () => { if (!skill) { skill = contexto.carregarSkill(); lab = labMod.criar(skill); } return skill; };
  const getLab = () => { getSkill(); return lab; };
  const getLlm = () => { if (!llm) llm = llmMod.criar(env); return llm; };
  const ctxDe = (dia) => contexto.carregar({ dia, stateRoot: stateDir, stateDir: dir });
  let prog = { rodando: false, dia: null, inicio: null, fim: null, status: null, erro: null, etapas: [] };
  const marcacoes = new Map(); // dia → instantes das marcações vindas da página do Julien (teto contra laço)

  const lerJson = (f, padrao = null) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return padrao; } };
  function gravarSeguro(f, conteudo) {
    fs.mkdirSync(path.dirname(f), { recursive: true });
    const tmp = `${f}.${process.pid}.tmp`; fs.writeFileSync(tmp, conteudo, 'utf8');
    for (let i = 0; i < 3; i++) { try { fs.renameSync(tmp, f); return; } catch { /* bloqueio momentâneo (Windows) */ } }
    fs.writeFileSync(f, conteudo, 'utf8'); try { fs.unlinkSync(tmp); } catch { /* inofensivo */ }
  }
  // Corpo acima do teto: para de acumular e responde 413 (sem derrubar a conexão, senão o navegador vê erro de rede e não a explicação).
  const lerCorpo = (req, max = 64_000) => new Promise((ok) => { let b = ''; let estourou = false; req.on('data', (c) => { if (estourou) return; b += c; if (b.length > max) { estourou = true; b = ''; ok({ __grande: true }); } }); req.on('end', () => { if (estourou) return; try { ok(JSON.parse(b || '{}')); } catch { ok(null); } }); req.on('error', () => { if (!estourou) ok(null); }); });

  function dias() {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).filter((f) => /^pacote-\d{4}-\d{2}-\d{2}\.json$/.test(f)).map((f) => f.slice(7, 17)).sort().reverse();
  }
  const ler = (dia) => (RE_DIA.test(String(dia)) ? lerJson(path.join(dir, `pacote-${dia}.json`)) : null);
  const veilleDe = (dia) => lerJson(path.join(dir, `veille-${dia}.json`));
  const timelines = (p) => Object.fromEntries((p.reels || []).map((r) => [r.id, timelineMod.construir(r)]));

  function montar(dia) {
    const p = ler(dia); if (!p) return null;
    const v = p._verificacao || {};
    return { dia, pacote: p, timeline: timelines(p), estado: est.doDia(dia), veille: veilleDe(dia), link: runMod.link(dia, env), markdown: render.markdownFr(p, { medidas: v.medidas || {}, problemas: v.problemas || [], veille: veilleDe(dia) }) };
  }
  /** O que a página do Julien recebe: o conteúdo, a medida do gancho e os avisos. Nada interno. */
  function paraJulien(dia) {
    const p = ler(dia); if (!p) return null;
    const v = p._verificacao || {}; const med = v.medidas || {};
    const reels = (p.reels || []).map((r) => ({ id: r.id, titre: r.titre, formule: r.formule, pilier: r.pilier, idee: r.idee, plans: r.plans, texte_ecran: r.texte_ecran, voix_off: r.voix_off || [], legende: r.legende, hashtags: r.hashtags || [], pourquoi: r.pourquoi, tournage: r.tournage || {}, accroches_alternatives: r.accroches_alternatives || [],
      note: med[r.id] && med[r.id].accroche ? med[r.id].accroche.note : null, a_verifier: (v.problemas || []).filter((x) => x.reel === r.id && x.tipo === 'aviso').length }));
    return { date: p.date || dia, tendance_du_jour: p.tendance_du_jour || '', reels, story: p.story || null, carrousel: p.carrousel || null, reponses_commentaires: p.reponses_commentaires || [], a_eviter: p.a_eviter || [], timeline: timelines(p), etat: est.doDia(dia) };
  }

  /** Só os campos editáveis, com teto de tamanho; o resto vem do original. */
  function limparReel(e, original) {
    const lista = (a, n, f) => (Array.isArray(a) ? a.slice(0, n).map(f).filter((x) => x !== null) : undefined);
    const num = (x) => (Number.isFinite(Number(x)) ? Math.max(0, Math.min(120, Number(x))) : undefined);
    const novo = { ...original };
    for (const [k, max] of [['titre', 80], ['idee', 400], ['accroche_voix', 240], ['accroche_ecran', 80], ['legende', 2200], ['pourquoi', 500], ['formule', 40], ['pilier', 20]]) if (typeof e[k] === 'string') novo[k] = txt(e[k], max).trim();
    const plans = lista(e.plans, 12, (p) => (p && String(p.description || '').trim() ? { duree_s: Math.max(0.3, Math.min(30, Number(p.duree_s) || 1)), description: txt(p.description, 300).trim() } : null));
    if (plans && plans.length) novo.plans = plans;
    const telas = lista(e.texte_ecran, 10, (t) => (t && String(t.texte || '').trim() ? { quand: txt(t.quand, 60), ...(num(t.debut_s) !== undefined && num(t.fin_s) !== undefined ? { debut_s: num(t.debut_s), fin_s: num(t.fin_s) } : {}), texte: txt(t.texte, 80).trim() } : null));
    if (telas && telas.length) novo.texte_ecran = telas;
    const voz = lista(e.voix_off, 10, (v) => (String(v || '').trim() ? txt(v, 240).trim() : null)); if (voz) novo.voix_off = voz;
    const tags = lista(e.hashtags, 8, (h) => (/^#[\p{L}\p{N}_]{1,40}$/u.test(String(h || '').trim()) ? String(h).trim() : null)); if (tags) novo.hashtags = tags;
    const alt = lista(e.accroches_alternatives, 4, (a) => (String(a || '').trim() ? txt(a, 320).trim() : null)); if (alt) novo.accroches_alternatives = alt;
    if (novo.voix_off && novo.voix_off.length) novo.accroche_voix = novo.voix_off[0]; else novo.accroche_voix = '';
    if (novo.texte_ecran && novo.texte_ecran[0]) novo.accroche_ecran = novo.texte_ecran[0].texte;
    novo.id = original.id;
    return novo;
  }

  function salvarReel({ dia, reel, por = 'painel', motivo = 'edicao' }) {
    const p = ler(dia); if (!p) return { status: 404, corpo: { error: `sem pacote para ${dia}` } };
    const i = (p.reels || []).findIndex((r) => r.id === (reel && reel.id)); if (i < 0) return { status: 404, corpo: { error: 'Reel não está no pacote' } };
    const novo = limparReel(reel, p.reels[i]);
    const v = pacoteMod.verificarReel(novo, getSkill().wc);
    const bloqueios = v.problemas.filter((x) => x.tipo === 'bloqueia');
    if (bloqueios.length) return { status: 422, corpo: { error: 'as travas do projeto barraram esta versão; nada foi salvo', problemas: v.problemas, medidas: v.medidas } };
    est.registrarEdicao({ dia, reel: novo.id, antes: p.reels[i], por, motivo });
    p.reels[i] = novo;
    p._verificacao = p._verificacao || { ok: true, removidos: [], problemas: [], medidas: {} };
    p._verificacao.problemas = (p._verificacao.problemas || []).filter((x) => x.reel !== novo.id).concat(v.problemas);
    p._verificacao.medidas = { ...(p._verificacao.medidas || {}), [novo.id]: v.medidas };
    p._editado_em = new Date().toISOString();
    gravarSeguro(path.join(dir, `pacote-${dia}.json`), JSON.stringify(p, null, 1));
    gravarSeguro(path.join(dir, `pacote-${dia}.md`), render.markdownFr(p, { medidas: p._verificacao.medidas, problemas: p._verificacao.problemas, veille: veilleDe(dia) }));
    return { status: 200, corpo: { ok: true, reel: novo, medidas: v.medidas, problemas: v.problemas, timeline: timelineMod.construir(novo) } };
  }

  function saude() {
    const l = getLlm(); let sk = { ok: null }; try { sk = sincMod.sincronizar({ verificar: true }); } catch (e) { sk = { ok: false, motivo: e.message }; }
    const d = dias();
    const falta = [];
    if (!l.disponivel) falta.push('ANTHROPIC_API_KEY (sem ela o Estúdio mede e edita, mas não escreve nem pesquisa)');
    if (env.ESTUDIO_VIRAL !== 'on') falta.push('ESTUDIO_VIRAL=on (a rotina diária está desligada; dá para gerar à mão pelo botão)');
    if (!runMod.link('2026-01-01', env)) falta.push('CHAUFFEUR_CONFIRMA_URL + segredo (sem eles não existe o link da página do Julien)');
    if (env.ESTUDIO_AVISAR !== 'on' || !env.ARIA_TEAM_ALERT_SECRET) falta.push('ESTUDIO_AVISAR=on + ARIA_TEAM_ALERT_SECRET (o Julien não recebe o link no WhatsApp)');
    if (!fs.existsSync(path.join(stateDir, 'agents', 'olheiro-instagram', 'resumo.json'))) falta.push('Olheiro do Instagram sem leitura (IG_ACCESS_TOKEN): o pacote não aprende com os números da conta');
    return { modelo: l.modelo, effort: l.effort, ia_disponivel: l.disponivel, rotina_ligada: env.ESTUDIO_VIRAL === 'on', aviso_ligado: env.ESTUDIO_AVISAR === 'on' && !!env.ARIA_TEAM_ALERT_SECRET, link_disponivel: !!runMod.link('2026-01-01', env), olheiro_leu: fs.existsSync(path.join(stateDir, 'agents', 'olheiro-instagram', 'resumo.json')), skill_em_dia: sk.ok, dias: d.length, ultimo: d[0] || null, hoje: contexto.diaParis(), falta, progresso: prog };
  }

  function listarDias() {
    const todos = est.todos();
    return dias().map((dia) => { const p = ler(dia) || {}; const e = todos[dia] || {}; const c = { a_filmer: 0, filme: 0, publie: 0, ecarte: 0 }; for (const r of p.reels || []) c[(e[r.id] || {}).status || 'a_filmer'] += 1; const v = p._verificacao || {};
      return { dia, reels: (p.reels || []).map((r) => ({ id: r.id, titre: r.titre, formule: r.formule, status: (e[r.id] || {}).status || 'a_filmer', note: v.medidas && v.medidas[r.id] && v.medidas[r.id].accroche ? v.medidas[r.id].accroche.note : null })), contagem: c, tendance: txt(p.tendance_du_jour, 220), modelo: p._modelo || null, gerado_em: p._gerado_em || null, editado_em: p._editado_em || null, lacunas: (p._lacunas || []).length, removidos: (v.removidos || []).length }; });
  }

  async function gerar(corpo, json, res) {
    if (prog.rodando) return json(res, 409, { error: `já há uma rodada em curso (${prog.dia})`, progresso: prog });
    const l = getLlm(); if (!l.disponivel) return json(res, 503, { error: 'ANTHROPIC_API_KEY ausente na Central: o Estúdio não consegue escrever. Sem a chave, edite o pacote existente ou use o laboratório.' });
    const dia = RE_DIA.test(String(corpo.dia || '')) ? corpo.dia : contexto.diaParis();
    // o pacote anterior do dia não se perde: vai para arquivo/ antes de ser substituído
    const atual = path.join(dir, `pacote-${dia}.json`);
    if (fs.existsSync(atual)) { const arq = path.join(dir, 'arquivo'); fs.mkdirSync(arq, { recursive: true }); fs.copyFileSync(atual, path.join(arq, `pacote-${dia}-${Date.now()}.json`)); }
    prog = { rodando: true, dia, inicio: new Date().toISOString(), fim: null, status: null, erro: null, etapas: [] };
    runMod.rodar({ argv: ['--dia', dia, '--relato', ...(corpo.sem_veille ? ['--sem-veille'] : [])], env: { ...env, TWK_STATE_ROOT: stateDir }, llm: l, stateDir: dir, log: () => {}, onEtapa: (e) => { prog.etapas.push(e); } })
      .then((r) => { prog.status = r.status; prog.lacunas = r.lacunas; })
      .catch((e) => { prog.erro = String(e && e.message || e).slice(0, 300); })
      .finally(() => { prog.rodando = false; prog.fim = new Date().toISOString(); });
    return json(res, 202, { ok: true, dia, progresso: prog });
  }

  // ---------------------------------------------------------------- rotas públicas (link assinado)
  function tratarPublico(req, res, u, json) {
    const m = /^\/studio\/(\d{4}-\d{2}-\d{2})(?:\/(data|etat|srt)(?:\/([A-Za-z0-9_-]{1,12}))?)?\/?$/.exec(u.pathname);
    if (!m) return false;
    const [, dia, sub, reelId] = m; const t = u.searchParams.get('t');
    const nao = () => { res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' }); res.end('<!doctype html><html lang="fr"><meta charset="utf-8"><title>Introuvable</title><p style="font-family:system-ui;padding:24px">Page introuvable.</p></html>'); return true; };
    if (!runMod.tokenValido(dia, t, env) || !ler(dia)) return nao();
    const j = json || ((r, c, o) => { r.writeHead(c, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); r.end(JSON.stringify(o)); });
    if (!sub && req.method === 'GET') {
      let html; try { html = fs.readFileSync(path.join(PUBLIC_DIR, 'estudio', 'julien.html'), 'utf8'); } catch { html = render.html(ler(dia)); }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'private, no-store', 'x-robots-tag': 'noindex' }); res.end(html); return true;
    }
    if (sub === 'data' && req.method === 'GET') { j(res, 200, paraJulien(dia)); return true; }
    if (sub === 'srt' && req.method === 'GET') {
      const r = (ler(dia).reels || []).find((x) => x.id === reelId); if (!r) return nao();
      res.writeHead(200, { 'content-type': 'application/x-subrip; charset=utf-8', 'content-disposition': `attachment; filename="wanted-chauffeur-${dia}-${r.id}.srt"`, 'cache-control': 'no-store' }); res.end(timelineMod.srt(r)); return true;
    }
    if (sub === 'etat' && req.method === 'POST') {
      // teto por dia de pacote: 60 marcações a cada 10 min (o link é do Julien; isto só impede um laço de encher o arquivo)
      const agora = Date.now(); const jan = (marcacoes.get(dia) || []).filter((x) => agora - x < 600_000);
      if (jan.length >= 60) { j(res, 429, { erreur: 'trop de modifications, réessaie dans quelques minutes' }); return true; }
      jan.push(agora); marcacoes.set(dia, jan);
      lerCorpo(req, 2_000).then((c) => {
        if (!c || c.__grande) return j(res, 400, { erreur: 'requête invalide' });
        if (!(ler(dia).reels || []).some((x) => x.id === c.reel)) return j(res, 404, { erreur: 'Reel introuvable' });
        const r = est.marcar({ dia, reel: c.reel, status: c.status, lien: c.lien || null, por: 'julien' });
        return r.ok ? j(res, 200, { ok: true, etat: est.doDia(dia) }) : j(res, 400, { erreur: r.erro });
      });
      return true;
    }
    return nao();
  }

  // ---------------------------------------------------------------- rotas com chave
  function tratar(req, res, u, json) {
    if (!u.pathname.startsWith('/api/estudio')) return false;
    const rota = u.pathname.slice('/api/estudio'.length).replace(/\/+$/, '') || '/';
    const erro = (e) => json(res, /ausente|inválid|não está/.test(String(e.message)) ? 400 : 502, { error: String(e && e.message || e).slice(0, 400) });
    if (req.method === 'GET') {
      if (rota === '/saude') return json(res, 200, saude()), true;
      if (rota === '/dias') return json(res, 200, { dias: listarDias() }), true;
      if (rota === '/progresso') return json(res, 200, prog), true;
      if (rota === '/formulas') return json(res, 200, { formulas: getLab().formulas(), controles: labMod.ROTULO }), true;
      if (rota === '/desempenho') return json(res, 200, desempenhoMod.calcular({ stateRoot: stateDir, estudioDir: dir, estados: est.todos(), wc: getSkill().wc })), true;
      if (rota === '/pacote') { const dia = u.searchParams.get('dia') || dias()[0]; const m = dia ? montar(dia) : null; json(res, m ? 200 : 404, m || { error: dia ? `sem pacote para ${dia}` : 'nenhum pacote ainda: gere o primeiro pelo botão ou ligue a rotina (ESTUDIO_VIRAL=on)' }); return true; }
      if (rota === '/radar') { const dia = RE_DIA.test(u.searchParams.get('dia') || '') ? u.searchParams.get('dia') : contexto.diaParis(); const v = veilleDe(dia); json(res, 200, { dia, veille: v, calendario: contexto.calendario(dia), lacuna: v ? null : 'Sem pesquisa na web para este dia: a veille roda junto com a geração do pacote e exige a chave da IA.' }); return true; }
      if (rota === '/link') { const dia = u.searchParams.get('dia') || dias()[0]; json(res, 200, { dia, link: dia ? runMod.link(dia, env) : null, motivo: runMod.link(dia || '2026-01-01', env) ? null : 'sem CHAUFFEUR_CONFIRMA_URL ou segredo (CHAUFFEUR_CONFIRMA_SECRET/CENTER_TOKEN)' }); return true; }
      if (rota === '/srt') { const p = ler(u.searchParams.get('dia')); const r = p && (p.reels || []).find((x) => x.id === u.searchParams.get('reel')); if (!r) { json(res, 404, { error: 'Reel não encontrado' }); return true; } res.writeHead(200, { 'content-type': 'application/x-subrip; charset=utf-8', 'content-disposition': `attachment; filename="wanted-chauffeur-${u.searchParams.get('dia')}-${r.id}.srt"`, 'cache-control': 'no-store' }); res.end(timelineMod.srt(r)); return true; }
      json(res, 404, { error: 'rota desconhecida em /api/estudio' }); return true;
    }
    if (req.method !== 'POST') { json(res, 405, { error: 'método não aceito' }); return true; }
    lerCorpo(req, rota === '/quadro' ? 8_000_000 : 64_000).then(async (c) => {
      if (!c) return json(res, 400, { error: 'JSON inválido' });
      if (c.__grande) return json(res, 413, { error: rota === '/quadro' ? 'imagem maior que 5 MB' : 'corpo grande demais' });
      try {
        if (rota === '/medir') {
          const l = getLab();
          if (c.tipo === 'ganchos') return json(res, 200, { ganchos: l.ganchos(txt(c.texto, 8000)) });
          if (c.tipo === 'legenda') return json(res, 200, l.legenda(txt(c.texto, 4000), { type: c.type }));
          if (c.tipo === 'travas') return json(res, 200, { travas: l.travas(txt(c.texto, 4000), c.contexto) });
          if (c.tipo === 'reel' && c.reel && typeof c.reel === 'object') {
            const base = (ler(c.dia) && (ler(c.dia).reels || []).find((r) => r.id === c.reel.id)) || { id: txt(c.reel.id, 12) || 'R0', formule: '', pilier: '', idee: '', pourquoi: '', tournage: {}, titre: '', hashtags: [], legende: '', plans: [], texte_ecran: [], voix_off: [], accroche_voix: '', accroche_ecran: '' };
            const novo = limparReel(c.reel, base); const v = pacoteMod.verificarReel(novo, getSkill().wc);
            return json(res, 200, { reel: novo, medidas: v.medidas, problemas: v.problemas, timeline: timelineMod.construir(novo), ok: !v.problemas.some((x) => x.tipo === 'bloqueia') });
          }
          return json(res, 400, { error: 'tipo: ganchos, legenda, travas ou reel' });
        }
        if (rota === '/reel') { if (!RE_DIA.test(String(c.dia)) || !c.reel) return json(res, 400, { error: 'dia e reel' }); const r = salvarReel({ dia: c.dia, reel: c.reel, motivo: c.motivo === 'ia' ? 'ia' : 'edicao' }); return json(res, r.status, r.corpo); }
        if (rota === '/estado') { const p = ler(c.dia); if (!p || !(p.reels || []).some((x) => x.id === c.reel)) return json(res, 404, { error: 'Reel não encontrado' }); const r = est.marcar({ dia: c.dia, reel: c.reel, status: c.status, lien: c.lien || null, por: 'painel' }); return r.ok ? json(res, 200, { ok: true, estado: est.doDia(c.dia) }) : json(res, 400, { error: r.erro }); }
        if (rota === '/gerar') return gerar(c, json, res);
        // ---- IA sob demanda
        const l = getLlm(); if (!l.disponivel) return json(res, 503, { error: 'ANTHROPIC_API_KEY ausente na Central: esta ferramenta usa o modelo. O laboratório de medida funciona sem ela.' });
        if (rota === '/ganchos') { if (!txt(c.ideia, 600).trim()) return json(res, 400, { error: 'diga a ideia do Reel em uma frase' }); const dia = contexto.diaParis(); return json(res, 200, await iaMod.ganchos({ llm: l, ctx: ctxDe(dia), lab: getLab(), ideia: c.ideia, pilier: c.pilier ? txt(c.pilier, 20) : null })); }
        if (rota === '/reescrever') { const p = ler(c.dia); if (!p) return json(res, 404, { error: `sem pacote para ${c.dia}` }); if (!txt(c.instrucao, 800).trim()) return json(res, 400, { error: 'diga o que mudar' }); const r = await iaMod.reescrever({ llm: l, ctx: ctxDe(c.dia), wc: getSkill().wc, pacote: p, reelId: c.reel, instrucao: c.instrucao }); return json(res, 200, { ...r, timeline: timelineMod.construir(r.reel) }); }
        if (rota === '/quadro') { const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(c.imagem || '')); if (!m) return json(res, 400, { error: 'envie uma imagem JPEG, PNG ou WebP' }); const p = c.dia ? ler(c.dia) : null; const reel = p ? (p.reels || []).find((x) => x.id === c.reel) || null : null; return json(res, 200, await iaMod.quadro({ llm: l, reel, base64: m[2], mediaType: m[1] })); }
        return json(res, 404, { error: 'rota desconhecida em /api/estudio' });
      } catch (e) { return erro(e); }
    });
    return true;
  }

  return { tratarPublico, tratar, dias, ler, montar, paraJulien, salvarReel, saude, dir, estado: est, _progresso: () => prog };
}

module.exports = { criar };
