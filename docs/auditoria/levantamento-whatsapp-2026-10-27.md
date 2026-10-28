# Levantamento e análise do sistema de WhatsApp — 27/10/2026

Leitura feita em 27/10 à noite (UTC 02:24 de 28/10) com `twk_ro`, o `/health` da Aria e da Central, a API do n8n, a API da Meta (`meta-templates.mjs --status`), a Sentinela rodada à mão e a leitura do código da Aria (HEAD `5306757`) e do orquestrador. Nada foi alterado. Rótulos: **FATO** (visto no código ou no banco) · **SUPOSIÇÃO** · **LACUNA**.

## 1. Resumo em uma página

O canal está **tecnicamente são e operacionalmente subaproveitado**. A Aria v22 está no ar há 5 dias sem uma falha de saúde (288 checagens em 24 h, 0 falhas), 90 templates aprovados em 6 idiomas, entrega rastreada por `wamid`, opt-in por mensagem do cliente funcionando (a primeira cliente real entrou em 27/10). O custo de modelo é irrelevante (74 chamadas Opus em 30 dias).

O problema não é throughput nem custo: é **alcance** e **dois gargalos de atendimento**.

| Métrica (30 d, 27/10) | Valor | Origem |
|---|---|---|
| Tentativas de saída proativa → enviadas | 910 → 56 (**6,2 %**) | `aria_outbound_log` |
| Pedidos de reserva → em casa com WhatsApp que entrega | 174 → **19** (11 %) | `reservations` × `aria_contact_consent` |
| Clientes com opt-in | **1** (desde 27/10; botão no e-mail só entrou em 22/10) | `aria_contact_consent` |
| Casas com opt-in / que entregam | 14 / **8** (6 "undeliverable": fixo sem WhatsApp) | idem |
| Pendências vivas → em casa com WhatsApp | 42 → **1** | `reservations` |
| Respostas da Aria retidas pela revisão (2 tentativas) | **10 de 30** (33 %) | `aria_prechecks` |
| Conversas reais de WhatsApp | 5 (118 "recebidas" são 90 % ruído de e-mail) | `aria_messages` |
| Leitura confirmada de templates à casa | 17 lidas, 5 entregues, 8 falhas (todas 131026) | `aria_delivery_status` |
| Rotina hospedada de retenção (ADR-018) | **falha todo dia** desde 22/10 (erro de SQL) | Central `/api/rotinas` |

Três coisas para fazer já (seção 6): corrigir a rotina de retenção (uma linha), responder ao Marriott/Kitchen6 (escalação 119/120 aberta há 2 dias porque a resposta foi retida), e conseguir o celular de SRI TRAT (30 pedidos em 30 dias, 1 aceite, número fixo).

## 2. O que existe hoje (arquitetura)

```
cliente ──wa.me (botão no e-mail do n8n, desde 22/10)──▶ Aria /webhook/whatsapp ──▶ opt-in por código (sem LLM)
casa    ──escreve para o nosso número────────────────────▶ Aria reconhece ESTABELECIMENTO (aria_contact_consent)
plataforma (reservations) ──vigia a cada 2 min (watcher)──▶ eventos ──▶ 3 pipelines de template:
                                                              reservationEvents (cliente) · venueEvents (casa) · reminders (tempo)
                                                              └ travas: telefone ENVIAVEL · opt-in · teto 50/dia · claim · locale
Meta Cloud API ──status (sent/delivered/read/failed)──▶ aria_delivery_status · 131026 ⇒ lista de bloqueio
turno de conversa: Opus 4.8 (prompt 72 k chars, 12 iterações de tool) ──▶ revisão Haiku (regras + juiz) ──▶ sendText
                                                                           reprovou 2× ⇒ retida ⇒ escalação RESPONDER (humano)
Central /whatsapp (twk_ro, só leitura) · Sentinela (14 cadências aria_*/wa_*) · Juiz diário (0–6) · Guardião (fila CSV, nunca envia)
```

**FATO.** O orquestrador nunca envia WhatsApp: o Guardião gera `fila-mensagens-<dia>.csv` para humano e cartões D4 para a Aria (10 cartões `pendente`, 9 deles de 11/09). O único `wa.me` com texto no orquestrador é o "Rate on WhatsApp" do Ciclo do Cliente. Não existe código do programa OUI (link/QR por casa, reconhecimento de « OUI — nome »).

**FATO.** Etapas ligadas no `/health` da Aria: eventos, vigia, lembrete 2 h, avaliação, pendente 24 h, encerramento honesto, pendência por e-mail, pedido novo/lembrete/véspera/agenda da casa, alerta ao operador. **Desligadas**: véspera do cliente (`twk_eve_briefing`) e véspera com mapa (`twk_eve_briefing_map`), ambas aprovadas na Meta e sem variável no Easypanel; reagendamento (depende da plataforma guardar a proposta).

**FATO.** Meta: 14 templates configurados aprovados em 6 idiomas. `twk_review_invite` é MARKETING nos 6 idiomas; `twk_request_unconfirmed` é MARKETING em de/it/fr.

## 3. Números ao vivo (27/10)

**Funil de saída proativa, 30 dias (`aria_outbound_log`, 910 linhas):**

| Desfecho | n | Leitura |
|---|---|---|
| sem_opt_in (cliente) | 384 | todo evento de cliente (pedido 146, nudge 112, close 91, 2 h 39, review 39, aceito 34, cancelado 20, recusado 20) morre aqui: 0 enviados |
| telefone_nao_enviavel | 241 | 124 são duas reservas de 30/09 repetidas 62× (bug da v17, corrigido na v18); o resto real: inválido ou ambíguo BR |
| sem_destinatario (casa) | 172 | 121 casa sem opt-in · 51 casa na lista de bloqueio |
| **enviado** | **56** | 36 WhatsApp à casa + 20 cartas por e-mail (v22, `pending_nudge/close:email`) |
| alerta_falhou | 46 | `twk_ops_alert` em análise na Meta em 06/10 (histórico) |

Nos **últimos 7 dias** (pós-v22): 24 pedidos novos caíram em casa sem destinatário contra 4 enviados; 13 pedidos com telefone de cliente não enviável contra 15 sem opt-in; 20 cartas por e-mail saíram (a v22 fecha a lacuna do cliente por e-mail, como desenhado).

**Entregas (`aria_delivery_status`, histórico):** 33 mensagens rastreadas. Casa: 17 `read`, 5 `delivered`, 8 `failed` (todas "Message undeliverable"). Operador: 3 lidas. Leitura de `twk_venue_new_request`: 8 de 16 (50 %), 6 falhas. Última entrega: 27/10 15:59 (CASA DO PREGO, lembrete 24 h, `delivered` em 5 s).

**Casas com opt-in (14):**

| Casa | Pedidos 30 d | Aceites | Estado |
|---|---|---|---|
| SRI TRAT (Bangkok) | **30** | 1 | **indisponível** (fixo) |
| ATHÉNÉE (Atenas) | 9 | 7 | indisponível |
| LE TOBSIL (Marrakesh) | 7 | 7 | indisponível |
| MONAK (Paris) | 6 | 5 | ativa, última `read` |
| LA ROUTE DU MIAM (Nice) | 5 | 1 | ativa, 8 envios, `read` |
| MY SUSHI (Lagos) | 5 | 0 | indisponível |
| CASA DO PREGO (Lagos) | 3 | 0 | ativa; o número responde com **auto-resposta** ("só reservamos entre 18h e 19h") — 3 vezes, nunca um humano |
| A PETISQUEIRA (Lagos) | 2 | 0 | indisponível |
| BILLIONAIRE, SCARTUCCIO, LA CUCINA, LA TABLE DE MARIE, L'EVANGELISTA | 0–2 | 0 | ativas |
| Boteco Belmonte (teste) | — | — | ainda na tabela |

46 dos 174 pedidos do mês (26 %) caíram nas 3 casas indisponíveis do topo. As 20 casas com mais pedidos sem opt-in: THE POLO BAR (NY, 4), PARTHENOPI (Cannes, 3), SOU OMAKASE (KL, 3/2 aceites), BEIJING DADONG, O ANTÓNIO (Lagos), Il Salumaio (Milão), PLUM (Phuket), SKYE (SP), STRAVINSKIJ, JOAQUINA, PAPADAKIS (Atenas, 2/2), MAISON ROSTANG (Paris), BUCA LAPI.

**Conversas de WhatsApp em 30 dias:** 5. Judith (+972, 12 msgs, RMJHTGQ6 SRI TRAT, 5 respostas retidas e depois nota 6), Maria (+971, Kitchen6, nota 5), Adrian (+44, 27/10, nota 6, resposta em 13 s), Ana Vitória (+55, 27/10, opt-in VSJG4UMZ SKYE, resolvido sem LLM em 2 s) e a auto-resposta da CASA DO PREGO. Mediana de resposta 9 s, p90 13 s.

**Qualidade (Juiz 0–6):** semana de 12/10: 14 notas, média 5,0, 3 reprovadas (motivos: "inteligência de atendimento", hype, "não resolve agora"); semanas de 19 e 26/10: 1 nota cada, 6/6. O prompt da v22 tirou o jargão: desde 22/10 nenhuma reprovação.

**Custo de modelo, 30 dias (`aria_llm_usage`):** Opus 74 chamadas, 197 k entrada / 16 k saída / 2,36 M cache lido; Haiku 50 chamadas. WhatsApp 49 chamadas, e-mail 25. Ordem de grandeza: **poucos euros por mês**. Não há o que otimizar aqui.

**Escalações:** 2 abertas. 119 `REMOCAO_LISTAGEM` Kitchen6/JW Marriott (Dubai) desde 25/10, e 120 `RESPONDER`: a resposta da Aria ao representante foi retida duas vezes ("vocabulário interno", "registered as a priority matter"). A casa está **sem resposta há 2 dias**. É a mesma falha das escalações 103/104 de 06/10.

**Vigias:** Sentinela à mão: 22 fontes vivas, todas as `wa_*` ok, templates × Meta ok. Os 9 achados são tarefas do Windows "mortas" — falso positivo: elas foram desabilitadas de propósito em 22/10 e as rotinas rodam na Central. A Central rodou em 27/10: Guardião (portão) ok, Ciclo ok (real), Sentinela ok, Zelador ok, **retenção FALHOU** (3 tentativas).

## 4. Achados

### A. Bloqueios operacionais (agem contra o negócio hoje)

1. **FATO — A rotina de retenção (ADR-018) falha todo dia desde que foi hospedada.** Erro: `operator does not exist: timestamp with time zone <= interval`. Causa: `orchestrator/agents/maestro-atendimento/retencao-run.js:85` faz `created_at <= $2 + interval '5 minutes'` com `$2` sem tipo; o Postgres resolve `$2` como `interval`. Correção: `$2::timestamptz + interval '5 minutes'`. Consequência: nenhuma carta de retenção sai e a escalação 119 (Kitchen6) não anda. A Sentinela hospedada deveria ter aberto `rotina_falhou.retencao` — não foi conferido (os relatos ficam no volume do Easypanel, invisíveis daqui: **LACUNA**).
2. **FATO — Um terço das respostas conversacionais é retido.** `aria_prechecks` 30 d: 30 rascunhos, 11 reprovam na 1ª, 10 reprovam também na 2ª. Motivos dominantes: "vocabulário interno (sistema, escalei, registrei)", "promete prazo de terceiro", "expõe processo". Cada retenção vira escalação ALTA/RESPONDER que ninguém lê a tempo (6K9UTC47 venceu sem aviso em 17/10; Marriott desde 25/10). O revisor funciona como foi desenhado (fail-closed); o que falta é (a) o gerador respeitar a régua de primeira e (b) um caminho de saída **para estabelecimento** que não dependa de humano. Note: desde a v22 (22/10) só houve 1 retenção, a do Marriott, numa resposta a **casa** — a régua de estabelecimento é a que mais retém.
3. **FATO — 6 das 14 casas com opt-in têm número fixo sem WhatsApp**, inclusive as 3 que mais recebem pedidos (SRI TRAT 30, ATHÉNÉE 9, LE TOBSIL 7). Lista de ligação pronta desde 22/10 (`orchestrator/state/ligacoes-telefone-casas-2026-10-22.csv`, 7 casas); nenhuma ligação registrada. Enquanto isso, 46 pedidos/mês vão para o e-mail da plataforma.
4. **FATO — CASA DO PREGO responde ao template com auto-resposta** (3×): o nosso pedido chega a um robô. A Aria classifica como automática e ignora (correto), mas ninguém marca a casa como "WhatsApp não atendido por humano". Suposição: o mesmo vale para outras casas que nunca aceitam pelo canal.
5. **FATO — Clientes: 1 opt-in em 5 dias com o botão no ar** (~29 pedidos novos no período → ~3 %). O botão só está no e-mail "solicitação enviada" (falta em "confirmação automática" e "restaurante sem e-mail"), só em inglês, sem rastreio de clique (`CMP-20260918-RASTREIO-CTA` aberto desde 18/09). Até o opt-in chegar, **tudo o que a plataforma faz ao cliente é a carta por e-mail da v22** (20 em 7 dias) — e isso já é melhor do que o silêncio anterior.

### B. Bugs de código confirmados (Aria)

| # | Onde | O que | Impacto hoje |
|---|---|---|---|
| B1 | `src/venueEvents.ts:174` | teto diário da casa sem a guarda `dailyCap > 0` que `reservationEvents.ts:172` tem | com `RESERVATION_EVENTS_DAILY_CAP=0` ("sem teto") **todo envio à casa vira `teto_diario`**; hoje é 50, então não dói — mas é armadilha |
| B2 | `src/watcher.ts:102` vs `:106` | a foto é gravada antes do corte de 30 eventos por tique; o excedente se perde, ao contrário do comentário | baixo (174 reservas/mês), mas num pico ou pós-deploy perde eventos |
| B3 | `src/juiz.ts:45` | `c.phone = o.chat_id`: `chat_id` vai sem `+`, `aria_contact_consent.phone` com `+` | respostas a casas pelo WhatsApp são julgadas com régua de cliente |
| B4 | `src/consent.ts:52-59` + `db.ts:937` | "VOLTAR" promete "voltará a receber nossos lembretes", mas só limpa `outbound_opted_out`; o envio exige `whatsapp_reservas`; a confirmação não passa pela `outboundGate` | promessa falsa para quem nunca teve opt-in |
| B5 | `src/consent.ts:34-37` | mensagem de até 4 palavras terminada em " sair" vira opt-out ("que horas devo sair") | sem caso observado |
| B6 | `src/index.ts:444` vs `:499` | mídia baixada e áudio transcrito (Whisper) **antes** da dedup por wamid | webhook duplicado com áudio paga 2× |
| B7 | `src/outboundLog.ts:61` | coluna `canal` nunca preenchida: cartas por e-mail entram como `whatsapp`; o teto diário (`contarEnviosHoje`) soma e-mail + casa + lembretes, mas `reminders.ts` nunca checa o teto | contagem e painel enganam |
| B8 | `src/watchRegra.ts` | não gera evento para pending → "in treatment" nem para `expired_at` | cliente não sabe que o pedido expirou (a v16 `pending_close` cobre 20 h antes da mesa; expiração silenciosa fora disso) |
| B9 | `src/claude.ts:13, 62-81` | `createWithRetry` 2× por cima dos retries do SDK (SUPOSIÇÃO: até ~9 tentativas) | latência em falha; em 24/10 o monitor abriu URGENTE "Request timed out" |
| B10 | `src/reminders.ts:498`, `watcher.ts` | tiques por `setInterval` sem lock; lembretes marcam depois do envio | com 1 réplica não dói; com 2 duplicaria |

### C. Dívida de estrutura

- **FATO — três pipelines de envio** (`reservationEvents.decidir`, `venueEvents.enviarParaCasa`, `reminders.enviarLote`) repetem telefone → consentimento → locale → `sendTemplate` → `registrarSaida` → claim, com regras ligeiramente diferentes (teto, ordem do claim). Toda correção precisa ser feita 3× (foi o que aconteceu em v17, v18, v19).
- **FATO — N+1 e índices ausentes:** `contarEnviosHoje` por destinatário dentro do laço (`venueEvents.ts:169`); `getVenueRecipients` 2 consultas por reserva; sem índice em `aria_contact_consent(tipo, restaurant_id)` nem em `aria_escalations(status)`; `regexp_replace(phone)` em filtro (`db.ts:911`); `count(*)` em `aria_reservation_watch` a cada 2 min. Com 486 linhas vigiadas não dói — é dívida, não incidente.
- **FATO — prompt de sistema com ~72 k caracteres + 27 k de schemas de tool**, cacheado (2,36 M tokens lidos do cache em 30 d). Não é custo, é risco de instrução ignorada: o juiz reprovou "inteligência de atendimento" e hype que vinham **do próprio prompt** até a v22.
- **FATO — observabilidade quebrada em três pontos:** `resumoEntregas` existe e não é chamado (o painel da Aria não mostra entrega); a Sentinela local lê logs do notebook e acusa tarefas mortas que foram desabilitadas de propósito; os relatos hospedados (Sentinela, Zelador, `rotina_falhou`) ficam no volume e só se leem via `/api/rotinas` com a chave. Além disso o e-mail de CI do GitHub (22/10) acusa `ci - main` falhando na Aria — o workflow ainda diz "169 casos" (há 261).
- **FATO — código morto e docs defasadas:** `isOptedOut`, `linkOptIn`, `resumoEntregas`, import `logScopeBlock`; `.env.example` de 01/09 sem nenhuma `RESERVATION_*`/`VENUE_*`/`OPERATOR_*` e com `pt_BR` como padrão; cabeçalho do `juiz.ts` diz que abre escalação (não abre desde v22); `rotinas.js` cita 4 jobs e tem 5.
- **FATO — Juiz julga no máximo 40 respostas por dia e nunca templates** (não entram em `aria_messages`). O juiz comercial do orquestrador (`juizes/comercial.js`) não é chamado por ninguém em produção; a PROP-102 (envio à casa autônomo com nota ≥ 8) está em `proposta` e nunca é avaliada.
- **FATO — `compromissos.jsonl`:** 9 compromissos únicos, 8 vencidos e abertos, nenhum novo desde 17/09. O ledger virou letra morta.

### D. Meta e regulatório

- **SUPOSIÇÃO a verificar — `twk_review_invite` (MARKETING) não chega a números dos EUA.** A Meta pausou templates de marketing para números +1 dos EUA desde 01/04/2025 e, segundo fontes de outubro de 2026, sem data de volta; erro esperado 131049. Os EUA são a maior base enviável (3.938 contas). A etapa `avaliacao` está ligada: quando o primeiro cliente americano com opt-in jantar, o convite falhará, e a `wa_falha_que_nao_e_numero` vai acusar. Alternativa: reescrever o convite como UTILITY (sem CTA de avaliação pública: "como foi?" é serviço pós-jantar) — exige nova aprovação.
- **FATO — preço por mensagem:** desde 07/2025 a Meta cobra por template entregue: utilidade ≈ €0,02–0,05 e marketing ≈ €0,11 na Europa (valores de agregadores; conferir na tabela oficial). Com 56 envios/mês o custo é desprezível; a categoria importa pela entrega, não pelo preço.
- **FATO — janela de 24 h** só é tratada em `compromissos.ts`; o resto descobre pelo erro da Meta. Para templates isso não importa; para `send_*` de tools (lista, botões) pode falhar em silêncio.

## 5. O que NÃO precisa de otimização

- **Custo de modelo** (poucos euros/mês) e **latência** (mediana 9 s, p90 13 s, com atraso mínimo proposital de 3 s).
- **Saúde da infraestrutura:** 0 falhas em 24 h; WhatsApp API 190 ms; DB 475 ms.
- **Travas de segurança:** HMAC, dedup em 2 camadas, rate limit de entrada, lista de bloqueio, fail-closed no teto, `outboundGate`. Estão corretas; o problema do item A2 é de **geração**, não de trava.
- **Templates:** 90 aprovados, formato de ficha, 6 idiomas, idioma por pessoa. Pronto para muito mais volume do que existe.

## 6. Otimizações propostas (ordem = impacto ÷ esforço)

### Agora (código, reversível, sem decisão nova)

| # | Ação | Resolve | Esforço |
|---|---|---|---|
| O1 | Corrigir `retencao-run.js:85` (`$2::timestamptz`) e rodar `rotinas.executar({so:'retencao'})` | A1 | 10 min |
| O2 | Responder ao Marriott/Kitchen6 pela porta do MAESTRO (ADR-016/018): dossiê, carta de retenção ou execução do opt-out | A1/A2 | 30 min, autônomo com log |
| O3 | Corrigir B1 (guarda do teto na casa), B3 (`'+' \|\| chat_id`), B4 (confirmação de VOLTAR passa pela gate e diz a verdade), B6 (dedup antes da mídia) — 4 testes novos | B | 2 h |
| O4 | Régua de estabelecimento no revisor: trocar a reescrita cega por **reescrita guiada** (o revisor devolve os trechos ofensivos e o gerador recebe a lista) e, na 2ª reprovação de resposta a **casa**, enviar a versão mínima aprovada ("recebemos, voltamos até <data registrada>") em vez de reter — compromisso gravado | A2 | 1 dia |
| O5 | Sentinela: trocar as 4 cadências de arquivo local (`regencia_*`, `ciclo_cliente`, `guardiao_gate`) por leitura do `/api/rotinas` da Central (com `CENTER_TOKEN`), e acrescentar `rotina_falhou.*` como fonte | C observabilidade | 2 h |
| O6 | Ligar `vesperaCliente` (`BRIEFING_TEMPLATE=twk_eve_briefing`) — template aprovado, variável não configurada | alcance (quando houver opt-in) | 5 min, Easypanel (fundador) |
| O7 | Marcar `whatsapp_indisponivel` com motivo `auto_resposta` quando a casa responde 2× com texto idêntico ao template (CASA DO PREGO), e listar na Central | A4 | 2 h |

### Esta semana (precisam de gente ou de decisão)

| # | Ação | Decisão |
|---|---|---|
| O8 | **Ligar para SRI TRAT, ATHÉNÉE, LE TOBSIL, MY SUSHI, A PETISQUEIRA** e pedir o celular de quem decide (CSV de 22/10). SRI TRAT sozinha = 17 % dos pedidos do mês | fundador decidiu em 05/10 "casas ficam para depois"; os números de hoje pedem rever |
| O9 | Botão de opt-in nos outros 2 e-mails do n8n ("confirmação automática", "restaurante sem e-mail") e versão em fr/pt/es/it do texto do botão (o template de resposta já é por idioma) | script `aplicar-botao-optin-n8n.cjs` estende; "pode aplicar" do fundador |
| O10 | Degrau 4 do Guardião **automático via Aria** (B2 do plano de 21/10): hoje 10 cartões D4 pendentes desde 11/09; a carta honesta já existe na Aria (`pending_nudge/close`) — o Guardião só precisa chamar `/webhook/reservation-event` em vez de gravar cartão | é "novo fluxo orquestrado" → aprovação |
| O11 | `twk_review_invite` como UTILITY (ou aceitar que não chega a EUA) | fundador (texto novo → Meta) |
| O12 | Programa OUI: gerar `wa.me/<nº>?text=OUI — <casa>` por casa + reconhecimento na Aria (`optInRegra` já faz 90 % do trabalho para cliente; falta o ramo de casa) | aprovado em deck, sem código — decisão de construir |

### Depois (dívida)

- O13 — Unificar os 3 pipelines num `saida.ts` (telefone → consentimento → locale → teto → claim → envio → log) com uma tabela de regras por evento; os 101 casos do eval protegem a refatoração.
- O14 — Índices: `aria_contact_consent(tipo, restaurant_id)`, `aria_escalations(status)`, coluna `phone_digits` gerada para trocar o `regexp_replace`.
- O15 — Juiz: julgar todas as respostas do dia (paginado) e amostrar templates enviados (ler `aria_delivery_status` + texto renderizado); ligar `juizes/comercial.js` à PROP-102 ou apagar.
- O16 — Prompt: cortar o `SYSTEM_PROMPT` em blocos por fluxo carregados sob demanda (FLUXO 4B/5/7 só quando o aviso de sistema correspondente existe); meta: < 40 k caracteres.
- O17 — Limpeza: código morto, `.env.example`, cabeçalhos, CI da Aria (workflow e credencial do `gh`), `compromissos.jsonl` (fechar ou migrar para `aria_commitments`), tirar Boteco Belmonte (teste) de `aria_contact_consent`.
- O18 — Painel: ligar `resumoEntregas` no `/health` (seção `entregas`) para a Sentinela e a Central lerem de uma fonte só.

## 6a. Executado em 28/10 (aprovação do fundador: "Sim, corrigir" — O1, O3, O5)

| # | O que mudou | Prova |
|---|---|---|
| O1 | `retencao-run.js:85` — `$2::timestamptz`. Dry-run local reencontra o caso Kitchen6 e gera a carta ("before your page comes down", prazo 30/10 02:47Z). **Só vale no ar depois do redeploy da Central** (Easypanel, Build Path `/orchestrator`). | `node orchestrator/agents/maestro-atendimento/retencao-run.js` → 1 caso, decisão `enviar_carta` |
| O3 | Aria **v23** (`2026-10-28-v23-correcoes-levantamento`): B1 teto da casa com a mesma regra do cliente (`src/tetoRegra.ts`, usado pelos dois); B3 juiz casa `c.phone IN (chat_id, '+' \|\| chat_id)`; B4 VOLTAR grava antes de confirmar, diz a verdade quando não há opt-in de reservas (6 idiomas) e toda confirmação passa pela `outboundGate`; B6 dedup por wamid antes de baixar mídia (`listarMensagensBrutas` + `parseOneMessage`). | typecheck limpo · **267/267 testes** (eram 261) · `dist/` gerado |
| O3+ | **Dois bugs da própria porta de saída** apareceram ao testar: (a) `\bvocê\b` nunca fechava depois do "ê" — "Pronto. Você não receberá mais…" era "anotação"; (b) faltavam as formas de tratamento de es/it/de (usted, Lei/suo, Sie/Ihr). Corrigidos em `format.ts`; textos es/it do VOLTAR ganharam "Usted"/"Lei". A trava fica mais exata, não mais frouxa: um texto sem saudação e sem segunda pessoa continua retido (teste novo). | `test/outboundGateAcentos.test.ts`, `test/consent.test.ts` |
| O5 | Sentinela: tipo novo `rotina_central` (`rotinaCentral.js`, puro + `carregar()`): lê `rotinas.json` do volume quando hospedada, `GET /api/rotinas` com `X-Center-Key` quando local; `ciclo_cliente`, `guardiao_gate` e `retencao` (nova) usam isso; tarefas do Windows **desabilitadas** viram lacuna declarada, não "morta". Rodada local: 2 achados (retenção FALHOU com o erro exato; relatório do Guardião), 0 críticos, 24 fontes vivas — antes eram 9 achados falsos. | `regencia/test/sentinela-rotinas.test.js` (5 casos) · Porta da Central 18/18 |

Não feito nesta rodada: O2 (carta ao Marriott sai sozinha na primeira rodada da retenção hospedada depois do redeploy, ou à mão com `retencao-run.js --apply`), O6–O18.

**28/10, tarde — ADR-019 (autonomia no atendimento comum), a pedido do fundador.** Cobre O4 e O10 e vai além: silêncio do modelo não escala; três tentativas e carta de espera com compromisso registrado em vez de retenção; revisor calibrado (o que não é violação + trecho literal); aviso de cartão de sistema de reservas vira escalação ao fundador com prazo (caso Pierluigi); Guardião envia o degrau 1 sozinho nas rotinas (`GUARDIAO_AUTONOMO=on`), delega à Aria as casas com WhatsApp e não gera mais cartão de degrau 4. `POL-008`/`POL-009`, Auditor `A17`, Aria v24. Detalhe em `docs/adr/ADR-019-autonomia-no-atendimento-comum.md`.

## 7. Decisões que só o fundador toma

1. Rever "casas ficam para depois" à luz de SRI TRAT (30 pedidos, fixo).
2. "Pode aplicar" para O9 (n8n) e O6 (variável no Easypanel).
3. Aprovar O10 (D4 automático) como novo fluxo — ou manter a fila humana.
4. `twk_review_invite`: reescrever como UTILITY ou aceitar a lacuna dos EUA.
5. Construir ou arquivar o programa OUI.

## Fontes

- Banco: `aria_outbound_log`, `aria_delivery_status`, `aria_contact_consent`, `aria_messages`, `aria_prechecks`, `aria_quality_scores`, `aria_escalations`, `aria_llm_usage`, `aria_reservation_watch`, `aria_reminders_sent`, `reservations`, `db_restaurants` (twk_ro, 28/10 02:24 UTC).
- Aria `/health` (build `2026-10-22-v22-fechar-o-loop`, uptime 5,1 d); Central `/health` e `/api/rotinas` (27/10); n8n workflow `ztI9ws9F6BAGJSGr` (atualizado 22/10 19:12Z, 12 ocorrências de `wa.me`); Meta `--status` nos 3 docs de templates; Sentinela `verificar.js` (28/10).
- Código: Aria HEAD `5306757` (261 testes), orquestrador HEAD `be3c9e7`.
- Pausa de marketing nos EUA: [Meta/360dialog](https://wa.360dialog.com/partner-updates/january-whatsapp-business-platform-updates), [Twilio changelog](https://static1.twilio.com/en-us/changelog/whatsapp-marketing-messages-to-u-s--numbers-no-longer-supported), [getkanal (out/2026)](https://getkanal.com/blog/whatsapp-marketing-usa-2026). Preço por mensagem: [Meta pricing](https://developers.facebook.com/docs/whatsapp/pricing), [chatmaxima DE](https://chatmaxima.com/whatsapp-api-pricing/germany/).
