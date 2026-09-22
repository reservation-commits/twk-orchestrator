# Auditoria da frota — agente por agente

> 2026-09-21 · Orquestrador · Rotulagem: **fato** × **suposição** × **lacuna**.
> Método: leitura do código-fonte de cada repositório, execução das suítes de teste, e cruzamento com o banco real via `twk_ro` (somente leitura, só agregados). Nada foi alterado.
> Antecessora: auditoria de 2026-08-18 (8 achados C1–C8).

## Notas — tecnologia e capacidades

| # | Agente | Nota | Em uma linha |
|---|---|---:|---|
| 1 | **Atlas** (Financeiro) | **8,5** | A engenharia mais rigorosa da frota: bigint ponta a ponta, ledger com trigger, 4 olhos, 140 testes, 52 evals com gabarito numérico; deixou 14 tabelas vazias no `twk_auth` |
| 2 | **Guardião da Reserva** | **8,5** | Pequeno, puro, determinístico e correto; teto limitado pelo escopo |
| 3 | **Quill** (Editorial) | **8,0** | O maior e mais completo (193 fontes, 26 migrations, 202 testes); admin com qualidade de produto |
| 4 | **Aria** (Suporte) | **8,0** | Canal mais maduro; 26 tools bem guardadas; a porta única de saída é o acerto arquitetural |
| 5 | **TWK DB Architect** (DBA) | **7,5** | Melhor código de guardrail da frota — rodando com a pior credencial |
| 6 | **CLAVIS** (Comercial) | **7,5** | Cérebro sofisticado (verificador red-team, 6 personas, Portão); poucos testes; em modo teste |
| 7 | **Orquestrador + MAESTRO** | **7,0** | Governança acima da média; execução dispersa em ~40 scripts CLI sem teste unitário |
| 8 | Sub-agentes | **6,5–8,0** | Detalhado por item na seção 8 |
| — | **Frota** | **7,5** | Engenharia acima da média, doutrina aplicada de verdade — e um único calcanhar: a credencial de banco |

---

## 0. O achado transversal — a credencial `postgres`

**[fato]** Três agentes escrevem no Cloud SQL (`35.239.247.237`) como **`postgres`**, o papel administrativo da instância (CREATEROLE + CREATEDB):

| Quem | Onde | Evidência |
|---|---|---|
| DBA (app Next.js **e** os 35 scripts da raiz) | `twk_auth` | `twk-db-agent/.env.local` → `DATABASE_URL` com usuário `postgres`; `db-config.js` lê esse mesmo arquivo para todos os scripts |
| Atlas (camada de serviço) | banco `atlas`, mesma instância | `Agente Financeiro/.env` → `DATABASE_URL` com usuário `postgres` |
| Quill (write-back de `about_text`/meta) | `twk_auth` | `Agente Editorial/.env` → `TWK_DATABASE_URL` com usuário `postgres` |

**[fato]** Os papéis de menor privilégio foram **desenhados duas vezes e nunca criados**: `twk-db-agent/db/roles/twk_db_agent.sql` e `Agente Editorial/db/twk/roles_quill_writer.sql` (este com `UPDATE` em nível de coluna — exatamente o certo). Nenhum dos dois aparece em `pg_roles`.

**[fato]** Os papéis que existem e estão corretos: `twk_ro` (SELECT em 96 tabelas de `public` + 10 de `nextauth`, `default_transaction_read_only=on`, timeout 60s), `twk_dba` (DML em `public`, sem escrita em `nextauth`, timeouts — conforme ADR-013), `atlas_agent_ro` (read-only, timeout 15s), `clavis_ro` (só SELECT).

**[fato]** `clavis_rw` tem `CREATEROLE` + `CREATEDB` e DML em 9 tabelas, **incluindo `reservations` e `db_restaurants`** — acima do que o ADR-004 permite a qualquer agente. Está dormente (o CLAVIS não tem `DB_WRITE_URL` configurada), mas existe. `vertex_readonly` também tem `CREATEROLE`/`CREATEDB`, o que não combina com o nome.

**Consequência.** Toda a sofisticação dos guardrails em código (seção 1) fica *acima* de uma chave-mestra. Um script da raiz do DBA que ignore o `sql-guard` — e há seis que ignoram — tem poder total. A correção é conhecida e barata: criar os dois papéis já escritos e trocar três `DATABASE_URL`.

---

## 1. TWK DB Architect — 7,5

**Stack.** Next.js (versão recente, "não é o Next que você conhece"), React, Monaco, Tailwind, Radix, Claude SDK, `pg`, `zod`, `cheerio`, `libphonenumber-js`. 165 fontes, 11 arquivos de teste — **95 testes passam**.

**Poderes (≈30 tools do agente).** Leitura (SELECT em transação `READ ONLY` com timeout e teto de 500 linhas, schema, contagens); escrita (`execute_mutation`, `bulk_insert`, `fix_data_issue`, `batch_fix`, `apply_auto_fixes`); enriquecimento (Google Places, Michelin, descrição editorial por IA, redes sociais, busca web, fetch de URL); qualidade (auditoria de tabela, validação de coluna, duplicatas por trigrama, completude, consistência cruzada, outliers, análise semântica por Haiku); checagens de realidade (MX do e-mail, HEAD da URL, E.164 do telefone, frescor no Places, geocoding reverso); Photo Studio (GCS), SEO estruturado, CRM, snapshots de qualidade. Fora do app, **35 scripts na raiz** (enriquecimento, colheita de e-mail/telefone, despublicar/republicar sem foto, expirar pendências, importar CSV).

**Guardrails (fato, lidos e testados).** `sql-guard.ts`: allowlist de tabelas mutáveis, blocklist das de negócio + `aria_*`, `nextauth` proibido, DDL bloqueado por palavra, uma instrução só, WHERE obrigatório com detecção de tautologia, operação declarada tem de bater com o SQL. Token HMAC de confirmação amarrado ao SQL exato. Raio de dano (`max_affected_rows`, rollback acima). Trigger append-only em `agent_audit_log` — **verificado ativo no banco**. Middleware fail-closed (503 remoto sem senha). Cron com segredo. Anti-SSRF com resolução DNS. É o conjunto de travas mais completo da frota.

**Achados.**
- **[fato] Credencial `postgres`** (seção 0). O `twk_db_agent` do próprio repositório nunca foi criado.
- **[fato] Seis scripts da raiz escrevem sem passar por `db-audited.js`** (`enrich_photos_v2`, `fix_opera`, `price_fill`, `price_v1_probe`, `seo_structured_data`, `unpublish_no_photo`). O `unpublish_no_photo` marcou **985** restaurantes em `enrichment_log` e deixou **zero** linhas em `agent_audit_log`. A trilha "imutável" só cobre o que passa pelo app ou pelos 3 scripts auditados.
- **[fato] O app é pouco usado.** `agent_audit_log` tem 44 linhas no total; `db-architect` assina 14, a última em 2026-09-08. O `pg_cron` (21) e o `orquestrador` (5) escrevem mais que o agente.
- **[fato] Catálogo saudável:** 3.763 restaurantes, 1.546 publicados, **0** publicados sem foto/e-mail/URL, 978 marcados `ready_pending_photo`.
- **[lacuna]** Não sei se o app está implantado (o `.env.local` não tem `DASHBOARD_PASSWORD`; localmente roda aberto em localhost por desenho).
- **[fato]** `.env.readonly.local` continua no OneDrive (pendência assumida no ADR-013).

**Nota 7,5.** Tecnologia 9; capacidade real 6, porque o que efetivamente escreve no catálogo em volume são os scripts, não o agente — e eles rodam fora das travas.

---

## 2. Orquestrador + MAESTRO — 7,0

**Stack.** Central de Comando em Node puro (servidor `http`, SSE, **uma** dependência: `@anthropic-ai/sdk`), 2.534 linhas em 12 módulos. Modelos: Opus 4.8 padrão, Fable 5/5.1 em crítico/marca/legal/dinheiro. Prompt caching, custo em inteiros (e-4), tetos diários. **0 testes unitários**; 15 casos determinísticos dos hooks (PowerShell, 15/15) e 4 suítes de eval (guardião 49, opt-out 43+1, chave-girada 21, notificação 76). 138 documentos markdown.

**Poderes.** Conversa multimodal com **ferramentas só de leitura** (KPIs da frota, GET autenticado nas APIs dos agentes, estado do Orquestrador, SELECT via DBA com guarda dupla, sub-consulta a personas). Blocos `aprovacao` → cartão → clique do fundador → **e-mail** (webhook n8n ou Resend) ou **escrita no banco** via DBA (`/api/db` `action: mutate` — contrato **verificado** dos dois lados; feature flag, token de escrita dedicado, confirmação tipada para destrutivo). Regência (relatos → consolidação → despacho diário → e-mail ao fundador). Vigia determinístico. Hooks do Claude Code: `guard-sql` (bloqueio), `log-action` (auditoria), `validate-handoff`.

**Achados.**
- **[fato] O contrato de handoff é quase cerimonial:** `tasks.jsonl` tem 18 tarefas, a última em 2026-09-10. A operação real acontece em ~40 scripts CLI sob `orchestrator/agents/` (Guardião, ciclo-cliente, chave-girada, maestro-atendimento, dba-escrita), cada um com seu `--apply --aprovacao`.
- **[fato] A auditoria está viva:** 2.808 linhas em `logs/` (`tool_use` 1.864, `despacho_email` 175, `email_envio` 73, `guardrail_block` 14, `escrita_bloqueada` 9) — e **22 linhas inválidas** (JSON quebrado).
- **[fato] Um token único** (`CENTER_TOKEN`) para toda a Central: não há identidade de operador na aprovação — ao contrário de Atlas e Aria, que têm.
- **[fato] `gerir-reserva.js` lê a reserva raspando o HTML de `/r/`** (contrato descoberto por engenharia reversa do bundle em 10/09). Correto pelo ADR-004 (usa o caminho da plataforma), mas quebra no primeiro deploy do site que mude a serialização.
- **[fato] Agendamento num notebook de 2 núcleos/4 GB** — incidentes de 04/09 e 11/09 documentados; o README da Regência propõe hospedar.
- **[fato]** Os hooks governam **esta sessão do Claude Code**, não os serviços implantados. "Segurança é código" é verdade aqui; nos serviços, cada um tem a própria.

**Nota 7,0.** Governança e doutrina 9 (raras de ver aplicadas com esta consistência). Engenharia da execução 5,5: sem testes no núcleo, script sprawl, agendador frágil, chave compartilhada.

---

## 3. CLAVIS — 7,5

**Stack.** Node/TS, Express, `helmet`, `pg`, `zod`, Claude SDK; Central React/TS. 54 fontes, **24 testes passam** (segurança + fase 0), 18 evals. Opus 4.8 (raciocínio, extended thinking, effort high) + Haiku (rápido); verificador red-team em segunda chamada sem persona; prompt caching; teto diário de tokens com degradação.

**Poderes.** 6 personas (chefe, caçador, diplomata, analista, vigia, cobrador). Tools: `query_database` (RO, `LIMIT` embrulhado em subquery, `customer_id` só em agregação), `propose_action` (Portão: `db_write | notion | n8n | gmail | gsc | whatsapp | suppress`), `account_dossier`, `search_console`, `ga4_analytics`. Motor de outreach Tier A com cadência, rastreio de abertura, unsubscribe HMAC público, supressão, inbox agêntico (resposta do restaurante classificada pelo Diplomata). Fulfillment (Cobrador) contra reservas Pending. Vigia com baseline. Notion. Auth Bearer + rate limit por operador + tickets efêmeros para SSE.

**Achados.**
- **[fato] Modo teste:** `OUTREACH_TEST_TO` está definido no `.env` (24 caracteres) — **todo envio é redirecionado** para um endereço interno. Coerente com a auditoria de 18/08 e com a memória.
- **[fato] Escrita desligada de fato:** `DB_WRITE_URL` vazia, `CLAVIS_DB_WRITE_ENABLED` ausente. Mas o papel `clavis_rw` existe no servidor com DML em `reservations` (seção 0).
- **[fato] `clavis_ro` correto:** só SELECT; sessão `default_transaction_read_only=on` imposta pelo próprio pool.
- **[fato] Cobertura magra:** 24 testes para 54 fontes; os módulos de outreach (composer, cadence, ledger) não têm teste dedicado.
- **[fato] README desatualizado em partes** ("iniciado numa pasta vazia"; "o que falta para destravar" de 2026-08-05).
- **[fato, herdado]** Resultado de negócio: 185 e-mails → 0 contas (dossiê de 15/09). A nota abaixo é de tecnologia; o resultado é outro assunto.

**Nota 7,5.** Cérebro 8,5; motor de envio 7; testes 5.

---

## 4. Atlas — 8,5

**Stack.** Node/TS, Fastify, `drizzle-orm`, `postgres`, `stripe`, `pino` (com redação de PII/segredos), `zod`, Claude SDK. 66 fontes, **140 testes passam** (15 arquivos), **52 evals** com gabarito numérico derivado por SQL. Auditoria forense própria (`AUDIT.md`, scorecard por dimensão) e `EVOLUTION.md` (71 → 112 testes, 2 críticos e 13 altos corrigidos em 48h). Postgres 17 próprio (banco `atlas` na mesma instância).

**Poderes.** Espelho Stripe por webhook assinado → outbox transacional → worker com retry, DLQ, reaper de eventos presos e shutdown gracioso; backfill paginado. Ledger append-only (trigger). Métricas determinísticas em `bigint` half-even: MRR, movimento (NRR/GRR/churn), ARPU, LTV, aging — o LLM explica, não calcula. Reconciliação com checagem 0 contra a API do Stripe. Anomalias com limiares explícitos. Forecast em 3 cenários + probabilístico + backtest. What-if. Dunning. Fechamento diário Europe/Paris com DST testado. Tools: 11. **Ações Stripe** (`refund.create`, `subscription.cancel`, `subscription.pause`, `invoice.retry`) em ciclo proposed → confirmed → executed com **4 olhos**, TTL de proposta, teto de refund com dupla confirmação, identidade por operador (`ATLAS_OPERATOR_KEYS`, SHA-256 em tempo constante). Alertas via n8n.

**Achados.**
- **[fato] Camada de serviço roda como `postgres`** (seção 0). O `atlas_agent_ro` está certo (read-only, 15s).
- **[fato] 14 tabelas do Atlas existem dentro do `twk_auth`** (`stripe_*`, `ledger_entries`, `audit_log`, `sync_outbox`, `fx_rates`) — as verificadas têm **0 linhas**. Sobra de uma migration rodada no banco errado. Inofensiva, mas polui o schema de produção da plataforma. **Correção da primeira versão deste relatório:** eu havia contado 15; `stripe_webhook_events` tem coluna `deposit_id` e é da **plataforma** (depósitos), não do Atlas — nunca pode entrar num DROP.
- **[lacuna]** Não consigo saber se a chave Stripe é *live* ou *test*, nem o volume real de transações. Pela realidade do funil (0 contas), o motor está dimensionado muito acima do uso — mérito da engenharia, não defeito.
- **[fato]** Um teste emite logs de erro ruidosos no stdout (validação Fastify) — cosmético.

**Nota 8,5.** É o repositório que eu usaria como referência para os outros.

---

## 5. Quill — 8,0

**Stack.** Monorepo npm workspaces: `apps/admin` (Next.js 15, React, `nodemailer`), `apps/jobs` (Node/TS, `googleapis`, `pg`, `zod`, Claude SDK), `packages/shared`. Postgres 16 próprio com **26 migrations** (enums, auditoria editorial, fila, clusters/keywords SEO, briefs, versões, aprovações, métricas GSC, funções/triggers, views, baselines, **pgvector**, atribuição, aprendizado, canibalização, variantes de título, comandos, oportunidades, rascunhos de meta title, bandit, citações de IA, links internos, alertas, outbox de e-mail). **202 testes passam** (135 shared + 67 jobs). Golden set de 7 fichas para eval. Sonnet padrão, Opus crítico, Haiku triagem; tetos de custo diário e mensal.

**Poderes.** Ingestão e checagem GSC; auditoria de conteúdo; reescrita de ficha e de cidade; blog; variantes de título com bandit; rascunhos de meta title; detecção de canibalização; atribuição de resultado; recomputação de aprendizado; oportunidades e quick wins; citações de IA (GEO); `llms.txt`; sugestão de links internos; alertas de métrica; e-mail (outbox). Admin com fila de aprovação, catálogo, inteligência, métricas, mail, style guide, títulos, e **apresentação pública** para investidor. Write-back no banco da TWK — `db_restaurants.about_text`, `meta_title`, `meta_description` (e em `cities`) — **só na aprovação humana**, uma linha, atômica.

**Achados.**
- **[fato] Write-back como `postgres`** (seção 0). O `quill_writer` — com `UPDATE` **em nível de coluna**, a melhor definição de papel da frota — nunca foi criado.
- **[fato] `SERP_MODE=mock`:** os módulos que dependem de SERP (canibalização, oportunidades) rodam sobre dados fictícios enquanto `LLM_MODE=real`.
- **[fato] As colunas `meta_title`/`meta_description` existem em `db_restaurants`, com 0 preenchidas.** A integração pedida ao dev do site (`docs/13`) ainda não fechou o ciclo.
- **[fato] README com "Estado atual" obsoleto** (diz "scaffolding em curso, Fase 0" para um sistema com 26 migrations e deploy).
- **[fato]** Auth Basic fail-closed em produção; `/apresentacao` público por desenho.

**Nota 8,0.** Amplitude e disciplina de teste excelentes; perde por credencial, SERP simulado e por um README que engana para os dois lados.

---

## 6. Aria — 8,0

**Stack.** Node/TS, Express, Meta Cloud API (`axios`), `pg`, Claude SDK (Opus 4.8; Haiku para escopo e fallback de custo), `libphonenumber-js` (desde hoje). 75 fontes, **156 testes passam**, 8 evals com modelo. 22 tabelas `aria_*` criadas no boot pela própria app (migrations idempotentes).

**Poderes.** WhatsApp completo (texto com divisão, botões, listas, CTA, localização, mídia, indicador de digitando, templates com retry) e e-mail (Gmail direto ou n8n). **26 tools**: reservas por código/e-mail/telefone, perfil de cliente com memória e embeddings, busca e descoberta semântica de restaurantes com `confirma_pedidos` (≥4 pedidos em 90d e ≥50% aceitos — lei imutável nº 2), rotas e mapas, SQL de leitura guardado (`sqlGuard`: só SELECT, sem PII), consentimento, avaliação de experiência, escalação com tags, `manage_reservation` **pela API da plataforma**. `outboundGate` como porta única de saída (ADR-015). Filtro de escopo em duas camadas. Teto de custo diário com degradação de modelo. Sessões com checkpoint, sumarização, coalescência de rajadas. Monitor, tester, analista, alertas. Dashboard com **múltiplos operadores** e papéis. Desde hoje: lembretes/briefing/avaliação corrigidos, gatilho por evento, trava de telefone, log de saída, teto diário.

**Achados.**
- **[fato] Funções de escrita direta em `reservations`** (`createReservation`, `updateReservation`, `cancelReservation`) existem em `db.ts` e **não têm chamador** — código morto. Como a app cria tabelas no boot, sua credencial pode escrevê-las; só a convenção impede. **[lacuna]** Não sei qual `PGUSER` roda em produção (`.env.example` vazio; env no Easypanel).
- **[fato] System prompt de 678 linhas.** Superfície grande; o `outboundGate` é a mitigação certa, mas cada regra nova no prompt é uma aposta.
- **[fato] Evals com modelo: 8 casos** contra 156 testes unitários — o comportamento do modelo em si é pouco medido.
- **[fato, hoje]** O outbound ficou inerte por meses (bug de caixa no status, fuso ignorado) sem que nenhum monitor acusasse. Corrigido e agora com `reportarFalha` + `aria_outbound_log`.

**Nota 8,0.**

---

## 7. Guardião da Reserva — 8,5

**Stack.** Node puro, sem dependências, sem LLM. Motor `avaliar()` como **função pura** (degraus D1–D5, fuso via `Intl` sem biblioteca). `db.js` via `twk_ro` que **aborta se a sessão não for read-only**. 49 casos de eval, aprovados.

**Poderes.** Propostas de e-mail ao restaurante por casa (5 idiomas, rodapé de opt-out), fila humana de WhatsApp com prioridade, aviso honesto ao cliente via Aria. Regras que nenhum prompt altera: registro de opt-out ilegível → execução bloqueada; opt-out / `published=false` / `do_not_relist` → sem contato; máx. 2 contatos por reserva; 1 e-mail por casa a cada 24h; 50/dia; janela 08–22h local.

**Achados.** **[fato]** Depende do agendador do notebook e do webhook n8n `maestro-email`. **[fato]** Nunca seleciona PII de cliente. É o exemplo de como um agente novo deveria nascer.

**Nota 8,5.** Perfeito no que faz; faz pouco.

---

## 8. Sub-agentes do Orquestrador

| Sub-agente | Nota | Poderes | Achado principal |
|---|---:|---|---|
| **registro-optout** | 8,0 | classificador determinístico multilíngue com detecção de injeção; fonte interina JSONL append-only; `listing_consent` e `do_not_relist` já existem no banco | 43+1 evals verdes; "não é agente", é extensão — desenho correto |
| **dba-escrita** | 7,5 | única porta de escrita: aprovação gravada, transação obrigatória, backup antes de DELETE, sha256 no audit | validador com 6 casos rodados em 08/09 **fora do harness**; `twk_dba` tem DELETE em 90 tabelas de `public` (inclui `aria_*`) — mais amplo que a allowlist do app do DBA, aceitável pelo ADR-013 |
| **maestro-atendimento** | 7,0 | exclusão ponta a ponta (dossiê, SQL para o executor, cartas no idioma do cliente com alternativas por `confirma_pedidos`); gerir reserva pela API da plataforma | leitura da reserva por raspagem do HTML de `/r/` — frágil |
| **ciclo-cliente** | 7,0 | véspera, pós-visita, boas-vindas — determinístico, ledger, consentimento, máx. 40 | em operação desde 11/09 num agendador que morre sem memória |
| **chave-girada** | 6,5 | envio de extratos e sequências por e-mail com ledger, opt-out, tetos | **script sprawl**: arquivos datados de uso único (`fundadores-*-2026-09-14.js`, `_scan-*.js`) misturados a ferramentas permanentes |
| **notificacao-reserva** | (hoje) | textos como dado + eval de 76 casos + teste de mutação | é trabalho meu de hoje — não me dou nota; o eval e os 11 mutantes mortos estão no relatório da sessão |

---

## 9. O que é bom de verdade (para não perder de vista)

**[fato]** A doutrina não é só texto. Vi aplicado em repositório após repositório: comparação em tempo constante, fail-closed sem configuração, dry-run por padrão, `--apply` exigindo `--aprovacao`, ledgers append-only com trigger, minimização de PII (domínio em vez de e-mail, código em vez de telefone), dinheiro em inteiro, "dado observado é dado". Isso é raro em equipes grandes; aqui está em uma pessoa com agentes.

---

## 10. Correções, por dano evitado

1. **Criar `twk_db_agent` e `quill_writer`** (os `.sql` já existem) e trocar as três `DATABASE_URL` que usam `postgres`. Um dia de trabalho; elimina a chave-mestra de três agentes.
2. **Revogar `CREATEROLE`/`CREATEDB` de `clavis_rw` e `vertex_readonly`**; retirar de `clavis_rw` o DML em `reservations`.
3. **Aposentar ou roteirizar os 6 scripts da raiz do DBA que escrevem sem auditoria** — ou fazê-los passar por `db-audited.js`, como os outros 3.
4. **Apagar as 14 tabelas vazias do Atlas dentro do `twk_auth`** (DDL humana) — nunca `stripe_webhook_events`, que é da plataforma.
5. **Hospedar a Regência e os cron dos sub-agentes** fora do notebook (o README já propõe).
6. **Testes no Orquestrador**: o núcleo que coordena, executa SQL e envia e-mail tem zero.
7. Corrigir os READMEs de CLAVIS e Quill; consertar as 22 linhas inválidas do audit.

## 11. O que eu não sei

Se o app do DBA está implantado; qual credencial a Aria usa em produção; se a chave Stripe do Atlas é live; o estado real do n8n (o conector vê 17 de 61 workflows); se o `SERP_MODE=mock` do Quill vale também em produção. Cada um desses muda uma nota em até meio ponto.
