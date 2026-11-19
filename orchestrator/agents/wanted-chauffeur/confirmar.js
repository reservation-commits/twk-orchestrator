'use strict';
/**
 * Link de confirmação do Julien (Fase 2, 19/11/2026).
 *
 * O aviso de pedido novo leva um link https://<central>/c/<codigo>?t=<token>. O Julien abre no celular, vê a ficha e
 * toca em "Confirmer" (ou "Refuser"). O token é um HMAC do código com CHAUFFEUR_CONFIRMA_SECRET (ou CENTER_TOKEN):
 * sem segredo não há link (o aviso sai sem ele e o Márlon marca no painel); link errado → 404 sem dizer por quê.
 * A página não tem script (CSP) e não mostra o telefone do cliente.
 */
const crypto = require('node:crypto');
const { PRODUTO_NOME } = require('./reservas.js');

function segredo(env = process.env) { return String(env.CHAUFFEUR_CONFIRMA_SECRET || env.CENTER_TOKEN || '').trim(); }
function token(codigo, env = process.env) {
  const s = segredo(env); if (!s) return null;
  return crypto.createHmac('sha256', s).update(String(codigo).toUpperCase()).digest('base64url').slice(0, 16);
}
function tokenValido(codigo, t, env = process.env) {
  const esperado = token(codigo, env); if (!esperado || !t || t.length !== esperado.length) return false;
  return crypto.timingSafeEqual(Buffer.from(esperado), Buffer.from(String(t)));
}
/** Base pública da Central (CHAUFFEUR_CONFIRMA_URL, ex.: https://central.theworldkeys.com). Sem ela, sem link. */
function link(codigo, env = process.env) {
  const base = String(env.CHAUFFEUR_CONFIRMA_URL || '').trim().replace(/\/+$/, '');
  const t = token(codigo, env);
  return base && t ? `${base}/c/${codigo}?t=${t}` : null;
}

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const diaFr = (iso) => { if (!iso) return 'date à préciser'; const d = new Date(iso + 'T12:00:00Z'); return `${['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'][d.getUTCDay()]} ${d.getUTCDate()} ${['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'][d.getUTCMonth()]}`; };

/** A página do Julien. `estado`: 'pedido' (botões), 'confirmado' | 'perdido' | outro (só a ficha), 'feito' (sem botões). `mensagem`: aviso em cima. */
function pagina(r, { t, mensagem = '', envioCliente = null } = {}) {
  const linhas = [['Mission', `${PRODUTO_NOME[r.produto] || r.produto}${r.horas ? ' ' + r.horas + ' h' : ''}`], ['Date', diaFr(r.data)], ['Heure', r.hora || '—'], ['Passagers', r.pessoas || '—'], ['Au nom de', r.nome || '(nom manquant)'], ['Départ', r.partida || '—'], ['Destination', r.destino || '—'], ['Montant', `${Math.round((r.valor_cent || 0) / 100)} €${r.produto === 'soiree' ? ' + dîner' : ''}`], ['Images à bord', r.imagens === 'ok' ? 'ok pour publication' : 'privées'], ['Mot du client', r.recado || '—']];
  const podeDecidir = r.status === 'pedido' || r.status === 'orcado';
  const estado = { pedido: 'En attente de ta réponse', orcado: 'Devis envoyé', confirmado: 'Confirmée', feito: 'Faite', perdido: 'Refusée / perdue', cancelado: 'Annulée' }[r.status] || r.status;
  const cliente = envioCliente === true ? '<p class="ok">Le client a reçu la confirmation sur WhatsApp.</p>' : envioCliente === false ? '<p class="warn">La confirmation au client n\'est pas partie automatiquement : envoie-la toi-même sur WhatsApp.</p>' : '';
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Course ${esc(r.codigo)} · Wanted Chauffeur</title>
<style>body{margin:0;background:#0b0618;color:#fff6fb;font:17px/1.5 Inter,system-ui,sans-serif;padding:20px}main{max-width:520px;margin:0 auto}h1{font-size:22px;margin:0 0 4px;text-transform:uppercase;letter-spacing:.04em}.ref{color:#3fe3e0;font-family:ui-monospace,monospace;letter-spacing:.08em}.etat{display:inline-block;margin:10px 0 18px;padding:4px 10px;border:2px solid #07030f;background:#ffd15c;color:#07030f;font-weight:700;text-transform:uppercase;font-size:13px;letter-spacing:.1em}table{width:100%;border-collapse:collapse;background:#1b0f36;border:3px solid #07030f;box-shadow:6px 6px 0 #07030f}td{padding:10px 12px;border-bottom:1px solid #2b1a52;vertical-align:top}td:first-child{color:#d3bfe6;font-size:13px;text-transform:uppercase;letter-spacing:.08em;width:38%}form{display:grid;gap:12px;margin-top:22px}button{padding:16px;font:700 18px Inter,system-ui,sans-serif;text-transform:uppercase;letter-spacing:.06em;border:3px solid #07030f;box-shadow:4px 4px 0 #07030f;cursor:pointer}.oui{background:linear-gradient(90deg,#ff2e97,#ff7a2f);color:#fff}.non{background:#1b0f36;color:#fff6fb}.msg{padding:12px 14px;border:3px solid #07030f;background:#3fe3a0;color:#06301a;font-weight:600;margin-bottom:16px}.ok{color:#3fe3a0}.warn{color:#ffd15c}p.note{color:#8f78b4;font-size:13px;margin-top:20px}</style></head>
<body><main>
<h1>Wanted Chauffeur</h1><div class="ref">${esc(r.codigo)}</div><div class="etat">${esc(estado)}</div>
${mensagem ? `<div class="msg">${esc(mensagem)}</div>` : ''}${cliente}
<table>${linhas.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</table>
${podeDecidir ? `<form method="post" action="/c/${esc(r.codigo)}?t=${esc(t)}"><button class="oui" name="decision" value="confirmer" type="submit">Confirmer la course</button><button class="non" name="decision" value="refuser" type="submit">Refuser</button></form>
<p class="note">Confirmer envoie au client la fiche ci-dessus sur WhatsApp, avec le montant. Le numéro du client reste dans sa conversation avec toi.</p>` : '<p class="note">Rien à décider ici. Pour changer le statut, le panneau de la Central.</p>'}
</main></body></html>`;
}

function paginaErro() {
  return '<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Wanted Chauffeur</title></head><body style="background:#0b0618;color:#fff6fb;font:17px Inter,system-ui,sans-serif;padding:40px 20px;text-align:center"><p>Ce lien n\'est pas valable.</p></body></html>';
}

module.exports = { token, tokenValido, link, pagina, paginaErro, segredo };
