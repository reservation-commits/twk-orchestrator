#!/usr/bin/env node
'use strict';
/**
 * Wanted Chauffeur Studio — ferramenta de medição para conteúdo em FRANCÊS do @wantedchauffeur.
 * Node puro, sem dependências, sem rede: lê texto, devolve medidas. Nunca publica nada.
 *
 *   node wc.js accroche  <arquivo|->            nota de ganchos (uma opção por linha: "fala | texto de tela")
 *   node wc.js minutage  <arquivo|-> [--cible 30] [--mpm 190]   roteiro → folha de tempos
 *   node wc.js legende   <arquivo|-> [--mots-cles "a,b"] [--plateforme instagram] [--type legende|bio] [--corriger]
 *   node wc.js texte     <arquivo|-> [--contexte legende|voix|ecran|bio] [--corriger]   clichês, tiques, tipografia, travas
 *   node wc.js garde     <arquivo|-> [--contexte …]   só as travas do projeto
 *   node wc.js veille    <arquivo.tsv> [--sortie veille.md]     pesquisa: ranking pelo múltiplo sobre a mediana
 *   node wc.js journal   ajouter|maj|lister …   diário dos posts publicados e seus números
 *   node wc.js bilan                            o que funciona NESTA conta, e se a nota de gancho prevê algo
 *
 * Em todo comando: --json devolve dados em vez de texto; --texte "…" passa o texto direto; --dossier muda a pasta do diário.
 *
 * O que a nota de gancho é: cinco verificações de superfície. Ela elimina gancho fraco; NÃO escolhe o vencedor entre dois
 * bons. Quem decide isso são os números da própria conta, e é para isso que existem `journal` e `bilan`.
 */
const fs = require('node:fs');
const path = require('node:path');

const DADOS = path.join(__dirname, '..', 'donnees');
const ler = (n) => JSON.parse(fs.readFileSync(path.join(DADOS, `${n}.json`), 'utf8'));
const FORMULES = ler('formules'); const LEXIQUE = ler('lexique'); const GARDE = ler('garde-fous'); const PLATEFORMES = ler('plateformes');

// ------------------------------------------------------------------ texto
/** Minúsculas, sem acentos, apóstrofos e espaços unificados. Todas as listas são comparadas assim. */
function norm(s) {
  return String(s || '').toLowerCase().replace(/œ/g, 'oe').replace(/æ/g, 'ae').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[’‘ʼ`´]/g, "'").replace(/[   ]/g, ' ').replace(/\s+/g, ' ').trim();
}
const mots = (s) => String(s || '').split(/\s+/).filter((t) => /[\p{L}\p{N}]/u.test(t));
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const contem = (n, termo) => new RegExp(`(^|[^a-z0-9])${esc(termo)}($|[^a-z0-9])`).test(n);
const mediana = (a) => { const s = a.filter((x) => Number.isFinite(x)).sort((x, y) => x - y); if (!s.length) return null; const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const arred = (n, c = 1) => (n === null || !Number.isFinite(n) ? null : Math.round(n * 10 ** c) / 10 ** c);

const LIEUX = ['promenade des anglais', 'palais des festivals', 'aeroport de nice', 'sophia antipolis', 'juan-les-pins', 'saint-tropez', 'st-tropez', 'cote d\'azur', 'monte-carlo', 'monte carlo', 'villefranche', 'cap-ferrat', 'croisette', 'beaulieu', 'riviera', 'antibes', 'monaco', 'cannes', 'menton', 'nice', 'eze'];
const OBJETS = ['model x', 'ciel etoile', 'playstation', 'whatsapp', 'manettes', 'manette', 'falcon', 'casino', 'tesla', 'leds', 'ps5', 'led'];
const NOMBRES = ['deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix', 'onze', 'douze', 'quinze', 'vingt', 'trente', 'quarante', 'cinquante', 'soixante', 'cent', 'mille', 'million', 'millions', 'demi', 'moitie', 'double', 'triple', 'minuit', 'midi'];
const SIGLES = new Set(['PS5', 'LED', 'LEDS', 'VTC', 'TTC', 'FBI', 'POV', 'DM', 'MP', 'TWK', 'USB', 'QR']);

function lieuDans(s) { const n = norm(s); return LIEUX.find((l) => contem(n, l)) || null; }

/** Marcas concretas: números, moeda, lugares, objetos do carro, nomes próprios. Lista sem repetição. */
function concrets(s) {
  const n = norm(s); const achados = new Set();
  for (const m of n.matchAll(/(?<![a-z\d])\d+(?:[.,]\d+)?(?![a-z])/g)) achados.add(m[0]);
  for (const w of NOMBRES) if (contem(n, w)) achados.add(w);
  if (/€|\beuros?\b|\bballes\b/.test(n)) achados.add('€');
  for (const l of LIEUX) if (contem(n, l)) achados.add(l);
  for (const o of OBJETS) if (contem(n, o)) achados.add(o.replace(/s$/, ''));
  const t = String(s || '').split(/\s+/);
  for (let i = 1; i < t.length; i++) {
    const limpo = t[i].replace(/^[«"'(]+|[»"'),.;:!?…]+$/g, '');
    if (!/^\p{Lu}[\p{Ll}'-]{2,}/u.test(limpo)) continue; // nome próprio no meio da frase
    if (/[.!?…:]$/.test(t[i - 1]) || /^[?!:;]$/.test(t[i - 1])) continue;
    const nn = norm(limpo);
    if (![...achados].some((a) => a.includes(nn) || nn.includes(a))) achados.add(nn);
  }
  return [...achados];
}

function formuleDe(s) {
  const n = norm(s);
  for (const id of FORMULES.ordre) { const f = FORMULES.formules.find((x) => x.id === id); if (new RegExp(f.reconnait, 'i').test(n)) return { id: f.id, nom: f.nom }; }
  return null;
}

// ------------------------------------------------------------------ travas, clichês, estruturas, tipografia
function travas(texto, contexte = 'legende') {
  const n = norm(texto); const saida = [];
  for (const r of GARDE.regles) {
    if (!r.contextes.includes(contexte)) continue;
    if (r.id === 'prix') {
      const precos = [...n.matchAll(/(\d+(?:[.,]\d+)?) ?(?:€|euros?\b|balles\b)/g)].map((m) => Number(m[1].replace(',', '.')));
      if (!precos.length) continue;
      const fora = precos.filter((p) => !GARDE.prix_proposes.valeurs.includes(p));
      saida.push({ id: r.id, niveau: r.niveau, message: `${r.message}${fora.length ? ` Fora da proposta: ${fora.join(', ')} €.` : ` Valores citados (${precos.join(', ')} €) batem com a proposta.`}`, extrait: precos.map((p) => `${p} €`).join(', ') });
      continue;
    }
    const m = new RegExp(r.motif, 'i').exec(n);
    if (m) saida.push({ id: r.id, niveau: r.niveau, message: r.message, extrait: m[0].trim() });
  }
  const ordem = { bloquant: 0, alerte: 1, rappel: 2 };
  return saida.sort((a, b) => ordem[a.niveau] - ordem[b.niveau]);
}

function cliches(texto) {
  const n = norm(texto);
  return LEXIQUE.cliches.filter((c) => contem(n, c.t)).map((c) => ({ terme: c.t, categorie: c.c, conseil: c.conseil }));
}

function frases(texto) { return String(texto || '').split(/(?<=[.!?…])\s+|\n+/).map((f) => f.trim()).filter((f) => mots(f).length >= 2); }

function estruturas(texto, hashtagsMax = 5) {
  const n = norm(texto); const bruto = String(texto || ''); const saida = [];
  const conselho = (id) => LEXIQUE.structures.find((s) => s.id === id).conseil;
  for (const s of LEXIQUE.structures) { if (!s.motif) continue; const m = new RegExp(s.motif, 'i').exec(n); if (m) saida.push({ id: s.id, extrait: m[0].trim(), conseil: s.conseil }); }
  const t = bruto.split(/\s+/).map((x) => x.replace(/[^\p{L}\p{N}]/gu, ''));
  let seq = 0; let grito = false;
  for (const x of t) { if (/^\p{Lu}{2,}$/u.test(x) && !SIGLES.has(x)) { seq += 1; if (seq >= 3) grito = true; } else if (x) seq = 0; }
  if (grito) saida.push({ id: 'majuscules', conseil: conselho('majuscules') });
  if (bruto.split(/\n/).filter((l) => /^\s*\p{Extended_Pictographic}/u.test(l)).length >= 3) saida.push({ id: 'liste-emojis', conseil: conselho('liste-emojis') });
  if ((bruto.match(/!/g) || []).length >= 3) saida.push({ id: 'exclamations', conseil: conselho('exclamations') });
  if ((bruto.match(/—/g) || []).length >= 2) saida.push({ id: 'tirets', conseil: conselho('tirets') });
  const tam = frases(bruto.replace(/#\S+/g, '')).map((f) => mots(f).length);
  if (tam.length >= 5) { const media = tam.reduce((a, b) => a + b, 0) / tam.length; const dp = Math.sqrt(tam.reduce((a, b) => a + (b - media) ** 2, 0) / tam.length); if (dp / media < 0.25) saida.push({ id: 'phrases-uniformes', conseil: conselho('phrases-uniformes') }); }
  const tags = bruto.match(/#[\p{L}\p{N}_]+/gu) || [];
  if (tags.length > hashtagsMax) saida.push({ id: 'mur-de-hashtags', conseil: `${tags.length} hashtags; o teto é ${hashtagsMax}.` });
  return saida;
}

const RE_INVISIVEIS = new RegExp(`[${LEXIQUE.invisibles.map((c) => `\\u{${c}}`).join('')}]`, 'gu');
/** Tipografia francesa: espaço antes de ? ! ; e de : . Aponta o que falta; com `corrigir`, devolve o texto arrumado. */
function tipografia(texto) {
  const bruto = String(texto || '');
  const invisiveis = (bruto.match(RE_INVISIVEIS) || []).length;
  const semEspaco = (bruto.match(/(?<=[\p{L}\p{N}»")\]])[?!;]/gu) || []).length + (bruto.match(/(?<=[\p{L}»")])(?<!https?):(?=\s|$)/gu) || []).length;
  const corrigido = bruto.replace(RE_INVISIVEIS, '')
    .replace(/ ([?!;])/g, ' $1').replace(/(?<=[\p{L}\p{N}»")\]])([?!;])/gu, ' $1')
    .replace(/ :(?=\s|$)/g, ' :').replace(/(?<=[\p{L}»")])(?<!https?):(?=\s|$)/gu, ' :');
  return { invisiveis, sem_espaco: semEspaco, aspas_retas: (bruto.match(/"/g) || []).length, corrigido };
}

// ------------------------------------------------------------------ gancho
function segundos(texto, mpm) { return mots(texto).length / (mpm / 60); }
function tensao(n) {
  let c = 0;
  if (/\b(ne|n')\S* ?\S* ?(pas|jamais|plus|rien)\b|\b(personne|jamais|rien|aucune?|sans)\b/.test(n)) c += 1;
  if (/\b(mais|sauf|pourtant|alors que|en vrai|en realite|au lieu de|contre|vs)\b/.test(n)) c += 1;
  if (/\?/.test(n)) c += 1;
  if (/\b(interdit|secret|erreur|piege|vrai prix|combien|pourquoi|avant de|avant d'|pendant que|premiere fois|seule?|derniere?|savait pas|gratuit|risque|perdu|qui gagne)\b/.test(n)) c += 1;
  return c;
}

function noterAccroche(linha, mpm = 190) {
  const [voixBruta, ecranBruto] = String(linha).split(/\s+\|\s+/);
  const voix = (voixBruta || '').trim(); const ecran = (ecranBruto || '').trim();
  const n = norm(voix); const controles = {}; const motivos = [];
  const morta = LEXIQUE.amorces_mortes.bloquantes.find((a) => n === a.debut || n.startsWith(`${a.debut} `) || n.startsWith(`${a.debut},`) || n.startsWith(`${a.debut}'`));
  const mole = !morta && LEXIQUE.amorces_mortes.molles.find((a) => n.startsWith(`${a} `) || n.startsWith(`${a},`));
  controles.entree = morta ? 0 : mole ? 45 : 100;
  if (morta) motivos.push(morta.conseil);
  if (mole) motivos.push(`Começa com "${mole}": palavra de apoio. Corte e comece na coisa.`);
  const marcas = concrets(voix);
  controles.concret = marcas.length === 0 ? 20 : marcas.length === 1 ? 70 : 100;
  const lieu = lieuDans(`${voix} ${ecran}`);
  controles.lieu = lieu ? 100 : 40;
  const s = segundos(voix, mpm);
  controles.duree = s <= 3 ? 100 : s <= 3.5 ? 80 : s <= 4.5 ? 55 : s <= 6 ? 30 : 10;
  const tc = tensao(n);
  controles.tension = tc === 0 ? 30 : tc === 1 ? 70 : 100;
  if (ecran) {
    const me = mots(ecran).length;
    let e = me <= 6 ? 100 : me <= 8 ? 65 : 25;
    if (norm(ecran) === n) { e = Math.min(e, 50); motivos.push('Texto de tela igual à fala. São dois ganchos: o da tela é o mais curto e seco.'); }
    if (/\.$/.test(ecran)) e -= 10;
    controles.ecran = e;
  }
  const valores = Object.values(controles);
  let nota = Math.round(0.6 * (valores.reduce((a, b) => a + b, 0) / valores.length) + 0.4 * Math.min(...valores));
  if (morta) nota = Math.min(nota, 30);
  const cl = cliches(`${voix} ${ecran}`);
  if (cl.length) { nota = Math.min(nota, 45); motivos.push(`Clichê no gancho: ${cl.map((c) => `"${c.terme}"`).join(', ')}. ${cl[0].conseil}`); }
  const vistas = new Set();
  const tv = travas(voix, 'voix').concat(ecran ? travas(ecran, 'ecran') : []).filter((x) => (vistas.has(x.id) ? false : vistas.add(x.id)));
  const bloqueada = tv.some((x) => x.niveau === 'bloquant');
  const fraco = Object.entries(controles).sort((a, b) => a[1] - b[1])[0];
  const adresse = /\b(tu|te|toi|ton|ta|tes|t')\b|\bt'/.test(n) ? 'tu' : /\b(vous|votre|vos)\b/.test(n) ? 'vous' : /\b(je|j'|on|nous|mon|ma|notre)\b|\bj'/.test(n) ? 'je/on' : 'aucune';
  return { voix, ecran: ecran || null, note: nota, verdict: bloqueada ? 'BLOQUEADA' : nota >= 75 ? 'FORTE' : nota >= 50 ? 'CORRETA' : 'FRACA', controles, plus_faible: fraco[0], mots: mots(voix).length, secondes: arred(s), concrets: marcas, lieu, formule: formuleDe(voix), adresse, motifs: motivos, garde_fous: tv, sans_ecran: !ecran };
}

// ------------------------------------------------------------------ roteiro → folha de tempos
function minutage(texto, { mpm = 190, cible = null } = {}) {
  const batidas = []; let t = 0; const notasTela = [];
  for (const bruta of String(texto).split(/\r?\n/)) {
    const linha = bruta.trim(); if (!linha) continue;
    if (linha.startsWith('>')) { notasTela.push({ a: arred(t), texte: linha.slice(1).trim() }); continue; }
    const visual = /^\((\d+(?:[.,]\d+)?) ?s\)\s*(.*)$/i.exec(linha);
    const dur = visual ? Number(visual[1].replace(',', '.')) : segundos(linha, mpm);
    batidas.push({ debut: arred(t), duree: arred(dur), type: visual ? 'visuel' : 'voix', texte: visual ? visual[2] : linha });
    t += dur;
  }
  const avisos = []; const total = arred(t);
  if (!batidas.length) return { batidas, total: 0, avisos: ['Roteiro vazio.'] };
  const fala1 = batidas.find((b) => b.type === 'voix') || batidas[0];
  if (fala1.duree > 3) avisos.push(`A primeira fala dura ${fala1.duree} s. Gancho falado passa de 3 s: corte palavras ou comece mais adiante.`);
  if (batidas[0].type === 'visuel' && batidas[0].duree > 2) avisos.push(`A imagem de abertura dura ${batidas[0].duree} s sem fala. Acima de 2 s, ponha texto na tela desde o primeiro quadro.`);
  batidas.forEach((b, i) => { if (b !== fala1 && i > 0 && b.duree > 4) avisos.push(`Batida ${i + 1} dura ${b.duree} s. Mais de 4 s no mesmo plano é onde as pessoas saem: divida a fala ou troque a imagem no meio.`); });
  let seco = 0;
  batidas.forEach((b, i) => { if (b.type === 'voix' && !concrets(b.texte).length) { seco += 1; if (seco === 3) avisos.push(`Três falas seguidas sem nada concreto (até a batida ${i + 1}). Ponha um número, um lugar ou um objeto.`); } else seco = 0; });
  const inicio = [batidas[0].texte, ...batidas.filter((b) => b.debut < 2).map((b) => b.texte), ...notasTela.filter((x) => x.a < 2).map((x) => x.texte)].join(' ');
  if (!lieuDans(inicio)) avisos.push('Nenhuma cidade nos 2 primeiros segundos (fala ou tela). Regra do plano: viral é global, cliente é local.');
  const ultima = batidas[batidas.length - 1];
  const volta = [...new Set([...concrets(fala1.texte), ...concrets(batidas[0].texte)])].filter((c) => concrets(ultima.texte).includes(c));
  if (batidas.length > 2) avisos.push(volta.length ? `Fecha o ciclo: a última batida repete "${volta[0]}" do gancho. Segunda visualização é alcance de graça.` : 'Sem volta ao gancho no fim. Repetir um detalhe da primeira frase faz o vídeo recomeçar sozinho.');
  const fim = norm([ultima.texte, ...notasTela.slice(-2).map((x) => x.texte)].join(' '));
  if (!/vous jouez|on conduit|wantedchauffeur|lien en bio/.test(fim)) avisos.push('Sem a assinatura no último segundo ("Vous jouez. On conduit." + @wantedchauffeur).');
  if (cible) { const dif = arred(cible - total); if (Math.abs(dif) >= 2) avisos.push(dif > 0 ? `${dif} s abaixo do alvo. Curto costuma ser o certo; só alongue se faltar informação.` : `${-dif} s acima do alvo. Corte a batida menos concreta.`); }
  return { batidas, notas_tela: notasTela, total, mots: batidas.filter((b) => b.type === 'voix').reduce((a, b) => a + mots(b.texte).length, 0), mpm, cible, avisos };
}

// ------------------------------------------------------------------ legenda
function legende(texto, { plateforme = 'instagram', motsCles = [], type = 'legende' } = {}) {
  const p = PLATEFORMES.plateformes[plateforme]; if (!p) throw new Error(`Plataforma desconhecida: ${plateforme}. Use ${Object.keys(PLATEFORMES.plateformes).join(', ')}.`);
  const bruto = String(texto).trim(); const n = norm(bruto); const linhas = [];
  const add = (estado, nome, detalhe) => linhas.push({ estado, nome, detalhe });
  const max = type === 'bio' ? p.bio_max : p.legende_max;
  add(bruto.length <= max ? 'ok' : 'falha', 'COMPRIMENTO', `${bruto.length} / ${max} caracteres`);
  const tv = travas(bruto, type === 'bio' ? 'bio' : 'legende');
  if (type === 'bio') return { plateforme, type, fenetre: null, linhas, cliches: cliches(bruto), structures: estruturas(bruto, p.hashtags_max), garde_fous: tv, typographie: tipografia(bruto), limites_verifies: p.verifie_le };
  const primeira = bruto.split(/\n/)[0];
  const janela = bruto.replace(/\s*\n+\s*/g, ' ').slice(0, p.fenetre_visible);
  add(primeira.length <= p.fenetre_visible ? 'ok' : 'aviso', 'PRIMEIRA LINHA', primeira.length <= p.fenetre_visible ? `${primeira.length} caracteres: cabe inteira antes do "… plus"` : `${primeira.length} caracteres: é cortada em ${p.fenetre_visible}, no meio da ideia`);
  const cj = concrets(janela);
  add(cj.length ? 'ok' : 'aviso', 'GANCHO CONCRETO', cj.length ? `${cj.length} marca(s) concreta(s) no trecho visível: ${cj.slice(0, 4).join(', ')}` : 'nada concreto no trecho visível (número, lugar, objeto)');
  const lieu = lieuDans(bruto);
  add(lieu ? (lieuDans(janela) ? 'ok' : 'aviso') : 'aviso', 'LUGAR', lieu ? (lieuDans(janela) ? `"${lieuDans(janela)}" no trecho visível` : `"${lieu}" só aparece depois do corte; suba para a primeira linha`) : 'nenhuma cidade na legenda. Viral é global, cliente é local');
  const tags = bruto.match(/#[\p{L}\p{N}_]+/gu) || [];
  const noFim = !tags.length || bruto.indexOf(tags[0]) > bruto.length * 0.6;
  add(tags.length <= p.hashtags_max ? (noFim ? 'ok' : 'aviso') : 'falha', 'HASHTAGS', `${tags.length} / ${p.hashtags_max}${tags.length ? `: ${tags.join(' ')}` : ''}${noFim ? '' : ' (no meio do texto; leve para o fim)'}`);
  const pedidos = [['comentar', /\b(commente[zs]?|ecris|ecrivez|dis-(nous|moi)|dites-(nous|moi)|raconte[zs]?|reponds|repondez)\b/], ['reservar', /\b(reserve[zs]?|whatsapp|lien en bio|lien dans la bio)\b/], ['seguir', /\b(abonne-toi|abonnez-vous|suis-nous|suivez-nous|follow)\b/], ['salvar', /\b(enregistre[zs]?|sauvegarde[zs]?)\b/], ['enviar', /\b(envoie[zs]?|partage[zs]?|identifie[zs]?|tague[zs]?)\b/]].filter(([, re]) => re.test(n)).map(([nome]) => nome);
  add(pedidos.length === 1 ? 'ok' : 'aviso', 'UM PEDIDO', pedidos.length === 1 ? `um pedido: ${pedidos[0]}` : pedidos.length ? `${pedidos.length} pedidos (${pedidos.join(', ')}); escolha um` : 'nenhum pedido; diga o próximo passo');
  if (motsCles.length) { const faltam = motsCles.filter((k) => !n.includes(norm(k))); add(faltam.length ? 'aviso' : 'ok', 'PALAVRAS DE BUSCA', faltam.length ? `${motsCles.length - faltam.length}/${motsCles.length}. Faltam: ${faltam.join(', ')}` : `${motsCles.length}/${motsCles.length} presentes`); }
  if (/https?:\/\/|\bwww\./.test(n)) add('aviso', 'LINK', 'link na legenda não é clicável no Instagram; o caminho medido é o link da bio');
  const cl = cliches(bruto); const st = estruturas(bruto, p.hashtags_max); const tp = tipografia(bruto);
  add(cl.length ? 'aviso' : 'ok', 'CLICHÊS', cl.length ? `${cl.length}: ${cl.map((c) => `"${c.terme}"`).join(', ')}` : 'nenhum da lista');
  if (tp.sem_espaco || tp.invisiveis) add('aviso', 'TIPOGRAFIA', `${tp.sem_espaco ? `${tp.sem_espaco} sinal(is) ? ! ; : sem o espaço do francês` : ''}${tp.sem_espaco && tp.invisiveis ? '; ' : ''}${tp.invisiveis ? `${tp.invisiveis} caractere(s) invisível(is)` : ''} (use --corriger)`);
  return { plateforme, type, fenetre: janela, coupe: bruto.replace(/\s*\n+\s*/g, ' ').length > p.fenetre_visible, linhas, cliches: cl, structures: st, garde_fous: tv, typographie: tp, limites_verifies: p.verifie_le, limites_source: p.source };
}

// ------------------------------------------------------------------ pesquisa
const ALIAS = { compte: ['compte', 'conta', 'account'], abonnes: ['abonnes', 'seguidores', 'followers'], mediane: ['mediane', 'mediana', 'median'], vues: ['vues', 'views', 'visualizacoes'], accroche: ['accroche', 'gancho', 'hook'], ecran: ['ecran', 'tela', 'on-screen'], duree: ['duree', 'duracao', 'length'], format: ['format', 'formato'] };
const numero = (v) => { const s = String(v || '').toLowerCase().replace(/\s/g, ''); const m = /^([\d.,]+)(k|m)?$/.exec(s); if (!m) return Number(s.replace(/[^\d]/g, '')) || 0; const base = Number(m[2] ? m[1].replace(',', '.') : m[1].replace(/[.,]/g, '')); return Math.round(base * (m[2] === 'k' ? 1e3 : m[2] === 'm' ? 1e6 : 1)); };
function veille(tsv) {
  const linhas = String(tsv).split(/\r?\n/).filter((l) => l.trim());
  const cab = linhas.shift().split('\t').map((c) => norm(c));
  const col = (nome) => cab.findIndex((c) => ALIAS[nome].includes(c));
  const ix = Object.fromEntries(Object.keys(ALIAS).map((k) => [k, col(k)]));
  if (ix.vues < 0 || ix.accroche < 0) throw new Error('O arquivo precisa de cabeçalho com pelo menos as colunas "vues" e "accroche" (separadas por TAB).');
  let comMediana = 0;
  const itens = linhas.map((l) => l.split('\t')).map((c) => {
    const vues = numero(c[ix.vues]); const med = ix.mediane >= 0 ? numero(c[ix.mediane]) : 0; const ab = ix.abonnes >= 0 ? numero(c[ix.abonnes]) : 0;
    const basev = med || ab; if (med) comMediana += 1;
    const accroche = (c[ix.accroche] || '').trim(); const ecran = ix.ecran >= 0 ? (c[ix.ecran] || '').trim() : '';
    const nota = noterAccroche(ecran ? `${accroche} | ${ecran}` : accroche);
    return { compte: ix.compte >= 0 ? (c[ix.compte] || '').trim() : '', vues, base: basev, base_type: med ? 'mediane' : ab ? 'abonnes' : null, multiple: basev ? arred(vues / basev) : null, accroche, formule: nota.formule, note: nota.note, mots: nota.mots };
  }).filter((r) => r.vues && r.accroche && r.multiple !== null).sort((a, b) => b.multiple - a.multiple);
  const terco = Math.max(1, Math.floor(itens.length / 3)); const alto = itens.slice(0, terco); const baixo = itens.slice(-terco);
  const conta = (lista) => { const c = {}; for (const r of lista) if (r.formule) c[r.formule.nom] = (c[r.formule.nom] || 0) + 1; return Object.entries(c).sort((a, b) => b[1] - a[1]); };
  const contas = new Set(itens.map((r) => r.compte)).size;
  return { reels: itens.length, comptes: contas, base: comMediana === itens.length ? 'mediana da conta' : comMediana ? 'mista (algumas linhas só com seguidores, menos confiável)' : 'seguidores (menos confiável: sem mediana, voltamos a medir tamanho)', itens, sinais: itens.filter((r) => r.multiple >= 3), topo: { formules: conta(alto), mots_mediane: mediana(alto.map((r) => r.mots)), note_mediane: mediana(alto.map((r) => r.note)) }, fundo: { formules: conta(baixo), mots_mediane: mediana(baixo.map((r) => r.mots)), note_mediane: mediana(baixo.map((r) => r.note)) }, sans_formule: itens.filter((r) => !r.formule), amostra: itens.length >= 30 && contas >= 5 ? 'suficiente para apontar padrões' : `pequena (${itens.length} reels, ${contas} contas): serve de pista, não de prova. Com 30+ reels em 5+ contas dá para afirmar` };
}

// ------------------------------------------------------------------ diário e balanço
const CAMPOS_NUM = ['vues', 'portee', 'enregistrements', 'partages', 'commentaires', 'abonnes', 'leads', 'retention3s', 'duree'];
const CAMPOS_TXT = ['date', 'heure', 'plateforme', 'format', 'accroche', 'ecran', 'personnage', 'pilier', 'ville', 'lien', 'note_libre'];
function hojeParis() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
function lerJournal(dossier) {
  const f = path.join(dossier, 'journal.jsonl'); const porId = new Map();
  if (!fs.existsSync(f)) return [];
  for (const l of fs.readFileSync(f, 'utf8').split(/\r?\n/)) { if (!l.trim()) continue; let o; try { o = JSON.parse(l); } catch { continue; } porId.set(o.id, { ...(porId.get(o.id) || {}), ...o }); }
  return [...porId.values()].filter((p) => !p.supprime);
}
function gravarJournal(dossier, linha) { fs.mkdirSync(dossier, { recursive: true }); fs.appendFileSync(path.join(dossier, 'journal.jsonl'), `${JSON.stringify({ ...linha, ts: new Date().toISOString() })}\n`, 'utf8'); }
function camposDe(flags) {
  const o = {};
  for (const k of CAMPOS_TXT) if (flags[k] !== undefined && flags[k] !== true) o[k] = String(flags[k]);
  for (const k of CAMPOS_NUM) if (flags[k] !== undefined && flags[k] !== true) { const v = Number(String(flags[k]).replace(',', '.')); if (!Number.isFinite(v)) throw new Error(`--${k} precisa ser número (recebido: ${flags[k]}).`); o[k] = v; }
  if (o.date && !/^\d{4}-\d{2}-\d{2}$/.test(o.date)) throw new Error('--date no formato AAAA-MM-DD.');
  return o;
}
const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
function bilan(posts) {
  const comVues = posts.filter((p) => Number.isFinite(p.vues) && p.vues > 0);
  const grupo = (p) => `${p.plateforme || 'instagram'}/${p.format || 'reel'}`;
  const medGrupo = {}; for (const g of new Set(comVues.map(grupo))) { const v = comVues.filter((p) => grupo(p) === g).map((p) => p.vues); medGrupo[g] = v.length >= 3 ? mediana(v) : null; }
  const medGeral = mediana(comVues.map((p) => p.vues));
  const itens = comVues.map((p) => { const base = medGrupo[grupo(p)] || medGeral; const nota = p.accroche ? noterAccroche(p.ecran ? `${p.accroche} | ${p.ecran}` : p.accroche) : null; return { ...p, multiple: arred(p.vues / base, 2), formule: nota && nota.formule ? nota.formule.nom : null, jour: p.date ? JOURS[new Date(`${p.date}T12:00:00Z`).getUTCDay()] : null, controles: nota ? nota.controles : null, note: nota ? nota.note : null }; }).sort((a, b) => b.multiple - a.multiple);
  const por = (campo) => { const m = {}; for (const p of itens) { const v = p[campo]; if (!v) continue; (m[v] = m[v] || []).push(p); } return Object.entries(m).map(([valor, l]) => ({ valor, n: l.length, multiple_mediane: arred(mediana(l.map((x) => x.multiple)), 2) })).sort((a, b) => b.multiple_mediane - a.multiple_mediane); };
  const taxa = (num, den, fator) => { const l = itens.filter((p) => Number.isFinite(p[num]) && p[den] > 0); return l.length ? { n: l.length, mediane: arred(mediana(l.map((p) => (p[num] / p[den]) * fator)), 2) } : null; };
  let calibragem;
  const comNota = itens.filter((p) => p.controles);
  if (comNota.length < 20) calibragem = { pronta: false, message: `Dados insuficientes: ${comNota.length}/20 posts com gancho e visualizações. Até lá, a nota de gancho é palpite informado, não medida desta conta.` };
  else {
    const linhas = [];
    for (const c of ['note', 'entree', 'concret', 'lieu', 'duree', 'tension', 'ecran']) {
      const val = (p) => (c === 'note' ? p.note : p.controles[c]);
      const alto = comNota.filter((p) => Number.isFinite(val(p)) && val(p) >= 70); const baixo = comNota.filter((p) => Number.isFinite(val(p)) && val(p) < 70);
      linhas.push(alto.length >= 5 && baixo.length >= 5 ? { controle: c, n_haut: alto.length, n_bas: baixo.length, multiple_haut: arred(mediana(alto.map((p) => p.multiple)), 2), multiple_bas: arred(mediana(baixo.map((p) => p.multiple)), 2) } : { controle: c, n_haut: alto.length, n_bas: baixo.length, insuffisant: true });
    }
    calibragem = { pronta: true, lignes: linhas, message: 'Diferença entre posts com o controle alto (≥70) e baixo. Controle sem diferença não mede nada NESTA conta: ignore-o. É correlação em amostra pequena, não prova.' };
  }
  return { posts: posts.length, avec_vues: comVues.length, mediane_vues: medGeral, medianes_par_groupe: medGrupo, classement: itens.map((p) => ({ id: p.id, date: p.date, multiple: p.multiple, vues: p.vues, accroche: p.accroche, formule: p.formule, personnage: p.personnage || null, pilier: p.pilier || null })), par: { formule: por('formule'), personnage: por('personnage'), pilier: por('pilier'), ville: por('ville'), jour: por('jour') }, taux: { partages_pour_1000_portee: taxa('partages', 'portee', 1000), enregistrements_pour_1000_portee: taxa('enregistrements', 'portee', 1000), abonnes_pour_1000_vues: taxa('abonnes', 'vues', 1000), leads_pour_10000_vues: taxa('leads', 'vues', 10000) }, calibragem, amostra: comVues.length >= 20 ? 'razoável' : `pequena (${comVues.length} posts com visualizações): leia como pista. Agrupamento com n menor que 3 não diz nada` };
}

// ------------------------------------------------------------------ saída em texto
const barra = (v) => `${'#'.repeat(Math.round(v / 10))}${'.'.repeat(10 - Math.round(v / 10))}`;
const MARCA = { ok: 'OK    ', aviso: 'AVISO ', falha: 'FALHA ' };
const NIVEL = { bloquant: 'BLOQUEIA', alerte: 'CONFERIR', rappel: 'LEMBRETE' };
function imprimirTravas(tv) { if (!tv.length) return; console.log('\nTRAVAS DO PROJETO'); for (const x of tv) console.log(`  ${NIVEL[x.niveau]}  ${x.message}\n            trecho: "${x.extrait}"`); }
function imprimirReleitura(cl, st) {
  if (cl.length) { console.log('\nCLICHÊS (reescreva; a ferramenta não troca sozinha)'); for (const c of cl) console.log(`  "${c.terme}"  ${c.conseil}`); }
  if (st.length) { console.log('\nTIQUES DE ESTRUTURA'); for (const s of st) console.log(`  ${s.id}${s.extrait ? `: "${s.extrait}"` : ''}\n      ${s.conseil}`); }
}

function parse(argv) {
  const pos = []; const flags = {};
  for (let i = 0; i < argv.length; i++) { const a = argv[i]; if (a.startsWith('--')) { const k = a.slice(2); const prox = argv[i + 1]; if (prox === undefined || prox.startsWith('--')) flags[k] = true; else { flags[k] = prox; i += 1; } } else pos.push(a); }
  return { pos, flags };
}
function entrada(pos, flags, i = 1) {
  if (typeof flags.texte === 'string') return flags.texte.replace(/\\n/g, '\n');
  const f = pos[i]; if (!f) throw new Error('Faltou o arquivo de entrada (ou --texte "…", ou - para ler da entrada padrão).');
  return fs.readFileSync(f === '-' ? 0 : f, 'utf8').replace(/^﻿/, '');
}

function principal(argv) {
  const { pos, flags } = parse(argv); const cmd = pos[0];
  const json = (o) => { console.log(JSON.stringify(o, null, 1)); };
  const dossier = path.resolve(typeof flags.dossier === 'string' ? flags.dossier : process.env.WC_DOSSIER || 'wanted-chauffeur');
  const mpm = Number(flags.mpm) || 190;

  if (cmd === 'accroche') {
    const linhas = entrada(pos, flags).split(/\r?\n/).map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').trim()).filter(Boolean);
    const r = linhas.map((l) => noterAccroche(l, mpm)).sort((a, b) => b.note - a.note);
    if (flags.json) return json(r);
    console.log('GANCHOS · da nota mais alta para a mais baixa\n' + '='.repeat(78));
    r.forEach((h, i) => {
      console.log(`${i === 0 ? '->' : '  '} ${String(h.note).padStart(3)} ${h.verdict.padEnd(9)} ${h.voix}`);
      if (h.ecran) console.log(`      tela: ${h.ecran}`);
      console.log(`      ${Object.entries(h.controles).map(([k, v]) => `${k} ${v}`).join(' · ')}  |  ${h.mots} palavras, ~${h.secondes} s  |  fórmula: ${h.formule ? h.formule.nom : 'sem nome'}`);
      console.log(`      mais fraco: ${h.plus_faible.toUpperCase()} (${h.controles[h.plus_faible]})`);
      for (const m of h.motifs) console.log(`      ! ${m}`);
      if (h.sans_ecran) console.log('      ! Sem texto de tela. Escreva "fala | texto de tela": nesta conta a tela é lida antes de a fala ser ouvida.');
      for (const x of h.garde_fous) console.log(`      ${NIVEL[x.niveau]}: ${x.message}`);
    });
    return console.log('\nEsta nota elimina gancho fraco. Não escolhe o vencedor entre dois bons: isso quem diz é o `bilan`, com os números da conta.');
  }
  if (cmd === 'minutage') {
    const r = minutage(entrada(pos, flags), { mpm, cible: Number(flags.cible) || null });
    if (flags.json) return json(r);
    console.log(`FOLHA DE TEMPOS · ${r.mots} palavras faladas · ~${r.total} s a ${r.mpm} palavras/min${r.cible ? ` · alvo ${r.cible} s` : ''}\n${'='.repeat(78)}`);
    const g = r.batidas.findIndex((b) => b.type === 'voix');
    r.batidas.forEach((b, i) => console.log(`  ${String(b.debut.toFixed(1)).padStart(5)}  ${String(b.duree.toFixed(1)).padStart(4)} s  ${(b.type === 'visuel' ? 'IMAGEM' : i === g ? 'GANCHO' : i === r.batidas.length - 1 ? 'FIM' : '').padEnd(6)}  ${b.texte}`));
    for (const x of r.notas_tela || []) console.log(`  ${String(x.a.toFixed(1)).padStart(5)}          TELA    ${x.texte}`);
    console.log('-'.repeat(78)); for (const a of r.avisos) console.log(`  - ${a}`);
    return console.log(`\nTempo estimado a ${r.mpm} palavras/min. Cronometre uma leitura sua e ajuste com --mpm.`);
  }
  if (cmd === 'legende') {
    const texto = entrada(pos, flags);
    const r = legende(texto, { plateforme: typeof flags.plateforme === 'string' ? flags.plateforme : 'instagram', motsCles: typeof flags['mots-cles'] === 'string' ? flags['mots-cles'].split(',').map((s) => s.trim()).filter(Boolean) : [], type: flags.type === 'bio' ? 'bio' : 'legende' });
    if (flags.json) return json(r);
    if (r.fenetre !== null) {
      console.log(`  O QUE O FEED MOSTRA (${r.plateforme})`); const larg = 54;
      console.log(`  +${'-'.repeat(larg + 2)}+`);
      const pal = r.fenetre.split(' '); let lin = '';
      for (const w of pal) { if ((lin + ' ' + w).trim().length > larg) { console.log(`  | ${lin.padEnd(larg)} |`); lin = w; } else lin = (lin + ' ' + w).trim(); }
      if (lin) console.log(`  | ${lin.padEnd(larg)} |`);
      console.log(`  +${'-'.repeat(larg + 2 - (r.coupe ? 9 : 0))}${r.coupe ? ' … plus +' : '+'}\n`);
    }
    for (const l of r.linhas) console.log(`  ${MARCA[l.estado]}${l.nome.padEnd(18)}${l.detalhe}`);
    imprimirReleitura(r.cliches, r.structures); imprimirTravas(r.garde_fous);
    if (flags.corriger) console.log(`\nTEXTO COM A TIPOGRAFIA CORRIGIDA\n${'-'.repeat(40)}\n${r.typographie.corrigido}`);
    if (!r.limites_verifies) console.log('\nOs limites desta rede não foram conferidos por nós na própria rede (donnees/plateformes.json). Se a rede disser outra coisa, a rede tem razão.');
    return undefined;
  }
  if (cmd === 'texte' || cmd === 'garde') {
    const texto = entrada(pos, flags); const ctx = typeof flags.contexte === 'string' ? flags.contexte : 'legende';
    if (!['legende', 'voix', 'ecran', 'bio'].includes(ctx)) throw new Error('--contexte: legende, voix, ecran ou bio.');
    const r = { contexte: ctx, garde_fous: travas(texto, ctx), ...(cmd === 'texte' ? { cliches: cliches(texto), structures: estruturas(texto), typographie: tipografia(texto) } : {}) };
    if (flags.json) return json(r);
    if (cmd === 'texte') { imprimirReleitura(r.cliches, r.structures); const tp = r.typographie; console.log(`\nTIPOGRAFIA: ${tp.sem_espaco} sinal(is) sem o espaço do francês · ${tp.invisiveis} caractere(s) invisível(is) · ${tp.aspas_retas} aspas retas (em francês: « »)`); if (flags.corriger) console.log(`\nTEXTO CORRIGIDO\n${'-'.repeat(40)}\n${tp.corrigido}`); }
    imprimirTravas(r.garde_fous);
    if (!r.garde_fous.length) console.log(`\nNenhuma trava disparou no contexto "${ctx}". Isso não substitui a conferência humana: a lista cobre o que o plano previu.`);
    return undefined;
  }
  if (cmd === 'veille') {
    const r = veille(entrada(pos, flags));
    const md = [`# Veille · ${r.reels} reels · ${r.comptes} contas · base: ${r.base}`, '', `Amostra: ${r.amostra}.`, '', '## Acima de 3× (sinal)', ...(r.sinais.length ? r.sinais.map((x) => `- **${x.multiple}×** · ${x.formule ? x.formule.nom : 'sem nome'} · ${x.compte} · ${x.vues.toLocaleString('fr-FR')} vues\n  « ${x.accroche} »`) : ['- nenhum']), '', '## O que separa o terço de cima do de baixo', `- Fórmulas em cima: ${r.topo.formules.map(([n, c]) => `${n} ×${c}`).join(', ') || 'nenhuma nomeada'}`, `- Fórmulas embaixo: ${r.fundo.formules.map(([n, c]) => `${n} ×${c}`).join(', ') || 'nenhuma nomeada'}`, `- Palavras no gancho (mediana): ${r.topo.mots_mediane} em cima, ${r.fundo.mots_mediane} embaixo`, '', `## Sem fórmula (${r.sans_formule.length}): leia à mão, pode haver uma fórmula nova`, ...r.sans_formule.map((x) => `- ${x.multiple}× · ${x.compte} · « ${x.accroche} »`), '', 'Copie a fórmula, nunca o vídeo. Cada linha traz a conta de onde veio.'].join('\n');
    if (typeof flags.sortie === 'string') { fs.mkdirSync(path.dirname(path.resolve(flags.sortie)), { recursive: true }); fs.writeFileSync(flags.sortie, `${md}\n`, 'utf8'); }
    if (flags.json) return json(r);
    console.log(md.replace(/^#+ /gm, '').replace(/\*\*/g, ''));
    return typeof flags.sortie === 'string' ? console.log(`\nGravado em ${flags.sortie}`) : undefined;
  }
  if (cmd === 'journal') {
    const sub = pos[1];
    if (sub === 'ajouter') {
      const c = camposDe(flags); if (!c.accroche && !c.note_libre) throw new Error('Diga ao menos --accroche "…" (a primeira frase do post).');
      const data = c.date || hojeParis(); const existentes = lerJournal(dossier).map((p) => p.id);
      let n = 1; let id; do { id = `P-${data.replace(/-/g, '')}-${String(n).padStart(2, '0')}`; n += 1; } while (existentes.includes(id));
      const linha = { id, date: data, plateforme: 'instagram', format: 'reel', ...c };
      gravarJournal(dossier, linha);
      return flags.json ? json(linha) : console.log(`Registrado ${id} em ${path.join(dossier, 'journal.jsonl')}. Para pôr os números depois: journal maj ${id} --vues … --portee …`);
    }
    if (sub === 'maj') {
      const id = pos[2]; const atual = lerJournal(dossier).find((p) => p.id === id); if (!atual) throw new Error(`Post ${id || '(sem id)'} não está no diário.`);
      const c = camposDe(flags); if (flags.supprimer) c.supprime = true; if (!Object.keys(c).length) throw new Error('Nada para atualizar.');
      gravarJournal(dossier, { id, ...c });
      return flags.json ? json({ id, ...c }) : console.log(`Atualizado ${id}: ${Object.keys(c).join(', ')}. O histórico anterior continua no arquivo.`);
    }
    if (sub === 'lister') { const l = lerJournal(dossier).sort((a, b) => String(b.date).localeCompare(String(a.date))); if (flags.json) return json(l); if (!l.length) return console.log('Diário vazio.'); for (const p of l) console.log(`${p.id}  ${p.date}  ${String(p.vues ?? '—').padStart(8)} vues  ${p.format}  ${p.accroche || p.note_libre || ''}`); return undefined; }
    throw new Error('journal: ajouter, maj <id> ou lister.');
  }
  if (cmd === 'bilan') {
    const r = bilan(lerJournal(dossier));
    if (flags.json) return json(r);
    console.log(`BALANÇO · ${r.posts} posts no diário · ${r.avec_vues} com visualizações · mediana ${r.mediane_vues ?? '—'}\nAmostra: ${r.amostra}.\n${'='.repeat(78)}`);
    if (!r.avec_vues) return console.log('Sem números ainda. Registre os posts com `journal ajouter` e os resultados com `journal maj`.');
    console.log('ACIMA E ABAIXO DA PRÓPRIA MEDIANA'); for (const p of r.classement.slice(0, 5)) console.log(`  ${String(p.multiple).padStart(5)}×  ${p.date}  ${p.accroche || ''}`);
    if (r.classement.length > 5) { console.log('  …'); for (const p of r.classement.slice(-3)) console.log(`  ${String(p.multiple).padStart(5)}×  ${p.date}  ${p.accroche || ''}`); }
    for (const [campo, l] of Object.entries(r.par)) { if (!l.length) continue; console.log(`\nPOR ${campo.toUpperCase()} (múltiplo mediano)`); for (const x of l) console.log(`  ${String(x.multiple_mediane).padStart(5)}×  ${x.valor}  (n=${x.n}${x.n < 3 ? ', pouco para concluir' : ''})`); }
    console.log('\nTAXAS (mediana)'); for (const [k, v] of Object.entries(r.taux)) console.log(`  ${k.padEnd(34)} ${v ? `${v.mediane}  (n=${v.n})` : 'sem dados'}`);
    console.log('\nA NOTA DE GANCHO PREVÊ ALGO NESTA CONTA?'); if (!r.calibragem.pronta) console.log(`  ${r.calibragem.message}`); else { for (const l of r.calibragem.lignes) console.log(l.insuffisant ? `  ${l.controle.padEnd(8)} sem os dois lados (alto n=${l.n_haut}, baixo n=${l.n_bas})` : `  ${l.controle.padEnd(8)} alto ${l.multiple_haut}× (n=${l.n_haut})  ·  baixo ${l.multiple_bas}× (n=${l.n_bas})`); console.log(`  ${r.calibragem.message}`); }
    return undefined;
  }
  console.log('Wanted Chauffeur Studio\n  accroche | minutage | legende | texte | garde | veille | journal ajouter|maj|lister | bilan\n  Detalhes no cabeçalho de outils/wc.js e em SKILL.md.');
  return undefined;
}

module.exports = { norm, mots, concrets, lieuDans, formuleDe, travas, cliches, estruturas, tipografia, noterAccroche, minutage, legende, veille, bilan, lerJournal, principal };
if (require.main === module) { try { principal(process.argv.slice(2)); } catch (e) { console.error(`Erro: ${e.message}`); process.exit(1); } }
