# ADR-003 — Handoff por contrato JSON com schema fixo

**Status:** aceito · 2026-08-12

## Contexto
Hoje a "integração" entre agentes é o banco compartilhado: um grava, o outro lê, ninguém é avisado (foi assim que 985 despublicações passaram invisíveis). Copiar contexto inteiro entre agentes vazaria PII e estouraria janelas.

## Decisão
Todo repasse usa `orchestrator/contracts/handoff.schema.json` (v1): `task_id`, `trace_id` propagado, `origem/destino`, `objetivo` de uma frase, `contexto_minimo` **só com referências** (ids, códigos — nunca dumps nem PII), `prioridade`, `criterio_de_pronto` verificável, `autonomia` concedida, `orcamento`. Retorno no bloco `resultado` com `status`, `resumo`, `evidencias` e `criterios_atendidos`. Validação no hook `validate-handoff.ps1` (SubagentStop).

## Alternativas consideradas
1. **Texto livre entre agentes:** flexível, inauditável, propenso a injeção e a "telefone sem fio". Rejeitada.
2. **Protocolo A2A/MCP entre serviços:** correto no longo prazo, mas exige mudar os 5 runtimes. O contrato JSON é o mesmo payload que um A2A futuro transportaria — migração natural. Adiada.

## Trade-offs aceitos
Um handoff custa mais que uma mensagem solta. Regra anti-burocracia: se um handoff adiciona latência sem adicionar segurança ou qualidade, elimina-se o handoff (fluxo vira autônomo do especialista).
