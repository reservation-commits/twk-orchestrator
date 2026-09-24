-- =====================================================================
-- MIGRATION 007 — Padronização geográfica (ISO 3166 + Title Case)
-- Status: PROPOSTA — NÃO EXECUTAR sem aprovação humana
-- Risco: MÉDIO (atualiza valores texto em massa).
-- IMPORTANTE: a parte de SCHEMA (colunas + tabela de mapeamento) é segura.
--             A parte de BACKFILL fica em outro bloco para aprovação SEPARADA.
-- Lacuna alvo: typo "Morrocco", países sem ISO, cidades em case inconsistente.
-- =====================================================================

-- ----------------------------------------------------------------------
-- PARTE A — SCHEMA (segura, sem mexer em dados existentes)
-- ----------------------------------------------------------------------
BEGIN;

-- 1. country_code ISO 3166-1 alpha-2 em db_restaurants e em countries
ALTER TABLE public.db_restaurants
  ADD COLUMN IF NOT EXISTS country_code char(2);

ALTER TABLE public.db_restaurants
  DROP CONSTRAINT IF EXISTS db_restaurants_country_code_chk;
ALTER TABLE public.db_restaurants
  ADD  CONSTRAINT db_restaurants_country_code_chk
       CHECK (country_code IS NULL OR country_code ~ '^[A-Z]{2}$');

ALTER TABLE public.countries
  ADD COLUMN IF NOT EXISTS iso_alpha_2 char(2);

ALTER TABLE public.countries
  DROP CONSTRAINT IF EXISTS countries_iso_alpha_2_chk;
ALTER TABLE public.countries
  ADD  CONSTRAINT countries_iso_alpha_2_chk
       CHECK (iso_alpha_2 IS NULL OR iso_alpha_2 ~ '^[A-Z]{2}$');

-- 2. Tabela de mapeamento "nome livre" -> ISO + nome canônico
CREATE TABLE IF NOT EXISTS public.country_name_aliases (
  alias        text PRIMARY KEY,            -- texto exatamente como armazenado hoje
  canonical    text NOT NULL,               -- nome canônico oficial
  iso_alpha_2  char(2) NOT NULL CHECK (iso_alpha_2 ~ '^[A-Z]{2}$'),
  notes        text
);

INSERT INTO public.country_name_aliases(alias, canonical, iso_alpha_2, notes) VALUES
  ('France',        'France',         'FR', NULL),
  ('USA',           'United States',  'US', 'Padronizar para nome oficial'),
  ('Italy',         'Italy',          'IT', NULL),
  ('Brazil',        'Brazil',         'BR', NULL),
  ('Germany',       'Germany',        'DE', NULL),
  ('Portugal',      'Portugal',       'PT', NULL),
  ('Thailand',      'Thailand',       'TH', NULL),
  ('Spain',         'Spain',          'ES', NULL),
  ('Australia',     'Australia',      'AU', NULL),
  ('England',       'United Kingdom', 'GB', 'England != UK; padronizar como UK'),
  ('Malaysia',      'Malaysia',       'MY', NULL),
  ('Japan',         'Japan',          'JP', NULL),
  ('Mexico',        'Mexico',         'MX', NULL),
  ('China',         'China',          'CN', NULL),
  ('South Korea',   'South Korea',    'KR', NULL),
  ('UAE',           'United Arab Emirates', 'AE', NULL),
  ('Greece',        'Greece',         'GR', NULL),
  ('Colombia',      'Colombia',       'CO', NULL),
  ('Argentina',     'Argentina',      'AR', NULL),
  ('Austria',       'Austria',        'AT', NULL),
  ('Turkey',        'Türkiye',        'TR', 'Nome oficial atual: Türkiye'),
  ('Morrocco',      'Morocco',        'MA', 'TYPO corrigido: Morrocco -> Morocco'),
  ('Israel',        'Israel',         'IL', NULL),
  ('Canada',        'Canada',         'CA', NULL),
  ('Holland',       'Netherlands',    'NL', 'Holland != Netherlands; padronizar')
ON CONFLICT (alias) DO NOTHING;

CREATE INDEX IF NOT EXISTS db_restaurants_country_code_idx
  ON public.db_restaurants (country_code);

COMMIT;

-- ----------------------------------------------------------------------
-- PARTE B — BACKFILL DOS DADOS (REQUER APROVAÇÃO SEPARADA — bloco UPDATE)
-- ----------------------------------------------------------------------
-- NÃO INCLUÍDO neste arquivo. Será emitido como proposta de ENRICHMENT
-- na fila de aprovação, com dry-run mostrando o COUNT por alias antes.
--
-- Exemplo do que o backfill faria (apenas para revisão visual):
--   UPDATE public.db_restaurants r
--      SET country = a.canonical, country_code = a.iso_alpha_2
--     FROM public.country_name_aliases a
--    WHERE r.country = a.alias AND a.alias <> a.canonical;
--
--   UPDATE public.db_restaurants
--      SET city = initcap(city)
--    WHERE city ~ '^[A-Z][a-z]+ [a-z]'  -- "Mexico city", "São paulo"
--       OR city ~ '^[a-z]';
-- ----------------------------------------------------------------------

-- =====================================================================
-- DOWN (Parte A apenas):
-- =====================================================================
-- BEGIN;
--   DROP TABLE IF EXISTS public.country_name_aliases;
--   ALTER TABLE public.countries
--     DROP CONSTRAINT IF EXISTS countries_iso_alpha_2_chk,
--     DROP COLUMN IF EXISTS iso_alpha_2;
--   ALTER TABLE public.db_restaurants
--     DROP CONSTRAINT IF EXISTS db_restaurants_country_code_chk,
--     DROP COLUMN IF EXISTS country_code;
--   DROP INDEX IF EXISTS public.db_restaurants_country_code_idx;
-- COMMIT;
