# GAP REPORT — FASE 0
**The World Keys · Curador de Banco de Dados Perfeito**
Gerado em 2026-06-09 · Modo: **READ-ONLY** · Zero escritas executadas.

---

## 0. Sumário executivo

O banco entrega **uma operação funcional, porém longe do "Banco Perfeito"**.
- **2.207 estabelecimentos cadastrados**, dos quais **2.022 publicados** (`published = true`).
- **Veracidade não auditável**: não existe qualquer coluna de proveniência (`last_verified_at`, `verification_source`, `confidence_level`). Impossível hoje saber se um horário foi confirmado ontem no site oficial ou herdado de uma planilha de 2020.
- **Operação de reserva incompleta** em ~25% dos publicados (coordenadas, e-mail, site, horários estruturados).
- **Curadoria de excelência subdimensionada**: 203 estrelas Michelin no banco (123×1★ + 49×2★ + 31×3★) num universo global de >3.500 — cobertura provavelmente <10%. 50 Best, Gault&Millau, Bib Gourmand não estão sequer modelados.
- **Higiene de dados comprometida**: 13 duplicatas por `place_id`, 9.971 registros no backup ausentes do principal sem trilha, países/cidades sem padronização ISO, taxonomia `establishment_type` em texto livre pipe-separated em vez das tabelas normalizadas existentes.

**Score de Completude médio (campos críticos, publicados): ≈ 70/100.**

---

## 1. Conexão e escopo

| Item | Valor |
|---|---|
| Conexão | OK (read-only) |
| Schemas de negócio | `public`, `nextauth` |
| Total de tabelas | 45 |
| Tabela principal | `public.db_restaurants` (2.207 linhas, 39 colunas) |
| Backup | `public.db_restaurants_backup` (12.176 linhas, **9.971 ausentes do principal**) |
| Reservas | `public.reservations` (15.066) · `public.reservations_backup` (12.765) |

---

## 2. Esquema atual da entidade central
Colunas existentes em `db_restaurants`: identidade (`restaurant_id`, `name`, `slug`, `place_id`), localização (`address_of_establishment`, `city`, `country`, `city_id`, `country_id`, `latitude`, `longitude`, `coordinates` PostGIS), contato (`telephone_of_the_establishment`, `email_for_reservations`, `site_url`), classificação (`establishment_type`, `restaurant_category`, `price_range_id`, `michelin_id`), conteúdo (`about_text`, `about_html`, `images_json`, `logo_url`, `business_hours_json`), comerciais (`partner`, `negotiation_status`, `engagement`, `interest_level`, `commission_per_person`, `partnership_start_date`), metadados (`created_date`, `published`, `url_page_twk`).

Tabelas relacionadas: `cities` (268), `countries` (55), `restaurant_categories` (149), `restaurant_michelin` (4 níveis), `restaurant_price_range` (4 níveis), `opening_hours` (17.595 linhas, 2.095 restaurantes distintos), `establishment_types` (33) + `establishment_type_map` (2.374), `restaurant_category_map` (7.241).

**Lacunas críticas no modelo (vs. canônico TWK)**:
1. **Sem governança de dados** — nenhuma coluna `last_verified_at`, `verification_source`, `confidence_level`, `enrichment_log`.
2. **Sem `timezone`** — horários estão em coluna `business_hours_json` sem fuso registrado; restaurante em Tóquio e em Paris guardam tempo sem âncora.
3. **Sem `status` operacional** — só existe `published` (bool). Não distingue "ativo", "fechado permanentemente", "temporariamente fechado". Os 9.971 registros sumidos do backup levantam a suspeita de exclusão usada como proxy de fechamento.
4. **Sem i18n nativo** — `about_text` em um idioma só; TWK é global.
5. **Sem campos de reserva premium** — sem `reservation_policy`, `avg_meal_duration`, `party_size_min/max`, `accepts_walkins`, `booking_url`, `dress_code`.
6. **Sem awards estruturados** — `michelin_id` é FK para uma tabela genérica de 4 buckets ("1 Star"/"2 Stars"/"3 Stars"/"Michelin Guide"); sem campo para Bib Gourmand, 50 Best rank, Gault&Millau toques.
7. **Sem identidade de chef** — `chef_name`, `chef_bio` ausentes (essencial para concierge VIP).
8. **Sem tags qualitativas** — `dietary_tags[]`, `ambience_tags[]`, `good_for[]`.
9. **Colunas zumbi** — 6 colunas com 0% de preenchimento: `identity_proof`, `localization`, `sales_representative`, `traded_currency`, `internal_notes`, `total_reservation`. Candidatas a remoção ou migração para tabelas dedicadas.
10. **Tipagem fraca** — `partner` armazenado como string `"true"`/`"false"` em vez de boolean.

---

## 3. Completude por coluna (`db_restaurants`, n=2.207)

| Coluna | % preenchido | Faltantes | Criticidade |
|---|---:|---:|:---:|
| `restaurant_id`, `name`, `partner`, `published` | 100,00% | 0 | — |
| `slug` | 99,95% | 1 | ALTA |
| `city_id`, `country_id`, `city`, `country` | 99,86–99,91% | 2–9 | ALTA |
| `address_of_establishment` | 99,73% | 6 | ALTA |
| `images_json`, `about_html`, `about_text` | 99,91% | 2 | MÉDIA |
| `establishment_type` | 99,46% | 12 | MÉDIA |
| `place_id` | 99,05% | 21 | ALTA |
| `price_range_id` | 96,47% | 78 | MÉDIA |
| `telephone_of_the_establishment` | 95,83% | 92 | ALTA |
| `logo_url` | 95,20% | 106 | MÉDIA |
| `business_hours_json` | 82,65% | 383 | **CRÍTICA** |
| `site_url` | 76,67% | 515 | ALTA |
| `email_for_reservations` | 72,54% | 606 | **CRÍTICA** |
| `latitude`/`longitude` | 67,97% | 707 | **CRÍTICA** |
| `coordinates` (PostGIS) | 63,25% | 811 | ALTA |
| `negotiation_status` | 29,95% | 1.546 | comercial |
| `michelin_id` | 19,48% | 1.777 | curadoria |
| `engagement` | 1,09% | 2.183 | descartar |
| `interest_level`, `commission_per_person`, `partnership_start_date` | 0,05% | 2.206 | comercial |
| `identity_proof`, `localization`, `sales_representative`, `traded_currency`, `internal_notes`, `total_reservation` | **0%** | 2.207 | **REMOVER** |

### Recorte só publicados (n=2.022) — o que o cliente final realmente vê

| Campo | Faltando entre os PUBLICADOS | % falha |
|---|---:|---:|
| Coordenadas (lat/lng) | **636** | 31,5% |
| Email de reserva | **533** | 26,4% |
| Site oficial | **465** | 23,0% |
| Horários estruturados (`business_hours_json`) | **346** | 17,1% |
| Telefone | 68 | 3,4% |
| `place_id` Google | 0 | 0% ✅ |

Mas há `opening_hours` (tabela normalizada) cobrindo 2.095 restaurantes distintos com 17.595 janelas — **existe sobreposição inconsistente** entre `business_hours_json` (free-text) e a tabela `opening_hours`. Não há contrato de qual é a fonte da verdade.

---

## 4. Duplicidades e inconsistências detectadas

### 4.1 Duplicatas por `google_place_id` — 13 grupos confirmados
Mesma casa cadastrada 2× com nomes ligeiramente diferentes. Exemplos:
- `VICTORIA` (id 95341) e `VICTORIA PARIS` (id 292661) — Paris, mesmo `ChIJ6-EpTOxv5kcRB_7hi3YYXTs`.
- `LA TABLE DE CLARENCE` (19070) e `LA TABLE DU CLARANCE` (19061) — Lille.
- `OCTAVE` aparece 2× em Bangkok (também acionou duplicata `name+city`).
- `MAXIMO`/`MÁXIMO` em Mexico City — provável colisão por normalização de acentos.
- `KING'S JOY`/`King's Joy` em Beijing — case-sensitivity quebra de unicidade.
- 7 outros casos similares.

### 4.2 Backup órfão
`db_restaurants_backup` tem 12.176 linhas, das quais **9.971 não estão no principal**. Sem registro do motivo (fechado? excluído administrativamente? migração?). Risco: estabelecimentos legítimos foram perdidos.

### 4.3 Padronização geográfica
- **Typo país**: `"Morrocco"` (20 registros) ao invés de `"Morocco"`.
- **Sem ISO 3166**: usa `"USA"`, `"UAE"`, `"England"` (deveria ser United Kingdom), `"Holland"` (deveria ser Netherlands).
- **Cidades inconsistentes**: `"Mexico city"`, `"São paulo"`, `"Saint tropez"`, `"Rio de janeiro"` em vez de Title Case.
- `country` e `country_id` coexistem sem trigger de sincronia.

### 4.4 Taxonomia híbrida
- `establishment_type` em texto livre com separador pipe (`"Bar|Restaurant|Steakhouse"`) num campo single-value, embora exista `establishment_types` (33 itens) + `establishment_type_map` (2.374 mapeamentos). A coluna texto é a usada; a normalização está parcial.
- Mesmo padrão em `restaurant_category` vs. `restaurant_categories` (149) + `restaurant_category_map` (7.241).

### 4.5 Curadoria de excelência
- Universo Michelin atual no banco: 1★=123, 2★=49, 3★=31, "Michelin Guide" (sem rating)=227. Total ~430 ligados, num universo global Michelin >3.500.
- Sem campos para: Bib Gourmand, 50 Best (rank), Gault&Millau (toques), Asia 50 Best, Latin America 50 Best.

### 4.6 Formatos
- `telephone_of_the_establishment`: não validado contra E.164 (a coluna `varchar` não tem CHECK constraint).
- `email_for_reservations`: sem validação de formato.
- `site_url`: sem garantia de prefixo `https://`.
- `partner` (varchar) = `"true"`/`"false"`: deveria ser `boolean`.
- `negotiation_status`: 5 valores enum-like em texto livre (Pending, Partner, Negotiation, Decline, Interested) — candidato a `ENUM`.

---

## 5. `data_completeness_score` — método proposto

Pontuação por estabelecimento (0–100), ponderada por criticidade no fluxo TWK:

| Campo | Peso |
|---|---:|
| name, address, city, country, place_id | 5 cada (25) |
| latitude+longitude (par) | 10 |
| timezone | 5 |
| telephone (E.164) | 8 |
| business hours estruturados em fuso local | 12 |
| site_url **ou** booking_url **ou** email_for_reservations | 10 |
| price_tier | 5 |
| cuisines[] | 5 |
| about (PT+EN) | 5 |
| hero_image + galeria ≥3 fotos | 8 |
| chef_name | 3 |
| reservation_policy | 2 |
| awards (Michelin/50Best/Gault&Millau) | 2 |
| **Governança**: last_verified_at < 180 dias E confidence ≥ MÉDIA | 10 |
| **Total** | **100** |

Score médio atual estimado (com base nos %s acima e campos hoje inexistentes): **≈ 38–45/100** para o banco como um todo. Mesmo entre os publicados, o teto fica em ~70 porque governança (10pts), timezone (5pts) e awards estruturados (2pts) são estruturalmente impossíveis hoje.

---

## 6. Comparação com o propósito da The World Keys

| Promessa do produto | O banco entrega hoje? |
|---|---|
| Descoberta dos **melhores restaurantes premium** do planeta | **Parcialmente.** Cobertura desbalanceada para França (41,5% do banco), curadoria Michelin <10% do universo, sem 50 Best/Gault&Millau modelados. |
| Reserva concierge **com horário e contato corretos** | **Parcialmente.** 17% dos publicados sem horários estruturados, 26% sem email, 23% sem site, 31% sem coordenadas — concierge cego em ~1 de cada 4 casos. |
| **Dados verificados e atuais** | **Não.** Não há trilha de verificação. Impossível distinguir dado fresco de dado herdado. |
| **Experiência global multilíngue** | **Não.** `about_text` mono-idioma; sem PT/EN/FR separados. |
| **Identidade de chef e proposta gastronômica** | **Não.** `chef_name`/`chef_bio`/`tasting_menu` ausentes. |
| **Padronização internacional** | **Não.** ISO 3166 ignorado, cidades em case inconsistente, taxonomia em texto livre. |

---

## 7. Top 3 lacunas de maior impacto

### #1 — Governança de dados inexistente (veracidade não auditável)
Sem `last_verified_at`, `verification_source`, `confidence_level`, `enrichment_log`. Não há como cumprir a Regra de Ouro ("verdade ou nada") porque o banco hoje **não distingue verdade de herança**. Esta lacuna **bloqueia toda a Fase 4 (Verificação)** e impede pontuar qualquer enriquecimento futuro.

### #2 — Campos operacionais de reserva incompletos em ~1/4 a 1/3 dos publicados
- 31,5% (636) publicados **sem coordenadas** → mapa quebrado, busca por proximidade falha.
- 26,4% (533) publicados **sem email de reserva** → quebra do canal concierge.
- 23,0% (465) publicados **sem site oficial** → impossível verificar horário/menu.
- 17,1% (346) publicados **sem horários estruturados** + ausência de `timezone` em **100% dos registros** → toda janela horária está sem âncora de fuso.

Esta é a lacuna que o cliente final sente.

### #3 — Higiene estrutural: duplicatas, backup órfão, taxonomias híbridas e ausência de awards de elite
- 13 duplicatas confirmadas por `place_id` (sub-contagem real maior, pois normalização de acento/case esconde mais casos).
- 9.971 registros em `db_restaurants_backup` ausentes do principal sem trilha de motivo — risco de perda silenciosa de curadoria.
- Países sem ISO 3166 + typo `"Morrocco"` + cidades em minúsculo.
- `establishment_type`/`restaurant_category` em texto livre pipe-separated apesar das tabelas normalizadas já existentes.
- Universo Michelin coberto provavelmente <10%; 50 Best e Gault&Millau sem campo.

---

## 8. O que NÃO foi feito (propositalmente)
- Nenhum `INSERT`, `UPDATE`, `DELETE`, `ALTER`, `DROP` executado.
- Nenhum dado de estabelecimento foi enriquecido sem aprovação.
- Nenhuma exclusão proposta nesta fase (vai à Fase 5 — Quarentena).
- Nenhuma credencial exposta neste relatório.

---

## 9. Próximos passos sugeridos (aguardando aprovação)
**FASE 1 — Proposta de esquema.** Vou propor (sem executar):
- Migration de governança: `last_verified_at`, `verification_source`, `confidence_level`, `enrichment_log` em `db_restaurants`.
- Coluna `timezone` (IANA) + backfill via lat/lng + Google Places.
- Coluna `operational_status` (`active`/`closed_permanently`/`temporarily_closed`) + reconciliação com `db_restaurants_backup`.
- Tabela `restaurant_awards` (Michelin, Bib, 50 Best, Gault&Millau) substituindo `michelin_id` single-tier.
- Campos premium: `chef_name`, `chef_bio`, `reservation_policy`, `avg_meal_duration`, `party_size_min/max`, `booking_url`, `dress_code`, `dietary_tags[]`, `ambience_tags[]`.
- I18n: split de `about_text` em `about_pt`, `about_en` (mínimo) + estrutura para mais idiomas.
- Constraints: CHECK E.164 em telefone, regex em email, `partner` → boolean, `negotiation_status` → ENUM, UNIQUE em `place_id` (após dedup).
- Plano de remoção das 6 colunas zumbi.

Cada proposta virá com `.sql` em arquivo, justificativa de impacto no produto, e portão de aprovação no formato da Seção 9 do briefing.
