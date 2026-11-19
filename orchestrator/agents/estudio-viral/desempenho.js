'use strict';
/**
 * Desempenho: o que os roteiros do Estúdio renderam DEPOIS de publicados.
 * Junta três fontes, todas em arquivo: os pacotes (fórmula, pilar, gancho), o estado dos Reels (publicado + link) e o que
 * o Olheiro leu da conta (journal.jsonl: vistas, novos seguidores por post; estado.json: seguidores por dia).
 * Sem Olheiro, devolve a lacuna e o que já dá para saber (quantos foram filmados e publicados).
 */
const fs = require('node:fs');
const path = require('node:path');

const lerJson = (f, padrao = null) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return padrao; } };
const lerJsonl = (f) => { try { return fs.readFileSync(f, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; } };
const mediana = (a) => { const s = a.filter((x) => Number.isFinite(x)).sort((x, y) => x - y); if (!s.length) return null; const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const arred = (n, c = 2) => (n === null || !Number.isFinite(n) ? null : Math.round(n * 10 ** c) / 10 ** c);
/** Chave de comparação de um link de post: /reel/<código>/ ou /p/<código>/, sem parâmetros. */
const chaveLink = (l) => { const m = /(?:instagram\.com)\/(?:[^/]+\/)?(?:reel|reels|p|tv)\/([A-Za-z0-9_-]+)/i.exec(String(l || '')); return m ? m[1] : String(l || '').split('?')[0].replace(/\/+$/, ''); };

function calcular({ stateRoot, estudioDir, estados = {}, wc = null }) {
  const olheiroDir = path.join(stateRoot, 'agents', 'olheiro-instagram');
  const resumo = lerJson(path.join(olheiroDir, 'resumo.json'));
  const estadoOl = lerJson(path.join(olheiroDir, 'estado.json'));
  const diario = lerJsonl(path.join(olheiroDir, 'journal.jsonl'));
  const lacunas = [];
  if (!resumo) lacunas.push('O Olheiro do Instagram ainda não leu a conta: sem seguidores por dia e sem números por Reel. Ligue pelo runbook olheiro-instagram.');

  // pacotes → Reels escritos
  const dias = fs.existsSync(estudioDir) ? fs.readdirSync(estudioDir).filter((f) => /^pacote-\d{4}-\d{2}-\d{2}\.json$/.test(f)).map((f) => f.slice(7, 17)).sort() : [];
  const porLink = new Map(diario.filter((l) => l.lien).map((l) => [chaveLink(l.lien), l]));
  const medViews = mediana(diario.filter((l) => l.format === 'reel').map((l) => l.vues));
  const reels = [];
  for (const dia of dias) {
    const p = lerJson(path.join(estudioDir, `pacote-${dia}.json`)); if (!p) continue;
    for (const r of p.reels || []) {
      const e = (estados[dia] || {})[r.id] || { status: 'a_filmer' };
      const post = e.lien ? porLink.get(chaveLink(e.lien)) || null : null;
      const nota = ((p._verificacao && p._verificacao.medidas && p._verificacao.medidas[r.id]) || {}).accroche;
      reels.push({ dia, id: r.id, titre: r.titre, formule: r.formule, pilier: r.pilier, accroche: r.accroche_voix || r.accroche_ecran, note: nota ? nota.note : null, status: e.status, lien: e.lien || null,
        vues: post ? post.vues ?? null : null, abonnes: post ? post.abonnes ?? null : null, partages: post ? post.partages ?? null : null, enregistrements: post ? post.enregistrements ?? null : null,
        multiple: post && medViews && Number.isFinite(post.vues) ? arred(post.vues / medViews) : null, mesure: !!post });
    }
  }
  const publicados = reels.filter((r) => r.status === 'publie');
  if (resumo && publicados.some((r) => r.lien && !r.mesure)) lacunas.push('Há Reel publicado com link que o Olheiro ainda não leu (a leitura é diária) ou cujo link não é do Instagram.');
  if (publicados.some((r) => !r.lien)) lacunas.push('Há Reel marcado como publicado sem o link do post: sem link não dá para cruzar com os números.');

  const agrupar = (campo) => { const m = {}; for (const r of publicados.filter((x) => x.mesure)) (m[r[campo]] = m[r[campo]] || []).push(r); return Object.entries(m).map(([valor, l]) => ({ valor, n: l.length, vues_mediane: mediana(l.map((x) => x.vues)), abonnes_total: l.reduce((a, x) => a + (x.abonnes || 0), 0), multiple_mediane: arred(mediana(l.map((x) => x.multiple))) })).sort((a, b) => (b.abonnes_total - a.abonnes_total) || ((b.multiple_mediane || 0) - (a.multiple_mediane || 0))); };
  const contar = (s) => reels.filter((r) => r.status === s).length;
  const medidos = publicados.filter((r) => r.mesure);

  // a nota de gancho prevê algo? (só com 8+ medidos; antes disso é horóscopo)
  let calibragem = { pronta: false, message: `Com ${medidos.length} Reel(s) medido(s) ainda não dá para dizer se a nota do gancho prevê resultado. A conta precisa de 8 publicados com link.` };
  const comNota = medidos.filter((r) => Number.isFinite(r.note) && Number.isFinite(r.vues));
  if (comNota.length >= 8) { const alto = comNota.filter((r) => r.note >= 75); const baixo = comNota.filter((r) => r.note < 75); calibragem = { pronta: true, alto: { n: alto.length, vues_mediane: mediana(alto.map((r) => r.vues)) }, baixo: { n: baixo.length, vues_mediane: mediana(baixo.map((r) => r.vues)) }, message: 'Mediana de vistas dos Reels com gancho FORTE (≥ 75) contra os demais, nesta conta.' }; }

  const hist = ((estadoOl && estadoOl.conta_historico) || []).filter((h) => Number.isFinite(h.seguidores)).slice(-60).map((h) => ({ dia: h.dia, seguidores: h.seguidores }));
  const ganhos = hist.slice(1).map((h, i) => ({ dia: h.dia, ganho: h.seguidores - hist[i].seguidores }));
  return {
    gerado_em: new Date().toISOString(), demo: !!(resumo && resumo.demo), olheiro_ligado: !!resumo, lacunas,
    conta: resumo ? { username: (resumo.conta || {}).username || null, seguidores: (resumo.numeros || {}).seguidores ?? null, seguidores_7d: (resumo.numeros || {}).seguidores_7d ?? null, mediana_views_reels_30d: (resumo.numeros || {}).mediana_views_reels_30d ?? null, atualizado_em: resumo.atualizado_em || null } : null,
    seguidores_historico: hist, ganho_diario: ganhos, ganho_mediano: mediana(ganhos.map((g) => g.ganho)),
    funil: { escritos: reels.length, filmados: contar('filme') + contar('publie'), publicados: publicados.length, medidos: medidos.length, descartados: contar('ecarte') },
    por_formule: agrupar('formule'), por_pilier: agrupar('pilier'), calibragem,
    reels: reels.slice().sort((a, b) => (b.dia + b.id).localeCompare(a.dia + a.id)).slice(0, 120),
    melhores_da_conta: resumo ? (resumo.melhores_30d || []).slice(0, 5) : [],
    bilan_skill: wc && diario.length ? (() => { try { const b = wc.bilan(diario); return { posts: b.posts, avec_vues: b.avec_vues, mediane_vues: b.mediane_vues, amostra: b.amostra }; } catch { return null; } })() : null,
  };
}

module.exports = { calcular, chaveLink, mediana };
