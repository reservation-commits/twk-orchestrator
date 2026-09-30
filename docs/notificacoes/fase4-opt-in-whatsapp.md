# Fase 4 — Opt-in: quem recebe WhatsApp de reservas (25/09/2026)

Decisão do fundador: **só recebe notificação de reserva por WhatsApp quem estiver marcado no banco.** Desmarcar elimina a possibilidade de envio. Vale para cliente e para estabelecimento.

## O identificador

Tabela `aria_contact_consent` (dona: Aria/Suporte — já era a fonte única de consentimento).

| Coluna | Significado |
|---|---|
| `phone` | número em E.164 (`+351…`). É a chave. |
| `whatsapp_reservas` | **o interruptor.** `true` = recebe · `false` ou sem linha = não recebe |
| `tipo` | `cliente` ou `estabelecimento` |
| `restaurant_id` | preenchido quando `tipo = estabelecimento` |
| `idioma` | **v7 (25/09):** `pt`, `en`, `es`, `fr`, `it` ou `de`. Vazio = idioma do país do telefone. Só vale se a tradução do template estiver aprovada na Meta; senão cai para o país e depois para o padrão (`en`). Regra em `src/templateLocale.ts` |
| `outbound_opted_out` | o cliente escreveu "PARAR". **Vence o interruptor**: marcado + PARAR = não recebe |
| `source`, `motivo`, `updated_at` | quem marcou, por quê, quando |

A regra é uma função só (`src/consentRegra.ts`), usada pelos dois remetentes: notificação por evento (`reservationEvents.ts`) e lembretes por tempo (`reminders.ts`). Não existe caminho de envio que não passe por ela. Cada não-envio fica registrado em `aria_outbound_log` com desfecho `sem_opt_in` ou `opt_out`.

## Como marcar e desmarcar

1. **Pela porta única do banco** (hoje): `orchestrator/agents/dba-escrita/exemplos/whatsapp-optin.sql` — editar os números, rodar `node orchestrator/agents/dba-escrita/executar.js <arquivo> --apply --autonomo`. Reversível com `desfazer.js --ultimo`.
2. **Pelo site ou n8n** (quando houver a caixa "quero receber por WhatsApp"): `POST /webhook/consent` na Aria, cabeçalho `x-aria-secret`, corpo `{ "phone": "+351…", "whatsapp_reservas": true, "tipo": "cliente" }`. Número inválido ou fixo é recusado com o motivo.
3. **O próprio cliente**: "PARAR" no WhatsApp desliga; "VOLTAR" só reabre o que já estava marcado.

## O que falta para começar de vez (em ordem)

1. **Subir a v12** (`aria_agent_whatsapp-2026-09-30-v12.zip`). Ela cria as colunas no boot — subir é a aprovação do `ADD COLUMN`.
2. **Templates na Meta — CONCLUÍDO em 30/09:** 10 mensagens × 6 idiomas aprovadas (64 templates, 0 pendentes, 0 rejeitados). `REMINDERS_LOCALES=en,pt_BR,fr,es,it,de`.
3. **Variáveis no Easypanel da Aria:** `RESERVATION_EVENTS_ENABLED=true`, `RESERVATION_EVENTS_SECRET=<segredo forte>`, `RESERVATION_EVENTS_DAILY_CAP=25`, e `RESERVATION_EVENT_TEMPLATE_<evento>` só para os templates aprovados.
4. **Marcar a primeira leva** (canário): 10 a 20 números, pelo arquivo SQL acima.
5. **n8n não é mais necessário para começar (v12):** a Aria vigia a tabela de reservas a cada 2 minutos e dispara sozinha pedido recebido, aceito, recusado e cancelado — para o cliente e para a casa. O webhook do n8n continua aceito (a dedup impede duplicidade), mas o gatilho aberto pode ficar para depois.
6. **Estabelecimentos (v9 + v12):** três etapas prontas — "chegou um pedido" (botão para `/r/<código>`), "o cliente cancelou" e véspera. Só para casas marcadas (`tipo = estabelecimento` + `restaurant_id`). Desde a v12 o número pode ser o **fixo do catálogo** (muitas casas têm WhatsApp Business no fixo; se não tiver, a Meta recusa e fica registrado) e casas no Registro de Opt-out de Listagem nunca recebem. SQL pronto: `node orchestrator/agents/chave-girada/ativacao/optin-sql.cjs` → `orchestrator/state/ativacao/optin-estabelecimentos.sql`.

## Variáveis finais (Easypanel da Aria, v12)

```
RESERVATION_EVENTS_ENABLED=true
RESERVATION_EVENTS_SECRET=<senha longa só de letras e números>
RESERVATION_EVENTS_DAILY_CAP=25
RESERVATION_WATCH_ENABLED=true
RESERVATION_WATCH_MINUTES=2

RESERVATION_EVENT_TEMPLATE_RECEBIDO=twk_reservation_received
RESERVATION_EVENT_TEMPLATE_ACEITO=twk_reservation_accepted
RESERVATION_EVENT_TEMPLATE_RECUSADO=twk_reservation_declined_v2
RESERVATION_EVENT_TEMPLATE_CANCELADO=twk_reservation_cancelled
RESERVATION_EVENT_TEMPLATE_REAGENDAMENTO=
RESERVATION_EVENT_TEMPLATE_VENUE_RECEBIDO=twk_venue_new_request
RESERVATION_EVENT_TEMPLATE_VENUE_CANCELADO=twk_venue_cancelled

REMINDERS_ENABLED=true
REMINDERS_TEMPLATE=twk_reminder_2h
BRIEFING_ENABLED=true
BRIEFING_TEMPLATE=twk_eve_briefing
REVIEW_ENABLED=true
REVIEW_TEMPLATE=twk_review_invite
VENUE_BRIEFING_ENABLED=true
VENUE_BRIEFING_TEMPLATE=twk_venue_eve_briefing
VENUE_BRIEFING_HOURS_BEFORE=24

REMINDERS_DEFAULT_LOCALE=en
REMINDERS_LOCALES=en,pt_BR,fr,es,it,de
```

Depois de colar: **Redeploy**. Nos primeiros 2 minutos o vigia fotografa as reservas e só anuncia pedidos das últimas 6 horas — nada do passado é reenviado. Ninguém recebe sem estar marcado no opt-in.
