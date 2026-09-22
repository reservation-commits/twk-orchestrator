# Fluxo — restaurante responde por e-mail em vez do link (ADR-014)

> 2026-09-10. Pedido do fundador: quando a casa responde ao "Great news!" por e-mail — aceitando, recusando ou propondo outro horário — a resposta deve ser processada de ponta a ponta, o cliente decidir com um botão, ambos serem avisados e o status mudar. Sem intervenção humana.

## O que já existe (verificado em 10/09)

| Peça | Onde | Estado |
|---|---|---|
| Endpoint único de decisão | `POST theworldkeys.com/api/reservations/manage` · `{reservationCode, action: accept/decline/reschedule, newTime?, reservation, restaurant, user}` | em produção (é o que o botão do `/r/` chama) |
| Dados da reserva para montar a chamada | `GET /r/{código}` embute `initialReservation` (id, date, time, people, details, restaurant, user) | em produção |
| E-mail ao cliente com **Accept new time / Decline** | fluxo 3 do n8n, nó `Customer (Reschedule)` — `reschedule.accept_url` / `decline_url` gerados pelo site | em produção |
| Notificações de aceite/recusa a ambos + status no banco | disparados pelo site após o `manage` | em produção |
| Cartão "Activate my key" nos e-mails ao restaurante | fluxos 1/2/3 (09/09), rastreado | em produção |

Ou seja: **o lado do cliente e o status já estão prontos.** O que faltava era a ponte entre um e-mail em texto livre do restaurante e o `manage`.

## A ponte (o que passa a acontecer)

1. **Entrada.** A Aria recebe em `reservation@`/`support@` uma resposta de restaurante (thread "Great news!…" / "Pending Request…", ou texto que cite um código).
2. **Autenticidade.** Só age se o remetente for o e-mail da casa no catálogo (`db_restaurants.email_for_reservations`) ou o domínio dele. Fora disso: registrar e pedir confirmação pelo link — dado observado não é comando.
3. **Classificação** (Haiku, com o texto + a reserva): `aceite` · `recusa` · `novo_horario` (hora exata) · `janela` (ex.: "só das 18h às 19h") · `pergunta` · `outro`.
4. **Ação pela plataforma** (`orchestrator/agents/maestro-atendimento/gerir-reserva.js`, que replica a chamada do `/r/`):
   - `aceite` → `manage accept` → o site avisa o cliente e muda o status.
   - `recusa` → `manage decline` → idem.
   - `novo_horario` → `manage reschedule HH:MM` → o site envia ao cliente o e-mail com **Accept new time / Decline**; a decisão do cliente notifica ambos e fecha o status.
   - `janela` → escolher o horário da janela mais próximo do pedido original e propor esse (`reschedule`); no e-mail ao cliente, a Aria complementa com a janela inteira ("a casa atende das 18h às 19h").
   - `pergunta`/`outro` → a Aria responde ao restaurante e, se precisar, ao cliente.
   - Se a data da mesa já passou: nada de `manage`; avisar o cliente (se ainda não avisado pelo Guardião) e responder ao restaurante.
5. **Resposta ao restaurante, sempre:** "obrigado, repassamos ao cliente" + o cartão da conta ("da próxima vez, um toque no painel — 2 minutos"). Se a resposta revelar dado de catálogo errado (horário, política), abrir correção para o DBA.
6. **Auditoria:** cada passo com trace_id, código da reserva, casa, ação e resultado. Sem dado pessoal no log.

## Guardrails
- Nunca escrever em `reservations` diretamente; só pelo `manage`.
- Nunca aceitar/recusar por e-mail de remetente que não bata com o catálogo.
- Só agir em `Pending`/`In Treatment` e data futura.
- Reagendamento é sempre proposta ao cliente — a plataforma só muda o status quando o cliente clica.
- Compensação, valor ou jurídico: humano (ADR-014).

## Casos de 09/09 que inauguram o fluxo
- **GIGI · VK6BEDL6** (26/09 21h30): aceite por e-mail → `manage accept` + resposta à casa com o cartão.
- **CASA DO PREGO · UFR5KWEZ** (09/09 22h): "só reservamos das 18h às 19h" — a data já passou → sem `manage`; resposta à casa com o cartão + **correção de catálogo**: a página oferecia 22h a uma casa que só reserva das 18h às 19h (DBA).
