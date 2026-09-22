# Extensão · Registro de Opt-out de Listagem & Intake de Remoção (`registro-optout`)

> Spec v1 · 2026-09-02 · trace `trc-agentes0902` · Status: **spec para portão humano**. **Não é agente novo**: é extensão de Aria (intake) + DBA (tabela/flag) + regra determinística (classificador e SLA). Usa o template de agente porque entra no mesmo portão, eval e canário.
> Código: `orchestrator/agents/registro-optout/` · Eval: `orchestrator/evals/registro-optout/` · Migração: `orchestrator/agents/registro-optout/migracao-listing_consent.sql` (proposta, DDL → fundador).

## 1. Missão e problema que mata

**Missão:** todo pedido de remoção ou correção de um estabelecimento é registrado em ≤1h, reconhecido em ≤24h, executado em ≤48h, e **nunca desfeito por importação, republicação ou campanha**.

**Mata:** linhas **07** e **15** da matriz (Cañete despublicado à mão sem marca "não relistar"; `republish_no_photo.js` republica por flag; `aria_contact_consent` = 0 linhas; CLAVIS não consulta consentimento; e-mails da campanha sem opt-out). É pré-requisito do Guardião (bloqueio de contato) e do guardrail 8 desta sessão.

## 2. Gatilho

- **Evento:** e-mail em support@/reservation@ (n8n Gmail Trigger → Aria) — a Aria classifica (FLUXO 7) e escala com tag `REMOCAO_LISTAGEM` ou `CORRECAO_LISTAGEM`.
- **Rede de segurança diária (cron 09h Paris):** `node orchestrator/agents/registro-optout/varredura.js` lê as mensagens das últimas 24h (Gmail, somente leitura) e roda o **classificador determinístico** (dicionário multilíngue); divergência entre Aria e classificador vira anomalia no relatório. Falha alto: se a varredura não rodar, o `/briefing` mostra "varredura de opt-out: NÃO RODOU".
- **Evento de campanha:** clique no link "retirar/corrigir" dos e-mails do CLAVIS/Guardião (n8n `/go` → webhook) grava direto no registro.

## 3. Entradas e saídas

**Registro (fonte única, dono: Suporte — ADR-010):** tabela `public.listing_consent` (proposta) ou, até a DDL, `orchestrator/state/listing-consent.jsonl`.
```json
{"restaurant_id":"15207","status":"opted_out","do_not_relist":true,"requested_at":"2026-08-28T00:00:00Z",
 "requested_by":"email:canete@grupolive.net","legal_basis":"GDPR art.21 / ausência de consentimento (importação 2023-07-25)",
 "evidence_ref":"gmail:1a04a246dd10a9e1","sla_ack_at":"2026-08-28","sla_done_at":null,"scope":["listing","reservations","outreach"],
 "notes":"front ainda responde 200 em /hospitality/canete/","trace_id":"canete-unpublish-2026-08-28"}
```
`status ∈ {listed, correction_requested, opted_out, claimed}` · `scope` diz o que foi pedido (sair da listagem, não receber reservas, não receber prospecção).

**Saída:** handoff ao Orquestrador com `evidencias` (ids), proposta de despublicação ao DBA (SQL de referência do runbook), notificações CLAVIS/Quill, item de SLA na Central.

## 4. Ferramentas e permissões

| Ferramenta | Permissão |
|---|---|
| Gmail (caixas support@/reservation@) | **leitura** (varredura); resposta padrão só via Aria/humano |
| `listing-consent.jsonl` / `listing_consent` | escrita append (registro) — auditada com `trace_id` |
| `db_restaurants.published`, `ready_pending_photo`, `do_not_relist` | **proposta ao DBA**; execução = fundador (tabela de escalonamento) |
| `aria_handoffs` | proposta de INSERT (silenciar Aria) |
| CLAVIS `suppression` + `aria_contact_consent` | escrita via `set_outbound_consent` (Aria) |

## 5. Autonomia por ação

| Ação | Início | Descer um degrau |
|---|---|---|
| Classificar e registrar o pedido no registro | `AUTONOMO_COM_LOG` | — |
| Resposta de reconhecimento (24h) | `REQUER_APROVACAO_HUMANA` (modelo do runbook §4) | após 10 respostas sem edição → `REQUER_APROVACAO_ORQUESTRADOR` |
| Despublicar / `do_not_relist` / silenciar Aria | `REQUER_APROVACAO_HUMANA` — **sempre** (tabela do CLAUDE.md) | nunca desce |
| Bloquear contato (Guardião/CLAVIS) por registro | `AUTONOMO` (é leitura) | — |
| Republicar casa com `do_not_relist=true` | **PROIBIDO** por código no `republish_no_photo.js`/importador | — |

## 6. KPIs

| KPI | Baseline | 30d | 90d | Fonte |
|---|---|---|---|---|
| Pedidos de remoção/correção por mês | **SEM DADO** (1 formal) — canário mede | medido | medido | registro |
| Reconhecidos em 24h | 1/1 (Cañete, mesmo dia) | 100% | 100% | registro `sla_ack_at` |
| Executados em 48h (despublicado + flag + silêncio) | 0/1 (Cañete: front ainda 200; sem flag) | 100% do que depende de nós | 100% | registro `sla_done_at` |
| Republicações/contatos indevidos a casa com opt-out | 0 conhecidos | 0 | 0 | eval + varredura do ledger de envios |
| Envios de campanha sem link de opt-out | 167/167 | 0 | 0 | templates + ledger |

## 7. Critério de morte

O **registro** não morre (prova legal, retenção permanente — política de PII). O **classificador determinístico** é desligado se, em 60 dias, sua precisão sobre os casos confirmados pelo humano for < 70% ou se a Aria (FLUXO 7) sozinha capturar 100% dos casos por 60 dias sem divergência.

## 8. Modos de falha e guardrails

| Falha | Guardrail |
|---|---|
| Pedido classificado como "prospect" e respondido com pitch (WOO TENDER/Cañete) | classificador determinístico com termos de remoção em PT/EN/FR/ES/IT; qualquer match → tag de remoção prevalece sobre qualquer outra |
| Registro fora do banco se perde | JSONL append-only + backup no `push-state`; migração para tabela proposta |
| Importação recria a ficha | flag `do_not_relist` verificada por `import_csv.js`, `republish_no_photo.js` e pelo botão de publicar (proposta ao DBA/front); teste de eval simula |
| Titularidade falsa (terceiro pede remoção de casa alheia) | regra do runbook §1.4: remetente vs `email_for_reservations`, corroborar endereço/site; status `correction_requested` até corroborar; despublicação sempre humana |
| Front continua servindo a página (fato do Cañete) | o registro guarda `notes` com o estado real; o SLA "executado" só fecha quando `/hospitality/{slug}/` responder 404 (checagem HTTP no `varredura.js`) — sem maquiar |

## 9. Custo × ganho

- LLM: 0 no classificador; Aria já lê as caixas (custo existente). Varredura: Gmail API, gratuito.
- Humano: ~10 min por caso (aprovar resposta + despublicação).
- Ganho: elimina o passivo "cada Cañete é manual" e libera a campanha para continuar dentro do guardrail 8. Não gera receita; evita dano. ROI é de risco, e isto fica dito.

## 10. Dependências

DDL `listing_consent` + `do_not_relist` (fundador) · Aria FLUXO 7 em produção (redeploy) · `republish_no_photo.js` e importador respeitando a flag (DBA) · front retornando 404 quando `published=false` (produto — bloqueia o KPI "executado").

## 11. MVP de 1 semana

Feito nesta sessão: classificador + varredura em dry-run sobre a caixa conectada, registro interino com o caso Cañete, FLUXO 7 na Aria (código, deploy pendente), rodapé de opt-out para templates do CLAVIS. Semana: fundador roda a DDL, redeploy da Aria, primeiro relatório de volume.

## 12. Red-team

1. **Legal:** ignorar um pedido por estar em idioma/forma inesperada ("por favor tirem-nos daí"). Contenção: dupla rede (Aria LLM + dicionário) e regra "na dúvida, registrar como `correction_requested` e escalar".
2. **Marca:** responder com venda a quem pediu para sair. Contenção: FLUXO 7 proíbe oferta antes do reconhecimento; modelo do runbook (honrar → auditar → só então oferecer, com saída digna).
3. **Cliente:** reserva futura em casa despublicada fica órfã. Contenção: o registro exige checagem de reservas futuras (runbook §1.3) e o Guardião passa a tratar essas reservas direto no degrau 4 (cliente avisado), nunca repassando ao restaurante.
