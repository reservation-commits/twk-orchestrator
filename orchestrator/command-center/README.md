# MAESTRO Command Center — Central de Comando do Orquestrador TWK

Cockpit web da operação multiagente com **cérebro embarcado**: Home com os superpoderes e a operação do dia (dados reais), header com seletor PT/FR e cards dos 5 agentes, área de **Missões** onde o MAESTRO processa pedidos do fundador na hora — `claude-opus-4-8` no padrão, `claude-fable-5` nas questões críticas/altas (ADR-008).

## v4 — Sala de Comando (Conversa · Ateliê · Aprovações)

- **Conversa** (`#/conversa`, atalho `C`): chat multimodal com streaming SSE. Seletor de interlocutor — MAESTRO (roteia) ou direto CLAVIS/Aria/Quill/Atlas/DBA (personas em `personas.js`). Upload/colar/arrastar **imagem e PDF** (nativos na API), texto/CSV/JSON inline; **voz** por Web Speech API (transcrição gratuita no navegador — Chrome/Edge). Threads persistentes em `state/threads/` (o id da thread é o trace_id); anexos no cofre `state/anexos/` (handoffs carregam só a referência). Prioridade alta/crítica usa o modelo complexo.
- **Ateliê**: respostas com blocos cercados ```` ```html/csv/markdown/svg ```` viram entregas com preview renderizado (iframe sandbox), versões, e exportação **PDF** (impressão com timbre TWK), **PNG** (rasterização local), **arquivo** (download direto). Tudo client-side.
- **Aprovações** (`#/aprovacoes`, atalho `P`): tudo que a tabela de escalonamento manda subir ao fundador. O modelo emite blocos ```` ```aprovacao ```` (JSON) → fila em `state/aprovacoes.jsonl` → aprovar/negar auditado em `logs/audit-*.jsonl` com trace_id; aprovado vira handoff na fila do Orquestrador local (a execução continua passando pelos gates de cada agente).
- **Custo por conversa**: inteiros em unidades de 0,0001 (nunca float), preços configuráveis via `MAESTRO_PRECOS` (centavos USD/Mtok — os padrões embutidos são estimativa), câmbio via `MAESTRO_USD_POR_EUR_E4`; exibido em EUR *est.* com a metodologia no tooltip e alerta na trava dos €10 da constituição. Teto diário: `MAESTRO_MAX_CHAT_DIA` (200).
- **Sem `ANTHROPIC_API_KEY`**: a Conversa falha alto — a mensagem entra na fila do Orquestrador local (inbox) e a tela avisa; nada se perde.

- **Uma dependência** (`@anthropic-ai/sdk`; Node ≥ 18 — o Dockerfile instala na build). Paleta validada por CVD/contraste na superfície escura.
- **Cérebro estrategista, nunca executor:** sem tools, sem banco, sem envio externo — analisa o estado sincronizado e entrega relatórios com donos por agente e aprovações humanas marcadas. Sem `ANTHROPIC_API_KEY`, a Central funciona normalmente e as missões ficam na fila para o Orquestrador local.
- **Cmd/Ctrl+K** abre a paleta de comandos; atalhos: `H` centro, `1–5` agentes, `M` missões.
- **Honestidade de dados:** painéis de agente sem URL configurada mostram *AGUARDANDO CONEXÃO*; o modo **Demo** usa valores fictícios com selo fixo na tela (padrão Atlas). Os bloqueios de guardrail exibidos são sempre **reais** (vêm do log do Orquestrador).
- **Fail-closed:** em produção sem `CENTER_TOKEN`, a API responde 503.

## Rodar localmente

```bash
node "orchestrator/command-center/server.js"
```

Abra http://localhost:8787 (em dev, sem token, a API fica aberta apenas localmente).

## Deploy no EasyPanel (10 min)

1. **App → Create Service → App**, source: este diretório (`orchestrator/command-center/`) via Git ou upload — o `Dockerfile` já está pronto.
2. **Environment:** copie de `.env.example` e defina `CENTER_TOKEN` e `INGEST_TOKEN` (chaves fortes distintas). Opcional: `AGENT_CLAVIS_URL`, `AGENT_ARIA_URL`, `AGENT_QUILL_URL`, `AGENT_ATLAS_URL`, `AGENT_DBA_URL` — com elas, o monitor de saúde da frota acende de verdade (poll de `/health` a cada 30 s).
3. **Volume:** monte um volume persistente em `/app/state` (senão o estado sincronizado se perde no redeploy).
4. **Domínio + HTTPS** no proxy do EasyPanel; a porta interna é `8787`.
5. Verifique `https://seu-dominio/health` → `{"ok":true,...,"auth":"token"}`.

## Sincronizar o estado do Orquestrador

O cérebro do Orquestrador roda no Claude Code (ADR-002/ADR-007); a Central hospedada recebe o estado via push:

```bash
powershell -File "orchestrator/command-center/push-state.ps1" -CenterUrl https://SEU-DOMINIO -IngestToken SEU_INGEST_TOKEN
```

Rode após cada sessão de trabalho (ou agende no Windows). O container também embarca um snapshot do estado no build como primeira carga.

## Segurança

- API protegida por `X-Center-Key` (comparação em tempo constante); a UI pede a chave uma vez e guarda no navegador.
- Ingest protegido por `Authorization: Bearer INGEST_TOKEN`, limite de 5 MB, escrita apenas nos 3 arquivos de estado esperados.
- CSP restritiva, `X-Frame-Options: DENY`, usuário sem root no container, HEALTHCHECK embutido.
