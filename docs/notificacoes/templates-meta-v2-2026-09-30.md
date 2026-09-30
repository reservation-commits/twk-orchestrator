# Templates de WhatsApp v2 — estrutura profissional (30/09/2026, aguardando o OK do fundador)

Motivo: o fundador recebeu o teste do template da casa em 30/09 e achou a mensagem corrida e pouco profissional ("não me parece uma msg profissional, organizada e impecável"). Esta versão troca o parágrafo único por uma **ficha**: título, uma frase de contexto, os dados da mesa um por linha com rótulo em negrito, e o que fazer. Mesmos nomes, mesma ordem de variáveis, mesmos rodapés já aprovados — só o texto muda. A troca é feita por **edição** dos templates existentes na Meta (`meta-templates.mjs --apply --edit`), o que os devolve à revisão por minutos a 24 h. Nada está ligado a ninguém ainda, então não há impacto.

## A estrutura (igual nas 10 mensagens e nos 6 idiomas)

```
CABEÇALHO        ← título curto, aparece em negrito (máx. 60 caracteres, sem variável)

Frase de contexto com o nome do destinatário.

*Restaurante:* Le Tobsil          ← rótulos em negrito, um dado por linha
*Data:* Sábado, 3 de outubro de 2026
*Horário:* 20:00
*Pessoas:* 2
*Cliente:* Anna Lee               ← só nas mensagens da casa

Uma frase com o que fazer (ou "não precisa fazer nada").

rodapé em cinza: Responda PARAR…  ← já aprovado, não muda
[ Aceitar ou recusar ]            ← só no pedido novo para a casa
```

Decisões de estilo:

- **Sem emojis.** Marca premium; o negrito dos rótulos já organiza a leitura.
- **Data por extenso com dia da semana** ("Sábado, 3 de outubro de 2026"). Exige mudança pequena no código da Aria (`formatarData`, v15): hoje sai "3 de out. de 2026". Vale para as 10 mensagens.
- **Rótulo em vez de frase corrida** também resolve o artigo antes do nome do restaurante ("no La Cucina", "chez Le Tobsil"), que ficava errado em metade dos casos.
- Cabeçalho sem emoji, sem negrito e sem variável — regras da Meta para cabeçalho de texto.
- Conformidade ADR-015 mantida: nenhum prazo, nenhuma promessa de mesa, nenhum processo interno.

Contrato técnico (não muda): ordem das variáveis = a que o código envia (`eventFormat.ts`, `venueFormat.ts`, `reminders.ts`).

| # | Nome na Meta | Quem recebe | Variáveis |
|---|---|---|---|
| 1 | `twk_reservation_received` | cliente — pedido recebido | 1 nome · 2 restaurante · 3 data · 4 hora · 5 pessoas |
| 2 | `twk_reservation_accepted` | cliente — aceito | 1 nome · 2 restaurante · 3 data · 4 hora · 5 pessoas |
| 3 | `twk_reservation_declined_v2` | cliente — recusado | 1 nome · 2 restaurante · 3 data |
| 4 | `twk_reservation_cancelled` | cliente — cancelado | 1 nome · 2 restaurante · 3 data |
| 5 | `twk_reminder_2h` | cliente — 2 h antes | 1 nome · 2 restaurante · 3 hora |
| 6 | `twk_eve_briefing` | cliente — véspera | 1 nome · 2 restaurante · 3 data · 4 hora · 5 pessoas |
| 7 | `twk_review_invite` | cliente — 6 h depois | 1 nome · 2 restaurante |
| 8 | `twk_venue_new_request` | **casa** — chegou um pedido | 1 restaurante · 2 data · 3 hora · 4 pessoas · 5 cliente · botão `https://theworldkeys.com/r/{{1}}` |
| 9 | `twk_venue_cancelled` | **casa** — o cliente cancelou | 1 restaurante · 2 data · 3 hora · 4 pessoas · 5 cliente |
| 10 | `twk_venue_eve_briefing` | **casa** — véspera | 1 restaurante · 2 data · 3 hora · 4 pessoas · 5 cliente |

Amostras para a Meta: `{{nome}}` = Anna · `{{restaurante}}` = Le Tobsil · `{{data}}` = Sábado, 3 de outubro de 2026 (no idioma) · `{{hora}}` = 20:00 (8:00 PM em inglês) · `{{pessoas}}` = 2 · `{{cliente}}` = Anna Lee · botão = 6DSPZXQ7.

## Rodapé (um por idioma, igual em todos os templates — já aprovado, não muda)

| Idioma | Rodapé |
|---|---|
| en | Reply STOP to stop receiving reservation updates. |
| pt_BR | Responda PARAR para não receber mais avisos de reserva. |
| fr | Répondez STOP pour ne plus recevoir ces messages. |
| es | Responda STOP para dejar de recibir avisos de reserva. |
| it | Rispondi STOP per non ricevere più questi messaggi. |
| de | Antworten Sie mit STOP, um keine Updates mehr zu erhalten. |

## Rótulos por idioma

| Idioma | restaurante | data | hora | pessoas | cliente (casa) |
|---|---|---|---|---|---|
| en | Restaurant | Date | Time | Guests | Guest name |
| pt_BR | Restaurante | Data | Horário | Pessoas | Cliente |
| fr | Restaurant | Date | Heure | Convives | Client |
| es | Restaurante | Fecha | Hora | Personas | Cliente |
| it | Ristorante | Data | Orario | Persone | Cliente |
| de | Restaurant | Datum | Uhrzeit | Personen | Gast |

---

# Mensagens ao CLIENTE

## 1. `twk_reservation_received` — pedido recebido

**en**
Cabeçalho: Request received
> Hello {{1}}, we have received your request and are already taking care of it.
>
> *Restaurant:* {{2}}
> *Date:* {{3}}
> *Time:* {{4}}
> *Guests:* {{5}}
>
> There is nothing you need to do. I will write to you here as soon as I have news. If anything changes on your side, simply reply to this message.

**pt_BR**
Cabeçalho: Pedido recebido
> Olá {{1}}, recebemos o seu pedido e já estamos cuidando dele.
>
> *Restaurante:* {{2}}
> *Data:* {{3}}
> *Horário:* {{4}}
> *Pessoas:* {{5}}
>
> Você não precisa fazer nada. Escrevo aqui assim que tiver novidades. Se algo mudar do seu lado, é só responder a esta mensagem.

**fr**
Cabeçalho: Demande reçue
> Bonjour {{1}}, nous avons bien reçu votre demande et nous nous en occupons dès maintenant.
>
> *Restaurant :* {{2}}
> *Date :* {{3}}
> *Heure :* {{4}}
> *Convives :* {{5}}
>
> Vous n'avez rien à faire. Je vous écris ici dès que j'ai du nouveau. Si quelque chose change de votre côté, répondez simplement à ce message.

**es**
Cabeçalho: Solicitud recibida
> Hola {{1}}, hemos recibido su solicitud y ya estamos trabajando en ella.
>
> *Restaurante:* {{2}}
> *Fecha:* {{3}}
> *Hora:* {{4}}
> *Personas:* {{5}}
>
> No necesita hacer nada. Le escribo aquí en cuanto tenga novedades. Si algo cambia por su parte, responda a este mensaje.

**it**
Cabeçalho: Richiesta ricevuta
> Buongiorno {{1}}, abbiamo ricevuto la sua richiesta e ce ne stiamo già occupando.
>
> *Ristorante:* {{2}}
> *Data:* {{3}}
> *Orario:* {{4}}
> *Persone:* {{5}}
>
> Non deve fare nulla. Le scrivo qui appena ho novità. Se qualcosa cambia da parte sua, risponda pure a questo messaggio.

**de**
Cabeçalho: Anfrage erhalten
> Guten Tag {{1}}, wir haben Ihre Anfrage erhalten und kümmern uns bereits darum.
>
> *Restaurant:* {{2}}
> *Datum:* {{3}}
> *Uhrzeit:* {{4}}
> *Personen:* {{5}}
>
> Sie müssen nichts weiter tun. Ich schreibe Ihnen hier, sobald es Neuigkeiten gibt. Falls sich bei Ihnen etwas ändert, antworten Sie einfach auf diese Nachricht.

## 2. `twk_reservation_accepted` — reserva confirmada

**en**
Cabeçalho: Reservation confirmed
> Wonderful news, {{1}}: your table is confirmed.
>
> *Restaurant:* {{2}}
> *Date:* {{3}}
> *Time:* {{4}}
> *Guests:* {{5}}
>
> Everything is arranged. If you need to change the date, the time or the number of guests, simply reply to this message.

**pt_BR**
Cabeçalho: Reserva confirmada
> Ótima notícia, {{1}}: a sua mesa está confirmada.
>
> *Restaurante:* {{2}}
> *Data:* {{3}}
> *Horário:* {{4}}
> *Pessoas:* {{5}}
>
> Está tudo organizado. Se precisar alterar a data, o horário ou o número de pessoas, é só responder a esta mensagem.

**fr**
Cabeçalho: Réservation confirmée
> Excellente nouvelle, {{1}} : votre table est confirmée.
>
> *Restaurant :* {{2}}
> *Date :* {{3}}
> *Heure :* {{4}}
> *Convives :* {{5}}
>
> Tout est en place. Pour modifier la date, l'heure ou le nombre de convives, répondez simplement à ce message.

**es**
Cabeçalho: Reserva confirmada
> Excelente noticia, {{1}}: su mesa está confirmada.
>
> *Restaurante:* {{2}}
> *Fecha:* {{3}}
> *Hora:* {{4}}
> *Personas:* {{5}}
>
> Todo está organizado. Si necesita cambiar la fecha, la hora o el número de personas, responda a este mensaje.

**it**
Cabeçalho: Prenotazione confermata
> Ottime notizie, {{1}}: il suo tavolo è confermato.
>
> *Ristorante:* {{2}}
> *Data:* {{3}}
> *Orario:* {{4}}
> *Persone:* {{5}}
>
> È tutto organizzato. Se ha bisogno di cambiare data, orario o numero di persone, risponda pure a questo messaggio.

**de**
Cabeçalho: Reservierung bestätigt
> Gute Nachrichten, {{1}}: Ihr Tisch ist bestätigt.
>
> *Restaurant:* {{2}}
> *Datum:* {{3}}
> *Uhrzeit:* {{4}}
> *Personen:* {{5}}
>
> Alles ist organisiert. Wenn Sie Datum, Uhrzeit oder Personenzahl ändern möchten, antworten Sie einfach auf diese Nachricht.

## 3. `twk_reservation_declined_v2` — não confirmado (texto seco, para a Meta manter UTILITY)

**en**
Cabeçalho: Update on your request
> Hello {{1}}, unfortunately this table could not be confirmed and the request is now closed.
>
> *Restaurant:* {{2}}
> *Date:* {{3}}
>
> If you would like us to look for another table for the same evening, reply to this message.

**pt_BR**
Cabeçalho: Sobre o seu pedido
> Olá {{1}}, infelizmente esta mesa não pôde ser confirmada e o pedido foi encerrado.
>
> *Restaurante:* {{2}}
> *Data:* {{3}}
>
> Se quiser que procuremos outra mesa para a mesma noite, responda a esta mensagem.

**fr**
Cabeçalho: Suite à votre demande
> Bonjour {{1}}, cette table n'a malheureusement pas pu être confirmée et la demande est désormais close.
>
> *Restaurant :* {{2}}
> *Date :* {{3}}
>
> Si vous souhaitez que nous cherchions une autre table pour le même soir, répondez à ce message.

**es**
Cabeçalho: Sobre su solicitud
> Hola {{1}}, lamentablemente esta mesa no pudo confirmarse y la solicitud queda cerrada.
>
> *Restaurante:* {{2}}
> *Fecha:* {{3}}
>
> Si desea que busquemos otra mesa para la misma noche, responda a este mensaje.

**it**
Cabeçalho: In merito alla sua richiesta
> Buongiorno {{1}}, purtroppo questo tavolo non ha potuto essere confermato e la richiesta è chiusa.
>
> *Ristorante:* {{2}}
> *Data:* {{3}}
>
> Se desidera che cerchiamo un altro tavolo per la stessa sera, risponda a questo messaggio.

**de**
Cabeçalho: Zu Ihrer Anfrage
> Guten Tag {{1}}, dieser Tisch konnte leider nicht bestätigt werden; die Anfrage ist damit abgeschlossen.
>
> *Restaurant:* {{2}}
> *Datum:* {{3}}
>
> Wenn wir einen anderen Tisch für denselben Abend suchen sollen, antworten Sie auf diese Nachricht.

## 4. `twk_reservation_cancelled` — reserva cancelada

**en**
Cabeçalho: Reservation cancelled
> Hello {{1}}, your reservation has been cancelled.
>
> *Restaurant:* {{2}}
> *Date:* {{3}}
>
> Nothing further is needed from you. Whenever you would like another evening, simply reply to this message.

**pt_BR**
Cabeçalho: Reserva cancelada
> Olá {{1}}, a sua reserva foi cancelada.
>
> *Restaurante:* {{2}}
> *Data:* {{3}}
>
> Você não precisa fazer mais nada. Quando quiser outra noite, é só responder a esta mensagem.

**fr**
Cabeçalho: Réservation annulée
> Bonjour {{1}}, votre réservation a été annulée.
>
> *Restaurant :* {{2}}
> *Date :* {{3}}
>
> Vous n'avez rien d'autre à faire. Pour une autre soirée, quand vous le souhaitez, répondez simplement à ce message.

**es**
Cabeçalho: Reserva cancelada
> Hola {{1}}, su reserva ha sido cancelada.
>
> *Restaurante:* {{2}}
> *Fecha:* {{3}}
>
> No necesita hacer nada más. Cuando desee otra noche, responda a este mensaje.

**it**
Cabeçalho: Prenotazione annullata
> Buongiorno {{1}}, la sua prenotazione è stata annullata.
>
> *Ristorante:* {{2}}
> *Data:* {{3}}
>
> Non deve fare altro. Quando vorrà un'altra serata, risponda pure a questo messaggio.

**de**
Cabeçalho: Reservierung storniert
> Guten Tag {{1}}, Ihre Reservierung wurde storniert.
>
> *Restaurant:* {{2}}
> *Datum:* {{3}}
>
> Sie müssen nichts weiter tun. Wann immer Sie einen anderen Abend wünschen, antworten Sie einfach auf diese Nachricht.

## 5. `twk_reminder_2h` — lembrete 2 horas antes

**en**
Cabeçalho: Your table is today
> Hello {{1}}, a reminder of your table today.
>
> *Restaurant:* {{2}}
> *Time:* {{3}}
>
> If you are running late or your plans change, simply reply to this message and I will take care of it. Enjoy your evening.

**pt_BR**
Cabeçalho: Sua mesa é hoje
> Olá {{1}}, um lembrete da sua mesa de hoje.
>
> *Restaurante:* {{2}}
> *Horário:* {{3}}
>
> Se houver atraso ou os planos mudarem, é só responder a esta mensagem que eu cuido disso. Bom jantar.

**fr**
Cabeçalho: Votre table est aujourd'hui
> Bonjour {{1}}, un rappel pour votre table d'aujourd'hui.
>
> *Restaurant :* {{2}}
> *Heure :* {{3}}
>
> En cas de retard ou de changement de programme, répondez simplement à ce message et je m'en occupe. Très belle soirée.

**es**
Cabeçalho: Su mesa es hoy
> Hola {{1}}, un recordatorio de su mesa de hoy.
>
> *Restaurante:* {{2}}
> *Hora:* {{3}}
>
> Si va con retraso o cambian sus planes, responda a este mensaje y yo me encargo. Que disfrute la velada.

**it**
Cabeçalho: Il suo tavolo è oggi
> Buongiorno {{1}}, un promemoria per il suo tavolo di oggi.
>
> *Ristorante:* {{2}}
> *Orario:* {{3}}
>
> In caso di ritardo o cambio di programma, risponda pure a questo messaggio e me ne occupo io. Buona serata.

**de**
Cabeçalho: Ihr Tisch ist heute
> Guten Tag {{1}}, eine Erinnerung an Ihren Tisch heute.
>
> *Restaurant:* {{2}}
> *Uhrzeit:* {{3}}
>
> Falls Sie sich verspäten oder sich Ihre Pläne ändern, antworten Sie einfach auf diese Nachricht, und ich kümmere mich darum. Einen schönen Abend.

## 6. `twk_eve_briefing` — véspera

**en**
Cabeçalho: Your table is tomorrow
> Hello {{1}}, your table is tomorrow.
>
> *Restaurant:* {{2}}
> *Date:* {{3}}
> *Time:* {{4}}
> *Guests:* {{5}}
>
> If you would like directions, a suggested time to leave, or have any request for the evening, simply reply here and I will arrange it.

**pt_BR**
Cabeçalho: Sua mesa é amanhã
> Olá {{1}}, a sua mesa é amanhã.
>
> *Restaurante:* {{2}}
> *Data:* {{3}}
> *Horário:* {{4}}
> *Pessoas:* {{5}}
>
> Se quiser o caminho, uma sugestão de horário para sair ou tiver algum pedido para a noite, é só responder aqui que eu organizo.

**fr**
Cabeçalho: Votre table est demain
> Bonjour {{1}}, votre table est demain.
>
> *Restaurant :* {{2}}
> *Date :* {{3}}
> *Heure :* {{4}}
> *Convives :* {{5}}
>
> Si vous souhaitez l'itinéraire, une heure de départ conseillée, ou avez une demande pour la soirée, répondez ici et je m'en charge.

**es**
Cabeçalho: Su mesa es mañana
> Hola {{1}}, su mesa es mañana.
>
> *Restaurante:* {{2}}
> *Fecha:* {{3}}
> *Hora:* {{4}}
> *Personas:* {{5}}
>
> Si desea indicaciones, una hora sugerida para salir, o tiene alguna petición para la noche, responda aquí y lo organizo.

**it**
Cabeçalho: Il suo tavolo è domani
> Buongiorno {{1}}, il suo tavolo è domani.
>
> *Ristorante:* {{2}}
> *Data:* {{3}}
> *Orario:* {{4}}
> *Persone:* {{5}}
>
> Se desidera le indicazioni, un orario consigliato per partire, o ha qualche richiesta per la serata, risponda qui e me ne occupo io.

**de**
Cabeçalho: Ihr Tisch ist morgen
> Guten Tag {{1}}, morgen ist Ihr Tisch reserviert.
>
> *Restaurant:* {{2}}
> *Datum:* {{3}}
> *Uhrzeit:* {{4}}
> *Personen:* {{5}}
>
> Wenn Sie eine Wegbeschreibung, eine empfohlene Abfahrtszeit oder einen Wunsch für den Abend haben, antworten Sie einfach hier, und ich kümmere mich darum.

## 7. `twk_review_invite` — convite de avaliação

**en**
Cabeçalho: How was your evening?
> Hello {{1}}, we hope you had a lovely evening.
>
> *Restaurant:* {{2}}
>
> A word from you helps us choose the right tables for you next time. Simply reply here with a few lines.

**pt_BR**
Cabeçalho: Como foi a sua noite?
> Olá {{1}}, esperamos que a noite tenha sido especial.
>
> *Restaurante:* {{2}}
>
> Uma palavra sua nos ajuda a escolher as mesas certas para você da próxima vez. É só responder aqui com algumas linhas.

**fr**
Cabeçalho: Comment s'est passée votre soirée ?
> Bonjour {{1}}, nous espérons que votre soirée a été belle.
>
> *Restaurant :* {{2}}
>
> Un mot de votre part nous aide à choisir les bonnes tables pour vous la prochaine fois. Répondez simplement ici en quelques lignes.

**es**
Cabeçalho: ¿Qué tal su velada?
> Hola {{1}}, esperamos que haya disfrutado de la velada.
>
> *Restaurante:* {{2}}
>
> Unas palabras suyas nos ayudan a elegir las mesas adecuadas para usted la próxima vez. Responda aquí con unas líneas.

**it**
Cabeçalho: Com'è andata la serata?
> Buongiorno {{1}}, speriamo che la serata sia stata speciale.
>
> *Ristorante:* {{2}}
>
> Due righe da parte sua ci aiutano a scegliere i tavoli giusti per lei la prossima volta. Risponda pure qui.

**de**
Cabeçalho: Wie war Ihr Abend?
> Guten Tag {{1}}, wir hoffen, Sie hatten einen schönen Abend.
>
> *Restaurant:* {{2}}
>
> Ein paar Worte von Ihnen helfen uns, beim nächsten Mal die richtigen Tische für Sie zu wählen. Antworten Sie einfach hier mit ein paar Zeilen.

---

# Mensagens ao ESTABELECIMENTO

Só recebe a casa marcada no identificador com `tipo = 'estabelecimento'` (até 3 números por casa). O botão leva à mesma página `/r/<código>` em que a casa já responde pelo e-mail; a Aria não aceita nem recusa pela casa.

## 8. `twk_venue_new_request` — chegou um pedido (com botão de URL)

Botão: tipo **Acessar site**, URL **dinâmica** `https://theworldkeys.com/r/{{1}}`. Texto do botão por idioma: en "Accept or decline" · pt_BR "Aceitar ou recusar" · fr "Accepter ou refuser" · es "Aceptar o rechazar" · it "Accetta o rifiuta" · de "Annehmen oder ablehnen".

**en**
Cabeçalho: New reservation request
> The World Keys has received a new table request for your restaurant.
>
> *Restaurant:* {{1}}
> *Date:* {{2}}
> *Time:* {{3}}
> *Guests:* {{4}}
> *Guest name:* {{5}}
>
> To accept or decline, use the button below. The guest is notified automatically.

**pt_BR**
Cabeçalho: Novo pedido de reserva
> A The World Keys recebeu um novo pedido de mesa para o seu restaurante.
>
> *Restaurante:* {{1}}
> *Data:* {{2}}
> *Horário:* {{3}}
> *Pessoas:* {{4}}
> *Cliente:* {{5}}
>
> Para aceitar ou recusar, use o botão abaixo. O cliente é avisado automaticamente.

**fr**
Cabeçalho: Nouvelle demande de réservation
> The World Keys a reçu une nouvelle demande de table pour votre restaurant.
>
> *Restaurant :* {{1}}
> *Date :* {{2}}
> *Heure :* {{3}}
> *Convives :* {{4}}
> *Client :* {{5}}
>
> Pour accepter ou refuser, utilisez le bouton ci-dessous. Le client est prévenu automatiquement.

**es**
Cabeçalho: Nueva solicitud de reserva
> The World Keys ha recibido una nueva solicitud de mesa para su restaurante.
>
> *Restaurante:* {{1}}
> *Fecha:* {{2}}
> *Hora:* {{3}}
> *Personas:* {{4}}
> *Cliente:* {{5}}
>
> Para aceptar o rechazar, use el botón de abajo. El cliente recibe el aviso automáticamente.

**it**
Cabeçalho: Nuova richiesta di prenotazione
> The World Keys ha ricevuto una nuova richiesta di tavolo per il suo ristorante.
>
> *Ristorante:* {{1}}
> *Data:* {{2}}
> *Orario:* {{3}}
> *Persone:* {{4}}
> *Cliente:* {{5}}
>
> Per accettare o rifiutare, usi il pulsante qui sotto. Il cliente viene avvisato automaticamente.

**de**
Cabeçalho: Neue Reservierungsanfrage
> The World Keys hat eine neue Tischanfrage für Ihr Restaurant erhalten.
>
> *Restaurant:* {{1}}
> *Datum:* {{2}}
> *Uhrzeit:* {{3}}
> *Personen:* {{4}}
> *Gast:* {{5}}
>
> Zum Annehmen oder Ablehnen nutzen Sie bitte die Schaltfläche unten. Der Gast wird automatisch benachrichtigt.

## 9. `twk_venue_cancelled` — o cliente cancelou

**en**
Cabeçalho: Reservation cancelled
> The guest has cancelled the following reservation made through The World Keys.
>
> *Restaurant:* {{1}}
> *Date:* {{2}}
> *Time:* {{3}}
> *Guests:* {{4}}
> *Guest name:* {{5}}
>
> Nothing further is needed from you.

**pt_BR**
Cabeçalho: Reserva cancelada
> O cliente cancelou a reserva abaixo, feita pela The World Keys.
>
> *Restaurante:* {{1}}
> *Data:* {{2}}
> *Horário:* {{3}}
> *Pessoas:* {{4}}
> *Cliente:* {{5}}
>
> Não é preciso fazer mais nada.

**fr**
Cabeçalho: Réservation annulée
> Le client a annulé la réservation ci-dessous, effectuée via The World Keys.
>
> *Restaurant :* {{1}}
> *Date :* {{2}}
> *Heure :* {{3}}
> *Convives :* {{4}}
> *Client :* {{5}}
>
> Vous n'avez rien d'autre à faire.

**es**
Cabeçalho: Reserva cancelada
> El cliente ha cancelado la siguiente reserva, realizada a través de The World Keys.
>
> *Restaurante:* {{1}}
> *Fecha:* {{2}}
> *Hora:* {{3}}
> *Personas:* {{4}}
> *Cliente:* {{5}}
>
> No necesita hacer nada más.

**it**
Cabeçalho: Prenotazione annullata
> Il cliente ha annullato la prenotazione qui sotto, effettuata tramite The World Keys.
>
> *Ristorante:* {{1}}
> *Data:* {{2}}
> *Orario:* {{3}}
> *Persone:* {{4}}
> *Cliente:* {{5}}
>
> Non deve fare altro.

**de**
Cabeçalho: Reservierung storniert
> Der Gast hat die folgende, über The World Keys vorgenommene Reservierung storniert.
>
> *Restaurant:* {{1}}
> *Datum:* {{2}}
> *Uhrzeit:* {{3}}
> *Personen:* {{4}}
> *Gast:* {{5}}
>
> Sie müssen nichts weiter tun.

## 10. `twk_venue_eve_briefing` — véspera para a casa

**en**
Cabeçalho: Reminder: tomorrow's table
> A reminder from The World Keys of tomorrow's table at your restaurant.
>
> *Restaurant:* {{1}}
> *Date:* {{2}}
> *Time:* {{3}}
> *Guests:* {{4}}
> *Guest name:* {{5}}
>
> If anything needs adjusting, reply to this message.

**pt_BR**
Cabeçalho: Lembrete: mesa de amanhã
> Lembrete da The World Keys para a mesa de amanhã no seu restaurante.
>
> *Restaurante:* {{1}}
> *Data:* {{2}}
> *Horário:* {{3}}
> *Pessoas:* {{4}}
> *Cliente:* {{5}}
>
> Se algo precisar de ajuste, responda a esta mensagem.

**fr**
Cabeçalho: Rappel : table de demain
> Rappel de The World Keys pour la table de demain dans votre restaurant.
>
> *Restaurant :* {{1}}
> *Date :* {{2}}
> *Heure :* {{3}}
> *Convives :* {{4}}
> *Client :* {{5}}
>
> Si quelque chose doit être ajusté, répondez à ce message.

**es**
Cabeçalho: Recordatorio: mesa de mañana
> Recordatorio de The World Keys para la mesa de mañana en su restaurante.
>
> *Restaurante:* {{1}}
> *Fecha:* {{2}}
> *Hora:* {{3}}
> *Personas:* {{4}}
> *Cliente:* {{5}}
>
> Si hay que ajustar algo, responda a este mensaje.

**it**
Cabeçalho: Promemoria: tavolo di domani
> Promemoria da The World Keys per il tavolo di domani nel suo ristorante.
>
> *Ristorante:* {{1}}
> *Data:* {{2}}
> *Orario:* {{3}}
> *Persone:* {{4}}
> *Cliente:* {{5}}
>
> Se c'è qualcosa da sistemare, risponda a questo messaggio.

**de**
Cabeçalho: Erinnerung: Tisch morgen
> Erinnerung von The World Keys an den morgigen Tisch in Ihrem Restaurant.
>
> *Restaurant:* {{1}}
> *Datum:* {{2}}
> *Uhrzeit:* {{3}}
> *Personen:* {{4}}
> *Gast:* {{5}}
>
> Falls etwas angepasst werden muss, antworten Sie auf diese Nachricht.

---

## Como aplicar (depois do OK do fundador)

1. `node orchestrator/agents/notificacao-reserva/meta-templates.mjs` — dry-run: valida cabeçalho, corpo, rodapé e variáveis dos 60 itens.
2. `node orchestrator/agents/notificacao-reserva/meta-templates.mjs --apply --edit` — **edita** os 60 templates existentes (mesmo nome, mesmo idioma). A Meta devolve cada um à revisão; enquanto estiver em revisão, o envio daquele idioma falha. Nada está ligado, então não há impacto.
3. `--status` até todos voltarem a **APPROVED** (minutos a 24 h).
4. Subir a Aria v15 (data por extenso com dia da semana). Sem a v15 a mensagem ainda sai, mas com "3 de out. de 2026".
5. Reenviar o teste ao fundador.

Regra da Meta: template aprovado só pode ser editado uma vez por dia e dez vezes por mês. Por isso o preview antes.
