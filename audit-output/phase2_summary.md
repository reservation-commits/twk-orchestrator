# FASE 2 — Auditoria de completude por estabelecimento
**Gerado em 2026-06-09 · Modo READ-ONLY · Nada alterado no banco.**

## Score de completude — modelo de pontuação (sum = 100)

| Bloco | Campos | Pontos |
|---|---|---:|
| **CRÍTICO — reserva** | name (5), address (4), city (4), country (4), place_id (4) | 21 |
| | latitude+longitude | 10 |
| | timezone | 4 |
| | telefone | 8 |
| | canal de reserva (site OU booking OU email) | 10 |
| | horários (json OU tabela opening_hours) | 12 |
| **IMPORTANTE — descoberta** | price_range | 5 |
| | culinárias (mapeadas) | 5 |
| | descrição (PT/EN/FR/legado) | 5 |
| | galeria premium (cover + ≥3 fotos gallery + logo) | 8 |
| **ENRIQUECIMENTO — polimento** | chef | 2 |
| | política de reserva | 2 |
| | prêmios (Michelin/50 Best/Gault) | 2 |
| | governança (verificado <180d + confiança ≥MÉDIA) | 6 |
| **TOTAL** | | **100** |

---

## Resultado agregado

| Métrica | Valor |
|---|---:|
| Total auditado | **2.207 restaurantes** |
| Publicados (`published=true`) | 2.022 |
| Score médio (todos) | **77,2 / 100** |
| Score médio (publicados) | **77,8 / 100** |

### Distribuição entre os 2.207

| Faixa | Quantidade | % |
|---|---:|---:|
| 0–20 | 0 | 0% |
| 20–40 | 2 | 0,1% |
| 40–60 | 45 | 2,0% |
| 60–80 | **1.317** | **59,7%** |
| 80–100 | **843** | **38,2%** |

A massa do banco está saudável (acima de 60). Mas o teto é estruturalmente limitado a ~94 hoje porque os campos novos (timezone, chef, reservation_policy, governance) ainda estão vazios em 100% dos registros — vão começar a ser preenchidos na Fase 3.

---

## Os "100% vazios" são esperados — campos recém-criados

| Campo | Publicados sem | Por quê |
|---|---:|---|
| `timezone` | 2.022 (100%) | Coluna criada hoje. Será preenchida via lat/lng + Google Places. |
| `chef_name` | 2.022 (100%) | Coluna criada hoje. Fonte: site oficial + Michelin Guide. |
| `reservation_policy` | 2.022 (100%) | Coluna criada hoje. Fonte: site oficial. |
| Governança (`last_verified_at` etc) | 2.022 (100%) | Coluna criada hoje. Será carimbada à medida que cada campo for verificado. |
| `awards` (tabela nova) | 1.619 (80,1%) | Tabela criada hoje (`restaurant_awards`). Os 403 que já têm vêm do legado `michelin_id`. |

Esses **não são problemas** — são a fronteira de trabalho da Fase 3.

---

## Os 5 buracos REAIS herdados (precisam de enriquecimento)

| Campo | Publicados sem | % | Onde resolver |
|---|---:|---:|---|
| **Coordenadas** (lat/lng) | 636 | 31,5% | Google Places API (usando `place_id` que já existe em 100%) |
| **Galeria premium** (cover + 3 fotos + logo) | 608 | 30,1% | Curadoria — fotos profissionais do site oficial |
| **Canal de reserva** (site/email/booking) | 124 | 6,1% | Site oficial + Google Places (phone fallback) |
| **Telefone** | 68 | 3,4% | Google Places API |
| **Faixa de preço** | 56 | 2,8% | Google Places API (`price_level`) + Michelin |

A primeira lacuna (coordenadas) é a mais alta prioridade pelo impacto: **mapas e busca por proximidade não funcionam em 1 de cada 3 restaurantes publicados**. Como todos têm `place_id` Google, a recuperação é praticamente automática via API.

---

## Os piores 47 restaurantes (score < 60) — fila de atenção imediata

Identificados no arquivo [`phase2-action-plan.csv`](phase2-action-plan.csv) — exemplos:

| ID | Nome | Cidade | País | Score | Faltam (crítico) |
|---|---|---|---|---:|---|
| 293787 | Vendome | Paris | France | 53 | timezone, phone, contact_channel |
| 294134 | Lutetia | Paris | France | 53 | timezone, phone, contact_channel |
| 22350 | DUC NGHIA | Nantes | France | 56 | coords, timezone, contact_channel |
| 21184 | AJIRO | Kyoto | Japan | 56 | coords, timezone, contact_channel |
| 17624 | Shisha Terrace | Doha | Qatar | 56 | coords, timezone, contact_channel |
| 25308 | M | London | England | 56 | coords, timezone, contact_channel |
| 30409 | 7•16 | Bogota | Colombia | 56 | coords, timezone, contact_channel |
| 32197 | Central Central | Mexico city | Mexico | 56 | coords, timezone, contact_channel |
| 19615 | King's Joy | Beijing | China | 58 | coords, timezone, contact_channel |
| 12104 | CASA | Saint Barths | West Indies | 58 | coords, timezone, phone |

(Lista completa nos CSVs — ranking ordenado por nº de campos críticos faltantes, depois por menor score.)

---

## Sinalizações geográficas adicionais detectadas

A auditoria também flagou **inconsistências não corrigíveis sem decisão humana**:

- **`Israël`** (com trema) co-existe com **`Israel`** (sem) — variantes do mesmo país.
- **`West Indies`** aparece como país (14 registros) — não é um país ISO; provavelmente Saint Barths/Saint Martin/Antilhas.
- **`Quebec`** aparece como país (12 registros) — Quebec é província; o país é Canadá.
- A `country_name_aliases` (criada na Fase 1) cobre 25 países; estas 3 anomalias **não estão no mapa** e precisam de decisão de curadoria antes do backfill da Fase 3.

---

## Ranking por país (publicados, ≥5 registros)

### Piores 10
| País | Score médio | n |
|---|---:|---:|
| Qatar | 70,0 | 14 |
| Russia | 72,0 | 15 |
| Sweden | 72,0 | 15 |
| Colombia | 72,2 | 24 |
| Australia | 72,5 | 46 |
| Israel | 72,7 | 18 |
| England | 72,8 | 49 |
| China | 73,3 | 25 |
| West Indies | 73,7 | 14 |
| Mexico | 73,8 | 31 |

### Melhores 10
| País | Score médio | n |
|---|---:|---:|
| Holland | 83,5 | 17 |
| Turkey | 82,2 | 17 |
| Monaco | 82,0 | 9 |
| Argentina | 81,3 | 23 |
| Greece | 81,2 | 23 |
| Thailand | 80,7 | 52 |
| Morrocco | 80,5 | 19 |
| Quebec | 80,1 | 12 |
| South Africa | 79,9 | 15 |
| France | 79,5 | 809 |

(Holland/Morrocco/Quebec ainda aparecem com nome legado; serão corrigidos no backfill geográfico.)

---

## Entregáveis desta fase
- [`phase2-per-establishment.csv`](phase2-per-establishment.csv) — auditoria linha a linha (2.207 registros).
- [`phase2-action-plan.csv`](phase2-action-plan.csv) — só publicados, ordenados por impacto (pior primeiro).
- [`phase2-stats.json`](phase2-stats.json) — estatísticas agregadas em JSON.

---

## O que esta fase NÃO fez (propositalmente)
- Nenhum dado de estabelecimento alterado.
- Nenhuma chamada externa a APIs (Google/Michelin/etc) — isso só na Fase 3, com seu portão de aprovação.
- Nenhum restaurante incluído nem excluído.

---

## Próximo passo: FASE 3 — Enriquecimento via fontes reais

Na Fase 3 começo, finalmente, a **propor preenchimento dos dados**. Cada lote vai:
1. Buscar valores nas fontes hierárquicas (site oficial > Google Places > guias).
2. Apresentar como bloco aprovável: valor atual, valor proposto, fonte, data, confiança.
3. Só executar `UPDATE` após sua aprovação.

Sugiro **começar pela lacuna de maior impacto/menor risco**: **636 restaurantes publicados sem coordenadas**, todos com `place_id` Google preenchido. Posso buscar `lat`/`lng` em lote via Google Places API (a chave já está no `.env.local`) e devolver como proposta única (com sample para você revisar antes do batch completo).

Responda:
- **`SEGUIR FASE 3 COORDENADAS`** — para eu começar pelo lote de coordenadas.
- **`SEGUIR FASE 3 OUTRA LACUNA <nome>`** — se preferir outra ordem (ex: telefone, timezone, awards).
- **`PAUSAR`** — para revisar os CSVs antes.
