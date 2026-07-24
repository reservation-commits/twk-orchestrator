# APPROVAL QUEUE — Fila de propostas aguardando decisão
**Atualizado:** 2026-06-09 · **Modo:** READ-ONLY · Nenhuma proposta executada.

## Pendentes — FASE 1 (Schema)
*(nenhuma — todas executadas)*

## Já executadas em 2026-06-09

| ID | Tipo | Alvo | Arquivo | Status |
|---|---|---|---|:---:|
| #001 | SCHEMA | `db_restaurants` + `restaurant_field_verifications` | [001_governance.sql](migrations/001_governance.sql) | ✅ aplicada |
| #002 | SCHEMA | `db_restaurants` (timezone, operational_status) | [002_timezone_and_status.sql](migrations/002_timezone_and_status.sql) | ✅ aplicada |
| #003 | SCHEMA | `restaurant_awards` + `award_types` (novas) | [003_awards.sql](migrations/003_awards.sql) | ✅ aplicada |
| #004 | SCHEMA | `db_restaurants` (15 campos premium) | [004_premium_fields.sql](migrations/004_premium_fields.sql) | ✅ aplicada |
| #005 | SCHEMA | `db_restaurants` (i18n about_pt/en/fr) | [005_i18n_about.sql](migrations/005_i18n_about.sql) | ✅ aplicada |
| #006 | SCHEMA | `db_restaurants` (constraints, ENUM, UNIQUE condicional) | [006_constraints_and_types.sql](migrations/006_constraints_and_types.sql) | ✅ aplicada (UNIQUE place_id pendente: pula até dedup Fase 5) |
| #007 | SCHEMA | `db_restaurants`, `countries`, `country_name_aliases` | [007_geo_standardization.sql](migrations/007_geo_standardization.sql) | ✅ aplicada (Parte A — schema; Parte B backfill na Fase 3) |
| #008 | SCHEMA + DROP | `db_restaurants` (drop 5 zumbi + `localization` → Google Maps URL) | [008_zombie_columns_and_localization.sql](migrations/008_zombie_columns_and_localization.sql) | ✅ aplicada (humano modificou: drop direto + manter `localization`) |

## Reprovadas / ajustadas
*(nenhuma ainda)*

---

## Como aprovar
- `APROVADO #001` — aprova uma proposta específica
- `APROVADO #001-#005` — aprova um intervalo
- `APROVADO LOTE_SEGURO` — atalho para #001, #002, #003, #004, #005, #007, #008a (todas BAIXO risco; deixa #006 e #008b separadas)
- `APROVADO TUDO_EXCETO_008b` — aprova todas menos a destrutiva
- `REPROVADO #N` — reprova específica
- `AJUSTAR #N <comentários>` — solicita refinamento

Após aprovação, **rodo um dry-run final** (`EXPLAIN` ou execução em transação com `ROLLBACK`) para confirmar que cada migration aplica sem erro antes de executar de verdade.

---

## Próximas fases (após Fase 1 concluída)
- **FASE 2** — Auditoria de completude por estabelecimento (relatório por linha).
- **FASE 3** — Enriquecimento via fontes reais (cada UPDATE com seu portão).
- **FASE 4** — Verificação cruzada e pontuação de confiança.
- **FASE 5** — Quarentena (incluindo dedup das 13 colisões + resolução do backup órfão).
- **FASE 6** — Expansão (novos estabelecimentos premium ausentes).
