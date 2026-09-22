# Dossiê do Agente: Atlas (Financeiro)

> Auditoria de 2026-08-12 · Repositório `Agente Financeiro/` · Fastify + Drizzle + espelho Stripe + ledger append-only · o mais maduro dos 5

## 1. Missão em uma frase
Cérebro financeiro auditável que responde qualquer pergunta de receita com números reconciliáveis (MRR, NRR, churn, aging, forecast) e propõe ações Stripe que só executam com confirmação humana nomeada.

## 2. Entradas e saídas
- **Entradas:** webhooks Stripe assinados → outbox → worker → espelho + ledger; backfill paginado; chat autenticado (`/chat`, `/chat/stream`).
- **Saídas:** respostas com `toolTrace`/proof ("Explain This Number"), propostas em `audit_log`, alertas via n8n (sink único), fechamento diário com snapshot point-in-time.

## 3. Ferramentas e permissões atuais
11 tools: 8 de leitura pura (métricas, SQL RO com role verificada no banco, anomalias, forecast, what-if, dunning queue), `stripe_read` (projeção de campos, sem metadata/PII), `run_reconciliation` (escreve resultados), `stripe_action` (**apenas propõe** — 3 ações expostas ao LLM: refund, cancel, pause; retry só por clique humano).

**Permissões/controles ausentes:**
1. 🟠 **Sem segregação de funções:** quem propõe pode confirmar a própria proposta; sem teto de valor por ação; sem 4-eyes para refund grande; proposta pendente **nunca expira**.
2. 🟡 `dashboard-api` faz leituras puras com a role de escrita (finding "corrigido" que segue aberto).
3. 🟡 Chave de operador em `localStorage` + CSP com `unsafe-inline`; HTML do cockpit servido publicamente (proteção real é a chave nas rotas).

## 4. Dados que produz e consome
- **Banco 100% próprio** — zero conexão com o Postgres da TWK. O universo do Atlas é só Stripe. **Divergência com a constituição:** "reconciliação Stripe↔Postgres" é, na prática, Stripe↔espelho-do-Stripe. Ele não consegue responder "esta cobrança corresponde a uma reserva real?".
- Pontes já preparadas e não usadas: `stripe_customers.metadata` (segmentar por `twk_partner_id`), `ledger_entries.source='internal'` (lançamentos de domínio).

## 5. KPIs propostos
1. Divergências não explicadas Stripe↔espelho em 30 dias (meta: zero).
2. Taxa de acerto dos 52 evals (meta declarada ≥95% — **nunca medida contra ambiente real**).
3. Tempo proposta→decisão humana (fila de aprovação).
4. Cobertura de snapshot diário (dias sem `daily_close` = buraco retroativo).
5. % da receita atribuível a parceiro TWK (hoje: 0% — não há metadata).

## 6. Modos de falha conhecidos e prováveis
- Laço de dependência do watchdog: o detector de "cron do fechamento morreu" roda dentro do próprio fechamento — cron morto = anomalias sem alerta.
- `notify()` aguardado dentro de `proposeAction`: n8n fora bloqueia a proposta ~25s.
- `detail` do alerta leva `params`/`justification` completos ao n8n sem redação.
- Sem retenção/expurgo de PII (payloads Stripe, e-mails de clientes, histórico de conversas crescem para sempre).
- Migrations no start + rate-limit em memória = réplica única obrigatória, não imposta.
- Falsos positivos do SQL guard (`INTO`/`SET` dentro de literais).

## 7. Guardrails recomendados
1. **4-eyes:** `confirmedBy !== actor` obrigatório + teto de valor por ação (refund > €X exige segunda chave) + expiração de proposta (72h).
2. Anomalia crítica alerta na detecção, não só no fechamento; watchdog do fechamento em processo separado (ou no Orquestrador — ver arquitetura).
3. `notify()` fire-and-forget com fila local (nunca no caminho da proposta).
4. Redação de PII no payload de alerta; job de expurgo com política declarada.
5. Rodar os 52 evals contra o ambiente real e publicar a taxa — critério "≥95%" hoje é não-verificado.

## 8. Nível de autonomia recomendado
| Ação | Nível |
|---|---|
| Consultas, métricas, forecast, what-if, reconciliação | `AUTÔNOMO` |
| Propor ação Stripe (refund/cancel/pause) | `AUTÔNOMO COM LOG` (nasce `proposed`) |
| Confirmar/executar ação Stripe | `REQUER APROVAÇÃO HUMANA` (manter; adicionar 4-eyes acima de teto) |
| Retry de fatura (dunning) | `REQUER APROVAÇÃO HUMANA` (clique no cockpit, como hoje) |
| Qualquer escrita fora da fila de decisões | **NUNCA** |

## 9. Top 5 recomendações priorizadas
| # | Recomendação | Impacto | Esforço |
|---|---|---|---|
| 1 | Segregação de funções (4-eyes + teto de valor + expiração de proposta) | Alto | M |
| 2 | Metadata `twk_partner_id` nos objetos Stripe (liga o Atlas ao domínio TWK sem acoplamento) | Alto | P |
| 3 | Alerta de anomalia fora do fechamento + watchdog externo | Alto | P |
| 4 | Rodar evals contra ambiente real; medir a taxa | Médio | P |
| 5 | Expurgo/retenção de PII + redação nos alertas | Médio | M |
