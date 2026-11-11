#!/usr/bin/env node
/**
 * Pedido do selo (Conta Comercial Oficial, OBA) do número da Aria — pela Graph API.
 *
 *   node orchestrator/agents/notificacao-reserva/meta-selo-pedido.mjs            # só lê o estado e mostra o corpo que seria enviado
 *   node orchestrator/agents/notificacao-reserva/meta-selo-pedido.mjs --apply    # envia o pedido (fundador aprovou os campos)
 *
 * Fonte: developers.facebook.com/documentation/business-messaging/whatsapp/reference/
 *        whatsapp-business-phone-number/whatsapp-business-account-official-business-account-status-api
 *   GET  /{phone_number_id}/official_business_account            → oba_status, status_message
 *   POST /{phone_number_id}/official_business_account  {business_website_url, primary_country_of_operation,
 *        primary_language?, parent_business_or_brand?, supporting_links?(5–10), additional_supporting_information?}
 *   "Applications can only be submitted when no active application exists."
 *   Recusa → só se pode pedir de novo 30 dias depois. Por isso o --apply exige os campos revisados.
 *
 * Segredos em ~/.twk/meta.env (FORA do OneDrive, nunca no chat): META_WABA_ID, META_TOKEN.
 * Cada chamada é gravada em orchestrator/logs/selo-whatsapp-2026-11-09.jsonl (trace_id selo-whatsapp-2026-11-09).
 */
import { readFileSync, appendFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const GRAPH = process.env.WHATSAPP_GRAPH_VERSION || "v21.0";
const APPLY = process.argv.includes("--apply");
const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const LOG = path.join(RAIZ, "orchestrator", "logs", "selo-whatsapp-2026-11-09.jsonl");

// Campos do pedido — revisados pelo fundador antes do --apply (ver runbook docs/runbooks/selo-whatsapp-conta-oficial.md).
const PEDIDO = {
  business_website_url: "https://theworldkeys.com",
  primary_country_of_operation: "FR",
  primary_language: "en",
  additional_supporting_information:
    "The World Keys is a premium restaurant reservation platform (theworldkeys.com), headquartered in Paris. " +
    "This phone number is our customer and restaurant support line: reservation confirmations, follow-ups and concierge " +
    "service for members, with opt-in only and approved message templates.",
};

function lerEnv() {
  const arq = path.join(homedir(), ".twk", "meta.env");
  const env = {};
  for (const linha of readFileSync(arq, "utf8").split(/\r?\n/)) {
    if (!linha || linha.startsWith("#") || !linha.includes("=")) continue;
    const i = linha.indexOf("=");
    env[linha.slice(0, i).trim()] = linha.slice(i + 1).trim();
  }
  if (!env.META_WABA_ID || !env.META_TOKEN) throw new Error(`faltam META_WABA_ID/META_TOKEN em ${arq}`);
  return env;
}

async function graph(token, metodo, caminho, corpo) {
  const r = await fetch(`https://graph.facebook.com/${GRAPH}/${caminho}`, {
    method: metodo,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  return { http: r.status, body: j };
}

function log(reg) {
  appendFileSync(LOG, JSON.stringify({ at: new Date().toISOString(), trace_id: "selo-whatsapp-2026-11-09", ...reg }) + "\n");
}

const env = lerEnv();
const fones = await graph(env.META_TOKEN, "GET", `${env.META_WABA_ID}/phone_numbers?fields=id,display_phone_number,verified_name,name_status,is_official_business_account`);
if (fones.body.error) throw new Error(`Graph ${fones.body.error.code}: ${fones.body.error.message}`);
const fone = env.META_PHONE_NUMBER_ID ? fones.body.data.find((f) => f.id === env.META_PHONE_NUMBER_ID) : fones.body.data[0];
if (!fone) throw new Error("número não encontrado na conta");

console.log(`Número ${fone.display_phone_number} (${fone.id}) · nome "${fone.verified_name}" ${fone.name_status} · selo: ${fone.is_official_business_account ? "SIM" : "não"}`);
// A aresta GET /official_business_account não existe para o nosso token (sondado em 2026-11-11: "nonexisting field");
// o atributo do mesmo nome funciona. A aresta POST existe (corpo vazio → HTTP 500, não "nonexisting").
const lerEstado = async () => (await graph(env.META_TOKEN, "GET", `${fone.id}?fields=official_business_account{oba_status,status_message}`)).body?.official_business_account ?? {};
const antes = { body: await lerEstado() };
console.log(`Estado do pedido: ${JSON.stringify(antes.body)}`);

if (!APPLY) {
  console.log("\nSimulação — corpo que seria enviado com --apply:");
  console.log(JSON.stringify(PEDIDO, null, 2));
  log({ acao: "simulado", o_que: "GET official_business_account + corpo do pedido", resultado: antes.body, pedido: PEDIDO });
  process.exit(0);
}

if (fone.name_status !== "APPROVED") throw new Error(`nome de exibição ${fone.name_status}: o critério 5 exige APPROVED`);
const estado = antes.body?.oba_status;
if (["PENDING", "UNDER_REVIEW", "APPROVED"].includes(estado)) throw new Error(`já existe pedido ativo (${estado}); nada enviado`);

const envio = await graph(env.META_TOKEN, "POST", `${fone.id}/official_business_account`, PEDIDO);
console.log(`POST official_business_account: HTTP ${envio.http} ${JSON.stringify(envio.body)}`);
const depois = { body: await lerEstado() };
console.log(`Estado do pedido depois: ${JSON.stringify(depois.body)}`);
log({
  acao: envio.body?.success ? "executado" : "falhou",
  o_que: `POST /${fone.id}/official_business_account`,
  pedido: PEDIDO,
  resultado: { http: envio.http, resposta: envio.body, estado_depois: depois.body },
  proximo: envio.body?.success ? "acompanhar com meta-selo-status.mjs; não mudar nome nem número até a resposta" : "ler o erro; se inelegível, abrir chamado no Suporte da Meta (runbook passo 2.3)",
});
if (!envio.body?.success) process.exit(1);
