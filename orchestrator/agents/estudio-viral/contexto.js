'use strict';
/**
 * Contexto do Estúdio Viral: tudo o que o modelo precisa saber antes de escrever, lido de arquivos e nunca inventado.
 *   - a skill (voz, regras de Reel e legenda, travas, fórmulas) — cópia local em ./skill (sincronizar-skill.js)
 *   - os números do Olheiro do Instagram (resumo.json no volume), se existirem; senão, lacuna declarada
 *   - o calendário de Toulouse (donnees/calendario.json), janela de 21 dias
 *   - os pacotes dos últimos 7 dias, para não repetir ideia
 */
const fs = require('node:fs');
const path = require('node:path');

const SKILL_DIR = path.join(__dirname, 'skill');
const DIA_MS = 86400000;

function lerTexto(p) { return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null; }
function lerJson(p) { const t = lerTexto(p); return t ? JSON.parse(t) : null; }

function diaParis(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
function diaSemanaParis(dia) { return new Date(`${dia}T12:00:00Z`).getUTCDay(); }

function carregarSkill(skillDir = SKILL_DIR) {
  const falta = ['outils/wc.js', 'donnees/garde-fous.json', 'donnees/formules.json', 'voix.md', 'modes/reel.md', 'modes/legende.md'].filter((r) => !fs.existsSync(path.join(skillDir, r)));
  if (falta.length) throw new Error(`Cópia da skill incompleta em ${skillDir}: faltam ${falta.join(', ')} — rode sincronizar-skill.js`);
  return {
    wc: require(path.join(skillDir, 'outils', 'wc.js')),
    voix: lerTexto(path.join(skillDir, 'voix.md')),
    reel: lerTexto(path.join(skillDir, 'modes', 'reel.md')),
    legende: lerTexto(path.join(skillDir, 'modes', 'legende.md')),
    garde: lerJson(path.join(skillDir, 'donnees', 'garde-fous.json')),
    formules: lerJson(path.join(skillDir, 'donnees', 'formules.json')),
  };
}

/** Resumo do Olheiro (só números, sem PII). `null` com lacuna quando o Olheiro nunca rodou. */
function carregarOlheiro(stateRoot) {
  const p = stateRoot ? path.join(stateRoot, 'agents', 'olheiro-instagram', 'resumo.json') : null;
  const r = p ? lerJson(p) : null;
  if (!r) return { dados: null, lacuna: 'Olheiro do Instagram sem leitura (resumo.json ausente): o pacote não aprende com os números da conta ainda.' };
  const n = r.numeros || {};
  return {
    dados: {
      seguidores: n.seguidores ?? null, seguidores_7d: n.seguidores_7d ?? null, mediana_views_reels_30d: n.mediana_views_reels_30d ?? null,
      top_reels_30d: (r.top_30d || r.top || []).slice(0, 5).map((t) => ({ date: t.date, accroche: t.accroche, vues: t.vues, multiplo: t.multiplo })),
      atualizado_em: r.atualizado_em,
    },
    lacuna: null,
  };
}

function calendario(dia, dias = 21) {
  const cal = lerJson(path.join(__dirname, 'donnees', 'calendario.json'));
  const t0 = Date.parse(`${dia}T12:00:00Z`);
  const eventos = cal.eventos.filter((e) => Date.parse(`${e.ate}T12:00:00Z`) >= t0 - DIA_MS && Date.parse(`${e.de}T12:00:00Z`) <= t0 + dias * DIA_MS)
    .map((e) => ({ ...e, dans_jours: Math.round((Date.parse(`${e.de}T12:00:00Z`) - t0) / DIA_MS) }));
  return { eventos, pilier: cal.piliers[String(diaSemanaParis(dia))] || 'entree' };
}

function pacotesRecentes(stateDir, dia, dias = 7) {
  if (!stateDir || !fs.existsSync(stateDir)) return [];
  const t0 = Date.parse(`${dia}T12:00:00Z`);
  return fs.readdirSync(stateDir).filter((f) => /^pacote-\d{4}-\d{2}-\d{2}\.json$/.test(f)).map((f) => f.slice(7, 17))
    .filter((d) => { const t = Date.parse(`${d}T12:00:00Z`); return t < t0 && t0 - t <= dias * DIA_MS; }).sort()
    .map((d) => { const p = lerJson(path.join(stateDir, `pacote-${d}.json`)); return p ? { date: d, idees: (p.reels || []).map((r) => `${r.titre} — ${r.accroche_voix || r.accroche_ecran || ''}`) } : null; }).filter(Boolean);
}

function carregar({ dia = diaParis(), stateRoot = process.env.TWK_STATE_ROOT || null, stateDir = null, skillDir = SKILL_DIR } = {}) {
  const skill = carregarSkill(skillDir);
  const olheiro = carregarOlheiro(stateRoot);
  return { dia, skill, olheiro, calendario: calendario(dia), recentes: pacotesRecentes(stateDir, dia) };
}

module.exports = { carregar, carregarSkill, carregarOlheiro, calendario, pacotesRecentes, diaParis, SKILL_DIR };
