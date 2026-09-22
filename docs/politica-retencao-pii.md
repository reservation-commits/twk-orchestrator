# Política de Retenção e Expurgo de PII — Operação TWK

> v1.0 · 2026-08-12 · Base: GDPR/LGPD. Vale para os 5 agentes. Implementação = job de expurgo por agente + esta tabela como norma. Alterações exigem aprovação do fundador.

## Princípios
1. Reter o mínimo pelo tempo mínimo com finalidade declarada; agregado é preferível a individual.
2. **Dado de saúde (alergias/restrições — GDPR art. 9) tem o regime mais restrito:** vive apenas no perfil ativo, nunca em logs.
3. Log de auditoria guarda **quem fez o quê**, não o conteúdo pessoal — auditoria com referências (ids), não com dumps.
4. Exclusão a pedido do titular (art. 17): prazo interno de 15 dias, cobrindo TODOS os agentes (perfil, mensagens, tool_calls, contatos harvested).

## Tabela normativa

| Dado | Onde | Retenção | Ação no vencimento |
|---|---|---|---|
| Mensagens de atendimento (`aria_messages`) | Aria | 12 meses | expurgo; manter agregados (volumes, CSAT) |
| Inputs/outputs de tools (`aria_tool_calls`) | Aria | 90 dias | expurgo; **redigir alergias/saúde já na gravação** (imediato) |
| Perfil do cliente (`aria_customer_profiles`) | Aria | enquanto ativo + 24 meses sem interação | anonimizar |
| Escalações (`aria_escalations`) | Aria | 24 meses | expurgo de campos livres, manter métricas |
| Consentimento (`aria_contact_consent`) | Aria | **permanente** (prova legal de opt-out) | nunca expurgar |
| Replies de outreach (`inbox.json`/Postgres) | CLAVIS | 12 meses | expurgo do texto, manter desfecho |
| Supressão de contato | CLAVIS | **permanente** (prova legal) | nunca expurgar |
| E-mails harvested (`email_results_*.csv`, `enrich_run.log`) | DBA | **30 dias** após gravação no banco | apagar arquivos; free-mail de proprietário: não coletar (correção no harvester) |
| PII de clientes (`nextauth.*`, `reservations`) | Plataforma | política da plataforma | agentes nunca copiam para logs/estado — só referências |
| Payloads Stripe (`stripe_events.payload`) | Atlas | 18 meses | expurgar payload cru, manter espelho tipado |
| Conversas do agente (`agent_conversations`) | Atlas | 12 meses | expurgo |
| Ledger financeiro / `audit_log` / `agent_audit_log` | Atlas/DBA | **permanente** (obrigação contábil/auditoria) | nunca expurgar; não contêm PII livre por norma |
| Logs do Orquestrador (`orchestrator/logs`) | este repo | permanente | não recebem PII por construção (regra 5 do CLAUDE.md) |

## Pendências de implementação (viram tarefas `/delegar`)
1. Job de expurgo na Aria (messages/tool_calls/perfis) + redação de alergias na gravação.
2. Job de expurgo no Atlas (payloads/conversas) — já recomendado no dossiê.
3. Correção do harvester do DBA (rejeitar free-mail; apagar CSVs após ingestão) + registro de base legal (legítimo interesse B2B) com aviso art. 14 no primeiro contato do CLAVIS.
4. Fluxo único de "esquecer-me" cobrindo os 5 agentes (runbook a escrever quando o primeiro pedido chegar — ou preventivamente na expansão).
