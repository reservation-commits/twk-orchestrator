-- =====================================================================
-- MIGRATION 002 — timezone + operational_status
-- Status: PROPOSTA — NÃO EXECUTAR sem aprovação humana
-- Risco: BAIXO (ADD COLUMN + default + index). Lock curto.
-- Pré-requisitos: nenhum
-- Lacuna alvo: Top Gap #2 (operação de reserva incompleta) e ausência de
--              âncora de fuso em 100% dos registros.
-- =====================================================================

BEGIN;

-- 1. timezone IANA por estabelecimento (ex.: "Europe/Paris", "Asia/Bangkok")
ALTER TABLE public.db_restaurants
  ADD COLUMN IF NOT EXISTS timezone text;

ALTER TABLE public.db_restaurants
  DROP CONSTRAINT IF EXISTS db_restaurants_timezone_format_chk;
-- IANA tz: ContinentOuArea/Cidade ou nomes especiais (UTC, Etc/GMT...)
ALTER TABLE public.db_restaurants
  ADD  CONSTRAINT db_restaurants_timezone_format_chk
       CHECK (
         timezone IS NULL
         OR timezone ~ '^[A-Z][A-Za-z_]+/[A-Za-z_\-]+(?:/[A-Za-z_\-]+)?$'
         OR timezone IN ('UTC')
       );

COMMENT ON COLUMN public.db_restaurants.timezone IS
  'Fuso IANA do estabelecimento (ex.: "Europe/Paris"). Necessário para interpretar opening_hours/business_hours_json corretamente.';

CREATE INDEX IF NOT EXISTS db_restaurants_timezone_idx
  ON public.db_restaurants (timezone);

-- 2. operational_status (ativo / fechado permanentemente / temp. fechado)
ALTER TABLE public.db_restaurants
  ADD COLUMN IF NOT EXISTS operational_status text NOT NULL DEFAULT 'active';

ALTER TABLE public.db_restaurants
  DROP CONSTRAINT IF EXISTS db_restaurants_operational_status_chk;
ALTER TABLE public.db_restaurants
  ADD  CONSTRAINT db_restaurants_operational_status_chk
       CHECK (operational_status IN ('active','closed_permanently','temporarily_closed','unknown'));

COMMENT ON COLUMN public.db_restaurants.operational_status IS
  'Status operacional real (independe de published). Reservar exibição/reserva apenas para active.';

CREATE INDEX IF NOT EXISTS db_restaurants_operational_status_idx
  ON public.db_restaurants (operational_status);

-- 3. Coluna auxiliar: motivo do status (texto livre curto)
ALTER TABLE public.db_restaurants
  ADD COLUMN IF NOT EXISTS operational_status_reason text;

COMMENT ON COLUMN public.db_restaurants.operational_status_reason IS
  'Motivo curto se status != active (ex.: "Fechado em 2024 — anúncio no site oficial").';

COMMIT;

-- =====================================================================
-- DOWN:
-- =====================================================================
-- BEGIN;
--   ALTER TABLE public.db_restaurants
--     DROP CONSTRAINT IF EXISTS db_restaurants_operational_status_chk,
--     DROP CONSTRAINT IF EXISTS db_restaurants_timezone_format_chk,
--     DROP COLUMN  IF EXISTS operational_status_reason,
--     DROP COLUMN  IF EXISTS operational_status,
--     DROP COLUMN  IF EXISTS timezone;
--   DROP INDEX IF EXISTS public.db_restaurants_timezone_idx;
--   DROP INDEX IF EXISTS public.db_restaurants_operational_status_idx;
-- COMMIT;
