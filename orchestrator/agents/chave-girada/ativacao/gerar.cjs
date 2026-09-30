#!/usr/bin/env node
/**
 * Ativação cirúrgica de contas — gera, por casa, a ficha e as mensagens prontas (NÃO envia).
 *
 *   node orchestrator/agents/chave-girada/ativacao/gerar.cjs            # top 40 por pedidos em 90 dias
 *   node orchestrator/agents/chave-girada/ativacao/gerar.cjs --n 60
 *
 * Saída em orchestrator/state/ativacao/ (fora do git — contém telefone/e-mail das casas):
 *   fichas/<slug>.md       ficha + mensagens no idioma da casa (WhatsApp, telefone, e-mail curto)
 *   manifesto.csv          slug · cidade · segmento · canal · idioma · números · próximo passo
 *   resumo.md              contagem por segmento e canal
 *
 * Segmentos (por ordem de prioridade):
 *   V  verificou o código e parou (listing_claim_challenges.verified_at) — a mais quente de todas
 *   C  já tem login de CLIENTE com o e-mail da listagem — quis entrar e caiu na porta errada
 *   A  responde pedidos (≥3 respostas e ≥1 aceite) — precisa de motivo, não de convencimento
 *   B  silenciosa com demanda (≥10 pedidos/90d, ≤2 respostas) — precisa de prova e de alguém do outro lado
 *   D  e-mail do catálogo morto (bounce registrado) — nem o pedido chega; primeiro corrigir o contato
 *
 * Leitura com twk_ro. Números sempre da própria casa. Nenhum texto promete prazo, selo ou benefício que não exista.
 */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const RAIZ = path.resolve(__dirname, '..', '..', '..', '..');
const args = process.argv.slice(2);
const N = args.includes('--n') ? Number(args[args.indexOf('--n') + 1]) : 40;
const OUT = path.join(RAIZ, 'orchestrator', 'state', 'ativacao');
const LINK = 'https://manager.theworldkeys.com/register';

function envDe(rel) {
  const p = path.join(RAIZ, rel);
  return Object.fromEntries(fs.readFileSync(p, 'utf8').split(/[\r\n]+/).filter((l) => l && !l.startsWith('#')).map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]; }));
}
const IDIOMA_PAIS = { PT: 'pt', BR: 'pt', AO: 'pt', FR: 'fr', BE: 'fr', MA: 'fr', TN: 'fr', MC: 'fr', CH: 'fr', IT: 'it', ES: 'es', AR: 'es', CO: 'es', MX: 'es', CL: 'es', DE: 'de', AT: 'de' };
const PAIS_NOME = { Portugal: 'PT', Brazil: 'BR', France: 'FR', Belgium: 'BE', Morocco: 'MA', Tunisia: 'TN', Monaco: 'MC', Italy: 'IT', Spain: 'ES', Argentina: 'AR', Colombia: 'CO', Mexico: 'MX', Chile: 'CL', Germany: 'DE', Austria: 'AT' };

// ─── Textos (por segmento × idioma). {casa} {p90} {aceitos} {sem} {pend} {link} ───────────────
const T = {
  pt: {
    wa_V: 'Olá, falo da The World Keys. Vocês pediram o código para assumir a página do {casa} e o código foi confirmado — mas a conta não chegou a ser criada, e a falha foi nossa. Está corrigido. Este é o link para terminar em um minuto: {link}. Se preferir, respondo qualquer dúvida por aqui.',
    wa_C: 'Olá, falo da The World Keys. Vocês já se registraram no nosso site com o e-mail do {casa}, mas o acesso ficou como conta de cliente — erro nosso. O acesso profissional do {casa} está pronto; este é o link para definir a senha: {link}. A partir daí, cada pedido de mesa chega no painel e no WhatsApp.',
    wa_A: 'Olá, falo da The World Keys. O {casa} respondeu aos nossos pedidos de mesa {aceitos} vezes nos últimos 90 dias — poucas casas fazem isso. Por isso estamos a dar prioridade a vocês: os clientes de casas que não respondem passam a ser encaminhados para quem responde. Para receber os pedidos direto no painel e no WhatsApp: {link}. Um minuto.',
    wa_B: 'Olá, falo da The World Keys. Nos últimos 90 dias, {p90} clientes pediram mesa no {casa} pelo nosso site; {sem} ficaram sem resposta{pend}. Não é cobrança: é aviso de que a procura existe e está a ser desperdiçada. Com a conta, o pedido chega no WhatsApp e aceita-se com um toque: {link}. Se preferirem que os pedidos parem, digam-me.',
    tel_A: 'Boa tarde, é do {casa}? Falo da The World Keys, a plataforma de reservas. Vocês responderam {aceitos} vezes aos nossos clientes nos últimos três meses — são das poucas casas que fazem isso, e queremos dar-vos prioridade. Posso enviar por WhatsApp o link da conta? Leva um minuto e os pedidos passam a chegar no telemóvel.',
    tel_B: 'Boa tarde, é do {casa}? Falo da The World Keys. Nos últimos três meses {p90} clientes pediram mesa no {casa} pelo nosso site e a maioria ficou sem resposta. Quero perceber para onde devem chegar os pedidos: qual é o melhor WhatsApp para os receber? Com a conta, aceita-se com um toque.',
  },
  en: {
    wa_V: 'Hello, this is The World Keys. You requested the code to claim the {casa} page and confirmed it — but the account was never created, and that was our fault. It is fixed. Here is the link to finish in one minute: {link}. Happy to answer anything here.',
    wa_C: 'Hello, this is The World Keys. You registered on our site with the {casa} email, but the access was created as a guest account — our mistake. The professional access for {casa} is ready; here is the link to set your password: {link}. From then on, every table request reaches your dashboard and WhatsApp.',
    wa_A: 'Hello, this is The World Keys. {casa} answered our table requests {aceitos} times in the last 90 days — few houses do. So we are giving you priority: guests from houses that do not answer are now redirected to those who do. To receive requests directly in your dashboard and on WhatsApp: {link}. One minute.',
    wa_B: 'Hello, this is The World Keys. In the last 90 days, {p90} guests requested a table at {casa} through our site; {sem} received no answer{pend}. This is not a complaint: it is notice that the demand exists and is being lost. With the account, requests arrive on WhatsApp and are accepted with one tap: {link}. If you would rather the requests stop, tell me.',
    tel_A: 'Good afternoon, is this {casa}? I am calling from The World Keys, the reservations platform. You answered our guests {aceitos} times in the last three months — one of the few houses that do — and we want to give you priority. May I send the account link by WhatsApp? It takes a minute and requests then reach your phone.',
    tel_B: 'Good afternoon, is this {casa}? I am calling from The World Keys. In the last three months {p90} guests requested a table at {casa} through our site and most got no answer. I want to understand where requests should reach you: which WhatsApp is best? With the account, you accept with one tap.',
  },
  fr: {
    wa_V: 'Bonjour, ici The World Keys. Vous avez demandé le code pour reprendre la page de {casa} et l’avez confirmé — mais le compte n’a jamais été créé, et c’était notre erreur. C’est corrigé. Voici le lien pour terminer en une minute : {link}. Je réponds à toute question ici.',
    wa_C: 'Bonjour, ici The World Keys. Vous vous êtes inscrit sur notre site avec l’e-mail de {casa}, mais l’accès a été créé comme compte client — notre erreur. L’accès professionnel de {casa} est prêt ; voici le lien pour définir votre mot de passe : {link}. Ensuite, chaque demande de table arrive sur votre tableau de bord et sur WhatsApp.',
    wa_A: 'Bonjour, ici The World Keys. {casa} a répondu à nos demandes de table {aceitos} fois ces 90 derniers jours — peu de maisons le font. Nous vous donnons donc la priorité : les clients des maisons qui ne répondent pas sont désormais redirigés vers celles qui répondent. Pour recevoir les demandes directement sur votre tableau de bord et WhatsApp : {link}. Une minute.',
    wa_B: 'Bonjour, ici The World Keys. Ces 90 derniers jours, {p90} clients ont demandé une table chez {casa} via notre site ; {sem} sont restés sans réponse{pend}. Ce n’est pas un reproche : c’est pour vous dire que la demande existe et se perd. Avec le compte, la demande arrive sur WhatsApp et s’accepte d’un geste : {link}. Si vous préférez que les demandes s’arrêtent, dites-le-moi.',
    tel_A: 'Bonjour, je suis bien chez {casa} ? J’appelle de The World Keys, la plateforme de réservation. Vous avez répondu {aceitos} fois à nos clients ces trois derniers mois — l’une des rares maisons à le faire — et nous voulons vous donner la priorité. Puis-je vous envoyer le lien du compte par WhatsApp ? Une minute, et les demandes arrivent sur votre téléphone.',
    tel_B: 'Bonjour, je suis bien chez {casa} ? J’appelle de The World Keys. Ces trois derniers mois, {p90} clients ont demandé une table chez {casa} via notre site et la plupart sont restés sans réponse. Je veux comprendre où les demandes doivent arriver : quel WhatsApp est le bon ? Avec le compte, on accepte d’un geste.',
  },
  it: {
    wa_V: 'Buongiorno, sono The World Keys. Avete richiesto il codice per gestire la pagina di {casa} e l’avete confermato — ma l’account non è mai stato creato, ed è stato un nostro errore. È risolto. Ecco il link per finire in un minuto: {link}. Rispondo a qualsiasi domanda qui.',
    wa_C: 'Buongiorno, sono The World Keys. Vi siete registrati sul nostro sito con l’e-mail di {casa}, ma l’accesso è stato creato come account cliente — errore nostro. L’accesso professionale di {casa} è pronto; ecco il link per impostare la password: {link}. Da lì, ogni richiesta di tavolo arriva nel pannello e su WhatsApp.',
    wa_A: 'Buongiorno, sono The World Keys. {casa} ha risposto alle nostre richieste di tavolo {aceitos} volte negli ultimi 90 giorni — poche case lo fanno. Per questo vi diamo la priorità: i clienti delle case che non rispondono vengono ora indirizzati a chi risponde. Per ricevere le richieste direttamente nel pannello e su WhatsApp: {link}. Un minuto.',
    wa_B: 'Buongiorno, sono The World Keys. Negli ultimi 90 giorni {p90} clienti hanno chiesto un tavolo da {casa} tramite il nostro sito; {sem} sono rimasti senza risposta{pend}. Non è un rimprovero: è per dirvi che la domanda c’è e si sta perdendo. Con l’account la richiesta arriva su WhatsApp e si accetta con un tocco: {link}. Se preferite che le richieste si fermino, ditemelo.',
    tel_A: 'Buongiorno, parlo con {casa}? Chiamo da The World Keys, la piattaforma di prenotazioni. Avete risposto {aceitos} volte ai nostri clienti negli ultimi tre mesi — una delle poche case a farlo — e vogliamo darvi la priorità. Posso inviarvi il link dell’account su WhatsApp? Un minuto, e le richieste arrivano sul telefono.',
    tel_B: 'Buongiorno, parlo con {casa}? Chiamo da The World Keys. Negli ultimi tre mesi {p90} clienti hanno chiesto un tavolo da {casa} tramite il nostro sito e la maggior parte non ha avuto risposta. Vorrei capire dove devono arrivare le richieste: qual è il WhatsApp giusto? Con l’account si accetta con un tocco.',
  },
  es: {
    wa_V: 'Hola, soy de The World Keys. Pidieron el código para gestionar la página de {casa} y lo confirmaron, pero la cuenta nunca se creó, y fue error nuestro. Ya está corregido. Este es el enlace para terminar en un minuto: {link}. Respondo cualquier duda por aquí.',
    wa_C: 'Hola, soy de The World Keys. Se registraron en nuestra web con el correo de {casa}, pero el acceso quedó como cuenta de cliente: error nuestro. El acceso profesional de {casa} está listo; este es el enlace para definir la contraseña: {link}. Desde ahí, cada solicitud de mesa llega al panel y a WhatsApp.',
    wa_A: 'Hola, soy de The World Keys. {casa} respondió a nuestras solicitudes de mesa {aceitos} veces en los últimos 90 días; pocas casas lo hacen. Por eso les damos prioridad: los clientes de casas que no responden pasan a ser dirigidos a quienes sí responden. Para recibir las solicitudes en el panel y en WhatsApp: {link}. Un minuto.',
    wa_B: 'Hola, soy de The World Keys. En los últimos 90 días, {p90} clientes pidieron mesa en {casa} por nuestra web; {sem} quedaron sin respuesta{pend}. No es un reproche: es aviso de que la demanda existe y se está perdiendo. Con la cuenta, la solicitud llega a WhatsApp y se acepta con un toque: {link}. Si prefieren que las solicitudes paren, díganmelo.',
    tel_A: 'Buenas tardes, ¿hablo con {casa}? Llamo de The World Keys, la plataforma de reservas. Respondieron {aceitos} veces a nuestros clientes en los últimos tres meses, una de las pocas casas que lo hace, y queremos darles prioridad. ¿Puedo enviarles el enlace de la cuenta por WhatsApp? Un minuto, y las solicitudes llegan al teléfono.',
    tel_B: 'Buenas tardes, ¿hablo con {casa}? Llamo de The World Keys. En los últimos tres meses {p90} clientes pidieron mesa en {casa} por nuestra web y la mayoría quedó sin respuesta. Quiero entender adónde deben llegar las solicitudes: ¿cuál es el mejor WhatsApp? Con la cuenta se acepta con un toque.',
  },
  de: {
    wa_V: 'Guten Tag, hier ist The World Keys. Sie haben den Code angefordert, um die Seite von {casa} zu übernehmen, und ihn bestätigt — aber das Konto wurde nie angelegt, und das war unser Fehler. Es ist behoben. Hier ist der Link, um es in einer Minute abzuschließen: {link}. Fragen beantworte ich gern hier.',
    wa_C: 'Guten Tag, hier ist The World Keys. Sie haben sich auf unserer Seite mit der E-Mail von {casa} registriert, aber der Zugang wurde als Gästekonto angelegt — unser Fehler. Der professionelle Zugang für {casa} ist bereit; hier ist der Link zum Festlegen des Passworts: {link}. Danach erreicht Sie jede Tischanfrage im Dashboard und per WhatsApp.',
    wa_A: 'Guten Tag, hier ist The World Keys. {casa} hat unsere Tischanfragen in den letzten 90 Tagen {aceitos} Mal beantwortet — nur wenige Häuser tun das. Deshalb geben wir Ihnen Vorrang: Gäste von Häusern, die nicht antworten, werden jetzt an die weitergeleitet, die antworten. Um Anfragen direkt im Dashboard und per WhatsApp zu erhalten: {link}. Eine Minute.',
    wa_B: 'Guten Tag, hier ist The World Keys. In den letzten 90 Tagen haben {p90} Gäste über unsere Seite einen Tisch bei {casa} angefragt; {sem} blieben ohne Antwort{pend}. Kein Vorwurf: nur der Hinweis, dass die Nachfrage da ist und verloren geht. Mit dem Konto kommt die Anfrage per WhatsApp und wird mit einem Tipp angenommen: {link}. Wenn die Anfragen aufhören sollen, sagen Sie es mir.',
    tel_A: 'Guten Tag, spreche ich mit {casa}? Ich rufe von The World Keys an, der Reservierungsplattform. Sie haben unseren Gästen in den letzten drei Monaten {aceitos} Mal geantwortet — eines der wenigen Häuser — und wir möchten Ihnen Vorrang geben. Darf ich Ihnen den Konto-Link per WhatsApp schicken? Eine Minute, und die Anfragen kommen aufs Telefon.',
    tel_B: 'Guten Tag, spreche ich mit {casa}? Ich rufe von The World Keys an. In den letzten drei Monaten haben {p90} Gäste über unsere Seite einen Tisch bei {casa} angefragt, und die meisten blieben ohne Antwort. Ich möchte verstehen, wohin die Anfragen kommen sollen: welches WhatsApp ist das richtige? Mit dem Konto nimmt man mit einem Tipp an.',
  },
};

function preencher(txt, v) {
  return txt.replace(/\{(\w+)\}/g, (_, k) => String(v[k] ?? ''));
}

(async () => {
  const { Client } = require(path.join(RAIZ, 'Agente de Suporte e Concierge', 'node_modules', 'pg'));
  const c = new Client({ connectionString: envDe('Agente Gerenciador do Banco de Dados/twk-db-agent/.env.readonly.local').DATABASE_URL_RO, ssl: { rejectUnauthorized: false } });
  await c.connect();
  const ro = await c.query('show default_transaction_read_only');
  if (String(ro.rows[0].default_transaction_read_only) !== 'on') throw new Error('sessão não é read-only — abortado');

  const { rows } = await c.query(`
    WITH base AS (
      SELECT r.restaurant_id, r.slug, r.name, r.city, r.country, r.telephone_of_the_establishment AS tel, r.email_for_reservations AS email, r.partner,
        count(*) FILTER (WHERE v.created_date >= now() - interval '90 days')::int AS p90,
        count(*) FILTER (WHERE v.created_date >= now() - interval '30 days')::int AS p30,
        count(*) FILTER (WHERE v.created_date >= now() - interval '90 days' AND lower(btrim(v.booking_status))='accept')::int AS aceitos90,
        count(*) FILTER (WHERE v.created_date >= now() - interval '90 days' AND lower(btrim(v.booking_status))='pending')::int AS sem90,
        count(*) FILTER (WHERE lower(btrim(v.booking_status)) IN ('accept','decline'))::int AS respondeu_total,
        count(*) FILTER (WHERE lower(btrim(v.booking_status))='accept')::int AS aceitos_total,
        count(*) FILTER (WHERE v.expired_at IS NULL AND lower(btrim(v.booking_status)) IN ('pending','in treatment') AND v.booking_date >= current_date)::int AS pendentes_vivos,
        min(v.booking_date) FILTER (WHERE v.expired_at IS NULL AND lower(btrim(v.booking_status)) IN ('pending','in treatment') AND v.booking_date >= current_date)::date AS proximo_pendente
      FROM db_restaurants r JOIN reservations v ON v.restaurant_id = r.restaurant_id
      WHERE r.published GROUP BY 1,2,3,4,5,6,7,8)
    SELECT b.*,
      (SELECT count(*)::int FROM listing_claim_challenges l WHERE l.restaurant_id = b.restaurant_id AND l.verified_at IS NOT NULL) AS codigos_verificados,
      (SELECT max(l.created_at)::date FROM listing_claim_challenges l WHERE l.restaurant_id = b.restaurant_id) AS ultimo_codigo,
      EXISTS (SELECT 1 FROM nextauth."User" u WHERE b.email IS NOT NULL AND lower(u.email) = lower(b.email)) AS login_de_cliente,
      (SELECT count(*)::int FROM restaurant_users ru WHERE ru.restaurant_id = b.restaurant_id) AS vinculos
    FROM base b ORDER BY b.p90 DESC LIMIT $1`, [N]);
  await c.end();

  // telefone: móvel ou não (mesma régua da Aria)
  let avaliarTelefone = null;
  try { ({ avaliarTelefone } = require(path.join(RAIZ, 'Agente de Suporte e Concierge', 'dist', 'phoneQuality.js'))); } catch { /* sem dist: canal = telefone */ }
  const bounces = new Set();
  try {
    const csv = fs.readFileSync(path.join(RAIZ, 'orchestrator', 'state', 'contatos-invalidos-2026-09-17.csv'), 'utf8');
    for (const l of csv.split(/\r?\n/).slice(1)) { const id = l.split(/[;,]/)[0]; if (id) bounces.add(String(id).trim()); }
  } catch { /* sem registro de bounces */ }

  fs.mkdirSync(path.join(OUT, 'fichas'), { recursive: true });
  const manifesto = [['slug', 'casa', 'cidade', 'pais', 'segmento', 'prioridade', 'canal', 'idioma', 'p90', 'p30', 'aceitos90', 'sem_resposta90', 'pendentes_vivos', 'respondeu_total', 'codigos_verificados', 'login_de_cliente', 'proximo_passo'].join(';')];
  const cont = {};
  for (const r of rows) {
    const paisCod = PAIS_NOME[r.country] || '';
    const idioma = IDIOMA_PAIS[paisCod] || 'en';
    const tel = avaliarTelefone ? avaliarTelefone(r.tel) : { qualidade: 'DESCONHECIDO', e164: null };
    const movel = tel.qualidade === 'ENVIAVEL';
    const emailMorto = bounces.has(String(r.restaurant_id));
    let seg, prio;
    if (r.codigos_verificados > 0 && r.vinculos === 0) { seg = 'V'; prio = 1; }
    else if (r.login_de_cliente && r.vinculos === 0) { seg = 'C'; prio = 2; }
    else if (r.respondeu_total >= 3 && r.aceitos_total >= 1) { seg = 'A'; prio = 3; }
    else if (r.p90 >= 10 && r.respondeu_total <= 2) { seg = 'B'; prio = 4; }
    else { seg = 'B'; prio = 5; }
    if (emailMorto) { seg = 'D'; prio = 4; }
    const canal = movel ? 'whatsapp' : (r.tel ? 'telefone' : (r.email ? 'email' : 'sem contato'));
    const v = { casa: r.name, p90: r.p90, aceitos: r.aceitos_total, sem: r.sem90, pend: r.pendentes_vivos > 0 ? (idioma === 'pt' ? ` — ${r.pendentes_vivos} ainda à espera hoje` : idioma === 'fr' ? ` — ${r.pendentes_vivos} attendent encore aujourd’hui` : idioma === 'it' ? ` — ${r.pendentes_vivos} aspettano ancora oggi` : idioma === 'es' ? ` — ${r.pendentes_vivos} siguen esperando hoy` : idioma === 'de' ? ` — ${r.pendentes_vivos} warten heute noch` : ` — ${r.pendentes_vivos} still waiting today`) : '', link: LINK };
    const t = T[idioma];
    const waKey = seg === 'V' ? 'wa_V' : seg === 'C' ? 'wa_C' : seg === 'A' ? 'wa_A' : 'wa_B';
    const telKey = seg === 'A' || seg === 'V' || seg === 'C' ? 'tel_A' : 'tel_B';
    const proximo = seg === 'D' ? 'corrigir o e-mail do catálogo (DBA) antes de qualquer mensagem — o pedido de mesa não chega'
      : seg === 'V' ? 'DEPOIS do conserto da porta: WhatsApp/telefone com o texto V no mesmo dia'
      : seg === 'C' ? 'DEPOIS do conserto: o desenvolvedor vincula a conta; enviar texto C com o link de senha'
      : seg === 'A' ? (movel ? 'WhatsApp com o texto A (dia 0); telefone no dia 2 se sem resposta' : 'telefone com o roteiro A; pedir o WhatsApp certo; enviar o link')
      : (movel ? 'marcar o número no opt-in (v9) para receber os pedidos ao vivo; WhatsApp com o texto B' : 'telefone com o roteiro B; objetivo único: obter o WhatsApp de quem atende');
    cont[seg] = (cont[seg] ?? 0) + 1;
    cont['canal:' + canal] = (cont['canal:' + canal] ?? 0) + 1;

    const ficha = [
      `# ${r.name} — ${r.city}, ${r.country}`,
      '',
      `Segmento **${seg}** (prioridade ${prio}) · canal **${canal}** · idioma **${idioma}** · telefone ${tel.qualidade}${emailMorto ? ' · **E-MAIL DO CATÁLOGO MORTO**' : ''}`,
      '',
      '| Métrica | Valor |',
      '|---|---|',
      `| Pedidos 90 dias / 30 dias | ${r.p90} / ${r.p30} |`,
      `| Aceitos 90 dias · sem resposta 90 dias | ${r.aceitos90} · ${r.sem90} |`,
      `| Respostas em toda a história (aceites) | ${r.respondeu_total} (${r.aceitos_total}) |`,
      `| Pendentes vivos hoje · próximo jantar pendente | ${r.pendentes_vivos} · ${r.proximo_pendente ? String(r.proximo_pendente).slice(0, 10) : '—'} |`,
      `| Códigos de página verificados · último | ${r.codigos_verificados} · ${r.ultimo_codigo ? String(r.ultimo_codigo).slice(0, 10) : '—'} |`,
      `| Já tem login de cliente com o e-mail da casa | ${r.login_de_cliente ? 'sim' : 'não'} |`,
      `| Contato | tel ${r.tel ?? '—'} · e-mail ${r.email ?? '—'} |`,
      '',
      `**Próximo passo:** ${proximo}`,
      '',
      `## WhatsApp (${idioma})`,
      '',
      preencher(t[waKey], v),
      '',
      `## Telefone — roteiro de 40 segundos (${idioma})`,
      '',
      preencher(t[telKey], v),
      '',
      '## Regras',
      '- Nunca prometer selo, prazo ou benefício que não exista hoje. A prioridade do concierge (Aria encaminha clientes para quem responde) já existe desde a v11.',
      '- Se pedirem para parar: registrar no opt-out de listagem e não voltar.',
      '- Segunda mensagem só após 48 h sem resposta; nunca uma terceira pelo mesmo canal.',
      '',
    ].join('\n');
    fs.writeFileSync(path.join(OUT, 'fichas', `${r.slug}.md`), ficha, 'utf8');
    manifesto.push([r.slug, r.name, r.city, paisCod, seg, prio, canal, idioma, r.p90, r.p30, r.aceitos90, r.sem90, r.pendentes_vivos, r.respondeu_total, r.codigos_verificados, r.login_de_cliente ? 'sim' : 'nao', proximo].map((x) => String(x ?? '').replace(/;/g, ',')).join(';'));
  }
  fs.writeFileSync(path.join(OUT, 'manifesto.csv'), manifesto.join('\n') + '\n', 'utf8');
  const resumo = [`# Ativação — resumo (${new Date().toISOString().slice(0, 10)})`, '', `Casas: ${rows.length}`, '', ...Object.entries(cont).sort().map(([k, n]) => `- ${k}: ${n}`), '', 'Ordem: V (verificou e parou) → C (login de cliente) → A (responde) → B (silenciosa) · D só depois de corrigir o e-mail.'].join('\n');
  fs.writeFileSync(path.join(OUT, 'resumo.md'), resumo + '\n', 'utf8');
  console.log(resumo);
  console.log(`\nfichas: ${path.relative(RAIZ, path.join(OUT, 'fichas'))} · manifesto: ${path.relative(RAIZ, path.join(OUT, 'manifesto.csv'))}`);
})().catch((e) => { console.error('ERRO', e.message); process.exit(1); });
