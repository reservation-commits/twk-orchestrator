# ADR-009 — Agente novo só nasce de gargalo medido; Guardião da Reserva é o único aprovado

**Status:** aceito · 2026-09-02 · trace `trc-agentes0902`

## Contexto
Oito hipóteses de agentes novos foram testadas contra a matriz de lacunas (`docs/agentes/00-matriz-de-lacunas.md`). O custo de um agente é execução, superfície de erro, carga no Orquestrador e, sobretudo, **atenção humana por aprovação** — o gargalo real medido em agosto (167 envios aprovados um a um).

## Decisão
1. Um agente novo só é aprovado se (a) o problema tem evidência numérica na matriz, (b) nenhum agente existente o absorve com extensão pequena sem violar menor privilégio ou foco, (c) uma regra determinística (n8n/SQL) não basta.
2. Pelo critério, **só o Guardião da Reserva** nasce (linha H: gargalo nº 1). Ele é uma máquina de estados determinística com LLM em um único ponto (composição ao cliente, via Aria).
3. Compliance vira **extensão** (Registro de Opt-out: Aria + DBA); ativação, conector, CS de parceiro, fidelização do cliente, qualidade de dados, avaliador e voz são rejeitados ou fundidos (`02-priorizacao.md` §3).
4. Máximo **2 iniciativas por ciclo de 30 dias**; todo aprovado tem critério de morte.

## Alternativas consideradas
- Aprovar os 8: multiplicaria aprovações unitárias e estado invisível; rejeitada.
- Nenhum agente, só n8n: o n8n não tem estado por reserva, não conhece opt-out/contato morto, não grava, não tem hooks (ADR-005); estendê-lo para isso é construir um segundo orquestrador sem auditoria. Rejeitada.

## Consequências
Contrato de handoff v1.1 (enum + `guardiao-reserva`). O Guardião é fail-closed sem o Registro de Opt-out (ADR-010). Eval obrigatório antes de canário (ADR-011).
