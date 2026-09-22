# ADR-008 — Cérebro embarcado no MAESTRO (Anthropic API na Central)

**Status:** aceito · 2026-08-13 · decisão do fundador ("adicione a chave da Anthropic onde precisar; mínimo Opus 4.8, Fable 5 no complexo")

## Contexto
O ADR-007 deixou a Central sem cérebro: missões escritas na web aguardavam a sincronização com o Orquestrador local. O fundador pediu processamento imediato e de nível máximo, direto na Central hospedada.

## Decisão
A Central ganha o **MAESTRO Brain** (`brain.js`): ao receber uma Nova Missão, o servidor chama a API da Anthropic (SDK oficial) e publica o relatório na própria área de Missões, em fila serial com status ao vivo (fila → processando → entregue/erro).

**Roteamento por complexidade:** prioridade `normal`/`baixa` → `claude-opus-4-8` (thinking adaptativo, effort `high`); prioridade `critica`/`alta` → `claude-fable-5` (thinking sempre ativo, fallback server-side `default` habilitado, tratamento de `refusal` com degradação explícita para o Opus). Configurável por env (`MAESTRO_MODEL*`, `MAESTRO_EFFORT`).

**Limites deliberados (a doutrina continua):**
1. O cérebro é ESTRATEGISTA, não executor: sem tools, sem acesso a banco, sem envio externo. Ele analisa o estado sincronizado (conhecimento.md, tasks.jsonl, relatórios anteriores — injetados como dados com cache de prompt) e entrega planos com donos por agente e aprovações humanas marcadas.
2. Execução operacional continua no Orquestrador local (Claude Code) com guardrails determinísticos e na frota deployada com seus portões. `/api/inbox/consume` segue coletando o que o cérebro não pegou.
3. A chave `ANTHROPIC_API_KEY` vive só no Environment do EasyPanel — nunca em arquivo do repositório nem no navegador.

## Alternativas consideradas
1. **Managed Agents (CMA):** loop e sandbox hospedados pela Anthropic — mais poder (tools, arquivos), mais superfície. Fica como evolução natural quando as missões exigirem execução hospedada; hoje o estrategista text-in/text-out cobre o pedido com risco mínimo.
2. **Continuar sem cérebro (ADR-007 puro):** rejeitado pelo fundador — a latência da sincronização manual contrariava o objetivo da área de Missões.
3. **Modelo único:** desperdiça ou o custo (Fable em tudo) ou a capacidade (Opus em questões críticas). O roteamento por prioridade é simples e auditável.

## Consequências
A Central deixa de ser zero-dependências (npm: `@anthropic-ai/sdk`); o Dockerfile instala na build. Custo de API passa a existir na Central — mitigado por cache de prompt (persona estável) e fila serial. O selo de honestidade permanece: relatórios citam origem dos números ou os rotulam SUPOSIÇÃO/LACUNA.
