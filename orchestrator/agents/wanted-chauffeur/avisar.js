'use strict';
/**
 * Avisos à equipe do Wanted Chauffeur pelo WhatsApp da Aria (webhook /webhook/alerta-equipe, template twk_team_alert).
 * Só nomes de destinatário ("julien", "marlon"), nunca números: a Aria resolve pela lista TEAM_ALERT_TO dela.
 * O template aceita uma linha de até 300 caracteres, sem quebra de linha. O telefone do cliente nunca entra.
 */
const { diaLongoFr } = require('./agenda-do-dia.js');
const { PRODUTO_NOME } = require('./reservas.js');

const MAX = 290;
const umaLinha = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const corta = (s, n) => (s && s.length > n ? s.slice(0, n - 1) + '…' : s);

function config(env = process.env) {
  const v = (k) => String(env[k] || '').trim();
  return {
    ariaUrl: (v('AGENT_ARIA_URL') || 'https://theworldkeys-aria-whatsapp-agent.xis4ee.easypanel.host').replace(/\/+$/, ''),
    segredo: v('ARIA_TEAM_ALERT_SECRET'),
    julien: (v('CHAUFFEUR_AGENDA_PARA') || 'julien').toLowerCase(),
    marlon: (v('CHAUFFEUR_PENDENTE_PARA') || 'marlon').toLowerCase(),
    pendenteMin: Math.max(5, Number(v('CHAUFFEUR_PENDENTE_MIN')) || 30),
    novaReserva: v('CHAUFFEUR_AVISO_NOVA') !== 'off',
  };
}

/** POST na Aria. Devolve { ok, status, desfecho }. Lança só se nem conseguiu chamar. */
async function avisarEquipe({ ariaUrl, segredo, para, sistema, situacao, evento, fetchImpl = globalThis.fetch }) {
  if (!segredo) return { ok: false, status: 0, desfecho: 'sem ARIA_TEAM_ALERT_SECRET' };
  const r = await fetchImpl(`${ariaUrl}/webhook/alerta-equipe`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-aria-secret': segredo },
    body: JSON.stringify({ destinatario: para, sistema, situacao: umaLinha(situacao).slice(0, 300), evento }),
    signal: AbortSignal.timeout(20000),
  });
  let j = null; try { j = await r.json(); } catch { /* sem corpo */ }
  return { ok: r.ok && j && j.ok === true, status: r.status, desfecho: (j && (j.desfecho || j.motivo)) || `HTTP ${r.status}` };
}

/** Em francês, ao Julien: o pedido acabou de chegar; o cliente vai escrever no WhatsApp dele. */
function textoNovaReserva(r) {
  const produto = PRODUTO_NOME[r.produto] || r.produto;
  const quando = [r.data ? diaLongoFr(r.data) : 'date à préciser', r.hora || ''].filter(Boolean).join(' ');
  const trajeto = r.partida ? `Départ ${corta(r.partida, 40)}${r.destino ? ' → ' + corta(r.destino, 40) : ''}. ` : '';
  const valor = `${Math.round((r.valor_cent || 0) / 100)} €${r.produto === 'soiree' ? ' + dîner' : ''}`;
  const base = `Nouvelle demande ${r.codigo} : ${produto}${r.horas ? ' ' + r.horas + ' h' : ''}, ${quando}, ${r.pessoas || '?'} pers., ${valor}. ${trajeto}Au nom de ${corta(r.nome || '(nom manquant)', 40)}. Le client t'écrit sur WhatsApp : réponds avec l'heure, le nom et le montant.`;
  return umaLinha(base).slice(0, MAX);
}

/** Em português, ao Márlon: pedido parado sem resultado na Central. Aviso interno; nada disso é prometido ao cliente. */
function textoPendente(r, minutos) {
  const produto = PRODUTO_NOME[r.produto] || r.produto;
  const base = `Pedido ${r.codigo} (${produto}, ${r.data || 'sem data'} ${r.hora || ''}, ${corta(r.nome || 'sem nome', 30)}) está há ${minutos} min sem resultado na Central. Conferir com o Julien se ele respondeu no WhatsApp e marcar em /chauffeur.`;
  return umaLinha(base).slice(0, MAX);
}

module.exports = { config, avisarEquipe, textoNovaReserva, textoPendente, MAX };
