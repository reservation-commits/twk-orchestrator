-- =====================================================================
-- MIGRATION 005 — i18n para descrições (about_pt / about_en / about_fr)
-- Status: PROPOSTA — NÃO EXECUTAR sem aprovação humana
-- Risco: BAIXO (ADD COLUMN; mantém about_text/about_html para compatibilidade)
-- Estratégia: about_text vira legado read-only; nova UI grava nas variantes.
--             Backfill controlado depois (Fase 3 — enriquecimento).
-- Lacuna alvo: TWK é global, mas descrição está num idioma só.
-- =====================================================================

BEGIN;

ALTER TABLE public.db_restaurants
  ADD COLUMN IF NOT EXISTS about_pt        text,
  ADD COLUMN IF NOT EXISTS about_en        text,
  ADD COLUMN IF NOT EXISTS about_fr        text,
  ADD COLUMN IF NOT EXISTS about_primary_locale char(2);

-- CHECK: locale primário em códigos ISO 639-1 que suportamos hoje
ALTER TABLE public.db_restaurants
  DROP CONSTRAINT IF EXISTS db_restaurants_about_primary_locale_chk;
ALTER TABLE public.db_restaurants
  ADD  CONSTRAINT db_restaurants_about_primary_locale_chk
       CHECK (about_primary_locale IS NULL
              OR about_primary_locale IN ('pt','en','fr','es','it','de','ja','zh','ko','ar'));

COMMENT ON COLUMN public.db_restaurants.about_pt IS 'Descrição em português (BR). Fonte da verdade futura.';
COMMENT ON COLUMN public.db_restaurants.about_en IS 'Descrição em inglês. Fonte da verdade futura.';
COMMENT ON COLUMN public.db_restaurants.about_fr IS 'Descrição em francês. Fonte da verdade futura.';
COMMENT ON COLUMN public.db_restaurants.about_primary_locale IS
  'Idioma originalmente fornecido pelo restaurante (referência para tradução).';
COMMENT ON COLUMN public.db_restaurants.about_text IS
  'LEGADO — mantida apenas por compatibilidade. Não escrever aqui após migração.';

COMMIT;

-- =====================================================================
-- DOWN:
-- =====================================================================
-- BEGIN;
--   ALTER TABLE public.db_restaurants
--     DROP CONSTRAINT IF EXISTS db_restaurants_about_primary_locale_chk,
--     DROP COLUMN IF EXISTS about_primary_locale,
--     DROP COLUMN IF EXISTS about_fr,
--     DROP COLUMN IF EXISTS about_en,
--     DROP COLUMN IF EXISTS about_pt;
-- COMMIT;
