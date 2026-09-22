# Aria — análise de desempenho e soluções (2026-09-22)

> Orquestrador · Fonte: as 22 tabelas `aria_*` do `twk_auth` via `twk_ro` (somente leitura, sem PII impressa), `/health` do serviço, código-fonte. Rotulagem: **fato** × **suposição** × **lacuna**.

## Resumo em cinco linhas

1. **A Aria ficou muda de 18/09 13:20 a 22/09 ~14:00** — a conta da Anthropic estava **sem crédito**. Nove conversas sem resposta, seis e-mails na fila, uma mensagem de WhatsApp perdida. A saúde dizia "100% ok" porque o modelo nunca era medido. Crédito recarregado em 22/09; alerta e medição construídos na v4.
2. **Volume é pequeno e é quase todo e-mail**: 611 mensagens em 4 meses, 84 conversas — **10 no WhatsApp**, 74 por e-mail (desde julho). O canal principal da Aria, na prática, é a caixa `support@`/`reservation@`.
3. **Quando responde, responde bem e rápido**: mediana de 15 s, p90 de 2 min; depois do ADR-015 (11/09), **zero** promessas de prazo e **um** desencontro de idioma em 12 respostas (antes: 14 e 9 em 176).
4. **Quatro ferramentas estavam quebradas em produção** por uma coluna com nome errado e um `id` sem default — o link de reserva e o registro de atendimento falhavam em **100%** das chamadas. Corrigido na v4.
5. **Custo por turno triplicou** (24 mil → 53 mil tokens no WhatsApp) por resultados de ferramenta guardados inteiros no histórico; 93% vem do cache, mas a tendência é errada. Compactação na v4.

## 1. O incidente: quatro dias em silêncio

| | |
|---|---|
| Último turno do modelo | 17/09 13:10 UTC |
| Primeiro teste diário reprovado | 18/09 13:20 — `400 "Your credit balance is too low to access the Anthropic API"` |
| Conversas novas no período | 9 (3 bloqueadas como spam; **6 legítimas: 0 respondidas**) |
| Na fila de e-mail | 6, o mais antigo de 18/09 08:53 — entre eles um restaurante (Cipriani HK) e um cliente (gmail) |
| WhatsApp | 1 mensagem em 19/09, 23 caracteres, **perdida** — o canal não tinha fila de replay |
| O que a saúde dizia | 8.646 checagens "ok" em 30 dias · `anthropic_ok = NULL` em todas |
| O que saiu nesse período | **3 convites de avaliação por template** (não usam o modelo) — convidamos o cliente a responder a quem não responderia |

**[fato]** O teste diário `anthropic:api_reachable` falhou 14 vezes desde 23/08 (intermitente antes, contínuo desde 18/09). O evento `test_run` só vira alerta se `ALERTS_ENABLED=true` **e** o canal de e-mail estiver ligado; **[lacuna]** não sei se está — nada chegou a ninguém.

**Soluções (v4, construídas):**
- `monitor.ts` mede o modelo a cada 5 min (1 token no Haiku — custo desprezível; sem crédito, falha de graça) e grava `anthropic_ok`; `overall_ok` passa a depender dele; escalação **URGENTE** com dedup de 1 h.
- `claude.ts` classifica o erro definitivo (crédito · chave · modelo) e abre escalação URGENTE com a ação ("recarregar em console.anthropic.com").
- **Fila de replay do WhatsApp** (`aria_pending_whatsapp`): turno que falha no modelo grava a mensagem e reprocessa a cada 10 min pelo mesmo caminho da conversa. O e-mail já tinha isso; o WhatsApp não.
- **Sentinela de Silêncio** ganhou `aria_modelo_acessivel` (último teste reprovado = crítico) e `aria_cliente_sem_resposta` (cliente legítimo esperando > 2 h = crítico). Já rodou: pegou os dois.

**Solução que depende de você:** manter saldo com margem, e — se quiser um segundo aviso independente do nosso sistema — ativar o alerta de saldo baixo no próprio console da Anthropic.

## 2. Volume e canais

| Mês | Entradas | Saídas | Conversas | (e-mail) |
|---|---:|---:|---:|---:|
| mai | 50 | 43 | 3 | 0 |
| jun | 55 | 52 | 2 | 0 |
| jul | 98 | 53 | 32 | 29 |
| ago | 116 | 18 | 35 | 33 |
| set | 104 | 22 | 40 | 37 |

**[fato]** Maio e junho são os testes do fundador (3 e 2 conversas). O WhatsApp tem **10 conversas em quatro meses**. A queda de saídas em ago/set tem duas causas: o filtro de escopo barrando spam (correto) e o silêncio de setembro.

**[fato]** Conversas sem nenhuma resposta: 45 de 84 — mas 80 chats estão em `aria_scope_blocks` e 48 desses também em `aria_messages` (bloqueio é registrado como entrada). Descontando spam e handoffs, **sem explicação: 0 em julho, 3 em agosto, 5 em setembro** (um de WhatsApp por mês). Os de setembro são o incidente.

**[fato]** Idiomas de entrada: **en 219 · pt 115 · fr 32 · it 14 · es 3**. Inglês domina — coerente com a base de telefones (US/GB/SG).

**Solução:** nada a corrigir no volume — é demanda. O que muda o volume é o que está a montante (notificações de reserva por WhatsApp ligadas, porta do restaurante, canário). A Aria responde ao que chega.

## 3. Qualidade das respostas

| Métrica | Antes de 11/09 (176 respostas) | Depois (12) |
|---|---:|---:|
| Promessa de prazo ("em 24h", "shortly") | 14 | **0** |
| Vocabulário interno ("escalei", "registrei") | 6 | 1 |
| Promessa de disponibilidade | 1 | 1 (o próprio incidente de 11/09, 13:02) |
| Idioma diferente do cliente (heurística) | 9 de 99 pares (9%) | 1 de 10 |

**[fato]** A porta única de saída (ADR-015) funcionou. **[lacuna]** 12 respostas é amostra pequena; o juiz de conversa proposto em 21/09 (P6) é o que dá estatística.

**[fato]** Tamanho médio de resposta 646 caracteres; 12 acima de 1.500 — no WhatsApp isso vira três telas. **Solução:** limite por canal no system prompt (WhatsApp ≤ 900 chars salvo pedido explícito) — mudança de prompt, sem deploy de código além do texto.

## 4. Ferramentas — o que estava quebrado

| Ferramenta | Chamadas | Sucesso | Causa | v4 |
|---|---:|---:|---|---|
| `get_restaurant_booking_link` | 10 | **0%** | coluna `address` não existe (é `address_of_establishment`) | ✅ |
| `log_attendance_event` | 10 | **0%** | `update_events.id` sem default → INSERT falha | ✅ id gerado |
| `compute_route_to_restaurant` | 7 | 29% | mesma coluna | ✅ |
| `get_restaurant_location` | 18 | 56% | mesma coluna (havia fallback sem endereço) | ✅ |
| `find_reservation_by_code` | 14 | 79% | 3 erros históricos da mesma coluna | ✅ |
| `create_reservation` | 4 | 0% | ferramenta removida em 21/09 (a Aria não cria reservas) | — |

**[fato]** O system prompt manda "registrar com log_attendance_event" — e o registro era perdido em silêncio em 100% dos casos. Nenhum teste cobria as consultas contra o schema real. **Solução adicional (proposta):** um teste de contrato que roda `SELECT` de cada consulta do `db.ts` contra o banco (via `twk_ro`) no CI — 30 minutos de trabalho, mata essa classe inteira.

## 5. Custo e contexto

| Mês | Turnos Opus | Entrada média/turno (incl. cache) | Cache lido |
|---|---:|---:|---:|
| jul | 49 | 24 mil | 86% |
| ago | 20 | 28 mil | 91% |
| set | 22 | **73 mil** | 93% |

Por canal: **WhatsApp 53 mil tokens/turno, e-mail 31 mil**. Máximo: 165 mil. **[suposição]** A causa é o histórico guardar os `tool_result` inteiros (uma busca devolve 20 restaurantes com horários); no WhatsApp a conversa é longa e o histórico acumula. **Solução (v4):** `compactToolResults` — cada resultado de ferramenta fica com no máximo 3.000 caracteres no histórico depois do turno em que foi usado. Haiku (triagem de escopo) roda ~55 vezes/mês, custo desprezível.

**[fato]** 40 relatórios DMARC da Microsoft (`[Preview] Report Domain: …`) escaparam da camada gratuita para o classificador pago por causa do prefixo entre colchetes. **Solução (v4):** regra estrutural com prefixo opcional; cobre também `Report-ID:`. **Solução que depende de você:** apontar o endereço `rua=` do DMARC do domínio para uma caixa que não seja a de atendimento — os relatórios nem chegariam.

## 6. Escalações, handoffs, latência

- **Escalações:** 11 no total, todas resolvidas — em **102 h a 790 h**. `PENDENTE_12H` (5) levou em média 102 h. **[fato]** É o tempo humano, não da Aria. Desde o ADR-016 o MAESTRO deveria absorver isso; nenhuma escalação nova desde 11/09.
- **Handoffs:** 4 números sob controle humano **até 24/02/2027** ("Marlon Andrade"). A Aria nunca responderá a esses 4 até lá. **[lacuna]** Não sei se é intencional (números da equipe) ou esquecido. **Solução:** listar e confirmar; handoff sem `until` curto vira silêncio permanente.
- **Latência do banco:** `SELECT 1` com p50 de **942 ms**. **[suposição]** App (Easypanel) e banco (Cloud SQL, multirregião US) em regiões diferentes; cada turno faz 3–5 consultas → segundos de espera antes do modelo. **Solução:** mover o serviço para a mesma região do banco, ou o inverso. Não é código.
- **Sugestões do analista:** 70 geradas, 37 aprovadas, 33 descartadas. **[lacuna]** "Aprovada" não significa executada — não há rastro de execução. As 5 abertas mais recentes são sobre latência de ferramentas e a falha intermitente da API.
- **Avaliações coletadas:** 0 (o fluxo só começou a convidar em 21/09). **Opt-outs:** 0. **Respostas prontas:** 0. **Embeddings:** desligados.

## 7. O que a v4 muda (construída, testada, empacotada)

`aria_agent_whatsapp-2026-09-22-v4.zip` · build `2026-09-22-v4-modelo-na-saude-alerta-de-credito-ferramentas-corrigidas`

| Mudança | Arquivo |
|---|---|
| Modelo na saúde (5 min) + escalação URGENTE | `monitor.ts` |
| Erro definitivo do modelo classificado e escalado | `claude.ts` |
| Fila de replay do WhatsApp (tabela + reprocessamento 10 min) | `migrations.ts`, `db.ts`, `index.ts` |
| Coluna `address_of_establishment` nas 3 consultas | `db.ts` |
| `id` gerado em `update_events` | `db.ts` |
| DMARC com prefixo `[…]` e `Report-ID:` na camada gratuita | `scopeGuard.ts` |
| `compactToolResults` (3.000 chars por resultado no histórico) | `historyTrim.ts`, `claude.ts` |
| Rótulo de versão | `buildInfo.ts` |

Testes: 161 (5 novos: DMARC ×3, compactação ×2). `tsc` limpo.

## 8. Soluções que dependem de você, em ordem

1. **Subir a v4.** É o que impede a repetição do incidente e conserta as ferramentas.
2. **Alerta de saldo no console da Anthropic** (independente do nosso).
3. **Confirmar os 4 handoffs até 2027** — intencional ou esquecido?
4. **`ALERTS_ENABLED=true` + `ALERT_EMAIL_TO`** no Easypanel da Aria, se ainda não estiver: sem isso, escalação URGENTE fica só no painel.
5. **DMARC `rua=`** para uma caixa própria.
6. **Região do serviço** igual à do banco (latência de ~1 s por consulta).
7. Prompt: limite de tamanho por canal.

## 8b. Observação de 22/09 ~15:00 UTC — a fila de e-mail não drenou sozinha

**[fato]** Crédito recarregado ~14:00; às 14:21 o modelo já respondia (classificou como spam o próprio recibo da Anthropic). Mas, passadas duas rodadas de replay (10 min cada), os **6 e-mails continuavam pendentes** e nenhum turno do Opus foi registrado. **[suposição]** O ciclo de replay do container atual não está rodando (ou os chats estão marcados como ocupados). O deploy da v4 reinicia o serviço e dispara o replay no boot — se depois disso a fila continuar em 6, abrir os **Logs** do serviço no Easypanel e procurar por `[email] reenfileirando` e `[queue] erro no processor`.

## 9. O que eu não sei

Se `ALERTS_ENABLED` está ligado em produção; a região do host do Easypanel; se os 4 handoffs são intencionais; quantas das 37 sugestões "aprovadas" foram executadas; e o desempenho conversacional real além de 12 respostas — só o juiz de conversa responde.
