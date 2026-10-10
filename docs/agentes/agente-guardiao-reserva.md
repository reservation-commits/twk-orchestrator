# Agente · Guardião da Reserva (`guardiao-reserva`)

> Spec v1 · 2026-09-02 · trace `trc-agentes0902` · Status: **spec para portão humano** (Fase 5, passo 1). Único agente novo aprovado nesta sessão.
> Código: `orchestrator/agents/guardiao-reserva/` · Definição: `.claude/agents/guardiao-reserva.md` · Eval: `orchestrator/evals/guardiao-reserva/`.

## 1. Missão e problema que mata

**Missão:** nenhuma solicitação de reserva morre em silêncio — o restaurante é cobrado pelo canal que está vivo, em janelas fixas; o cliente ouve a verdade antes da data, com alternativa; tudo é medido.

**Mata:** linha **H** da matriz (gargalo nº 1: 6/100 confirmados; agosto: 34 aceitos de 294; não-parceiros aceitam 9%), e as linhas C1 (fila de ligações), 14 (roteamento por contato morto) e 16 (medição de tempo de resposta). Referência: `docs/agentes/00-matriz-de-lacunas.md`.

Não é um chatbot. É uma **máquina de estados por reserva** com núcleo 100% determinístico (SQL somente-leitura + regras + templates em 5 idiomas). O LLM entra em exatamente um ponto: a composição da mensagem ao cliente com alternativas (degrau 4), e mesmo aí por handoff à Aria, dona do canal do cliente.

## 2. Gatilho

- **Cron horário** (n8n Schedule ou tarefa agendada rodando `node orchestrator/agents/guardiao-reserva/run.js`), das 08h às 22h no fuso do restaurante. Fora dessa janela só avalia, não propõe contato.
- Cada execução = uma tarefa do Orquestrador (`task_id` do dia, `trace_id` = `trc-guard-<AAAAMMDD>`), com handoffs filhos para Aria e humano.
- Sem gatilho por evento na v1: o n8n "1 - nova reserva" já cobre o D0 e os lembretes de 6h/12h. **Regra de um dono por notificação:** o Guardião não repete o que o n8n manda; começa em 24h.

## 3. Entradas e saídas

**Entrada (contexto mínimo, referências apenas):**
```json
{"task_id":"TWK-20260902-0003","trace_id":"trc-guard-20260902","origem":"orquestrador","destino":"guardiao-reserva",
 "objetivo":"Avaliar pendências vivas e propor o próximo degrau de cada uma.",
 "contexto_minimo":{"modo":"dry-run|apply","janela_horas":24,"aprovacao_ref":null},
 "prioridade":"alta","criterio_de_pronto":["toda pendência viva tem decisão registrada","nenhum contato proposto a casa com opt-out ou published=false","relatório do dia gravado"],
 "autonomia":"autonomo_com_log","orcamento":{"max_passos":8,"max_custo_eur":1},"criado_em":"…"}
```
**Saída — bloco `resultado` do contrato + artefatos:**
- `state/eventos.jsonl` (ledger próprio, append-only): `{ts, trace_id, reservation_code, restaurant_id, degrau, decisao, canal, motivo, aprovacao_ref}`.
- `state/propostas-<data>.json`: contatos propostos (lote para o Portão da Central).
- **Na Central (v4.6, 2026-10-10):** o Guardião é agente de primeira classe do cockpit do MAESTRO — página `#/guardiao` (atalho `6`), saúde no cabeçalho (varredura há ≤ 30 h e não pausado), persona na Conversa, `frota_kpis`/`ler_estado("guardiao")`, regras no vigia e identidade nos cartões de Aprovações. Leitura por `orchestrator/command-center/guardiao.js` (arquivos desta pasta; na hospedada, a cópia que `push-state.ps1` envia).
- `state/fila-ligacoes-<data>.csv`: tarefas humanas (telefone/WhatsApp), ordenadas por urgência.
- Handoffs filhos: `destino: suporte-concierge` (degrau 4, um por reserva) e `destino: humano` (fila).
- `relatorio-<data>.md`: contagens por degrau, por canal, por cidade; anomalias.

**Nunca trafega:** nome/e-mail/telefone do cliente; `booking_details` (pode conter alergia). Só `reservation_code`, `restaurant_id`, data/hora.

## 4. Ferramentas e permissões (lista fechada)

| Ferramenta | Permissão | Uso |
|---|---|---|
| Postgres via `twk_ro` | **somente leitura** (garantida por role, `default_transaction_read_only`) | pendências vivas, dados da casa, `opening_hours`, `timezone`, consentimento |
| Registro de Opt-out (`listing_consent` ou `orchestrator/state/listing-consent.jsonl`) | leitura | bloqueio de contato |
| `orchestrator/state/contatos-invalidos-*.csv` | leitura | roteamento por canal |
| Ledger próprio `state/eventos.jsonl` | escrita append-only local | idempotência e medição |
| n8n `POST /webhook/maestro-email` (Bearer) | **só em `--apply` com `aprovacao_ref`** | e-mail ao restaurante (degrau 1) |
| Central: `state/aprovacoes.jsonl` | escrita de proposta | portão |
| Handoff a Aria / humano | contrato v1 | degrau 4 / fila |

Sem acesso a: WhatsApp (Meta), escrita no banco, `nextauth."User"`, Stripe, `booking_details`.

## 5. Nível de autonomia por ação

| Ação | Início (canário) | Critério objetivo para descer um degrau |
|---|---|---|
| Ler pendências, classificar, gravar ledger, relatório | `AUTONOMO` | — |
| Degrau 1: e-mail-template ao restaurante (idioma da casa, link `/r/{código}`) | `REQUER_APROVACAO_HUMANA` (lote diário, uma aprovação) | Após 14 dias e ≥100 e-mails: 0 reclamações de restaurante, 0 erros de dado (data/hora/nome) na amostra de 20/dia revisada → `AUTONOMO_COM_LOG` |
| Degrau 2/3: gerar fila de WhatsApp/telefone para humano | `AUTONOMO_COM_LOG` (é tarefa humana) | — |
| Degrau 4: mensagem ao cliente com verdade + alternativas (via Aria) | `REQUER_APROVACAO_HUMANA` (uma a uma) | Após 50 mensagens aprovadas **sem edição** e 0 reclamações → `REQUER_APROVACAO_ORQUESTRADOR`. **Nunca** `AUTONOMO` enquanto a mensagem contiver recomendação de outra casa em nome da TWK. |
| Contato com casa que tem opt-out, `published=false` ou `do_not_relist` | **PROIBIDO** por código | — |
| Qualquer envio em massa (>50/dia) | `REQUER_APROVACAO_HUMANA` + revisão de orçamento | — |

## 6. KPIs (baseline · meta 30d · meta 90d · fonte)

| KPI | Baseline hoje | 30 dias | 90 dias | Fonte |
|---|---|---|---|---|
| Taxa de resposta do restaurante em 72h (aceite ou recusa) | **SEM DADO** (sem timestamp; medição começa no dia 0 do canário) | medido + ≥ +10 p.p. vs dia 0 | ≥ 40% | `eventos.jsonl` × `booking_status` |
| Taxa de aceite, não-parceiros (90d) | **9%** (95/1.051) | 12% | 18% | `reservations` ⋈ `partner=false`, dedup |
| Reservas que venceram sem nenhum contato ao cliente além do D0 | ≈ 100% das vencidas (0 mensagens de degrau 4 na história; ~25 vencem a cada 3 dias — runbook 31/08) | < 30% | < 10% | `eventos.jsonl` |
| Tempo até primeira ação do Guardião após 24h de silêncio | — | ≤ 2h (cron) | ≤ 1h | ledger |
| Casas "mortas" convertidas em canal vivo (e-mail corrigido/telefone confirmado) | 0 de 26 | 10 | 20 | `contatos-invalidos` × `db_restaurants` |

## 7. Critério de morte

Desligar o Guardião se, **60 dias após ampliação** (fim do canário), a taxa de resposta em 72h não tiver subido ≥10 pontos percentuais sobre o dia 0 **e** a taxa de aceite de não-parceiros continuar < 12%. Mantém-se só o degrau 4 (verdade ao cliente) se ele sozinho reduzir reclamações em support@; o resto é desativado com um comando (`--pause`).

## 8. Modos de falha prováveis e guardrails determinísticos

| Falha | Guardrail (código, não prompt) |
|---|---|
| Cobrar casa que pediu remoção (novo Cañete) | `bloqueios.js`: opt-out, `published=false`, `do_not_relist` → sem contato ao restaurante; se registro indisponível → **fail-closed** (não contata ninguém e marca `bloqueada`) |
| Spam ao restaurante | máx. 2 contatos por reserva; 1 e-mail/dia/restaurante (agrupa várias reservas numa mensagem); cooldown 72h após resposta |
| Escalar para o vazio (e-mail morto) | roteamento: domínio em `contatos-invalidos` → pula degrau 1, vai à fila humana |
| Data/hora errada (fuso) | tudo vem do banco; `timezone` da casa, fallback Europe/Paris **com flag `fuso_suposto`** no relatório |
| Prometer mesa / "confirmado" ao cliente | template do degrau 4 tem lista de tokens proibidos (`confirmad`, `garantid`, `reservamos`) validada por teste; alternativa sempre "sujeita a confirmação"; texto obrigatório: a casa "não é parceira e ainda não respondeu" |
| Volume anômalo (bug gera 1.000 contatos) | rate limit 50 e-mails/dia e 1 lote/dia; acima disso, `bloqueada` |
| Injeção via resposta do restaurante | respostas voltam pelas caixas da Aria (já neutraliza `[Sistema:`); o Guardião só lê `booking_status` do banco, nunca texto |
| Duplicar o lembrete do n8n (6h/12h) | o Guardião começa em 24h; janela configurável; teste de eval cobre reserva com 10h |
| Escrita acidental no banco | credencial `twk_ro` (bloqueio no servidor) + hook `guard-sql.ps1` |

## 9. Custo estimado × ganho

- **LLM:** núcleo = 0. Degrau 4 via Aria (Opus 4.8): ≈3k entrada + 400 saída ≈ US$0,025 ≈ €0,023/mensagem. Volume: ~100 mensagens/mês → **≈ €2,5/mês**. Teto: €20/mês (alerta em 80% = €16).
- **E-mail:** Gmail via n8n, custo zero marginal; ~400 e-mails/mês (≈200 pendências × ≤2).
- **Humano:** fila de mensagens de WhatsApp ~40/mês × 3 min ≈ 2 h/mês (texto pronto no idioma da casa; nenhuma ligação — o time não fala os idiomas); aprovações: 1 lote/dia (5 min) + ~100 mensagens de degrau 4 (1 min cada) ≈ **4 h/mês**.
- **Ganho esperado (SUPOSIÇÃO, para ser provada no canário):** subir o aceite de não-parceiros de 9% para 12% sobre ~1.000 pedidos/90d = **+30 mesas confirmadas por trimestre**; cada mesa confirmada é o argumento de venda do CLAVIS (parceiros aceitam 51%). O ROI não fecha em euros de assinatura em 90 dias (não há assinatura paga hoje); fecha em **reservas entregues** e **reclamações evitadas** — e isso fica dito.

## 10. Dependências

| Depende de | Estado | Se faltar |
|---|---|---|
| Registro de Opt-out (`agente-registro-optout.md`) | interino em JSONL (esta sessão) | fail-closed: sem contato a restaurante |
| `twk_ro` | existe (2026-08-28) | não roda |
| n8n `maestro-email` com Bearer | existe | só dry-run |
| Aria com FLUXO 6 em produção (donos respondendo ao nudge caem na Aria) | redeploy pendente | Aria responde mal ao dono → fila humana |
| Coluna `status_changed_at` na plataforma | **pedido ao front** | medição via ledger próprio (aproximada) |
| Dossiê 02 (copy honesto no site) | pendente | o Guardião diz a verdade no e-mail mesmo que o site ainda prometa "instantâneo" — incoerência registrada como risco de marca |

## 11. MVP de 1 semana

1. **Dia 1–2:** engine em dry-run diário sobre as 104 pendências vivas; ledger; relatório (feito nesta sessão — ver canário).
2. **Dia 3:** portão: lote do degrau 1 aprovado pelo fundador uma vez; envio via `maestro-email`; fila de mensagens no CSV/Central.
3. **Dia 4–7:** degrau 4 para as reservas em ≤24h (rascunhos via Aria, aprovação unitária). Relatório de 7 dias contra o dia 0.
Sinal mensurável em 7 dias: nº de casas que responderam após degrau 1 (baseline dos 14 nudges manuais de 31/08 é o comparável).

## 12. Red-team — três formas de causar dano e contenção

1. **Marca:** e-mail de cobrança chega a uma casa que nunca soube que estava listada e reage como o Cañete ("não consentimos"). Contenção: o template do degrau 1 abre com "sua página está listada gratuitamente na TWK" + link "corrigir/retirar" (opt-out em 1 clique, que alimenta o Registro); qualquer resposta com sinal de remoção vira intake do Registro (SLA 24h) e bloqueio imediato.
2. **Legal (GDPR):** vazar dados do cliente ao restaurante ou a terceiros. Contenção: o Guardião nunca lê `booking_details`/PII; o e-mail ao restaurante traz só código, data, hora e nº de pessoas (não `people` corrompida — usa o do site quando disponível; senão omite).
3. **Cliente:** mensagem de degrau 4 sugere alternativa que também não responde, ou soa como cancelamento. Contenção: alternativas só entre casas com ≥50% de aceite em 90d (parceiros ou top respondedores), máximo 2, com "sujeita a confirmação"; a reserva original **não é cancelada** (Aria nunca cancela); aprovação humana unitária no início.
