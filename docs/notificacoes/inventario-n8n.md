# Inventário de notificações — n8n (theworldkeys-n8n.xis4ee.easypanel.host)

> Levantado em 2026-08-24 via conector MCP do n8n (17 de 49 workflows compartilhados).
> Dono do documento: Orquestrador. Fonte da verdade dos fluxos: o próprio n8n.
> Rotulagem: fato × suposição × lacuna (doutrina CLAVIS).

## 1. Workflows visíveis ao conector

### Transacionais da plataforma (site novo)

| # | Workflow | ID | Gatilho | Envia para | Observações |
|---|---|---|---|---|---|
| 1 | nova reserva | `ztI9ws9F6BAGJSGr` | `POST /webhook/nova-reserva` (chamado pelo site) | cliente + restaurante (Gmail) | 3 ramos: confirmação automática (só restaurante id `255019`), solicitação enviada, restaurante sem e-mail (alerta interno para thekeys.marlon@gmail.com). Ramo automático executa `UPDATE public.reservations SET booking_status='Accept'` no Postgres. Encadeia o workflow 2 via Execute Workflow (`waitForSubWorkflow: true`) |
| 2 | 6h e 12h pendente | `TvyfkENpfds0MpgJ` | sub-workflow do 1 | — | **[LACUNA]** não compartilhado com o conector — lembretes de pendência não inspecionados |
| 3 | resposta do restaurante | `YDOdJQ46C8okIIdm` | `POST /webhook` (botões accept/decline/reschedule) | cliente + restaurante | 5 templates (Accept/Decline/Reschedule × destinatário) |
| 4 | resposta ao reagendamento | `8sKe89Lz5Vzpy3a5` | webhook | cliente + restaurante | confirmado/recusado |
| 5 | botão de cancelamento | `6sIa2gOyhVdZyAc6` | webhook | cliente + restaurante | |
| 6 | desativação de conta | `xn33VGxkjsasnGlo` | webhook | 1 e-mail | |
| — | alteração na reserva | `WwHnwL8P0hkcgCaz` | webhook | cliente + restaurante | criado 2026-08-18 |
| — | envia email resetar senha | `1pc2qJX4kYkBni3s` | `POST /webhook` | 1 e-mail | |
| — | envia token | `pMm1Qg3FEZY0THzH` | `POST /webhook/send-token` | **NINGUÉM** | **[FATO — defeito]** webhook ativo, responde "Workflow got started" e não conecta a nó nenhum. Se o site ainda chama, o envio falha silenciosamente |
| — | confirmação de solicitação de parceria | `TkC4zLu3uA6B01Ii` | webhook | 1 e-mail | |
| — | resposta a solicitação de parceria | `6ONkRN-zDsy0qpvXBn6NH` | webhook | 1 e-mail | |
| — | feedback do restaurante (admin) | `dLzG-8qVxfj0SB2L0ENk-` | webhook | 1 e-mail | criado 2026-08-19 |

### Integração com agentes

| Workflow | ID | Papel |
|---|---|---|
| Aria — Receber email @reservation | `G0hznF7T70fJoWOO` | Gmail Trigger → HTTP para a Aria |
| Aria — Receber email @support | `tGAT7lTgVdD02HU9IDubv` | Gmail Trigger → HTTP para a Aria |
| Aria — Enviar email | `qxwrSk25gLK2Rp-8T33Yu` | Webhook → Switch → Gmail (reservation@ ou support@) |
| CLAVIS — Outreach (Tier A) | `tS4TxNfzGclVNFF5XeTTs` | Webhook → Split → Gmail (lote aprovado no Portão) |

### Manutenção de dados (não são notificações, mas escrevem no banco)

| Workflow | ID | O que faz |
|---|---|---|
| Atualização de dados | `969ohxk0hJNN0aEd` | Schedule → Postgres upsert em restaurantes |
| Atualização horarios | `FNUoo35uoc14atwf` | Schedule → Google Places → apaga e recria `opening_hours` |

### Fora do alcance do conector

**[LACUNA]** 49 − 17 = **32 workflows não compartilhados**, incluindo o próprio "2 - 6h e 12h pendente". O inventário só é completo quando todos estiverem visíveis (ou exportados).

## 2. Achados críticos (ordem de gravidade)

1. **[FATO] SQL injection no workflow "1 - nova reserva"**: o nó Postgres interpola `body.reservation.reservation_code` direto na query (`WHERE reservation_code = '{{ ... }}'`). Como o webhook **não tem autenticação**, qualquer pessoa que descubra a URL pode enviar um payload com `reservation_code = "x' OR '1'='1"` e marcar **todas** as reservas como `Accept` — ou pior, dependendo do suporte a comandos encadeados. Correção: query parametrizada (Query Parameters do nó Postgres) + segredo no webhook.
2. **[FATO] Webhooks de produção sem credencial**: `/webhook/nova-reserva` e `/webhook/send-token` declaram "No credentials required". Qualquer terceiro pode disparar e-mails com a marca TWK (Gmail oficial) para endereços arbitrários do payload — vetor de phishing. Correção: header secret (como o `x-aria-secret` já usado nos fluxos da Aria) em todos os webhooks.
3. **[FATO] "envia token" é um beco sem saída ativo**: recebe POST, responde sucesso, não faz nada. Verificar se o site ainda chama `/webhook/send-token`; se sim, há usuários não recebendo token desde a última edição; se não, desativar o workflow.
4. **[FATO] Escopo do conector excede leitura**: a credencial compartilhada com o time de agentes tem `workflow:delete`, `update`, `execute`, `publish`. Para a fase de inventário/monitoramento, basta `read`+`list`. Reduzir o escopo até haver decisão explícita do fundador (constituição: mudança em fluxo operacional = aprovação humana).
5. **[FATO] n8n escreve em `reservations`**: `UPDATE ... SET booking_status` viola o ADR-004 ("reservas = plataforma, ninguém escreve"). Ou o ADR é atualizado reconhecendo o n8n como braço da plataforma, ou a escrita migra para o backend do site.
6. **[SUPOSIÇÃO — verificar] Divergência de valor de status**: o n8n grava `booking_status = 'Accept'` (maiúsculo); as varreduras da Aria filtram `booking_status = accept` (minúsculo). Se a comparação for sensível a caixa, os lembretes da Aria nunca encontrarão reservas confirmadas pelo fluxo automático.
7. **[RESOLVIDO — decisão do fundador, 2026-08-25]** Alerta interno "restaurante sem e-mail" → `thekeys.marlon@gmail.com`: o fundador decidiu manter como está (caixa pessoal). Não é pendência.
8. **[FATO] Confirmação automática hardcoded**: só o restaurante id `255019` tem confirmação automática, fixado no fluxo. Se a lista crescer, virar coluna no banco (ex.: `auto_confirm boolean` em `db_restaurants`), não IFs no n8n.

## 3. Lacunas de governança

- Nenhum workflow consulta `aria_contact_consent` antes de enviar (dono do consentimento: Suporte).
- Nenhum envio é registrado em log auditável comum (`agent_audit_log` ou equivalente) — a única memória é o histórico de execução do n8n.
- Sem dedup entre sistemas: se as flags de lembrete da Aria forem ligadas, cliente pode receber lembrete do n8n E da Aria. Regra: **um dono por notificação**.
- Sem runbook "n8n caiu" — 49 fluxos ativos fazem do n8n o ponto único de falha de toda a comunicação da TWK.
- Templates 100% em inglês, hardcoded no nó Gmail — sem versionamento fora do n8n (este inventário é o primeiro passo).

## 4. Matriz de donos proposta (aprovação pendente do fundador)

| Categoria | Dono | Workflows |
|---|---|---|
| Cliente (reserva, lembrete, cancelamento, conta) | **Aria** | 1, 2, 3, 4, 5, 6, alteração, resetar senha, envia token |
| Restaurante / parceria | **CLAVIS** | solicitação/resposta de parceria, feedback admin, lados "Establishment" dos fluxos 1/3/4/5 |
| Dados de catálogo | **DBA** | Atualização de dados, Atualização horarios |
| Monitoramento de execuções/falhas | **Orquestrador** (sentinels) | todos |
