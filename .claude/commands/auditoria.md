---
description: Reconstruir a jornada completa de uma tarefa — /auditoria <trace_id ou task_id>
---

Identificador: $ARGUMENTS

Reconstrua a jornada completa:

1. Busque o identificador em `orchestrator/state/tasks.jsonl` (todas as linhas do task/trace) e em todos os `orchestrator/logs/audit-*.jsonl` (grep).
2. Monte a linha do tempo ordenada: criação → handoffs (origem→destino) → ações de tool → bloqueios de guardrail → decisões do orquestrador → desfecho. Para cada evento: timestamp, ator, o quê, justificativa registrada.
3. Verifique integridade: o `trace_id` se propagou por toda a cadeia? Há buracos (ação sem log, resultado sem evidência, critério marcado atendido sem prova)? Buraco = finding, liste explicitamente.
4. Feche com: status final, custo/passos consumidos, aprovações humanas envolvidas (quem, quando), e se a tarefa respeitou o nível de autonomia concedido.

Se o identificador não existir nos logs, diga isso claramente — não invente jornada.
