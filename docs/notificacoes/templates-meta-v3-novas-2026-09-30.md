# Templates de WhatsApp v3 — as cinco mensagens que faltavam (30/09/2026 — **aprovado pelo fundador; 30 templates criados na Meta às 16:05 UTC, 0 falhas; Aria v16 gerada**)

Pergunta do fundador em 30/09: "falta algum tipo de notificação que contribua diretamente para uma impressão altíssima de clientes e estabelecimentos?" Resposta aprovada por ele: os itens 1 a 4 abaixo (o 5, nova data proposta pela casa, depende do desenvolvedor guardar a proposta e fica para depois).

Mesma ficha da v2 (`templates-meta-v2-2026-09-30.md`): cabeçalho, frase de contexto, dados com rótulo em negrito, frase de ação, rodapé de opt-out já aprovado. Novidade técnica: **botões de resposta rápida** nas duas mensagens ao cliente que oferecem alternativa — a resposta chega à Aria como texto ("Procurar outra mesa") e ela age. A alternativa oferecida só pode ser casa que confirma pedidos (≥ 4 em 90 dias, ≥ 50 % aceitos — ADR-015), e "procurar" nunca vira "garantir".

Dados medidos em 30/09 (twk_ro): 79 pedidos pendentes vivos, 76 com mais de 24 h, 5 para amanhã; todas as 1.546 casas publicadas têm endereço (52 caracteres em média, 199 no máximo); 1 mesa aceita para amanhã.

| # | Nome na Meta | Quem recebe · quando | Variáveis | Botões |
|---|---|---|---|---|
| 1 | `twk_request_in_progress` | cliente · 24 h depois do pedido, se ainda pendente e a mesa estiver a mais de 24 h | 1 nome · 2 restaurante · 3 data · 4 hora | resposta rápida: procurar outra mesa / prefiro aguardar |
| 2 | `twk_request_unconfirmed` | cliente · 20 h antes da mesa (ou 3 h antes, se o pedido tiver menos de 24 h de vida), se ainda pendente | 1 nome · 2 restaurante · 3 data · 4 hora | resposta rápida: procurar outra mesa / não precisa |
| 3 | `twk_venue_request_reminder` | casa · 24 h depois do pedido, se ainda pendente e a mesa a mais de 3 h | 1 restaurante · 2 data · 3 hora · 4 pessoas · 5 cliente | URL `https://theworldkeys.com/r/{{1}}` |
| 4 | `twk_eve_briefing_map` | cliente · véspera (substitui `twk_eve_briefing` quando há endereço, ou seja, sempre) | 1 nome · 2 restaurante · 3 data · 4 hora · 5 pessoas · 6 endereço | URL `https://www.google.com/maps/search/?api=1&query={{1}}` (nome + cidade, codificados) |
| 5 | `twk_venue_agenda` | casa · véspera, **uma só mensagem** quando a casa tem 2 ou mais mesas no dia (com 1 mesa continua `twk_venue_eve_briefing`) | 1 restaurante · 2 data · 3 quantidade · 4 lista "19:30 Anna Lee (2) · 20:00 Marc Dupont (4)" (≤ 250 caracteres; acima disso, "e mais N") | — |

Cada mensagem sai **uma vez por pedido** (marca de dedup em `aria_reminders_sent` / `aria_outbound_log`) e respeita o opt-in, a trava de telefone e o teto diário já existentes. Nada escreve na tabela `reservations`. Momento exato do encerramento (template 2): quando faltam 20 h ou menos para a mesa, o pedido tem ao menos 2 h de vida e ainda falta ao menos 1 h — assim o pedido de última hora também recebe.

Amostras para a Meta: nome Anna · restaurante Le Tobsil · data Sábado, 3 de outubro de 2026 (no idioma) · hora 20:00 (8:00 PM em inglês) · pessoas 2 · cliente Anna Lee · endereço 1 Derb Abdellah Ben Hessaien, Bab Ksour, Marrakech · quantidade 3 · lista 19:30 Anna Lee (2) · 20:00 Marc Dupont (4) · 21:00 Sofia Rossi (3) · botão 6DSPZXQ7 / Le%20Tobsil%20Marrakesh.

## Rodapé (o mesmo da v2, já aprovado)

| Idioma | Rodapé |
|---|---|
| en | Reply STOP to stop receiving reservation updates. |
| pt_BR | Responda PARAR para não receber mais avisos de reserva. |
| fr | Répondez STOP pour ne plus recevoir ces messages. |
| es | Responda STOP para dejar de recibir avisos de reserva. |
| it | Rispondi STOP per non ricevere più questi messaggi. |
| de | Antworten Sie mit STOP, um keine Updates mehr zu erhalten. |

## Rótulos novos

| Idioma | endereço | mesas |
|---|---|---|
| en | Address | Tables |
| pt_BR | Endereço | Mesas |
| fr | Adresse | Tables |
| es | Dirección | Mesas |
| it | Indirizzo | Tavoli |
| de | Adresse | Tische |

---

# Mensagens ao CLIENTE

## 1. `twk_request_in_progress` — seu pedido segue conosco (24 h depois, ainda pendente)

Botões de resposta: en "Look for another table" + "I'd rather wait" · pt_BR "Procurar outra mesa" + "Prefiro aguardar" · fr "Chercher une autre table" + "Je préfère attendre" · es "Buscar otra mesa" + "Prefiero esperar" · it "Cercare un altro tavolo" + "Preferisco aspettare" · de "Anderen Tisch suchen" + "Ich warte lieber".

**en**
Cabeçalho: Your request is in hand
> Hello {{1}}, your request is still with us and we are taking care of it.
>
> *Restaurant:* {{2}}
> *Date:* {{3}}
> *Time:* {{4}}
>
> If you would rather not wait, I can look for another table of the same standing for the same date. Just tap the button below.

**pt_BR**
Cabeçalho: Seu pedido segue conosco
> Olá {{1}}, o seu pedido continua conosco e seguimos cuidando dele.
>
> *Restaurante:* {{2}}
> *Data:* {{3}}
> *Horário:* {{4}}
>
> Se preferir não esperar, posso procurar outra mesa do mesmo nível para a mesma data. É só tocar no botão abaixo.

**fr**
Cabeçalho: Votre demande suit son cours
> Bonjour {{1}}, votre demande est toujours entre nos mains et nous nous en occupons.
>
> *Restaurant :* {{2}}
> *Date :* {{3}}
> *Heure :* {{4}}
>
> Si vous préférez ne pas attendre, je peux chercher une autre table du même niveau pour la même date. Il vous suffit d'appuyer sur le bouton ci-dessous.

**es**
Cabeçalho: Su solicitud sigue en curso
> Hola {{1}}, su solicitud sigue con nosotros y seguimos ocupándonos de ella.
>
> *Restaurante:* {{2}}
> *Fecha:* {{3}}
> *Hora:* {{4}}
>
> Si prefiere no esperar, puedo buscar otra mesa del mismo nivel para la misma fecha. Solo tiene que tocar el botón de abajo.

**it**
Cabeçalho: La sua richiesta è in corso
> Buongiorno {{1}}, la sua richiesta è ancora nelle nostre mani e ce ne stiamo occupando.
>
> *Ristorante:* {{2}}
> *Data:* {{3}}
> *Orario:* {{4}}
>
> Se preferisce non aspettare, posso cercare un altro tavolo dello stesso livello per la stessa data. Basta toccare il pulsante qui sotto.

**de**
Cabeçalho: Ihre Anfrage läuft
> Guten Tag {{1}}, Ihre Anfrage ist weiterhin bei uns in Bearbeitung.
>
> *Restaurant:* {{2}}
> *Datum:* {{3}}
> *Uhrzeit:* {{4}}
>
> Wenn Sie lieber nicht warten möchten, suche ich gern einen anderen Tisch auf gleichem Niveau für dasselbe Datum. Tippen Sie einfach auf die Schaltfläche unten.

## 2. `twk_request_unconfirmed` — não conseguimos confirmar a tempo (véspera, ainda pendente)

Botões de resposta: en "Look for another table" + "No, thank you" · pt_BR "Procurar outra mesa" + "Não precisa" · fr "Chercher une autre table" + "Non merci" · es "Buscar otra mesa" + "No, gracias" · it "Cercare un altro tavolo" + "No, grazie" · de "Anderen Tisch suchen" + "Nein, danke".

**en**
Cabeçalho: About your table
> Hello {{1}}, we were not able to confirm this table in time, and we would not want you to count on it.
>
> *Restaurant:* {{2}}
> *Date:* {{3}}
> *Time:* {{4}}
>
> I can look right now for another table of the same standing for the same evening. Tap the button below and I will take care of it.

**pt_BR**
Cabeçalho: Sobre a sua mesa
> Olá {{1}}, não conseguimos confirmar esta mesa a tempo, e não queremos que você conte com ela.
>
> *Restaurante:* {{2}}
> *Data:* {{3}}
> *Horário:* {{4}}
>
> Posso procurar agora outra mesa do mesmo nível para a mesma noite. Toque no botão abaixo e eu cuido disso.

**fr**
Cabeçalho: Au sujet de votre table
> Bonjour {{1}}, nous n'avons pas pu confirmer cette table à temps, et nous ne voulons pas que vous comptiez dessus.
>
> *Restaurant :* {{2}}
> *Date :* {{3}}
> *Heure :* {{4}}
>
> Je peux chercher dès maintenant une autre table du même niveau pour le même soir. Appuyez sur le bouton ci-dessous et je m'en occupe.

**es**
Cabeçalho: Sobre su mesa
> Hola {{1}}, no hemos podido confirmar esta mesa a tiempo, y no queremos que cuente con ella.
>
> *Restaurante:* {{2}}
> *Fecha:* {{3}}
> *Hora:* {{4}}
>
> Puedo buscar ahora mismo otra mesa del mismo nivel para la misma noche. Toque el botón de abajo y yo me encargo.

**it**
Cabeçalho: In merito al suo tavolo
> Buongiorno {{1}}, non siamo riusciti a confermare questo tavolo in tempo, e non vogliamo che ci faccia affidamento.
>
> *Ristorante:* {{2}}
> *Data:* {{3}}
> *Orario:* {{4}}
>
> Posso cercare subito un altro tavolo dello stesso livello per la stessa sera. Tocchi il pulsante qui sotto e me ne occupo io.

**de**
Cabeçalho: Zu Ihrem Tisch
> Guten Tag {{1}}, wir konnten diesen Tisch leider nicht rechtzeitig bestätigen, und Sie sollten nicht damit rechnen.
>
> *Restaurant:* {{2}}
> *Datum:* {{3}}
> *Uhrzeit:* {{4}}
>
> Ich suche sofort einen anderen Tisch auf gleichem Niveau für denselben Abend. Tippen Sie auf die Schaltfläche unten, und ich kümmere mich darum.

## 4. `twk_eve_briefing_map` — véspera com endereço e mapa

Botão: tipo **Acessar site**, URL **dinâmica** `https://www.google.com/maps/search/?api=1&query={{1}}`. Texto do botão por idioma: en "View on map" · pt_BR "Ver no mapa" · fr "Voir sur la carte" · es "Ver en el mapa" · it "Vedi sulla mappa" · de "Auf der Karte ansehen".

**en**
Cabeçalho: Your table is tomorrow
> Hello {{1}}, your table is tomorrow.
>
> *Restaurant:* {{2}}
> *Date:* {{3}}
> *Time:* {{4}}
> *Guests:* {{5}}
> *Address:* {{6}}
>
> If you would like a suggested time to leave, or have any request for the evening, simply reply here and I will arrange it.

**pt_BR**
Cabeçalho: Sua mesa é amanhã
> Olá {{1}}, a sua mesa é amanhã.
>
> *Restaurante:* {{2}}
> *Data:* {{3}}
> *Horário:* {{4}}
> *Pessoas:* {{5}}
> *Endereço:* {{6}}
>
> Se quiser uma sugestão de horário para sair ou tiver algum pedido para a noite, é só responder aqui que eu organizo.

**fr**
Cabeçalho: Votre table est demain
> Bonjour {{1}}, votre table est demain.
>
> *Restaurant :* {{2}}
> *Date :* {{3}}
> *Heure :* {{4}}
> *Convives :* {{5}}
> *Adresse :* {{6}}
>
> Si vous souhaitez une heure de départ conseillée, ou avez une demande pour la soirée, répondez ici et je m'en charge.

**es**
Cabeçalho: Su mesa es mañana
> Hola {{1}}, su mesa es mañana.
>
> *Restaurante:* {{2}}
> *Fecha:* {{3}}
> *Hora:* {{4}}
> *Personas:* {{5}}
> *Dirección:* {{6}}
>
> Si desea una hora sugerida para salir, o tiene alguna petición para la noche, responda aquí y lo organizo.

**it**
Cabeçalho: Il suo tavolo è domani
> Buongiorno {{1}}, il suo tavolo è domani.
>
> *Ristorante:* {{2}}
> *Data:* {{3}}
> *Orario:* {{4}}
> *Persone:* {{5}}
> *Indirizzo:* {{6}}
>
> Se desidera un orario consigliato per partire, o ha qualche richiesta per la serata, risponda qui e me ne occupo io.

**de**
Cabeçalho: Ihr Tisch ist morgen
> Guten Tag {{1}}, morgen ist Ihr Tisch reserviert.
>
> *Restaurant:* {{2}}
> *Datum:* {{3}}
> *Uhrzeit:* {{4}}
> *Personen:* {{5}}
> *Adresse:* {{6}}
>
> Wenn Sie eine empfohlene Abfahrtszeit oder einen Wunsch für den Abend haben, antworten Sie einfach hier, und ich kümmere mich darum.

---

# Mensagens ao ESTABELECIMENTO

## 3. `twk_venue_request_reminder` — pedido aguardando resposta (24 h depois, com botão)

Botão: tipo **Acessar site**, URL **dinâmica** `https://theworldkeys.com/r/{{1}}`. Texto do botão por idioma: en "Accept or decline" · pt_BR "Aceitar ou recusar" · fr "Accepter ou refuser" · es "Aceptar o rechazar" · it "Accetta o rifiuta" · de "Annehmen oder ablehnen".

**en**
Cabeçalho: Request awaiting your reply
> The request below, made through The World Keys, is still awaiting your reply.
>
> *Restaurant:* {{1}}
> *Date:* {{2}}
> *Time:* {{3}}
> *Guests:* {{4}}
> *Guest name:* {{5}}
>
> To accept or decline, use the button below. It takes less than a minute, and the guest is notified immediately.

**pt_BR**
Cabeçalho: Pedido aguardando resposta
> O pedido abaixo, feito pela The World Keys, ainda aguarda a sua resposta.
>
> *Restaurante:* {{1}}
> *Data:* {{2}}
> *Horário:* {{3}}
> *Pessoas:* {{4}}
> *Cliente:* {{5}}
>
> Para aceitar ou recusar, use o botão abaixo. Leva menos de um minuto, e o cliente é avisado na hora.

**fr**
Cabeçalho: Demande en attente de réponse
> La demande ci-dessous, effectuée via The World Keys, attend toujours votre réponse.
>
> *Restaurant :* {{1}}
> *Date :* {{2}}
> *Heure :* {{3}}
> *Convives :* {{4}}
> *Client :* {{5}}
>
> Pour accepter ou refuser, utilisez le bouton ci-dessous. Cela prend moins d'une minute, et le client est prévenu immédiatement.

**es**
Cabeçalho: Solicitud pendiente de respuesta
> La solicitud de abajo, realizada a través de The World Keys, sigue pendiente de su respuesta.
>
> *Restaurante:* {{1}}
> *Fecha:* {{2}}
> *Hora:* {{3}}
> *Personas:* {{4}}
> *Cliente:* {{5}}
>
> Para aceptar o rechazar, use el botón de abajo. Lleva menos de un minuto, y el cliente recibe el aviso al instante.

**it**
Cabeçalho: Richiesta in attesa di risposta
> La richiesta qui sotto, effettuata tramite The World Keys, è ancora in attesa di una sua risposta.
>
> *Ristorante:* {{1}}
> *Data:* {{2}}
> *Orario:* {{3}}
> *Persone:* {{4}}
> *Cliente:* {{5}}
>
> Per accettare o rifiutare, usi il pulsante qui sotto. Ci vuole meno di un minuto, e il cliente viene avvisato subito.

**de**
Cabeçalho: Anfrage wartet auf Antwort
> Die folgende Anfrage über The World Keys wartet noch auf Ihre Antwort.
>
> *Restaurant:* {{1}}
> *Datum:* {{2}}
> *Uhrzeit:* {{3}}
> *Personen:* {{4}}
> *Gast:* {{5}}
>
> Zum Annehmen oder Ablehnen nutzen Sie bitte die Schaltfläche unten. Es dauert weniger als eine Minute, und der Gast wird sofort benachrichtigt.

## 5. `twk_venue_agenda` — mesas de amanhã, uma mensagem só (2 ou mais mesas)

**en**
Cabeçalho: Tomorrow's tables
> A reminder from The World Keys: {{3}} tables tomorrow at your restaurant.
>
> *Restaurant:* {{1}}
> *Date:* {{2}}
> *Tables:* {{4}}
>
> If anything needs adjusting, reply to this message.

**pt_BR**
Cabeçalho: Mesas de amanhã
> Lembrete da The World Keys: {{3}} mesas amanhã no seu restaurante.
>
> *Restaurante:* {{1}}
> *Data:* {{2}}
> *Mesas:* {{4}}
>
> Se algo precisar de ajuste, responda a esta mensagem.

**fr**
Cabeçalho: Tables de demain
> Rappel de The World Keys : {{3}} tables demain dans votre restaurant.
>
> *Restaurant :* {{1}}
> *Date :* {{2}}
> *Tables :* {{4}}
>
> Si quelque chose doit être ajusté, répondez à ce message.

**es**
Cabeçalho: Mesas de mañana
> Recordatorio de The World Keys: {{3}} mesas mañana en su restaurante.
>
> *Restaurante:* {{1}}
> *Fecha:* {{2}}
> *Mesas:* {{4}}
>
> Si hay que ajustar algo, responda a este mensaje.

**it**
Cabeçalho: Tavoli di domani
> Promemoria da The World Keys: {{3}} tavoli domani nel suo ristorante.
>
> *Ristorante:* {{1}}
> *Data:* {{2}}
> *Tavoli:* {{4}}
>
> Se c'è qualcosa da sistemare, risponda a questo messaggio.

**de**
Cabeçalho: Tische morgen
> Erinnerung von The World Keys: {{3}} Tische morgen in Ihrem Restaurant.
>
> *Restaurant:* {{1}}
> *Datum:* {{2}}
> *Tische:* {{4}}
>
> Falls etwas angepasst werden muss, antworten Sie auf diese Nachricht.

---

## O que muda no código (Aria v16) — depois do OK

- `reminders.ts`: duas varreduras novas sobre pendências vivas (`expired_at IS NULL`): **24 h depois** (template 1) e **20 h antes / 3 h antes** (template 2), com marca de dedup (`pending_nudge`, `pending_close`). A escalação interna PENDENTE_12H continua.
- `venueEvents.ts`: lembrete à casa 24 h depois (template 3, mesma trava de opt-in, teto e dedup do pedido novo); véspera agrupada por casa (template 5 quando ≥ 2 mesas).
- `reminders.ts` véspera do cliente: usa o template 4 com `address_of_establishment` e o botão de mapa (`encodeURIComponent(nome + " " + cidade)`); cai no template antigo só se faltar endereço.
- Respostas rápidas chegam como texto (`webhook.ts` já trata `type: "button"`). Regra nova no prompt da Aria: "Procurar outra mesa" dispara a busca de alternativa só entre casas que confirmam (≥ 4 pedidos em 90 dias, ≥ 50 % aceitos); "Prefiro aguardar" / "Não precisa" recebe um agradecimento curto e nada mais.
- `meta-templates.mjs`: aprende `Botões de resposta:` (QUICK_REPLY) e a URL do mapa; validação dos textos de botão (≤ 25 caracteres).
- Variáveis novas no Easypanel: `PENDING_NUDGE_TEMPLATE`, `PENDING_NUDGE_HOURS=24`, `PENDING_CLOSE_TEMPLATE`, `PENDING_CLOSE_HOURS_BEFORE=20`, `VENUE_NUDGE_TEMPLATE`, `VENUE_NUDGE_HOURS=24`, `BRIEFING_TEMPLATE_MAP`, `VENUE_AGENDA_TEMPLATE`. Vazio = desligado.
- Eval: os cinco textos entram na suíte `notificacao-reserva` (ADR-015: sem prazo, sem disponibilidade, sem processo exposto).
