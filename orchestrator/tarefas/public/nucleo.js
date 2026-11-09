/* COMPASSO — núcleo compartilhado entre o navegador e o servidor (mesmo arquivo, mesmo resultado).
   Sem dependências e sem rede. Três coisas moram aqui:
     1. datas no fuso da empresa (Europe/Paris), nunca em UTC;
     2. o leitor de frases: "Ligar para o Monak sexta @julien !alta" → campos do card, com prévia ao vivo na tela;
     3. o foco do dia: dada a lista de cards, o que fazer agora, e por quê.
   Regra que o leitor impõe: prazo e pessoa só existem se a frase os disse. Na dúvida, fica vazio; nunca inventa. */
(function (raiz, fabrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabrica();
  else raiz.COMPASSO_NUCLEO = fabrica();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const FUSO_PADRAO = 'Europe/Paris';

  // ------------------------------------------------------------------ datas
  function hoje(fuso, agora) {
    try { return new Intl.DateTimeFormat('en-CA', { timeZone: fuso || FUSO_PADRAO, year: 'numeric', month: '2-digit', day: '2-digit' }).format(agora || new Date()); }
    catch { return (agora || new Date()).toISOString().slice(0, 10); }
  }
  function dataValida(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
    if (!m) return false;
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
  }
  const paraData = (iso) => new Date(iso + 'T00:00:00Z');
  const paraIso = (d) => d.toISOString().slice(0, 10);
  function somarDias(iso, n) { const d = paraData(iso); d.setUTCDate(d.getUTCDate() + n); return paraIso(d); }
  function somarMeses(iso, n) {
    const d = paraData(iso); const dia = d.getUTCDate();
    d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + n);
    const ultimo = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(dia, ultimo));
    return paraIso(d);
  }
  function diaDaSemana(iso) { return paraData(iso).getUTCDay(); }
  function diasEntre(de, ate) { return Math.round((paraData(ate) - paraData(de)) / 864e5); }
  function somarDiasUteis(iso, n) { let d = iso; for (let i = 0; i < n; i++) { do { d = somarDias(d, 1); } while ([0, 6].includes(diaDaSemana(d))); } return d; }

  /** Próxima ocorrência de um card recorrente. Nunca devolve data no passado. */
  function proximaData(base, repete, dia) {
    let d = base || dia;
    const passo = () => {
      if (repete === 'diaria') d = somarDias(d, 1);
      else if (repete === 'dias_uteis') d = somarDiasUteis(d, 1);
      else if (repete === 'semanal') d = somarDias(d, 7);
      else if (repete === 'mensal') d = somarMeses(d, 1);
      else return false;
      return true;
    };
    if (!passo()) return null;
    let guarda = 0;
    while (d < dia && guarda++ < 2000) passo();
    return d;
  }

  // ------------------------------------------------------------------ vocabulário
  const MESES = { janeiro: 1, jan: 1, janvier: 1, fevereiro: 2, fev: 2, fevrier: 2, 'février': 2, marco: 3, 'março': 3, mar: 3, mars: 3, abril: 4, abr: 4, avril: 4, avr: 4, maio: 5, mai: 5, junho: 6, jun: 6, juin: 6, julho: 7, jul: 7, juillet: 7, juil: 7, agosto: 8, ago: 8, aout: 8, 'août': 8, setembro: 9, set: 9, septembre: 9, sept: 9, outubro: 10, out: 10, octobre: 10, oct: 10, novembro: 11, nov: 11, novembre: 11, dezembro: 12, dez: 12, decembre: 12, 'décembre': 12, dec: 12, 'déc': 12 };
  // Abreviação é também palavra comum ("12 set de velas"): sem preposição, só vale no fim da frase.
  const MES_ABREVIADO = new Set(['jan', 'fev', 'mar', 'abr', 'avr', 'jun', 'jul', 'juil', 'ago', 'set', 'sept', 'out', 'oct', 'nov', 'dez', 'dec', 'déc']);
  const SEMANA = { domingo: 0, segunda: 1, 'terça': 2, terca: 2, quarta: 3, quinta: 4, sexta: 5, 'sábado': 6, sabado: 6, dimanche: 0, lundi: 1, mardi: 2, mercredi: 3, jeudi: 4, vendredi: 5, samedi: 6 };
  // Segunda, quarta, quinta e sexta são também ordinais/nomes em português ("a segunda opção", "Quinta do Lago"):
  // sozinhas só valem no fim da frase, antes de pontuação, ou com "-feira" / "que vem". Francês não tem esse problema.
  const AMBIGUOS = new Set(['segunda', 'terça', 'terca', 'quarta', 'quinta', 'sexta']);
  const NUMEROS = { um: 1, uma: 1, dois: 2, duas: 2, 'três': 3, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10, un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8, neuf: 9, dix: 10 };
  const CIDADES = [['Paris', 'paris'], ['Lagos', 'lagos'], ['Marrakech', 'marrakech|marrakesh|marraquexe'], ['Nice', 'nice'], ['Monaco', 'monaco|mônaco'], ['Cannes', 'cannes'], ['Saint-Tropez', 'saint-?tropez'], ['Atenas', 'atenas|athens|ath[èe]nes'], ['Lisboa', 'lisboa|lisbonne'], ['Londres', 'londres|london'], ['Dubai', 'dubai|duba[iï]'], ['Riviera', 'riviera|c[ôo]te d.azur']];
  const PREP = "(?:at[ée]|ate|para|pra|em|no|na|nesta|neste|nessa|nesse|essa|esta|este|esse|o|a|dia|o dia|no dia|au|avant|pour|d['’]ici|d['’]ici au|jusqu['’]au|jusqu['’]à|le|ce|cette|prazo)";
  const COMPLEMENTO = "(?:\\s+(?:de manh[ãa]|[àa] tarde|[àa] noite|cedo|sem falta|matin|soir|apr[èe]s-midi|au plus tard))?";
  const FECHA_FRASE = /^\s*(?:$|[,.;:!?)@#—–-])/;
  // "o jantar de 20/11", "o contrato do dia 12": a data é assunto, não prazo.
  const E_REFERENCIA = /(?:^|\s)(?:de|do|da|des|du)\s+$/i;
  // Depois de "até" ou "avant" vem o prazo; outra data antes é assunto ("o contrato do dia 12 até sexta").
  const PREP_FIRME = /(^|[^\wà-ú])(at[ée]|avant|jusqu['’](?:au|à|a)|d['’]ici|prazo)(?![\wà-ú])/i;

  function tirar(texto, m) { return texto.slice(0, m.index) + ' ' + texto.slice(m.index + m[0].length); }

  // ------------------------------------------------------------------ prazo
  /** Procura a menção de prazo. Devolve { iso, resto } ou null (resto = texto sem o trecho). */
  function acharPrazo(texto, dia) {
    const firme = PREP_FIRME.exec(texto);
    if (firme && firme.index + firme[1].length > 0) {
      const inicio = firme.index + firme[1].length;
      const r = procurarPrazo(texto.slice(inicio), dia);
      if (r) return { iso: r.iso, resto: texto.slice(0, inicio) + r.resto };
    }
    return procurarPrazo(texto, dia);
  }

  function procurarPrazo(texto, dia) {
    const achado = (m, iso) => ({ iso, resto: tirar(texto, m) });
    const primeiro = (fonte, avaliar) => { for (const m of texto.matchAll(new RegExp(fonte, 'gi'))) { const iso = avaliar(m); if (iso) return achado(m, iso); } return null; };
    const antes = (m) => texto.slice(0, m.index);
    const depois = (m) => texto.slice(m.index + m[0].length);
    const dow = diaDaSemana(dia);
    let r;

    // AAAA-MM-DD: no passado é referência a algo antigo, não prazo.
    r = primeiro(`(?:\\b${PREP}\\s+)*\\b(\\d{4}-\\d{2}-\\d{2})\\b`, (m) => (dataValida(m[1]) && m[1] >= dia && !E_REFERENCIA.test(antes(m)) ? m[1] : null));
    if (r) return r;

    // dd/mm[/aa]: 4/5 pessoas, 2/3 casas, 24/7, 12/2024 e 31/02 não são prazo.
    r = primeiro(`((?:\\b${PREP}\\s+)*)\\b(\\d{1,2})/(\\d{1,2})(?:/(\\d{2,4}))?(?![\\d/])`, (m) => {
      if (m[2] === '24' && m[3] === '7') return null;
      const resto = depois(m);
      if (/^\s*(?:pessoas?|personnes?|pax|convidad[oa]s?|h[óo]spedes?|clientes?|dos\b|das\b|des\b|du\b|%|de\b(?!\s+(?:manh|tarde|noite)))/i.test(resto)) return null;
      if (!m[1] && !FECHA_FRASE.test(resto)) return null; // sem "até/para/dia", só no fim da frase
      if (E_REFERENCIA.test(antes(m))) return null;
      const anoDado = m[4] ? (m[4].length === 2 ? 2000 + Number(m[4]) : Number(m[4])) : null;
      let iso = `${anoDado || dia.slice(0, 4)}-${m[3].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
      if (!dataValida(iso)) return null;
      if (!anoDado && iso < dia) iso = `${Number(dia.slice(0, 4)) + 1}-${m[3].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
      return dataValida(iso) && iso >= dia ? iso : null;
    });
    if (r) return r;

    // 12 de novembro · 15 nov · le 12 novembre · 12 de novembro de 2027
    const nomesMes = Object.keys(MESES).sort((a, b) => b.length - a.length).join('|');
    r = primeiro(`((?:\\b${PREP}\\s+)*)\\b(\\d{1,2})(?:\\s+de)?\\s+(${nomesMes})\\b\\.?(?:\\s+(?:de\\s+)?(\\d{4}))?`, (m) => {
      const nome = m[3].toLowerCase();
      if (MES_ABREVIADO.has(nome) && !m[1] && !m[4] && !FECHA_FRASE.test(depois(m))) return null;
      if (E_REFERENCIA.test(antes(m))) return null;
      const mes = String(MESES[nome]).padStart(2, '0');
      const ano = m[4] ? Number(m[4]) : Number(dia.slice(0, 4));
      let iso = `${ano}-${mes}-${m[2].padStart(2, '0')}`;
      if (!dataValida(iso)) return null;
      if (!m[4] && iso < dia) iso = `${ano + 1}-${mes}-${m[2].padStart(2, '0')}`;
      return dataValida(iso) && iso >= dia ? iso : null; // ano dito e já passado: é referência
    });
    if (r) return r;

    // dia 12 · pour le 12: este mês, ou o próximo se já passou
    r = primeiro(`((?:\\b(?:at[ée]|ate|para|pra|no|o|pour|avant|d['’]ici|jusqu['’]au|au)\\s+)*)\\b(dia|le)\\s+(\\d{1,2})\\b(?!\\s*(?:rue|avenue|boulevard|place|h\\b|:|/))`, (m) => {
      if (m[2].toLowerCase() === 'le' && !/\b(?:pour|avant|d['’]ici|jusqu['’]au|au)\b/i.test(m[1])) return null;
      if (E_REFERENCIA.test(antes(m))) return null;
      const dd = m[3].padStart(2, '0');
      let iso = `${dia.slice(0, 7)}-${dd}`;
      if (!dataValida(iso) || iso < dia) iso = `${somarMeses(`${dia.slice(0, 7)}-01`, 1).slice(0, 7)}-${dd}`;
      return dataValida(iso) ? iso : null;
    });
    if (r) return r;

    // em 3 dias · daqui a 2 semanas · dans 3 jours · em 3 dias úteis
    const nums = Object.keys(NUMEROS).join('|');
    r = primeiro(`\\b(?:em|daqui(?:\\s+a)?|dentro de|dans|d['’]ici)\\s+(\\d{1,3}|${nums})\\s+(dias?|semanas?|m[eê]s(?:es)?|jours?|semaines?|mois)(\\s+[úu]te(?:is|l)|\\s+ouvr[ée]s?)?(?![\\wà-ú])`, (m) => {
      const n = /^\d+$/.test(m[1]) ? Number(m[1]) : NUMEROS[m[1].toLowerCase()];
      const u = m[2].toLowerCase();
      if (/^(dia|jour)/.test(u)) return m[3] ? somarDiasUteis(dia, n) : somarDias(dia, n);
      if (/^sem/.test(u)) return somarDias(dia, 7 * n);
      return somarMeses(dia, n);
    });
    if (r) return r;

    r = primeiro(`(?:\\b${PREP}\\s+)*\\b(?:depois de amanh[ãa]|apr[èe]s-demain)(?![a-zà-ú])${COMPLEMENTO}`, () => somarDias(dia, 2));
    if (r) return r;
    r = primeiro(`(?:\\b${PREP}\\s+)*\\b(?:hoje|aujourd['’]hui)(?![a-zà-ú])${COMPLEMENTO}`, () => dia);
    if (r) return r;
    r = primeiro(`(?:\\b${PREP}\\s+)*\\b(?:amanh[ãa]|demain)(?![a-zà-ú])${COMPLEMENTO}`, () => somarDias(dia, 1));
    if (r) return r;

    // fim do mês · fin du mois
    r = primeiro(`(?:\\b(?:at[ée]|ate|para|pra|no|avant|pour|d['’]ici)\\s+)?(?:\\b(?:o|a|la|le)\\s+)?\\b(?:fim do m[eê]s|final do m[eê]s|fin du mois)\\b`, () => {
      const ult = paraIso(new Date(Date.UTC(+dia.slice(0, 4), +dia.slice(5, 7), 0)));
      return ult === dia ? paraIso(new Date(Date.UTC(+dia.slice(0, 4), +dia.slice(5, 7) + 1, 0))) : ult;
    });
    if (r) return r;
    // semana que vem → sexta da próxima semana; esta semana → sexta desta (no sábado, o domingo)
    r = primeiro(`(?:\\b${PREP}\\s+)*\\b(?:pr[óo]xima semana|semana que vem|semaine prochaine)\\b`, () => somarDias(dia, ((8 - dow) % 7 || 7) + 4));
    if (r) return r;
    r = primeiro(`(?:\\b${PREP}\\s+)*\\b(?:(?:o\\s+)?fim da semana|(?:o\\s+)?final da semana|essa semana|esta semana|(?:la\\s+)?fin de (?:la )?semaine|cette semaine)\\b`, () => somarDias(dia, dow === 0 ? 0 : dow === 6 ? 1 : 5 - dow));
    if (r) return r;

    // dias da semana
    const nomes = Object.keys(SEMANA).sort((x, y) => y.length - x.length).join('|');
    return primeiro(`((?:\\b${PREP}\\s+)*(?:\\b(?:pr[óo]xim[ao])\\s+)?)\\b(${nomes})(-feira)?(\\s+que vem|\\s+prochain)?\\b${COMPLEMENTO}`, (m) => {
      const nome = m[2].toLowerCase();
      const seguinte = depois(m);
      const fechaFrase = FECHA_FRASE.test(seguinte);
      const antesDaLigacao = /^\s+(?:para|pra|pro|com|e|ou|ao|aos|à|às|as|que|pour|avec|et|au|aux)\b/i.test(seguinte);
      const prefixo = m[1] || '';
      const firme = /(?:at[ée]|ate|avant|pour|d['’]ici|jusqu|pr[óo]xim)/i.test(prefixo);
      if (AMBIGUOS.has(nome) && !m[3] && !m[4] && !firme && !fechaFrase && !antesDaLigacao) return null; // "Quinta do Lago", "a segunda opção"
      let dif = (SEMANA[nome] - dow + 7) % 7;
      const destaSemana = /(?:^|\s)(?:esta|essa|este|esse|nesta|nessa|neste|nesse|cette|ce)\s+$/i.test(prefixo);
      if (dif === 0 && !destaSemana) dif = 7; // "até sexta", na sexta: a próxima; "esta sexta", na sexta: hoje
      const isoDow = dow === 0 ? 7 : dow;
      if (m[4] && dif <= 7 - isoDow) dif += 7; // "sexta que vem", na quinta: a da semana que vem, não amanhã
      return somarDias(dia, dif);
    });
  }

  // ------------------------------------------------------------------ dono, prioridade, canal, cidade, referência, repetição
  const NOMES_PESSOAS = [['marlon', 'm[áa]rlon'], ['lucas', 'lucas'], ['julien', 'julien']];

  function acharDono(texto) {
    // @julien é explícito e ganha de qualquer outro nome no texto.
    const arroba = [];
    let resto = texto;
    for (const [id, pad] of NOMES_PESSOAS) {
      const re = new RegExp(`(^|\\s)@${pad}\\b`, 'i');
      const m = re.exec(resto);
      if (m) { arroba.push(id); resto = resto.slice(0, m.index) + ' ' + resto.slice(m.index + m[0].length); }
    }
    if (arroba.length === 1) return { dono: arroba[0], resto, ambiguo: false };
    if (arroba.length > 1) return { dono: null, resto, ambiguo: true };
    const citados = NOMES_PESSOAS.filter(([, pad]) => new RegExp(`(^|[^\\wà-ú])${pad}(?![\\wà-ú])`, 'i').test(texto)).map(([id]) => id);
    if (citados.length !== 1) return { dono: null, resto: texto, ambiguo: citados.length > 1 };
    const id = citados[0];
    const pad = NOMES_PESSOAS.find((p) => p[0] === id)[1];
    // Só sai do título quando o nome é atribuição, não assunto ("perguntar ao Lucas sobre…" fica).
    const padroes = [
      `[,;—–-]\\s*(?:(?:quem\\s+)?(?:cuida|assume|faz|resolve)\\s*[:]?\\s*)?${pad}(?:\\s+(?:cuida|assume|faz|resolve)(?:\\s+(?:disso|dessa|desta|isso))?)?\\s*[.!]*\\s*$`,
      `\\b${pad}\\s+(?:cuida|assume|faz|resolve|s['’]en occupe|g[èe]re)(?:\\s+(?:disso|dessa|desta|isso))?\\b`,
      `\\b(?:para|pra|pro|pour)\\s+(?:o\\s+|a\\s+)?${pad}\\s*[.!]*\\s*$`,
      `^\\s*${pad}\\s*[:,—–-]\\s*`,
      `\\s+${pad}\\s*[.!]*\\s*$`,
    ];
    for (const p of padroes) {
      const m = new RegExp(p, 'i').exec(resto);
      if (m) { resto = resto.slice(0, m.index) + ' ' + resto.slice(m.index + m[0].length); break; }
    }
    return { dono: id, resto, ambiguo: false };
  }

  function acharPrioridade(texto) {
    let m = /(^|\s)(!alta|!high|!!+)(?=\s|$)/i.exec(texto);
    if (m) return { prioridade: 'alta', resto: texto.slice(0, m.index) + ' ' + texto.slice(m.index + m[0].length) };
    m = /(^|\s)(!baixa|!low)(?=\s|$)/i.exec(texto);
    if (m) return { prioridade: 'baixa', resto: texto.slice(0, m.index) + ' ' + texto.slice(m.index + m[0].length) };
    const low = texto.toLowerCase();
    if (/\b(?:n[ãa]o\s+(?:[ée]\s+)?(?:t[ãa]o\s+)?urgente|pas\s+urgent|sem\s+urg[êe]ncia)\b/.test(low)) return { prioridade: null, resto: texto };
    m = /[,;—–-]?\s*\b(?:urgente|urgent(?:e)?|prioridade alta|haute priorit[ée]|o quanto antes|le plus vite possible|au plus vite|asap)\b\s*[.!]*/i.exec(texto);
    if (m) return { prioridade: 'alta', resto: texto.slice(0, m.index) + ' ' + texto.slice(m.index + m[0].length) };
    m = /[,;—–-]?\s*\b(?:sem pressa|baixa prioridade|quando der|pas press[ée]|basse priorit[ée]|quand tu peux)\b\s*[.!]*/i.exec(texto);
    if (m) return { prioridade: 'baixa', resto: texto.slice(0, m.index) + ' ' + texto.slice(m.index + m[0].length) };
    return { prioridade: null, resto: texto };
  }

  function acharCanal(texto) {
    const low = texto.toLowerCase();
    if (/\bwhats(?:app)?\b|\bzap\b/.test(low)) return 'WhatsApp';
    if (/\be-?mail\b|\bcourriel\b|\bmail\b/.test(low)) return 'E-mail';
    if (/\bligar\b|\bligue\b|\btelefon|\bappeler\b|\brappeler\b|\bt[ée]l[ée]phon/.test(low)) return 'Telefone';
    if (/\bpresencial\b|\bvisitar\b|\bvisita\b|\ben personne\b|\bsur place\b/.test(low)) return 'Presencial';
    return '';
  }

  function acharCidade(texto) {
    const hash = /(^|\s)#([\p{L}][\p{L}-]{1,39})/u.exec(texto);
    if (hash) {
      const nome = hash[2].replace(/(^|-)(\p{L})/gu, (_, a, b) => a + b.toUpperCase());
      return { cidade: nome, resto: texto.slice(0, hash.index) + ' ' + texto.slice(hash.index + hash[0].length) };
    }
    for (const [nome, pad] of CIDADES) if (new RegExp(`(^|[^\\p{L}])(?:${pad})(?![\\p{L}])`, 'iu').test(texto)) return { cidade: nome, resto: texto };
    return { cidade: '', resto: texto };
  }

  function acharReferencia(texto) {
    let m = /\b(?:reserva|r[ée]servation|pedido|c[óo]digo|code|ref\.?)\s*[:#]?\s*([A-Z0-9][A-Z0-9-]{3,})\b/i.exec(texto);
    if (m && /\d/.test(m[1])) return m[1].toUpperCase();
    m = /\b([A-Z]{2,6}-?\d{2,}[A-Z0-9]*)\b/.exec(texto);
    return m ? m[1] : '';
  }

  function acharRepeticao(texto, dia) {
    const corta = (x) => texto.slice(0, x.index) + ' ' + texto.slice(x.index + x[0].length);
    const nomes = Object.keys(SEMANA).sort((a, b) => b.length - a.length).join('|');
    // "todo dia 5" é por mês, não por dia
    let m = /\b(?:tod[oa]\s+dia|chaque)\s+(\d{1,2})\b(?:\s+du mois)?/i.exec(texto);
    if (m && Number(m[1]) >= 1 && Number(m[1]) <= 31) {
      const dd = m[1].padStart(2, '0');
      let iso = `${dia.slice(0, 7)}-${dd}`;
      if (!dataValida(iso) || iso <= dia) iso = `${somarMeses(`${dia.slice(0, 7)}-01`, 1).slice(0, 7)}-${dd}`;
      return { repete: 'mensal', vence: dataValida(iso) ? iso : null, resto: corta(m) };
    }
    m = new RegExp(`\\b(?:tod[ao]s?\\s+(?:as?\\s+|os?\\s+)?|chaque\\s+|tous les\\s+)(${nomes})(?:-feiras?|s)?\\b`, 'i').exec(texto);
    if (m) {
      const n = SEMANA[m[1].toLowerCase()];
      let dif = (n - diaDaSemana(dia) + 7) % 7; if (dif === 0) dif = 7;
      return { repete: 'semanal', vence: somarDias(dia, dif), resto: corta(m) };
    }
    const tabela = [
      ['dias_uteis', /\b(?:todos os dias [úu]teis|todo dia [úu]til|de segunda a sexta|tous les jours ouvr[ée]s|chaque jour ouvr[ée])(?![\wà-ú])/i],
      ['diaria', /\b(?:todo dia|todos os dias|diariamente|chaque jour|tous les jours)\b/i],
      ['semanal', /\b(?:toda semana|todas as semanas|semanalmente|chaque semaine|toutes les semaines)\b/i],
      ['mensal', /\b(?:todo m[eê]s|todos os meses|mensalmente|chaque mois|tous les mois)(?![\wà-ú])/i],
    ];
    for (const [repete, re] of tabela) { const x = re.exec(texto); if (x) return { repete, vence: null, resto: corta(x) }; }
    return { repete: '', vence: null, resto: texto };
  }

  function acharArea(texto) {
    const low = texto.toLowerCase();
    if (/chauffeur|motorista|carro|hotel|hot[ée]is|h[ôo]tels?|villa|concierge|transfer/.test(low)) return 'Chauffeur';
    if (/\bsite\b|formul[áa]rio|formulaire|bot[ãa]o|bouton|n8n|\bbug\b|\blink\b|p[áa]gina|\bpage\b|deploy|workflow|c[óo]digo|script|painel|central/.test(low)) return 'Site';
    if (/cliente|\bclient\b|reserva|r[ée]servation|mesa|\btable\b|jantar|d[iî]ner|pedido|h[óo]spede|convidado/.test(low)) return 'Clientes';
    if (/\bcasa\b|\bcasas\b|maison|restaurante|restaurant|cat[áa]logo|catalogue|hor[áa]rio|telefone|e-?mail morto|publicad|ficha|fiche|cadastro/.test(low)) return 'Catálogo';
    return 'Operação';
  }

  function titularizar(texto) {
    let t = String(texto || '').trim().replace(/\s+/g, ' ');
    t = t.replace(/^(precisamos|preciso|precisa|temos que|tem que|vamos|por favor|pode|podemos|quero|queria|il faut|il faudrait|on doit|nous devons|merci de|pouvez-vous|peux-tu|je veux|je voudrais)\s+(de\s+|d['’])?/i, '');
    t = t.replace(/[\s,;:—–-]+$/g, '').replace(/[.!]+$/, '').replace(/\s+([,;:.!?])/g, '$1');
    t = t.replace(/\s+(?:e|et|até|ate|para|pra|em|no|na|avant|pour|le|la)$/i, '').replace(/[\s,;:—–-]+$/g, '');
    if (t.length > 140) t = t.slice(0, 137).replace(/\s+\S*$/, '') + '…';
    return t.charAt(0).toUpperCase() + t.slice(1);
  }

  /** Lê a frase inteira. `titulo` sai sem os trechos que viraram campo. */
  function analisar(texto, opts) {
    const dia = (opts && opts.hoje) || hoje(opts && opts.fuso);
    const original = String(texto || '');
    let resto = original;
    const rep = acharRepeticao(resto, dia); resto = rep.resto;
    const pri = acharPrioridade(resto); resto = pri.resto;
    const prazo = acharPrazo(resto, dia); if (prazo) resto = prazo.resto;
    const don = acharDono(resto); resto = don.resto;
    const cid = acharCidade(resto); resto = cid.resto;
    const titulo = titularizar(resto) || titularizar(original);
    const vence_em = (prazo && prazo.iso) || rep.vence || null;
    return { titulo, dono: don.dono, pessoa_citada: !!don.dono, dono_ambiguo: don.ambiguo, vence_em, prazo_citado: !!vence_em, prioridade: pri.prioridade || 'normal', prioridade_citada: !!pri.prioridade, cidade: cid.cidade, canal: acharCanal(original), referencia: acharReferencia(original), repete: rep.repete, area: acharArea(original) };
  }

  /** Quebra um pedido em vários quando ele vem em lista. Cabeçalho terminado em ":" vale para todos os itens. */
  function dividirPedido(texto) {
    const linhas = String(texto || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const marcador = /^(?:[-*•–—]|\d{1,2}[.)])\s+/;
    if (linhas.length >= 2) {
      const cabecalho = linhas[0].endsWith(':') ? linhas[0].slice(0, -1) : '';
      const itens = (cabecalho ? linhas.slice(1) : linhas).map((l) => l.replace(marcador, '').trim()).filter((l) => l.length >= 3);
      if (itens.length >= 2) return itens.slice(0, 12).map((i) => (cabecalho ? `${i} ${cabecalho}`.trim() : i));
    }
    const pontoEVirgula = String(texto || '').split(';').map((s) => s.trim()).filter((s) => s.split(/\s+/).length >= 3);
    if (pontoEVirgula.length >= 2) return pontoEVirgula.slice(0, 12);
    return [String(texto || '').trim()];
  }

  // ------------------------------------------------------------------ o foco do dia
  const aberta = (t) => t.estado !== 'done' && !t.arquivada_em;
  const ordenar = (a, b) => (a.prioridade === 'alta' ? 0 : 1) - (b.prioridade === 'alta' ? 0 : 1) || String(a.vence_em || '9999').localeCompare(String(b.vence_em || '9999')) || String(a.id).localeCompare(String(b.id));

  /** O que fazer agora: atrasadas e urgentes, depois cobranças, depois o dia, depois o que já está na mão. Cada card aparece uma vez só. */
  function foco(tarefas, pessoa, dia) {
    const lista = tarefas.filter(aberta).filter((t) => !pessoa || pessoa === 'all' || t.dono === pessoa);
    const vistos = new Set();
    const pega = (filtro) => { const r = lista.filter((t) => !vistos.has(t.id) && filtro(t)).sort(ordenar); r.forEach((t) => vistos.add(t.id)); return r; };
    const agora = pega((t) => (t.vence_em && t.vence_em < dia) || (t.prioridade === 'alta' && (!t.vence_em || t.vence_em <= dia) && t.estado !== 'wait'));
    const cobrar = pega((t) => t.estado === 'wait' && (!t.cobrar_em || t.cobrar_em <= dia));
    const paraHoje = pega((t) => t.vence_em === dia && !(t.estado === 'wait' && t.cobrar_em && t.cobrar_em > dia));
    const andamento = pega((t) => t.estado === 'doing');
    const limite = somarDias(dia, 3);
    const aSeguir = pega((t) => t.estado !== 'wait' && t.vence_em && t.vence_em <= limite).slice(0, 8);
    const esperando = lista.filter((t) => t.estado === 'wait' && !vistos.has(t.id)).sort(ordenar);
    return { agora, cobrar, hoje: paraHoje, andamento, aSeguir, esperando, total: lista.length };
  }

  /** Perguntas que o livro responde sem modelo e sem custo: "o que está atrasado?", "o que o Julien tem hoje?". */
  function responder(texto, tarefas, dia) {
    const low = String(texto || '').toLowerCase().trim();
    const pergunta = /\?\s*$/.test(low) || /^(?:o que|oque|quais?|quem|quantas?|quantos?|como est[áa]|mostra|mostre|lista|listar|qu['’]est-ce|quoi|quelles?|quels?|qui|combien|montre|liste)\b/.test(low);
    if (!pergunta) return null;
    const vivas = tarefas.filter(aberta);
    let dono = null;
    for (const [id, pad] of NOMES_PESSOAS) if (new RegExp(`(^|[^\\wà-ú])${pad}(?![\\wà-ú])`).test(low)) dono = id;
    let lista = dono ? vivas.filter((t) => t.dono === dono) : vivas;
    const filtros = [];
    if (/atrasad|vencid|en retard/.test(low)) { lista = lista.filter((t) => t.vence_em && t.vence_em < dia); filtros.push('atrasadas'); }
    if (/\bhoje\b|aujourd['’]hui/.test(low)) { lista = lista.filter((t) => t.vence_em === dia); filtros.push('hoje'); }
    if (/amanh[ãa]|\bdemain\b/.test(low)) { lista = lista.filter((t) => t.vence_em === somarDias(dia, 1)); filtros.push('amanhã'); }
    if (/\bsemana\b|\bsemaine\b/.test(low)) { lista = lista.filter((t) => t.vence_em && t.vence_em >= dia && t.vence_em <= somarDias(dia, 7)); filtros.push('semana'); }
    if (/aguardando|esperando|\bcobrar\b|en attente|relancer/.test(low)) { lista = lista.filter((t) => t.estado === 'wait'); filtros.push('aguardando'); }
    if (/\bandamento\b|fazendo|en cours/.test(low)) { lista = lista.filter((t) => t.estado === 'doing'); filtros.push('andamento'); }
    if (/urgente|prioridade|prioritaire|urgent/.test(low)) { lista = lista.filter((t) => t.prioridade === 'alta'); filtros.push('prioridade'); }
    if (/sem data|sem prazo|sans date/.test(low)) { lista = lista.filter((t) => !t.vence_em); filtros.push('sem_data'); }
    for (const [nome, pad] of CIDADES) if (new RegExp(`(^|[^\\p{L}])(?:${pad})(?![\\p{L}])`, 'iu').test(low)) { lista = lista.filter((t) => t.cidade === nome || new RegExp(pad, 'iu').test(t.titulo)); filtros.push(nome); break; }
    if (/carga|sobrecarreg|quem (?:tem|est[áa]) mais|charge|surcharg/.test(low)) {
      const porPessoa = NOMES_PESSOAS.map(([id]) => ({ id, abertas: vivas.filter((t) => t.dono === id).length, atrasadas: vivas.filter((t) => t.dono === id && t.vence_em && t.vence_em < dia).length })).sort((a, b) => b.abertas - a.abertas);
      return { tipo: 'carga', por_pessoa: porPessoa, ids: [] };
    }
    if (!filtros.length && !dono) return null;
    return { tipo: 'lista', dono, filtros, ids: lista.sort(ordenar).slice(0, 20).map((t) => t.id), total: lista.length };
  }

  return { FUSO_PADRAO, hoje, dataValida, somarDias, somarMeses, somarDiasUteis, diaDaSemana, diasEntre, proximaData, analisar, acharPrazo, acharDono, acharArea, acharPrioridade, acharCanal, acharCidade, acharReferencia, acharRepeticao, titularizar, dividirPedido, foco, responder, aberta };
}));
