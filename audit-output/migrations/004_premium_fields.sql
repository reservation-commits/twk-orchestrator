-- =====================================================================
-- MIGRATION 004 — Campos premium de produto
-- Status: PROPOSTA — NÃO EXECUTAR sem aprovação humana
-- Risco: BAIXO (ADD COLUMN). Tags como text[] para flexibilidade.
-- Lacuna alvo: TWK é concierge de fine dining; informações de chef,
--              política de reserva e tags qualitativas são o coração da
--              experiência de descoberta premium.
-- =====================================================================

BEGIN;

ALTER TABLE public.db_restaurants
  ADD COLUMN IF NOT EXISTS chef_name                  text,
  ADD COLUMN IF NOT EXISTS chef_bio                   text,
  ADD COLUMN IF NOT EXISTS reservation_policy         text,
  ADD COLUMN IF NOT EXISTS avg_meal_duration_minutes  integer,
  ADD COLUMN IF NOT EXISTS party_size_min             integer,
  ADD COLUMN IF NOT EXISTS party_size_max             integer,
  ADD COLUMN IF NOT EXISTS accepts_walkins            boolean,
  ADD COLUMN IF NOT EXISTS booking_url                text,
  ADD COLUMN IF NOT EXISTS dress_code                 text,
  ADD COLUMN IF NOT EXISTS dietary_tags               text[] DEFAULT ARRAY[]::text[] NOT NULL,
  ADD COLUMN IF NOT EXISTS ambience_tags              text[] DEFAULT ARRAY[]::text[] NOT NULL,
  ADD COLUMN IF NOT EXISTS good_for                   text[] DEFAULT ARRAY[]::text[] NOT NULL,
  ADD COLUMN IF NOT EXISTS tasting_menu_available     boolean,
  ADD COLUMN IF NOT EXISTS tasting_menu_price_min     numeric(10,2),
  ADD COLUMN IF NOT EXISTS tasting_menu_currency      char(3);

-- CHECK: party sizes coerentes
ALTER TABLE public.db_restaurants
  DROP CONSTRAINT IF EXISTS db_restaurants_party_size_chk;
ALTER TABLE public.db_restaurants
  ADD  CONSTRAINT db_restaurants_party_size_chk
       CHECK (
         (party_size_min IS NULL AND party_size_max IS NULL)
         OR (party_size_min BETWEEN 1 AND 200
             AND party_size_max BETWEEN 1 AND 200
             AND party_size_max >= party_size_min)
       );

-- CHECK: avg_meal_duration realista (15-480 minutos)
ALTER TABLE public.db_restaurants
  DROP CONSTRAINT IF EXISTS db_restaurants_meal_duration_chk;
ALTER TABLE public.db_restaurants
  ADD  CONSTRAINT db_restaurants_meal_duration_chk
       CHECK (avg_meal_duration_minutes IS NULL
              OR avg_meal_duration_minutes BETWEEN 15 AND 480);

-- CHECK: dress_code controlado (valores conhecidos; texto livre via NULL+notas)
ALTER TABLE public.db_restaurants
  DROP CONSTRAINT IF EXISTS db_restaurants_dress_code_chk;
ALTER TABLE public.db_restaurants
  ADD  CONSTRAINT db_restaurants_dress_code_chk
       CHECK (dress_code IS NULL
              OR dress_code IN ('casual','smart_casual','business_casual','formal','black_tie'));

-- CHECK: booking_url formato URL https quando preenchido
ALTER TABLE public.db_restaurants
  DROP CONSTRAINT IF EXISTS db_restaurants_booking_url_chk;
ALTER TABLE public.db_restaurants
  ADD  CONSTRAINT db_restaurants_booking_url_chk
       CHECK (booking_url IS NULL OR booking_url ~* '^https?://');

-- CHECK: currency ISO 4217 (3 letras maiúsculas) quando preenchida
ALTER TABLE public.db_restaurants
  DROP CONSTRAINT IF EXISTS db_restaurants_tasting_currency_chk;
ALTER TABLE public.db_restaurants
  ADD  CONSTRAINT db_restaurants_tasting_currency_chk
       CHECK (tasting_menu_currency IS NULL OR tasting_menu_currency ~ '^[A-Z]{3}$');

-- Índices GIN para busca por tags
CREATE INDEX IF NOT EXISTS db_restaurants_dietary_tags_gin
  ON public.db_restaurants USING gin (dietary_tags);
CREATE INDEX IF NOT EXISTS db_restaurants_ambience_tags_gin
  ON public.db_restaurants USING gin (ambience_tags);
CREATE INDEX IF NOT EXISTS db_restaurants_good_for_gin
  ON public.db_restaurants USING gin (good_for);

-- Documentação
COMMENT ON COLUMN public.db_restaurants.chef_name IS 'Chef executivo ou principal (nome completo).';
COMMENT ON COLUMN public.db_restaurants.chef_bio  IS 'Bio curta do chef (1-3 parágrafos).';
COMMENT ON COLUMN public.db_restaurants.reservation_policy IS
  'Política de reserva em texto livre curto (ex.: "Pré-pagamento de €150/pessoa; menu degustação único").';
COMMENT ON COLUMN public.db_restaurants.dietary_tags IS
  'Tags de dieta: vegetarian_friendly, vegan_options, gluten_free, kosher, halal, etc.';
COMMENT ON COLUMN public.db_restaurants.ambience_tags IS
  'Tags de ambiente: romantic, rooftop, view, garden, intimate, lively, historic, etc.';
COMMENT ON COLUMN public.db_restaurants.good_for IS
  'Ocasiões: business, romantic, groups, celebration, solo, family, special_occasion.';

COMMIT;

-- =====================================================================
-- DOWN:
-- =====================================================================
-- BEGIN;
--   ALTER TABLE public.db_restaurants
--     DROP CONSTRAINT IF EXISTS db_restaurants_tasting_currency_chk,
--     DROP CONSTRAINT IF EXISTS db_restaurants_booking_url_chk,
--     DROP CONSTRAINT IF EXISTS db_restaurants_dress_code_chk,
--     DROP CONSTRAINT IF EXISTS db_restaurants_meal_duration_chk,
--     DROP CONSTRAINT IF EXISTS db_restaurants_party_size_chk,
--     DROP COLUMN IF EXISTS tasting_menu_currency,
--     DROP COLUMN IF EXISTS tasting_menu_price_min,
--     DROP COLUMN IF EXISTS tasting_menu_available,
--     DROP COLUMN IF EXISTS good_for,
--     DROP COLUMN IF EXISTS ambience_tags,
--     DROP COLUMN IF EXISTS dietary_tags,
--     DROP COLUMN IF EXISTS dress_code,
--     DROP COLUMN IF EXISTS booking_url,
--     DROP COLUMN IF EXISTS accepts_walkins,
--     DROP COLUMN IF EXISTS party_size_max,
--     DROP COLUMN IF EXISTS party_size_min,
--     DROP COLUMN IF EXISTS avg_meal_duration_minutes,
--     DROP COLUMN IF EXISTS reservation_policy,
--     DROP COLUMN IF EXISTS chef_bio,
--     DROP COLUMN IF EXISTS chef_name;
-- COMMIT;
