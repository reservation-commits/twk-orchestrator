# Templates de WhatsApp — Wanted Chauffeur, mensagens ao cliente (19/11/2026 — **aprovado pelo fundador ("Aprovado, enviar") e enviado à Meta em 19/11, FR e EN: 4 criados; **APPROVED nos 4 em 20/11, categoria UTILITY**)

## Por que existem

Fase 2 do site de reservas (`docs/runbooks/wanted-chauffeur-ride.md`). Na Fase 1 o cliente manda a mensagem pelo botão
do WhatsApp e o Julien responde no número da marca; a Central só avisa a equipe. Aqui o cliente passa a receber, no
WhatsApp que ele mesmo escreveu no formulário ("pour la confirmation"), duas mensagens transacionais:

1. **a confirmação por escrito** no momento em que o Julien confirma (pelo link no aviso dele ou pelo painel), com a
   ficha da corrida e a referência;
2. **o lembrete**, na véspera às 8:00 PM e duas horas antes.

Saem pela Cloud API da Meta a partir da Central (`agents/wanted-chauffeur/cliente.js`), com o número que estiver em
`WC_WA_PHONE_NUMBER_ID` (o da TWK, o mesmo da Aria, ou um número só da marca na mesma conta de negócios). Nada sai sem
template aprovado, sem WhatsApp na reserva, ou para quem está em `chauffeur_nao_contatar`. Categoria **UTILITY**: falam de
uma reserva específica que já existe. Formato de ficha (cabeçalho, rótulos em negrito, data por extenso, AM/PM, sem emoji).

| # | Nome na Meta | Quem recebe · quando | Variáveis |
|---|---|---|---|
| 1 | `wc_ride_confirmed` | cliente · o Julien confirmou | 1 mission · 2 data · 3 hora · 4 nom · 5 depart · 6 montant · 7 ref |
| 2 | `wc_ride_reminder` | cliente · véspera 8:00 PM e 2 h antes | 1 quand · 2 mission · 3 hora · 4 nom · 5 depart · 6 ref |

Amostras para a Meta: mission "Game Night" · data "Mardi 24 novembre 2026" / "Tuesday, 24 November 2026" · hora "9:00 PM" ·
nom "Léa Martin" · depart "Place du Capitole" · montant "350 €" · ref "WTD-T-7K2Q" · quand "demain" / "tomorrow"
(o segundo valor possível é "dans deux heures" / "in two hours").

O que o texto NÃO diz (ADR-015): nenhum prazo de resposta, nenhum "Julien chega em X minutos"; só o que está confirmado por
escrito. O cliente que quiser mudar algo responde na própria conversa, que cai no número da marca.

## Rodapé

| Idioma | Rodapé |
|---|---|
| fr | Wanted Chauffeur · The World Keys · Toulouse |
| en | Wanted Chauffeur · The World Keys · Toulouse |

## 1. `wc_ride_confirmed` — corrida confirmada

**fr**
Cabeçalho: Course confirmée
> Votre course avec Wanted Chauffeur est confirmée par écrit.
>
> *Mission :* {{1}}
> *Date :* {{2}}
> *Heure :* {{3}}
> *Au nom de :* {{4}}
> *Départ :* {{5}}
> *Montant :* {{6}}
> *Référence :* {{7}}
>
> Julien vous attend à l'heure dite, portes ouvertes. Pour changer quelque chose, répondez à ce message.

**en**
Cabeçalho: Ride confirmed
> Your ride with Wanted Chauffeur is confirmed in writing.
>
> *Mission:* {{1}}
> *Date:* {{2}}
> *Time:* {{3}}
> *Booked for:* {{4}}
> *Pick-up:* {{5}}
> *Price:* {{6}}
> *Reference:* {{7}}
>
> Julien will be waiting at the agreed time, doors open. To change anything, reply to this message.

## 2. `wc_ride_reminder` — lembrete (véspera e 2 h antes)

**fr**
Cabeçalho: Votre chauffeur arrive
> Rappel : votre course avec Wanted Chauffeur est {{1}}.
>
> *Mission :* {{2}}
> *Heure :* {{3}}
> *Au nom de :* {{4}}
> *Départ :* {{5}}
> *Référence :* {{6}}
>
> Julien vous attend à l'heure dite. Pour changer quelque chose, répondez à ce message.

**en**
Cabeçalho: Your chauffeur is coming
> Reminder: your ride with Wanted Chauffeur is {{1}}.
>
> *Mission:* {{2}}
> *Time:* {{3}}
> *Booked for:* {{4}}
> *Pick-up:* {{5}}
> *Reference:* {{6}}
>
> Julien will be waiting at the agreed time. To change anything, reply to this message.

## Como criar (depois do "aprovado")

```
node orchestrator/agents/notificacao-reserva/meta-templates.mjs --doc docs/notificacoes/templates-meta-wc-cliente-2026-11-19.md --lang fr,en            # dry-run
node orchestrator/agents/notificacao-reserva/meta-templates.mjs --doc docs/notificacoes/templates-meta-wc-cliente-2026-11-19.md --lang fr,en --apply
node orchestrator/agents/notificacao-reserva/meta-templates.mjs --doc docs/notificacoes/templates-meta-wc-cliente-2026-11-19.md --status
```

Depois de `APPROVED` (ao menos em `fr`): no Easypanel da Central, `WC_WA_TOKEN`, `WC_WA_PHONE_NUMBER_ID` (os mesmos da Aria,
ou os do número da marca), `WC_TEMPLATE_CONFIRMED=wc_ride_confirmed`, `WC_TEMPLATE_REMINDER=wc_ride_reminder`, Deploy.
`/health` → `wanted_chauffeur.cliente` passa de `off` para `on`. Sem as variáveis nada sai e a reserva registra `sem_canal`.
