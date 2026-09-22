#!/usr/bin/env node
'use strict';
/**
 * Exclusão de estabelecimento, ponta a ponta (ADR-016, autoridade delegada em 2026-09-11).
 *
 * Quando uma casa pede para sair da plataforma, o MAESTRO resolve sozinho:
 *   1. IDENTIFICA a casa no banco e monta o dossiê (quem é, desde quando, quantos pedidos,
 *      quantos aceitou, quem está esperando agora) — nunca se age sobre um id solto;
 *   2. HONRA o pedido: gera o SQL de despublicação para o executor do DBA (ADR-013), com
 *      motivo gravado, do_not_relist e ready_pending_photo zerado (senão o republicador volta);
 *   3. OFERECE a conta gratuita na mesma carta, com os números reais da casa — uma vez só, e
 *      JAMAIS como condição para a saída. Só o que existe: nada de comissão, fotos ou "volta em
 *      dois minutos" (republicar exige aprovação do fundador);
 *   4. NÃO DEIXA CLIENTE NA MÃO: escreve a cada pessoa com pedido vivo, NO IDIOMA DELA, com casas
 *      da mesma cidade QUE CONFIRMAM PEDIDOS (critério do Guardião: ≥4 pedidos em 90 dias e ≥50%
 *      aceitos). Se nenhuma casa qualifica, a carta não nomeia casa nenhuma.
 *
 * Correções de 14/09, depois do caso La Petite Maison: a carta ao cliente saía no idioma do PAÍS DO
 * RESTAURANTE (um cliente inglês recebeu francês e respondeu irritado) e as alternativas eram escolhidas
 * por ordem alfabética (uma delas nunca tinha confirmado um único pedido).
 *
 *   node exclusao.js --restaurante <id> --motivo "<texto>"                        → dry-run completo
 *   node exclusao.js --restaurante <id> --motivo "<texto>" --apply --aprovacao "…" → envia as cartas
 *
 * A despublicação em si NUNCA acontece aqui: este script só escreve o arquivo .sql, e a
 * escrita passa pela porta única (dba-escrita/executar.js), que exige aprovação e faz backup.
 */
const fs = require('node:fs');
const path = require('node:path');
const B = require('../chave-girada/n8n/_blocos-twk.js');
const registro = require('../registro-optout/registro');

const RAIZ = path.resolve(__dirname, '..', '..', '..');
const STATE = path.join(__dirname, 'state');
const PREV = path.join(STATE, 'exclusao');
const LEDGER = path.join(STATE, 'exclusao.jsonl');
const LOGS = path.join(RAIZ, 'orchestrator', 'logs');
fs.mkdirSync(PREV, { recursive: true });

(function env() {
  const f = path.join(process.env.USERPROFILE || process.env.HOME || '', '.twk', 'regencia.env');
  try {
    for (const l of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
      const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
    }
  } catch {}
})();
const WEBHOOK = process.env.EMAIL_WEBHOOK_URL || '';
const TOKEN = process.env.EMAIL_WEBHOOK_TOKEN || '';

const a = process.argv.slice(2);
const val = (n) => { const i = a.indexOf(n); return i >= 0 && a[i + 1] ? a[i + 1] : null; };
const apply = a.includes('--apply');
const alvo = val('--restaurante');
const motivo = val('--motivo');
const aprovacao = val('--aprovacao');
const hoje = new Date().toISOString().slice(0, 10);
const trace = `trc-exclusao-${hoje.replace(/-/g, '')}`;
const audit = (o) => { try { fs.mkdirSync(LOGS, { recursive: true }); fs.appendFileSync(path.join(LOGS, `audit-${hoje}.jsonl`), JSON.stringify({ ts: new Date().toISOString(), trace_id: trace, agente: 'maestro-atendimento', ...o }) + '\n'); } catch {} };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ─── idioma da CASA: o do país dela ─────────────────────────────────────────
const PAIS_IDIOMA = { France: 'fr', Belgium: 'fr', Switzerland: 'fr', Spain: 'es', Italy: 'italy', Portugal: 'pt', Brazil: 'pt' };
const idiomaDoPais = (p) => (PAIS_IDIOMA[p] === 'italy' ? 'it' : PAIS_IDIOMA[p]) || 'en';

// ─── idioma do CLIENTE: nunca o país do restaurante ─────────────────────────
// Ordem de evidência: (1) o que o cliente nos escreveu; (2) o texto que deixou na reserva;
// (3) o DDI do telefone, só quando não é ambíguo; (4) inglês, o idioma comum do viajante.
/** Mesma heurística de idiomaProvavel (Aria, src/format.ts): null quando não há sinal suficiente. */
function idiomaProvavel(texto) {
  const t = ' ' + String(texto || '').toLowerCase() + ' ';
  const s = { pt: 0, en: 0, es: 0, fr: 0, it: 0, de: 0 };
  const b = (l, re, w) => { const m = t.match(re); if (m) s[l] += m.length * w; };
  b('pt', /\b(?:você|não|obrigad\w*|sua|então|prezad\w*|estabelecimento|olá)\b/g, 2);
  b('pt', /\b(?:uma|com|até|já|também|isso|nosso|nossa|pelo|pela|são|está|foi|equipe|prazo|conta|caso|cliente)\b/g, 1);
  b('pt', /çã[eo]|ções|ç\w/g, 2);
  b('en', /\b(?:the|you|your|with|thank|please|reservation|restaurant|dear|we)\b/g, 2);
  b('es', /\b(?:usted|gracias|su|cuenta|reserva|estimad\w*|hola|nosotros)\b/g, 2);
  b('fr', /\b(?:vous|merci|votre|avec|réservation|compte|bonjour|nous|cher)\b/g, 2);
  b('it', /\b(?:grazie|prenotazione|vostr\w*|ristorante|gentile|buongiorno|siamo)\b/g, 2);
  b('de', /\b(?:sie|ihre|ihnen|danke|bitte|reservierung|sehr|geehrte|mit|freundlichen|grüßen)\b/g, 2);
  b('pt', /[ãõ]/g, 2);
  b('es', /[¿¡ñ]/g, 3);
  b('de', /\b(?:der|die|das|und|wir|haben|nicht)\b/g, 1);
  const o = Object.entries(s).sort((x, y) => y[1] - x[1]);
  if (o[0][1] < 4 || o[0][1] < o[1][1] * 1.6) return null;
  return o[0][0];
}
const DDI = [['55', 'pt'], ['351', 'pt'], ['244', 'pt'], ['258', 'pt'], ['34', 'es'], ['52', 'es'], ['54', 'es'], ['56', 'es'], ['57', 'es'], ['51', 'es'], ['58', 'es'],
  ['33', 'fr'], ['221', 'fr'], ['225', 'fr'], ['39', 'it'], ['49', 'de'], ['43', 'de'], ['1', 'en'], ['44', 'en'], ['61', 'en'], ['353', 'en'], ['64', 'en'], ['27', 'en']]
  .sort((x, y) => y[0].length - x[0].length);
// Bélgica, Suíça e Luxemburgo têm mais de uma língua: o DDI não decide nada.
const DDI_AMBIGUO = ['32', '41', '352'];
// Quebec fala francês: +1 com estes códigos de área não é inglês.
const QUEBEC = ['263', '354', '367', '418', '438', '450', '468', '514', '579', '581', '819', '873'];
function idiomaPorTelefone(tel) {
  const d = String(tel || '').replace(/\D/g, '');
  if (!d) return null;
  if (d.startsWith('1') && QUEBEC.includes(d.slice(1, 4))) return 'fr';
  if (DDI_AMBIGUO.some((p) => d.startsWith(p))) return null;
  const hit = DDI.find(([p]) => d.startsWith(p));
  return hit ? hit[1] : null;
}

function envRO() {
  const p = path.join(RAIZ, 'Agente Gerenciador do Banco de Dados', 'twk-db-agent', '.env.readonly.local');
  return Object.fromEntries(fs.readFileSync(p, 'utf8').split(/[\r\n]+/).filter((l) => l && !l.startsWith('#')).map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
}

async function dossie(c, id) {
  const casa = (await c.query(`select restaurant_id, name, city, country, slug, published, partner, ready_pending_photo, do_not_relist,
      email_for_reservations, telephone_of_the_establishment tel, url_page_twk, created_date::text, restaurant_category, timezone
    from db_restaurants where restaurant_id = $1`, [id])).rows[0];
  if (!casa) throw new Error(`restaurante ${id} não existe no catálogo — nada a fazer`);
  const hist = (await c.query(`select count(*)::int total, count(*) filter (where booking_status ilike 'accept%')::int aceitos,
      count(*) filter (where created_date >= now() - interval '365 days')::int ultimo_ano, min(created_date)::text primeiro
    from reservations where restaurant_id = $1`, [id])).rows[0];
  const vivas = (await c.query(`select s.reservation_code, s.booking_date::text d, s.reservation_time::text t, s.people, s.booking_details,
      u.email, u.name, u.phone from reservations s left join nextauth."User" u on u.id = s.customer_id
    where s.restaurant_id = $1 and s.expired_at is null and s.booking_status in ('Pending','In Treatment')
      and s.booking_date >= current_date order by s.booking_date`, [id])).rows;
  for (const v of vivas) {
    let idioma = null; let fonte = null;
    const email = String(v.email || '').toLowerCase();
    if (email) {
      const msgs = (await c.query(`select content from aria_messages where chat_id = $1 and direction = 'inbound' order by created_at desc limit 5`, [`email:${email}`])).rows.map((x) => x.content).join('\n');
      idioma = idiomaProvavel(msgs); if (idioma) fonte = 'mensagens do cliente';
    }
    if (!idioma && v.booking_details) { idioma = idiomaProvavel(v.booking_details); if (idioma) fonte = 'texto da reserva'; }
    if (!idioma) { idioma = idiomaPorTelefone(v.phone); if (idioma) fonte = 'DDI do telefone'; }
    if (!idioma) { idioma = 'en'; fonte = 'padrão internacional (sem sinal)'; }
    v.idioma = idioma; v.idioma_fonte = fonte;
  }
  const contas = (await c.query(`select count(*)::int n from restaurant_users where restaurant_id = $1`, [id])).rows[0];
  // Alternativas: só casas publicadas da MESMA cidade que de fato confirmam pedidos.
  const alternativas = (await c.query(`with h as (
        select restaurant_id, count(*)::int n, count(*) filter (where booking_status ilike 'accept%')::int a
          from reservations where created_date >= now() - interval '90 days' group by 1)
      select r.restaurant_id, r.name, r.city, r.url_page_twk, h.n pedidos_90d, h.a aceitos_90d
        from db_restaurants r join h on h.restaurant_id = r.restaurant_id
       where r.published = true and r.restaurant_id <> $1 and r.url_page_twk is not null
         and (r.city_id = (select city_id from db_restaurants where restaurant_id = $1) or lower(r.city) = lower($2))
         and h.n >= 4 and h.a * 2 >= h.n
       order by (h.a::numeric / h.n) desc, h.n desc, r.name
       limit 6`, [id, casa.city])).rows;
  return { casa, hist, vivas, contas, alternativas };
}

// ─── carta à casa: a saída está feita; a conta fica como caminho de volta ────
const CASA = {
  fr: (d) => ({
    assunto: `${d.casa.name} — votre retrait de The World Keys`,
    titulo: 'Votre page a été retirée',
    corpo: [
      `Bonjour,`,
      `Votre demande est faite : votre page ne figure plus sur The World Keys et vous ne recevrez plus de demandes de réservation. Nous ne la remettrons pas en ligne.`,
      `Une chose, uniquement pour votre information, et sans aucune condition : depuis votre inscription, <strong>${d.hist.total} client(s)</strong> ont demandé une table chez vous via notre plateforme${d.hist.aceitos > 0 ? `, dont ${d.hist.aceitos} ont été confirmées` : `, et aucune n'a pu être confirmée faute de réponse`}. Ces demandes arrivaient par e-mail, ce qui est le plus facile à manquer.`,
      `Le compte professionnel est gratuit et sans engagement : toutes les demandes dans un seul tableau de bord, une réponse en un geste depuis le téléphone, et vos horaires, votre politique de réservation et les informations de votre page entre vos mains. Si un jour cela vous intéresse, il suffit de répondre à cet e-mail.`,
      `Sinon, il n'y a rien à faire : le retrait est déjà effectif.`,
    ],
    fecho: 'Avec mes respects,<br/>Aria &#183; The World Keys',
    rodapeWa: 'Écrire à notre concierge sur WhatsApp',
    rodapePrefixo: 'Une question ?',
  }),
  en: (d) => ({
    assunto: `${d.casa.name} — your removal from The World Keys`,
    titulo: 'Your page has been removed',
    corpo: [
      `Hello,`,
      `It is done: your page no longer appears on The World Keys and you will receive no further booking requests. We will not put it back.`,
      `One thing, for your information only and with no strings attached: since your page went up, <strong>${d.hist.total} guest(s)</strong> asked for a table at your restaurant through our platform${d.hist.aceitos > 0 ? `, ${d.hist.aceitos} of which were confirmed` : `, and none could be confirmed because the requests went unanswered`}. They arrived by e-mail, which is the easiest place to miss them.`,
      `The professional account is free, with no commitment: every request in one dashboard, a one-tap reply from your phone, and your hours, booking policy and page details in your hands. If it ever interests you, simply reply to this e-mail.`,
      `Otherwise there is nothing to do: the removal is already in effect.`,
    ],
    fecho: 'With my respects,<br/>Aria &#183; The World Keys',
    rodapeWa: 'Message our concierge on WhatsApp',
    rodapePrefixo: 'Any questions?',
  }),
};
CASA.es = CASA.en; CASA.it = CASA.en; CASA.pt = CASA.en;

function cartaCasa(d) {
  const idioma = idiomaDoPais(d.casa.country);
  const t = (CASA[idioma] || CASA.en)(d);
  const html = [
    B.cabeca(t.titulo, t.corpo[1].replace(/<[^>]+>/g, '').slice(0, 110), idioma),
    ...t.corpo.map((p) => B.paragrafo(p)),
    B.paragrafo(t.fecho),
    B.rodape(t.rodapeWa, '', t.rodapePrefixo),
  ].join('\n');
  return { para: d.casa.email_for_reservations, assunto: t.assunto, html, idioma };
}

// ─── carta ao cliente com pedido vivo ───────────────────────────────────────
// Casas nomeadas só quando confirmam pedidos. Sem nenhuma, a carta não inventa solução: pergunta
// ao cliente o que ele quer e se compromete só com o que o MAESTRO faz (procurar e enviar).
const CLIENTE = {
  fr: (nome, casa, r, alts, passou) => {
    const n = alts.length;
    return {
      assunto: `Votre demande ${r.reservation_code} — ${casa.name}`,
      titulo: passou ? 'Au sujet de votre soirée' : `Votre demande chez ${casa.name}`,
      corpo: [
        `Bonjour${nome ? ' ' + esc(nome) : ''},`,
        passou
          ? `Je n'ai pas obtenu de confirmation à temps pour votre table chez ${esc(casa.name)}, et j'en suis navrée. Je ne veux pas en rester là.`
          : `Je n'ai pas de confirmation du restaurant pour votre demande, et je ne veux pas vous laisser dans l'incertitude.`,
        n === 0
          ? `Dites-moi simplement vos envies et l'horaire qui vous convient : je cherche pour vous une autre adresse de la région et je vous l'envoie.`
          : n === 1
            ? `Voici une adresse de la même ville que je vous recommande, et dont je m'occupe personnellement : si elle vous convient, dites-le-moi et je suis la réservation jusqu'à la confirmation.`
            : `Voici deux adresses de la même ville que je vous recommande, et dont je m'occupe personnellement : dites-moi laquelle vous convient et je suis la réservation jusqu'à la confirmation.`,
      ],
      listaTitulo: n === 1 ? 'Ma suggestion' : 'Mes deux suggestions',
      botao: 'Voir',
      fecho: `Répondez à cet e-mail, il me parvient directement.<br/><br/>Avec plaisir,<br/>Aria &#183; The World Keys`,
      rodapeWa: 'Écrire à notre concierge sur WhatsApp',
      rodapePrefixo: 'Besoin de quoi que ce soit ?',
    };
  },
  en: (nome, casa, r, alts, passou) => {
    const n = alts.length;
    return {
      assunto: `Your request ${r.reservation_code} — ${casa.name}`,
      titulo: passou ? 'About your reservation' : `Your request at ${casa.name}`,
      corpo: [
        `Hello${nome ? ' ' + esc(nome) : ''},`,
        passou
          ? `I did not get a confirmation in time for your table at ${esc(casa.name)}, and I am sorry. I do not want to leave it there.`
          : `I do not have a confirmation from the restaurant for your request, and I do not want to leave you waiting.`,
        n === 0
          ? `Just tell me what you are in the mood for and the time that suits you: I will look for another address in the area and send it to you.`
          : n === 1
            ? `Here is an address in the same city that I recommend and look after personally: if it suits you, let me know and I will follow the booking through to confirmation.`
            : `Here are two addresses in the same city that I recommend and look after personally: tell me which one suits you and I will follow the booking through to confirmation.`,
      ],
      listaTitulo: n === 1 ? 'My suggestion' : 'My two suggestions',
      botao: 'View',
      fecho: `Reply to this e-mail; it reaches me directly.<br/><br/>With pleasure,<br/>Aria &#183; The World Keys`,
      rodapeWa: 'Message our concierge on WhatsApp',
      rodapePrefixo: 'Anything you need?',
    };
  },
};
// Idiomas sem carta própria caem no inglês — e o dossiê avisa, para não parecer escolha.
const IDIOMAS_CARTA_CLIENTE = Object.keys(CLIENTE);

/** A mesa já passou? Compara data+hora LOCAIS da casa com o agora local dela.
 *  Sem isto, uma mesa de hoje às 19h30 lida às 21h seria tratada como futura. */
function jaPassou(casa, r) {
  const tz = casa.timezone || 'Europe/Paris';
  let agoraLocal;
  try { agoraLocal = new Intl.DateTimeFormat('sv-SE', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date()); }
  catch { agoraLocal = new Date().toISOString().slice(0, 16).replace('T', ' '); }
  return `${r.d} ${String(r.t).slice(0, 5)}` < agoraLocal.replace(',', '');
}

function cartaCliente(d, r, alts) {
  const idioma = IDIOMAS_CARTA_CLIENTE.includes(r.idioma) ? r.idioma : 'en';
  const passou = jaPassou(d.casa, r);
  const t = CLIENTE[idioma](r.name, d.casa, r, alts, passou);
  const linhas = alts.map((x) => `        <tr><td style="padding:11px 14px; border-bottom:1px solid #26200F;">
              <div style="font-family:Arial,Helvetica,sans-serif; font-size:14px; line-height:1.55; color:#F5EFE3;">${esc(x.name)}<span style="color:#8F8368;"> &#183; ${esc(x.city)}</span></div>
            </td><td align="right" style="padding:11px 14px; border-bottom:1px solid #26200F; white-space:nowrap;">
              <a href="${esc(x.url_page_twk)}" target="_blank" style="display:inline-block; padding:8px 18px; background-color:#CE9E3C; color:#12100C; font-family:Arial,Helvetica,sans-serif; font-size:13px; font-weight:600; text-decoration:none;">${t.botao}</a>
            </td></tr>`).join('\n');
  const html = [
    B.cabeca(t.titulo, t.corpo[1].replace(/<[^>]+>/g, '').slice(0, 110), idioma),
    ...t.corpo.map((p) => B.paragrafo(p)),
    ...(alts.length ? [B.cartaoDetalhes(linhas, t.listaTitulo)] : []),
    B.paragrafo(t.fecho),
    B.rodape(t.rodapeWa, '', t.rodapePrefixo),
  ].join('\n');
  return { para: r.email, assunto: t.assunto, html, idioma };
}

// ─── SQL de despublicação para a porta única do DBA ─────────────────────────
function sqlDespublicar(d, motivoTexto) {
  const id = d.casa.restaurant_id;
  return `-- Exclusão de ${d.casa.name} (${d.casa.city}, ${d.casa.country}) — ${hoje}
-- Motivo registrado: ${motivoTexto.replace(/\n/g, ' ')}
-- Autoridade: ADR-016 (delegação do fundador em 2026-09-11) · trace ${trace}
-- Sem DELETE: nenhuma linha some. published=false tira a casa das listagens,
-- do_not_relist e ready_pending_photo impedem que qualquer rotina a republique.
begin;
update public.db_restaurants
   set published = false,
       do_not_relist = true,
       ready_pending_photo = false,
       operational_status_reason = left(coalesce(operational_status_reason || ' | ', '') || 'removido a pedido do estabelecimento ${hoje} (${trace})', 500)
 where restaurant_id = '${id}';
do $$
declare n int;
begin
  select count(*) into n from public.db_restaurants where restaurant_id = '${id}' and published = false and do_not_relist = true;
  if n <> 1 then raise exception 'esperava 1 linha despublicada, encontrei %', n; end if;
end $$;
commit;
`;
}

// O fluxo só roda quando chamado direto; importado (testes), expõe só as funções puras.
if (require.main === module) (async () => {
  if (!alvo) { console.error('uso: --restaurante <id> --motivo "<texto>" [--apply --aprovacao "<frase>"]'); process.exit(2); }
  if (!motivo || motivo.length < 10) { console.error('BLOQUEADO: --motivo "<texto>" obrigatório (fica gravado no banco e no registro)'); process.exit(2); }
  if (apply && (!aprovacao || aprovacao.length < 10)) { console.error('BLOQUEADO: --apply exige --aprovacao "<frase do fundador>"'); process.exit(3); }
  if (apply && (!WEBHOOK || !TOKEN)) { console.error('BLOQUEADO: EMAIL_WEBHOOK_URL/TOKEN ausentes'); process.exit(2); }

  const { Client } = require(path.join(RAIZ, 'Agente Comercial', 'service', 'node_modules', 'pg'));
  const c = new Client({ connectionString: envRO().DATABASE_URL_RO, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000, statement_timeout: 50000 });
  await c.connect();
  const d = await dossie(c, alvo);
  await c.end();

  console.log(`\n=== DOSSIÊ · ${d.casa.name} (${d.casa.restaurant_id}) ===`);
  console.log(`  ${d.casa.city}, ${d.casa.country} · ${d.casa.restaurant_category || 'sem categoria'} · no catálogo desde ${d.casa.created_date.slice(0, 10)}`);
  console.log(`  publicada=${d.casa.published} · parceira=${d.casa.partner} · conta própria=${d.contas.n} · do_not_relist=${d.casa.do_not_relist}`);
  console.log(`  pedidos recebidos: ${d.hist.total} (aceitos ${d.hist.aceitos}, último ano ${d.hist.ultimo_ano})`);
  console.log(`  contato: ${d.casa.email_for_reservations || '—'} · ${d.casa.tel || '—'}`);
  console.log(`  clientes esperando agora: ${d.vivas.length}`);
  for (const v of d.vivas) {
    const carta = IDIOMAS_CARTA_CLIENTE.includes(v.idioma) ? v.idioma : `en (sem carta em ${v.idioma})`;
    console.log(`    ${v.reservation_code}  ${v.d} ${String(v.t).slice(0, 5)}  ${v.people}p  ${v.name || '(sem nome)'} <${String(v.email || '').replace(/^.*@/, '@')}>  idioma ${carta} · fonte: ${v.idioma_fonte}`);
  }
  console.log(`  alternativas na mesma cidade que confirmam pedidos (≥4 em 90d, ≥50% aceitos): ${d.alternativas.length}`);
  for (const x of d.alternativas) console.log(`    ${x.name} · ${x.aceitos_90d}/${x.pedidos_90d} aceitos em 90d`);

  const alts = d.alternativas.slice(0, 2);
  if (d.vivas.length && alts.length === 0) console.log('  AVISO: nenhuma casa da cidade confirma pedidos — as cartas ao cliente não nomeiam casas e oferecem procurar uma.');

  const fila = [];
  if (d.casa.email_for_reservations) fila.push({ tipo: 'casa', chave: `casa-${d.casa.restaurant_id}`, ...cartaCasa(d) });
  for (const r of d.vivas) {
    if (!r.email) { console.log(`  (sem e-mail do cliente em ${r.reservation_code} — nada a enviar)`); continue; }
    fila.push({ tipo: 'cliente', chave: r.reservation_code, ...cartaCliente(d, r, alts) });
  }

  // Termos que não saem em carta nenhuma: fragilidade exposta (ADR-015) e promessa sem lastro.
  const PROIBIDO = [/not a partner/i, /n[ãa]o (é|e) parceir/i, /pas .{0,12}partenaire/i, /cannot promise/i, /garantimos/i, /confirmada/i, /confirmed table/i,
    /instant(ly)?\s+(availability|confirmation|booking)/i, /confirmation in hand/i, /disponibilit[ée]\s+imm[ée]diate/i, /confirmation\s+imm[ée]diate/i,
    /sans commission/i, /no commission/i, /en deux minutes/i, /in two minutes/i];
  for (const f of fila) {
    const texto = f.html.replace(/<[^>]+>/g, ' ');
    const hit = PROIBIDO.find((re) => re.test(texto));
    if (hit) { console.error(`BLOQUEADO: ${f.chave} contém termo proibido ${hit}`); process.exit(5); }
    fs.writeFileSync(path.join(PREV, `${d.casa.slug}-${f.chave}.html`), f.html);
  }

  const arqSql = path.join(RAIZ, 'orchestrator', 'state', `exclusao-${d.casa.slug}-${hoje}.sql`);
  fs.writeFileSync(arqSql, sqlDespublicar(d, motivo));

  console.log(`\n=== CARTAS (${fila.length}) ===`);
  for (const f of fila) console.log(`  ${f.tipo.padEnd(8)} ${f.chave.padEnd(16)} ${f.idioma} → ${String(f.para).replace(/^.*@/, '@').padEnd(18)} ${f.assunto}`);
  console.log(`\n=== DESPUBLICAÇÃO ===\n  SQL gravado em ${arqSql}`);
  console.log(`  executar com: node orchestrator/agents/dba-escrita/executar.js --sql "${arqSql}" --apply --aprovacao "<frase>"`);

  if (!apply) { console.log(`\nDRY-RUN — nada enviado, nada alterado. Previews em ${PREV}.`); return; }

  // A carta à casa afirma "a sua página já saiu". Se ela ainda estiver publicada, isso é
  // mentira — e mentir ao estabelecimento é o mesmo defeito que gerou o incidente de 11/09.
  // Ordem obrigatória: primeiro a despublicação pela porta do DBA, depois as cartas.
  if (d.casa.published) {
    console.error('\nBLOQUEADO: a casa ainda está publicada e a carta afirma que a página saiu.');
    console.error('Execute a despublicação primeiro e rode este comando de novo:');
    console.error(`  node orchestrator/agents/dba-escrita/executar.js --sql "${arqSql}" --apply --aprovacao "<frase>"`);
    audit({ evento: 'exclusao_bloqueada', restaurante: d.casa.restaurant_id, motivo: 'casa ainda publicada' });
    process.exit(6);
  }

  let ok = 0;
  for (const f of fila) {
    const resp = await fetch(WEBHOOK, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` }, body: JSON.stringify({ para: f.para, assunto: f.assunto, html: f.html }) });
    const sucesso = resp.ok; if (sucesso) ok++;
    const linha = { ts: new Date().toISOString(), restaurante: d.casa.restaurant_id, nome: d.casa.name, tipo: f.tipo, chave: f.chave, idioma: f.idioma, dominio: String(f.para).replace(/^.*@/, ''), ok: sucesso, http: resp.status, motivo, aprovacao_ref: aprovacao };
    fs.appendFileSync(LEDGER, JSON.stringify(linha) + '\n');
    audit({ evento: 'exclusao_carta', ...linha });
    console.log(`  ${sucesso ? 'OK ' : 'FALHA'} ${f.chave} HTTP ${resp.status}`);
    await new Promise((r) => setTimeout(r, 1500));
  }

  // Registro de opt-out: fonte única do "não contatar" (Guardião e CLAVIS consultam).
  try {
    registro.registrar({
      restaurant_id: String(d.casa.restaurant_id), status: 'opted_out', do_not_relist: true,
      scope: ['listing', 'reservations', 'outreach'], requested_at: new Date().toISOString(),
      requested_by: `email:${d.casa.email_for_reservations}`, legal_basis: motivo,
      evidence_ref: `ledger:exclusao.jsonl ${hoje}`, trace_id: trace,
      notes: `Exclusão conduzida pelo MAESTRO (ADR-016). Cartas enviadas: ${fila.length}. SQL de despublicação em ${path.basename(arqSql)}.`,
    });
    console.log('  registro de opt-out gravado');
  } catch (e) { console.error('  AVISO: registro de opt-out falhou —', e.message); }

  console.log(`\nENVIADOS ${ok}/${fila.length}. A casa já estava despublicada antes do envio (a guarda acima não deixa inverter a ordem).`);
  console.log('Confira a página na ORIGEM, não na borda: um cache do Cloudflare pode devolver 200 por alguns minutos.');
  console.log(`  node -e "fetch('${d.casa.url_page_twk}?cb='+Date.now()).then(r=>console.log(r.status))"`);
})().catch((e) => { audit({ evento: 'falha', erro: e.message }); console.error('ERRO', e.message); process.exit(1); });

module.exports = { idiomaProvavel, idiomaPorTelefone };
