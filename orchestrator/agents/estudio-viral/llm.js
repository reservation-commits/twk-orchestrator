'use strict';
/**
 * Cliente mínimo da API da Anthropic para o Estúdio Viral. Uma função: chamar({ system, user, tools }) → texto.
 * - SDK oficial (@anthropic-ai/sdk), o mesmo da Central (brain.js). Localmente, cai para node_modules da Central.
 * - Modelo: ESTUDIO_MODEL (padrão claude-opus-5-5), thinking adaptativo, effort ESTUDIO_EFFORT (padrão high).
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
  const modelo = String(env.ESTUDIO_MODEL || 'claude-opus-5-5');
  const effort = String(env.ESTUDIO_EFFORT || 'high');
  let client = clientImpl;

  async function chamar({ system, user, tools = null, maxTokens = 16000, continuacoes = 4 }) {
    if (!disponivel) throw new Error('ANTHROPIC_API_KEY ausente: o Estúdio não consegue chamar o modelo');
    if (!client) client = new sdk({ apiKey: env.ANTHROPIC_API_KEY });
    const messages = [{ role: 'user', content: user }];
    const base = { model: modelo, max_tokens: maxTokens, thinking: { type: 'adaptive' }, output_config: { effort }, system, ...(tools ? { tools } : {}) };
    let r = await client.messages.create({ ...base, messages });
    let voltas = 0;
    while (r.stop_reason === 'pause_turn' && voltas < continuacoes) { // a API retoma sozinha ao ver o server_tool_use pendente
      voltas += 1;
      r = await client.messages.create({ ...base, messages: [...messages, { role: 'assistant', content: r.content }] });
    }
    if (r.stop_reason === 'refusal') throw new Error(`modelo recusou (${(r.stop_details && r.stop_details.category) || 'sem categoria'})`);
    const texto = (r.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
    if (!texto) throw new Error(`resposta vazia do modelo (stop_reason ${r.stop_reason})`);
    const buscas = (r.content || []).filter((b) => b.type === 'server_tool_use').length;
    return { texto, modelo: r.model, stop_reason: r.stop_reason, buscas, usage: { input: r.usage && r.usage.input_tokens, output: r.usage && r.usage.output_tokens } };
  }

  return { disponivel, modelo, effort, chamar };
}

/** Pega o primeiro objeto JSON de um texto (o modelo às vezes embrulha em ```json). Lança se não houver. */
function extrairJson(texto) {
  const t = String(texto || '').replace(/^```(?:json)?\s*/im, '').replace(/```\s*$/m, '');
  const i = t.indexOf('{'); const f = t.lastIndexOf('}');
  if (i < 0 || f <= i) throw new Error('nenhum JSON na resposta do modelo');
  return JSON.parse(t.slice(i, f + 1));
}

module.exports = { criar, extrairJson, carregarSdk };
