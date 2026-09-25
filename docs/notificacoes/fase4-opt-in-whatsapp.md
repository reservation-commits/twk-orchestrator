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
| `outbound_opted_out` | o cliente escreveu "PARAR". **Vence o interruptor**: marcado + PARAR = não recebe |
| `source`, `motivo`, `updated_at` | quem marcou, por quê, quando |

A regra é uma função só (`src/consentRegra.ts`), usada pelos dois remetentes: notificação por evento (`reservationEvents.ts`) e lembretes por tempo (`reminders.ts`). Não existe caminho de envio que não passe por ela. Cada não-envio fica registrado em `aria_outbound_log` com desfecho `sem_opt_in` ou `opt_out`.

## Como marcar e desmarcar

1. **Pela porta única do banco** (hoje): `orchestrator/agents/dba-escrita/exemplos/whatsapp-optin.sql` — editar os números, rodar `node orchestrator/agents/dba-escrita/executar.js <arquivo> --apply --autonomo`. Reversível com `desfazer.js --ultimo`.
2. **Pelo site ou n8n** (quando houver a caixa "quero receber por WhatsApp"): `POST /webhook/consent` na Aria, cabeçalho `x-aria-secret`, corpo `{ "phone": "+351…", "whatsapp_reservas": true, "tipo": "cliente" }`. Número inválido ou fixo é recusado com o motivo.
3. **O próprio cliente**: "PARAR" no WhatsApp desliga; "VOLTAR" só reabre o que já estava marcado.

## O que falta para começar de vez (em ordem)

1. **Subir a v6** (`aria_agent_whatsapp-2026-09-25-v6.zip`). Ela cria as colunas no boot — subir é a aprovação do `ADD COLUMN`.
2. **Templates na Meta.** Só um template envia hoje (`avaliacao_experiencia_6h` em `pt_BR`). O `lembrete_reserva_2h` foi recusado 3 vezes pela Cloud API nos últimos 14 dias, e os 5 templates de evento em `en` (`fase2-templates-whatsapp.md`) nunca foram confirmados como aprovados. Sem template aprovado, marcar alguém não muda nada.
3. **Variáveis no Easypanel da Aria:** `RESERVATION_EVENTS_ENABLED=true`, `RESERVATION_EVENTS_SECRET=<segredo forte>`, `RESERVATION_EVENTS_DAILY_CAP=25`, e `RESERVATION_EVENT_TEMPLATE_<evento>` só para os templates aprovados.
4. **Marcar a primeira leva** (canário): 10 a 20 números, pelo arquivo SQL acima.
5. **n8n:** um nó HTTP no workflow "nova reserva" chamando `POST /webhook/reservation-event` com o segredo — depois de fechar o `/webhook/nova-reserva` aberto (pré-requisito do plano canário).
6. **Estabelecimentos:** o interruptor já aceita `tipo = estabelecimento`, mas o envio para a casa ("chegou um pedido") ainda não existe — é um template novo e um evento novo, depois do canário com clientes.
