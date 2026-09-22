# Dossiê do Agente: CLAVIS (Comercial)

> Auditoria de 2026-08-12 · Repositório `Agente Comercial/` · Node/TS + Command Center React · deploy EasyPanel

## 1. Missão em uma frase
Estrategista comercial autônomo que produz análises, planos de crescimento RICE, lotes de outreach multilíngue para restaurantes-alvo e nudges de fulfillment sobre reservas Pending — sempre por trás de um Portão de Aprovação humano.

## 2. Entradas e saídas
- **Entradas:** Central de Comando (operador), 46 rotas de API (5 públicas), replies via n8n → `/api/outreach/event` (ainda não ligado), agendadores internos (todos desligados por default).
- **Saídas:** e-mail e WhatsApp **exclusivamente via n8n** (ponto único de falha), páginas Notion, submit de sitemap GSC, escrita no Postgres via proposta aprovada, SSE para a Central.

## 3. Ferramentas e permissões atuais
Tools do cérebro: `query_database` (RO), `account_dossier`, `search_console`, `ga4_analytics`, `propose_action` (6 superfícies: db_write, notion, n8n, gmail, gsc, whatsapp).

**Permissões que tem e NÃO deveria ter:**
1. 🔴 Executor n8n aceita **URL arbitrária escolhida pelo LLM** (`executors.ts:214`) — injeção bem-sucedida vira exfiltração para qualquer host.
2. 🟠 Executor Notion aceita `parentPageId` arbitrário.
3. 🟠 `db_write` com SQL livre ligado por default (`CLAVIS_DB_WRITE_ENABLED=true`); `UPDATE ... WHERE true` passa no `validateWrite`.
4. 🟠 DDL destravável por env (`CLAVIS_DB_ALLOW_DDL`).
5. 🟡 Token único sem escopos — mesmo token lê, gera e **aprova**; `X-Operator` é auto-declarado (zero não-repúdio).

## 4. Dados que produz e consome
- **Consome (role `clavis_ro`, o padrão-ouro da operação):** `db_restaurants`, `reservations`, `restaurant_users`, `restaurant_invitations`. Nunca toca Stripe/depósitos — **receita não é medida em lugar nenhum**.
- **Produz:** 12 arquivos JSON de estado local (`batches`, `contacts`, `suppression`, `actions`, `inbox`...) + `audit.jsonl`. ⚠️ Tudo em disco de container **sem volume persistente montado** — perder `suppression.json` após um disparo real = recontatar opt-outs = incidente GDPR sev-1.
- **Prova material:** o estado local mostra que **nenhum e-mail jamais foi disparado** — o funil nunca rodou.

## 5. KPIs propostos
1. Reservas confirmadas por parceiro ativado/mês (North Star declarada — hoje não calculada em lugar nenhum).
2. Taxa de resposta de outreach por idioma/persona (reply rate).
3. Tempo mediano Pending→Confirmed em reservas de parceiros tocadas pelo Cobrador.
4. Propostas aprovadas ÷ propostas geradas (qualidade do Portão).
5. Custo de IA por proposta aprovada (€).

## 6. Modos de falha conhecidos e prováveis
- Injeção de prompt via reply de e-mail/WhatsApp: texto hostil pode marcar `optout` (supressão permanente de lead sem revisão) e, no modo `/operar`, alcançar `propose_action` + URL n8n livre.
- Sem `messageId`/dedup no inbound — reentrega do n8n duplica proposta.
- `stop_reason` ignorado: resposta truncada é entregue como completa.
- Agendadores marcam "executado" **antes** de executar — job que falha às 3h some em silêncio.
- Métricas que mentem: "respondidas" conta desistência de cliente; 3 definições diferentes de "reservas 90d"; lacuna falsa ("órfãs") injetada no cérebro a cada snapshot.
- `.env` real em pasta OneDrive sincronizada.

## 7. Guardrails recomendados (além dos existentes, que são bons)
1. **Fixar a URL do executor n8n em `config.n8nWebhookUrl`** — eliminar o campo `payload.url`. (O guardrail existente mais importante a corrigir.)
2. `CLAVIS_DB_WRITE_ENABLED=false` por default; remover interruptor de DDL.
3. `messageId` + idempotência no `/outreach/event`; rate-limit nas rotas de LLM.
4. Volume persistente + migração do estado de compliance (supressão) para o Postgres.
5. Optout classificado por IA vai para revisão humana, nunca supressão direta.
6. Supressão unificada com `aria_contact_consent` (hoje dois agentes podem contatar o mesmo número que pediu opt-out no outro canal).

## 8. Nível de autonomia recomendado
| Ação | Nível |
|---|---|
| Consultas RO, análises, dossiês, briefings | `AUTÔNOMO` |
| Gerar lote de outreach / rascunho de reply / nudge | `AUTÔNOMO COM LOG` (fica no Portão) |
| Enviar e-mail/WhatsApp, criar página Notion, submit GSC | `REQUER APROVAÇÃO HUMANA` (Portão, como hoje) |
| `db_write` de qualquer natureza | `REQUER APROVAÇÃO HUMANA` |
| Marcar supressão por classificação de IA | `REQUER APROVAÇÃO DO ORQUESTRADOR` → humano se ambíguo |

## 9. Top 5 recomendações priorizadas
| # | Recomendação | Impacto | Esforço |
|---|---|---|---|
| 1 | Volume persistente + supressão no Postgres + `.env` fora do OneDrive | Alto | P |
| 2 | Fixar URL do executor n8n (remover `payload.url`) | Alto | P |
| 3 | `messageId` no inbound + rate-limit nas rotas de LLM | Alto | P |
| 4 | `metrics.ts` canônico (uma definição por número; remover lacuna falsa das órfãs) | Médio | M |
| 5 | CI com `npm test` + alerta push (hoje zero notificação ativa) | Médio | P |
