'use strict';
/**
 * Blocos do padrão visual TWK para e-mails transacionais (cartão escuro, dourado, Georgia nos títulos).
 * Fonte única do desenho — os geradores de template (cta-conta-v2, alteracao-v2, lote-2…) montam a partir daqui.
 * Regras herdadas: botões em tabela (bulletproof), sem imagens além do logo/wordmark, links de rastreio pelo /go
 * com rid prefixado por "r" (imune ao defeito quoted-printable dos nós Gmail sem compensação).
 */
const GO = 'https://theworldkeys-n8n.xis4ee.easypanel.host/webhook/go';

const cabeca = (titulo, preheader, lang = 'en') => `<!DOCTYPE html>
<html lang="${lang}"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><meta name="color-scheme" content="dark" /><title>${titulo}</title></head>
<body style="margin:0; padding:0; background-color:#0B0A08;">
  <div style="display:none; max-height:0; overflow:hidden; mso-hide:all;">${preheader}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#0B0A08; border-collapse:collapse;">
    <tr><td align="center" style="padding:12px 6px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%; max-width:600px; background-color:#12100C; border:1px solid #26200F; border-radius:16px; border-collapse:separate; overflow:hidden;">
        <tr><td align="center" style="padding:36px 20px 0 20px;">
          <a href="https://theworldkeys.com/" target="_blank" style="text-decoration:none;">
            <img src="https://theworldkeys.com/images/twk-logo.gif" width="56" alt="" style="display:block; margin:0 auto 14px auto; width:56px; height:auto; border:0;" border="0" />
            <img src="https://img.mailinblue.com/6331555/images/content_library/original/661430b29475332809dc25ad.png" width="220" alt="THE WORLD KEYS" style="display:block; margin:0 auto; width:220px; height:auto; border:0;" border="0" />
          </a>
          <div style="font-family:Arial,Helvetica,sans-serif; font-size:10px; letter-spacing:4px; color:#8F8368; padding-top:10px;">PARIS</div>
        </td></tr>
        <tr><td align="center" style="padding:20px 20px 0 20px;"><table role="presentation" width="48" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-top:1px solid #CE9E3C; font-size:0; line-height:0;">&nbsp;</td></tr></table></td></tr>
        <tr><td align="center" style="padding:26px 24px 8px 24px;">
          <h1 style="margin:0; font-family:Georgia,'Times New Roman',serif; font-weight:normal; font-size:24px; line-height:1.35; color:#F5EFE3;">${titulo}</h1>
        </td></tr>`;

const paragrafo = (html, cor = '#B5AB93', tam = 15) =>
  `        <tr><td style="padding:8px 28px 0 28px;"><p style="margin:0 0 14px 0; font-family:Arial,Helvetica,sans-serif; font-size:${tam}px; line-height:1.65; color:${cor};">${html}</p></td></tr>`;

const linha = (rotulo, valor, ultima = false) =>
  `              <tr><td style="padding:9px 16px; font-family:Arial,Helvetica,sans-serif; font-size:11px; letter-spacing:2px; color:#8F8368; ${ultima ? '' : 'border-bottom:1px solid #26200F;'} width:110px;">${rotulo}</td><td align="right" style="padding:9px 16px; font-family:Arial,Helvetica,sans-serif; font-size:14px; color:#F5EFE3; ${ultima ? '' : 'border-bottom:1px solid #26200F;'}">${valor}</td></tr>`;

const cartaoDetalhes = (linhas, rodape, destaque = false) => `        <tr><td style="padding:6px 16px 0 16px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#1A1611; border:1px solid ${destaque ? '#CE9E3C' : '#26200F'}; border-radius:12px; border-collapse:separate; overflow:hidden;">
${linhas}
${rodape ? `              <tr><td colspan="2" align="center" style="padding:10px 16px 12px 16px; font-family:Arial,Helvetica,sans-serif; font-size:11px; letter-spacing:2px; color:#8F8368;">${rodape}</td></tr>` : ''}
          </table>
        </td></tr>`;

/** Cartão-número: um valor grande em Georgia dourado (ex.: "6:30 PM") com legenda. */
const cartaoNumero = (legendaCima, valor, legendaBaixo) => `        <tr><td style="padding:6px 16px 0 16px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#1A1611; border:1px solid #CE9E3C; border-radius:12px; border-collapse:separate;">
            <tr><td align="center" style="padding:22px 20px 18px 20px;">
              <div style="font-family:Arial,Helvetica,sans-serif; font-size:11px; letter-spacing:3px; color:#8F8368;">${legendaCima}</div>
              <div style="font-family:Georgia,'Times New Roman',serif; font-size:40px; line-height:1.15; color:#E6C87A; padding:8px 0 4px 0;">${valor}</div>
              <div style="font-family:Arial,Helvetica,sans-serif; font-size:13px; color:#B5AB93;">${legendaBaixo}</div>
            </td></tr>
          </table>
        </td></tr>`;

const botao = (href, texto) => `        <tr><td align="center" style="padding:22px 20px 6px 20px;">
          <table role="presentation" align="center" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;"><tr><td align="center" valign="middle" style="background-color:#CE9E3C; border-radius:4px; text-align:center;">
            <a href="${href}" target="_blank" style="display:inline-block; padding:15px 38px; font-family:Arial,Helvetica,sans-serif; font-size:14px; line-height:1.2; font-weight:700; color:#12100C; text-decoration:none; text-align:center;">${texto}</a>
          </td></tr></table>
        </td></tr>`;

/** Link em texto, para quando o botão não faz sentido (ex.: URL a copiar). */
const linkTexto = (href, texto) => `        <tr><td style="padding:6px 28px 0 28px;">
          <p style="margin:0 0 8px 0; font-family:Arial,Helvetica,sans-serif; font-size:12px; line-height:1.6; color:#8F8368;">${texto}</p>
          <p style="margin:0 0 14px 0; font-family:Arial,Helvetica,sans-serif; font-size:12px; line-height:1.6; color:#CE9E3C; word-break:break-all;"><a href="${href}" target="_blank" style="color:#CE9E3C; text-decoration:underline; word-break:break-all;">${href}</a></p>
        </td></tr>`;

/** Convite à conta do restaurante — cartão dourado, botão rastreado pelo /go (c=<campanha>, rid=r<id>). */
const cartaoConta = (nomeExpr, ridExpr, campanha) => `        <tr><td style="padding:22px 16px 0 16px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#1A1611; border:1px solid #CE9E3C; border-radius:12px; border-collapse:separate;">
            <tr><td align="center" style="padding:24px 22px 20px 22px;">
              <div style="font-family:Georgia,'Times New Roman',serif; font-size:19px; line-height:1.35; color:#F5EFE3; padding-bottom:8px;">Answer every request in one tap.</div>
              <div style="font-family:Arial,Helvetica,sans-serif; font-size:13px; line-height:1.65; color:#B5AB93; padding-bottom:16px;">The free professional account for <span style="color:#E6C87A;">${nomeExpr}</span> puts your requests, your hours and your page in your hands.</div>
              <table role="presentation" align="center" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;"><tr><td align="center" valign="middle" style="background-color:#CE9E3C; border-radius:4px; text-align:center; vertical-align:middle;">
                <a href="${GO}?c=${campanha}&rid=r${ridExpr}" target="_blank" style="display:inline-block; padding:14px 38px; font-family:Arial,Helvetica,sans-serif; font-size:14px; line-height:1.2; font-weight:700; color:#12100C; text-decoration:none; text-align:center; vertical-align:middle;">Activate my key</a>
              </td></tr></table>
              <div style="font-family:Arial,Helvetica,sans-serif; font-size:11px; color:#8F8368; padding-top:11px;">Free &middot; two minutes &middot; the code goes to this email</div>
              <div style="font-family:Arial,Helvetica,sans-serif; font-size:11px; line-height:1.6; color:#6E6551; padding-top:7px;">PT Ative a conta gratuita da casa &#183; FR Activez le compte gratuit de la maison &#183; ES Active la cuenta gratuita de la casa &#183; IT Attivate l'account gratuito del locale</div>
            </td></tr>
          </table>
        </td></tr>`;

/** Passos numerados (1, 2, 3) no estilo dos Extratos. */
const passos = (titulo, itens) => `        <tr><td style="padding:22px 28px 0 28px;">
          <div style="font-family:Arial,Helvetica,sans-serif; font-size:11px; letter-spacing:2px; color:#8F8368; padding-bottom:10px;">${titulo}</div>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
${itens.map((t, i) => `            <tr><td valign="top" style="width:28px; padding:6px 0; font-family:Georgia,serif; font-size:18px; color:#E6C87A;">${i + 1}</td><td style="padding:6px 0; font-family:Arial,Helvetica,sans-serif; font-size:14px; line-height:1.55; color:#B5AB93; ${i < itens.length - 1 ? 'border-bottom:1px solid #26200F;' : ''}">${t}</td></tr>`).join('\n')}
          </table>
        </td></tr>`;

// `prefixo` existe para o rodapé não ficar bilíngue numa carta em francês/espanhol/italiano
// (defeito visto em 11/09: "Need anything?" colado a um texto em francês).
const rodape = (textoWa = 'Message our concierge on WhatsApp', avisoExtra = '', prefixo = 'Need anything?') => `        <tr><td align="center" style="padding:18px 20px 0 20px;">
          <p style="margin:0; font-family:Arial,Helvetica,sans-serif; font-size:13px; color:#8F8368;">${prefixo} <a href="https://wa.me/5521967841007" target="_blank" style="color:#E6C87A; text-decoration:none;">${textoWa}</a></p>
        </td></tr>${avisoExtra ? `
        <tr><td align="center" style="padding:10px 28px 0 28px;"><p style="margin:0; font-family:Arial,Helvetica,sans-serif; font-size:12px; line-height:1.6; color:#8F8368;">${avisoExtra}</p></td></tr>` : ''}
        <tr><td align="center" style="padding:22px 20px 0 20px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-top:1px solid #26200F; font-size:0; line-height:0;">&nbsp;</td></tr></table></td></tr>
        <tr><td align="center" style="padding:16px 24px 28px 24px;">
          <p style="margin:0 0 4px 0; font-family:Georgia,'Times New Roman',serif; font-size:13px; letter-spacing:3px; color:#8F8368;">THE WORLD KEYS</p>
          <p style="margin:0; font-family:Arial,Helvetica,sans-serif; font-size:11px; line-height:1.8; color:#6E6551;">
            <a href="https://theworldkeys.com/terms-of-use/" style="color:#8F8368; text-decoration:none;">Terms &amp; Conditions</a> &nbsp;&#183;&nbsp; <a href="mailto:support@theworldkeys.com" style="color:#8F8368; text-decoration:none;">support@theworldkeys.com</a><br/>
            66, Av. des Champs-&#201;lys&#233;es, 75008 Paris, France<br/>
            VAT: FR24901268326 &#183; R.C.S Paris: 901 268 326 &#183; &#169; 2026 The World Keys
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

/** Página de aprovação antes/depois (iframes srcdoc, auto-contida). */
function paginaAprovacao(titulo, sub, nota, pares) {
  const esc = (h) => h.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  const secoes = pares.map((p) => `<h2>${p.rotulo}</h2><div class="par"><div class="col"><div class="tag antes">ANTES — no ar hoje</div><iframe srcdoc="${esc(p.antes)}"></iframe></div><div class="col"><div class="tag depois">DEPOIS — proposta</div><iframe srcdoc="${esc(p.depois)}"></iframe></div></div>`).join('\n');
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"/><title>${titulo}</title>
<style>body{margin:0;padding:28px;background:#EFECE4;font-family:"Segoe UI",Arial,sans-serif;color:#16130E}h1{font-family:Georgia,serif;font-weight:normal;font-size:24px;margin:0 0 4px}.sub{color:#6E6551;font-size:13px;margin:0 0 10px}h2{font-family:Georgia,serif;font-weight:normal;font-size:18px;border-bottom:1.5px solid #8C6A28;color:#8C6A28;padding-bottom:5px;margin:30px 0 12px}.par{display:flex;gap:18px;flex-wrap:wrap}.col{flex:1;min-width:340px;max-width:520px}.tag{font-size:11px;font-weight:700;letter-spacing:.12em;padding:4px 10px;display:inline-block;border-radius:3px;margin-bottom:6px}.antes{background:#D8D2C4;color:#4A4438}.depois{background:#8C6A28;color:#fff}iframe{width:100%;height:700px;border:1px solid #C9C2B2;border-radius:8px;background:#0B0A08}.nota{background:#F7F5F0;border-left:3px solid #8C6A28;padding:10px 14px;font-size:13px;max-width:1080px}</style></head><body>
<h1>${titulo}</h1><p class="sub">${sub}</p><div class="nota">${nota}</div>
${secoes}
</body></html>`;
}

module.exports = { GO, cabeca, paragrafo, linha, cartaoDetalhes, cartaoNumero, botao, linkTexto, cartaoConta, passos, rodape, paginaAprovacao };
