'use strict';
/**
 * Cliente mínimo da API da Anthropic para o Estúdio Viral. Uma função: chamar({ system, user, tools }) → texto.
 * - SDK oficial (@anthropic-ai/sdk), o mesmo da Central (brain.js). Localmente, cai para node_modules da Central.
 * - Modelo: ESTUDIO_MODEL (padrão claude-fable-5-1; família Fable vai pelo caminho beta com fallback do servidor), thinking
 *   adaptativo, effort ESTUDIO_EFFORT (padrão high).
 * - Ferramentas de servidor (web_search) podem parar em `pause_turn`: reenviamos até 4 vezes, como manda a doc.
 * - `refusal` vira erro (falhar alto), nunca pacote vazio.
 * - A chave só existe no ambiente (ANTHROPIC_API_KEY); nada aqui a lê, grava ou imprime.
 */
const path = require('node:path');

function carregarSdk() {
  try { return require('@anthropic-ai/sdk'); } catch { /* tenta a Central */ }
  try { return require(path.join(__dirname, '..', '..', 'command-center', 'node_modules', '@anthropic-ai', 'sdk')); } catch { return null; }
}

function criar(env = process.env, { sdk = carregarSdk(), clientImpl = null } = {}) {
  const disponivel = !!(env.ANTHROPIC_API_KEY && (clientImpl || sdk));
  // Padrão desde 19/11 (pedido do Márlon): Claude Fable 5.1. ESTUDIO_MODEL troca (ex.: claude-opus-5-5, mais barato).
  const modelo = String(env.ESTUDIO_MODEL || 'claude-fable-5-1');
  // Família Fable/Mythos: caminho beta com fallback do lado do servidor (como o cérebro do MAESTRO faz); thinking sempre ligado.
  const familiaFable = /^claude-(fable|mythos)-/.test(modelo);
  const effort = String(env.ESTUDIO_EFFORT || 'high');
  let client = clientImpl;

  /** `user`: texto ou lista de blocos (imagem + texto, para a visão). `effort`: sobrepõe o padrão nas ferramentas rápidas do painel. */
  async function chamar({ system, user, tools = null, maxTokens = 16000, continuacoes = 4, effort: esforco = null, historico = [] }) {
    if (!disponivel) throw new Error('ANTHROPIC_API_KEY ausente: o Estúdio não consegue chamar o modelo');
    if (!client) client = new sdk({ apiKey: env.ANTHROPIC_API_KEY });
    const messages = [...historico, { role: 'user', content: user }];
    const base = { model: modelo, max_tokens: maxTokens, thinking: { type: 'adaptive' }, output_config: { effort: esforco || effort }, system: `${system}\n\n${REGRA_JSON}`, ...(tools ? { tools } : {}) };
    const criarMsg = (params) => (familiaFable ? client.beta.messages.create({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }) : client.messages.create(params));
    let r = await criarMsg({ ...base, messages });
    let voltas = 0;
    while (r.stop_reason === 'pause_turn' && voltas < continuacoes) { // a API retoma sozinha ao ver o server_tool_use pendente
      voltas += 1;
      r = await criarMsg({ ...base, messages: [...messages, { role: 'assistant', content: r.content }] });
    }
    if (r.stop_reason === 'refusal') throw new Error(`modelo recusou (${(r.stop_details && r.stop_details.category) || 'sem categoria'})`);
    const texto = (r.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
    if (!texto) throw new Error(`resposta vazia do modelo (stop_reason ${r.stop_reason})`);
    const buscas = (r.content || []).filter((b) => b.type === 'server_tool_use').length;
    return { texto, modelo: r.model, stop_reason: r.stop_reason, buscas, usage: { input: r.usage && r.usage.input_tokens, output: r.usage && r.usage.output_tokens } };
  }

  const self = { disponivel, modelo, effort, chamar };
  self.chamarJson = (opts, extra) => chamarJsonCom(self, opts, extra);
  return self;
}

/**
 * chamar() + extrairJson(), com UMA nova tentativa se o JSON vier inválido (19/11: a primeira rodada real caiu num
 * guillemet não escapado no meio de um texto). A segunda chamada recebe a resposta anterior e o erro, e pede só o JSON.
 * Funciona sobre qualquer objeto com chamar() (o cliente real ou um simulado). `aoFalhar(texto, erro)` recebe a resposta
 * inválida, para quem quiser guardá-la (nunca contém dado de cliente).
 */
async function chamarJsonCom(llm, opts, { aoFalhar = null } = {}) {
  let r = await llm.chamar(opts);
  try { return { ...r, json: extrairJson(r.texto) }; }
  catch (e1) {
    if (aoFalhar) { try { aoFalhar(r.texto, e1); } catch { /* diagnóstico é opcional */ } }
    const historico = [{ role: 'user', content: opts.user }, { role: 'assistant', content: r.texto }];
    const user = `Ta réponse précédente n'est pas un JSON valide (${String(e1.message).slice(0, 160)}). Renvoie exactement le même contenu, corrigé, en JSON strict : ${REGRA_JSON} Rien d'autre que l'objet JSON.`;
    const r2 = await llm.chamar({ ...opts, tools: null, historico, user });
    try { return { ...r2, json: extrairJson(r2.texto), tentativas: 2, buscas: r.buscas }; }
    catch (e2) { if (aoFalhar) { try { aoFalhar(r2.texto, e2); } catch { /* idem */ } } throw new Error(`o modelo não devolveu JSON válido em duas tentativas (${e2.message})`); }
  }
}

/** Vai no fim de todo system prompt: como escrever JSON que o parser aceita (o francês é cheio de guillemets e apóstrofos). */
const REGRA_JSON = 'FORMAT JSON : les guillemets droits " ne servent QUE de délimiteurs ; à l\'intérieur des textes, utilise « », ’ ou \\" ; aucun retour à la ligne brut dans une chaîne (écris \\n) ; aucune virgule après le dernier élément ; aucun commentaire ; pas de ``` autour.';

/** Pega o primeiro objeto JSON de um texto (o modelo às vezes embrulha em ```json). Lança se não houver ou se não parsear. */
function extrairJson(texto) {
  const t = String(texto || '').replace(/^```(?:json)?\s*/im, '').replace(/```\s*$/m, '');
  const i = t.indexOf('{'); const f = t.lastIndexOf('}');
  if (i < 0 || f <= i) throw new Error('nenhum JSON na resposta do modelo');
  const bruto = t.slice(i, f + 1);
  try { return JSON.parse(bruto); }
  catch (e) {
    // conserto barato e sem risco: vírgula sobrando antes de } ou ]
    try { return JSON.parse(bruto.replace(/,\s*([}\]])/g, '$1')); } catch { throw e; }
  }
}

module.exports = { criar, extrairJson, chamarJsonCom, carregarSdk, REGRA_JSON };
