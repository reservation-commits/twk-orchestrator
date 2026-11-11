#!/usr/bin/env node
/**
 * Estado do selo (Conta Comercial Oficial, OBA) do número da Aria — SÓ LEITURA.
 *
 *   node orchestrator/agents/notificacao-reserva/meta-selo-status.mjs
 *
 * Lê pela Graph API o que a Meta sabe sobre a conta e o número e confere
 * cada critério publicado pela Meta para o selo azul
 * (developers.facebook.com/documentation/business-messaging/whatsapp/official-business-accounts).
 * Não altera nada. O pedido do selo é feito pelo fundador no WhatsApp Manager
 * (runbook: docs/runbooks/selo-whatsapp-conta-oficial.md).
 *
 * Segredos em ~/.twk/meta.env (FORA do OneDrive, nunca no chat):
 *   META_WABA_ID=<ID da conta do WhatsApp Business>
 *   META_TOKEN=<token de usuário do sistema com whatsapp_business_management>
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const GRAPH = process.env.WHATSAPP_GRAPH_VERSION || "v21.0";

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

async function get(token, caminho) {
  const r = await fetch(`https://graph.facebook.com/${GRAPH}/${caminho}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const j = await r.json();
  if (j.error) throw new Error(`Graph ${j.error.code}: ${j.error.message}`);
  return j;
}

const env = lerEnv();
const waba = await get(env.META_TOKEN, `${env.META_WABA_ID}?fields=id,name,account_review_status,business_verification_status,ownership_type`);
const fones = await get(env.META_TOKEN, `${env.META_WABA_ID}/phone_numbers?fields=id,display_phone_number,verified_name,name_status,new_display_name,new_name_status,quality_rating,is_official_business_account,account_mode,platform_type,official_business_account`);

const ok = (b) => (b ? "OK " : "FALTA");
console.log(`Conta ${waba.name} (${waba.id})`);
console.log(`  ${ok(waba.business_verification_status === "verified")} verificação do negócio: ${waba.business_verification_status}`);
console.log(`  ${ok(waba.account_review_status === "APPROVED")} revisão da conta: ${waba.account_review_status}`);
for (const f of fones.data) {
  console.log(`Número ${f.display_phone_number} (${f.id}) · ${f.platform_type} · modo ${f.account_mode}`);
  console.log(`  ${ok(f.name_status === "APPROVED")} nome de exibição "${f.verified_name}": ${f.name_status}`);
  if (f.new_display_name) console.log(`  ---   novo nome pedido "${f.new_display_name}": ${f.new_name_status}`);
  console.log(`  ${ok(f.quality_rating === "GREEN")} qualidade: ${f.quality_rating}`);
  console.log(`  OK    verificação em duas etapas: exigida no registro na Cloud API; a Meta aposentou o PIN para números elegíveis e a aba sumiu do WhatsApp Manager (conferido 2026-11-11)`);
  console.log(`  ${ok(f.is_official_business_account)} selo (conta comercial oficial): ${f.is_official_business_account ? "SIM" : "não"} · pedido: ${f.official_business_account?.oba_status ?? "?"}`);
}
