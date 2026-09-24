# SCHEMA PROPOSALS — FASE 1
**The World Keys · Curador de Banco de Dados Perfeito**
Gerado em 2026-06-09 · Status: **PROPOSTAS** — nada foi executado.
Cada proposta tem seu próprio portão de aprovação. Aprovação de uma **não implica** aprovação de outra.

---

## Sumário das 8 propostas

| # | Migration | Risco | Impacto no produto | Status |
|---|---|:---:|---|:---:|
| 001 | Governança de dados (`last_verified_at`, `verification_source`, `confidence_level`, `enrichment_log` + tabela `restaurant_field_verifications`) | BAIXO | Habilita a Regra de Ouro: distinguir verdade auditada de dado herdado | ⏳ |
| 002 | `timezone` (IANA) + `operational_status` + `operational_status_reason` | BAIXO | Reservas com fuso correto + separa "publicado" de "operando" | ⏳ |
| 003 | `restaurant_awards` + `award_types` + view de últimos awards | BAIXO | Cobre Michelin (estrelas/Bib/Green), 50 Best (mundo/Ásia/LatAm/MENA/Bars), Gault&Millau toques | ⏳ |
| 004 | Campos premium (chef, reservation_policy, party_size, walkins, booking_url, dress_code, tags, tasting menu) | BAIXO | Concierge ganha contexto real de fine dining | ⏳ |
| 005 | `about_pt`/`about_en`/`about_fr` + `about_primary_locale` | BAIXO | TWK opera em múltiplos idiomas — descrição idem | ⏳ |
| 006 | Tipagem forte e CHECKs (`partner→bool`, ENUM negotiation_status, regex phone/email/url, coords range, UNIQUE place_id condicional) | MÉDIO | Higiene de dados e integridade futura | ⏳ |
| 007 | Padronização geográfica (Parte A: schema + tabela de aliases) | MÉDIO | ISO 3166 + corrige typo `Morrocco` (Parte B = update, vai pra Fase 3) | ⏳ |
| 008 | Colunas zumbi: 8a `RENAME → _deprecated_*` (reversível) + 8b `DROP COLUMN` em ≥30 dias | ALTO | Remove 6 colunas 0% preenchidas; requer aprovação dupla para 8b | ⏳ |

Arquivos `.sql` correspondentes: [`audit-output/migrations/`](migrations/).

Todas as migrations:
- estão envolvidas em `BEGIN`/`COMMIT` (atômicas);
- são **idempotentes** (`IF NOT EXISTS` / `DROP IF EXISTS` antes de `ADD`);
- têm bloco `DOWN` documentado para reversão completa;
- não fazem `UPDATE` de dados de estabelecimento — isso vai para Fase 3 (Enriquecimento) com seu próprio portão.

---

## PROPOSTA #001 — Governança de dados (Top Gap #1)

```
┌─ PROPOSTA #001 | SCHEMA
│ Alvo:        public.db_restaurants (+ nova tabela restaurant_field_verifications)
│ Ação:        Adicionar last_verified_at, verification_source, confidence_level,
│              enrichment_log + tabela granular de verificações por campo.
│ Valor novo:  4 colunas + 1 tabela + 4 índices + 2 CHECKs
│ Valor atual: nada equivalente existe
│ Fonte(s):    Briefing seção 4 (modelo canônico — bloco "Metadados de qualidade")
│ Verificado:  N/A (mudança de esquema, não de dado)
│ Impacto:     Habilita a Regra de Ouro ("verdade ou nada") de forma mensurável.
│              Sem isto, nenhuma fase posterior tem como cumprir o padrão TWK.
│              É o pré-requisito de TUDO. Bloqueia: Fase 3, Fase 4, scoring.
│ SQL:         audit-output/migrations/001_governance.sql
└─ Aguardando: APROVADO / REPROVADO / AJUSTAR
```

---

## PROPOSTA #002 — `timezone` + `operational_status` (Top Gap #2)

```
┌─ PROPOSTA #002 | SCHEMA
│ Alvo:        public.db_restaurants
│ Ação:        Adicionar timezone (IANA), operational_status (active/closed_permanently/
│              temporarily_closed/unknown), operational_status_reason. + 2 índices.
│ Valor novo:  3 colunas, 2 CHECKs, 2 índices, default 'active' em status
│ Valor atual: 100% dos registros sem fuso; sem campo de status real
│ Fonte(s):    Briefing seção 4 (Identidade & localização, Operação & reserva)
│ Impacto:     - Horários (business_hours_json + opening_hours) ganham âncora correta;
│              - Reconciliação do backup órfão (9.971 registros) deixa de exigir
│                exclusão como proxy de "fechado".
│              - Concierge pode mostrar "Fechado permanentemente em out/2024" em vez
│                de simplesmente sumir do catálogo.
│ SQL:         audit-output/migrations/002_timezone_and_status.sql
└─ Aguardando: APROVADO / REPROVADO / AJUSTAR
```

---

## PROPOSTA #003 — `restaurant_awards`

```
┌─ PROPOSTA #003 | SCHEMA
│ Alvo:        public (nova tabela restaurant_awards + lookup award_types + view)
│ Ação:        Modelar Michelin (estrelas/Bib/Green/Listed), 50 Best (mundo+regionais+bars),
│              Gault&Millau (toques). Histórico por ano. Source URL obrigatória.
│ Valor novo:  2 tabelas + 1 view + 3 índices + 10 award_types pré-cadastrados
│ Valor atual: michelin_id aponta para 4 buckets compartilhados ("1 Star","2 Stars",
│              "3 Stars","Michelin Guide"); 50 Best e Gault&Millau não modelados.
│ Fonte(s):    guiamichelin.com, theworlds50best.com, gaultmillau.com (URLs em source_url)
│ Impacto:     Curadoria de elite real. Permite consultas como:
│                "Restaurantes 2★ Michelin em Paris atualizados nos últimos 12 meses".
│              restaurant_michelin é mantida (legado read-only) — migração de
│              dados será proposta separadamente.
│ SQL:         audit-output/migrations/003_awards.sql
└─ Aguardando: APROVADO / REPROVADO / AJUSTAR
```

---

## PROPOSTA #004 — Campos premium

```
┌─ PROPOSTA #004 | SCHEMA
│ Alvo:        public.db_restaurants
│ Ação:        15 novas colunas + 5 CHECKs + 3 índices GIN para tags.
│              Inclui: chef_name, chef_bio, reservation_policy, avg_meal_duration_minutes,
│              party_size_min/max, accepts_walkins, booking_url, dress_code (enum),
│              dietary_tags[], ambience_tags[], good_for[], tasting_menu_available/price/currency.
│ Valor novo:  15 colunas, defaults seguros (arrays vazios em vez de NULL)
│ Valor atual: 0 dessas colunas existe
│ Fonte(s):    Briefing seção 4 + propósito TWK (concierge fine dining)
│ Impacto:     Concierge passa a saber: quem é o chef, se aceita walk-in, se há menu
│              degustação obrigatório, qual o dress code, se serve vegano.
│              Indexação GIN nas tags habilita filtros como "rooftop + romantic + good_for=anniversary".
│ SQL:         audit-output/migrations/004_premium_fields.sql
└─ Aguardando: APROVADO / REPROVADO / AJUSTAR
```

---

## PROPOSTA #005 — i18n para descrições

```
┌─ PROPOSTA #005 | SCHEMA
│ Alvo:        public.db_restaurants
│ Ação:        Adicionar about_pt, about_en, about_fr + about_primary_locale (ISO 639-1).
│              about_text vira LEGADO (mantida para retrocompatibilidade).
│ Valor novo:  4 colunas + 1 CHECK
│ Valor atual: about_text mono-idioma (~100% preenchido mas sem indicação de idioma)
│ Impacto:     TWK é global. Permite servir o conteúdo no idioma do usuário sem
│              tradução em runtime. Backfill virá na Fase 3 (com proveniência).
│ SQL:         audit-output/migrations/005_i18n_about.sql
└─ Aguardando: APROVADO / REPROVADO / AJUSTAR
```

---

## PROPOSTA #006 — Constraints e tipagem forte

```
┌─ PROPOSTA #006 | SCHEMA  (risco: MÉDIO)
│ Alvo:        public.db_restaurants
│ Ação:
│   - partner varchar('true'/'false') -> boolean (com DO block que aborta se houver
│     valor inesperado, deixando a transação inteira intacta).
│   - negotiation_status varchar -> ENUM negotiation_status_enum (5 valores observados).
│   - CHECK NOT VALID em phone (E.164ish), email (regex), site_url (https?://) —
│     NOT VALID = só aplica a novos/updates; backfill virá na Fase 3.
│   - CHECK NOT VALID em (latitude, longitude) BETWEEN -90..90 / -180..180 + não-zero.
│   - UNIQUE INDEX em place_id CONDICIONAL: o DO block detecta as 13 duplicatas
│     atuais e PULA a criação do índice (mensagem NOTICE) se ainda existirem.
│     Será criado automaticamente quando a Fase 5 (dedup) tiver concluído.
│ Valor novo:  ENUM + 5 CHECKs + (índice UNIQUE condicional)
│ Valor atual: Tipagem fraca; nenhuma garantia de formato; 13 dups em place_id
│ Impacto:     Quebra silenciosa de qualidade impossível daqui pra frente; futuras
│              integrações com Google Places/Stripe param de aceitar dados inválidos
│              já na borda do banco.
│ Notas:       Transação é atômica — se qualquer passo falhar, ROLLBACK total.
│ SQL:         audit-output/migrations/006_constraints_and_types.sql
└─ Aguardando: APROVADO / REPROVADO / AJUSTAR
```

---

## PROPOSTA #007 — Padronização geográfica (somente Parte A: schema)

```
┌─ PROPOSTA #007 | SCHEMA (Parte A apenas — Parte B = enrichment separado)
│ Alvo:        public.db_restaurants, public.countries (+ nova tabela country_name_aliases)
│ Ação:
│   - ADD COLUMN country_code char(2) com CHECK regex em db_restaurants.
│   - ADD COLUMN iso_alpha_2 char(2) em countries.
│   - CREATE TABLE country_name_aliases com 25 mapeamentos (todos os países top no banco
│     hoje, incluindo correção "Morrocco" -> "Morocco", "USA" -> "United States",
│     "England" -> "United Kingdom", "Holland" -> "Netherlands", "Turkey" -> "Türkiye").
│   - Índice em country_code.
│ Valor novo:  2 colunas + 1 tabela com 25 aliases + 1 CHECK + 1 índice
│ Valor atual: country é texto livre, sem ISO, com typo
│ Fonte(s):    ISO 3166-1 alpha-2 (norma internacional)
│ Impacto:     Permite filtros confiáveis por país, integração com APIs externas
│              (telefone E.164, currency por país, time zone fallback).
│ IMPORTANTE:  A Parte B (UPDATE em massa para preencher country_code e corrigir
│              "Morrocco" -> "Morocco") fica em proposta de ENRICHMENT separada,
│              com dry-run de COUNT por alias antes da execução.
│ SQL:         audit-output/migrations/007_geo_standardization.sql
└─ Aguardando: APROVADO / REPROVADO / AJUSTAR
```

---

## PROPOSTA #008a — Colunas zumbi: rename para `_deprecated_*`

```
┌─ PROPOSTA #008a | SCHEMA (reversível em 1 comando)
│ Alvo:        public.db_restaurants
│ Ação:        RENAME COLUMN das 6 colunas com 0% de preenchimento em 2.207 registros:
│                identity_proof, localization, sales_representative, traded_currency,
│                internal_notes, total_reservation
│              → _deprecated_<nome>
│ Valor novo:  Coluna marcada como obsoleta, com COMMENT explicando substituto.
│ Valor atual: Colunas existem, com 0% de uso há tempo desconhecido.
│ Impacto:     - Erro rápido em qualquer código de aplicação que ainda referencie
│                essas colunas (em vez de leitura silenciosa de NULL).
│              - Período de quarentena de 30 dias antes do DROP definitivo (8b).
│ Risco:       BAIXO. Reversão = RENAME de volta. Bloco DOWN incluído.
│ SQL:         audit-output/migrations/008_drop_zombie_columns.sql (FASE 8a)
└─ Aguardando: APROVADO / REPROVADO / AJUSTAR
```

```
┌─ PROPOSTA #008b | DESTRUTIVA — APROVAÇÃO DUPLA OBRIGATÓRIA
│ Alvo:        public.db_restaurants
│ Ação:        DROP COLUMN das 6 colunas _deprecated_*
│ Pré-req:     (a) Proposta #008a aprovada e em vigor há ≥ 30 dias
│              (b) Grep no código de aplicação confirmando zero referência
│              (c) Backup full pg_dump validado no dia do DROP
│              (d) Aprovação humana ESCRITA explícita (proposta + confirmação)
│ Impacto:     Schema mais limpo; remove ambiguidade permanente.
│ Risco:       ALTO. Irreversível sem restore do backup.
│ SQL:         audit-output/migrations/008_drop_zombie_columns.sql (FASE 8b)
└─ Aguardando: NÃO PROPOR para execução antes de 2026-07-09
```

---

## Ordem de execução recomendada (se tudo for aprovado)

1. **001** — Governança (pré-requisito de tudo que cita proveniência)
2. **002** — timezone + operational_status
3. **005** — i18n about (independente, baixo risco)
4. **004** — Campos premium (independente, baixo risco)
5. **003** — restaurant_awards (independente, baixo risco)
6. **007a** — Schema geo (Parte A)
7. **006** — Constraints e tipagem (depende de não haver dups; vai aplicar UNIQUE só quando puder)
8. **008a** — Rename colunas zumbi (qualquer momento)
9. *(Fase 3 — Enriquecimento)* — Backfill: timezone via lat/lng, country_code via aliases, etc.
10. *(Fase 5 — Quarentena)* — Dedup das 13 colisões de place_id; resolução do backup órfão.
11. **006** — Re-rodar para criar UNIQUE INDEX em place_id (idempotente).
12. **008b** — DROP COLUMN das deprecated (≥30 dias após 8a, com aprovação dupla).

---

## O que NÃO está nesta fase
- Nenhum `UPDATE`/`INSERT`/`DELETE` em dados de estabelecimento (vai para Fase 3 com proveniência).
- Nenhuma exclusão de registro (vai para Fase 5 com aprovação dupla).
- Nenhuma execução de SQL — só geração de arquivos.

Responda **APROVADO #001**, **APROVADO #001-#005**, **APROVADO TODOS** (exceto 008b), **REPROVADO #N**, ou **AJUSTAR #N <comentários>**. Posso aplicar individualmente ou em lote.
