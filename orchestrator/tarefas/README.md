# COMPASSO Tarefas

Gerenciador de tarefas da The World Keys para **Márlon, Lucas e Julien**. Abre no que fazer **hoje**, muda na hora para todo mundo, não perde nada e entende frases: "Ligar para o Monak sexta @julien !alta" vira um card com dono, prazo e prioridade. Tem quadro, calendário, um planejador que divide pedidos em etapas e responde perguntas sobre o quadro, sugestões vindas dos sinais da operação e um conector MCP para o Claude.

É a face visível do agente **Planejador** (`docs/agentes/agente-planejador.md`): o app é o livro único de tarefas; o planejador por trás lê, propõe e relata, e nunca envia nada para fora. Auditoria que originou a 1.0: `docs/auditoria/compasso-auditoria-2026-11-05.md`.

## Rodar local

```bash
node orchestrator/tarefas/dev-local.cjs
```

Abre em `http://localhost:8790`. Estado em pasta temporária; os três entram com a senha `twk`. Com `ANTHROPIC_API_KEY` no ambiente o chat usa o modelo; sem, usa o leitor de frases e as etapas padrão da área. Testes: `npm test` dentro de `orchestrator/tarefas`. Sem `npm install`, o teste do motor Postgres aparece como **pulado**, com o motivo; com ele, roda com SQL real (PGlite, só em desenvolvimento).

## Como usar em um minuto

| Tecla | O quê |
|---|---|
| `Ctrl K` | buscar, comandar ou criar: serve para tudo |
| `C` | nova tarefa |
| `/` | buscar |
| `G` depois `H`, `Q`, `C` ou `P` | Hoje, Quadro, Calendário, Planejador |
| `J` `K` e setas | andar entre os cards |
| `Enter` · `1` a `4` · `X` · `M` | abrir · mover de coluna · concluir · menu |
| `Z` | desfazer a última ação |
| `?` | esta lista dentro do app |

**Frase para card** (na captura rápida e no `Ctrl K`): `@julien` dono; `!alta` ou `urgente` prioridade; `#paris` cidade; prazo em português ou francês (`sexta`, `amanhã`, `15/11`, `dia 12`, `em 3 dias`, `fim do mês`, `vendredi`, `dans 3 jours`, `le 12 novembre`); repetição (`toda segunda`, `todo mês`, `chaque lundi`); código de reserva vira referência; "ligar" vira canal Telefone. O que virou campo sai do título. O que não foi dito fica vazio: o leitor nunca inventa, e sem dono ele pergunta.

**Hoje** responde "o que eu faço agora?": atrasadas e urgentes, cobranças vencidas de quem está em Aguardando, o dia, o que está em andamento, os próximos 3 dias. Cada linha mostra a próxima etapa; um clique nela marca como feita.

**Aguardando** é um estado de verdade: de quem é a resposta e quando cobrar. Na data, o card volta sozinho para Hoje.

**Tudo salva sozinho.** Não existe botão Salvar em card aberto. Toda ação mostra Desfazer. Comentário não se apaga; `@nome` marca a pessoa nas Novidades dela (o sino).

## Produção (EasyPanel)

Serviço próprio. **Build Path `/orchestrator`, Dockerfile `tarefas/Dockerfile`**, porta 8790, volume persistente em `/app/state`. A 1.0 abre o estado da 0.4.0 sem migração, e voltar para a 0.4.0 continua possível: os arquivos mantêm o formato, os campos novos são só acréscimo.

| Variável | Obrigatória | Para quê |
|---|---|---|
| `TAREFAS_SECRET` | sim | assina a sessão (32+ caracteres aleatórios). Sem ela: 503 |
| `TAREFAS_USUARIOS` | sim (ou `state/usuarios.json`) | quem pode **entrar**: `admin`, `marlon`, `lucas`, `julien`, em qualquer combinação. Monte com `node orchestrator/tarefas/logins.cjs` (ver "Um login para cada pessoa"). As tarefas são sempre de Márlon, Lucas ou Julien, independentemente de quem entra |
| `ANTHROPIC_API_KEY` | não | chat com modelo (`TAREFAS_MODELO`, padrão `claude-opus-5-5`; `off` desliga; `TAREFAS_EFFORT`, padrão `low`). Teto `TAREFAS_MAX_LLM_POR_DIA`, padrão 60 |
| `TAREFAS_DATABASE_URL` | não | livro no Postgres (`sql/001-plan.sql`, papel `twk_plan`). Sem ela, livro em arquivo no volume |
| `TAREFAS_FUSO` | não | fuso da empresa, padrão `Europe/Paris`. "Hoje", ids e auditoria seguem esse dia, nunca o de UTC |
| `TAREFAS_SUGESTOES_TTL_MIN` | não | de quanto em quanto as fontes são relidas, por trás, padrão 60 |
| `TAREFAS_OAUTH_HOSTS` | não | hosts extras, separados por vírgula, para onde o conector pode devolver o acesso. Padrão: `claude.ai`, `claude.com`, `anthropic.com` e `localhost` |
| `DATABASE_URL_RO` | não | sugestões a partir do banco (escalações paradas, pendências em 48 h), só leitura |
| `CENTER_TOKEN` | não | chave da Central: permite a ela ler `GET /api/relato` e o `/health` detalhado com `X-Center-Key`, e é a mesma chave que o COMPASSO usa para ler as filas dela |
| `CENTER_URL` | não | endereço da Central hospedada. Com ela, as sugestões leem **pela API** achados, aprovações, perguntas e compromissos |
| `CENTRAL_STATE_DIR`, `COMPROMISSOS_PATH` | não | reserva: onde ler os mesmos arquivos do disco quando não há `CENTER_URL` ou a API falhou |
| `TAREFAS_MARCO_ZERO` | não | **marco zero** (`AAAA-MM-DD`, decisão do fundador em 03/11): sinais nascidos antes da data não viram sugestão. O registro de origem não é tocado |
| `TAREFAS_URL` | recomendada | endereço público, usado como *issuer* do OAuth do conector MCP |

A DDL e o papel `twk_plan` exigem a frase do fundador (tabela de escalonamento). Até lá o serviço roda com o livro em arquivo.

**Durabilidade: um deploy nunca pode apagar um card.**

- `eventos.jsonl` é a verdade: cada mudança é gravada e sincronizada no disco, com o card inteiro, **antes** da resposta. `tarefas.json` é um instantâneo atômico para abrir rápido.
- Ao subir: instantâneo + ledger. O ledger vence.
- `tarefas.json` ilegível: o arquivo é guardado ao lado como prova (`tarefas.json.corrompido-…`) e o livro se reconstrói da última cópia válida + ledger. A recuperação aparece no `/health`, no log e como achado alto no relato à Regência.
- Nada servindo: o serviço responde **503 com o motivo**. Nunca abre um quadro vazio por cima do que existia.
- Linha cortada no fim do ledger (queda no meio da escrita) é contada em `linhas_ilegiveis`; o resto vale.
- Cópia diária em `/app/state/backups/AAAA-MM-DD/`, 14 dias, sempre tirada da memória íntegra. Protege de erro de operação, **não** de perder o volume: para isso, Postgres ou cópia fora do servidor.
- O que protege de um deploy continua sendo o **volume montado em `/app/state`** (Storage/Mounts do serviço). O `GET /health` com sessão ou chave da Central mostra `durabilidade`.

**Um login para cada pessoa (09/11).** Com login próprio, cada um abre no próprio dia, as Novidades funcionam e o histórico diz quem fez o quê.

1. Nesta máquina, na raiz do repositório: `node orchestrator/tarefas/logins.cjs`. Ele pede o valor atual de `TAREFAS_USUARIOS` (para manter o admin como está), gera uma senha provisória forte para cada pessoa escolhida e imprime o valor novo e as senhas. Nada sai da máquina; a senha só aparece no terminal de quem roda.
2. No EasyPanel, em `TAREFAS_USUARIOS`, substitua o valor inteiro pela linha impressa. Não mexa em `TAREFAS_SECRET`. Implantar.
3. Entregue a cada pessoa a senha dela, em particular. No primeiro acesso o app só deixa escolher uma senha nova (10+ caracteres, sem o nome de usuário); a provisória deixa de valer na hora. O conector do Claude também só aceita a pessoa depois disso.
4. **Esqueci a senha:** rode o comando de novo só para aquela pessoa e implante. A provisória nova derruba a senha escolhida e as sessões abertas dela.

A senha escolhida fica no volume (`state/senhas.json`, só o hash), presa à provisória que substituiu. Qualquer pessoa troca a própria senha pelo `Ctrl K` → "Trocar minha senha"; trocar encerra as sessões dos outros aparelhos e desconecta o Claude dela. Sessões e conectores anteriores a 09/11 seguem válidos até vencer.

**Lições do primeiro deploy (03/11):**
- O hash é `scrypt:salt:hash`, com dois-pontos. O EasyPanel trata `$palavra` numa variável como referência a outra variável.
- O EasyPanel injeta `PORT=80`; o servidor ouve nela e o health check acompanha.
- Com usuários ou segredo errados o log diz o que faltou e o serviço fica `NÃO OPERACIONAL` respondendo 503, sem cair.

## API

Todas as rotas sob `/api/*` exigem sessão (cookie HttpOnly) e, para mutação, o cabeçalho `X-Requested-With: fetch`.

| Rota | O que faz |
|---|---|
| `POST /api/login` · `POST /api/logout` · `GET /api/eu` | sessão. Login tem freio: 8 falhas por IP em 15 min = 429. Sem sessão, `/api/eu` só traz o necessário para a tela de entrada. `usuario.trocar: true` = senha provisória |
| `POST /api/senha {atual, nova}` | troca a própria senha e devolve sessão nova; mesmo freio do login. Com senha provisória, todo o resto da API responde 403 `trocar_senha` |
| `GET /api/tarefas[?desde=seq]` | quadro, resumo, `seq`. Com `desde` igual ao atual, responde `{inalterado:true}` em poucos bytes |
| `POST /api/tarefas` · `GET/PATCH /api/tarefas/:id` · `DELETE /api/tarefas/:id {motivo}` | o livro. **`PATCH` aceita `base: {campo: valor que vi}`**: se outra pessoa mudou o mesmo campo, devolve **409** com `conflito` e o valor atual; campos diferentes se somam. **`etapas_ops: [{op: marcar\|texto\|add\|del\|mover, id, …}]`** muda etapas sem conflito |
| `POST /api/tarefas/:id/comentarios {texto}` | comentário permanente; `@nome` entra em `mencoes` |
| `GET /api/tarefas/:id/eventos` | histórico do card, de todo campo, com de e para |
| `POST /api/tarefas/:id/arquivar` · `…/desarquivar` · `GET /api/arquivo[?q=]` | arquivo das concluídas, com busca |
| `GET /api/stream` | tempo real (SSE): `ola`, `mudanca` (card inteiro) e `sugestoes`, com pulso a cada 25 s |
| `GET /api/novidades[?pessoa=]` | o que outros fizeram nos cards da pessoa, e as menções a ela |
| `POST /api/planejar {texto, idioma}` | pergunta sobre o quadro: `{resposta}`, na hora e sem modelo. Pedido: `{propostas[], proposta, conversa_id}`, um ou vários cards. Não cria nada |
| `GET /api/chat[?limite=50]` | histórico: cada pessoa vê o seu, o admin vê todos |
| `GET /api/sugestoes[?atualizar=1]` · `POST /api/sugestoes/:id/assumir {dono, vence_em}` · `…/descartar` | sugestões com "por quê", fonte, prazo e dono sugeridos; `normalizados` lista os cards cujo sinal sumiu |
| `GET /api/relato` (`X-Center-Key`) | relato no contrato da Regência: kpis (com `no_prazo_30d_pct`, `ciclo_mediano_dias`, `tarefas_cobrar`, `tarefas_paradas_7d`) + achados |
| `GET /health` | sem login: só se está de pé. Com sessão ou chave: motor, fuso, leitura, durabilidade |

## Claude no COMPASSO (conector MCP)

O serviço é também um **servidor MCP** em `POST /mcp` (HTTP sem estado, JSON-RPC). O Claude entra por **OAuth com o login do próprio app** e passa a agir **em nome da pessoa** (eventos e auditoria levam `<login> via Claude`). Nenhuma chave na URL, nenhuma senha guardada no Claude.

**claude.ai:** Configurações → Conectores → *Adicionar conector personalizado* → URL `https://<serviço>/mcp` → Conectar → entre como `admin` ou como a pessoa.

**Claude Code:**

```bash
claude mcp add --transport http compasso https://<serviço>/mcp
```

| Ferramenta | O que faz | Só lê |
|---|---|---|
| `minha_fila` | o que fazer agora, na ordem, com a próxima etapa: a melhor resposta para "o que tenho hoje?" | sim |
| `resumo` | abertas, atrasadas, hoje, para cobrar, concluídas, % no prazo, carga por pessoa | sim |
| `listar_tarefas` · `ver_tarefa` | quadro com filtros, arquivo, busca (alcança comentários); ficha completa com eventos | sim |
| `sugestoes` | a mesma gaveta de Sugestões | sim |
| `criar_tarefa` | card com passo a passo; **exige** `dono` e `etapas`; `vence_em` só se a pessoa deu o prazo | não |
| `atualizar_tarefa` | qualquer campo, inclusive espera e repetição; marca etapas (1..n) ou substitui a lista | não |
| `comentar_tarefa` | comentário permanente; `@nome` avisa a pessoa | não |
| `arquivar_tarefa` · `desarquivar_tarefa` | arquivo | não |
| `planejar` | proposta sem gravar, uma ou várias | não |
| `assumir_sugestao` | sugestão vira card, com o prazo e a prioridade do sinal | não |

Toda ferramenta declara `readOnlyHint`, `destructiveHint` e `idempotentHint`. O que o Claude **não** consegue por aqui: excluir tarefa, criar login, mudar usuários, enviar qualquer coisa para fora.

**OAuth:** metadados em `/.well-known/oauth-*`, registro dinâmico em `POST /oauth/register` (destino só no Claude ou em localhost; 30 registros por hora por IP; cliente já autorizado nunca é despejado), login em `/oauth/authorize` (PKCE S256 obrigatório; a tela diz para onde o acesso volta; mesmo freio do login), tokens em `POST /oauth/token` (acesso 1 dia, refresh 90 dias). Token do conector nunca vale como sessão do app, e vice-versa. Para revogar: remover o conector no Claude; trocar `TAREFAS_SECRET` derruba todos de uma vez.

## O card

| Campo | Para quê |
|---|---|
| título, dono, prazo, status, área | o essencial (área: Clientes, Site, Chauffeur, Catálogo, Operação) |
| **prioridade** alta · normal · baixa | alta só quando há cliente ou reserva esperando; sobe ao topo e ganha a marca vermelha |
| **aguardando quem · cobrar em** | em Aguardando: de quem é a resposta e quando o card volta para a fila |
| **repetir** diária · dias úteis · semanal · mensal | concluir cria a próxima, com etapas limpas, uma vez só |
| cidade · canal · **referência** | o contexto do caso; a frase preenche sozinha quando dá |
| etapas, notas | passo a passo e contexto. Etapas têm id: marcar etapas diferentes em paralelo nunca entra em conflito |
| comentários | conversa permanente no card |
| **resultado** | o que ficou feito. Pedido ao concluir, sem travar; é o que fica no arquivo |

**Excluir × arquivar.** Card não concluído pode ser excluído, sempre com motivo; a tarefa inteira e o motivo ficam no ledger. Card concluído não se exclui: arquiva-se. "Devolver ao quadro" desarquiva; voltar o status também. Ids nunca são reaproveitados.

**Idioma.** PT / FR no topo e na tela de login: interface, rótulos, datas e o idioma em que o planejador escreve. Os dados ficam em português no servidor.

## Regras que o código impõe

- Toda tarefa tem dono entre os três. Sem dono dito, a tela pergunta.
- Prazo e pessoa só vêm do texto da pessoa ou do sinal que originou o card; o modelo escreve título e etapas, nunca data, nome ou prioridade. Urgente é prioridade, não data inventada.
- "Hoje" é o dia em Paris.
- Toda mudança de todo campo vira evento com quem, quando e um `trace_id` próprio (ou o que veio em `X-Trace-Id`).
- Concluir marca as etapas e guarda o que estava marcado; voltar atrás restaura.
- Sugestão assumida fica fora só enquanto o card dela estiver aberto: fechou e o sinal continua, ela volta, marcada. Descartada volta em 14 dias. Compromisso aparece 48 h **antes** de vencer.
- Nenhuma rota envia e-mail, WhatsApp ou webhook. Texto vindo de fora é dado, nunca instrução.
- Produção sem segredo ou sem usuários responde 503 (fail-closed), como a Central.

## Arquitetura em uma tela

| Arquivo | Papel |
|---|---|
| `public/nucleo.js` | leitor de frases, datas no fuso e foco do dia. **O mesmo arquivo roda no navegador e no servidor** |
| `store.js` | o livro: uma camada de regras, duas de persistência (arquivo, Postgres), um teste de contrato para as duas |
| `server.js` | rotas, tempo real, segurança, arquivos da interface em memória com gzip e versão no endereço |
| `planejador.js` | propostas: leitor de frases sempre, modelo quando ligado, com formato garantido pela API |
| `sugestoes.js` | sinais da operação → sugestões; cada fonte falha sozinha |
| `mcp.js` · `oauth.js` · `auth.js` | conector, autorização, sessão, freio |
| `public/app.js` · `app.css` · `i18n.js` · `sw.js` | interface sem build: ação otimista, salvar por campo, teclado, celular, abrir sem rede |

## Integração com a frota

- **Regência / Despacho:** apontar `AGENT_PLANEJADOR_URL` para este serviço e ler `/api/relato` com a chave da Central.
- **Sugestões:** leem `compromissos.jsonl`, `acoes.jsonl`, `aprovacoes.jsonl`, `perguntas.jsonl` (pela API da Central com `CENTER_URL`, ou do disco) e o banco via `twk_ro`. Cada fonte falha sozinha, e a gaveta diz o que foi lido e o que não foi, com o motivo.
- **Auditoria:** `STATE_DIR/logs/audit-AAAA-MM-DD.jsonl` e o ledger (`eventos.jsonl` ou `plan_eventos`).
