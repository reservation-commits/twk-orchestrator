# ADR-011 — Nenhum agente entra em produção sem eval determinístico e canário com parada automática

**Status:** aceito · 2026-09-02 · trace `trc-agentes0902`

## Contexto
Cada repositório tem seus testes, mas não há harness comum, nem dataset por agente, nem regra de canário. A Central mede pouco (URLs dos agentes não configuradas). O time vai crescer; sem isso ninguém sabe se ficou pior.

## Decisão
1. `orchestrator/evals/` é o harness comum: runner em Node, sem LLM, com ≥30 casos anonimizados por agente (ids sintéticos, sem PII), asserções `hard`/`soft`. Roda a cada mudança de prompt, tool, template ou regra. `hard` falhou → não entra em canário.
2. Casos que exigem o modelo (comportamento da Aria) ficam no eval do próprio repositório e seu resultado é anexado ao relatório do canário.
3. Canário começa em 5–10% do volume ou um segmento nomeado, com **métrica de parada automática** declarada na spec e um comando de pausa (`--pause`) que o cron respeita.
4. Relatório de 7 dias contra o dia 0 é portão humano para ampliar. Sem relatório, sem ampliação.
5. Orçamento mensal por agente com alerta em 80% lido pelo vigia da Central.

## Alternativas consideradas
- LLM-as-judge como único eval: caro, não determinístico, esconde regressão de regra; fica como complemento opcional.
- Confiar nos testes de cada repo: não cobrem o fluxo orquestrado nem os guardrails cruzados (opt-out × contato).

## Consequências
Dois datasets criados nesta sessão (Guardião, Registro). O "Avaliador de Agentes" (hipótese 8) deixa de ser candidato a agente: é este ADR.
