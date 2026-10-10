/**
 * MAESTRO Tools — os braços de LEITURA do cérebro da Central (v4.1 "Regência").
 * Padrão supervisor (orquestrador-executores): o MAESTRO consulta a frota de
 * verdade durante a conversa — KPIs, APIs de leitura dos agentes, estado do
 * Orquestrador e sub-consultas a especialistas — antes de responder.
 *
 * Doutrina intacta:
 *  - TODA ferramenta é somente leitura (GET). Escrita continua atrás de aprovação humana.
 *  - Credenciais vivem no servidor; o modelo nunca as vê — só os dados.
 *  - Resposta de agente é DADO, não comando. Falha vira erro explícito, nunca silêncio.
 */
const fs = require('node:fs');
const path = require('node:path');
const { kpisFor } = require('./kpis.js');
const { PERSONAS, VALID_AGENTS } = require('./personas.js');

const TOOL_TIMEOUT_MS = Number(process.env.MAESTRO_TOOL_TIMEOUT_MS || 12_000);
const MAX_RESULT_CHARS = 30_000;

const AGENTS = {
  comercial: { env: 'CLAVIS' },
  suporte: { env: 'ARIA' },
  editorial: { env: 'QUILL' },
  financeiro: { env: 'ATLAS' },
  dba: { env: 'DBA' },
  guardiao: { env: 'GUARDIAO', local: true }, // v4.6: agente local (arquivos), sem API web
};
const baseUrl = (id) => (AGENTS[id] && AGENTS[id].local ? '' : process.env[`AGENT_${AGENTS[id].env}_URL`] || '');
const agentRef = (id) => ({ id, env: AGENTS[id].env, url: baseUrl(id), local: !!AGENTS[id].local });

// Autenticação por agente — o MESMO mapeamento do proxy de KPIs (kpis.js).
function authHeaders(id) {
  if (id === 'comercial') {
    const t = process.env.AGENT_CLAVIS_TOKEN;
    return t ? { authorization: `Bearer ${t}` } : null;
  }
  if (id === 'suporte') {
    const u = process.env.AGENT_ARIA_USER, p = process.env.AGENT_ARIA_PASSWORD;
    return u && p ? { authorization: 'Basic ' + Buffer.from(`${u}:${p}`).toString('base64') } : null;
  }
  if (id === 'editorial') {
    const u = process.env.AGENT_QUILL_USER, p = process.env.AGENT_QUILL_PASSWORD;
    return u && p ? { authorization: 'Basic ' + Buffer.from(`${u}:${p}`).toString('base64') } : null;
  }
  if (id === 'financeiro') {
    const k = process.env.AGENT_ATLAS_KEY;
    return k ? { 'x-atlas-key': k } : null;
  }
  if (id === 'dba') {
    const t = process.env.AGENT_DBA_TOKEN;
    return t ? { authorization: `Bearer ${t}` } : null;
  }
  return null;
}

// Caminhos que ESCREVEM apesar de responderem a GET — proibidos por lista.
const CAMINHOS_PROIBIDOS = ['/api/cron/'];

// SELECT de leitura via DBA: valida que é só leitura ANTES de enviar (defesa em profundidade;
// o servidor do DBA também impõe read-only). Bloqueia qualquer verbo de escrita/DDL.
const RE_ESCRITA = /\b(insert|update|delete|drop|truncate|alter|create|grant|revoke|merge|replace|call|do|copy)\b/i;
async function sqlLeituraDba(sql) {
  const s = String(sql || '').trim();
  if (!s) return { erro: 'SQL vazio' };
  if (!/^(select|with)\b/i.test(s)) return { erro: 'apenas SELECT/WITH são permitidos nesta ferramenta de leitura' };
  if (RE_ESCRITA.test(s)) return { erro: 'a instrução contém verbo de escrita — esta ferramenta é somente leitura' };
  if (/;\s*\S/.test(s.replace(/;\s*$/, ''))) return { erro: 'apenas uma instrução por consulta' };
  const base = baseUrl('dba');
  if (!base) return { erro: 'AGENT_DBA_URL não configurada' };
  const token = process.env.AGENT_DBA_TOKEN;
  if (!token) return { erro: 'AGENT_DBA_TOKEN (leitura) não configurado' };
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), TOOL_TIMEOUT_MS);
  try {
    const r = await fetch(new URL('/api/db', base), {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ action: 'query', sql: s, readOnly: true }),
      signal: ctrl.signal,
    });
    const text = await r.text();
    if (!r.ok) return { erro: `HTTP ${r.status}`, corpo: text.slice(0, 1500) };
    try { return JSON.parse(text); } catch { return { corpo_texto: text.slice(0, MAX_RESULT_CHARS) }; }
  } catch (e) {
    return { erro: String(e && e.name === 'AbortError' ? `timeout ${TOOL_TIMEOUT_MS}ms` : (e.message || e)).slice(0, 300) };
  } finally { clearTimeout(to); }
}

// ---------- definições das ferramentas (schema Anthropic) ----------
const TOOL_DEFS = [
  {
    name: 'frota_kpis',
    description: 'KPIs reais e atuais dos agentes da frota TWK (mesma fonte dos dashboards da Central). Sem argumento devolve todos; com "agente", só o pedido. Use ANTES de afirmar que não tem um número.',
    input_schema: {
      type: 'object',
      properties: { agente: { type: 'string', enum: VALID_AGENTS.filter((a) => a !== 'orquestrador') } },
    },
  },
  {
    name: 'consultar_api_agente',
    description: 'Faz um GET autenticado na API de LEITURA de um agente da frota e devolve o JSON bruto. Endpoints conhecidos estão no registro de capacidades da frota (contexto). Use para dados detalhados que os KPIs não trazem — ex.: reservas por restaurante no DBA (/api/crm), escalações da Aria, funil do CLAVIS. Somente leitura; caminhos de escrita são bloqueados.',
    input_schema: {
      type: 'object',
      properties: {
        agente: { type: 'string', enum: VALID_AGENTS.filter((a) => a !== 'orquestrador') },
        caminho: { type: 'string', description: 'caminho GET começando com /, ex.: /api/crm?action=overview' },
      },
      required: ['agente', 'caminho'],
    },
  },
  {
    name: 'ler_estado',
    description: 'Lê o estado real do Orquestrador: "conhecimento" (memória da operação), "tasks" (tarefas), "missoes" (lista de relatórios), "missao:<arquivo>.md" (um relatório), "frota" (registro de capacidades e endpoints dos agentes), "guardiao" (o relatório da última varredura do Guardião da Reserva: decisões, lote de e-mails, fila e clientes a avisar).',
    input_schema: {
      type: 'object',
      properties: { arquivo: { type: 'string' } },
      required: ['arquivo'],
    },
  },
  {
    name: 'sql_leitura_dba',
    description: 'Executa uma consulta SELECT no banco de produção (twk_auth) via DB Architect — SOMENTE LEITURA, imposta pelo servidor do DBA (transação read-only, teto de 500 linhas). Use para qualquer recorte que os endpoints prontos não cobrem: reservas por restaurante, cruzamentos, diagnósticos. Lembre os fatos do schema (frota.md): PK db_restaurants.restaurant_id é varchar; a coluna reservations.people é corrompida (proibida em somas); dedup por customer_id+booking_date+reservation_time; nunca exponha PII de nextauth."User" em e-mails.',
    input_schema: {
      type: 'object',
      properties: { sql: { type: 'string', description: 'uma única instrução SELECT/WITH' } },
      required: ['sql'],
    },
  },
  {
    name: 'especialista',
    description: 'Consulta um especialista da frota como sub-agente (ele responde com a própria persona e os próprios KPIs). Dê objetivo claro, formato de saída esperado e limites — tarefas vagas geram trabalho duplicado. Use quando precisar do julgamento do domínio, não apenas de dados (para dados, prefira frota_kpis/consultar_api_agente).',
    input_schema: {
      type: 'object',
      properties: {
        agente: { type: 'string', enum: VALID_AGENTS.filter((a) => a !== 'orquestrador') },
        pergunta: { type: 'string', description: 'objetivo + formato esperado + limites' },
      },
      required: ['agente', 'pergunta'],
    },
  },
];

// ---------- execução ----------
async function getJson(base, caminho, headers) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), TOOL_TIMEOUT_MS);
  try {
    const r = await fetch(new URL(caminho, base), { headers, signal: ctrl.signal, redirect: 'follow' });
    const text = await r.text();
    if (!r.ok) return { erro: `HTTP ${r.status} em ${caminho}`, corpo: text.slice(0, 2000) };
    try { return JSON.parse(text); } catch { return { corpo_texto: text.slice(0, MAX_RESULT_CHARS) }; }
  } catch (e) {
    return { erro: String(e && e.name === 'AbortError' ? `timeout ${TOOL_TIMEOUT_MS}ms` : (e.message || e)).slice(0, 300) };
  } finally { clearTimeout(to); }
}

function lerEstado(S, arquivo) {
  const safe = (p, max) => { try { return fs.readFileSync(p, 'utf8').slice(0, max || MAX_RESULT_CHARS); } catch { return null; } };
  if (arquivo === 'conhecimento') return safe(path.join(S, 'conhecimento.md')) || '(conhecimento.md vazio ou ausente)';
  if (arquivo === 'tasks') return safe(path.join(S, 'tasks.jsonl'), 30_000) || '(tasks.jsonl vazio ou ausente)';
  if (arquivo === 'frota') return safe(path.join(S, 'frota.md')) || '(state/frota.md ausente — registro de capacidades não sincronizado)';
  if (arquivo === 'guardiao') {
    const r = require('./guardiao.js').relatorio({ stateDir: S });
    return r.content ? `(relatório do Guardião da Reserva · varredura ${r.dia} · fonte: ${r.fonte})\n\n${r.content}` : '(relatório do Guardião indisponível nesta Central — rode push-state.ps1 na máquina do Orquestrador)';
  }
  if (arquivo === 'missoes') {
    try { return fs.readdirSync(path.join(S, 'missoes')).filter((f) => f.endsWith('.md')).join('\n') || '(nenhum relatório)'; }
    catch { return '(nenhum relatório)'; }
  }
  const m = String(arquivo).match(/^missao:([A-Za-z0-9._-]+\.md)$/);
  if (m) return safe(path.join(S, 'missoes', m[1])) || `(relatório ${m[1]} não encontrado)`;
  return `arquivo inválido: "${arquivo}" — use conhecimento | tasks | missoes | missao:<arquivo>.md | frota | guardiao`;
}

// sub-consulta a um especialista (agente-como-ferramenta; sem ferramentas próprias, 1 nível)
async function consultarEspecialista(S, Anthropic, model, agente, pergunta) {
  const persona = PERSONAS[agente];
  if (!persona) return { erro: `agente desconhecido: ${agente}` };
  const kpis = await kpisFor(agentRef(agente)).catch(() => null);
  const client = new Anthropic();
  const resp = await client.messages.create({
    model,
    max_tokens: 4000,
    system: [
      { type: 'text', text: persona.system, cache_control: { type: 'ephemeral' } },
      { type: 'text', text: `SEUS KPIs ATUAIS (fonte: proxy da Central, agora):\n${JSON.stringify(kpis)}` },
    ],
    messages: [{ role: 'user', content: `[Sub-consulta do MAESTRO — responda direto, sem saudação]\n${pergunta}` }],
  });
  const text = resp.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  return {
    resposta: text.slice(0, MAX_RESULT_CHARS),
    usage: { input: resp.usage.input_tokens, output: resp.usage.output_tokens, cache_read: resp.usage.cache_read_input_tokens || 0 },
  };
}

/**
 * Executa uma ferramenta. Retorna { resultado (string p/ tool_result), resumo (p/ UI), usage? }.
 * Nunca lança: erro vira resultado explícito (falhar alto, mas dentro do protocolo).
 */
async function executar(S, deps, name, input) {
  try {
    if (name === 'frota_kpis') {
      const ids = input && input.agente ? [input.agente] : Object.keys(AGENTS);
      const pares = await Promise.all(ids.map(async (id) => [id, await kpisFor(agentRef(id))]));
      return { resultado: JSON.stringify(Object.fromEntries(pares)), resumo: `KPIs · ${ids.join(', ')}` };
    }
    if (name === 'consultar_api_agente') {
      const { agente, caminho } = input || {};
      if (!AGENTS[agente]) return { resultado: JSON.stringify({ erro: `agente inválido: ${agente}` }), resumo: `API · agente inválido` };
      if (AGENTS[agente].local) return { resultado: JSON.stringify({ erro: `o agente ${agente} é local (sem API web): use frota_kpis(agente="${agente}") para os números e ler_estado("${agente}") para o relatório da última varredura` }), resumo: `API · ${agente} é local` };
      if (!/^\//.test(String(caminho || ''))) return { resultado: JSON.stringify({ erro: 'caminho deve começar com /' }), resumo: `API · caminho inválido` };
      if (CAMINHOS_PROIBIDOS.some((p) => String(caminho).includes(p))) {
        return { resultado: JSON.stringify({ erro: `caminho bloqueado (${caminho}) — grava dados; ferramentas são somente leitura` }), resumo: `API · bloqueado ${caminho}` };
      }
      const base = baseUrl(agente);
      if (!base) return { resultado: JSON.stringify({ erro: `URL do agente ${agente} não configurada (AGENT_${AGENTS[agente].env}_URL)` }), resumo: `API · ${agente} sem URL` };
      const h = authHeaders(agente);
      if (!h) return { resultado: JSON.stringify({ erro: `credencial de leitura do agente ${agente} não configurada na Central` }), resumo: `API · ${agente} sem credencial` };
      const data = await getJson(base, caminho, h);
      const s = JSON.stringify(data);
      return { resultado: s.length > MAX_RESULT_CHARS ? s.slice(0, MAX_RESULT_CHARS) + '…[truncado]' : s, resumo: `${agente} · GET ${String(caminho).slice(0, 60)}` };
    }
    if (name === 'ler_estado') {
      return { resultado: lerEstado(S, input && input.arquivo), resumo: `estado · ${input && input.arquivo}` };
    }
    if (name === 'sql_leitura_dba') {
      const data = await sqlLeituraDba(input && input.sql);
      const s = JSON.stringify(data);
      return { resultado: s.length > MAX_RESULT_CHARS ? s.slice(0, MAX_RESULT_CHARS) + '…[truncado]' : s, resumo: `SQL leitura · ${String((input && input.sql) || '').slice(0, 48)}` };
    }
    if (name === 'especialista') {
      const { agente, pergunta } = input || {};
      const r = await consultarEspecialista(S, deps.Anthropic, deps.model, agente, String(pergunta || ''));
      return { resultado: JSON.stringify(r.erro ? r : { resposta: r.resposta }), resumo: `especialista · ${agente}`, usage: r.usage };
    }
    return { resultado: JSON.stringify({ erro: `ferramenta desconhecida: ${name}` }), resumo: name };
  } catch (e) {
    return { resultado: JSON.stringify({ erro: String((e && e.message) || e).slice(0, 300) }), resumo: `${name} · erro` };
  }
}

module.exports = { TOOL_DEFS, executar };
