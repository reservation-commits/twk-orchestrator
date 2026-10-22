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

**Atualizar sem zip (a partir do GitHub, desde 2026-10-10).** O repositório raiz está em `reservation-commits/twk-orchestrator` (privado). No serviço do EasyPanel: **Source → GitHub** (conectar a conta uma vez em Settings → GitHub), repositório `twk-orchestrator`, branch `main`, **Build Path `/orchestrator`** e **Dockerfile `command-center/Dockerfile`** (desde a v4.7, 2026-10-22: o contexto subiu um nível para a imagem levar `orchestrator/agents/*` — com o Build Path antigo `/orchestrator/command-center` o build falha em `COPY command-center/...` e o EasyPanel mantém a versão anterior no ar), método **Dockerfile**.

**Rotinas hospedadas (v4.7, plano A1).** Com `ROTINAS_ENABLED=on`, o Guardião da Reserva (`--gate`), o Ciclo do Cliente, a Sentinela de Silêncio e o Zelador de Privilégios rodam DENTRO da Central às `ROTINAS_HORA` (9 h Paris), gravando no volume `/app/state` — o notebook deixa de ser o servidor. Variáveis: `DATABASE_URL_RO` (obrigatória), `CICLO_APROVACAO="<frase do fundador de 11/09>"` (sem ela o Ciclo fica em dry-run), `GUARDIAO_CANARIO=Paris,Athens,Marrakech`, `GUARDIAO_MAX_EMAILS=20`, `EMAIL_WEBHOOK_URL`/`EMAIL_WEBHOOK_TOKEN` (já usados pelo Despacho). O `/health` traz `rotinas` (última rodada, job a job); `GET /api/rotinas` e `POST /api/rotinas/run[?so=<job>]` (chave da API) leem e disparam à mão. O Guardião hospedado só contata casa com o registro de opt-out legível: `push-state.ps1` passa a enviar `listing-consent.jsonl` e `compromissos.jsonl` junto com `excluidos-teste.json`. Depois que a primeira rodada hospedada aparecer verde no `/health`, desligar as tarefas do Windows "TWK Guardiao Reserva (gate canario)" e "TWK Ciclo do Cliente (diario)". Daí em diante, atualizar = Porta de Qualidade verde → `git push` → botão **Deploy** (ou ligar o webhook de auto-deploy que o EasyPanel mostra na aba Source, colado em GitHub → Settings → Webhooks). A pasta `state/` não vai para o git, e por isso o `Dockerfile` trata a semente como opcional: o volume `/app/state` já povoado segue intacto. O zip pelo `tar.exe` continua funcionando como alternativa.

## Sincronizar o estado do Orquestrador

O cérebro do Orquestrador roda no Claude Code (ADR-002/ADR-007); a Central hospedada recebe o estado via push:

```bash
powershell -File "orchestrator/command-center/push-state.ps1"
```

Sem parâmetros, o script lê `CENTER_URL`, `INGEST_TOKEN` e `CENTER_TOKEN` de `~\.twk\central.env` (fora do OneDrive; nada de token na linha de comando). Os parâmetros `-CenterUrl` / `-IngestToken` / `-CenterToken` continuam valendo e têm precedência. Rode após cada sessão de trabalho (ou agende no Windows). O container também embarca um snapshot do estado no build como primeira carga.

O que sobe: fila de tarefas, conhecimento, auditoria do dia, missões, o **último dia de relatos** dos agentes (a Central mostra a data — relato antigo é honesto, nenhum é lacuna), as métricas do Panorama que só nascem nesta máquina e a **lista de casas de teste** (`orchestrator/state/excluidos-teste.json`), que `regencia/db.js` usa na hospedada para tirar as casas de teste de toda contagem (v4.5.2).

## Segurança

- API protegida por `X-Center-Key` (comparação em tempo constante); a UI pede a chave uma vez e guarda no navegador.
- Ingest protegido por `Authorization: Bearer INGEST_TOKEN`, limite de 5 MB, escrita apenas nos 3 arquivos de estado esperados.
- CSP restritiva, `X-Frame-Options: DENY`, usuário sem root no container, HEALTHCHECK embutido.

## v4.6 — Guardião da Reserva como agente de primeira classe da Central (2026-10-10)

Até a v4.5 o Guardião só aparecia no Panorama. Agora ele tem **os mesmos privilégios dos outros cinco** no cockpit: botão e saúde no cabeçalho, nó na constelação, página própria (`#/guardiao`, atalho `6`), interlocutor na Conversa (persona `guardiao`), presença em `frota_kpis` / `especialista` / `ler_estado("guardiao")`, regras no vigia (Ações) e identidade nos cartões de Aprovações.

- **Agente local, não HTTP.** O Guardião é um núcleo determinístico que roda na máquina do Orquestrador e grava arquivos; não tem URL. `server.js` o registra com `local: true`, e `guardiao.js` é o adaptador: lê `orchestrator/agents/guardiao-reserva/state/` (varredura, propostas, livro-razão, `PAUSADO`) ou, na Central hospedada, a cópia `STATE_DIR/guardiao-sincronizado.json`.
- **Saúde honesta.** "Online" = varredura há ≤ 30 h (`GUARDIAO_MAX_HORAS_SEM_VARREDURA`) e não pausado. Em vez de latência, o cabeçalho mostra a idade da varredura.
- **O que a página mostra.** Pedidos avaliados, quantos cobrar (lote do degrau 1 por casa e idioma), fila de WhatsApp/telefone (degrau 2), clientes a avisar via Aria (degrau 4, com as alternativas), mesas em ≤ 6 h, cartões aguardando o fundador, anomalias, série das últimas 14 varreduras, livro-razão de contatos (só `enviado`/`proposto` contam) e o relatório do dia em tela cheia (`/api/guardiao/relatorio`). Referências, nunca dumps: nomes de casas, códigos de reserva e contagens; nenhum HTML de e-mail nem endereço.
- **Vigia.** Quatro regras novas em `sentinels.js`: `guardiao_pausado` (alta), `guardiao_sem_varredura` > 30 h (alta), `clientes_mesa_6h` (crítica) e `lote_parado_em_aprovacao` > 48 h (média). Auto-resolvem quando normalizam, como as demais.
- **Aprovações.** `run.js --gate` passa a gravar o lote com `agente: 'guardiao'`; os cartões de degrau 4 continuam endereçados à Aria (`suporte-concierge`, que a UI mapeia para ARIA).
- **Sincronização.** `push-state.ps1` roda `node guardiao.js --exportar` e envia `guardiao` no mesmo `/api/ingest`. Sem isso, a hospedada mostra "SEM SINCRONIZAÇÃO" com o comando — nunca zero.
- Panorama (`/plataforma`) não muda: a saúde e as APIs lá continuam só para os agentes HTTP.

## v4.5 — Panorama: a leitura de todo o sistema, por agente (`/plataforma`)

Uma plataforma de leitura para qualquer pessoa entender o sistema e os números: visão geral, o negócio em números, uma página por agente (MAESTRO, CLAVIS, Aria, Quill, Atlas, DB Architect, Guardião), qualidade e segurança, e glossário. Somente leitura; tema escuro e claro; imprime como relatório.

- **Onde abre:** `https://SEU-DOMINIO/plataforma` (atalho "Panorama" no cabeçalho da Central). Pede a mesma chave da Central.
- **De onde vêm os números** (`plataforma.js`, um instantâneo com cache de 5 min, mantido quente em segundo plano):
  1. banco da plataforma, pela credencial `twk_ro` — `plataforma-catalogo.js`, uma consulta por métrica, só agregados (nunca PII); pedidos contados uma vez por cliente+data+hora; casas de teste fora;
  2. saúde de cada serviço (`/health` público);
  3. painéis dos próprios agentes (`kpis.js`) — só com as credenciais `AGENT_*` configuradas;
  4. arquivos do MAESTRO (fila, aprovações, relatos, auditoria, porta de qualidade, avaliações, sentinela, guardião, livro de convites).
- **O texto das páginas** fica em `plataforma-conteudo/` (um arquivo por página) e sai só por `/api/plataforma/registro`, atrás da chave — ele descreve o sistema por dentro e por isso não fica em `public/`.
- **Doutrina:** número que não pôde ser lido aparece como "sem leitura", com o motivo; nunca como zero.
- **Conferir antes de subir:** `node plataforma-conferir.js [url] [chave]` — toda referência de página precisa existir no instantâneo; sai com 1 se houver referência quebrada.
- **Página nova ou número novo:** acrescente a consulta em `plataforma-catalogo.js` e cite-a (`"ref": "metrica.campo"`) num arquivo de `plataforma-conteudo/paginas/`; liste a página em `registro.json`.

Na Central hospedada, para a plataforma ficar completa: `DATABASE_URL_RO` (a credencial somente leitura) e as credenciais de leitura dos agentes (`AGENT_CLAVIS_TOKEN`, `AGENT_ARIA_USER`/`AGENT_ARIA_PASSWORD`, `AGENT_QUILL_USER`/`AGENT_QUILL_PASSWORD`, `AGENT_ATLAS_KEY`, `AGENT_DBA_TOKEN`). Porta de qualidade, avaliações, sentinela, guardião e livro de convites são gerados na máquina do Orquestrador: na hospedada aparecem como "sem leitura" até serem sincronizados. Sem a lista de casas de teste (`orchestrator/state/excluidos-teste.json` no repositório, ou a cópia em `STATE_DIR/excluidos-teste.json` que o `push-state.ps1` sincroniza — v4.5.2), as contagens incluem as casas de teste — e a fonte "Banco da plataforma" diz isso.
