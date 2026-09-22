# ADR-007 — Central de Comando hospedada (MAESTRO) no EasyPanel

**Status:** aceito · 2026-08-12 · decisão do fundador

## Contexto
O ADR-002 mantém o cérebro do Orquestrador no Claude Code. O fundador pediu uma central de comando hospedada no EasyPanel, com visão da operação e dashboards por agente, acessível de qualquer lugar.

## Decisão
Separar **cérebro** de **cockpit**: o Orquestrador continua raciocinando no Claude Code (decomposição, arbitragem, guardrails); a Central **MAESTRO** (`orchestrator/command-center/`) é um serviço de *visualização e telemetria* — Node zero-dependências, SPA PT/FR, Dockerfile próprio. Ela lê o estado do Orquestrador (recebido via `POST /api/ingest` autenticado + snapshot no build), faz poll de `/health` dos 5 agentes, e NUNCA executa ações — coerente com "coordena, não executa": a Central nem coordena, só mostra.

Honestidade de dados como requisito arquitetural: painel sem fonte conectada exibe AGUARDANDO CONEXÃO; modo Demo tem selo fixo (padrão herdado do Atlas, incidente C2); bloqueios de guardrail exibidos são sempre reais.

## Alternativas consideradas
1. **Hospedar o Orquestrador inteiro como serviço com LLM:** prematuro (ADR-002 ainda vale — critério de promoção definido lá). A Central não fecha essa porta: quando o cérebro virar serviço, ele passa a escrever o estado direto no volume.
2. **Reaproveitar a Central do CLAVIS:** é de outro domínio (comercial) e acoplada ao serviço dele. Rejeitada.
3. **Grafana/Metabase:** poderosos, mas exigem banco de métricas e não contam a história do sistema (superpoderes, contratos, pendências) — e o requisito é uma central da operação, não um BI. Rejeitada.

## Evolução prevista
Fase 2 da Central: proxies read-only autenticados para KPIs reais de cada agente (Aria: escalações; Atlas: MRR/propostas; Quill: GSC/fila; CLAVIS: funil; DBA: publicados/completude), substituindo o modo Demo painel a painel.
