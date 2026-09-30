#!/usr/bin/env node
/**
 * meta-templates.mjs — cria, edita e confere os templates de WhatsApp na conta da TWK pela
 * API de gerenciamento da Meta, a partir do documento aprovado pelo fundador:
 *   docs/notificacoes/templates-meta-v2-2026-09-30.md  (fonte única de verdade; v1 = templates-meta-2026-09-25.md)
 *
 *   node orchestrator/agents/notificacao-reserva/meta-templates.mjs            # dry-run: valida e mostra o que criaria/editaria
 *   node .../meta-templates.mjs --list                                          # o que já existe na conta (nome, idioma, status)
 *   node .../meta-templates.mjs --apply [--only nome] [--lang en,pt_BR]         # cria o que falta
 *   node .../meta-templates.mjs --apply --edit                                  # v2: EDITA os que já existem (mesmo nome+idioma)
 *   node .../meta-templates.mjs --status                                        # status atual dos templates do documento
 *   --categoria MARKETING   quando a Meta já prendeu o nome nessa categoria (ex.: convite de avaliação)
 *   --doc <caminho>         outro documento (ex.: o v1)
 *
 * Segredos em ~/.twk/meta.env (FORA do OneDrive, nunca no chat):
 *   META_WABA_ID=<ID da conta do WhatsApp Business>
 *   META_TOKEN=<token de usuário do sistema com whatsapp_business_management>
 *
 * Formato do documento (v2): sob cada `**idioma**`, uma linha opcional `Cabeçalho: …` e o corpo
 * em bloco de citação (`> …`, várias linhas; `>` vazio = linha em branco).
 *
 * Regras: nunca apaga; só edita com --edit explícito (a Meta permite 1 edição/dia e 10/mês por
 * template aprovado, e devolve o template à revisão); o de reagendamento só entra com
 * --incluir-reagendamento; todo resultado vai para orchestrator/logs/meta-templates-<data>.jsonl (sem token).
 */
import { readFileSync, appendFileSync, mkdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const GRAPH = process.env.WHATSAPP_GRAPH_VERSION || "v21.0";
const IDIOMAS = ["en", "pt_BR", "fr", "es", "it", "de"];
const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const opt = (f) => (args.includes(f) ? args[args.indexOf(f) + 1] : null);
const DOC = opt("--doc") ? path.resolve(opt("--doc")) : path.join(RAIZ, "docs/notificacoes/templates-meta-v2-2026-09-30.md");

// Amostras por idioma (a Meta exige exemplo para cada variável). Data como a Aria v15 formata (dia da semana + mês por extenso).
const AMOSTRA = {
  en: { nome: "Anna", casa: "Le Tobsil", data: "Saturday, 3 October 2026", hora: "8:00 PM", pessoas: "2", cliente: "Anna Lee" },
  pt_BR: { nome: "Anna", casa: "Le Tobsil", data: "Sábado, 3 de outubro de 2026", hora: "20:00", pessoas: "2", cliente: "Anna Lee" },
  fr: { nome: "Anna", casa: "Le Tobsil", data: "Samedi 3 octobre 2026", hora: "20:00", pessoas: "2", cliente: "Anna Lee" },
  es: { nome: "Anna", casa: "Le Tobsil", data: "Sábado, 3 de octubre de 2026", hora: "20:00", pessoas: "2", cliente: "Anna Lee" },
  it: { nome: "Anna", casa: "Le Tobsil", data: "Sabato 3 ottobre 2026", hora: "20:00", pessoas: "2", cliente: "Anna Lee" },
  de: { nome: "Anna", casa: "Le Tobsil", data: "Samstag, 3. Oktober 2026", hora: "20:00", pessoas: "2", cliente: "Anna Lee" },
};
// Ordem das variáveis por template (contrato com o código da Aria).
const VARIAVEIS = {
  twk_reservation_received: ["nome", "casa", "data", "hora", "pessoas"],
  twk_reservation_accepted: ["nome", "casa", "data", "hora", "pessoas"],
  twk_reservation_declined: ["nome", "casa", "data"],
  twk_reservation_declined_v2: ["nome", "casa", "data"],
  twk_reservation_cancelled: ["nome", "casa", "data"],
  twk_reschedule_proposed: ["nome", "casa", "data", "hora"],
  lembrete_reserva_2h: ["nome", "casa", "hora"],
  twk_reminder_2h: ["nome", "casa", "hora"],
  twk_eve_briefing: ["nome", "casa", "data", "hora", "pessoas"],
  avaliacao_experiencia_6h: ["nome", "casa"],
  twk_review_invite: ["nome", "casa"],
  twk_venue_new_request: ["casa", "data", "hora", "pessoas", "cliente"],
  twk_venue_cancelled: ["casa", "data", "hora", "pessoas", "cliente"],
  twk_venue_eve_briefing: ["casa", "data", "hora", "pessoas", "cliente"],
};
const BOTAO_URL = { twk_venue_new_request: { url: "https://theworldkeys.com/r/{{1}}", exemplo: "https://theworldkeys.com/r/6DSPZXQ7" } };

// ─── Parser do documento ──────────────────────────────────────────────────────
export function lerDocumento(md) {
  const linhas = md.split(/\r?\n/);
  const rodape = {};
  for (const l of linhas) {
    // Só linhas de DUAS colunas (idioma | rodapé): a tabela de rótulos do v2 também começa pelo idioma.
    const m = l.match(/^\| (en|pt_BR|fr|es|it|de) \| ([^|]+?) \|$/);
    if (m && !rodape[m[1]]) rodape[m[1]] = m[2].trim();
  }
  const templates = [];
  let atual = null, idioma = null, bloco = null;
  // Corpo em bloco de citação: várias linhas `> …`; `>` sozinho = linha em branco. Fecha no primeiro
  // não-`>` (compatível com o v1, que tinha uma linha só).
  const fecharBloco = () => {
    if (atual && idioma && bloco) atual.corpos[idioma] = bloco.join("\n").replace(/\n{3,}/g, "\n\n").trim();
    if (bloco) idioma = null;
    bloco = null;
  };
  for (let i = 0; i < linhas.length; i++) {
    const l = linhas[i];
    if (l.startsWith(">")) {
      if (atual && idioma) (bloco ??= []).push(l.replace(/^>\s?/, "").trimEnd());
      continue;
    }
    fecharBloco();
    const h = l.match(/^## \d+\. `([a-z0-9_]+)`/);
    if (h) { atual = { nome: h[1], corpos: {}, cabecalhos: {}, botao: null }; templates.push(atual); idioma = null; continue; }
    if (!atual) continue;
    const b = l.match(/^Botão: .*Texto do botão por idioma: (.+)$/);
    if (b) {
      atual.botao = {};
      for (const m of b[1].matchAll(/(en|pt_BR|fr|es|it|de) "([^"]+)"/g)) atual.botao[m[1]] = m[2];
      continue;
    }
    const li = l.match(/^\*\*(en|pt_BR|fr|es|it|de)\*\*/);
    if (li) { idioma = li[1]; continue; }
    const cab = l.match(/^Cabeçalho:\s*(.+)$/);
    if (cab && idioma) { atual.cabecalhos[idioma] = cab[1].trim(); continue; }
  }
  fecharBloco();
  return { rodape, templates };
}

export function validar(t, idioma, corpo, rodape) {
  const erros = [];
  const vars = [...corpo.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
  const esperadas = (VARIAVEIS[t.nome] || []).length;
  const distintas = [...new Set(vars)].sort((a, b) => a - b);
  if (!esperadas) erros.push("template fora do contrato (VARIAVEIS)");
  if (distintas.length !== esperadas || distintas.some((v, i) => v !== i + 1)) erros.push(`variáveis ${JSON.stringify(distintas)} ≠ esperado 1..${esperadas}`);
  if (corpo.length > 1024) erros.push(`corpo com ${corpo.length} caracteres (máx. 1024)`);
  if (/\n{3,}/.test(corpo) || /^\s|\s$/.test(corpo)) erros.push("corpo com linhas em branco seguidas ou espaço nas pontas");
  if (/\t|[ ]{5,}/.test(corpo)) erros.push("corpo com tabulação ou 5+ espaços seguidos (a Meta recusa)");
  const cab = t.cabecalhos?.[idioma];
  if (cab !== undefined) {
    if (!cab) erros.push("cabeçalho vazio");
    else if (cab.length > 60) erros.push(`cabeçalho com ${cab.length} caracteres (máx. 60)`);
    else if (/\{\{|\*|_|~|\n/.test(cab)) erros.push("cabeçalho com variável, formatação ou quebra de linha (a Meta recusa)");
  }
  if (!rodape) erros.push("sem rodapé para o idioma");
  else if (rodape.length > 60) erros.push(`rodapé com ${rodape.length} caracteres (máx. 60)`);
  if (/^\{\{\d+\}\}/.test(corpo) || /\{\{\d+\}\}[.!?]?$/.test(corpo)) erros.push("aviso: corpo começa ou termina com variável (a Meta pode recusar)");
  if (t.botao && !t.botao[idioma]) erros.push("sem texto do botão para o idioma");
  if (t.botao && t.botao[idioma] && t.botao[idioma].length > 25) erros.push("texto do botão > 25 caracteres");
  return erros;
}

export function montarPayload(t, idioma, corpo, rodape, categoria = "UTILITY") {
  const a = AMOSTRA[idioma];
  const exemplo = (VARIAVEIS[t.nome] || []).map((k) => a[k]);
  const cab = t.cabecalhos?.[idioma];
  const components = [
    ...(cab ? [{ type: "HEADER", format: "TEXT", text: cab }] : []),
    { type: "BODY", text: corpo, example: { body_text: [exemplo] } },
    { type: "FOOTER", text: rodape },
  ];
  if (t.botao && BOTAO_URL[t.nome]) {
    components.push({ type: "BUTTONS", buttons: [{ type: "URL", text: t.botao[idioma], url: BOTAO_URL[t.nome].url, example: [BOTAO_URL[t.nome].exemplo] }] });
  }
  return { name: t.nome, language: idioma, category: categoria, allow_category_change: false, components };
}

// ─── Meta ─────────────────────────────────────────────────────────────────────
function segredos() {
  const f = path.join(homedir(), ".twk", "meta.env");
  if (!existsSync(f)) throw new Error(`falta ${f} com META_WABA_ID e META_TOKEN (fora do OneDrive; nunca no chat)`);
  const env = Object.fromEntries(readFileSync(f, "utf8").split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")]));
  if (!env.META_WABA_ID || !env.META_TOKEN) throw new Error("META_WABA_ID ou META_TOKEN vazio em ~/.twk/meta.env");
  return env;
}
async function graph(env, metodo, caminho, body) {
  const r = await fetch(`https://graph.facebook.com/${GRAPH}/${caminho}`, {
    method: metodo,
    headers: { authorization: `Bearer ${env.META_TOKEN}`, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${r.status} ${j?.error?.message || ""} ${j?.error?.error_user_msg || ""} (code ${j?.error?.code ?? "?"}, sub ${j?.error?.error_subcode ?? "?"})`.trim());
  return j;
}
async function listar(env) {
  const out = [];
  let url = `${env.META_WABA_ID}/message_templates?fields=id,name,language,status,category,rejected_reason,quality_score&limit=200`;
  while (url) {
    const j = await graph(env, "GET", url);
    out.push(...(j.data || []));
    url = j.paging?.next ? j.paging.next.replace(`https://graph.facebook.com/${GRAPH}/`, "") : null;
  }
  return out;
}
function registrar(evento) {
  const dir = path.join(RAIZ, "orchestrator/logs");
  mkdirSync(dir, { recursive: true });
  appendFileSync(path.join(dir, `meta-templates-${new Date().toISOString().slice(0, 10)}.jsonl`), JSON.stringify({ at: new Date().toISOString(), ...evento }) + "\n");
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const { rodape, templates } = lerDocumento(readFileSync(DOC, "utf8"));
  const only = opt("--only");
  const langs = opt("--lang") ? opt("--lang").split(",").map((s) => s.trim()) : IDIOMAS;
  const incluirReag = flag("--incluir-reagendamento");

  if (flag("--list") || flag("--status")) {
    const env = segredos();
    const lista = await listar(env);
    const nomesDoc = new Set(templates.map((t) => t.nome));
    const filtrada = flag("--status") ? lista.filter((x) => nomesDoc.has(x.name)) : lista;
    console.table(filtrada.map((x) => ({ nome: x.name, idioma: x.language, status: x.status, categoria: x.category, motivo: x.rejected_reason && x.rejected_reason !== "NONE" ? x.rejected_reason : "", qualidade: x.quality_score?.score ?? "" })));
    if (flag("--status")) {
      const faltam = [];
      for (const t of templates) for (const l of IDIOMAS) if (!lista.some((x) => x.name === t.nome && x.language === l)) faltam.push(`${t.nome}/${l}`);
      console.log(faltam.length ? `\nAinda não existem na conta: ${faltam.join(", ")}` : "\nTodos os templates do documento existem na conta.");
    }
    return;
  }

  // Plano (dry-run ou apply)
  const plano = [];
  let comErro = 0;
  for (const t of templates) {
    if (only && t.nome !== only) continue;
    if (t.nome === "twk_reschedule_proposed" && !incluirReag) { plano.push({ nome: t.nome, idioma: "*", acao: "pulado", detalhe: "reagendamento bloqueado (plataforma não grava a proposta)" }); continue; }
    for (const idioma of langs) {
      const corpo = t.corpos[idioma];
      if (!corpo) { plano.push({ nome: t.nome, idioma, acao: "ERRO", detalhe: "corpo não encontrado no documento" }); comErro++; continue; }
      const erros = validar(t, idioma, corpo, rodape[idioma]);
      const graves = erros.filter((e) => !e.startsWith("aviso:"));
      if (graves.length) comErro++;
      const cab = t.cabecalhos?.[idioma];
      plano.push({ nome: t.nome, idioma, acao: graves.length ? "ERRO" : "criar", detalhe: erros.join("; ") || `${cab ? "cabeçalho + " : ""}${corpo.length} chars, ${VARIAVEIS[t.nome].length} variáveis${t.botao ? ", botão URL" : ""}` });
    }
  }
  console.table(plano);
  if (comErro) { console.error(`\n${comErro} item(ns) com erro — corrigir o documento antes de aplicar.`); process.exit(1); }
  const editar = flag("--edit");
  if (!flag("--apply")) { console.log(`\nDry-run: ${plano.filter((p) => p.acao === "criar").length} template(s)/idioma(s) seriam ${editar ? "criados ou editados" : "criados"}. Use --apply${editar ? " --edit" : ""} para valer.`); return; }

  const env = segredos();
  const existentes = await listar(env);
  let criados = 0, editados = 0, pulados = 0, falhas = 0;
  for (const p of plano) {
    if (p.acao !== "criar") continue;
    const existente = existentes.find((x) => x.name === p.nome && x.language === p.idioma);
    if (existente && !editar) { pulados++; console.log(`= ${p.nome}/${p.idioma} já existe — mantido como está (use --edit para trocar o texto)`); continue; }
    const t = templates.find((x) => x.nome === p.nome);
    const categoria = (opt("--categoria") || existente?.category || "UTILITY").toUpperCase();
    const payload = montarPayload(t, p.idioma, t.corpos[p.idioma], rodape[p.idioma], categoria);
    try {
      if (existente) {
        // Edição: POST /{id} só com os componentes — nome, idioma e categoria ficam como estão.
        // A Meta devolve o template à revisão (PENDING) e limita a 1 edição/dia, 10/mês.
        if (!["APPROVED", "REJECTED", "PAUSED"].includes(existente.status)) throw new Error(`status ${existente.status} não permite edição`);
        await graph(env, "POST", `${existente.id}`, { components: payload.components });
        editados++;
        console.log(`~ ${p.nome}/${p.idioma} editado (id ${existente.id}) — volta à revisão`);
        registrar({ acao: "editado", nome: p.nome, idioma: p.idioma, id: existente.id, status_anterior: existente.status });
      } else {
        const r = await graph(env, "POST", `${env.META_WABA_ID}/message_templates`, payload);
        criados++;
        console.log(`+ ${p.nome}/${p.idioma} criado (id ${r.id}, status ${r.status || "PENDING"})`);
        registrar({ acao: "criado", nome: p.nome, idioma: p.idioma, id: r.id, status: r.status || "PENDING" });
      }
    } catch (e) {
      falhas++;
      console.error(`x ${p.nome}/${p.idioma}: ${e.message}`);
      registrar({ acao: "falha", nome: p.nome, idioma: p.idioma, erro: e.message });
    }
    await new Promise((r) => setTimeout(r, 400)); // gentileza com o rate limit
  }
  console.log(`\nCriados ${criados} · editados ${editados} · mantidos ${pulados} · falhas ${falhas}. Aprovação da Meta leva de minutos a 24h — conferir com --status.`);
  if (falhas) process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error("ERRO:", e.message); process.exit(2); });
}
