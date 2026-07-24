-- Coluna de JSON-LD schema.org (antes criada como efeito colateral da tool
-- generate_structured_data). Agora versionada.

ALTER TABLE public.db_restaurants
  ADD COLUMN IF NOT EXISTS structured_data_json JSONB;
