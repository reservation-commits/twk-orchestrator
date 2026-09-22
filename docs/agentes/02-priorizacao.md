# 02 · Priorização — RICE, sequência, "não construa isto agora" e a aposta grande

> Sessão 2026-09-02 · trace `trc-agentes0902`. RICE = (Reach × Impact × Confidence) / Effort. Reach = unidades afetadas por mês (número da matriz, fonte declarada). Impact: 3 = muda a curva · 2 = alto · 1 = médio · 0,5 = baixo. Confidence: 0–1 (evidência de que funciona). Effort: pessoa-semanas para o MVP. Todos os números estão na tabela; quem discordar muda um número, não o resultado.

## 1. Tabela RICE (hipóteses da Seção 4.1 + candidatos próprios)

| # | Candidato | Tipo | Reach/mês (fonte) | Impact | Conf. | Effort (sem) | **RICE** | Decisão |
|---|---|---|---|---|---|---|---|---|
| A | Auditoria de horários genéricos (rodar `fill_hours_places.js` + proposta) | rodar existente (DBA) | 413 casas (banco) | 2 | 0,5 | 0,5 | **826** | **`/delegar` ao DBA já** — não é construção; sai desta lista |
| B | **Registro de Opt-out & Intake de Remoção** | extensão Aria+DBA | 110 casas/mês contactadas pela campanha (ledger: 108 na última semana) + pedidos | 2 | 0,8 | 1 | **176** | **Construir — nº 1** (pré-requisito do Guardião e do guardrail 8) |
| C | **Guardião da Reserva** | **agente novo** | 300 pedidos/mês (ago: 294) | 3 | 0,6 | 4 | **135** | **Construir — nº 2 · a aposta grande** |
| D | Pós-jantar (ligar `REVIEW/REMINDERS/BRIEFING` da Aria + cron n8n) | config | 34 aceitos/mês | 1 | 0,7 | 0,25 | 95 | `/delegar` ao Suporte após medir represado (905) e definir um dono por notificação |
| E | Relatório mensal de demanda ao dono ("Prova de Demanda") | extensão CLAVIS | 255 casas com movimento em 90d | 1 | 0,3 | 1,5 | 51 | **adiar** até Dossiê 05 (porta) existir — 0/148 ativações com o mesmo conteúdo |
| F | Concierge de Ativação (follow-up multicanal automático) | agente novo (hip. 1) | 148 casas contactadas | 1 | 0,2 | 3 | 10 | **rejeitado** |
| G | Avaliador de Agentes (hip. 8) | infra | 7 agentes | 2 | 0,7 | 2 | 5 (por agente) | **não é agente** — harness construído como infra em B/C |
| H | Voz/telefonia por IA para restaurantes | agente novo | 66 casas com pendência viva | 2 | 0,2 | 5 | 5 | rejeitado (sem evidência, risco de tom/legal em 5 jurisdições) |
| I | Customer Success do Parceiro (hip. 5) | agente novo | 6 parceiros com movimento em 90d | 2 | 0,5 | 2 | 3 | **rejeitado agora**; reabrir com ≥30 parceiros ativos |
| J | Conector de Sistemas de Reserva (hip. 3) | agente novo | 0 (booking_url vazio; 24 parceiros) | 3 | 0,1 | 8 | ≈0 | **rejeitado** — SEM DADO; roteamento por canal (e-mail/WhatsApp/telefone) foi **fundido** no Guardião |
| K | Qualidade de Dados como agente próprio (hip. 7) | agente novo | 413 + 26 | 2 | 0,5 | 3 | 138* | **rejeitado como agente**: o DBA existe e o script existe (linha A) — *o RICE alto é do trabalho, não do agente |
| L | Fidelização do Cliente Final como agente (hip. 6) | agente novo | 34/mês | 1 | 0,7 | 2 | 12 | **rejeitado/fundido** em D (flags da Aria) |
| M | Compliance & Reputação como agente autônomo (hip. 4) | agente novo | 1–5 pedidos/mês (SEM DADO) | 3 | 0,8 | 2 | 6 | **fundido** em B (registro + intake; monitor de menções fica para quando houver volume) |
| N | Detecção de fraude/no-show recorrente | agente novo | 13 no-shows na história (playbook CLAVIS) | 1 | 0,3 | 2 | ≈0 | rejeitado |
| O | Precificação/cobrança (billing) | agente novo | 0 assinaturas pagas conhecidas | 2 | 0,2 | 3 | ≈0 | rejeitado; Atlas cobre quando houver |
| P | Canal concierge de hotéis | agente novo | SEM DADO | — | — | — | — | Fila de Perguntas |
| Q | Tradução/localização por país | agente novo | — | — | — | — | — | não é agente: templates em PT/EN/FR/IT/ES já existem; jurisdição é campo do Registro (B) |

Hipóteses da Seção 4.1 rejeitadas com argumento: **1, 3, 5, 6, 7, 8** (seis); **4** fundida em B; **2** aprovada como C. Exigência de "pelo menos duas" atendida com folga — e a razão comum é uma só: onde faltava dado ou dono, criar agente escondia o problema.

## 2. Ordem de construção e dependências

```
[A] DBA roda auditoria de horários ──────────────┐ (paralelo, via /delegar, não é construção)
[B] Registro de Opt-out & Intake ──► bloqueio ──► [C] Guardião da Reserva ──► gera leads/fila ──► [E] Relatório de demanda (só após Dossiê 05)
        │                                              │
        └─► CLAVIS consulta antes de enviar            └─► Aria compõe degrau 4 (precisa FLUXO 6/7 em produção)
[D] Pós-jantar (config) — independente, após "um dono por notificação"
```

- **B antes de C:** o Guardião é fail-closed sem registro (não contata restaurante). Construir C sem B repetiria o Cañete em escala.
- **C antes de E:** demanda "N pedidos esperando" só é argumento quando alguém está cuidando dos pedidos. Hoje o número que mandamos ao dono é o número da nossa falha.
- **Dossiê 05 (produto) antes de E:** provado por 0/148.
- **Limite de simultaneidade: 2 iniciativas por ciclo de 30 dias.** Ciclo 1 (set/2026): B + C. Ciclo 2 (out): D + E (se 05 existir). Ciclo 3: reavaliar I com dados de parceiros.

## 3. Não construa isto agora

| Candidato | Motivo | Condição para reabrir |
|---|---|---|
| Concierge de Ativação (F) | O funil quebra na porta (Dossiê 05) e no último passo do formulário (WOO TENDER), não na falta de follow-up; 148 e-mails → 0 contas. Follow-up por telefone é humano com o kit existente. | Página "Para restaurantes" no ar + 30 dias de dados de clique do `/go` |
| Conector de Sistemas de Reserva (J) | 0 dados de software por casa; 24 parceiros; APIs de TheFork/Zenchef/OpenTable exigem parceria comercial. A resposta ao Cañete é honestidade na promessa (Dossiê 02/03) + roteamento por canal (no Guardião). | ≥50 parceiros **ou** um software identificado em ≥30% do Tier A (coleta barata: campo no formulário "é o dono?") |
| Customer Success do Parceiro (I) | 24 parceiros, 6 com movimento; churn sem definição; receita por parceiro não computável (Atlas sem `twk_partner_id`). | ≥30 parceiros ativos + `twk_partner_id` no Stripe |
| Voz por IA (H) | Ligações são o canal que funciona (kit), mas por humano: risco de tom, gravação e consentimento em FR/ES/IT/PT/TH sem base. | Nunca antes de 3 meses de fila humana medida |
| Avaliador de Agentes como agente (G) | É CI. Fica como harness (`orchestrator/evals/`) exigido para todo agente. | — |
| Monitor de menções à marca | Volume SEM DADO; 1 caso conhecido. | 3+ menções externas/mês |
| Fraude/no-show, billing, hotéis | Sem volume ou sem dado. | Volume medido |

## 4. A aposta grande: o Guardião da Reserva

Se funcionar, muda a curva porque ataca o único número que puxa todos os outros:

- **A promessa da TWK é "reserva que acontece".** Hoje 9% dos pedidos a não-parceiros viram mesa. Cada mesa entregue é (a) um cliente que volta (F2), (b) um restaurante que percebe demanda real sem precisarmos de e-mail de prospecção (06), (c) o argumento de venda do CLAVIS com número verdadeiro — parceiros aceitam 51%.
- **Ele converte silêncio em dado:** cria o primeiro registro de tempo de resposta e de canal vivo por casa. Esse dado é o que o Relatório de Demanda, o CS de parceiro e qualquer conector futuro precisam.
- **Custa quase nada em LLM** (núcleo determinístico) e reduz atenção humana (um lote/dia em vez de nudges à mão).
- **Risco declarado:** a curva pode não mexer se os restaurantes não responderem a e-mail nenhum (33 de 40 sem reação na campanha). Por isso o Guardião roteia para telefone/WhatsApp humano e tem critério de morte em 60 dias. Se morrer, a lição vale: o problema é a porta e o canal, e a resposta é produto e telefone, não agente.
