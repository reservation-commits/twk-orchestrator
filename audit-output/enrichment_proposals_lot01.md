# FASE 3 — Lote #01: Coordenadas + URL Google Maps
**Gerado em 2026-06-09 · NADA foi gravado no banco ainda.**

## Resumo
| Métrica | Valor |
|---|---:|
| Restaurantes consultados | 636 publicados, sem lat/lng, com `place_id` |
| Buscas na Google Places API com sucesso | **636 / 636** ✅ |
| Erros de API | 0 |
| Confiança **ALTA** (place_id confere + restaurante operando) | **628** |
| Confiança **CONFLITO** (Google diz que está fechado) | **8** |
| Tempo gasto | 5 minutos 9 segundos |
| Custo Google Places (Place Details Basic) | ~636 × US$ 0,017 ≈ **US$ 10,80** |

## Como o agente decidiu o nível de confiança
- **ALTA**: o `place_id` que o Google devolveu é exatamente o que está no seu banco, **e** o restaurante está marcado como `OPERATIONAL` (ou sem marcação, que o Google trata como funcionando).
- **CONFLITO**: o restaurante está marcado como `CLOSED_PERMANENTLY` ou `CLOSED_TEMPORARILY`. A coordenada provavelmente está certa, mas o restaurante não está mais funcionando — você precisa decidir o que fazer com cada um.

## Arquivos gerados
- [`phase3-lot01-coordinates-proposals.csv`](phase3-lot01-coordinates-proposals.csv) — 636 propostas, uma por linha
- [`phase3-lot01-coordinates-errors.csv`](phase3-lot01-coordinates-errors.csv) — vazio (zero erros)
- [`phase3-lot01-summary.json`](phase3-lot01-summary.json) — agregado

---

## PARTE A — 628 propostas de confiança ALTA (recomendado aprovar em bloco)

**Amostra dos 10 primeiros** (para você inspecionar):

| ID | Nome | Cidade | Lat proposta | Lng proposta | Endereço retornado pelo Google |
|---|---|---|---:|---:|---|
| 100102 | AVANZARE | Springfield | 37.1549 | -93.2709 | 3240 S Fremont Ave, Springfield, MO 65804, USA |
| 103871 | AL SAHAR | Cancún | 21.1616 | -86.8282 | Gladiolas Rtno. 7 22, 77500 Cancún, Q.R., Mexico |
| 107349 | ALVIN'S JAZZ CLUB | Calgary | 50.8962 | -113.9346 | 176 Mahogany Centre SE, Calgary, AB T3M 2X8, Canada |
| 108371 | PRIMAVISTA | Cincinnati | 39.1061 | -84.5564 | 810 Matson Pl, Cincinnati, OH 45204, USA |
| (… 624 outros …) | | | | | |

CSV completo em [`phase3-lot01-coordinates-proposals.csv`](phase3-lot01-coordinates-proposals.csv) — filtrando `confidence_level=HIGH`.

**O que vai mudar no banco se aprovado:**
- 628 restaurantes recebem `latitude` e `longitude` reais.
- Cada um recebe o carimbo de governança:
  - `last_verified_at` = agora
  - `verification_source` = `google_places:<seu place_id>`
  - `confidence_level` = `HIGH`
  - Entrada em `enrichment_log` (histórico)
  - Entrada em `restaurant_field_verifications` (trilha por campo)

```
┌─ PROPOSTA #LOT01-A | ENRICHMENT
│ Alvo:        628 restaurantes publicados sem coordenadas
│ Ação:        UPDATE db_restaurants SET latitude=?, longitude=?,
│              last_verified_at=NOW(), verification_source='google_places:...',
│              confidence_level='HIGH', enrichment_log = enrichment_log || jsonb_build_array(...)
│ Valor novo:  lat/lng do Google Places (sample acima)
│ Valor atual: NULL em 628 / 628
│ Fonte(s):    Google Places Details API (place_id que já estava no seu banco)
│ Verificado:  2026-06-09T17:16Z | Confiança: ALTA
│ Impacto:     Mapa + busca por proximidade funcionam em mais 628 restaurantes
│              publicados (sobe de 68,5% pra 100% dos publicados com coordenadas).
│ SQL:         Será gerado em scripts/phase3-apply-lot01.mjs (transação por linha)
└─ Aguardando: APROVADO / REPROVADO / AJUSTAR
```

---

## PARTE B — 8 propostas com CONFLITO (Google diz que estão fechados)

Estes 8 restaurantes estão marcados como **publicados** no seu banco, mas o Google está dizendo que **fecharam**. Esta é uma descoberta crítica que a auditoria não tinha como pegar sozinha.

| ID | Nome | Cidade | País | Status no Google | Endereço (Google) |
|---|---|---|---|---|---|
| 12120 | Paradise Kafé | Guadeloupe | West Indies | **temporariamente fechado** | Deshaies 97126, Guadeloupe |
| 22348 | LE TRANSTION | Nantes | France | **permanentemente fechado** | 11 bis Rue de la Bastille, 44000 Nantes |
| 23254 | M ON THE BUND | Shanghai | China | **permanentemente fechado** | Waitan, Shang Hai Shi, 200002 |
| 37534 | BUENA BRASA | Kuala Lumpur | Malaysia | **permanentemente fechado** | Bangsar South, KL, Malaysia |
| 40358 | TERO | Brussels | Belgium | **permanentemente fechado** | Saint-Gilles, 1060, Belgium |
| 43932 | CALAVERAS | Cairns | Australia | **permanentemente fechado** | Parramatta Park QLD 4870 |
| 44002 | TASTY ROAD | Cairns | Australia | **permanentemente fechado** | Cairns City QLD 4870 |
| 58442 | LORRAINE | Athens | Greece | **temporariamente fechado** | Athina 106 75, Greece |

### Recomendação para os 8

**Opção 1 (recomendada):** atualizar coordenadas **e** marcar `operational_status` corretamente. Eles continuam no banco mas saem da vitrine de reservas.
- 6 permanentemente fechados → `operational_status = 'closed_permanently'` + opcional `published = false`
- 2 temporariamente fechados → `operational_status = 'temporarily_closed'`
- Confiança continua **CONFLITO** no log (você sabe que veio com bandeira amarela).

**Opção 2:** só atualizar coordenadas, deixar `operational_status` como `active` para revisão manual depois.

**Opção 3:** não fazer nada com esses 8; vão pra fila da Quarentena (Fase 5).

```
┌─ PROPOSTA #LOT01-B | ENRICHMENT + STATUS
│ Alvo:        8 restaurantes publicados que o Google reporta como fechados
│ Ação:        Atualizar coordenadas + ajustar operational_status conforme retorno
│ Valor novo:  lat/lng + status (closed_permanently | temporarily_closed)
│ Valor atual: lat/lng = NULL, operational_status = 'active'
│ Fonte(s):    Google Places Details API
│ Verificado:  2026-06-09T17:16Z | Confiança: CONFLITO
│ Impacto:     Restaurantes fechados deixam de aparecer no fluxo de reserva.
│              Não são excluídos — ficam no banco com status real.
│ SQL:         Mesmo script, bloco separado, transação separada.
└─ Aguardando: APROVADO_OPCAO_1 / APROVADO_OPCAO_2 / APROVADO_OPCAO_3 / AJUSTAR
```

---

## PARTE C — Bônus: URL Google Maps para os 636 (campo `localization`)

A mesma chamada de API já trouxe a URL canônica do Google Maps (`url`) para os 636 restaurantes. Posso aproveitar e preencher o campo `localization` (que vocês acabaram de repropositar) no mesmo lote, sem custo extra.

**Exemplos:**
- AVANZARE → `https://maps.google.com/?cid=17746157382465860117`
- AL SAHAR → `https://maps.google.com/?cid=5990667312893399729`

```
┌─ PROPOSTA #LOT01-C | ENRICHMENT  (combina com LOT01-A e/ou LOT01-B)
│ Alvo:        Os mesmos 636 restaurantes do lote
│ Ação:        UPDATE db_restaurants SET localization = <url google maps>
│ Valor novo:  URL canônica do Google Maps (cumpre o CHECK que criamos)
│ Valor atual: NULL em todos
│ Fonte(s):    Mesma chamada já paga
│ Confiança:   ALTA para 628, MÉDIA para 8 (acompanha LOT01-B)
│ Impacto:     localization passa a ter conteúdo útil em 636 registros.
└─ Aguardando: APROVADO / REPROVADO / APROVADO_SO_HIGH
```

---

## Como vai funcionar se você aprovar

1. Eu escrevo o `phase3-apply-lot01.mjs` que faz, **uma transação por restaurante** (seguro contra falha parcial):
   - `UPDATE` lat/lng (e opcionalmente `localization`, `operational_status`)
   - Atualiza `last_verified_at`, `verification_source`, `confidence_level`
   - Concatena entrada em `enrichment_log`
   - `INSERT` em `restaurant_field_verifications` (uma linha por campo verificado)
2. Faço um **dry-run em transação com ROLLBACK** numa amostra de 5 antes do batch real.
3. Executo o lote completo só após "EXECUTAR" final.
4. Reporto contagem de sucesso/falha por registro.

---

## Atalhos de aprovação

- **`APROVAR LOT01_COMPLETO`** → aplica A + B (opção 1) + C. Cobre todos os 636. *(recomendado)*
- **`APROVAR LOT01_SO_HIGH`** → aplica só A + C. Os 8 conflitos ficam pra você revisar manualmente.
- **`APROVAR LOT01_CONSERVADOR`** → aplica só A (coordenadas das 628 HIGH). Sem `localization`. Sem status nos fechados.
- **`AJUSTAR LOT01 <comentários>`** → qualquer mudança específica.
- **`REVISAR LOT01`** → eu paro e te entrego os CSVs para você revisar antes de decidir.
