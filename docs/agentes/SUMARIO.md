# Sumário executivo — quais agentes novos merecem existir (2026-09-02)

> Arquiteto-Chefe de Agentes · trace `trc-agentes0902` · Fontes: Dossiê de Conversão e Retenção (02/09), banco `twk_auth` via `twk_ro` (somente leitura), logs e ledgers da operação, código dos 5 agentes, Notion. Detalhe: `docs/agentes/00-*.md` a `03-*.md`, specs `agente-*.md`, ADR-009/010/011.

## Gargalo nº 1
**O pedido de mesa nasce pendente e morre em silêncio.** Agosto/2026: 294 pedidos (dedup), 34 aceitos, 194 pendentes. Não-parceiros aceitam 9% (90d); parceiros, 51%. Hoje há 104 pendências vivas em 66 casas e ninguém é dono delas: o n8n lembra 6h/12h e não grava; a Aria tem o vigia desligado; o CLAVIS só cobra 6 parceiros; o resto é nudge à mão.

## Aprovado (2 iniciativas neste ciclo de 30 dias)
1. **Registro de Opt-out de Listagem & Intake de Remoção** — *extensão* Aria + DBA (RICE 176). Não existia registro nenhum (`aria_contact_consent` = 0 linhas); a campanha contactou 148 casas sem link de opt-out; o Cañete foi honrado à mão e pode voltar ao ar por script. Construído: registro (Cañete já dentro), classificador multilíngue, varredura, FLUXO 7 da Aria (tags `REMOCAO_LISTAGEM`/`CORRECAO_LISTAGEM`), rodapé de opt-out, migração proposta. Eval 41/41.
2. **Guardião da Reserva** — *o único agente novo* (RICE 135, **a aposta grande**). Máquina de estados por reserva, núcleo sem LLM: 24h e-mail à casa → WhatsApp/telefone humano → cliente avisado com a verdade e alternativas via Aria. Fail-closed sem o Registro; nunca contata casa com opt-out ou `published=false`. Eval 48/48. Canário dia 0 (dry-run, dados reais): 105 pendências → 66 e-mails em 44 casas, 10 na fila humana, 12 clientes a avisar, 3 com mesa hoje.

## Rejeitados (com argumento em `02-priorizacao.md` §3)
Concierge de Ativação (148 e-mails → 0 contas verificáveis: o funil quebra na porta do site, não no follow-up) · Conector de sistemas de reserva (`booking_url` vazio em 1.548 casas; 24 parceiros) · CS de parceiro (6 parceiros com movimento) · Fidelização do cliente como agente (é ligar 3 flags da Aria) · Qualidade de dados como agente (o DBA e o script existem — rodar, não criar) · Avaliador como agente (é CI: `orchestrator/evals/`) · Voz por IA. **Metade do Dossiê é front-end**; nenhum agente substitui a página "Para restaurantes", o copy honesto e o 404 em `published=false`.

## O que muda
- **30 dias:** Registro em produção (DDL do fundador + redeploy da Aria); Guardião em canário em Paris/Atenas/Marrakech, 20 e-mails/dia, com relatório de 7 dias; JOAQUINA/DON SEBASTIÃO/BILLIONAIRE roteados por telefone; primeira medição real de tempo de resposta.
- **60 dias:** Guardião a 100% do volume ou desligado pelo critério de morte (resposta em 72h não sobe ≥10 p.p. e aceite < 12%); auditoria dos 413 horários genéricos executada; campanha só continua com opt-out em todo e-mail.
- **90 dias:** aceite de não-parceiros de 9% → meta 18%; se a página "Para restaurantes" existir, o relatório mensal de demanda entra como rotina do CLAVIS — com o Guardião garantindo que o número enviado ao dono seja de pedidos atendidos, não de falhas nossas.

## Verdade Brutal
- A campanha de 167 e-mails não converteu ninguém que o banco consiga provar: `restaurant_users` tem 2 linhas, nenhuma desde 20/08. "Abertura alta" nunca foi medida. Mandar mais e-mail sem porta de entrada é ruído com a nossa marca.
- Três casas despublicadas (DAL BOLOGNESE, DIOR DES LICES, NODAIWA AZABU IIKURA HONTE) continuam recebendo pedidos. O Cañete não foi um caso; é o padrão. Desde 03/09 o banco impede que sejam republicadas, mas só o front tira a página do ar.
- O gargalo real do time não é token, é atenção humana por aprovação unitária. Um agente que gere mais cliques do fundador piora o problema — por isso os dois aprovados trabalham em lote e por exceção.
- Não existe timestamp de mudança de status: o KPI que este projeto promete medir nunca foi mensurável. Começa do zero hoje.
- Os três clientes com mesa hoje sem resposta não serão salvos por agente nenhum. É telefone humano, agora.

## O que eu não sei
Cliques do `/go` (abertura real) · volume de pedidos de remoção em `support@` (só `reservation@` foi varrida: 1 caso em 30 dias) · software de reserva por casa (0 dados) · custo real mensal dos agentes (estimado; Central sem URLs) · definição de "cliente que volta" (0,8% no Dossiê vs 8% por dedup) · se o link `/r/{código}` e o webhook `/go` aceitam o que os templates assumem · o que é "MERCÚRIO" (tratado como CLAVIS). Perguntas com bloqueio marcado em `orchestrator/command-center/state/perguntas.jsonl`.

## Portões que só o fundador abre — situação em 2026-09-03
| Portão | Situação |
|---|---|
| Rodar a DDL `listing_consent` | ✅ **executada em 03/09** com aprovação explícita do fundador; guardrail anti-republicação testado |
| Redeploy da Aria (FLUXO 6 + 7) | ⏳ pendente — o zip subido em 01/09 **não continha o FLUXO 7**; usar `aria_agent_whatsapp-FLUXO7-2026-09-02.zip` |
| Aprovar o primeiro lote do degrau 1 | ⏳ pendente — lote montado às 09:00 pela tarefa agendada; aprovação pela frase "aprovo o lote do Guardião" |
| Q-01, Q-08, Q-11, Q-03 | ✅ respondidas (duas por verificação própria, sem custar tempo do fundador) |
| Q-09 (front: 404, copy, `status_changed_at`), Q-12 (`/go`) | ⏳ abertas |

Nenhum e-mail a restaurante ou cliente foi enviado. A única escrita em produção foi a migração aprovada. Nada foi commitado.

## Adendo 2026-09-02 (tarde) — Regência ligada (ADR-012)
A pedido do fundador, os agentes passaram a reportar ao MAESTRO por contrato e o MAESTRO passou a despachar ao fundador por um único canal. Primeiro ciclo real (`orchestrator/command-center/state/despachos/2026-09-02.md`): 8 relatos, 15 achados, 2 críticos — **10 clientes com mesa hoje sem resposta**, 3 casas despublicadas recebendo pedidos, 4 escalações da Aria abertas desde julho/agosto, aceite de não-parceiros em 10% (30d) contra 59% dos parceiros. Editorial e Financeiro estão cegos até as URLs/credenciais entrarem na Central. O e-mail do Despacho aguarda o endereço do fundador e o provedor configurado; até lá o Despacho vive na Central (Missões) e no comando `/despacho`.
