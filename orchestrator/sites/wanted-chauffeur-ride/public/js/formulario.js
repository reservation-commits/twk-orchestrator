/* Wanted Chauffeur · formulário de reserva.
   1. Calcula o preço e escreve a mensagem do WhatsApp com a referência WTD-<origem>-XXXX.
   2. Pinta a agenda: dias fechados riscados na faixa, horários ocupados marcados "complet" (disponibilidade.js).
   3. Ao clicar em "Préparer le message", grava a reserva na Central (POST /api/chauffeur/reserva) e só então mostra o
      botão do WhatsApp pronto. Se o horário acabou de ser pego (409), avisa e recarrega a agenda.
   Se a gravação falhar por rede, o cliente ainda abre o WhatsApp: a referência vai na mensagem. */
import { CONFIG } from './config.js';
import { PRODUTOS, montante } from './precos.js';
import { hojeParis, somarDias, dataLonga, rotuloDia, horaParaMin, horarios } from './datas.js';
import * as agenda from './disponibilidade.js';

const $ = (id) => document.getElementById(id);

/* Origem do pedido: a letra vem do link (?o=T TikTok · I Instagram · Y YouTube · W Twitch · H hôtel · S site). Sem letra = R, direto. */
function origem() { const o = (new URLSearchParams(location.search).get('o') || 'R').toUpperCase(); return /^[TIYWHS]$/.test(o) ? o : 'R'; }
function referencia(letra) { const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let s = ''; for (let i = 0; i < 4; i++) s += a[Math.floor(Math.random() * a.length)]; return `WTD-${letra}-${s}`; }

const MENSAGENS_409 = {
  ocupado: "Ce créneau vient d'être pris. Choisissez une autre heure : les horaires libres sont à jour.",
  dia_fechado: "Julien n'est pas disponible ce jour-là. Choisissez un autre jour.",
  antecedencia: "Réservation au moins 2 heures à l'avance. Choisissez une heure plus tard.",
  passado: 'Cette date est déjà passée.',
  horizonte: 'Cette date est trop loin : choisissez une date plus proche.',
};

export function iniciarFormulario() {
  const el = {
    produit: $('produit'), heures: $('heures'), lblH: $('lbl-heures'), date: $('date'), heure: $('heure'), seg: $('seg'),
    depart: $('depart'), arrivee: $('arrivee'), nom: $('nom'), tel: $('tel'), msg: $('msg'), img: $('img'),
    total: $('total'), totalpp: $('total-pp'), bubble: $('bubble'), reply: $('reply'), wa: $('wa'), refout: $('refout'),
    toast: $('toast'), jours: $('jours'), dispo: $('dispo'), submit: $('submit'), numout: $('numout'), form: $('form'), copy: $('copy'),
  };
  if (!el.form) return;
  const hoje = hojeParis();
  let pax = 6, gravada = false, gravando = false;
  const ref = referencia(origem());
  el.refout.textContent = ref;
  if (el.numout) el.numout.textContent = CONFIG.whatsappExibido;

  // horários (o value é sempre a hora pura; o texto ganha " · complet" quando ocupado)
  const frag = document.createDocumentFragment();
  for (const h of horarios(CONFIG.passoMin)) { const o = document.createElement('option'); o.value = h; o.textContent = h; if (h === CONFIG.horaPadrao) o.selected = true; frag.appendChild(o); }
  el.heure.appendChild(frag);
  el.date.value = hoje; el.date.min = hoje; el.date.max = somarDias(hoje, 90);

  const aviso = (texto, ok) => { el.toast.style.color = ok ? 'var(--ok)' : 'var(--warn)'; el.toast.textContent = texto; };
  const horas = () => Math.max(2, parseInt(el.heures.value || '2', 10));

  // ---------------------------------------------------------------- agenda
  function pintarDias() {
    el.jours.textContent = '';
    for (let i = 0; i < CONFIG.diasNaFaixa; i++) {
      const d = somarDias(hoje, i); const r = rotuloDia(d); const info = agenda.dia(d);
      const b = document.createElement('button'); b.type = 'button'; b.dataset.data = d;
      b.setAttribute('aria-pressed', String(d === el.date.value));
      b.setAttribute('aria-label', `${dataLonga(d)}${info && info.fechado ? ', indisponible' : ''}`);
      if (info && info.fechado) { b.disabled = true; b.title = 'Indisponible'; }
      const s = document.createElement('small'); s.textContent = r.semana;
      const n = document.createElement('b'); n.textContent = r.dia;
      const m = document.createElement('small'); m.textContent = r.mes;
      b.append(s, n, m); el.jours.appendChild(b);
    }
  }
  function pintarHoras() {
    const data = el.date.value; const dur = agenda.duracao(el.produit.value, horas());
    let primeiraLivre = null;
    for (const o of el.heure.options) {
      const livre = agenda.livre(data, horaParaMin(o.value), dur);
      o.disabled = livre === false;
      o.textContent = livre === false ? `${o.value} · complet` : o.value;
      if (livre !== false && primeiraLivre === null) primeiraLivre = o.value;
    }
    const info = agenda.dia(data);
    let texto = '';
    if (info && info.fechado) texto = data < hoje ? 'Cette date est déjà passée.' : "Julien n'est pas disponible ce jour-là. Choisissez un autre jour.";
    else if (primeiraLivre === null && agenda.conhecida()) texto = 'Plus de créneau libre ce jour-là. Choisissez un autre jour.';
    else if (el.heure.selectedOptions[0] && el.heure.selectedOptions[0].disabled) {
      // horário escolhido ficou ocupado: vai para o livre mais próximo dele (antes ou depois)
      const i = el.heure.selectedIndex; const ops = [...el.heure.options];
      let prox = null; for (let k = 1; k < ops.length && !prox; k++) prox = [ops[i + k], ops[i - k]].find((o) => o && !o.disabled) || null;
      if (prox) { el.heure.value = prox.value; texto = `Heure ajustée à ${prox.value} : le créneau choisi est déjà pris.`; }
    }
    el.dispo.textContent = texto;
    el.submit.disabled = !!(info && info.fechado) || (primeiraLivre === null && agenda.conhecida());
    [...el.jours.children].forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.data === data)));
  }
  async function garantirDia(data) {
    if (agenda.dia(data) && agenda.dia(somarDias(data, 1))) return;
    await agenda.carregar(data, 2); pintarHoras(); render();
  }
  async function recarregarAgenda() {
    agenda.esquecer();
    const ok = await agenda.carregar(hoje, Math.max(CONFIG.diasNaFaixa + 1, 15));
    if (ok && agenda.meta()) el.date.max = agenda.meta().horizonte || el.date.max;
    if (el.date.value && !agenda.dia(el.date.value)) await agenda.carregar(el.date.value, 2);
    pintarDias(); pintarHoras(); render();
  }

  // ---------------------------------------------------------------- preço e mensagem
  function render() {
    const p = PRODUTOS[el.produit.value];
    el.lblH.hidden = !p.porHora;
    const m = montante(el.produit.value, horas());
    el.total.textContent = `${m} €${p.plus || ''}`;
    el.totalpp.textContent = `${Math.round(m / pax)} € par personne à ${pax}${p.plus ? ', hors dîner' : ''}`;
    const linhas = [
      `Bonjour, [Réf ${ref}]`,
      `${p.nome}${p.porHora ? ' ' + horas() + ' h' : ''}, ${dataLonga(el.date.value)}, ${el.heure.value}, ${pax} personne${pax > 1 ? 's' : ''}.`,
      `Départ : ${el.depart.value.trim() || 'à préciser'}${el.arrivee.value.trim() ? ' → ' + el.arrivee.value.trim() : ''}.`,
      `Réservation au nom de ${el.nom.value.trim() || '…'}.`,
      `${el.msg.value.trim() ? el.msg.value.trim() + '\n' : ''}Images à bord : ${el.img.checked ? 'ok pour publication' : 'privées'}.`,
    ];
    const texto = linhas.join('\n');
    el.bubble.textContent = ''; el.bubble.appendChild(document.createTextNode(texto));
    const t = document.createElement('span'); t.className = 't'; t.textContent = 'maintenant'; el.bubble.appendChild(t);
    el.bubble.dataset.text = texto;
    el.wa.href = `https://wa.me/${CONFIG.whatsapp}?text=${encodeURIComponent(texto)}`;
    el.reply.textContent = `Bonjour, c'est confirmé pour ${dataLonga(el.date.value)} ${el.heure.value}, au nom de ${el.nom.value.trim() || '…'}. ${m} €${p.plus || ''} pour la voiture. Réf ${ref}. Portes ouvertes à l'heure dite.`;
    const t2 = document.createElement('span'); t2.className = 't'; t2.textContent = 'exemple de réponse de Julien'; el.reply.appendChild(t2);
  }

  // ---------------------------------------------------------------- gravação
  function corpo() {
    const p = PRODUTOS[el.produit.value];
    return {
      codigo: ref, produto: el.produit.value, data: el.date.value || null, hora: el.heure.value || null, pessoas: pax,
      horas: p.porHora ? horas() : null, idioma: (document.documentElement.lang || 'fr').slice(0, 2), imagens: el.img.checked ? 'ok' : 'privadas',
      nome: el.nom.value.trim(), whatsapp: el.tel.value.trim() || null, partida: el.depart.value.trim() || null,
      destino: el.arrivee.value.trim() || null, recado: el.msg.value.trim() || null,
    };
  }
  /** Devolve { ok } ou { ok: false, status, motivo, erro }. Nunca lança. */
  async function gravar() {
    if (gravada) return { ok: true };
    if (gravando) return { ok: false, erro: 'en cours' };
    gravando = true;
    const ctrl = 'AbortController' in window ? new AbortController() : null; if (ctrl) setTimeout(() => ctrl.abort(), 8000);
    try {
      const r = await fetch(`${CONFIG.api}/api/chauffeur/reserva`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo()), keepalive: true, signal: ctrl ? ctrl.signal : undefined });
      const j = await r.json().catch(() => ({}));
      if (r.status === 201 || r.status === 200) { gravada = true; return { ok: true }; }
      return { ok: false, status: r.status, motivo: j.motivo, erro: j.error || 'HTTP ' + r.status };
    } catch (e) { return { ok: false, erro: String((e && e.message) || e) }; }
    finally { gravando = false; }
  }

  // ---------------------------------------------------------------- eventos
  for (const c of [el.depart, el.arrivee, el.nom, el.tel, el.msg, el.img, el.heure]) { c.addEventListener('input', render); c.addEventListener('change', render); }
  for (const c of [el.produit, el.heures]) { c.addEventListener('input', () => { pintarHoras(); render(); }); c.addEventListener('change', () => { pintarHoras(); render(); }); }
  el.date.addEventListener('change', () => { if (el.date.value < hoje) el.date.value = hoje; pintarHoras(); render(); garantirDia(el.date.value); });
  el.jours.addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b || b.disabled) return; el.date.value = b.dataset.data; pintarHoras(); render(); });
  el.seg.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    for (const x of el.seg.children) x.setAttribute('aria-pressed', 'false');
    b.setAttribute('aria-pressed', 'true'); pax = parseInt(b.textContent, 10); render();
  });
  document.querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('click', () => {
    el.produit.value = b.getAttribute('data-pick'); pintarHoras(); render();
    document.getElementById('reserver').scrollIntoView({ behavior: 'smooth' }); el.nom.focus({ preventScroll: true });
  }));
  el.form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!el.nom.value.trim()) { aviso('Pas de nom, pas de mission : écrivez qui monte à bord.', false); el.nom.focus(); return; }
    render(); el.submit.disabled = true; aviso('Un instant, on enregistre la demande…', true);
    const r = await gravar();
    el.submit.disabled = false;
    if (r.ok) { el.reply.hidden = false; aviso(`Demande enregistrée (réf ${ref}). Ouvrez WhatsApp pour l'envoyer à Julien.`, true); return; }
    if (r.status === 409) { aviso(MENSAGENS_409[r.motivo] || MENSAGENS_409.ocupado, false); await recarregarAgenda(); el.heure.focus(); return; }
    if (r.status === 400 && /WhatsApp/i.test(r.erro || '')) { aviso('Vérifiez le numéro WhatsApp (format +33 6 12 34 56 78).', false); el.tel.focus(); return; }
    if (r.status === 400 && /nome|nom/i.test(r.erro || '')) { aviso('Écrivez le prénom et le nom de la personne qui monte à bord.', false); el.nom.focus(); return; }
    // rede ou servidor: não trava o cliente, a referência vai na mensagem de todo jeito
    el.reply.hidden = false; aviso(`Le message est prêt. Ouvrez WhatsApp : Julien reçoit la demande avec la référence ${ref}.`, true);
  });
  el.wa.addEventListener('click', () => { if (!gravada && el.nom.value.trim()) gravar(); });
  el.copy.addEventListener('click', () => {
    if (!gravada && el.nom.value.trim()) gravar();
    const t = el.bubble.dataset.text || '';
    const selecionar = () => { const r = document.createRange(); r.selectNodeContents(el.bubble); const s = window.getSelection(); s.removeAllRanges(); s.addRange(r); el.toast.textContent = 'Texte sélectionné : copiez-le avec Ctrl+C.'; };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(() => aviso('Message copié.', true), selecionar); else selecionar();
  });

  pintarDias(); render();
  recarregarAgenda();
}
