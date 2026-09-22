# Orquestrador TWK — layout

| Pasta | Conteúdo |
|---|---|
| `contracts/` | `handoff.schema.json` — contrato v1 de todo repasse entre agentes |
| `state/` | camada quente (`tasks.jsonl`, `current_trace.txt`) e morna (`conhecimento.md`) |
| `logs/` | camada fria: `audit-AAAA-MM-DD.jsonl`, append-only, com trace_id |
| `tests/` | `test-guards.ps1` (suíte determinística, 15 casos) e `cenarios-agentes.md` (18 cenários, 8 adversariais) |
| `dashboards/` | reservado; o painel diário é gerado por `/briefing` |

Operação: `/briefing` · `/delegar <tarefa>` · `/auditoria <trace_id>` · `/incidente <descrição>`.
Regras do sistema: `CLAUDE.md` (raiz). Arquitetura e decisões: `docs/arquitetura.md` + `docs/adr/`. Diagnóstico dos agentes: `docs/auditoria/`.

Validar guardrails após qualquer mudança nos hooks:

```bash
powershell -NoProfile -ExecutionPolicy Bypass -File "orchestrator/tests/test-guards.ps1"
```

Nota: subagentes (`.claude/agents/`) e hooks (`.claude/settings.json`) são carregados no início da sessão do Claude Code — mudanças exigem sessão nova.
