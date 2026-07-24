-- =====================================================================
-- MIGRATION 001 — Governança de dados em db_restaurants
-- Status: PROPOSTA — NÃO EXECUTAR sem aprovação humana
-- Reverter: ver bloco DOWN ao final.
-- Risco: BAIXO (apenas ADD COLUMN, sem reescrita de dados, sem locks longos)
-- Pré-requisitos: nenhum
-- Alvo da Regra de Ouro: cumpre fase "verdade auditável" do Banco Perfeito
-- =====================================================================

BEGIN;

-- 1. Colunas de proveniência por estabelecimento
ALTER TABLE public.db_restaurants
  ADD COLUMN IF NOT EXISTS last_verified_at    timestamptz,
  ADD COLUMN IF NOT EXISTS verification_source text,
  ADD COLUMN IF NOT EXISTS confidence_level    text,
  ADD COLUMN IF NOT EXISTS enrichment_log      jsonb DEFAULT '[]'::jsonb NOT NULL;

-- 2. CHECK em confidence_level (valores controlados)
ALTER TABLE public.db_restaurants
  DROP CONSTRAINT IF EXISTS db_restaurants_confidence_chk;
ALTER TABLE public.db_restaurants
  ADD  CONSTRAINT db_restaurants_confidence_chk
       CHECK (confidence_level IS NULL
              OR confidence_level IN ('HIGH','MEDIUM','LOW','CONFLICT'));

-- 3. CHECK garantindo que enrichment_log é sempre um array JSON
ALTER TABLE public.db_restaurants
  DROP CONSTRAINT IF EXISTS db_restaurants_enrichment_log_is_array;
ALTER TABLE public.db_restaurants
  ADD  CONSTRAINT db_restaurants_enrichment_log_is_array
       CHECK (jsonb_typeof(enrichment_log) = 'array');

-- 4. Índices para consultas operacionais (curadoria, dashboards)
CREATE INDEX IF NOT EXISTS db_restaurants_last_verified_at_idx
  ON public.db_restaurants (last_verified_at);

CREATE INDEX IF NOT EXISTS db_restaurants_confidence_level_idx
  ON public.db_restaurants (confidence_level)
  WHERE confidence_level IS NOT NULL;

-- 5. Tabela granular: trilha por campo verificado
-- (permite saber QUAL coluna foi verificada quando, por qual fonte)
CREATE TABLE IF NOT EXISTS public.restaurant_field_verifications (
  id              bigserial PRIMARY KEY,
  restaurant_id   varchar     NOT NULL REFERENCES public.db_restaurants(restaurant_id) ON DELETE CASCADE,
  field_name      text        NOT NULL,
  value_hash      text,                 -- sha256 do valor verificado (para detectar drift)
  source          text        NOT NULL, -- URL canônica ou identificador (ex: "google_places:ChIJ...")
  source_kind     text        NOT NULL, -- 'official_site' | 'google_places' | 'michelin_guide' | '50_best' | 'gault_millau' | 'other'
  verified_at     timestamptz NOT NULL DEFAULT now(),
  confidence_level text       NOT NULL CHECK (confidence_level IN ('HIGH','MEDIUM','LOW','CONFLICT')),
  notes           text,
  agent           text        NOT NULL DEFAULT 'twk-db-architect'
);

CREATE INDEX IF NOT EXISTS rfv_restaurant_field_idx
  ON public.restaurant_field_verifications (restaurant_id, field_name, verified_at DESC);

CREATE INDEX IF NOT EXISTS rfv_verified_at_idx
  ON public.restaurant_field_verifications (verified_at DESC);

-- 6. Comentários (documentação inline)
COMMENT ON COLUMN public.db_restaurants.last_verified_at IS
  'Data/hora da última verificação completa do registro. NULL = nunca verificado por este agente.';
COMMENT ON COLUMN public.db_restaurants.verification_source IS
  'Fonte resumida da última verificação (URL canônica ou identificador, ex: "official_site:https://...", "google_places:ChIJ...").';
COMMENT ON COLUMN public.db_restaurants.confidence_level IS
  'Confiança agregada do registro: HIGH (≥2 fontes), MEDIUM (1 fonte oficial), LOW (fonte fraca), CONFLICT (fontes divergentes).';
COMMENT ON COLUMN public.db_restaurants.enrichment_log IS
  'Array JSONB de eventos de enriquecimento: [{field, old_value, new_value, source, verified_at, confidence, agent}].';
COMMENT ON TABLE  public.restaurant_field_verifications IS
  'Trilha por campo: cada registro = uma verificação documentada de um campo específico contra uma fonte.';

COMMIT;

-- =====================================================================
-- DOWN (reversão completa) — execute somente se quiser reverter:
-- =====================================================================
-- BEGIN;
--   DROP TABLE IF EXISTS public.restaurant_field_verifications;
--   ALTER TABLE public.db_restaurants
--     DROP CONSTRAINT IF EXISTS db_restaurants_enrichment_log_is_array,
--     DROP CONSTRAINT IF EXISTS db_restaurants_confidence_chk,
--     DROP COLUMN  IF EXISTS enrichment_log,
--     DROP COLUMN  IF EXISTS confidence_level,
--     DROP COLUMN  IF EXISTS verification_source,
--     DROP COLUMN  IF EXISTS last_verified_at;
--   DROP INDEX IF EXISTS public.db_restaurants_last_verified_at_idx;
--   DROP INDEX IF EXISTS public.db_restaurants_confidence_level_idx;
-- COMMIT;
