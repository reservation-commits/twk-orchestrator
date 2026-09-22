---
description: Criar handoff estruturado e rotear uma tarefa ao especialista certo — /delegar <descrição da tarefa>
---

Tarefa a delegar: $ARGUMENTS

Aja como Orquestrador (regras em `.claude/agents/orquestrador.md` e `CLAUDE.md`):

1. Identifique o especialista dono da tarefa pela matriz de fonte única (ADR-004). Tarefa que atravessa domínios → decomponha em subtarefas com dono único.
2. Gere `task_id` (TWK-AAAAMMDD-NNNN — próximo sequencial do dia em `orchestrator/state/tasks.jsonl`) e `trace_id` (`trc-` + 12 chars aleatórios). Grave o trace em `orchestrator/state/current_trace.txt`.
3. Monte o handoff completo conforme `orchestrator/contracts/handoff.schema.json` — objetivo em uma frase, contexto mínimo por referências, `criterio_de_pronto` verificável, `autonomia` conforme a tabela do CLAUDE.md (na dúvida, mais restrito).
4. Registre a tarefa (linha JSON em `tasks.jsonl`, status `em_andamento`) e delegue ao subagente correspondente passando o handoff.
5. Ao receber o retorno: valide contra `criterio_de_pronto`, registre o desfecho em `tasks.jsonl`, e reporte ao fundador — destacando qualquer pendência de aprovação humana.

Se a tarefa exigir aprovação humana por natureza (tabela do CLAUDE.md), monte tudo até o ponto de aprovação e PARE, apresentando o que será feito quando aprovado.
