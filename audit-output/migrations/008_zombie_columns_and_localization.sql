-- =====================================================================
-- MIGRATION 008 — Remoção de colunas zumbi + repropósito de localization
-- Status: APROVADO pelo humano (em 2026-06-09) — execução pendente
-- Risco: ALTO em DROP COLUMN (irreversível); MÉDIO em localization (repurpose)
-- Decisão do humano:
--   - DROPAR 5 colunas 0% preenchidas (sem fase _deprecated):
--       identity_proof, sales_representative, traded_currency,
--       internal_notes, total_reservation
--   - MANTER 'localization' e transformá-la em URL do Google Maps do restaurante.
-- =====================================================================

BEGIN;

-- -------------------------------------------------------------------
-- 1. DROP definitivo das 5 colunas zumbi
--    Pré-checagem dentro da própria transação: se houver QUALQUER valor
--    não nulo numa dessas colunas, abortamos para análise humana.
-- -------------------------------------------------------------------
DO $$
DECLARE
  n_filled int;
  col_name text;
  cols text[] := ARRAY['identity_proof','sales_representative','traded_currency','internal_notes','total_reservation'];
BEGIN
  FOREACH col_name IN ARRAY cols LOOP
    EXECUTE format(
      'SELECT COUNT(*)::int FROM public.db_restaurants WHERE %I IS NOT NULL', col_name
    ) INTO n_filled;
    IF n_filled > 0 THEN
      RAISE EXCEPTION
        'Coluna % tem % valores não-nulos — não é mais zumbi. Abortando para análise humana.',
        col_name, n_filled;
    END IF;
  END LOOP;
END$$;

ALTER TABLE public.db_restaurants
  DROP COLUMN IF EXISTS identity_proof,
  DROP COLUMN IF EXISTS sales_representative,
  DROP COLUMN IF EXISTS traded_currency,
  DROP COLUMN IF EXISTS internal_notes,
  DROP COLUMN IF EXISTS total_reservation;

-- -------------------------------------------------------------------
-- 2. Repropósito de 'localization' como URL do Google Maps
--    (mantemos o nome 'localization' por escolha do humano — em PT
--    significa "localização", o que casa com o uso)
-- -------------------------------------------------------------------

-- Garantir que está vazia hoje (esperado: 100% NULL)
DO $$
DECLARE
  n_filled int;
BEGIN
  SELECT COUNT(*)::int INTO n_filled
    FROM public.db_restaurants
   WHERE localization IS NOT NULL AND length(btrim(localization)) > 0;
  IF n_filled > 0 THEN
    RAISE EXCEPTION
      'localization tem % valores preenchidos — confirmar conteúdo antes de repurpose.', n_filled;
  END IF;
END$$;

-- Garantir tipo text (já é varchar; alteração é compatível, mas seja explícito)
ALTER TABLE public.db_restaurants
  ALTER COLUMN localization TYPE text USING localization::text;

-- CHECK: quando preenchida, tem que ser URL de google maps reconhecida
ALTER TABLE public.db_restaurants
  DROP CONSTRAINT IF EXISTS db_restaurants_localization_gmaps_chk;
ALTER TABLE public.db_restaurants
  ADD  CONSTRAINT db_restaurants_localization_gmaps_chk
       CHECK (
         localization IS NULL
         OR localization = ''
         OR localization ~* '^https?://((www|maps)\.)?google\.[a-z.]{2,}/'
         OR localization ~* '^https?://goo\.gl/maps/'
         OR localization ~* '^https?://maps\.app\.goo\.gl/'
       );

COMMENT ON COLUMN public.db_restaurants.localization IS
  'URL do Google Maps do estabelecimento. Aceita formatos: '
  'https://www.google.com/maps/place/..., https://maps.app.goo.gl/..., https://goo.gl/maps/... '
  'Independe de latitude/longitude — é o link compartilhável.';

COMMIT;

-- =====================================================================
-- DOWN parcial (DROP de coluna é irreversível sem restore do backup;
-- o que dá pra reverter é o CHECK e a mudança de tipo):
-- =====================================================================
-- BEGIN;
--   ALTER TABLE public.db_restaurants
--     DROP CONSTRAINT IF EXISTS db_restaurants_localization_gmaps_chk;
--   COMMENT ON COLUMN public.db_restaurants.localization IS NULL;
-- COMMIT;
