# Panorama do sistema TWK — 2026-10-21

Levantamento feito pelo Orquestrador a pedido do fundador, com `twk_ro` (somente leitura), os arquivos de estado do repositório, os `/health` dos serviços hospedados e as tarefas agendadas do Windows. Horário de referência: 12:07 BRT / 17:07 Paris. Rotulagem: **fato** (medido agora) · **suposição** · **lacuna** (não verificado).

## 1. Resumo em uma frase

A plataforma técnica está estável (todos os serviços no ar, banco saudável, 0 falhas em 2.013 health checks da Aria em 7 dias), mas a **operação está quase parada**: 189 pedidos de mesa em 30 dias, 30 aceites, 12 WhatsApps enviados a casas, 0 clientes com opt-in, Guardião há 7 semanas em dry-run, 15 escalações abertas sem leitura e os vigias desligados desde 24/09.

## 2. Serviços hospedados (fato, HTTP agora)

| Serviço | Estado | Observação |
|---|---|---|
| Central MAESTRO | 200, build 4.6.0 (10/10) | `state_dir: vazio`, `conversas_salvas: 0`, sem volume persistente em `/app/state` — conversas somem no redeploy |
| Aria (WhatsApp + e-mail) | 200, build v21 (05/10), no ar desde 17/10 21:56Z | etapas `vesperaCliente` e `vesperaComMapa` desligadas (templates vazios); 14 templates aprovados em 6 idiomas |
| n8n | 200 | — |
| CLAVIS | 200, v0.2.0, bootCount 203 | `whatsapp: false`, `dbWrite: true` |
| manager.theworldkeys.com | 307 | redireciona para login |
| theworldkeys.com | 200 em 5,3 s | lento (coerente com a auditoria de 07/10) |
| Quill, Atlas | **lacuna** | sem `/health` conhecido; Atlas tem 3 conexões `atlas_service` abertas no `twk_auth` (está no ar) |

## 3. Banco de dados `twk_auth` (fato)

- PostgreSQL 15.17, 165 MB, 29 conexões (15 `postgres`, 3 `atlas_service`, 1 `clavis_ro`, 1 `twk_ro`), 0 consultas longas.
- Latência vista pela Aria em 7 dias: média 572 ms, oscilando entre 105 e 866 ms a cada 5 min (alternância regular — **suposição**: duas rotas de rede diferentes).
- `pg_cron` de expiração de pendências roda todo dia às 03:15Z (2 a 8 reservas/dia). Pendências vivas: **45** (eram 109 em 28/08), 9 com mesa nas próximas 48 h, 0 vencidas sem `expired_at`.
- Catálogo: 3.763 restaurantes, 1.546 publicados, **978 com `ready_pending_photo`** (o `republish_no_photo.js` republicaria tudo isso em lote).
- `agent_audit_log`: **nenhuma escrita de agente desde 08/09** (db-architect). A porta única `executar.js` não foi usada em 6 semanas; só o `pg_cron` escreve.
- `nextauth."User"`: 23.221 usuários, **0 com papel diferente de CUSTOMER** — a porta de contas de restaurante continua quebrada (30/09).
- `listing_consent`: 5 opt-outs registrados.
- Manutenção (atenção, não urgência): `reservations` com 529 tuplas mortas e último autovacuum em 28/08; `db_restaurants` sem autovacuum desde 02/07; **`opening_hours` com 1,85 milhão de seq scans e 7 index scans** — nenhuma consulta usa índice nessa tabela (28,8 k linhas). `pg_stat_statements` esconde o texto das consultas ao `twk_ro` (lacuna).
- Zelador (rodado hoje): 2 achados — **crítico**: `twk-db-agent/.env.local` ainda conecta como `postgres` (fallback); médio: 14 tabelas do Atlas dentro do `twk_auth`, todas com 0 linhas.

## 4. Reservas (fato, 30 dias)

| Status | N |
|---|---|
| Pending | 114 |
| Accept | 30 |
| Decline | 26 |
| Declined (client) | 19 |
| **Total** | **189** |

- Taxa de aceite: 16 %. Últimos 7 dias: 4, 5, 9, 3, 5, 4, 1 pedidos/dia.
- Casa com mais pedidos: SRI TRAT (Bangkok) 31 em 30 dias — número de WhatsApp **undeliverable** (lista de bloqueio da v19). Depois ATHÉNÉE 9, LE TOBSIL 8, MY SUSHI 6, LA ROUTE DU MIAM 5, MONAK 4.
- "Accept" é o único status de confirmação no banco (não existe "Confirmed").

## 5. Aria — suporte e concierge (fato)

- Mensagens em 30 dias: e-mail 93 recebidas / 6 enviadas; WhatsApp 21 recebidas / 14 enviadas. Pico na semana de 12/10 (40 recebidas, 14 enviadas em 2 conversas). Semana de 19/10: 8 recebidas.
- `outboundGate` barrou em 30 dias: ~200 e-mails estruturais (no-reply, relatórios DMARC, marketing) e **5 respostas de saída** (anotação em vez de carta, idioma divergente, vocabulário interno, resposta ao restaurante em vez do cliente).
- **Juiz de Conversa** (escala 0 a 6, mínimo 5): 20 notas no histórico, **6 reprovadas (30 %)**, média 4,8. Semana de 12/10: 14 respostas de WhatsApp, 3 reprovadas, média 5,0. Motivos das reprovações: "não resolve nada agora", hype ("melhores", "ocasião única"), jargão "inteligência de atendimento", prazo de terceiro prometido. Última execução há 38 h (tolerância 30 h). *(Correção de 22/10: a primeira versão deste documento dizia "todas abaixo de 8" por ler a nota como se fosse de 0 a 10.)*
- **Escalações abertas: 15**, a mais antiga de 05/10. 14 são `ALTA` geradas pelo próprio sistema (juiz, resposta retida, compromisso com janela fechada). Duas são **cartas prontas aguardando envio manual** (reservas 6K9UTC47 em 16/10 e RMJHTGQ6 em 19/10 — já venceram). Uma é `REMOCAO_LISTAGEM` de **LOFOTEN (Oslo, 31607) aberta há 16 dias** — SLA de 24/48 h estourado.
- Ferramentas em 7 dias: 22 chamadas, 0 falhas. Aria silenciada (handoff) em 4 conversas. 3 compromissos `sem_canal`. 0 avaliações pós-visita registradas.
- Custo LLM: semana de 12/10 teve 45 chamadas Opus (pico); demais semanas 4 a 15.

## 6. WhatsApp (fato)

- Opt-in: **14 casas**, das quais **6 marcadas indisponíveis** (undeliverable). **0 clientes** com opt-in — a Sentinela acusa "20+ pedidos em 14 dias e nenhum opt-in": o botão do e-mail (v20) não está produzindo a primeira mensagem.
- Entregas rastreadas (total histórico): 13 lidas, 2 entregues, 1 enviada sem status há 48 h, **8 falhas, todas "Message undeliverable"**.
- Em 30 dias: `twk_venue_new_request` 6 falhas / 5 lidas / 1 entregue; `twk_venue_cancelled` 3 lidas; `twk_venue_eve_briefing` 2 lidas; `twk_ops_alert` 2 lidas (alerta ao fundador voltou a sair em 17/10, depois de 46 recusas do template em pt_BR).
- `aria_outbound_log` em 30 dias: ~750 tentativas, **12 enviadas**. Desfechos dominantes: `sem_opt_in` do cliente (≈330), `sem_destinatario` da casa (≈130), `telefone_nao_enviavel` (≈210, inclui 124 ambíguos FR/TH × BR).
- 2 templates classificados como MARKETING pela Meta (`twk_review_invite`, `twk_request_unconfirmed`) — custo e limite diferentes.

## 7. Agentes locais e vigias (fato)

| Peça | Estado |
|---|---|
| Guardião da Reserva | dry-run diário desde 02/09; **nunca enviou um e-mail**. 20/10 falhou (`timeout expired` na conexão). Rodado à mão hoje em 19 s: 3 clientes a avisar (SALLE À MANGER Tunis em 6 h, Il Salumaio Milão 19 h, Loeb Boathouse NY 29 h), fila WhatsApp com casas sem resposta há 700 a 5.000 h |
| Ciclo do Cliente | 19 envios reais desde 11/09 (último 15/10: 2 vésperas, 1 pós-visita); falhou 19/10 e 20/10 por timeout |
| Tarefas do Windows | 09:00/09:15 BRT; nos dias 19 e 20 rodaram às 11:59 (ao ligar o notebook) e deram timeout de 15 s na conexão (**suposição**: Wi-Fi ainda não ligado ao acordar); hoje até 12:07 nenhuma rodou |
| Regência (MAESTRO) | desligada desde 24/09 (bug dos 196 e-mails) — sem relatos, sem despacho |
| Sentinela de Silêncio | não rodava desde 21/09. Hoje: 10 achados, 1 crítico (os desta tabela) |
| Porta de Qualidade | verde em 10/10 (1.027 checagens), há 11 dias — Auditor A12 reprova (>7 dias) |
| Auditor | 13 ok, 3 soft falhando: reparos aprovados todos `false`, 7 compromissos vencidos, porta antiga |
| Medidor de autonomia | **74,1 %** hoje (67 % em 08/10), meta 98 %; semana W42: 1 ação autônoma, 3 humanas — volume mínimo |
| Compromissos vencidos | 7 abertos desde setembro: Lagos T2, 4 e-mails mortos de Lagos, porta de cadastro, Eleos, cliente SYG8R6HF, Don Sebastião, rastreio CTA |
| Políticas | PROP-101..105 sem a frase do fundador; `reparos-aprovados.json` tudo `false` |

## 8. Por agente (1 linha)

- **CLAVIS**: no ar; funil continua em 0 contas; repo parado desde 24/09; Chave Girada só com ações humanas; T2 de Lagos nunca saiu.
- **Aria**: viva e estável; qualidade reprovada pelo próprio juiz; fila de escalação ninguém lê.
- **Quill**: 135 testes verdes em 10/10; repo parado desde 24/09; **lacuna**: sem sinal de vida em produção neste levantamento.
- **Atlas**: 140 testes verdes; espelho Stripe com 0 linhas — não há receita a medir.
- **DBA / TWK DB Architect**: porta única sem uso desde 08/09; `.env.local` como `postgres` segue crítico; 978 `ready_pending_photo` à espera de decisão.
- **Guardião**: pronto, confiável, 7 semanas esperando o lote canário.
- **MAESTRO/Regência**: desligado; a Central hospedada está vazia de estado.

## 9. O que fazer primeiro (proposta, por ordem)

1. **Hoje, atendimento**: executar a remoção de LOFOTEN pelo `exclusao.js` (delegado ao MAESTRO, ADR-016); enviar as 2 cartas prontas (6K9UTC47, RMJHTGQ6); avisar os 3 clientes do degrau 4 via Aria.
2. **Tarefas agendadas**: ou "executar assim que possível após início perdido" + nova tentativa em 10 min, ou ligar a Regência hospedada (`REGENCIA_ENABLED=on` na Central) — solução definitiva já registrada pela Sentinela.
3. **Aria**: tirar "inteligência de atendimento" e o hype do prompt; impor a fórmula do ADR-015 (o que já fizemos → o que ele recebe → quando voltamos) para subir a nota do juiz.
4. **WhatsApp**: verificar o botão de opt-in no e-mail de solicitação (0 clientes); pedir celular correto às 6 casas undeliverable (SRI TRAT primeiro: 31 pedidos); preencher o template de véspera do cliente.
5. **Decisões do fundador paradas**: lote canário do Guardião, PROP-101..105, um reparo aprovado (`rerodar_tarefa_agendada`), volume persistente da Central, trocar o `.env.local` do DBA.
6. **Banco (proposta ao DBA, sem urgência)**: índice ou `ANALYZE` em `opening_hours`; `VACUUM ANALYZE` em `reservations` e `db_restaurants`.

Fontes: `orchestrator/state/*`, `orchestrator/logs/*`, `aria_*`, `reservations`, `db_restaurants`, `agent_audit_log`, `pg_stat_*`, `/health` dos serviços, `Get-ScheduledTask`. Nada foi enviado nem alterado no banco neste levantamento; o Guardião rodou em dry-run, e a Sentinela, o Zelador, o Auditor e o Medidor gravaram apenas estado local.
