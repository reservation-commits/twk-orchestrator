# ADR-001 — Padrão Supervisor / Orchestrator-Workers

**Status:** aceito · 2026-08-12

## Contexto
5 agentes maduros e heterogêneos já existem como serviços independentes. As falhas reais da operação (985 despublicações invisíveis, supressões desconectadas, receita não ligada ao domínio) são todas **falhas de coordenação**, não de capacidade individual.

## Decisão
Adotar Supervisor/Orchestrator-Workers: um Orquestrador decompõe objetivos, roteia por handoff estruturado, coleta resultados, resolve conflitos e escala ao humano. Ele **coordena, não executa** — nunca escreve copy, roda SQL de negócio ou responde cliente.

## Alternativas consideradas
1. **Malha peer-to-peer (agentes falam entre si):** N² integrações, sem ponto de auditoria único, propagação de injeção de prompt entre agentes. Rejeitada.
2. **Barramento de eventos (fila Kafka/n8n central):** robusto, mas exige reescrever os 5 agentes para publicar/consumir eventos — meses de esforço antes de qualquer valor. Rejeitada como primeiro passo; pode ser evolução futura.
3. **Deus-agente (um agente único absorve os 5 domínios):** destrói o menor privilégio (uma credencial vê tudo), contexto gigante, anti-objetivo explícito. Rejeitada.

## Trade-offs aceitos
O Orquestrador é ponto único de coordenação (não de operação — ADR-002 garante degradação graciosa) e adiciona um salto de latência por handoff. Aceitável: os fluxos coordenados são de minutos/horas, não de segundos.
