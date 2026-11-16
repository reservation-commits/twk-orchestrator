'use strict';
/**
 * Central · Instagram do @wantedchauffeur — o que o Olheiro leu, servido com a chave da Central (X-Center-Key).
 *
 * Quem consome: o conector do COMPASSO (ferramentas instagram_* no chat do Claude), que repassa ao Studio.
 * Nada aqui fala com a Meta: só lê o volume (STATE_DIR/agents/olheiro-instagram) e grava as anotações da pessoa.
 *
 *   GET  /api/instagram               → resumo (números, melhores e piores, alertas, público, referências, lacunas)
 *   GET  /api/instagram/diario        → linhas do journal.jsonl no formato da skill (para o balanço)
 *   GET  /api/instagram/comentarios   → fila do que espera resposta (?classe=reserva|pergunta|elogio|outro)
 *   POST /api/instagram/anotar        → { id: "IG-…", pilier?, personnage?, ville?, ecran?, accroche? }
 *
 * As anotações valem na hora (o diário é refeito com elas) e na próxima rodada do Olheiro.
 */
const fs = require('node:fs');
const path = require('node:path');

const PILARES = ['entree', 'nuit', 'a-bord', 'coulisses', 'riviera'];
const PERSONAGENS = ['Le Vice', 'Le Fugitif', 'L\'Agent', 'Le Partenaire', 'Le Tatoué'];
const CAMPOS = ['pilier', 'personnage', 'ville', 'ecran', 'accroche'];

function criar({ stateDir, agentsDir }) {
  const dir = () => path.join(stateDir, 'agents', 'olheiro-instagram');
  const lerJson = (f, padrao) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return padrao; } };
  const lerDiario = () => { try { return fs.readFileSync(path.join(dir(), 'journal.jsonl'), 'utf8').split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };
  /** Grava por arquivo temporário e troca de nome. No Windows a troca pode esbarrar num bloqueio momentâneo
   *  (antivírus, indexador): tenta de novo e, em último caso, grava direto. */
  function gravarSeguro(f, conteudo) {
    const tmp = `${f}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, conteudo, 'utf8');
    for (let i = 0; i < 3; i++) { try { fs.renameSync(tmp, f); return; } catch { /* bloqueio momentâneo */ } }
    fs.writeFileSync(f, conteudo, 'utf8');
    try { fs.unlinkSync(tmp); } catch { /* fica para trás, inofensivo */ }
  }
  const semDados = { erro: 'O Olheiro do Instagram ainda não leu a conta (sem chave no Easypanel ou rotina ainda não rodou).', ligado: !!process.env.IG_ACCESS_TOKEN };

  function anotar(corpo) {
    const id = String(corpo && corpo.id || '');
    if (!/^IG-\d{5,30}$/.test(id)) return { status: 400, erro: 'id no formato IG-<número> (é o id que aparece no diário)' };
    const atual = lerDiario();
    if (atual.length && !atual.some((l) => l.id === id)) return { status: 404, erro: `${id} não está no diário` };
    const novo = {};
    for (const k of CAMPOS) {
      if (corpo[k] === undefined) continue;
      const v = corpo[k] === null ? null : String(corpo[k]).trim().slice(0, k === 'accroche' ? 200 : 80);
      if (k === 'pilier' && v && !PILARES.includes(v)) return { status: 400, erro: `pilier: ${PILARES.join(', ')}` };
      if (k === 'personnage' && v && !PERSONAGENS.includes(v)) return { status: 400, erro: `personnage: ${PERSONAGENS.join(', ')}` };
      novo[k] = v;
    }
    if (!Object.keys(novo).length) return { status: 400, erro: `nada para anotar: ${CAMPOS.join(', ')}` };
    const f = path.join(dir(), 'anotacoes.json');
    const todas = lerJson(f, {});
    const junto = { ...(todas[id] || {}), ...novo, em: new Date().toISOString() };
    for (const k of Object.keys(junto)) if (junto[k] === null) delete junto[k];
    todas[id] = junto;
    fs.mkdirSync(dir(), { recursive: true });
    gravarSeguro(f, JSON.stringify(todas, null, 1));
    // refaz o diário com a anotação, sem esperar a próxima rodada
    try {
      const cerebro = require(path.join(agentsDir, 'olheiro-instagram', 'cerebro.js'));
      const estado = lerJson(path.join(dir(), 'estado.json'), null);
      if (estado) gravarSeguro(path.join(dir(), 'journal.jsonl'), cerebro.diario(estado, todas).map((l) => JSON.stringify(l)).join('\n') + '\n');
    } catch { /* o diário se refaz na próxima rodada */ }
    return { status: 200, ok: true, id, anotacao: junto };
  }

  /** Devolve true se tratou a rota. `json(res, code, obj)` vem do servidor. A chave já foi conferida antes. */
  function tratar(req, res, u, json) {
    if (!u.pathname.startsWith('/api/instagram')) return false;
    if (u.pathname === '/api/instagram' && req.method === 'GET') {
      const r = lerJson(path.join(dir(), 'resumo.json'), null);
      json(res, r ? 200 : 404, r ? { ...r, fila_comentarios: undefined, comentarios_na_fila: r.fila_comentarios.length } : semDados);
      return true;
    }
    if (u.pathname === '/api/instagram/diario' && req.method === 'GET') {
      const l = lerDiario();
      json(res, l.length ? 200 : 404, l.length ? { posts: l } : semDados);
      return true;
    }
    if (u.pathname === '/api/instagram/comentarios' && req.method === 'GET') {
      const r = lerJson(path.join(dir(), 'resumo.json'), null);
      if (!r) { json(res, 404, semDados); return true; }
      const classe = u.searchParams.get('classe');
      json(res, 200, { atualizado_em: r.atualizado_em, comentarios: classe ? r.fila_comentarios.filter((c) => c.classe === classe) : r.fila_comentarios });
      return true;
    }
    if (u.pathname === '/api/instagram/anotar' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => { body += c; if (body.length > 20_000) req.destroy(); });
      req.on('end', () => {
        let corpo; try { corpo = JSON.parse(body || '{}'); } catch { return json(res, 400, { erro: 'JSON inválido' }); }
        let r;
        try { r = anotar(corpo); } catch (e) { r = { status: 500, erro: `não consegui gravar a anotação (${String(e && e.message || e).slice(0, 120)})` }; }
        return json(res, r.status, r);
      });
      return true;
    }
    json(res, 404, { erro: 'rota do Instagram desconhecida' });
    return true;
  }

  return { tratar, anotar, PILARES, PERSONAGENS };
}

module.exports = { criar, PILARES, PERSONAGENS };
