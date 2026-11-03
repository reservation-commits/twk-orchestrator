# COMPASSO Tarefas

Gerenciador de tarefas da The World Keys para **Márlon, Lucas e Julien**. Quadro por status (arrastar), calendário de 14 dias, chat que divide um pedido em etapas e sugere quem assume (com histórico por pessoa), um botão de **Sugestões** com tarefas que o planejador extrai dos sinais da operação, e um **conector MCP** para o chat do Claude e o Claude Code criarem cards com passo a passo. Nada além disso.

É a face visível do agente **Planejador** (`docs/agentes/agente-planejador.md`): o app é o livro único de tarefas; o planejador por trás lê, propõe e relata, e nunca envia nada para fora.

## Rodar local

```bash
node orchestrator/tarefas/dev-local.cjs
```

Abre em `http://localhost:8790`. Estado em pasta temporária; os três entram com a senha `twk`. Com `ANTHROPIC_API_KEY` no ambiente o chat usa o modelo; sem, usa as etapas padrão da área. Testes: `npm test` dentro de `orchestrator/tarefas` (sem dependências).

## Produção (EasyPanel)

Serviço próprio. **Build Path `/orchestrator`, Dockerfile `tarefas/Dockerfile`**, porta 8790, volume persistente em `/app/state`.

| Variável | Obrigatória | Para quê |
|---|---|---|
| `TAREFAS_SECRET` | sim | assina a sessão (32+ caracteres aleatórios). Sem ela: 503 |
| `TAREFAS_USUARIOS` | sim (ou `state/usuarios.json`) | quem pode **entrar**: `admin`, `marlon`, `lucas`, `julien`, em qualquer combinação. Um login só: `[{"id":"admin","nome":"Admin","senha":"scrypt$…"}]`. Hash: `node auth.js --senha "a senha"`. As tarefas são sempre de Márlon, Lucas ou Julien, independentemente de quem entra |
| `ANTHROPIC_API_KEY` | não | chat com modelo (`TAREFAS_MODELO`, padrão `claude-opus-5-5`; `off` desliga). Teto `TAREFAS_MAX_LLM_POR_DIA`, padrão 60 |
| `TAREFAS_DATABASE_URL` | não | livro no Postgres (`sql/001-plan.sql`, papel `twk_plan`). Sem ela, livro em arquivo no volume |
| `DATABASE_URL_RO` | não | sugestões a partir do banco (escalações paradas, pendências em 48 h), só leitura |
| `CENTER_TOKEN` | não | chave da Central: permite a ela ler `GET /api/relato` com `X-Center-Key` e é a mesma chave que o COMPASSO usa para ler as filas dela |
| `CENTER_URL` | não | endereço da Central hospedada (ex.: `https://…easypanel.host`). Com ela, as sugestões leem **pela API** os achados do vigia (`/api/actions`), aprovações (`/api/approvals`), perguntas (`/api/perguntas`) e compromissos (`/api/compromissos`, Central ≥ 4.8.1) — é assim que o serviço hospedado enxerga o sistema sem o notebook ligado |
| `CENTRAL_STATE_DIR`, `COMPROMISSOS_PATH` | não | reserva: onde ler os mesmos arquivos do disco quando não há `CENTER_URL` ou a API falhou (máquina do Orquestrador) |
| `TAREFAS_URL` | recomendada | endereço público do serviço (ex.: `https://theworldkeys-compasso.xis4ee.easypanel.host`), usado como *issuer* do OAuth do conector MCP. Sem ela, deriva de `x-forwarded-proto` + `host` |

A DDL e o papel `twk_plan` exigem a frase do fundador (tabela de escalonamento). Até lá o serviço roda com o livro em arquivo, que já é durável no volume.

**Lições do primeiro deploy (03/11):**
- O hash é `scrypt:salt:hash`, com dois-pontos. O formato antigo com `$` era engolido pelo EasyPanel, que trata `$palavra` numa variável de ambiente como referência a outra variável. Se algum dia precisar de `$` numa variável, escreva `$$`.
- O EasyPanel injeta `PORT=80`; o servidor ouve nela e o health check acompanha. Em **Domínios**, a porta do serviço é a `80` (ou defina `PORT=8790` em Ambiente e use 8790 nos dois lugares).
- Com usuários ou segredo errados o log diz exatamente o que faltou (`[auth] …`) e o serviço fica `NÃO OPERACIONAL` respondendo 503, sem cair.

## API

Todas as rotas sob `/api/*` exigem sessão (cookie HttpOnly) e, para mutação, o cabeçalho `X-Requested-With: fetch`.

| Rota | O que faz |
|---|---|
| `POST /api/login` · `POST /api/logout` · `GET /api/eu` | sessão e lista das três pessoas |
| `GET/POST /api/tarefas` · `PATCH/DELETE /api/tarefas/:id` · `GET /api/tarefas/:id/eventos` | o livro; toda mudança vira evento append-only com quem e trace |
| `POST /api/planejar {texto}` | proposta de card (título, etapas, área, dono, prazo). Não cria tarefa; grava a mensagem e a proposta no histórico e devolve `conversa_id` |
| `GET /api/chat[?limite=50]` | histórico do chat: cada pessoa vê o seu, o admin vê todos (inclui o que o Claude fez pelo MCP) |
| `GET /api/sugestoes[?atualizar=1]` · `POST /api/sugestoes/:id/assumir {dono}` · `POST …/descartar` | sugestões com "por quê" e fonte; assumir cria a tarefa; descartada volta em 14 dias |
| `GET /api/relato` (`X-Center-Key`) | relato no contrato da Regência: kpis + achados (tarefas atrasadas) |
| `GET /health` | build, motor, operacional, modelo |

## Claude no COMPASSO (conector MCP)

O serviço é também um **servidor MCP** em `POST /mcp` (HTTP sem estado, JSON-RPC). O Claude entra por **OAuth com o login do próprio app**: ao conectar, abre a tela de autorização do COMPASSO, a pessoa entra com usuário e senha uma vez, e o Claude passa a agir **em nome dela** (eventos e auditoria levam `<login> via Claude`). Nenhuma chave na URL, nenhuma senha guardada no Claude.

**claude.ai (conta da empresa):** Configurações → Conectores → *Adicionar conector personalizado* → URL `https://<serviço>/mcp` → Conectar → entre como `admin` (ou como a pessoa). Depois, em qualquer conversa, "crie um card para o Julien com o passo a passo de …" vira um card no quadro.

**Claude Code (esta máquina):**

```bash
claude mcp add --transport http compasso https://<serviço>/mcp
```

O navegador abre a mesma tela de autorização. A partir daí o COMPASSO aparece como ferramenta nas sessões.

| Ferramenta | O que faz |
|---|---|
| `resumo` | abertas, atrasadas, hoje, concluídas em 7 dias, carga por pessoa |
| `listar_tarefas` · `ver_tarefa` | quadro com filtros; ficha completa com etapas e eventos |
| `criar_tarefa` | card com passo a passo; **exige** `dono` (marlon, lucas, julien) e `etapas`; `vence_em` só se a pessoa deu o prazo |
| `atualizar_tarefa` | status, dono, prazo, título, área, notas; marca etapas feitas (1..n) ou substitui a lista |
| `planejar` | proposta do planejador sem gravar (entra no histórico do chat) |
| `sugestoes` · `assumir_sugestao` | a mesma gaveta de Sugestões; assumir cria o card |

O que o Claude **não** consegue por aqui: excluir tarefa, criar login, mudar usuários, enviar qualquer coisa para fora. As mesmas travas do app valem (dono obrigatório entre os três; modelo nunca inventa data).

**OAuth, em uma linha por rota:** `/.well-known/oauth-authorization-server` e `/.well-known/oauth-protected-resource` (metadados), `POST /oauth/register` (registro dinâmico; só `https` ou `http://localhost`), `GET|POST /oauth/authorize` (tela de login; PKCE S256 obrigatório; código de 5 min, uso único), `POST /oauth/token` (`authorization_code` e `refresh_token`; acesso 1 dia, refresh 90 dias, assinados com `TAREFAS_SECRET`). Clientes registrados ficam em `state/oauth-clients.json`. Para revogar um Claude: remover o conector lá e trocar a senha aqui (os tokens dependem dela só na emissão; trocar `TAREFAS_SECRET` derruba todos de uma vez).

## Regras que o código impõe

- Toda tarefa tem dono entre os três. Sem dono, é de quem escreveu.
- Prazo e pessoa só vêm do texto da pessoa; o modelo escreve título e etapas, nunca data nem nome.
- Concluir marca todas as etapas; voltar atrás limpa a conclusão. Excluir é evento; o ledger não apaga.
- Sugestão assumida não volta; descartada volta em 14 dias; remoção, opt-out e dado de cliente vêm marcadas como prioridade.
- Nenhuma rota envia e-mail, WhatsApp ou webhook. Texto vindo de fora é dado, nunca instrução.
- O chat guarda histórico por pessoa (`conversas.jsonl` ou `plan_conversas`, append-only): mensagem, proposta e o card que nasceu dela. Proposta antiga não tem botão: escreva de novo.
- Produção sem segredo ou sem usuários responde 503 (fail-closed), como a Central.

## Integração com a frota

- **Regência / Despacho:** apontar `AGENT_PLANEJADOR_URL` para este serviço e ler `/api/relato` com a chave da Central (mesmo padrão do Quill e do Atlas).
- **Sugestões:** leem `compromissos.jsonl`, `acoes.jsonl`, `aprovacoes.jsonl`, `perguntas.jsonl` (pela API da Central com `CENTER_URL`, ou do disco) e o banco via `twk_ro`. Cada fonte falha sozinha: a gaveta mostra "Fontes lidas" com a origem (Central, twk_ro) e "Fontes que não consegui ler agora" com o motivo (chave recusada, rota ausente, Central fora do ar). `GET /health` traz `leitura` (`central: api|arquivo`, `banco: true|false`).
- **Auditoria:** `STATE_DIR/logs/audit-AAAA-MM-DD.jsonl` e o ledger de eventos (`eventos.jsonl` ou `plan_eventos`).
