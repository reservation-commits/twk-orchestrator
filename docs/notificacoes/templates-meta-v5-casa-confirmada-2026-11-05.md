# Template de WhatsApp v5 — reserva confirmada à casa (05/11/2026 — **aprovado pelo fundador ("Aprovado, enviar") e enviado à Meta em 05/11 nos 6 idiomas; **APPROVED** nos 6 no mesmo dia**)

## Por que existe

O MONAK (Paris) confirma as reservas na hora. Nos 30 dias até 05/11, das 7 reservas da casa, 6 apareceram ao vigia da Aria **já em `Accept`**: nunca passaram por `Pending`. O aviso à casa "chegou um pedido" (`twk_venue_new_request`) só sai para reserva que nasce pendente, então a casa só soube dessas mesas pelo e-mail da plataforma. As marcadas para o mesmo dia (4 das 6) também não recebem o lembrete de véspera. Fonte: `aria_outbound_log` × `reservations`, leitura `twk_ro` em 05/11.

Com a Aria v25, reserva **nova já aceita** gera o evento da casa `confirmada` → este template. O aceite de um pedido que a própria casa respondeu (pending → accept) continua sem aviso à casa. Vale para toda casa marcada no opt-in (`aria_contact_consent`, tipo estabelecimento) que confirma automaticamente, não só para o MONAK.

| # | Nome na Meta | Quem recebe · quando | Variáveis |
|---|---|---|---|
| 1 | `twk_venue_confirmed` | **casa** — reserva nova que já chega confirmada | 1 restaurante · 2 data · 3 hora · 4 pessoas · 5 cliente |

Mesmas variáveis, na mesma ordem, de `twk_venue_new_request`, `twk_venue_cancelled` e `twk_venue_eve_briefing` (`montarParametrosEstabelecimento`). Sem botão: a reserva já está aceita e não há nada a decidir. Categoria UTILITY.

Amostras para a Meta: `{{restaurante}}` = Le Tobsil · `{{data}}` = Sábado, 3 de outubro de 2026 (no idioma) · `{{hora}}` = 8:00 PM (desde a v25 a hora sai em AM/PM em todos os idiomas) · `{{pessoas}}` = 2 · `{{cliente}}` = Anna Lee.

O texto não diz que o cliente "já foi avisado" (o aviso ao cliente depende do opt-in dele) nem promete lembrete de véspera (não sai para mesa do mesmo dia). ADR-015: nunca afirmar o que não existe.

## Rodapé (um por idioma, igual em todos os templates — já aprovado, não muda)

| Idioma | Rodapé |
|---|---|
| en | Reply STOP to stop receiving reservation updates. |
| pt_BR | Responda PARAR para não receber mais avisos de reserva. |
| fr | Répondez STOP pour ne plus recevoir ces messages. |
| es | Responda STOP para dejar de recibir avisos de reserva. |
| it | Rispondi STOP per non ricevere più questi messaggi. |
| de | Antworten Sie mit STOP, um keine Updates mehr zu erhalten. |

## 1. `twk_venue_confirmed` — reserva confirmada

**en**
Cabeçalho: New confirmed reservation
> A new reservation for your restaurant has been confirmed through The World Keys.
>
> *Restaurant:* {{1}}
> *Date:* {{2}}
> *Time:* {{3}}
> *Guests:* {{4}}
> *Guest name:* {{5}}
>
> Nothing further is needed from you.

**pt_BR**
Cabeçalho: Nova reserva confirmada
> Uma nova reserva para o seu restaurante foi confirmada pela The World Keys.
>
> *Restaurante:* {{1}}
> *Data:* {{2}}
> *Horário:* {{3}}
> *Pessoas:* {{4}}
> *Cliente:* {{5}}
>
> Não é preciso fazer mais nada.

**fr**
Cabeçalho: Nouvelle réservation confirmée
> Une nouvelle réservation pour votre restaurant a été confirmée via The World Keys.
>
> *Restaurant :* {{1}}
> *Date :* {{2}}
> *Heure :* {{3}}
> *Convives :* {{4}}
> *Client :* {{5}}
>
> Vous n'avez rien d'autre à faire.

**es**
Cabeçalho: Nueva reserva confirmada
> Se ha confirmado una nueva reserva para su restaurante a través de The World Keys.
>
> *Restaurante:* {{1}}
> *Fecha:* {{2}}
> *Hora:* {{3}}
> *Personas:* {{4}}
> *Cliente:* {{5}}
>
> No necesita hacer nada más.

**it**
Cabeçalho: Nuova prenotazione confermata
> È stata confermata una nuova prenotazione per il suo ristorante tramite The World Keys.
>
> *Ristorante:* {{1}}
> *Data:* {{2}}
> *Orario:* {{3}}
> *Persone:* {{4}}
> *Cliente:* {{5}}
>
> Non deve fare altro.

**de**
Cabeçalho: Neue bestätigte Reservierung
> Für Ihr Restaurant wurde über The World Keys eine neue Reservierung bestätigt.
>
> *Restaurant:* {{1}}
> *Datum:* {{2}}
> *Uhrzeit:* {{3}}
> *Personen:* {{4}}
> *Gast:* {{5}}
>
> Sie müssen nichts weiter tun.

## Como criar (depois do "aprovado")

```
node orchestrator/agents/notificacao-reserva/meta-templates.mjs --doc docs/notificacoes/templates-meta-v5-casa-confirmada-2026-11-05.md            # dry-run
node orchestrator/agents/notificacao-reserva/meta-templates.mjs --doc docs/notificacoes/templates-meta-v5-casa-confirmada-2026-11-05.md --apply
node orchestrator/agents/notificacao-reserva/meta-templates.mjs --doc docs/notificacoes/templates-meta-v5-casa-confirmada-2026-11-05.md --status
```

Depois de aprovado pela Meta (ao menos em `fr`, o idioma do MONAK), no Easypanel da Aria: `RESERVATION_EVENT_TEMPLATE_VENUE_CONFIRMADA=twk_venue_confirmed`, deploy da Aria v25, e conferir `/health` → `etapas.confirmadaCasa: true` e `notificacoes.templates.casaConfirmada`. Sem a variável, a etapa fica desligada e nada sai (desfecho `sem_template`, sem finding).
