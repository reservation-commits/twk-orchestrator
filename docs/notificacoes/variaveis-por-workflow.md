# Variáveis por workflow — notificações n8n (The World Keys)

Mapeamento técnico extraído diretamente dos nós do n8n em 2026-08-25 (leitura via MCP `get_workflow_details`).
Base URL de produção de todos os webhooks: `https://theworldkeys-n8n.xis4ee.easypanel.host/webhook/<path>` (método POST, resposta imediata "Workflow got started.", sem autenticação).

As expressões estão copiadas **exatamente** como aparecem nos nós. Regra geral observada: nós Gmail que recebem o output do Code node diretamente usam `$json.X`; nós encadeados depois de outro Gmail referenciam `$('Code in JavaScript').item.json.X`.

---

## 1. "3 - resposta do restaurante (site novo)" — id `YDOdJQ46C8okIIdm`

**Webhook**: path `rest-resposta` (POST). Fluxo: Webhook → Code in JavaScript → Switch `verifica` → e-mails.

### Body esperado

| Campo | Uso |
|---|---|
| `body.action` | roteamento no Switch (`accept` / `decline` / `reschedule`) |
| `body.reservation.date` | Code (formattedDate) |
| `body.reservation.time` | Code (formattedTime) |
| `body.reservation.people` | Code (formattedPeople) |
| `body.reservation.details` | Code (formattedDetails) |
| `body.reservation.reservation_code` | e-mails (ID) |
| `body.proposed_time` | Code (formattedProposedTime) — só no fluxo reschedule |
| `body.proposed_date` | Code (formattedProposedDate) — só no fluxo reschedule |
| `body.user.name`, `body.user.email` | e-mails ao cliente |
| `body.restaurant.name`, `body.restaurant.email` | e-mails ao estabelecimento |
| `body.reschedule.accept_url`, `body.reschedule.decline_url` | botões do e-mail de reagendamento |

### Nó Code: `Code in JavaScript`

Produz: `formattedDate` ("Thu, 17 Aug 2025"), `formattedProposedDate` (ou `null`), `formattedTime` ("9:00 PM"), `formattedProposedTime` (ou `null`), `formattedPeople` ("1 guest"/"4 guests"), `formattedDetails` (default "No details.").
Referenciar como `$('Code in JavaScript').item.json.X`.

### Roteamento: Switch `verifica` (sobre `={{ $('Webhook').item.json.body.action }}`)

| Valor de `body.action` | Saída | Destino |
|---|---|---|
| `accept` | `aceito` | Customer (Accept) → Establishment (Accept) |
| `decline` | `recusado` | Customer (Decline) → Establishment (Decline) |
| `reschedule` | `reagendar` | Customer (Reschedule) (sem e-mail ao estabelecimento) |

### Nós Gmail

| Nó | sendTo | subject | Expressões no HTML |
|---|---|---|---|
| `Customer (Accept)` | `={{ $('Webhook').item.json.body.user.email }}` | Reservation Confirmed Successfully! | `{{ $('Webhook').item.json.body.restaurant.name }}` · `{{ $('Webhook').item.json.body.user.name }}` · `{{ $('Code in JavaScript').item.json.formattedDate }}` · `{{ $('Code in JavaScript').item.json.formattedTime }}` · `{{ $('Code in JavaScript').item.json.formattedPeople }}` · `{{ $('Code in JavaScript').item.json.formattedDetails }}` · `{{ $('Webhook').item.json.body.reservation.reservation_code }}` |
| `Customer (Decline)` | `={{ $('Webhook').item.json.body.user.email }}` | Your Reservation Couldn’t Be Confirmed | `{{ $('Webhook').item.json.body.user.name }}` (2x) · `{{ $('Webhook').item.json.body.restaurant.name }}` (2x) · `{{ $('Code in JavaScript').item.json.formattedDate }}` · `{{ $('Code in JavaScript').item.json.formattedTime }}` · `{{ $('Code in JavaScript').item.json.formattedPeople }}` · `{{ $('Code in JavaScript').item.json.formattedDetails }}` · `{{ $('Webhook').item.json.body.reservation.reservation_code }}` |
| `Customer (Reschedule)` | `={{ $('Webhook').item.json.body.user.email }}` | Your Reservation Has Been Rescheduled! | `{{ $('Webhook').item.json.body.restaurant.name }}` · `{{ $('Code in JavaScript').item.json.formattedDate }}` · `{{ $('Code in JavaScript').item.json.formattedTime }}` · `{{ $('Code in JavaScript').item.json.formattedProposedDate }}` · `{{ $('Code in JavaScript').item.json.formattedProposedTime }}` · `{{ $('Webhook').item.json.body.reschedule.accept_url }}` · `{{ $('Webhook').item.json.body.reschedule.decline_url }}` |
| `Establishment (Accept)` | `={{ $('Webhook').item.json.body.restaurant.email }}` | Reservation Successfully Confirmed | `{{ $('Webhook').item.json.body.restaurant.name }}` · `{{ $('Webhook').item.json.body.user.name }}` · `{{ $('Code in JavaScript').item.json.formattedDate }}` · `{{ $('Code in JavaScript').item.json.formattedTime }}` · `{{ $('Code in JavaScript').item.json.formattedPeople }}` · `{{ $('Code in JavaScript').item.json.formattedDetails }}` · `{{ $('Webhook').item.json.body.reservation.reservation_code }}` |
| `Establishment (Decline)` | `={{ $('Webhook').item.json.body.restaurant.email }}` | Reservation Refused | `{{ $('Webhook').item.json.body.restaurant.name }}` · `{{ $('Webhook').item.json.body.user.name }}` · `{{ $('Code in JavaScript').item.json.formattedDate }}` · `{{ $('Code in JavaScript').item.json.formattedTime }}` · `{{ $('Code in JavaScript').item.json.formattedPeople }}` · `{{ $('Code in JavaScript').item.json.formattedDetails }}` · `{{ $('Webhook').item.json.body.reservation.reservation_code }}` |

Observação: no fluxo `reschedule` **não há** e-mail ao estabelecimento; o Customer (Reschedule) também **não** exibe `formattedPeople`/`formattedDetails`/`reservation_code`.

---

## 2. "4 - resposta ao reagendamento (site novo)" — id `8sKe89Lz5Vzpy3a5`

**Webhook**: path `reschedule-response` (POST). Fluxo: Webhook → Code in JavaScript → If → e-mails cliente → e-mails estabelecimento.

### Body esperado

| Campo | Uso |
|---|---|
| `body.action` | If (`accept` = true) |
| `body.reservation.date`, `body.reservation.time`, `body.reservation.proposed_time`, `body.reservation.people`, `body.reservation.details` | Code node (atenção: aqui `proposed_time` está **dentro** de `reservation`, diferente do workflow 3) |
| `body.reservation.reservation_code` | e-mails (ID) |
| `body.user.name`, `body.user.email` | e-mails ao cliente |
| `body.restaurant.name`, `body.restaurant.email` | e-mails ao estabelecimento |

### Nó Code: `Code in JavaScript`

Produz: `formattedDate`, `formattedTime`, `formattedProposedTime`, `formattedPeople`, `formattedDetails`.
Referenciar como `$('Code in JavaScript').item.json.X`.

### Roteamento: If (`={{ $('Webhook').item.json.body.action }}` equals `accept`)

| Condição | Destino |
|---|---|
| `body.action == "accept"` (true) | Confirmado - Cliente → Confirmado - Estabelecimento |
| qualquer outro valor (false) | Recusado - Cliente → Recusado - Estabelecimento |

### Nós Gmail

| Nó | sendTo | subject | Expressões no HTML |
|---|---|---|---|
| `Confirmado - Cliente` | `={{ $('Webhook').item.json.body.user.email }}` | Your Rescheduled Reservation is Confirmed | `{{ $('Webhook').item.json.body.user.name }}` · `{{ $('Webhook').item.json.body.restaurant.name }}` · `{{ $json.formattedDate }}` · `{{ $json.formattedProposedTime }}` · `{{ $json.formattedPeople }}` · `{{ $json.formattedDetails }}` · `{{ $('Webhook').item.json.body.reservation.reservation_code }}` |
| `Confirmado - Estabelecimento` | `={{ $('Webhook').item.json.body.restaurant.email }}` | Reschedule Confirmed by Client | `{{ $('Webhook').item.json.body.restaurant.name }}` · `{{ $('Webhook').item.json.body.user.name }}` · `{{ $('Code in JavaScript').item.json.formattedDate }}` · `{{ $('Code in JavaScript').item.json.formattedProposedTime }}` · `{{ $('Code in JavaScript').item.json.formattedPeople }}` · `{{ $('Code in JavaScript').item.json.formattedDetails }}` · `{{ $('Webhook').item.json.body.reservation.reservation_code }}` |
| `Recusado - Cliente` | `={{ $('Webhook').item.json.body.user.email }}` | Reschedule Declined | `{{ $('Webhook').item.json.body.user.name }}` · `{{ $('Webhook').item.json.body.restaurant.name }}` · `{{ $json.formattedDate }}` · `{{ $('Code in JavaScript').item.json.formattedProposedTime }}` · `{{ $json.formattedPeople }}` · `{{ $json.formattedDetails }}` · `{{ $('Webhook').item.json.body.reservation.reservation_code }}` |
| `Recusado - Estabelecimento` | `={{ $('Webhook').item.json.body.restaurant.email }}` | Reschedule Declined by Client | `{{ $('Webhook').item.json.body.restaurant.name }}` · `{{ $('Webhook').item.json.body.user.name }}` · `{{ $('Code in JavaScript').item.json.formattedDate }}` · `{{ $('Code in JavaScript').item.json.formattedProposedTime }}` · `{{ $('Code in JavaScript').item.json.formattedPeople }}` · `{{ $('Code in JavaScript').item.json.formattedDetails }}` · `{{ $('Webhook').item.json.body.reservation.reservation_code }}` |

**Bugs no HTML atual** (registrar como fato, não corrigido aqui):
- `Confirmado - Estabelecimento`: a mensagem começa com um `</tr>` solto antes do `<!DOCTYPE html>`.
- `Recusado - Estabelecimento`: a mensagem começa com `Dear <strong>Monak Paris</strong>` **hardcoded** antes do `<!DOCTYPE html>` — nome de restaurante fixo vazando para todos os destinatários.

---

## 3. "5 - botão de cancelamento (site novo)" — id `6sIa2gOyhVdZyAc6`

**Webhook**: path `client-cancel` (POST). Fluxo linear, sem roteamento: Webhook → Code in JavaScript → Cancel Button - Usuário → Cancel Button - Establishment.

### Body esperado

| Campo | Uso |
|---|---|
| `body.reservation.date`, `body.reservation.time`, `body.reservation.people`, `body.reservation.details` | Code node |
| `body.reservation.reservation_code` | e-mails (ID) |
| `body.user.name`, `body.user.email` | e-mail ao cliente |
| `body.restaurant.name`, `body.restaurant.email` | e-mail ao estabelecimento |

### Nó Code: `Code in JavaScript`

Produz: `formattedDate`, `formattedTime`, `formattedPeople`, `formattedDetails`. Referenciar como `$('Code in JavaScript').item.json.X`.

### Nós Gmail

| Nó | sendTo | subject | Expressões no HTML |
|---|---|---|---|
| `Cancel Button - Usuário` | `={{ $('Webhook').item.json.body.user.email }}` | Reservation Successfully Cancelled | `{{ $('Webhook').item.json.body.user.name }}` · `{{ $('Webhook').item.json.body.restaurant.name }}` · `{{ $json.formattedDate }}` · `{{ $json.formattedTime }}` · `{{ $json.formattedPeople }}` · `{{ $json.formattedDetails }}` · `{{ $('Webhook').item.json.body.reservation.reservation_code }}` |
| `Cancel Button - Establishment` | `={{ $('Webhook').item.json.body.restaurant.email }}` | Reservation Canceled by Client | `{{ $('Webhook').item.json.body.restaurant.name }}` · `{{ $('Webhook').item.json.body.user.name }}` · `{{ $('Code in JavaScript').item.json.formattedDate }}` · `{{ $('Code in JavaScript').item.json.formattedTime }}` · `{{ $('Code in JavaScript').item.json.formattedPeople }}` · `{{ $('Code in JavaScript').item.json.formattedDetails }}` · `{{ $('Webhook').item.json.body.reservation.reservation_code }}` |

---

## 4. "6 - desativação de conta (site novo)" — id `xn33VGxkjsasnGlo`

**Webhook**: path `account-deletion` (POST). Fluxo mínimo: Webhook → Send a message. Sem Code node, sem roteamento.

### Body esperado

| Campo | Uso |
|---|---|
| `body.email` | destinatário |
| `body.name` | saudação |

### Nó Gmail

| Nó | sendTo | subject | Expressões no HTML |
|---|---|---|---|
| `Send a message` | `={{ $json.body.email }}` | Account Deactivation Confirmed | `{{ $json.body.name }}` (única variável do e-mail) |

Observação: como o Gmail vem direto do Webhook, as referências são `$json.body.X` (não `$('Webhook')...`).

---

## 5. "alteração na reserva (site novo)" — id `WwHnwL8P0hkcgCaz`

**Webhook**: path `reservation-change` (POST). Fluxo: Webhook → Code in JavaScript → (em paralelo) `notifica cliente` e `Recusado - Estabelecimento`. **Não há If/Switch** — os dois e-mails saem sempre.

### Body esperado

| Campo | Uso |
|---|---|
| `body.reservation.date`, `body.reservation.time`, `body.reservation.people`, `body.reservation.details` | Code node (valores novos) |
| `body.reservation.reservation_code` | e-mails (ID) |
| `body.previous.date`, `body.previous.time`, `body.previous.people`, `body.previous.details` | Code node (valores anteriores — opcionais) |
| `body.user.name`, `body.user.email`, `body.user.phone` | e-mails |
| `body.restaurant.name`, `body.restaurant.email` | e-mail ao estabelecimento |
| `body.management_url` | botão "Manage My Reservation" do e-mail ao cliente |

### Nó Code: `Code in JavaScript`

Produz: `formattedDate`, `formattedTime`, `formattedProposedTime` (= horário **anterior**, vindo de `previous.time`), `formattedPeople`, `formattedDetails`, `previousDate`, `formattedPreviousTime`, `formattedPreviousPeople`, `formattedPreviousDetails`.
Atenção: os campos `previous*` são produzidos mas **nenhum e-mail os usa** hoje.

### Nós Gmail

| Nó | sendTo | subject | Expressões no HTML |
|---|---|---|---|
| `notifica cliente` | `={{ $('Webhook').item.json.body.user.email }}` | Your Reservation Has Been Updated | `{{ $('Webhook').item.json.body.user.name }}` · `{{ $('Webhook').item.json.body.restaurant.name }}` · `{{ $json.formattedDate }}` · `{{ $json.formattedTime }}` · `{{ $json.formattedPeople }}` · `{{ $json.formattedDetails }}` · `{{ $('Webhook').item.json.body.reservation.reservation_code }}` · `{{ $('Webhook').item.json.body.management_url }}` (href do CTA) |
| `Recusado - Estabelecimento` | `={{ $('Webhook').item.json.body.restaurant.email }}` | Reservation Updated — Pending Confirmation | `{{ $('Webhook').item.json.body.user.name }}` · `{{ $('Webhook').item.json.body.user.email }}` · `{{ $('Webhook').item.json.body.user.phone }}` · `{{ $json.formattedDate }}` · `{{ $json.formattedTime }}` · `{{ $json.formattedPeople }}` · `{{ $json.formattedDetails }}` · `{{ $('Webhook').item.json.body.reservation.reservation_code }}` |

**Bugs/armadilhas no estado atual**:
- `notifica cliente`: o campo message começa com ```` ```html ```` e termina com ```` ``` ```` (cerca de código Markdown colada dentro do HTML) — esse texto literal vai junto no e-mail.
- O nó do estabelecimento chama-se `Recusado - Estabelecimento` (nome copiado do workflow 4), mas é o aviso de "Reservation Updated". Qualquer referência `$('Recusado - Estabelecimento')` deve usar esse nome exato.

---

## 6. "envia email resetar senha" — id `1pc2qJX4kYkBni3s`

**Webhook**: path `reset-password` (POST). Fluxo: Webhook → Send a message. Sem Code node, sem roteamento.

### Body esperado

| Campo | Uso |
|---|---|
| `body.email` | destinatário |
| `body.name` | saudação |
| `body.resetUrl` | link de reset (botão + fallback em texto) |

### Nó Gmail

| Nó | sendTo | subject | Expressões no HTML |
|---|---|---|---|
| `Send a message` | `={{ $json.body.email }}` | Reset Your Password — The World Keys | `{{ $json.body.name }}` · `{{ $json.body.resetUrl }}` (2x: href do botão e link fallback em texto) |

---

## 7. "envia email de confirmação de solicitacao de parceria" — id `TkC4zLu3uA6B01Ii`

**Webhook**: path `request-confirmation` (POST). Fluxo: Webhook → Send a message. Sem Code node, sem roteamento.

Atenção ao nome × conteúdo: apesar do nome "confirmação de solicitação", este workflow envia o e-mail de **aprovação** da parceria ("Your Partnership Application Has Been Approved"). O e-mail de "recebemos sua solicitação" é o workflow 8 (`invite`).

### Body esperado

| Campo | Uso |
|---|---|
| `body.email` | destinatário + citado no corpo |
| `body.fullName` | primeiro nome extraído via `.split(' ')[0]` |
| `body.restaurantName` | nome do restaurante aprovado |

### Nó Gmail

| Nó | sendTo | subject | Expressões no HTML |
|---|---|---|---|
| `Send a message` | `={{ $json.body.email }}` | Your Partnership Application Has Been Approved | `{{ $json.body.fullName.split(' ')[0] }}` (2x: preheader e saudação) · `{{ $json.body.restaurantName }}` · `{{ $json.body.email }}` |

Observação: template visual diferente dos demais (tema claro "Partners & Restaurants", não o template preto/dourado). Link de WhatsApp do rodapé aponta para `https://wa.me/5521967841007` (número brasileiro), não o +33 usado nos outros e-mails.

---

## 8. "envia email de resposta a solicitacao de parceria" — id `6ONkRN-zDsy0qpvXBn6NH`

**Webhook**: path `invite` (POST). Fluxo: Webhook → Send a message. Sem Code node, sem roteamento.

Conteúdo real: acknowledgment "We've Received Your Partnership Application" (recebemos e estamos analisando) — o par lógico do workflow 7.

### Body esperado

| Campo | Uso |
|---|---|
| `body.email` | destinatário + citado no corpo |
| `body.fullName` | primeiro nome (`.split(' ')[0]`) e nome completo no resumo |
| `body.phone` | citado no corpo |
| `body.jobTitle` | resumo da aplicação |
| `body.restaurantName` | nome do restaurante (com fallback) |
| `body.publicListingSlug` | fallback quando `restaurantName` está vazio |
| `body.applicationType` | `'link'` → "Link Existing Listing"; caso contrário → "New Restaurant" |

### Nó Gmail

| Nó | sendTo | subject | Expressões no HTML |
|---|---|---|---|
| `Send a message` | `={{ $json.body.email }}` | We've Received Your Partnership Application | `{{ $json.body.fullName.split(' ')[0] }}` (2x: preheader e saudação) · `{{ $json.body.restaurantName \|\| $json.body.publicListingSlug }}` (2x: corpo e resumo) · `{{ $json.body.email }}` · `{{ $json.body.phone }}` · `{{ $json.body.fullName }}` · `{{ $json.body.jobTitle }}` · `{{ $json.body.applicationType === 'link' ? 'Link Existing Listing' : 'New Restaurant' }}` |

Observação: mesmo template claro do workflow 7, mesmo WhatsApp brasileiro `wa.me/5521967841007` no rodapé.

---

## Resumo transversal

| Workflow | Path | Nós Gmail | Roteamento |
|---|---|---|---|
| 3 - resposta do restaurante | `rest-resposta` | 5 | Switch `verifica` por `body.action` (accept/decline/reschedule) |
| 4 - resposta ao reagendamento | `reschedule-response` | 4 | If por `body.action == accept` |
| 5 - botão de cancelamento | `client-cancel` | 2 | nenhum (sequencial) |
| 6 - desativação de conta | `account-deletion` | 1 | nenhum |
| alteração na reserva | `reservation-change` | 2 | nenhum (paralelo) |
| envia email resetar senha | `reset-password` | 1 | nenhum |
| confirmação de parceria (= aprovação) | `request-confirmation` | 1 | nenhum |
| resposta a parceria (= recebimento) | `invite` | 1 | nenhum |

**Inconsistências a considerar ao gerar templates** (fatos verificados nos nós em 2026-08-25):
1. `proposed_time`/`proposed_date` ficam na **raiz do body** no workflow 3, mas dentro de `body.reservation` no workflow 4.
2. Workflow 4 / `Recusado - Estabelecimento`: "Dear Monak Paris" hardcoded antes do DOCTYPE.
3. Workflow 4 / `Confirmado - Estabelecimento`: `</tr>` solto antes do DOCTYPE.
4. Workflow "alteração na reserva" / `notifica cliente`: message envolto em cerca Markdown ```` ```html ````.
5. Nomes de nó enganosos: `Recusado - Estabelecimento` no workflow de alteração de reserva (não é recusa).
6. Nomes de workflow trocados nos fluxos de parceria: `request-confirmation` envia a aprovação; `invite` envia o acknowledgment de recebimento.
7. Rodapés divergem: template preto/dourado usa `wa.me/33781937270`; templates de parceria usam `wa.me/5521967841007`.
8. Campos `previous*` do Code node de alteração de reserva são calculados mas não usados em nenhum e-mail.
