# Relatório ao fundador — de 21/08 a 04/09/2026

> Cobre: a campanha de e-mails aos estabelecimentos, a reformulação dos e-mails de notificação de reserva no n8n, e a nova estrutura do time de agentes. Todo número tem fonte (ledger, banco via `twk_ro`, backups do n8n, logs de auditoria). Rotulagem: **FATO** · **SUPOSIÇÃO** · **SEM DADO**. Data: 2026-09-04 · trace `trc-agentes0902`.

---

## 1. E-mails enviados a estabelecimentos

### 1.1 Campanha "Círculo de Fundadores" (21/08 → 01/09) — `conta_profissional_fundadores_2026_08`

| Métrica | Valor | Fonte |
|---|---|---|
| **Envios reais** | **166** (+1 cópia de teste ao time) | `orchestrator/state/envios-fundadores-2026-08.csv` |
| **Restaurantes únicos** | **148** | idem |
| Ondas | 1-ENGAJADOS 18 · TOQUE2-A 17 · TOQUE2-B 22 · COORTE-L1 35 · RESPOSTA-DIRETA 1 · COORTE-L2 37 · COORTE-L3 36 | idem |
| Datas | 21/08, 26/08, 28/08, 31/08, 01/09 | idem |
| Idiomas | EN 71 · FR 36 · IT 27 · PT 25 · ES 7 | idem |
| Não entregues (DNS/servidor) | 3 casas: BILLIONAIRE, DON SEBASTIÃO, MISHIGUENE (e-mail morto no catálogo) | log 28/08 |
| Respostas humanas | 3 (ELEOS, EAT SIGHT STORY DECK, WOO TENDER — este pediu o código 2× e não concluiu) | logs 28–31/08 |
| Abertura | **SEM DADO** (sem pixel); cliques no `/go` não lidos | — |
| **Contas ativadas** | **0 verificáveis** — `restaurant_users` tem 2 linhas, ambas internas ("Le Julien", "Marlon Food"); nenhuma criada após 20/08 | banco |

Achados colaterais desta campanha: 26 casas com e-mail morto (431 pendências presas); 413 publicados com horário genérico; e-mails da campanha **sem link de opt-out** (corrigido em 03/09: rodapé nos 10 templates + guardrail `exigirOptout()` que bloqueia envio sem link resolvido).

### 1.2 Nudges manuais de pendências (31/08)
14 e-mails a restaurantes com mesa em ≤72h (esteira manual, aprovada no chat). Um bounce: JOAQUINA (endereço inexistente — registrado em `contatos-invalidos-2026-09-02.csv`).

### 1.3 Campanha "Chave Girada" (só quem responde) — `chave_girada_2026_09`

| Métrica | Valor |
|---|---|
| Alvo | 33 casas que responderam ≥1 pedido em 180 dias (289 de 340 respostas em nome próprio) — 11 confirmadores · 7 mistos · 3 recusadores · 12 ocasionais |
| Testes | 2 (Boteco Belmonte → equipe; cópia → fundador), 03/09 |
| **Leva 1 (11 confirmadores)** | **11/11 enviados em 04/09 às 19:45 UTC** (ATHÉNÉE, PAPADAKIS, ELEOS, THREE SIXTY, Oslo Court, L'EVANGELISTA, GIRARROSTO FIORENTINO, LA TABLE DE MARIE, SCARTUCCIO, LUCA'S, REPOLHO) — aprovação do fundador em 03/09 |
| Levas 2–3 | 19 casas (B/D) + SRI TRAT após conversa — aguardam aprovação |
| Formato | identidade visual dos e-mails transacionais, cartão-extrato com o número da casa, um botão, três passos com e-mail mascarado, assinatura pessoal, opt-out; 21 testes automáticos |

**Total de e-mails a estabelecimentos no período: 166 (fundadores) + 14 (nudges) + 11 (Chave Girada) = 191 envios reais**, mais 3 testes.

### 1.4 Incidente de 04/09 (transparência)
A leva 1 estava agendada para 08:00 UTC por tarefa do Windows. A tarefa só disparou às 16:34 local e **ficou presa antes do primeiro envio**; as tarefas da Regência (08:00) e do Guardião (09:00) **também não rodaram** — você não recebeu o Despacho de 04/09 pela manhã. Causa provável: notebook em suspensão + ausência de log. Correção aplicada no mesmo dia: envio manual da leva 1 e do Despacho; agendador refeito com log por tarefa, *WakeToRun* e gatilho horário corrigido. Solução definitiva continua sendo a Regência hospedada na Central (EasyPanel). Detalhe: `orchestrator/logs/2026-09-04-incidente-agendador.md`.

---

## 2. Otimização dos e-mails de notificação de reserva (n8n)

### 2.1 Linha do tempo (fatos dos backups em `docs/notificacoes/backup-n8n/`)

| Data | O que | Evidência |
|---|---|---|
| 24–25/08 | Inventário dos 17 fluxos visíveis (de 61); achados: SQL interpolado no fluxo 1, 14 webhooks sem autenticação, "envia token" morto, confirmação automática hardcoded (255019) | `docs/notificacoes/inventario-n8n.md`, Notion "Fluxos n8n" |
| 26/08 11:53 | Correção do SQL do fluxo 1 (query parametrizada) | backup `ztI9ws9F6BAGJSGr-sqlfix-20260826` |
| 26/08 17:25 | **Família Clé d'Or aplicada** aos fluxos de reserva e conta (3, 4, 5, alteração, reset, desativação, parceria): identidade escura TWK, dourado, emblema, botões retos, 23 templates em `docs/notificacoes/templates/familia/` | backups `*-20260826-172508`; fluxo 3 atual com "Your table is reserved." |
| 27/08 (3 iterações) | **E-mails duplicados corrigidos** no fluxo 1: resposta imediata ao webhook em todos os ramos + `waitForSubWorkflow=false` (a execução ficava presa 6–12h → timeout → retry → duplicata) | backups `ztI9ws9F6BAGJSGr-fixdup-20260827-*` |
| 01/09 | Auditoria via API REST: fluxo 2 (6h/12h) existe e funciona (100+ execuções); taxa de resposta subiu de 16,2% para 22,8% desde a criação do lembrete; `followup_6h_sent_at` nunca gravado | Notion "Fluxos n8n" |
| 03/09 20:18 | **E-mail do código de acesso** (`listing-otp`): template refeito no padrão TWK, no lugar do template branco com a marca **"The World's Kitchen"** — o ponto onde o WOO TENDER desistiu | colado pelo fundador; verificado por leitura |
| 03/09 20:24 | **Pós-resposta** (fluxo 3, Establishment Accept/Decline): cartão "Activate my key" | colado pelo fundador; verificado |
| 03/09 20:45 | **Notificação do pedido** (fluxo 1) e **lembrete de 6h** (fluxo 2): linha "Activate my key" sob o botão principal | aplicado via API, backups `*-antes-cta-notificacao-*`; verificado |

### 2.2 Estado atual dos e-mails ao restaurante
| E-mail | Identidade TWK | Convite à chave | Observação |
|---|---|---|---|
| Notificação de novo pedido | ✅ | ✅ (03/09) | é o que 100% dos respondedores leem |
| Lembrete 6h | ✅ | ✅ (03/09) | às 12h só o cliente é lembrado (lacuna do fluxo) |
| Pós-aceite / pós-recusa | ✅ | ✅ (03/09) | |
| Código de acesso | ✅ (03/09) | — | antes: marca errada |
| Reagendamento, cancelamento, alteração, parceria, senha | ✅ (26/08) | — | 3 defeitos de template conhecidos (fence literal, "Dear Monak Paris" fixo, número de WhatsApp inconsistente) — Notion, achado 6/7 |

**Ainda não feito:** tela `/r/` pós-resposta (front) · **segurança do `/r/`**: reserva vencida segue acionável e expõe dados do cliente sem login (P0 do cadrage) · `published=false` → 404 · lembrete de 12h ao restaurante · autenticação nos webhooks.

---

## 3. A nova estrutura do time de agentes

### 3.1 Antes (até 01/09)
5 agentes independentes (CLAVIS comercial · Aria suporte · Quill editorial · Atlas financeiro · TWK DB Architect) + Orquestrador no Claude Code + Central de Comando (MAESTRO). Integração pelo banco compartilhado; fundador indo de painel em painel; nenhum agente dono da reserva pendente; sem registro de opt-out; sem eval comum.

### 3.2 O que foi decidido e construído (02–04/09)

| Peça | O que é | Estado / evidência |
|---|---|---|
| **Matriz de lacunas** | 24 problemas (12 do Dossiê + 12 do banco), cada um com dono, cobertura e melhor solução — metade é front-end, não agente | `docs/agentes/00-matriz-de-lacunas.md` |
| **Priorização RICE** | 17 candidatos pontuados; **6 hipóteses rejeitadas** com argumento (ativação, conector, CS parceiro, fidelização, qualidade de dados, avaliador como agentes; voz por IA) | `02-priorizacao.md` |
| **Guardião da Reserva** — único agente novo | Máquina de estados por reserva, núcleo sem LLM: 24h e-mail → WhatsApp/telefone humano → cliente avisado via Aria. Fail-closed sem registro de opt-out; nunca contata casa com opt-out/`published=false` | código + **48/48 testes**; canário dia 0 (dry-run): 105 pendências, 44 casas a cobrar, 12 clientes a avisar |
| **Registro de Opt-out de Listagem** — extensão | Tabela `listing_consent` **criada em produção (03/09)** com trigger que **impede republicar** casa com opt-out (Cañete testado); classificador multilíngue de pedidos de remoção; Aria ganhou o FLUXO 7 e as tags `REMOCAO_LISTAGEM`/`CORRECAO_LISTAGEM` | **43/43 testes**; zip correto da Aria gerado (o subido em 01/09 não tinha o FLUXO 7) |
| **Regência (ADR-012)** | Agentes reportam ao MAESTRO por contrato de relato; MAESTRO consolida, decide por nível de autonomia e **despacha ao fundador por um único canal** (e-mail `thekeys.marlon@gmail.com`, testado) | 8 relatos/ciclo; Despachos 02, 03 e 04/09 gerados |
| **Harness de eval (ADR-011)** | Runner comum, sem LLM, ≥30 casos por agente; nada entra em canário sem verde | 48 + 43 + 21 casos verdes |
| **Central de Comando** | backlog RICE (9 itens), fila de perguntas (13), rotas `/api/relatos`, `/api/despachos`, `/api/regencia/run`, cron hospedado `REGENCIA_ENABLED` | código; deploy pendente |
| **Contrato de handoff v1.1** | + `guardiao-reserva` | `handoff.schema.json` |
| **ADRs** | 009 (agente só por gargalo medido), 010 (registro de opt-out), 011 (eval e canário), 012 (Regência) | `docs/adr/` |
| **Chave Girada** | Plano de conversão só para quem responde; 4 vazamentos do funil encontrados e 3 corrigidos no n8n; leva 1 enviada | `PLANO-CHAVE-GIRADA.md`, `CADRAGE-FRONT-CHAVE-GIRADA.md` |

### 3.3 O que a estrutura já revelou (Despachos 02–04/09)
10 clientes com mesa no mesmo dia sem resposta (02/09) · 3 casas despublicadas ainda recebendo pedidos · 4 escalações da Aria abertas desde jul/ago · aceite de não-parceiros 10% vs parceiros 59% · Editorial e Financeiro "cegos" (sem credencial na Central) · `/r/` de reserva vencida acionável e expondo PII (crítico, front).

---

## 4. Verdade brutal
- 166 e-mails a 148 casas → **0 contas**. O funil se apresentava como outra marca no passo decisivo e ficava calado no momento de maior intenção. Isso foi corrigido em 03/09; a leva 1 da Chave Girada é o primeiro envio que passa por um funil consertado.
- **Nenhuma conta real existe ainda.** O KPI que importa continua em zero até um dos 11 concluir o cadastro.
- O agendador local falhou no primeiro dia útil. Um notebook não é infraestrutura: enquanto a Regência não for hospedada, todo ciclo automático depende de a máquina estar acordada.
- Segurança do `/r/` é anterior a qualquer conversão: dado pessoal exposto sem login.

## 5. O que depende de você (ordem)
1. Subir o zip correto da Aria (`aria_agent_whatsapp-FLUXO7-2026-09-02.zip`) e redeploy.
2. Front: segurança do `/r/` (P0) e as 3 strings + botão do cadrage.
3. Central hospedada: `REGENCIA_ENABLED=on`, `DATABASE_URL_RO`, e-mail, e credenciais de Quill/Atlas/Aria/CLAVIS.
4. Aprovar a leva 2 quando a leva 1 mostrar sinal (3–5 dias).
5. Template de WhatsApp no Meta para a Aria iniciar conversas com restaurantes.
