# Runbook — Queda ou indisponibilidade do Orquestrador

**Sintoma:** sessão do Claude Code indisponível, estado corrompido, ou o Orquestrador se comportando de forma errática.

## O que NÃO acontece
Nenhum agente de produção depende do Orquestrador para operar. Aria continua atendendo, Atlas continua sincronizando Stripe, crons do Quill continuam. **O modo independente é o modo de contingência por arquitetura (ADR-002).**

## Passos
1. Pare de rotear: tarefas novas vão direto ao operador de cada agente (Central CLAVIS, admin Quill, cockpit Atlas, painel DBA).
2. Handoffs em voo: `orchestrator/state/tasks.jsonl` guarda o estado — a última linha de cada `task_id` diz o que estava em andamento e com quem. Tarefas `em_andamento` com destino claro podem ser concluídas manualmente no agente correspondente; registre o desfecho à mão no `tasks.jsonl` ao retomar.
3. Aprovações pendentes NÃO se perdem: são sempre visíveis nos portões dos próprios agentes (Portão CLAVIS, fila do Atlas, admin do Quill) — o Orquestrador nunca é o único registro de uma aprovação.
4. Retomada: nova sessão do Claude Code na raiz → `/briefing` reconstrói o estado de `tasks.jsonl` + logs. Se `tasks.jsonl` estiver corrompido, os `orchestrator/logs/audit-*.jsonl` (append-only) permitem reconstruí-lo.
5. Post-mortem se a causa foi estado corrompido: o que escreveu fora do padrão? Hooks estavam ativos?
