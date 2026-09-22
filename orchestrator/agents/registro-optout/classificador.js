'use strict';
/**
 * Classificador determinístico de mensagens de estabelecimentos.
 * Zero LLM. Rede de segurança do FLUXO 7 da Aria (que classifica com modelo).
 *
 * Entrada: { subject, text, from } (texto já em UTF-8; PII pode existir no texto —
 * este módulo NUNCA grava nada, só devolve rótulos e sinais).
 * Saída:  { categoria, sinais[], injecao, idioma, confianca }
 *
 * Categorias (prioridade decrescente — a primeira que casar vence):
 *   remocao     — pede para sair da plataforma / não consentiu / GDPR
 *   correcao    — pede correção de dados (horário, telefone, endereço, fotos)
 *   reclamacao  — reclama de reserva impossível de honrar sem pedir remoção
 *   prospect    — quer aderir / conta / parceria
 *   spam        — newsletter, marketing, automático
 *   outro
 * Regra: qualquer sinal de remoção prevalece sobre qualquer outra categoria
 * (pedido de remoção tem prioridade sobre meta comercial).
 */

const norm = (s) => String(s || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase();

// Dicionários por categoria. Regex sobre texto normalizado (sem acentos, minúsculas).
const REMOCAO = [
  // EN
  /\b(remove|removal|delete|take (us|it|our (page|listing|profile)) down|unlist|delist|withdraw)\b.{0,80}\b(page|listing|profile|platform|website|site|restaurant|us)\b/,
  /\b(not|never|no)\s+(given|give|gave)\s+(our\s+)?consent\b/, /\bwithout (our|any) (consent|permission|authorization)\b/,
  /\bdo not (want|wish) to (be|appear|be listed)\b/, /\bcease and desist\b/,
  /\btake (us|it|our (page|listing|profile|restaurant)) (down|off)\b/, /\b(unlist|delist)\b/, /\bnever (asked|requested) (for|to be)\b/,
  // PT
  /\b(remov|retir|exclu|apag|elimin|tir)\w*\b.{0,80}\b(pagina|perfil|listagem|anuncio|plataforma|site|restaurante|nos)\b/,
  /\bnao\s+(autoriz|consent|permit)\w*/, /\bsem (a )?(nossa )?(autorizacao|consentimento|permissao)\b/,
  /\bnao (queremos|desejamos|quero) (estar|constar|aparecer|figurar)\b/,
  // FR
  /\b(supprim|retir|enlev|effac|desinscri|desactiv)\w*\b.{0,80}\b(page|fiche|profil|annonce|plateforme|site|restaurant|nous)\b/,
  /\bsans (notre )?(consentement|autorisation|accord)\b/, /\bne (souhaitons|voulons) (pas|plus) (figurer|apparaitre|etre)\b/,
  // ES
  /\b(elimin|retir|borr|quit|dar de baja|baja)\w*\b.{0,80}\b(pagina|perfil|ficha|anuncio|plataforma|sitio|web|restaurante|nos)\b/,
  /\bsin (nuestro )?(consentimiento|autorizacion|permiso)\b/, /\bno (queremos|deseamos) (estar|aparecer|figurar)\b/,
  // IT
  /\b(rimuov|cancell|elimin|togli)\w*\b.{0,80}\b(pagina|profilo|scheda|annuncio|piattaforma|sito|ristorante|noi)\b/,
  /\bsenza (il nostro )?(consenso|autorizzazione|permesso)\b/, /\bnon (vogliamo|desideriamo) (essere|apparire|comparire)\b/,
  // Regulatório (qualquer idioma)
  /\b(gdpr|rgpd|lopd|aepd|cnil|dpo|data protection|protecao de dados|protection des donnees|proteccion de datos|protezione dei dati)\b/,
];

const CORRECAO = [
  /\b(wrong|incorrect|outdated|update|correct|fix|change)\b.{0,60}\b(hours|opening|phone|number|address|photo|picture|menu|price|information|details|name)\b/,
  /\b(horario|telefone|endereco|morada|foto|cardapio|preco|informacao|dados|nome)\w*\b.{0,60}\b(errad|incorret|desatualizad|corrig|atualiz|alter|mud)\w*/,
  /\b(corrig|atualiz|alter|mud)\w*\b.{0,60}\b(horario|telefone|endereco|morada|foto|cardapio|preco|informacao|dados|nome)\b/,
  /\b(horaires?|telephone|numero|adresse|photo|carte|prix|informations?|coordonnees)\b.{0,60}\b(faux|erron|incorrect|obsolet|corrig|modifi|mettre a jour|chang)\w*/,
  /\b(corrig|modifi|chang|mettre a jour)\w*\b.{0,60}\b(horaires?|telephone|adresse|photo|carte|prix|informations?)\b/,
  /\b(horario|telefono|direccion|foto|carta|precio|informacion|datos)\b.{0,60}\b(incorrect|erron|equivocad|desactualizad|corrig|actualiz|cambi)\w*/,
  /\b(orari|telefono|indirizzo|foto|menu|prezz|informazioni|dati)\w*\b.{0,60}\b(sbagliat|errat|non aggiornat|corregg|aggiorn|cambi)\w*/,
];

const RECLAMACAO = [
  /\b(cannot|can't|could not|unable to|impossible to) (honou?r|accommodate|accept|fulfil)\b/, /\b(no|not) (availability|available|table)\b.{0,40}\b(booking|reservation|request)\b/,
  /\b(customer|client|guest)s? (arrived|showed up|came)\b.{0,60}\b(no|without) (reservation|table|booking)\b/,
  /\bnao (conseguimos|podemos|temos como) (honrar|atender|aceitar|receber)\b/, /\b(cliente|hospede)s? (apareceu|chegou|veio)\w*\b.{0,60}\bsem (mesa|reserva)\b/,
  /\b(impossible|ne pouvons pas) (d'honorer|honorer|d'accepter|accepter)\b/, /\b(client|clients)\b.{0,60}\bsans (table|reservation)\b/,
  /\bno podemos (atender|aceptar|cumplir)\b/, /\bnon possiamo (accettare|onorare|garantire)\b/,
  /\b(reservations?|reservas?|reservations|prenotazion\w*)\b.{0,60}\b(confus|confusion|confusao|confusione|problem|problema)\b/,
];

const PROSPECT = [
  /\b(claim|activate|access|dashboard|admin|account|code|otp|partner(ship)?|join|sign ?up|register|founder)\b/,
  /\b(conta|ativar|acesso|painel|codigo|parceria|cadastr|registr|fundador|assumir)\w*/,
  /\b(compte|activer|acces|tableau de bord|code|partenariat|inscri|fondateur)\w*/,
  /\b(cuenta|activar|acceso|panel|codigo|asociaci|registr|fundador)\w*/,
  /\b(account|attivar|accesso|pannello|codice|partnership|registr|fondator)\w*/,
];

const SPAM = [
  /\b(unsubscribe|newsletter|promotion|promo|discount|webinar|seo services|guest post|backlink|invoice attached|crypto)\b/,
  /\b(auto-?reply|automatic reply|out of office|resposta automatica|reponse automatique|risposta automatica|respuesta automatica|fuera de la oficina|absence du bureau)\b/,
];

// Instrução embutida = tentativa de injeção. Nunca vira ação; vira anomalia.
const INJECAO = [
  /\b(ignore|disregard|forget) (all |your |the |previous |prior )*(instructions|rules|prompt)\b/,
  /\b(ignor|esquec|desconsider)\w* (todas |as |suas |instrucoes|regras)+/, /\b(ignore|oublie) (toutes |les |tes |vos )*(instructions|regles)\b/,
  /\bsystem prompt\b/, /\[\s*(sistema|system)\s*:/, /\b(publish|publique|publiez|publica|pubblica)\b.{0,40}\b(now|agora|maintenant|ahora|adesso)\b/,
  /\bas (an? )?(admin|administrator|developer|anthropic)\b/, /\bmodo (teste|desenvolvedor)\b/, /\bsend (this|the) (list|data|emails?) to\b/,
];

const IDIOMA = [
  ['pt', /\b(nao|voces|obrigad\w|por favor|reserva|restaurante|pagina|somos|estamos|gostariamos|nossa|nosso)\b/g],
  ['fr', /\b(nous|vous|bonjour|merci|notre|votre|restaurant|reservation|page|sommes|souhaitons|pas)\b/g],
  ['es', /\b(nosotros|ustedes|hola|gracias|nuestro|nuestra|restaurante|reserva|pagina|somos|estamos|queremos|por favor)\b/g],
  ['it', /\b(noi|voi|buongiorno|grazie|nostro|nostra|ristorante|prenotazione|pagina|siamo|vorremmo|non)\b/g],
  ['en', /\b(we|you|hello|hi|thanks|thank you|our|your|restaurant|reservation|page|are|would|please|not)\b/g],
];

function detectarIdioma(t) {
  let best = 'en', bestN = 0;
  for (const [lang, re] of IDIOMA) {
    const n = (t.match(re) || []).length;
    if (n > bestN) { best = lang; bestN = n; }
  }
  return best;
}

function sinais(lista, t) {
  const out = [];
  lista.forEach((re, i) => { const m = t.match(re); if (m) out.push({ i, trecho: String(m[0]).slice(0, 60) }); });
  return out;
}

/**
 * @param {{subject?:string,text?:string,from?:string}} msg
 * @returns {{categoria:string,sinais:object,injecao:boolean,idioma:string,confianca:number}}
 */
function classificar(msg) {
  const subject = norm(msg.subject);
  const text = norm(msg.text);
  const t = `${subject}\n${text}`;
  const inj = sinais(INJECAO, t);
  const rem = sinais(REMOCAO, t);
  const cor = sinais(CORRECAO, t);
  const rec = sinais(RECLAMACAO, t);
  const pro = sinais(PROSPECT, t);
  const spa = sinais(SPAM, t);
  const idioma = detectarIdioma(t);
  const detalhe = { remocao: rem, correcao: cor, reclamacao: rec, prospect: pro, spam: spa, injecao: inj };

  let categoria = 'outro', confianca = 0.3;
  if (rem.length) { categoria = 'remocao'; confianca = Math.min(1, 0.6 + 0.2 * rem.length); }
  else if (spa.length && !cor.length && !rec.length && !pro.length) { categoria = 'spam'; confianca = 0.7; }
  else if (cor.length) { categoria = 'correcao'; confianca = Math.min(1, 0.6 + 0.15 * cor.length); }
  else if (rec.length) { categoria = 'reclamacao'; confianca = Math.min(1, 0.55 + 0.15 * rec.length); }
  else {
    // prospect: ≥2 palavras-chave de conta/ativação/parceria (em qualquer idioma) ou 1 forte
    const kw = (t.match(/\b(claim|activate|access|dashboard|admin|account|code|otp|partner(ship)?|join|sign ?up|register|founder|conta|ativar|acesso|painel|codigo|parceria|cadastr|registr|fundador|assumir|compte|activer|acces|tableau de bord|partenariat|inscri|fondateur|cuenta|activar|panel|asociaci|attivar|accesso|pannello|codice|fondator)\w*/g) || []).length;
    if (kw >= 2 || (pro.length >= 1 && /\b(dashboard|otp|codigo|code|founder|fundador|partenariat|parceria|partnership)\b/.test(t))) { categoria = 'prospect'; confianca = Math.min(0.9, 0.5 + 0.1 * kw); }
  }
  // Reclamação que menciona clientes sem mesa + ausência de consentimento é remoção — já coberto por REMOCAO.
  return { categoria, sinais: detalhe, injecao: inj.length > 0, idioma, confianca };
}

/** Regra de ação por categoria — o que o intake deve fazer (documentada na spec §5). */
function acaoPara(cls) {
  if (cls.injecao) return { acao: 'registrar_injecao_e_escalar', autonomia: 'requer_aprovacao_humana' };
  switch (cls.categoria) {
    case 'remocao': return { acao: 'registrar_opted_out_pendente + escalar REMOCAO_LISTAGEM + silenciar_aria', autonomia: 'requer_aprovacao_humana', sla_horas: 24 };
    case 'correcao': return { acao: 'registrar_correction_requested + handoff dba', autonomia: 'autonomo_com_log', sla_horas: 48 };
    case 'reclamacao': return { acao: 'registrar_correction_requested + escalar', autonomia: 'requer_aprovacao_humana', sla_horas: 24 };
    case 'prospect': return { acao: 'aria FLUXO 6', autonomia: 'autonomo_com_log' };
    case 'spam': return { acao: 'ignorar', autonomia: 'autonomo' };
    default: return { acao: 'revisao_humana', autonomia: 'requer_aprovacao_orquestrador' };
  }
}

module.exports = { classificar, acaoPara, norm, detectarIdioma };
