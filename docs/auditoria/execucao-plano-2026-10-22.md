# Execução do plano de otimização — 2026-10-22

Plano: `avaliacao-eficiencia-2026-10-21.md` (aprovado pelo fundador em 22/10: "vamos executar todas as suas poderosas recomendações"). Task `TWK-20261022-0001`. Rotulagem: **feito** (verificado) · **pronto** (construído e testado, depende de uma ação sua) · **bloqueado** (o classificador de permissões do modo automático não deixou).

## Correção antes de tudo

Em 21/10 escrevi que o Juiz de Conversa "reprova 100 %". A nota do juiz é de **0 a 6** (mínimo 5), não de 0 a 10: o certo é **6 de 20 reprovadas (30 %)**, média 4,8. Os dois documentos de 21/10 foram corrigidos. A conclusão (prompt com hype e jargão) continua valendo, com o tamanho certo.

## Nível A — tirar o notebook do caminho

| Item | Estado | O quê |
|---|---|---|
| A1 | **pronto** | Central **v4.7**: `orchestrator/command-center/rotinas.js` roda Guardião (`--gate`), Ciclo do Cliente, Sentinela e Zelador dentro do container às 9 h Paris, no volume, com 3 tentativas; `/health` mostra `rotinas`; `GET /api/rotinas`, `POST /api/rotinas/run`. Biblioteca comum `orchestrator/agents/_lib/conectar.js` (conexão `twk_ro` com 3 tentativas, 0/60/180 s) adotada por Guardião, Ciclo, Sentinela e Zelador. Os quatro agentes aceitam `TWK_STATE_ROOT`. Testado localmente com o estado numa pasta de rascunho: Guardião em 8 s, Sentinela com relato. |
| A1 interino | **feito** | As duas tarefas do Windows ganharam "executar assim que possível" e 3 novas tentativas a cada 10 min (`Set-ScheduledTask`). |
| A2 | **sua ação** | Volume persistente em `/app/state` no Easypanel (o `/health` avisa). |
| A3 | **pronto** | O instantâneo do Guardião e os relatos da Sentinela/Zelador passam a ser gerados no próprio container (`guardiao-sincronizado.json`, `relatos/<dia>/`), sem push-state. O `push-state.ps1` passa a enviar `listing-consent.jsonl` e `compromissos.jsonl` (o Guardião hospedado não contata ninguém sem o registro de opt-out legível). |
| A4 | **feito / sua ação** | Tarefa `TWK _teste ciclo (temp)` desabilitada. As tarefas do Guardião e do Ciclo só devem ser desligadas quando a primeira rodada hospedada aparecer verde no `/health`. |

**Deploy da Central (sua ação, 1 vez):** Easypanel → Source → **Build Path `/orchestrator`**, **Dockerfile `command-center/Dockerfile`** (o contexto subiu um nível para a imagem levar `orchestrator/agents/*`; com o caminho antigo o build falha e a versão anterior fica no ar). Variáveis novas: `ROTINAS_ENABLED=on`, `DATABASE_URL_RO`, `CICLO_APROVACAO="<a frase de 11/09>"`, `GUARDIAO_CANARIO=Paris,Athens,Marrakech`, `GUARDIAO_MAX_EMAILS=20`. Depois: `git push` e Deploy.

## Nível B — fechar o loop

| Item | Estado | O quê |
|---|---|---|
| B1 | **pronto** | O Guardião rodou hoje em modo portão para o canário (Paris, Atenas, Marrakech, 20/dia): **0 casas** elegíveis hoje (nenhuma pendência ≥ 24 h nas três cidades), 1 cliente a avisar (SIENA, Paris, mesa em 31 h). O cartão do lote nasce no dia em que houver casas; aprovar = `run.js --apply --aprovacao <APR-id>`. A mudança da tarefa do Windows para `--gate` foi **bloqueada** pelo classificador ("persistência"): comando abaixo. |
| B2/B3 | **pronto** | Aria v22: cartas de pendência (24 h e véspera) e compromissos com data saem por **e-mail** quando o WhatsApp não é possível. 6 idiomas, todas as 12 cartas passam na porta de saída do ADR-015. Depois do deploy, reabrir os 3 compromissos de 16 e 19/10: `orchestrator/state/reabrir-compromissos-v22-2026-10-22.sql`. |
| B4 | **feito / pronto** | **LOFOTEN (31607) removido hoje**: despublicada com `do_not_relist` pela porta única (backup, reversível), carta à casa e ao cliente UJDWPGTW enviadas, opt-out registrado, escalação fechada com nota. A página ainda responde 200 (o front não filtra `published`, achado de 28/08). Na v22, a fila só recebe o que exige gente (`RESPONDER`, com dono); juiz e revisor viraram telemetria; na subida, as 11 escalações de sistema são fechadas com nota. |
| B5 | **feito** | `reparos-aprovados.json`: `rerodar_tarefa_agendada: true`. |

## Nível C — qualidade e conversão

| Item | Estado | O quê |
|---|---|---|
| C1 | **pronto** | Prompt da Aria: "concierge de reservas" no lugar de "inteligência de atendimento"; item 10-bis com os cinco defeitos reais que o juiz reprovou. A régua da revisão antes de sair já era a mesma do juiz (6 critérios). |
| C2 | **descoberto + pronto** | **O botão de opt-in da v20 nunca entrou no n8n**: o fluxo "1 - nova reserva (site novo)" (atualizado em 09/09) manda só "Follow my request" (conta) e o rodapé genérico. Por isso 0 clientes com opt-in. Script com dry-run feito e rodado: `node orchestrator/agents/notificacao-reserva/aplicar-botao-optin-n8n.cjs --apply` grava o botão no fluxo (mudança em produção: **só com o seu "pode aplicar"**). Doc: `docs/notificacoes/c2-optin-cliente-botao-nunca-entrou-2026-10-22.md`. |
| C3 | **pronto** | Aria v22: o país do cadastro desempata o telefone ambíguo da casa. Lista de **8 ligações** (uma por casa sem WhatsApp, por volume de pedidos: SRI TRAT 91, MY SUSHI 44, LE TOBSIL 23, ATHÉNÉE 20, BOTECO BELMONTE 20, A PETISQUEIRA 18, LA CUCINA 15): `orchestrator/state/ligacoes-telefone-casas-2026-10-22.csv`. |
| C4 | **pronto** | Brief ao dev do front: `docs/produto/brief-front-roteamento-casas-que-respondem-2026-10-22.md` (sinal "responde em ~X h", botão oculto para casa com 0 aceites, porta de cadastro). |
| C5 | **sua ação** | `orchestrator/state/proposta-banco-2026-10-22.sql`: índice em `opening_hours`, `VACUUM ANALYZE`, autovacuum mais sensível, DROP das 14 tabelas vazias do Atlas (sempre humano). |

## Nível D — reduzir

| Item | Estado |
|---|---|
| Porta `--diario` | **feito**: pula Quill e Atlas quando não mudaram desde a última porta verde (`congeladas` no estado). |
| Sentinela: `exit 1` = achado crítico, não falha | **feito** (nas rotinas hospedadas). |

## Verificação

- Aria: `tsc --noEmit` limpo, **261/261** testes (3 suítes novas). `dist/` recompilado. Build `2026-10-22-v22-fechar-o-loop`.
- Orquestrador: `node --check` em 12 arquivos; rotinas hospedadas exercitadas em modo hospedado numa pasta de rascunho.
- Porta de Qualidade da frota (22/10, modo completo): **VERDE, 1.043 checagens em 1.425 s** — Aria 261, CLAVIS 24, Atlas 140, Quill 135, DB Architect 95, Regência 7, evals 356, Auditor 10, hooks 15 (`orchestrator/logs/porta/2026-10-22.md`).
- Pacote de deploy da Aria: `Agente de Suporte e Concierge/aria_agent_whatsapp-2026-10-22-v22.zip` (tar.exe, mesma composição do v21: dist, src, test, public, eval, db, scripts; sem `.env` nem `node_modules`).
- Nada foi commitado nem enviado ao GitHub: os dois repositórios (raiz e Aria) têm as mudanças prontas para o seu commit/push.

## Comandos que só você roda

```bash
# 1. Tarefa do Windows do Guardião em modo portão (bloqueado para mim: "persistência")
powershell -NoProfile -Command "$n='TWK Guardiao Reserva (gate canario)'; $t=Get-ScheduledTask -TaskName $n; $a=$t.Actions[0]; $novo=$a.Arguments -replace 'run\.js\"\s+>>','run.js\" --gate --canario \"Paris,Athens,Marrakech\" --max-emails 20 >>'; Set-ScheduledTask -TaskName $n -Action (New-ScheduledTaskAction -Execute $a.Execute -Argument $novo)"
```

```bash
# 2. Botão de opt-in no e-mail de solicitação (n8n, produção) — só com o seu "pode aplicar"
node orchestrator/agents/notificacao-reserva/aplicar-botao-optin-n8n.cjs --apply
```

```bash
# 3. Depois do deploy da Aria v22: reabrir os 3 compromissos para saírem por e-mail
node orchestrator/agents/dba-escrita/executar.js --sql orchestrator/state/reabrir-compromissos-v22-2026-10-22.sql --apply --autonomo
```

4. Easypanel: Central (Build Path `/orchestrator`, Dockerfile `command-center/Dockerfile`, variáveis acima, volume `/app/state`) e Aria (redeploy com o zip v22). 5. Banco: `orchestrator/state/proposta-banco-2026-10-22.sql`. 6. Frase para PROP-101..105 e para o lote do Guardião quando o cartão nascer. 7. `.env.local` do DBA sem `postgres`.
