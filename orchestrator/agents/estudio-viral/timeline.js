'use strict';
/**
 * Linha do tempo de um Reel: planos, textos de tela e falas com início e fim em segundos.
 * É a mesma conta para o painel (prévia animada), para a página do Julien e para o arquivo .srt que o CapCut importa.
 * Sem modelo, sem rede: só aritmética sobre o pacote.
 */
const MPM = 190; // palavras por minuto de referência (voix.md)
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const arred = (n) => Math.round(n * 100) / 100;
const palavras = (s) => String(s || '').split(/\s+/).filter((t) => /[\p{L}\p{N}]/u.test(t)).length;

/** O "cenário" de um plano, para a prévia desenhar um fundo coerente. Palavra-chave, nunca imagem real. */
function fundoDe(descricao) {
  const n = norm(descricao);
  if (/^noir\b|\bnoir, signature|ecran noir|fondu au noir/.test(n)) return 'noir';
  if (/ciel etoile|plafond|etoiles/.test(n)) return 'ciel';
  if (/\bled\b|falcon s'ouvre|porte falcon s'ouvre/.test(n)) return 'led';
  if (/banquette|interieur|manette|a bord|ecran eteint/.test(n)) return 'interieur';
  if (/capitole|pont-neuf|pont neuf|garonne|quai|place|rue|stade|de nuit|exterieur|garee|plan large|se referme/.test(n)) return 'nuit';
  return null; // sem pista: o plano herda o cenário do anterior
}

function planos(reel) {
  let t = 0; let anterior = 'interieur';
  return (reel.plans || []).map((p, i) => { const d = Math.max(0.3, Number(p.duree_s) || 1); const fond = fundoDe(p.description) || anterior; anterior = fond; const o = { i, debut: arred(t), fin: arred(t + d), duree: arred(d), description: String(p.description || ''), fond }; t += d; return o; });
}

/** Janela de um texto de tela: números explícitos > "0–2 s" > "dernière seconde" > plano citado no `quand` > repartição em ordem. */
function janelaTela(t, k, n, pl, total) {
  if (Number.isFinite(t.debut_s) && Number.isFinite(t.fin_s) && t.fin_s > t.debut_s) return [t.debut_s, Math.min(t.fin_s, total)];
  const q = norm(t.quand);
  const m = /(\d+(?:[.,]\d+)?)\s*[–—-]\s*(\d+(?:[.,]\d+)?)\s*s/.exec(q);
  if (m) return [Number(m[1].replace(',', '.')), Math.min(Number(m[2].replace(',', '.')), total)];
  if (/derniere seconde|a la fin|fin\b|signature/.test(q)) return [Math.max(0, total - 1.2), total];
  const np = /(?:plan|scene)\s*(\d+)/.exec(q);
  if (np && pl[Number(np[1]) - 1]) return [pl[Number(np[1]) - 1].debut, pl[Number(np[1]) - 1].fin];
  const chave = q.split(/\s+/).filter((w) => w.length >= 5);
  const alvo = pl.find((p) => chave.some((w) => norm(p.description).includes(w)));
  if (alvo) return [alvo.debut, alvo.fin];
  const fatia = total / Math.max(1, n);
  return [arred(k * fatia), arred((k + 1) * fatia)];
}

function construir(reel) {
  const pl = planos(reel);
  const total = pl.length ? pl[pl.length - 1].fin : 0;
  const telas = reel.texte_ecran || [];
  const ecran = telas.map((t, k) => { const [a, b] = janelaTela(t, k, telas.length, pl, total); return { debut: arred(Math.max(0, a)), fin: arred(Math.max(a + 0.4, b)), texte: String(t.texte || ''), quand: t.quand || null }; });
  // falas: em sequência, cada uma no seu tempo de leitura; se passar do total, comprime tudo na mesma proporção
  const falas = (reel.voix_off || []).filter((v) => String(v || '').trim());
  const duracoes = falas.map((v) => Math.max(0.6, palavras(v) / (MPM / 60)));
  const pausa = 0.25; const bruto = duracoes.reduce((a, b) => a + b, 0) + pausa * Math.max(0, falas.length - 1) + 0.2;
  const k = total > 0 && bruto > total ? total / bruto : 1;
  let t = 0.2 * k; const voix = [];
  falas.forEach((v, i) => { const d = duracoes[i] * k; voix.push({ debut: arred(t), fin: arred(t + d), texte: v }); t += d + pausa * k; });
  return { total: arred(total), plans: pl, ecran, voix, voix_comprimee: k < 1 ? arred(k) : null };
}

const tc = (s) => { const ms = Math.round(s * 1000); const h = Math.floor(ms / 3600000); const m = Math.floor((ms % 3600000) / 60000); const sec = Math.floor((ms % 60000) / 1000); const r = ms % 1000; return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')},${String(r).padStart(3, '0')}`; };

/** Legendas .srt: as falas (ou, em Reel sem voz, os textos de tela). O CapCut importa em Texto → Legendas → Importar arquivo. */
function srt(reel) {
  const tl = construir(reel);
  const faixas = tl.voix.length ? tl.voix : tl.ecran;
  return faixas.map((f, i) => `${i + 1}\n${tc(f.debut)} --> ${tc(Math.max(f.fin, f.debut + 0.4))}\n${f.texte}\n`).join('\n');
}

module.exports = { construir, planos, srt, fundoDe, tc, MPM };
