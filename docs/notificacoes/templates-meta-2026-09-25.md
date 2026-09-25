# Templates de WhatsApp para a Meta — 8 mensagens × 6 idiomas (25/09/2026)

Contrato técnico: a ordem das variáveis `{{n}}` é a que o código envia (`eventFormat.ts` e `reminders.ts`). Não mudar a ordem nem o número de variáveis. Todos em categoria **UTILITY** (transacional). Nenhum botão: o código só envia o corpo. Rodapé fixo em todos, no idioma da mensagem.

Conformidade ADR-015: nenhum texto promete prazo, disponibilidade nem confirmação que não exista; nenhum expõe processo; a data sai por extenso no idioma do cliente (o código formata).

Regra dos nomes: **o mesmo nome em todos os idiomas** (na Meta, idioma é uma "tradução" do mesmo template). Dois já existem em `pt_BR` e mantêm o nome antigo.

| # | Nome na Meta | Quem dispara | Variáveis |
|---|---|---|---|
| 1 | `twk_reservation_received` | evento `pedido_recebido` | 1 nome · 2 restaurante · 3 data · 4 hora |
| 2 | `twk_reservation_accepted` | evento `aceito` | 1 nome · 2 restaurante · 3 data · 4 hora |
| 3 | `twk_reservation_declined` | evento `recusado` | 1 nome · 2 restaurante · 3 data |
| 4 | `twk_reservation_cancelled` | evento `cancelado` | 1 nome · 2 restaurante · 3 data |
| 5 | `twk_reschedule_proposed` | evento `reagendamento_proposto` | 1 nome · 2 restaurante · 3 nova data · 4 nova hora — **não submeter ainda** (a plataforma não grava a proposta; ver fase 2) |
| 6 | `lembrete_reserva_2h` *(já existe em pt_BR)* | lembrete 2 h antes | 1 nome · 2 restaurante · 3 hora |
| 7 | `twk_eve_briefing` | véspera (~24 h antes) | 1 nome · 2 restaurante · 3 data · 4 hora |
| 8 | `avaliacao_experiencia_6h` *(já existe em pt_BR)* | 6 h depois | 1 nome · 2 restaurante |

Exemplos para o campo "amostra" da Meta (obrigatório): `{{1}}` = Anna · `{{2}}` = Le Tobsil · `{{3}}` = 3 Oct 2026 · `{{4}}` = 8:00 PM.

## Rodapé (um por idioma, igual em todos os templates)

| Idioma | Rodapé |
|---|---|
| en | Reply STOP to stop receiving reservation updates. |
| pt_BR | Responda PARAR para não receber mais avisos de reserva. |
| fr | Répondez STOP pour ne plus recevoir de nouvelles de vos réservations. |
| es | Responda STOP para dejar de recibir avisos de reserva. |
| it | Rispondi STOP per non ricevere più aggiornamenti sulle prenotazioni. |
| de | Antworten Sie mit STOP, um keine Reservierungs-Updates mehr zu erhalten. |

O código reconhece STOP, PARAR, SAIR, BAJA, ARRETER e UNSUBSCRIBE em qualquer idioma.

---

## 1. `twk_reservation_received` — pedido recebido

**en**
> Hello {{1}}, we have your request for {{2}} on {{3}} at {{4}} and we're working on it now. There's nothing you need to do — I'll write to you here as soon as I have news. If anything changes on your side, just reply to this message.

**pt_BR**
> Olá {{1}}, recebemos o seu pedido para o {{2}} em {{3}} às {{4}} e já estamos cuidando dele. Você não precisa fazer nada — escrevo aqui assim que tiver novidades. Se algo mudar do seu lado, é só responder a esta mensagem.

**fr**
> Bonjour {{1}}, nous avons bien reçu votre demande pour {{2}} le {{3}} à {{4}} et nous nous en occupons dès maintenant. Vous n'avez rien à faire — je vous écris ici dès que j'ai du nouveau. Si quelque chose change de votre côté, répondez simplement à ce message.

**es**
> Hola {{1}}, tenemos su solicitud para {{2}} el {{3}} a las {{4}} y ya estamos trabajando en ella. No necesita hacer nada — le escribo aquí en cuanto tenga novedades. Si algo cambia por su parte, responda a este mensaje.

**it**
> Buongiorno {{1}}, abbiamo ricevuto la sua richiesta per {{2}} il {{3}} alle {{4}} e ce ne stiamo già occupando. Non deve fare nulla — le scrivo qui appena ho novità. Se qualcosa cambia da parte sua, risponda pure a questo messaggio.

**de**
> Guten Tag {{1}}, wir haben Ihre Anfrage für {{2}} am {{3}} um {{4}} erhalten und kümmern uns bereits darum. Sie müssen nichts weiter tun — ich schreibe Ihnen hier, sobald es Neuigkeiten gibt. Falls sich bei Ihnen etwas ändert, antworten Sie einfach auf diese Nachricht.

## 2. `twk_reservation_accepted` — aceito

**en**
> Wonderful news, {{1}} — your table at {{2}} is confirmed for {{3}} at {{4}}. Everything is arranged. If you need to change the time, the date or the number of guests, just reply to this message.

**pt_BR**
> Ótima notícia, {{1}} — a sua mesa no {{2}} está confirmada para {{3}} às {{4}}. Está tudo organizado. Se precisar mudar o horário, a data ou o número de pessoas, é só responder a esta mensagem.

**fr**
> Excellente nouvelle, {{1}} — votre table chez {{2}} est confirmée pour le {{3}} à {{4}}. Tout est en place. Pour modifier l'heure, la date ou le nombre de convives, répondez simplement à ce message.

**es**
> Excelente noticia, {{1}} — su mesa en {{2}} está confirmada para el {{3}} a las {{4}}. Todo está organizado. Si necesita cambiar la hora, la fecha o el número de personas, responda a este mensaje.

**it**
> Ottime notizie, {{1}} — il suo tavolo da {{2}} è confermato per il {{3}} alle {{4}}. È tutto organizzato. Se ha bisogno di cambiare orario, data o numero di persone, risponda pure a questo messaggio.

**de**
> Gute Nachrichten, {{1}} — Ihr Tisch im {{2}} ist für den {{3}} um {{4}} bestätigt. Alles ist organisiert. Wenn Sie Uhrzeit, Datum oder Personenzahl ändern möchten, antworten Sie einfach auf diese Nachricht.

## 3. `twk_reservation_declined` — recusado

**en**
> {{1}}, I'm sorry — {{2}} isn't able to host you on {{3}}. I know that's a disappointment. Reply to this message and I'll look for an equally special table for the same evening.

**pt_BR**
> {{1}}, sinto muito — o {{2}} não poderá recebê-lo em {{3}}. Sei que é uma pena. Responda a esta mensagem e eu procuro uma mesa igualmente especial para a mesma noite.

**fr**
> {{1}}, je suis désolée — {{2}} ne peut pas vous recevoir le {{3}}. Je sais que c'est une déception. Répondez à ce message et je chercherai une table tout aussi spéciale pour le même soir.

**es**
> {{1}}, lo siento — {{2}} no puede recibirle el {{3}}. Sé que es una decepción. Responda a este mensaje y buscaré una mesa igual de especial para la misma noche.

**it**
> {{1}}, mi dispiace — {{2}} non può accoglierla il {{3}}. So che è una delusione. Risponda a questo messaggio e cercherò un tavolo altrettanto speciale per la stessa sera.

**de**
> {{1}}, es tut mir leid — {{2}} kann Sie am {{3}} nicht empfangen. Ich weiß, das ist enttäuschend. Antworten Sie auf diese Nachricht, und ich suche einen ebenso besonderen Tisch für denselben Abend.

## 4. `twk_reservation_cancelled` — cancelado

**en**
> {{1}}, your reservation at {{2}} on {{3}} has been cancelled. Nothing further is needed from you. Whenever you'd like another evening, just reply to this message.

**pt_BR**
> {{1}}, a sua reserva no {{2}} em {{3}} foi cancelada. Você não precisa fazer mais nada. Quando quiser outra noite, é só responder a esta mensagem.

**fr**
> {{1}}, votre réservation chez {{2}} le {{3}} a été annulée. Vous n'avez rien d'autre à faire. Pour une autre soirée, quand vous le souhaitez, répondez simplement à ce message.

**es**
> {{1}}, su reserva en {{2}} el {{3}} ha sido cancelada. No necesita hacer nada más. Cuando desee otra noche, responda a este mensaje.

**it**
> {{1}}, la sua prenotazione da {{2}} per il {{3}} è stata annullata. Non deve fare altro. Quando vorrà un'altra serata, risponda pure a questo messaggio.

**de**
> {{1}}, Ihre Reservierung im {{2}} am {{3}} wurde storniert. Sie müssen nichts weiter tun. Wann immer Sie einen anderen Abend wünschen, antworten Sie einfach auf diese Nachricht.

## 5. `twk_reschedule_proposed` — nova data proposta (NÃO submeter ainda)

**en**
> {{1}}, {{2}} can offer you {{3}} at {{4}} instead. Reply YES to take it, or tell me what would suit you better and I'll see what I can do.

**pt_BR**
> {{1}}, o {{2}} pode recebê-lo em {{3}} às {{4}}. Responda SIM para aceitar, ou me diga o que fica melhor para você e eu vejo o que consigo.

**fr**
> {{1}}, {{2}} peut vous proposer le {{3}} à {{4}} à la place. Répondez OUI pour accepter, ou dites-moi ce qui vous conviendrait mieux et je verrai ce que je peux faire.

**es**
> {{1}}, {{2}} puede ofrecerle el {{3}} a las {{4}} en su lugar. Responda SÍ para aceptar, o dígame qué le vendría mejor y veré qué puedo hacer.

**it**
> {{1}}, {{2}} può proporle il {{3}} alle {{4}} in alternativa. Risponda SÌ per accettare, oppure mi dica cosa preferirebbe e vedrò cosa posso fare.

**de**
> {{1}}, {{2}} kann Ihnen stattdessen den {{3}} um {{4}} anbieten. Antworten Sie mit JA, um anzunehmen, oder sagen Sie mir, was Ihnen besser passt, und ich sehe, was ich tun kann.

## 6. `lembrete_reserva_2h` — lembrete 2 horas antes

**en**
> {{1}}, your table at {{2}} is at {{3}} today. If you're running late or your plans change, just reply to this message — I'll take care of it. Enjoy your evening.

**pt_BR** *(conferir se o texto já aprovado é este; se for diferente, manter o aprovado)*
> {{1}}, a sua mesa no {{2}} é hoje às {{3}}. Se estiver atrasado ou os planos mudarem, é só responder a esta mensagem — eu cuido disso. Boa noite e bom jantar.

**fr**
> {{1}}, votre table chez {{2}} est à {{3}} aujourd'hui. En cas de retard ou de changement de programme, répondez simplement à ce message — je m'en occupe. Très belle soirée.

**es**
> {{1}}, su mesa en {{2}} es hoy a las {{3}}. Si va con retraso o cambian sus planes, responda a este mensaje — yo me encargo. Que disfrute la velada.

**it**
> {{1}}, il suo tavolo da {{2}} è oggi alle {{3}}. Se è in ritardo o cambiano i programmi, risponda pure a questo messaggio — me ne occupo io. Buona serata.

**de**
> {{1}}, Ihr Tisch im {{2}} ist heute um {{3}}. Falls Sie sich verspäten oder sich Ihre Pläne ändern, antworten Sie einfach auf diese Nachricht — ich kümmere mich darum. Einen schönen Abend.

## 7. `twk_eve_briefing` — véspera

**en**
> {{1}}, tomorrow is {{2}} — {{3}} at {{4}}. If you'd like directions, a suggested time to leave, or have any request for the evening, just reply here and I'll arrange it.

**pt_BR**
> {{1}}, amanhã é o {{2}} — {{3}} às {{4}}. Se quiser o caminho, uma sugestão de horário para sair, ou tiver algum pedido para a noite, é só responder aqui que eu organizo.

**fr**
> {{1}}, demain c'est {{2}} — le {{3}} à {{4}}. Si vous souhaitez l'itinéraire, une heure de départ conseillée, ou avez une demande pour la soirée, répondez ici et je m'en charge.

**es**
> {{1}}, mañana es {{2}} — el {{3}} a las {{4}}. Si desea indicaciones, una hora sugerida para salir, o tiene alguna petición para la noche, responda aquí y lo organizo.

**it**
> {{1}}, domani è {{2}} — il {{3}} alle {{4}}. Se desidera le indicazioni, un orario consigliato per partire, o ha qualche richiesta per la serata, risponda qui e me ne occupo io.

**de**
> {{1}}, morgen ist es soweit: {{2}} — am {{3}} um {{4}}. Wenn Sie eine Wegbeschreibung, eine empfohlene Abfahrtszeit oder einen Wunsch für den Abend haben, antworten Sie einfach hier, und ich kümmere mich darum.

## 8. `avaliacao_experiencia_6h` — convite de avaliação

**en**
> {{1}}, how was {{2}}? A word from you helps us choose the right tables for you next time — just reply here with a few lines.

**pt_BR** *(já aprovado — não mexer)*
> {{1}}, como foi no {{2}}? Uma palavra sua nos ajuda a escolher as mesas certas para você da próxima vez — é só responder aqui com algumas linhas.

**fr**
> {{1}}, comment était {{2}} ? Un mot de votre part nous aide à choisir les bonnes tables pour vous la prochaine fois — répondez simplement ici en quelques lignes.

**es**
> {{1}}, ¿qué tal en {{2}}? Unas palabras suyas nos ayudan a elegir las mesas adecuadas para usted la próxima vez — responda aquí con unas líneas.

**it**
> {{1}}, com'è andata da {{2}}? Due righe da parte sua ci aiutano a scegliere i tavoli giusti per lei la prossima volta — risponda pure qui.

**de**
> {{1}}, wie war es im {{2}}? Ein paar Worte von Ihnen helfen uns, beim nächsten Mal die richtigen Tische für Sie zu wählen — antworten Sie einfach hier mit ein paar Zeilen.

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
8. Os dois que já existem (`lembrete_reserva_2h` e `avaliacao_experiencia_6h`): abrir o existente e **adicionar idiomas**. Conferir por que o `lembrete_reserva_2h` foi recusado 3 vezes na semana passada: no Manager, o status dele deve estar diferente de Ativo (pausado, rejeitado ou "qualidade baixa").

Ordem sugerida pela base de clientes: **en** primeiro (maioria), depois **pt_BR** e **fr**, depois **es**, **it**, **de**.

### B. No Easypanel (serviço da Aria → Environment)

Só depois que o idioma estiver **Ativo** na Meta. Colar/ajustar:

```
RESERVATION_EVENTS_ENABLED=true
RESERVATION_EVENTS_SECRET=<uma senha longa só de letras e números — a mesma vai no n8n>
RESERVATION_EVENTS_DAILY_CAP=25

RESERVATION_EVENT_TEMPLATE_RECEBIDO=twk_reservation_received
RESERVATION_EVENT_TEMPLATE_ACEITO=twk_reservation_accepted
RESERVATION_EVENT_TEMPLATE_RECUSADO=twk_reservation_declined
RESERVATION_EVENT_TEMPLATE_CANCELADO=twk_reservation_cancelled
RESERVATION_EVENT_TEMPLATE_REAGENDAMENTO=

REMINDERS_TEMPLATE=lembrete_reserva_2h
BRIEFING_TEMPLATE=twk_eve_briefing
REVIEW_TEMPLATE=avaliacao_experiencia_6h

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

- `/health` da Aria → build `2026-09-25-v7-…`.
- Tabela `aria_outbound_log`: cada tentativa com desfecho (`enviado`, `sem_opt_in`, `telefone_nao_enviavel`, `falha_envio` …). `falha_envio` com template certo e idioma listado = a Meta recusou; olhar o status do template no Manager.
- Meta → Qualidade do número: precisa ficar **Alta**/verde. Se cair para Baixa, parar (`RESERVATION_EVENTS_ENABLED=false`).
