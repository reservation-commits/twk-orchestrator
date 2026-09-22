'use strict';
/**
 * Tradução dos documentos da Biblioteca (HTML) pela Claude, com cache por conteúdo e verificação estrutural.
 *
 * Ordem de preferência para um documento em outro idioma:
 *   1. tradução manual em docs/agentes/<slug>.<idioma>.html (sempre vence);
 *   2. cache em docs/site/traducoes/<slug>.<idioma>.html, se o original não mudou (hash igual);
 *   3. chamada à API (ANTHROPIC_API_KEY no ambiente ou em ~/.twk/regencia.env), guardada no cache.
 *
 * Verificação antes de aceitar uma tradução automática: mesma sequência de tags HTML e os mesmos números
 * (dígitos) do original. Falhou → uma segunda tentativa com o motivo; falhou de novo → erro (falhar alto).
 * A API só é chamada quando o original mudou: rodar o montador de novo não custa nada.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const RAIZ = path.resolve(__dirname, '..', '..');
const CACHE = path.join(__dirname, 'traducoes');
const MODELO = process.env.TWK_MODELO_TRADUCAO || 'claude-opus-5';
const IDIOMAS = { fr: 'francês da França', pt: 'português do Brasil', en: 'inglês' };

(function env() {
  const f = process.env.TWK_REGENCIA_ENV || path.join(process.env.USERPROFILE || process.env.HOME || '', '.twk', 'regencia.env');
  try { for (const l of fs.readFileSync(f, 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim(); } } catch {}
})();

const hash = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);
const tags = (html) => (html.match(/<\/?[a-zA-Z][a-zA-Z0-9-]*/g) || []).map((t) => t.toLowerCase());
const numeros = (html) => (html
  .replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ')
  .match(/\d+(?:[.,\s  ]\d+)*/g) || []).map((n) => n.replace(/\D/g, '')).sort();

function verificar(origem, traduzido) {
  const erros = [];
  const t1 = tags(origem); const t2 = tags(traduzido);
  if (t1.length !== t2.length || t1.some((t, i) => t !== t2[i])) erros.push(`a estrutura de tags mudou (${t1.length} tags no original, ${t2.length} na tradução)`);
  if (numeros(origem).join(',') !== numeros(traduzido).join(',')) erros.push('os números não são os mesmos do original');
  if (!/<title>/i.test(traduzido)) erros.push('falta o <title>');
  return erros;
}

function sdk() {
  for (const c of [path.join(RAIZ, 'orchestrator', 'command-center', 'node_modules', '@anthropic-ai', 'sdk'), '@anthropic-ai/sdk']) {
    try { const m = require(c); return m.default || m.Anthropic || m; } catch {}
  }
  throw new Error('SDK @anthropic-ai/sdk não encontrado: rode npm install em orchestrator/command-center');
}

function instrucoes(para) {
  return [
    `Você é o tradutor da The World Keys, plataforma de reservas gastronômicas com sede em Paris. Traduza o documento HTML abaixo do português para ${IDIOMAS[para] || para}, em registro profissional, claro e natural, como um documento interno de empresa.`,
    'Regras, sem exceção:',
    '1. Preserve exatamente a estrutura HTML: as mesmas tags, na mesma ordem, com os mesmos atributos, classes e ids. CSS e scripts ficam intocados. Traduza apenas o texto visível a pessoas, inclusive <title>, alt, aria-label e data-tip.',
    '2. Nunca altere um dígito. Datas, códigos, valores e percentuais ficam com os mesmos números; pode adaptar só o separador de milhar ao idioma.',
    '3. Não traduza nomes próprios: The World Keys, nomes de restaurantes, nomes de sistemas (OpenTable, SevenRooms, TheFork, Tabelog, Resy, prenota-web, WhatsApp, LINE). Cidades vão na forma usual do idioma de destino.',
    '4. Textos que são exemplos de mensagem enviada a um restaurante ficam no idioma em que estão (são o que o cliente envia ao restaurante, na língua do restaurante).',
    '5. Termos fixos em francês: "Reserve direto com o estabelecimento" → "Réserver directement auprès de l\'établissement"; "fizemos o que vocês pediram: a nossa plataforma leva os clientes ao seu sistema" → "nous avons fait ce que vous demandiez : notre plateforme amène les clients vers votre système"; "conta de gerenciamento" → "compte de gestion"; "Biblioteca" → "Bibliothèque".',
    '6. Responda apenas com o HTML completo traduzido, do primeiro ao último caractere, sem cercas de código, sem comentários e sem explicações.',
  ].join('\n');
}

async function traduzirPelaApi(html, para, slug) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY ausente: defina no ambiente ou em ~/.twk/regencia.env');
  const Anthropic = sdk();
  const client = new Anthropic({ apiKey: key });
  const mensagens = [{ role: 'user', content: html }];
  let ultimoErro = [];
  for (let tentativa = 1; tentativa <= 2; tentativa++) {
    const stream = client.messages.stream({ model: MODELO, max_tokens: 32000, system: instrucoes(para), messages: mensagens });
    const msg = await stream.finalMessage();
    let texto = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
    texto = texto.replace(/^```(?:html)?\s*/i, '').replace(/\s*```$/, '');
    const erros = verificar(html, texto);
    const uso = msg.usage ? `${msg.usage.input_tokens} tokens de entrada, ${msg.usage.output_tokens} de saída` : '';
    if (!erros.length) return { html: texto, modelo: msg.model || MODELO, uso, tentativa };
    ultimoErro = erros;
    console.warn(`  tradução de ${slug} (${para}) reprovada na tentativa ${tentativa}: ${erros.join('; ')}`);
    mensagens.push({ role: 'assistant', content: texto }, { role: 'user', content: `A tradução foi reprovada: ${erros.join('; ')}. Refaça o documento completo respeitando as regras 1 e 2 à risca.` });
  }
  throw new Error(`tradução de ${slug} (${para}) reprovada duas vezes: ${ultimoErro.join('; ')}`);
}

/**
 * Devolve { html, fonte } com fonte ∈ manual | cache | api, ou null quando não há tradução e a API não pode ser usada.
 */
async function obterTraducao({ slug, fonteRelativa, origemHtml, para, permitirApi = true, forcar = false }) {
  const manual = path.join(RAIZ, path.dirname(fonteRelativa), `${path.basename(fonteRelativa, '.html')}.${para}.html`);
  if (fs.existsSync(manual)) {
    const html = fs.readFileSync(manual, 'utf8');
    const erros = verificar(origemHtml, html);
    if (erros.length) console.warn(`  aviso: tradução manual ${path.relative(RAIZ, manual)}: ${erros.join('; ')}`);
    return { html, fonte: 'manual' };
  }
  fs.mkdirSync(CACHE, { recursive: true });
  const arq = path.join(CACHE, `${slug}.${para}.html`);
  const meta = path.join(CACHE, `${slug}.${para}.json`);
  const h = hash(origemHtml);
  if (!forcar && fs.existsSync(arq) && fs.existsSync(meta)) {
    try { if (JSON.parse(fs.readFileSync(meta, 'utf8')).hash_origem === h) return { html: fs.readFileSync(arq, 'utf8'), fonte: 'cache' }; } catch {}
  }
  if (!permitirApi) return null;
  console.log(`  traduzindo ${slug} → ${para} (${MODELO})…`);
  const r = await traduzirPelaApi(origemHtml, para, slug);
  fs.writeFileSync(arq, r.html);
  fs.writeFileSync(meta, JSON.stringify({ hash_origem: h, modelo: r.modelo, data: new Date().toISOString(), uso: r.uso, tentativa: r.tentativa }, null, 2));
  console.log(`  ok: ${r.uso}`);
  return { html: r.html, fonte: 'api' };
}

module.exports = { obterTraducao, verificar, hash };
