/**
 * MAESTRO Email — o braço de ENVIO da Central (v4.2 "Execução").
 * Enviar e-mail é ação da tabela de escalonamento: SEMPRE atrás do clique do
 * fundador (aprovação = envio imediato, no mesmo cartão). O modelo nunca chama
 * isto diretamente — quem dispara é o endpoint de decisão, depois do "aprovar".
 *
 * Provedores (o primeiro configurado vence):
 *  1. EMAIL_WEBHOOK_URL  — POST JSON {para, assunto, html} (Bearer EMAIL_WEBHOOK_TOKEN).
 *     Pensado para o n8n do próprio EasyPanel: o fluxo lá entrega via Gmail/SMTP da casa.
 *  2. RESEND_API_KEY + EMAIL_FROM — API do Resend (https://api.resend.com/emails).
 * Sem provedor: enviar() falha ALTO com instrução clara — nunca finge que enviou.
 */
const TIMEOUT_MS = Number(process.env.EMAIL_TIMEOUT_MS || 15_000);

function provider() {
  if (process.env.EMAIL_WEBHOOK_URL) return 'webhook';
  if (process.env.RESEND_API_KEY && process.env.EMAIL_FROM) return 'resend';
  return null;
}
const enabled = () => !!provider();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

async function post(url, headers, body) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await r.text();
    return { ok: r.ok, status: r.status, corpo: text.slice(0, 500) };
  } catch (e) {
    return { ok: false, status: 0, corpo: String(e && e.name === 'AbortError' ? `timeout ${TIMEOUT_MS}ms` : (e.message || e)).slice(0, 300) };
  } finally { clearTimeout(to); }
}

/**
 * Envia um e-mail. Retorna { ok, provedor, detalhe }.
 * para: string (um destinatário por chamada — lote é N chamadas, N cartões, N cliques ou 1 clique em lote na UI).
 */
async function enviar({ para, assunto, html }) {
  const p = provider();
  if (!p) {
    return { ok: false, provedor: null, detalhe: 'nenhum provedor de e-mail configurado — defina EMAIL_WEBHOOK_URL (n8n) ou RESEND_API_KEY + EMAIL_FROM' };
  }
  if (!EMAIL_RE.test(String(para || ''))) return { ok: false, provedor: p, detalhe: `destinatário inválido: "${para}"` };
  if (!String(assunto || '').trim()) return { ok: false, provedor: p, detalhe: 'assunto vazio' };
  if (!String(html || '').trim()) return { ok: false, provedor: p, detalhe: 'corpo vazio' };

  if (p === 'webhook') {
    const h = process.env.EMAIL_WEBHOOK_TOKEN ? { authorization: `Bearer ${process.env.EMAIL_WEBHOOK_TOKEN}` } : {};
    const r = await post(process.env.EMAIL_WEBHOOK_URL, h, { para, assunto, html });
    return { ok: r.ok, provedor: 'webhook', detalhe: r.ok ? `aceito (HTTP ${r.status})` : `HTTP ${r.status}: ${r.corpo}` };
  }
  // resend
  const r = await post('https://api.resend.com/emails', { authorization: `Bearer ${process.env.RESEND_API_KEY}` }, {
    from: process.env.EMAIL_FROM, to: [para], subject: assunto, html,
  });
  return { ok: r.ok, provedor: 'resend', detalhe: r.ok ? `aceito (HTTP ${r.status})` : `HTTP ${r.status}: ${r.corpo}` };
}

module.exports = { enabled, provider, enviar, EMAIL_RE };
