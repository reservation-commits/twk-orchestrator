# Templates de WhatsApp — notificação transacional de reserva

> Para submissão ao WhatsApp Manager **depois da sua aprovação**.
> Contrato técnico com `Agente de Suporte e Concierge/src/eventFormat.ts`.
> Conformidade obrigatória: ADR-015 (discrição e porta única de saída).

## Regras que moldaram cada frase

Do ADR-015 e da constituição, o que **não** pode aparecer:

- que a casa não é parceira, que "a mesa não é nossa", que não temos como forçar resposta;
- qualquer processo, fila, SLA ou falha interna;
- promessa de disponibilidade ou de confirmação;
- prazo de terceiro (resposta do restaurante) ou de etapa humana;
- relato de ação em primeira pessoa do tipo "escalei", "registrei".

E o que **tem** que aparecer: o que já fizemos, o que o cliente recebe
automaticamente, e como ele age agora. Discrição nunca vira mentira — nunca
afirmar mesa, confirmação ou resposta que não exista.

### Por que nenhum template promete data

A fórmula do ADR-015 pede "a data em que nós voltamos com alternativas". Eu
deliberadamente **não** coloquei data nenhuma nesta primeira leva, porque o
próprio ADR-015 exige conferir que existe o processo que cumpre a promessa — e
hoje não existe: o Guardião da Reserva é o dono da pendência, mas não está
ligado a este gatilho. Prometer data sem processo é exatamente a falha do
incidente de 11/09. A versão com data entra quando o Guardião estiver plugado, e
aí o compromisso vai para `orchestrator/state/compromissos.jsonl`.

## Configuração geral

| Item | Valor |
|---|---|
| Categoria | **UTILITY** (transacional; MARKETING seria recusado e mudaria o custo) |
| Idiomas da 1ª leva | **`en`** — US 3.938 · GB 1.713 · SG 1.215 · CA 722 · AU 709 · HK 648 |
| Próximos idiomas | `fr` (751) → `it` (502) → `de` (489) → `pt_BR` (429) |
| Rodapé (todos) | `Reply STOP to stop receiving reservation updates.` |

O rodapé só existe porque a promessa é cumprível: `src/consent.ts` já reconhece
`stop`, `parar`, `sair`, `unsubscribe`, `baja`, `arreter` e grava em
`aria_contact_consent`.

**Italiano e alemão:** `src/locale.ts` não mapeia IT nem DE, então esses clientes
caem em inglês. Degradação conhecida e declarada — some quando as traduções
entrarem.

## Os cinco templates

A ordem dos parâmetros é **contrato**: mudar aqui sem mudar
`montarParametros()` em `eventFormat.ts` manda o nome do restaurante para o
lugar da hora.

### 1. `twk_reservation_received` — evento `pedido_recebido`

`{{1}}` primeiro nome · `{{2}}` restaurante · `{{3}}` data · `{{4}}` hora

> Hello {{1}}, we have your request for {{2}} on {{3}} at {{4}} and we're working on it now. There's nothing you need to do — I'll write to you here as soon as I have news. If anything changes on your side, just reply to this message.

Não diz que a mesa está reservada. Não promete prazo. Diz o que ele recebe
(aviso aqui) e como agir.

### 2. `twk_reservation_accepted` — evento `aceito`

`{{1}}` nome · `{{2}}` restaurante · `{{3}}` data · `{{4}}` hora

> Wonderful news, {{1}} — your table at {{2}} is confirmed for {{3}} at {{4}}. Everything is arranged. If you need to change the time, the date or the number of guests, just reply to this message.

### 3. `twk_reservation_declined` — evento `recusado`

`{{1}}` nome · `{{2}}` restaurante · `{{3}}` data

> {{1}}, I'm sorry — {{2}} isn't able to host you on {{3}}. I know that's a disappointment. Reply to this message and I'll look for an equally special table for the same evening.

"I'll look for" e não "I'll find": nunca prometemos disponibilidade. Não diz
por que a casa recusou, nem sugere que o problema é nosso ou dela.

**Promessa conferida (2026-09-21).** "I'll look for" só pode existir porque o
processo existe: `db.ts` calcula `confirma_pedidos` (≥4 pedidos em 90 dias e
≥50% aceitos, em aritmética inteira) em toda busca, ordena os resultados por
ele, as tool schemas instruem a usar só casas com `confirma_pedidos=true` para
alternativa, e isso é **lei imutável nº 2** do system prompt. Foi o conserto do
incidente de 11/09, quando a Aria ofereceu três casas que nunca haviam
confirmado um pedido. Nada a fazer aqui — só não regredir.

### 4. `twk_reschedule_proposed` — evento `reagendamento_proposto`

`{{1}}` nome · `{{2}}` restaurante · `{{3}}` **nova** data · `{{4}}` **nova** hora

> {{1}}, {{2}} can offer you {{3}} at {{4}} instead. Reply YES to take it, or tell me what would suit you better and I'll see what I can do.

**[Bloqueado — achado de 2026-09-21]** Este é o único template que **não pode
entrar ainda**. As colunas `reschedule_proposed_date` e
`reschedule_proposed_time` existem em `reservations` e estão **vazias em 100%
das linhas** — nenhuma reserva do banco jamais as preencheu, embora o workflow 4
do n8n ("resposta ao reagendamento") exista. Ou a plataforma guarda a proposta
em outro lugar, ou o fluxo nunca chegou a gravá-la.

O código já falha fechado: sem data proposta, `montarParametros()` devolve
`null`, nada é enviado e abre-se finding. Nunca reenviamos a data antiga como se
fosse nova. Mas o template só tem serventia depois de descobrir onde a proposta
de reagendamento realmente mora.

### 5. `twk_reservation_cancelled` — evento `cancelado`

`{{1}}` nome · `{{2}}` restaurante · `{{3}}` data

> {{1}}, your reservation at {{2}} on {{3}} has been cancelled. Nothing further is needed from you. Whenever you'd like another evening, just reply to this message.

## Formato de data e hora

A data sai com **mês por extenso abreviado**, no idioma do cliente: `3 Apr 2026`,
`3 avr. 2026`. Nunca `03/04` — que para um americano é 4 de março e para um
francês é 3 de abril. Numa mensagem cuja única função é dizer *quando* é a mesa,
a ambiguidade é inaceitável, e a base é majoritariamente norte-americana.

A hora segue o costume do país: `8:00 PM` para US, `20:00` para FR.

Coberto por `test/eventFormat.test.ts`.

## Variáveis de ambiente

```
RESERVATION_EVENTS_ENABLED=true
RESERVATION_EVENTS_SECRET=<segredo forte, o mesmo no n8n>
RESERVATION_EVENT_TEMPLATE_RECEBIDO=twk_reservation_received
RESERVATION_EVENT_TEMPLATE_ACEITO=twk_reservation_accepted
RESERVATION_EVENT_TEMPLATE_RECUSADO=twk_reservation_declined
RESERVATION_EVENT_TEMPLATE_REAGENDAMENTO=twk_reschedule_proposed
RESERVATION_EVENT_TEMPLATE_CANCELADO=twk_reservation_cancelled
REMINDERS_LOCALES=en
REMINDERS_DEFAULT_LOCALE=en
```

Evento sem template configurado **não envia e abre finding** — nunca silêncio.

## O que o n8n precisa fazer

Em cada workflow que já manda o e-mail da transição (1 nova reserva, 3 resposta
do restaurante, 4 reagendamento, 5 cancelamento), acrescentar **um** nó HTTP
Request:

```
POST  https://<aria>/webhook/reservation-event
      x-aria-secret: <RESERVATION_EVENTS_SECRET>
      { "event": "aceito", "reservation_code": "{{ ... }}", "trace_id": "{{ $execution.id }}" }
```

O corpo leva **só referências**. Nenhum dado de cliente atravessa o webhook: a
Aria lê do banco. Assim o webhook é inútil para quem o descobrir, e o contrato
cumpre a regra 1 da constituição.

A resposta é síncrona e traz o desfecho (`enviado`, `duplicado`,
`telefone_nao_enviavel`, `opt_out`, …), que fica no histórico de execução do
n8n. O fluxo fica auditável dos dois lados.

**Pré-requisito de segurança, não negociável:** `/webhook/nova-reserva` está sem
autenticação e com injeção de SQL (inventário de 24/08, achados 1 e 2). Não se
pendura um canal novo num gatilho aberto. O script
`docs/notificacoes/elevar-sistema.ps1` já corrige — confirmar se chegou a rodar.

## O que preciso de você

1. Aprovar os cinco textos (ou corrigi-los — eles são a voz da marca).
2. Submetê-los no WhatsApp Manager em `en`, categoria UTILITY.
3. Decidir se outreach a restaurante (CLAVIS) e notificação a cliente
   compartilham o mesmo número WABA. Compartilham o **quality rating**: se o
   outreach frio gerar bloqueios, derruba a notificação transacional junto.
4. Decidir sobre o número: o WhatsApp oficial é `+55 21 96784-1007`, e a base
   entregável é US/GB/SG/FR. Um DDI brasileiro custa confiança nessa audiência.
