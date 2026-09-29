# Templates de WhatsApp para a Meta — 11 mensagens × 6 idiomas (25/09/2026, revisão v9: etapas do estabelecimento)

Contrato técnico: a ordem das variáveis `{{n}}` é a que o código envia (`eventFormat.ts` e `reminders.ts`). Não mudar a ordem nem o número de variáveis. Todos em categoria **UTILITY** (transacional). Nenhum botão: o código só envia o corpo. Rodapé fixo em todos, no idioma da mensagem.

Conformidade ADR-015: nenhum texto promete prazo, disponibilidade nem confirmação que não exista; nenhum expõe processo; a data sai por extenso no idioma do cliente (o código formata).

Regra dos nomes: **o mesmo nome em todos os idiomas** (na Meta, idioma é uma "tradução" do mesmo template). Conferido na conta em 29/09: os templates antigos em português foram apagados; todos entram como novos.

| # | Nome na Meta | Quem dispara | Variáveis |
|---|---|---|---|
| 1 | `twk_reservation_received` | evento `pedido_recebido` | 1 nome · 2 restaurante · 3 data · 4 hora · **5 pessoas** |
| 2 | `twk_reservation_accepted` | evento `aceito` | 1 nome · 2 restaurante · 3 data · 4 hora · **5 pessoas** |
| 3 | `twk_reservation_declined_v2` *(o nome antigo ficou preso em MARKETING)* | evento `recusado` | 1 nome · 2 restaurante · 3 data |
| 4 | `twk_reservation_cancelled` | evento `cancelado` | 1 nome · 2 restaurante · 3 data |
| 5 | `twk_reschedule_proposed` | evento `reagendamento_proposto` | 1 nome · 2 restaurante · 3 nova data · 4 nova hora — **não submeter ainda** (a plataforma não grava a proposta; ver fase 2) |
| 6 | `twk_reminder_2h` *(o nome antigo ficou travado na Meta por 4 semanas)* | lembrete 2 h antes | 1 nome · 2 restaurante · 3 hora |
| 7 | `twk_eve_briefing` | véspera (~24 h antes) | 1 nome · 2 restaurante · 3 data · 4 hora · **5 pessoas** |
| 8 | `twk_review_invite` *(o nome antigo ficou travado na Meta por 4 semanas)* | 6 h depois | 1 nome · 2 restaurante |
| 9 | `twk_venue_new_request` | **casa** — evento `pedido_recebido` | 1 restaurante · 2 data · 3 hora · 4 pessoas · 5 nome do cliente · **botão de URL** `https://theworldkeys.com/r/{{1}}` (código da reserva) |
| 10 | `twk_venue_cancelled` | **casa** — evento `cancelado` | 1 restaurante · 2 data · 3 hora · 4 pessoas · 5 nome do cliente |
| 11 | `twk_venue_eve_briefing` | **casa** — véspera (~24 h) | 1 restaurante · 2 data · 3 hora · 4 pessoas · 5 nome do cliente |

Exemplos para o campo "amostra" da Meta (obrigatório): `{{1}}` = Anna · `{{2}}` = Le Tobsil · `{{3}}` = 3 Oct 2026 · `{{4}}` = 8:00 PM · `{{5}}` = 2.

**Número de pessoas (v8, 25/09):** entra como `{{5}}` nos templates 1, 2 e 7, sempre na forma "mesa para {{5}}" — funciona para 1 e para 8. Se o banco não tiver um número plausível (1 a 20), a mensagem **não sai** e vira finding: número errado é pior que nenhum. O lembrete de 2 h fica sem pessoas de propósito, porque já existe aprovado em português com 3 variáveis; acrescentar uma quarta obrigaria a recriar o template.

## Rodapé (um por idioma, igual em todos os templates)

| Idioma | Rodapé |
|---|---|
| en | Reply STOP to stop receiving reservation updates. |
| pt_BR | Responda PARAR para não receber mais avisos de reserva. |
| fr | Répondez STOP pour ne plus recevoir ces messages. |
| es | Responda STOP para dejar de recibir avisos de reserva. |
| it | Rispondi STOP per non ricevere più questi messaggi. |
| de | Antworten Sie mit STOP, um keine Updates mehr zu erhalten. |

O código reconhece STOP, PARAR, SAIR, BAJA, ARRETER e UNSUBSCRIBE em qualquer idioma.

---

## 1. `twk_reservation_received` — pedido recebido

**en**
> Hello {{1}}, we have your request for a table for {{5}} at {{2}} on {{3}} at {{4}}, and we're working on it now. There's nothing you need to do — I'll write to you here as soon as I have news. If anything changes on your side, just reply to this message.

**pt_BR**
> Olá {{1}}, recebemos o seu pedido de mesa para {{5}} no {{2}} em {{3}} às {{4}}, e já estamos cuidando dele. Você não precisa fazer nada — escrevo aqui assim que tiver novidades. Se algo mudar do seu lado, é só responder a esta mensagem.

**fr**
> Bonjour {{1}}, nous avons bien reçu votre demande de table pour {{5}} chez {{2}} le {{3}} à {{4}}, et nous nous en occupons dès maintenant. Vous n'avez rien à faire — je vous écris ici dès que j'ai du nouveau. Si quelque chose change de votre côté, répondez simplement à ce message.

**es**
> Hola {{1}}, tenemos su solicitud de mesa para {{5}} en {{2}} el {{3}} a las {{4}}, y ya estamos trabajando en ella. No necesita hacer nada — le escribo aquí en cuanto tenga novedades. Si algo cambia por su parte, responda a este mensaje.

**it**
> Buongiorno {{1}}, abbiamo ricevuto la sua richiesta di un tavolo per {{5}} da {{2}} il {{3}} alle {{4}}, e ce ne stiamo già occupando. Non deve fare nulla — le scrivo qui appena ho novità. Se qualcosa cambia da parte sua, risponda pure a questo messaggio.

**de**
> Guten Tag {{1}}, wir haben Ihre Anfrage für einen Tisch für {{5}} im {{2}} am {{3}} um {{4}} erhalten und kümmern uns bereits darum. Sie müssen nichts weiter tun — ich schreibe Ihnen hier, sobald es Neuigkeiten gibt. Falls sich bei Ihnen etwas ändert, antworten Sie einfach auf diese Nachricht.

## 2. `twk_reservation_accepted` — aceito

**en**
> Wonderful news, {{1}} — your table for {{5}} at {{2}} is confirmed for {{3}} at {{4}}. Everything is arranged. If you need to change the time, the date or the number of guests, just reply to this message.

**pt_BR**
> Ótima notícia, {{1}} — a sua mesa para {{5}} no {{2}} está confirmada para {{3}} às {{4}}. Está tudo organizado. Se precisar mudar o horário, a data ou o número de pessoas, é só responder a esta mensagem.

**fr**
> Excellente nouvelle, {{1}} — votre table pour {{5}} chez {{2}} est confirmée pour le {{3}} à {{4}}. Tout est en place. Pour modifier l'heure, la date ou le nombre de convives, répondez simplement à ce message.

**es**
> Excelente noticia, {{1}} — su mesa para {{5}} en {{2}} está confirmada para el {{3}} a las {{4}}. Todo está organizado. Si necesita cambiar la hora, la fecha o el número de personas, responda a este mensaje.

**it**
> Ottime notizie, {{1}} — il suo tavolo per {{5}} da {{2}} è confermato per il {{3}} alle {{4}}. È tutto organizzato. Se ha bisogno di cambiare orario, data o numero di persone, risponda pure a questo messaggio.

**de**
> Gute Nachrichten, {{1}} — Ihr Tisch für {{5}} im {{2}} ist für den {{3}} um {{4}} bestätigt. Alles ist organisiert. Wenn Sie Uhrzeit, Datum oder Personenzahl ändern möchten, antworten Sie einfach auf diese Nachricht.

## 3. `twk_reservation_declined_v2` — recusado (texto seco, para a Meta manter UTILITY)

**en**
> Hello {{1}}, {{2}} is unable to host you on {{3}}, so this request is now closed. If you would like us to look for another table for the same evening, reply to this message.

**pt_BR**
> Olá {{1}}, o {{2}} não poderá recebê-lo em {{3}}, e este pedido foi encerrado. Se quiser que procuremos outra mesa para a mesma noite, responda a esta mensagem.

**fr**
> Bonjour {{1}}, {{2}} ne peut pas vous recevoir le {{3}} ; cette demande est donc close. Si vous souhaitez que nous cherchions une autre table pour le même soir, répondez à ce message.

**es**
> Hola {{1}}, {{2}} no puede recibirle el {{3}}, por lo que esta solicitud queda cerrada. Si desea que busquemos otra mesa para la misma noche, responda a este mensaje.

**it**
> Buongiorno {{1}}, {{2}} non può accoglierla il {{3}}, quindi questa richiesta è chiusa. Se desidera che cerchiamo un altro tavolo per la stessa sera, risponda a questo messaggio.

**de**
> Guten Tag {{1}}, {{2}} kann Sie am {{3}} nicht empfangen; diese Anfrage ist damit abgeschlossen. Wenn wir einen anderen Tisch für denselben Abend suchen sollen, antworten Sie auf diese Nachricht.

## 4. `twk_reservation_cancelled` — cancelado

**en**
> Hello {{1}}, your reservation at {{2}} on {{3}} has been cancelled. Nothing further is needed from you. Whenever you'd like another evening, just reply to this message.

**pt_BR**
> Olá {{1}}, a sua reserva no {{2}} em {{3}} foi cancelada. Você não precisa fazer mais nada. Quando quiser outra noite, é só responder a esta mensagem.

**fr**
> Bonjour {{1}}, votre réservation chez {{2}} le {{3}} a été annulée. Vous n'avez rien d'autre à faire. Pour une autre soirée, quand vous le souhaitez, répondez simplement à ce message.

**es**
> Hola {{1}}, su reserva en {{2}} el {{3}} ha sido cancelada. No necesita hacer nada más. Cuando desee otra noche, responda a este mensaje.

**it**
> Buongiorno {{1}}, la sua prenotazione da {{2}} per il {{3}} è stata annullata. Non deve fare altro. Quando vorrà un'altra serata, risponda pure a questo messaggio.

**de**
> Guten Tag {{1}}, Ihre Reservierung im {{2}} am {{3}} wurde storniert. Sie müssen nichts weiter tun. Wann immer Sie einen anderen Abend wünschen, antworten Sie einfach auf diese Nachricht.

## 5. `twk_reschedule_proposed` — nova data proposta (NÃO submeter ainda)

**en**
> Hello {{1}}, {{2}} can offer you {{3}} at {{4}} instead. Reply YES to take it, or tell me what would suit you better and I'll see what I can do.

**pt_BR**
> Olá {{1}}, o {{2}} pode recebê-lo em {{3}} às {{4}}. Responda SIM para aceitar, ou me diga o que fica melhor para você e eu vejo o que consigo.

**fr**
> Bonjour {{1}}, {{2}} peut vous proposer le {{3}} à {{4}} à la place. Répondez OUI pour accepter, ou dites-moi ce qui vous conviendrait mieux et je verrai ce que je peux faire.

**es**
> Hola {{1}}, {{2}} puede ofrecerle el {{3}} a las {{4}} en su lugar. Responda SÍ para aceptar, o dígame qué le vendría mejor y veré qué puedo hacer.

**it**
> Buongiorno {{1}}, {{2}} può proporle il {{3}} alle {{4}} in alternativa. Risponda SÌ per accettare, oppure mi dica cosa preferirebbe e vedrò cosa posso fare.

**de**
> Guten Tag {{1}}, {{2}} kann Ihnen stattdessen den {{3}} um {{4}} anbieten. Antworten Sie mit JA, um anzunehmen, oder sagen Sie mir, was Ihnen besser passt, und ich sehe, was ich tun kann.

## 6. `twk_reminder_2h` — lembrete 2 horas antes

**en**
> Hello {{1}}, your table at {{2}} is at {{3}} today. If you're running late or your plans change, just reply to this message — I'll take care of it. Enjoy your evening.

**pt_BR**
> Olá {{1}}, a sua mesa no {{2}} é hoje às {{3}}. Se estiver atrasado ou os planos mudarem, é só responder a esta mensagem — eu cuido disso. Boa noite e bom jantar.

**fr**
> Bonjour {{1}}, votre table chez {{2}} est à {{3}} aujourd'hui. En cas de retard ou de changement de programme, répondez simplement à ce message — je m'en occupe. Très belle soirée.

**es**
> Hola {{1}}, su mesa en {{2}} es hoy a las {{3}}. Si va con retraso o cambian sus planes, responda a este mensaje — yo me encargo. Que disfrute la velada.

**it**
> Buongiorno {{1}}, il suo tavolo da {{2}} è oggi alle {{3}}. Se è in ritardo o cambiano i programmi, risponda pure a questo messaggio — me ne occupo io. Buona serata.

**de**
> Guten Tag {{1}}, Ihr Tisch im {{2}} ist heute um {{3}}. Falls Sie sich verspäten oder sich Ihre Pläne ändern, antworten Sie einfach auf diese Nachricht — ich kümmere mich darum. Einen schönen Abend.

## 7. `twk_eve_briefing` — véspera

**en**
> Hello {{1}}, tomorrow is {{2}} — {{3}} at {{4}}, table for {{5}}. If you'd like directions, a suggested time to leave, or have any request for the evening, just reply here and I'll arrange it.

**pt_BR**
> Olá {{1}}, amanhã é o {{2}} — {{3}} às {{4}}, mesa para {{5}}. Se quiser o caminho, uma sugestão de horário para sair, ou tiver algum pedido para a noite, é só responder aqui que eu organizo.

**fr**
> Bonjour {{1}}, demain c'est {{2}} — le {{3}} à {{4}}, table pour {{5}}. Si vous souhaitez l'itinéraire, une heure de départ conseillée, ou avez une demande pour la soirée, répondez ici et je m'en charge.

**es**
> Hola {{1}}, mañana es {{2}} — el {{3}} a las {{4}}, mesa para {{5}}. Si desea indicaciones, una hora sugerida para salir, o tiene alguna petición para la noche, responda aquí y lo organizo.

**it**
> Buongiorno {{1}}, domani è {{2}} — il {{3}} alle {{4}}, tavolo per {{5}}. Se desidera le indicazioni, un orario consigliato per partire, o ha qualche richiesta per la serata, risponda qui e me ne occupo io.

**de**
> Guten Tag {{1}}, morgen ist es soweit: {{2}} — am {{3}} um {{4}}, Tisch für {{5}}. Wenn Sie eine Wegbeschreibung, eine empfohlene Abfahrtszeit oder einen Wunsch für den Abend haben, antworten Sie einfach hier, und ich kümmere mich darum.

## 8. `twk_review_invite` — convite de avaliação

**en**
> Hello {{1}}, how was {{2}}? A word from you helps us choose the right tables for you next time — just reply here with a few lines.

**pt_BR**
> Olá {{1}}, como foi no {{2}}? Uma palavra sua nos ajuda a escolher as mesas certas para você da próxima vez — é só responder aqui com algumas linhas.

**fr**
> Bonjour {{1}}, comment était {{2}} ? Un mot de votre part nous aide à choisir les bonnes tables pour vous la prochaine fois — répondez simplement ici en quelques lignes.

**es**
> Hola {{1}}, ¿qué tal en {{2}}? Unas palabras suyas nos ayudan a elegir las mesas adecuadas para usted la próxima vez — responda aquí con unas líneas.

**it**
> Buongiorno {{1}}, com'è andata da {{2}}? Due righe da parte sua ci aiutano a scegliere i tavoli giusti per lei la prossima volta — risponda pure qui.

**de**
> Guten Tag {{1}}, wie war es im {{2}}? Ein paar Worte von Ihnen helfen uns, beim nächsten Mal die richtigen Tische für Sie zu wählen — antworten Sie einfach hier mit ein paar Zeilen.

---

# Etapas do ESTABELECIMENTO (v9)

Só recebe a casa que estiver marcada no identificador com `tipo = 'estabelecimento'` e o `restaurant_id` dela (até 3 números por casa — o gerente, o maître…). O número pode ser diferente do telefone fixo da ficha: é o WhatsApp de quem atende. Idioma: o marcado na linha, senão o do país do número.

A Aria **não aceita nem recusa** pela casa: reservas são da plataforma. O botão leva à mesma página `/r/<código>` em que a casa já responde pelo e-mail. Amostras para a Meta: `{{1}}` = Le Tobsil · `{{2}}` = 3 Oct 2026 · `{{3}}` = 8:00 PM · `{{4}}` = 2 · `{{5}}` = Anna Lee · botão = 6DSPZXQ7.

## 9. `twk_venue_new_request` — chegou um pedido (com botão de URL)

Botão: tipo **Acessar site**, URL **dinâmica** `https://theworldkeys.com/r/{{1}}`. Texto do botão por idioma: en "Accept or decline" · pt_BR "Aceitar ou recusar" · fr "Accepter ou refuser" · es "Aceptar o rechazar" · it "Accetta o rifiuta" · de "Annehmen oder ablehnen".

**en**
> New request via The World Keys for {{1}}: table for {{4}} on {{2}} at {{3}}, in the name of {{5}}. Please accept or decline using the button below — the guest is notified automatically.

**pt_BR**
> Novo pedido pela The World Keys para o {{1}}: mesa para {{4}} em {{2}} às {{3}}, em nome de {{5}}. Aceite ou recuse pelo botão abaixo — o cliente é avisado automaticamente.

**fr**
> Nouvelle demande via The World Keys pour {{1}} : table pour {{4}} le {{2}} à {{3}}, au nom de {{5}}. Acceptez ou refusez avec le bouton ci-dessous — le client est prévenu automatiquement.

**es**
> Nueva solicitud a través de The World Keys para {{1}}: mesa para {{4}} el {{2}} a las {{3}}, a nombre de {{5}}. Acepte o rechace con el botón de abajo — el cliente recibe el aviso automáticamente.

**it**
> Nuova richiesta tramite The World Keys per {{1}}: tavolo per {{4}} il {{2}} alle {{3}}, a nome di {{5}}. Accetti o rifiuti con il pulsante qui sotto — il cliente viene avvisato automaticamente.

**de**
> Neue Anfrage über The World Keys für {{1}}: Tisch für {{4}} am {{2}} um {{3}}, auf den Namen {{5}}. Bitte über die Schaltfläche unten annehmen oder ablehnen — der Gast wird automatisch benachrichtigt.

## 10. `twk_venue_cancelled` — o cliente cancelou

**en**
> Cancellation via The World Keys for {{1}}: the table for {{4}} on {{2}} at {{3}}, in the name of {{5}}, has been cancelled by the guest. Nothing further is needed from you.

**pt_BR**
> Cancelamento pela The World Keys para o {{1}}: a mesa para {{4}} em {{2}} às {{3}}, em nome de {{5}}, foi cancelada pelo cliente. Não é preciso fazer mais nada.

**fr**
> Annulation via The World Keys pour {{1}} : la table pour {{4}} le {{2}} à {{3}}, au nom de {{5}}, a été annulée par le client. Vous n'avez rien d'autre à faire.

**es**
> Cancelación a través de The World Keys para {{1}}: la mesa para {{4}} el {{2}} a las {{3}}, a nombre de {{5}}, ha sido cancelada por el cliente. No necesita hacer nada más.

**it**
> Cancellazione tramite The World Keys per {{1}}: il tavolo per {{4}} il {{2}} alle {{3}}, a nome di {{5}}, è stato annullato dal cliente. Non deve fare altro.

**de**
> Stornierung über The World Keys für {{1}}: der Tisch für {{4}} am {{2}} um {{3}}, auf den Namen {{5}}, wurde vom Gast storniert. Sie müssen nichts weiter tun.

## 11. `twk_venue_eve_briefing` — véspera para a casa

**en**
> Reminder from The World Keys for {{1}}: tomorrow, {{2}} at {{3}}, table for {{4}} in the name of {{5}}. If anything needs adjusting, reply to this message.

**pt_BR**
> Lembrete da The World Keys para o {{1}}: amanhã, {{2}} às {{3}}, mesa para {{4}} em nome de {{5}}. Se algo precisar de ajuste, responda a esta mensagem.

**fr**
> Rappel de The World Keys pour {{1}} : demain, le {{2}} à {{3}}, table pour {{4}} au nom de {{5}}. Si quelque chose doit être ajusté, répondez à ce message.

**es**
> Recordatorio de The World Keys para {{1}}: mañana, el {{2}} a las {{3}}, mesa para {{4}} a nombre de {{5}}. Si hay que ajustar algo, responda a este mensaje.

**it**
> Promemoria da The World Keys per {{1}}: domani, il {{2}} alle {{3}}, tavolo per {{4}} a nome di {{5}}. Se c'è qualcosa da sistemare, risponda a questo messaggio.

**de**
> Erinnerung von The World Keys für {{1}}: morgen, am {{2}} um {{3}}, Tisch für {{4}} auf den Namen {{5}}. Falls etwas angepasst werden muss, antworten Sie auf diese Nachricht.

### Variáveis da casa (Easypanel da Aria)

```
RESERVATION_EVENT_TEMPLATE_VENUE_RECEBIDO=twk_venue_new_request
RESERVATION_EVENT_TEMPLATE_VENUE_CANCELADO=twk_venue_cancelled
VENUE_BRIEFING_ENABLED=true
VENUE_BRIEFING_TEMPLATE=twk_venue_eve_briefing
VENUE_BRIEFING_HOURS_BEFORE=24
```

Vazio = etapa da casa desligada (sem finding). O gatilho é o mesmo nó do n8n: a resposta do webhook passa a trazer também `estabelecimento: { acao, detalhe }`.

### Marcar uma casa

No arquivo `whatsapp-optin.sql`: linha com `tipo = 'estabelecimento'`, o `restaurant_id` da ficha e o WhatsApp de quem atende (E.164). Até 3 linhas por casa.

---

## Como configurar

### A. Na Meta (WhatsApp Manager) — por template

1. business.facebook.com → **WhatsApp Manager** → conta do número da TWK → **Modelos de mensagem** → **Criar modelo**.
2. Categoria **Utilidade**. Nome exatamente como na tabela (minúsculas, sem espaço). Idioma: começar por **English**.
3. **Corpo**: colar o texto do idioma. As variáveis `{{1}}`… já estão no texto. Não adicionar cabeçalho nem botões.
4. **Rodapé**: colar o rodapé daquele idioma.
5. **Amostras**: preencher com os exemplos (Anna / Le Tobsil / 3 Oct 2026 / 8:00 PM). Sem amostra a Meta recusa.
6. Enviar. Aprovação costuma levar de minutos a 24 h. Status **Ativo** = pode usar.
7. Para os outros idiomas: abrir o mesmo template → **Adicionar idioma** (ou "Add translation") → escolher Portuguese (BR), French, Spanish, Italian, German → repetir corpo, rodapé e amostra. O nome não muda.
8. Criação pela API: `docs/runbooks/meta-templates-por-api.md`.

Ordem sugerida pela base de clientes: **en** primeiro (maioria), depois **pt_BR** e **fr**, depois **es**, **it**, **de**.

### B. No Easypanel (serviço da Aria → Environment)

Só depois que o idioma estiver **Ativo** na Meta. Colar/ajustar:

```
RESERVATION_EVENTS_ENABLED=true
RESERVATION_EVENTS_SECRET=<uma senha longa só de letras e números — a mesma vai no n8n>
RESERVATION_EVENTS_DAILY_CAP=25

RESERVATION_EVENT_TEMPLATE_RECEBIDO=twk_reservation_received
RESERVATION_EVENT_TEMPLATE_ACEITO=twk_reservation_accepted
RESERVATION_EVENT_TEMPLATE_RECUSADO=twk_reservation_declined_v2
RESERVATION_EVENT_TEMPLATE_CANCELADO=twk_reservation_cancelled
RESERVATION_EVENT_TEMPLATE_REAGENDAMENTO=

REMINDERS_TEMPLATE=twk_reminder_2h
BRIEFING_TEMPLATE=twk_eve_briefing
REVIEW_TEMPLATE=twk_review_invite

REMINDERS_DEFAULT_LOCALE=en
REMINDERS_LOCALES=en
```

`REMINDERS_LOCALES` é a lista dos idiomas **já aprovados em todos os templates que estão ligados**. Cada vez que um idioma novo for aprovado, acrescentar: `en,pt_BR`, depois `en,pt_BR,fr`, e assim por diante. Um idioma listado sem tradução aprovada = envio recusado pela Meta. Um idioma aprovado e não listado = cliente recebe em inglês. Depois de mudar, **Redeploy**.

### C. Marcar quem recebe

Ninguém recebe nada até estar marcado (opt-in, v7). Primeira leva de 10 a 20 números com idioma: `orchestrator/agents/dba-escrita/exemplos/whatsapp-optin.sql`.

### D. Ligar o gatilho (n8n)

Um nó HTTP Request no workflow "nova reserva", depois de fechar o `/webhook/nova-reserva` aberto:

```
POST https://theworldkeys-aria-whatsapp-agent.xis4ee.easypanel.host/webhook/reservation-event
Header  x-aria-secret: <RESERVATION_EVENTS_SECRET>
Body    { "event": "pedido_recebido", "reservation_code": "<código da reserva>", "trace_id": "<id da execução>" }
```

Os lembretes (2 h, véspera, avaliação) não precisam de n8n: a Aria varre o banco sozinha.

### E. Conferir

- `/health` da Aria → build `2026-09-25-v9-…`.
- Tabela `aria_outbound_log`: cada tentativa com desfecho (`enviado`, `sem_opt_in`, `telefone_nao_enviavel`, `falha_envio` …). `falha_envio` com template certo e idioma listado = a Meta recusou; olhar o status do template no Manager.
- Meta → Qualidade do número: precisa ficar **Alta**/verde. Se cair para Baixa, parar (`RESERVATION_EVENTS_ENABLED=false`).
