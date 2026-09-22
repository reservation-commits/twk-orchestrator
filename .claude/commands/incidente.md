---
description: Abrir resposta estruturada a incidente da operação multiagente — /incidente <descrição>
---

Incidente relatado: $ARGUMENTS

Conduza a resposta como Orquestrador, nesta ordem:

1. **Estancar**: identifique se a causa ainda está ativa (script rodando, agente em loop, envio em curso). Proponha a ação de contenção — se envolver parar serviço ou reverter dado, apresente para aprovação humana ANTES de agir.
2. **Preservar evidência**: copie os trechos relevantes de `orchestrator/logs/`, logs do agente afetado e estado do banco ANTES de qualquer correção. Manifesto/estado com risco de sobrescrita (aprendido no incidente das 985 despublicações: dry-run destruía o manifesto real) → copiar com timestamp no nome primeiro.
3. **Delimitar o raio**: quantas linhas/clientes/páginas afetadas, desde quando, quem consome esse dado a jusante (consulte `docs/auditoria/matriz-dependencias.md`).
4. **Runbook**: verifique se existe runbook aplicável em `docs/runbooks/`; siga-o. Não existindo, conduza e ESCREVA o runbook novo ao final.
5. **Plano de correção**: proposta com rollback, aprovação humana para qualquer escrita, execução, verificação pós-correção.
6. **Post-mortem curto** em `docs/runbooks/incidentes/INC-<data>-<slug>.md`: linha do tempo, causa-raiz, raio, correção, e qual guardrail/alerta teria evitado — com a tarefa de criá-lo delegada.
