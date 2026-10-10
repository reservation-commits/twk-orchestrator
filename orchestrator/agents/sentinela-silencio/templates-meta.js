'use strict';
/**
 * Sentinela — o que a Aria está configurada para enviar × o que a Meta tem aprovado.
 *
 * Em 05/10/2026 duas variáveis do Easypanel apontavam para templates que só existiam num idioma
 * (`twk_reservation_declined` só em francês, `avaliacao_experiencia_6h` só em inglês). Nada
 * acusava: nenhum cliente tinha opt-in, então nada era enviado — e no dia em que tivesse, a
 * recusa e a avaliação falhariam. Desde a v20 o `/health` da Aria mostra os nomes carregados;
 * aqui eles são comparados com a lista da Meta, antes do primeiro envio.
 *
 *   compararTemplates(health, listaMeta)  → { achados, lacunas, ok }   (pura; coberta pelo eval)
 *   conferirTemplatesMeta()               → lê o /health e a Meta e devolve o mesmo
 *
 * Somente leitura. Checagem que não rodou é LACUNA, nunca "ok".
 */
const fs = require('node:fs');
const path = require('node:path');

const ARIA_URL = (process.env.TWK_ARIA_URL || 'https://theworldkeys-aria-whatsapp-agent.xis4ee.easypanel.host').replace(/\/+$/, '');
const GRAPH = 'v21.0';

/** Chaves do /health que são de uso do operador, não de cliente ou casa: valem num idioma só. */
const SO_UM_IDIOMA = new Set(['alertaOperador']);

/**
 * @param health    corpo do /health da Aria (v20: `notificacoes.templates`, `notificacoes.idiomas`, `etapas`)
 * @param listaMeta [{ name, language, status, category }]
 */
function compararTemplates(health, listaMeta) {
  const achados = [];
  const lacunas = [];
  const ok = [];
  const n = health && health.notificacoes;
  if (!n || !n.templates) {
    lacunas.push(`templates × Meta: o /health da Aria (${(health && health.build) || 'build desconhecido'}) ainda não mostra os templates — suba a v20`);
    return { achados, lacunas, ok };
  }
  const idiomas = Array.isArray(n.idiomas) && n.idiomas.length ? n.idiomas : [n.idiomaPadrao || 'en'];
  const porNome = new Map();
  for (const t of listaMeta) {
    if (!porNome.has(t.name)) porNome.set(t.name, []);
    porNome.get(t.name).push(t);
  }

  let conferidos = 0;
  for (const [chave, nome] of Object.entries(n.templates)) {
    if (!nome) continue; // etapa desligada
    conferidos++;
    const naMeta = porNome.get(nome) || [];
    if (naMeta.length === 0) {
      achados.push({ chave: `silencio.wa_template.${chave}`, severidade: 'critica', titulo: `template "${nome}" (${chave}) não existe na Meta`, evidencia: `a Aria está configurada para enviar "${nome}" e a conta não tem template com esse nome`, acao_proposta: `corrigir a variável do Easypanel para o nome que existe (node orchestrator/agents/notificacao-reserva/meta-templates.mjs --list) e redeployar` });
      continue;
    }
    const aprovados = new Set(naMeta.filter((t) => t.status === 'APPROVED').map((t) => t.language));
    if (SO_UM_IDIOMA.has(chave)) {
      if (aprovados.size === 0) achados.push({ chave: `silencio.wa_template.${chave}`, severidade: 'alta', titulo: `template "${nome}" (${chave}) sem nenhum idioma aprovado`, evidencia: naMeta.map((t) => `${t.language}:${t.status}`).join(', '), acao_proposta: 'aguardar a aprovação da Meta ou corrigir o texto' });
      continue;
    }
    const faltam = idiomas.filter((l) => !aprovados.has(l));
    if (faltam.length) {
      achados.push({ chave: `silencio.wa_template.${chave}`, severidade: 'alta', titulo: `template "${nome}" (${chave}) não está aprovado em ${faltam.join(', ')}`, evidencia: `idiomas ligados na Aria: ${idiomas.join(', ')} · aprovados na Meta: ${[...aprovados].join(', ') || 'nenhum'}`, acao_proposta: `o envio nesses idiomas falha na Cloud API: trocar a variável para o template que tem os ${idiomas.length} idiomas, ou tirar o idioma de REMINDERS_LOCALES` });
    }
    const marketing = naMeta.filter((t) => t.status === 'APPROVED' && t.category === 'MARKETING' && idiomas.includes(t.language)).map((t) => t.language);
    if (marketing.length) lacunas.push(`template "${nome}" (${chave}) está como MARKETING em ${marketing.join(', ')} — a Meta limita e cobra diferente; não é falha de envio`);
  }
  if (health.etapas && health.etapas.alertaOperador === false) {
    achados.push({ chave: 'silencio.wa_alerta_operador_desligado', severidade: 'alta', titulo: 'alerta ao operador desligado na Aria', evidencia: '/health: etapas.alertaOperador = false', acao_proposta: 'definir OPERATOR_ALERT_WHATSAPP_TO e OPERATOR_ALERT_TEMPLATE no Easypanel — sem isso, uma nova queda do modelo só aparece no painel' });
  }
  if (Number(n.tetoDiario) === 0) lacunas.push('teto diário de envios está em 0 (sem teto) — RESERVATION_EVENTS_DAILY_CAP');
  if (conferidos && !achados.some((a) => a.chave.startsWith('silencio.wa_template.'))) ok.push(`templates × Meta: ${conferidos} template(s) configurados existem e estão aprovados em ${idiomas.join(', ')}`);
  return { achados, lacunas, ok };
}

function lerMetaEnv() {
  const f = path.join(process.env.USERPROFILE || process.env.HOME || '', '.twk', 'meta.env');
  const env = {};
  for (const l of fs.readFileSync(f, 'utf8').split(/\r?\n/)) { const m = l.match(/^([A-Z0-9_]+)=(.+)$/); if (m) env[m[1]] = m[2].trim(); }
  if (!env.META_WABA_ID || !env.META_TOKEN) throw new Error('META_WABA_ID ou META_TOKEN ausente em ~/.twk/meta.env');
  return env;
}

async function listarTemplatesMeta() {
  const env = lerMetaEnv();
  const todos = [];
  let url = `https://graph.facebook.com/${GRAPH}/${env.META_WABA_ID}/message_templates?fields=name,language,status,category&limit=200`;
  for (let pagina = 0; url && pagina < 20; pagina++) {
    const r = await fetch(url, { headers: { authorization: `Bearer ${env.META_TOKEN}` }, signal: AbortSignal.timeout(20_000) });
    const j = await r.json();
    if (!r.ok || j.error) throw new Error(`Meta respondeu ${r.status}: ${(j.error && j.error.message) || 'sem detalhe'}`);
    todos.push(...(j.data || []));
    url = (j.paging && j.paging.next) || null;
  }
  return todos;
}

async function conferirTemplatesMeta() {
  let health;
  try {
    const r = await fetch(`${ARIA_URL}/health`, { signal: AbortSignal.timeout(15_000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    health = await r.json();
  } catch (e) {
    return { achados: [{ chave: 'silencio.aria_health', severidade: 'critica', titulo: 'a Aria não respondeu ao /health', evidencia: String(e.message).slice(0, 120), acao_proposta: 'ver o serviço no Easypanel (logs, último deploy)' }], lacunas: [], ok: [] };
  }
  let lista;
  try { lista = await listarTemplatesMeta(); }
  catch (e) { return { achados: [], lacunas: [`templates × Meta: não consegui ler a Meta (${String(e.message).slice(0, 100)}) — checagem NÃO rodou`], ok: [] }; }
  return compararTemplates(health, lista);
}

module.exports = { compararTemplates, conferirTemplatesMeta };
