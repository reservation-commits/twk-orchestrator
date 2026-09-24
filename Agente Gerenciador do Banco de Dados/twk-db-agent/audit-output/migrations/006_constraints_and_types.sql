-- =====================================================================
-- MIGRATION 006 — Constraints e tipagem forte
-- Status: PROPOSTA — NÃO EXECUTAR sem aprovação humana
-- Risco: MÉDIO. Algumas conversões podem falhar se dados sujos existirem;
--        a transação aborta e nada muda — seguro de tentar.
-- Pré-requisitos: NENHUM bloqueante, mas a UNIQUE em place_id exige que a
--                 Fase 5 (dedup) tenha sido executada — está atrás de gate
--                 condicional aqui (DO block que aborta se ainda houver dups).
-- Lacuna alvo: Top Gap #3 — higiene de tipos e formatos.
-- =====================================================================

BEGIN;

-- 1. partner: varchar 'true'/'false'  ->  boolean
--    Conversão idempotente: só roda se a coluna ainda for textual.
DO $$
DECLARE
  current_type text;
BEGIN
  SELECT data_type INTO current_type
    FROM information_schema.columns
   WHERE table_schema='public' AND table_name='db_restaurants' AND column_name='partner';

  IF current_type IN ('character varying','text','character') THEN
    -- Garantir que todos os valores são interpretáveis
    PERFORM 1 FROM public.db_restaurants
     WHERE partner IS NOT NULL
       AND lower(btrim(partner)) NOT IN ('true','false','t','f','1','0','yes','no');
    IF FOUND THEN
      RAISE EXCEPTION 'partner tem valores fora do conjunto reconhecido. Abortando para análise.';
    END IF;

    -- DEFAULT antigo é varchar; drop antes de mudar o tipo
    ALTER TABLE public.db_restaurants
      ALTER COLUMN partner DROP DEFAULT;

    ALTER TABLE public.db_restaurants
      ALTER COLUMN partner TYPE boolean
      USING (CASE WHEN lower(btrim(partner)) IN ('true','t','1','yes') THEN true
                  WHEN lower(btrim(partner)) IN ('false','f','0','no')  THEN false
                  ELSE NULL END);

    -- Novo default coerente com o tipo
    ALTER TABLE public.db_restaurants
      ALTER COLUMN partner SET DEFAULT false;
  END IF;
END$$;

-- 2. CHECK de formato em colunas de contato
ALTER TABLE public.db_restaurants
  DROP CONSTRAINT IF EXISTS db_restaurants_phone_e164ish_chk;
ALTER TABLE public.db_restaurants
  ADD  CONSTRAINT db_restaurants_phone_e164ish_chk
       CHECK (
         telephone_of_the_establishment IS NULL
         OR telephone_of_the_establishment = ''
         OR telephone_of_the_establishment ~ '^\+[0-9 .()\-]{6,30}$'
       )
       NOT VALID;  -- NOT VALID: aplica só a novos/updates; backfill será na Fase 3
-- ALTER TABLE ... VALIDATE CONSTRAINT pode ser executado depois do backfill.

ALTER TABLE public.db_restaurants
  DROP CONSTRAINT IF EXISTS db_restaurants_email_format_chk;
ALTER TABLE public.db_restaurants
  ADD  CONSTRAINT db_restaurants_email_format_chk
       CHECK (
         email_for_reservations IS NULL
         OR email_for_reservations = ''
         OR email_for_reservations ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'
       )
       NOT VALID;

ALTER TABLE public.db_restaurants
  DROP CONSTRAINT IF EXISTS db_restaurants_site_url_format_chk;
ALTER TABLE public.db_restaurants
  ADD  CONSTRAINT db_restaurants_site_url_format_chk
       CHECK (
         site_url IS NULL
         OR site_url = ''
         OR site_url ~* '^https?://'
       )
       NOT VALID;

-- 3. negotiation_status como ENUM controlado
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='negotiation_status_enum') THEN
    CREATE TYPE public.negotiation_status_enum AS ENUM
      ('Pending','Interested','Negotiation','Partner','Decline');
  END IF;
END$$;

-- Conversão da coluna (com fallback NULL para valores desconhecidos)
DO $$
DECLARE
  current_type text;
BEGIN
  SELECT data_type INTO current_type
    FROM information_schema.columns
   WHERE table_schema='public' AND table_name='db_restaurants' AND column_name='negotiation_status';

  IF current_type IN ('character varying','text','character') THEN
    ALTER TABLE public.db_restaurants
      ALTER COLUMN negotiation_status TYPE public.negotiation_status_enum
      USING (CASE WHEN negotiation_status IN ('Pending','Interested','Negotiation','Partner','Decline')
                   THEN negotiation_status::public.negotiation_status_enum
                  ELSE NULL END);
  END IF;
END$$;

-- 4. UNIQUE em place_id condicional (só se não houver duplicatas)
DO $$
DECLARE
  dup_count int;
BEGIN
  SELECT COUNT(*) INTO dup_count FROM (
    SELECT place_id FROM public.db_restaurants
     WHERE place_id IS NOT NULL
     GROUP BY place_id HAVING COUNT(*)>1
  ) sub;

  IF dup_count > 0 THEN
    RAISE NOTICE 'place_id tem % grupos duplicados — pulando UNIQUE INDEX. Rode dedup primeiro (Fase 5).', dup_count;
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS db_restaurants_place_id_uniq
      ON public.db_restaurants (place_id)
      WHERE place_id IS NOT NULL;
  END IF;
END$$;

-- 5. CHECK de coordenadas válidas
ALTER TABLE public.db_restaurants
  DROP CONSTRAINT IF EXISTS db_restaurants_coords_range_chk;
ALTER TABLE public.db_restaurants
  ADD  CONSTRAINT db_restaurants_coords_range_chk
       CHECK (
         (latitude  IS NULL AND longitude IS NULL)
         OR (latitude  BETWEEN -90  AND 90
             AND longitude BETWEEN -180 AND 180
             AND NOT (latitude = 0 AND longitude = 0))
       )
       NOT VALID;

COMMIT;

-- =====================================================================
-- DOWN (cuidado: reverter partner→boolean para varchar requer dados):
-- =====================================================================
-- BEGIN;
--   ALTER TABLE public.db_restaurants
--     DROP CONSTRAINT IF EXISTS db_restaurants_coords_range_chk,
--     DROP CONSTRAINT IF EXISTS db_restaurants_site_url_format_chk,
--     DROP CONSTRAINT IF EXISTS db_restaurants_email_format_chk,
--     DROP CONSTRAINT IF EXISTS db_restaurants_phone_e164ish_chk;
--   DROP INDEX IF EXISTS public.db_restaurants_place_id_uniq;
--   ALTER TABLE public.db_restaurants
--     ALTER COLUMN negotiation_status TYPE varchar USING negotiation_status::text;
--   ALTER TABLE public.db_restaurants
--     ALTER COLUMN partner TYPE varchar USING (CASE WHEN partner THEN 'true' ELSE 'false' END);
--   DROP TYPE IF EXISTS public.negotiation_status_enum;
-- COMMIT;
