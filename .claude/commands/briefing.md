---
description: Painel diário da operação — tarefas, custo, travas e anomalias em 30 segundos
---

Gere o briefing diário da operação multiagente TWK. Fontes, nesta ordem:

1. `orchestrator/state/inbox-local.jsonl` — **Novas Missões escritas pelo fundador na Central hospedada** (coletadas pelo push-state). Se houver linhas ainda não processadas (sem tarefa correspondente em tasks.jsonl), PROCESSE-AS PRIMEIRO: cada uma vira um handoff via fluxo do /delegar, e o relatório final é publicado em `orchestrator/state/missoes/M-<task_id>.md` (título com `# `), depois sincronizado com push-state.
2. `orchestrator/state/tasks.jsonl` — última linha de cada task_id define o estado atual. Agrupe por destino: concluídas, em andamento, bloqueadas, aguardando aprovação humana.
3. `orchestrator/logs/audit-<hoje>.jsonl` e `<ontem>` — conte eventos por tipo; destaque `guardrail_block`, `handoff_invalido` e `decisao` de escalonamento.
4. `orchestrator/state/conhecimento.md` — pendências estruturais abertas (correções P0 dos dossiês).

Formato de saída (máximo ~25 linhas):
- **Aguardando o fundador** (aprovações pendentes) — primeiro, sempre.
- **Por agente**: 1 linha cada (feito/em curso/travado).
- **Anomalias**: fila parada >24h, tarefa acima do orçamento, guardrail acionado, handoff inválido.
- **Custo**: passos e custo estimado somados de `resultado.custo` das tarefas do dia.
- **Verdade Brutal**: 1-2 frases sobre o que realmente não está andando.

Se os arquivos estiverem vazios (modo sombra recém-iniciado), diga isso e reporte o estado estrutural: correções P0 pendentes por agente conforme `docs/auditoria/`.
