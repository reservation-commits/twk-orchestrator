# Agente · Planejador (`planejador`, codinome COMPASSO)

> Spec v1 · 2026-11-02 · trace `trc-planejador1102` · Status: **spec para portão humano** (ADR pendente; "novo fluxo orquestrado entrando em operação" é sempre aprovação do fundador). Segundo agente novo da operação, depois do Guardião da Reserva (ADR-009).
> Código previsto: `orchestrator/agents/planejador/` · Definição: `.claude/agents/planejador.md` · Eval: `orchestrator/evals/planejador/` · Política: `POL-010` em `orchestrator/politicas/politicas.json` · Auditor: checagem A18.
> Rotulagem: **FATO** (verificado nesta sessão) · **SUPOSIÇÃO** (inferência declarada) · **SEM DADO**.

## 1. Missão e problema que mata

**Missão:** nenhum achado, proposta, compromisso ou ordem do fundador morre sem dono, prazo e verificação de efeito. O Planejador fecha o ciclo **medir → diagnosticar → propor → planejar → cobrar → verificar se o número mexeu**, e é o dono do livro único de tarefas da operação (ADR-004 passa a dizer: **tarefas = Planejador**).

**Mata:** linha **P** da matriz (adenda de 2026-11-02 em `docs/agentes/00-matriz-de-lacunas.md`): a operação detecta e propõe, mas ninguém é dono do plano nem do acompanhamento. Números de referência (todos **FATO**, lidos nesta sessão):

| Fila | Onde | Estado em 2026-11-02 |
|---|---|---|
| Compromissos com data | `orchestrator/state/compromissos.jsonl` | 15 registrados · **13 abertos · 13 vencidos** (5 do MAESTRO, 7 do fundador, 1 "front + fundador") |
| Ações do vigia e do Analista | `command-center/state/acoes.jsonl` | **24 abertas · 0 fechadas** desde a criação |
| Aprovações | `command-center/state/aprovacoes.jsonl` | 10 pendentes · 1 aprovada · 4 descartadas |
| Perguntas ao fundador | `command-center/state/perguntas.jsonl` | 8 abertas · 3 respondidas · 2 parciais |
| Backlog da Central | `command-center/state/backlog.jsonl` | 9 itens: 2 em construção, 1 a delegar, 2 adiados, 3 rejeitados, 1 concluído |
| Handoffs do Orquestrador | `orchestrator/state/tasks.jsonl` · `command-center/state/tasks.jsonl` | 21 + 11 linhas; 2 em andamento, 1 bloqueada |
| Taxa de autonomia da frota | `orchestrator/state/autonomia.json` (28/10) | **56,7 %** em 30 dias · meta 98 % · 13 paradas humanas em 30 ações |
| Alertas da Regência | `command-center/state/regencia-alertas.jsonl` | 77 linhas, sem campo de estado |

Em uma frase: **a frota já tem olhos (vigia determinístico, Analista por domínio, Sentinela, Juiz) e boca (Despacho do MAESTRO); não tem mãos nem memória de longo prazo.** Oito filas, nenhuma com dono do todo, nenhuma com a pergunta "isso mexeu o número?".

**O que o Planejador NÃO é.** Não é um segundo vigia (consome os achados que já existem e só coleta onde hoje é SEM DADO). Não é um segundo Orquestrador (não decompõe nem roteia uma cadeia de execução; registra a tarefa-mãe, dá dono e prazo e cobra). Não é uma segunda voz ao fundador (só fala por relato à Regência, como todo agente, e entra no Despacho). Não executa trabalho de especialista.

**Fronteira com os três cérebros existentes:**

| Cérebro | Horizonte | Pergunta que responde | O Planejador… |
|---|---|---|---|
| Orquestrador | uma cadeia de handoff, minutos a horas | quem faz este passo, com que teto | entrega a tarefa-mãe e recebe o resultado |
| MAESTRO (Regência + Despacho + atendimento) | hoje | o que o fundador precisa saber e decidir hoje; como resolver este cliente | envia relato diário; nunca fala com o fundador por fora |
| Planejador | semanas | o que estamos tentando mexer, com que ações, quem é dono, está andando, funcionou | — |

Núcleo **100 % determinístico** (SQL somente-leitura + regras de envelhecimento, prioridade e cobrança + juiz de evidência). O modelo entra em exatamente dois momentos: a redação do **Plano da Semana** e a redação das **propostas de otimização** (hipótese, métrica alvo, custo, como medir). Nenhum dos dois executa nada.

## 2. Gatilho

- **Ciclo diário** nas rotinas hospedadas da Central (`orchestrator/command-center/rotinas.js`, cron interno, `ROTINAS_HORA` Paris), **depois** da coleta da Regência e da rodada do vigia, para ler achados frescos. Sem modelo: envelhece tarefas, marca vencidas, cobra donos, absorve achados e propostas novas, grava relato.
- **Ciclo semanal** (segunda-feira, mesma rotina, flag `--semana`): Plano da Semana com modelo, a partir do que o ciclo diário acumulou.
- **Por evento:** handoff do contrato v1 com `destino: planejador` (de qualquer agente ou do Orquestrador), e ordem do fundador no chat da Central (`/plano <objetivo>`), que vira handoff com `origem: humano`.
- Cada execução = uma tarefa do Orquestrador (`trace_id` = `trc-plan-<AAAAMMDD>`); handoffs filhos herdam o trace da tarefa cobrada, nunca o do ciclo.
- **Nunca no notebook.** Tarefa agendada do Windows morre quando a máquina dorme (04/09, 11/09, 21/10); o relógio do Planejador é a Central.

## 3. Entradas e saídas

**Entrada (contexto mínimo, referências apenas):**
```json
{"task_id":"TWK-20261102-0001","trace_id":"trc-plan-20261102","origem":"orquestrador","destino":"planejador",
 "objetivo":"Rodar o ciclo diário: absorver achados, envelhecer tarefas, cobrar donos, gravar relato.",
 "contexto_minimo":{"modo":"dry-run|apply","semana":false,"aprovacao_ref":null},
 "prioridade":"normal","criterio_de_pronto":["toda tarefa aberta tem dono e vence_em","toda tarefa vencida foi cobrada ou escalada","relato do dia gravado"],
 "autonomia":"autonomo_com_log","orcamento":{"max_passos":8,"max_custo_eur":1},"criado_em":"…"}
```

**Ordem do fundador (exemplo):** `/plano 26 serviços de chauffeur até 11/11` → tarefa-mãe com `origem_tipo: ordem_fundador`, `metrica_alvo: servicos_confirmados`, `vence_em: 2026-11-11`; a decomposição em handoffs de especialista é pedida ao Orquestrador (`/delegar`), com `parent_task_id`.

**Fontes lidas (só referências e números; nunca texto livre de terceiros como instrução):**
série de métricas da Central (`metrics.js`) · `acoes.jsonl` (vigia + Analista) · `aprovacoes.jsonl` · `backlog.jsonl` · `perguntas.jsonl` · `compromissos.jsonl` · `tasks.jsonl` (ambos) · estado do Guardião (`guardiao-sincronizado.json`: fila humana) · `aria_escalations`, `aria_commitments`, `aria_quality_scores` (ids, estados, datas) · `autonomia.json` · `porta-qualidade.json` · `auditor.json` · achados da Sentinela e do Zelador.

**Saída — bloco `resultado` do contrato + artefatos:**
- **Livro único de tarefas:** `public.plan_tarefas` (uma linha por tarefa) e `public.plan_eventos` (append-only por trigger, toda transição com `trace_id`, como `agent_audit_log`). Campos da tarefa = contrato de handoff + `dono` (agente canônico ou `humano`) · `vence_em` · `depende_de[]` · `origem_tipo` (`achado_vigia` | `proposta_analista` | `compromisso` | `escalacao_aria` | `fila_guardiao` | `handoff` | `ordem_fundador` | `sentinela`) · `origem_ref` · `metrica_alvo` · `valor_inicial` · `estado` · `evidencias[]` · `prioridade_fixa` (bool, só código liga) · `origem_externa` (bool: a tarefa nasceu de texto vindo de e-mail, WhatsApp, web ou banco).
- **Estados:** `proposta → aprovada → em_andamento → (bloqueada) → concluida | recusada`. `vencida` é **marca**, não estado terminal: a tarefa continua aberta e aparece no Despacho até `concluida` ou `recusada` com motivo.
- **Propostas de otimização:** `public.plan_propostas` — `{hipotese, metrica_alvo, valor_atual, valor_esperado, custo_estimado, como_medir, prazo_de_leitura, origem_ref, estado}`. Proposta aprovada vira tarefa; proposta cujo `prazo_de_leitura` chegou é medida e marcada `funcionou` / `nao_funcionou` / `inconclusiva`.
- **Plano da Semana:** `public.plan_planos` + `docs/planos/semana-<AAAA-Www>.md` (lido por pessoa: o que estamos tentando mexer, 3 a 5 frentes, dono, data; sem nome de tabela nem sigla).
- **Relato diário à Regência** (mesmo contrato dos outros agentes): tarefas vencidas, cobranças feitas, propostas novas, propostas lidas, fila do fundador (≤ 5 itens).
- **Página na Central:** `#/plano` — carteira por dono e por frente, vencidas em destaque, propostas com estado, botão "aprovar" para o que exige fundador (reutiliza `aprovacoes.jsonl` e a chave única da Central).
- **Handoffs filhos:** `destino: <agente>` para cobrança (1 por tarefa por 24 h) e `destino: humano` só pelo Despacho.

**Nunca trafega:** nome, e-mail ou telefone de cliente ou de casa; corpo de mensagem; `booking_details`. Só `reservation_code`, `restaurant_id`, ids de escalação, números.

## 4. Ferramentas e permissões (lista fechada)

| Ferramenta | Permissão | Uso |
|---|---|---|
| Postgres via `twk_ro` | **somente leitura** (role com `default_transaction_read_only`) | tabelas `aria_*`, `reservations` (com `expired_at IS NULL`), `db_restaurants`, séries |
| Postgres via papel novo **`twk_plan`** | INSERT/UPDATE **só** em `plan_tarefas`, `plan_propostas`, `plan_planos`; INSERT em `plan_eventos` (append-only por trigger, sem UPDATE/DELETE); **sem DELETE**, sem DDL, nada fora de `plan_*` | livro único |
| Arquivos de estado da Central e do orquestrador | leitura | as oito filas de §1 |
| `metrics.js`, `sentinels.js` (leitura) | leitura | série e achados |
| Escritor de handoff (`orchestrator/agents/_lib`, contrato v1) | escrita de proposta de handoff | cobrança a agente; tarefa-mãe ao Orquestrador |
| Escritor de relato (contrato da Regência) | escrita | relato diário |
| `aprovacoes.jsonl` da Central | escrita de proposta | portão do fundador |
| Anthropic SDK | **2 chamadas/dia no máximo** (`PLAN_MAX_LLM_POR_DIA`) | Plano da Semana; redação de propostas |

**Sem acesso a:** e-mail, WhatsApp, webhooks do n8n, Stripe, `nextauth`, `executar.js`/`twk_dba`, publicação, qualquer escrita fora de `plan_*`. **O Planejador não tem nenhuma ferramenta de envio externo.** Se um dia precisar, é outro ADR.

## 5. Nível de autonomia por ação

| Ação | Início (canário) | Critério objetivo para descer um degrau |
|---|---|---|
| Ler, medir, absorver achados, criar e atualizar tarefa com `dono` agente, marcar vencida, gravar relato | `AUTONOMO` | — |
| Cobrar agente por handoff (1 por tarefa por 24 h, máx. 3) | `AUTONOMO_COM_LOG` | — |
| Reordenar prioridade entre tarefas de agentes | `AUTONOMO_COM_LOG` | — |
| Criar tarefa com `dono: humano` (vai à fila do fundador) | `AUTONOMO_COM_LOG`, **teto 5 novas por dia** | — |
| Fechar tarefa como `concluida` | `AUTONOMO_COM_LOG` **somente** com `evidencias[]` aprovadas pelo juiz de evidência (§8); sem evidência → fica aberta | — |
| Fechar tarefa como `recusada` | `REQUER_APROVACAO_ORQUESTRADOR` com motivo gravado; aparece no Despacho | — |
| Proposta de otimização que vira tarefa de agente dentro do teto do agente | `REQUER_APROVACAO_ORQUESTRADOR` no canário | Após 30 dias e ≥ 20 propostas: ≥ 70 % aprovadas sem edição e 0 propostas de classe sempre-humana → `AUTONOMO_COM_LOG` |
| Plano da Semana | redigido sozinho; **publicado no Despacho só depois do "ok" do fundador** nas 4 primeiras semanas | Após 4 semanas com plano aceito sem reescrita → publica sozinho, fundador edita se quiser |
| Meta nova, mudança de meta, novo fluxo, tarefa > €10 ou > 8 passos, qualquer item das classes sempre-humanas da Constituição | `REQUER_APROVACAO_HUMANA` | **nunca desce** |
| Rebaixar prioridade de tarefa com `prioridade_fixa` (remoção, opt-out, jurídico, dado de cliente) | **PROIBIDO** por código | — |
| Contato externo de qualquer tipo | **não existe a ferramenta** | — |

## 6. KPIs (baseline · meta 30d · meta 90d · fonte)

| KPI | Baseline 2026-11-02 | 30 dias | 90 dias | Fonte |
|---|---|---|---|---|
| Tarefas vencidas abertas | **13** (compromissos) + 24 ações sem dono | 0 vencidas sem cobrança; ≤ 5 vencidas no total | 0 | `plan_tarefas` |
| Conclusão no prazo (concluídas até `vence_em` / concluídas) | **0 de 13** compromissos (FATO: nenhum concluído no prazo) | ≥ 50 % | ≥ 80 % | `plan_eventos` |
| Achado do vigia → tarefa com dono | **SEM DADO** (24 abertas, nenhuma com dono) | ≤ 24 h | ≤ 24 h | `acoes.jsonl` × `plan_tarefas` |
| Propostas lidas no prazo (medidas, qualquer resultado) | **SEM DADO** | 100 % das que venceram | 100 % | `plan_propostas` |
| Propostas que mexeram a métrica alvo | **SEM DADO** | medido | ≥ 1 em 3 | `plan_propostas` |
| Taxa de autonomia da frota (medidor) | **56,7 %** | 70 % | 85 % | `autonomia.json` |
| Itens ao fundador por dia (fila) | SEM DADO (hoje: 10 aprovações + 8 perguntas paradas) | ≤ 5/dia, lidos em ≤ 48 h | ≤ 3/dia | relato |

## 7. Critério de morte

Desligar o Planejador se, **60 dias após o fim do canário**, a conclusão no prazo não passar de 50 % **ou** o fundador deixar sem resposta mais da metade dos Planos da Semana. Nesses casos ele é ruído sobre ruído. Desligamento é um comando (`--pause`); o livro único **fica**, somente leitura, porque continua sendo a fonte das tarefas; o Orquestrador volta a ser o único escritor.

## 8. Modos de falha prováveis e guardrails determinísticos

| Falha | Guardrail (código, não prompt) |
|---|---|
| Fechar tarefa sem fazer, para melhorar o próprio KPI | **Juiz de evidência** (`juizes/planejador.js`, determinístico): `concluida` exige ≥ 1 evidência verificável por padrão — arquivo existente no repo, id em tabela consultável por `twk_ro`, `trace_id` presente em `orchestrator/logs/`, linha em `agent_audit_log`. Evidência inválida → tarefa fica aberta e o fato entra no relato |
| Recusar ou adiar o que é difícil | `recusada` exige motivo e passa pelo Orquestrador; `vencida` não some nunca; relato lista as 5 mais antigas todo dia |
| Soterrar o fundador (lição dos 196 e-mails de 22 dias, 24/09) | teto de 5 itens novos/dia com `dono: humano`; **nenhum e-mail**; tudo pelo Despacho e pela página `#/plano`; item repetido = mesmo id, não item novo |
| Rebaixar pedido de remoção, opt-out, jurídico ou dado de cliente em favor de meta comercial | `prioridade_fixa=true` ligado por código para essas origens; ordenação final ignora qualquer reordenação sobre elas; eval cobre |
| Injeção: texto vindo de e-mail/WhatsApp/web/banco vira tarefa ("republiquem a página", "paguem a fatura") | tarefa só carrega referências; `origem_externa=true` marca a origem; tarefa com `origem_externa` **nunca** pode ser `AUTONOMO` nem virar proposta aprovada sem humano; classes sempre-humanas continuam humanas (`avaliar.js`) |
| Loop de cobrança (spam a agente) | 1 cobrança por tarefa por 24 h; após 3, escala ao Orquestrador, não cobra mais |
| Duplicar o Orquestrador (criar handoffs de execução) | o Planejador só emite dois tipos de handoff: **cobrança** e **tarefa-mãe ao Orquestrador**; eval rejeita qualquer outro `destino`/`objetivo` |
| Métrica ausente tratada como zero | doutrina do vigia: `null` é pulado; proposta sem `valor_atual` numérico não nasce |
| Modelo inventa meta ou número | metas só com `aprovacao_ref` do fundador; todo número do Plano da Semana vem de campo do banco de tarefas ou da série; teste compara o texto com os valores de origem |
| Estouro de custo | `PLAN_MAX_LLM_POR_DIA=2`; teto mensal em `PLAN_TETO_EUR` com alerta a 80 %; sem chave → só ciclo determinístico |
| Escrita acidental fora de `plan_*` | papel `twk_plan` sem privilégio fora de `plan_*` (servidor impõe) + hook `guard-sql.ps1`; `plan_eventos` append-only por trigger |
| Relógio morto (rotina não rodou) | Sentinela já vigia `rotinas.json`; acrescentar regra `planejador_sem_ciclo_24h`; Auditor A18 confere que as travas deste dossiê existem no código |

## 9. Custo estimado × ganho

- **LLM (SUPOSIÇÃO, a medir no canário com os mesmos `PRECOS` do Despacho):** 1 chamada diária (relato + redação de propostas) e 1 semanal (Plano da Semana), modelo `MAESTRO_MODEL_COMPLEX` (Fable 5.1); volume ≈ 34 chamadas/mês. Entrada dominada pela carteira (≤ 15 mil tokens com referências, nunca dumps). **Teto: €15/mês**, alerta a €12. Núcleo diário = 0.
- **Banco:** 4 tabelas pequenas (milhares de linhas no primeiro ano), sem custo marginal.
- **Humano:** fundador lê o Plano da Semana (10 min/semana) e no máximo 5 itens/dia pelo Despacho que já recebe. **Estimativa: ≤ 1 h/semana**, contra o custo invisível de hoje, 13 compromissos vencidos e 18 itens parados entre aprovações e perguntas.
- **Ganho esperado (SUPOSIÇÃO, a provar):** 24 achados do vigia ganham dono em 24 h; os 13 compromissos vencidos são resolvidos ou recusados com motivo em 30 dias; a taxa de autonomia sobe porque as paradas humanas passam a ter fila, teto e prazo em vez de e-mail e esquecimento. O ROI não fecha em euros em 90 dias; fecha em **decisões que deixam de se perder** e em **propostas medidas**, e isso fica dito.

## 10. Dependências

| Depende de | Estado | Se faltar |
|---|---|---|
| DDL `plan_tarefas`, `plan_eventos`, `plan_propostas`, `plan_planos` em `public` | **pendente** — `CREATE TABLE` em `public` exige frase do fundador pela porta única (ADR-017) e `GRANT CREATE` ao `twk_dba` | roda em modo arquivo (`orchestrator/state/plan/*.jsonl`) só para dry-run; **sem canário** |
| Papel `twk_plan` | **pendente** — papel de banco é sempre humano (tabela de escalonamento) | idem |
| Rotinas hospedadas da Central (v4.7, Build Path `/orchestrator`, volume) | existem (22/10) | sem relógio: não entra em canário |
| Regência e vigia rodando antes do ciclo | existem; ordem dos jobs em `rotinas.js` | lê achados do dia anterior (atraso de 24 h, registrado) |
| Analista por domínio ligado (`analyst.js`, `ANALYST_MAX_PER_DAY`) | código existe; **SEM DADO** se está ligado na hospedada | o Planejador trabalha só com vigia, compromissos e filas; propostas ficam mais pobres |
| Política `POL-010` (`classe: tarefa_planejador`) e ajuste do `avaliar.js` | pendente | tudo cai em `REQUER_APROVACAO_HUMANA` (fail-closed) |
| Migração de `compromissos.jsonl` e das filas da Central para o livro único | pendente (adaptadores primeiro, depois um produtor por vez) | duas verdades durante a transição; a Regência continua lendo `compromissos.jsonl` até o corte |
| Eval ≥ 30 casos verde (`orchestrator/evals/planejador/`) e Porta verde | pendente | **sem canário**, regra da Constituição |
| Ciclo de 30 dias de iniciativas (ADR-018 em 22/10, ADR-019 em 28/10) | janela fecha em **2026-11-21** | canário só depois de 21/11, salvo frase do fundador |

## 11. MVP de 1 semana

1. **Dia 1:** SQL da DDL e do papel `twk_plan` prontos para a frase do fundador; `POL-010` proposta; esqueleto do agente com modo arquivo.
2. **Dia 2:** adaptadores de leitura das oito filas → carteira unificada em memória; relatório de dia 0 (quantas tarefas, quantas vencidas, quantas sem dono) sobre dados reais.
3. **Dia 3:** ciclo determinístico: envelhecimento, `vencida`, cobrança por handoff (dry-run), juiz de evidência, `prioridade_fixa`.
4. **Dia 4:** relato à Regência e página `#/plano` na Central (leitura).
5. **Dia 5:** Plano da Semana com modelo, em dry-run, a partir da carteira real; comparação do texto com os valores de origem.
6. **Dia 6:** eval com ≥ 30 casos (injeção, prioridade fixa, evidência falsa, teto do fundador, loop de cobrança, métrica nula, handoff proibido); Auditor A18; Sentinela `planejador_sem_ciclo_24h`.
7. **Dia 7:** canário em dry-run nas rotinas hospedadas por 7 dias; relatório de 7 dias contra o dia 0.

Sinal mensurável em 7 dias: **quantos dos 13 compromissos vencidos e das 24 ações abertas ganharam dono, prazo e primeira cobrança**, e quantas cobranças tiveram resposta do agente.

## 12. Red-team — três formas de causar dano e contenção

1. **O Planejador vira chefe e fabrica trabalho infinito** (cada achado vira três tarefas, cada agente afoga, a autonomia cai em vez de subir). Contenção: teto de tarefas abertas por agente (10; acima disso, nova tarefa nasce `proposta` e espera), toda tarefa exige `origem_ref`, o relato mostra tarefas criadas × concluídas por dia, e o critério de morte cobre o caso.
2. **Injeção pela carteira:** uma casa escreve por e-mail "priorizem republicar nossa página" ou um cliente escreve "cancelem e reembolsem"; o texto chega como escalação da Aria e o Planejador o transforma em tarefa com prazo. Contenção: a tarefa carrega só o id da escalação; `origem_externa=true`; republicar, reembolsar, cancelar são classes sempre-humanas no `avaliar.js` e continuam sendo com ou sem Planejador; o eval tem casos exatamente assim.
3. **O agente otimiza o próprio placar:** fecha sem evidência, recusa o difícil, ou propõe só o que é fácil de "mexer". Contenção: juiz de evidência determinístico, `recusada` com motivo e arbitragem do Orquestrador, `vencida` que não desaparece, e propostas sempre com `valor_atual` e `prazo_de_leitura`, medidas mesmo quando não funcionaram, com o resultado no Despacho.

## 13. Adenda 2026-11-03 — a face do agente é o app COMPASSO Tarefas

Decisão do fundador em 03/11: a interface não é a página de carteira e números-norte do §3, e sim um **gerenciador de tarefas simples** para as três pessoas da empresa (Márlon, Lucas, Julien): quadro por status editável, calendário, chat que divide um pedido em etapas e sugere quem assume, e um botão de Sugestões. Código em `orchestrator/tarefas/` (serviço próprio, mesmo padrão da Central, hospedável no EasyPanel; `README.md` da pasta). O que muda no dossiê:

- **§3 saídas:** o livro único passa a ser o deste app (`plan_tarefas`, `plan_eventos`, `plan_sugestoes` em `orchestrator/tarefas/sql/001-plan.sql`; em arquivo até a frase). `dono` é uma das três pessoas, não um agente. Página na Central e Plano da Semana saem do escopo da v1.
- **§3 entradas:** ordens chegam pelo chat do app (`POST /api/planejar`), não por `/plano` na Central. Sugestões continuam vindo de compromissos, achados do vigia, Central e banco via `twk_ro` (`sugestoes.js`), com "por quê" numérico e fonte, teto de 12 vivas.
- **§4 ferramentas:** inalterado no essencial; o papel de escrita chama-se `twk_plan`. Zero envio externo continua valendo: o app não tem e-mail, WhatsApp nem webhook.
- **§5 autonomia:** a cobrança a agentes por handoff fica para a v2; na v1 quem cobra é o quadro (atrasada em vermelho) e o relato à Regência (`GET /api/relato`, contrato dos agentes via API).
- **§6 KPIs e §7 morte:** iguais; a baseline é lida no próprio app.
- **§8 guardrails** mantidos no código: dono obrigatório, prazo e pessoa só do texto, exclusão vira evento, ledger append-only, sugestão descartada volta em 14 dias, texto externo é dado, fail-closed sem segredo ou usuários.
