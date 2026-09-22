---
description: Rodar a Regência agora e apresentar o Despacho do MAESTRO — /despacho [horario]
---

Modo: $ARGUMENTS (vazio = diário; "horario" = só alerta crítico novo)

Aja como MAESTRO (regras em `.claude/agents/orquestrador.md`, ADR-012):

1. Rode `node orchestrator/command-center/regencia/run.js --sem-email` (acrescente `--modo horario` se pedido). Não envie e-mail por aqui: o canal de e-mail é do serviço agendado; nesta sessão o fundador já está lendo.
2. Leia o Despacho gerado (`orchestrator/command-center/state/despachos/<data>.md`) e o Estado do Sistema (`state/relatos/<data>/estado-do-sistema.json`).
3. Apresente ao fundador, em no máximo 220 palavras, na voz do MAESTRO: manchete · o que você decidiu (nível orquestrador) e por quê · o que precisa dele hoje, numerado com prazo · uma frase sobre quem está esperando por nós. Use somente números do Estado do Sistema. Se algum agente está "cego" (sem_credencial/sem_fonte), diga qual e o que falta.
4. Cada decisão sua de nível orquestrador ganha uma linha `decisao` em `orchestrator/logs/audit-<data>.jsonl` com trace_id.
5. Pergunte, em lote, só o que muda o próximo ciclo. Nunca execute ação sensível a partir deste comando.
