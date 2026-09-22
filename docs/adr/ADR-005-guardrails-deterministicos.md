# ADR-005 — Guardrails determinísticos por hook, nunca por prompt

**Status:** aceito · 2026-08-12

## Contexto
A auditoria provou nas 5 bases que instrução de prompt não segura ação: a Aria protege dados de terceiros só com a "Lei #4" textual; o Safe Mode do console do DBA é um useState no browser; o CLAVIS tem `WHERE true` passando no validateWrite. Onde há validação em código (role RO verificada no banco do Atlas, blast-radius do queryWrite, HMAC de confirm-token), os ataques param.

## Decisão
Neste repositório, segurança é código com exit code: `PreToolUse` (`guard-sql.ps1`) bloqueia com exit 2 — DROP/TRUNCATE, DELETE/UPDATE sem WHERE ou com tautologia, GRANT ALL, rm -rf de raiz, pg_restore --clean; `PostToolUse` (`log-action.ps1`) grava auditoria JSONL com trace_id; `SubagentStop` (`validate-handoff.ps1`) valida o contrato. Suíte adversarial em `orchestrator/tests/test-guards.ps1` (15 casos, 10 de ataque) — o sistema só está pronto com ela verde.

A mesma doutrina é exigida dos agentes de produção (dossiês §7): permissão de banco > validação de SQL > instrução de prompt, nesta ordem de confiança.

## Alternativas consideradas
1. **Confiar no alinhamento do modelo + regras no CLAUDE.md:** necessário, jamais suficiente — o CLAUDE.md orienta; o hook impede. Rejeitada como única camada.
2. **Guardrails em Node/Python:** runtime não garantido nesta máquina (Node é portátil e fora do PATH). PowerShell 5.1 é nativo no Windows. Scripts mantidos 100% ASCII (PS 5.1 lê .ps1 sem BOM como ANSI — aprendido na prática).
