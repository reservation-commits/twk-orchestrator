-- =====================================================================
-- MIGRATION 003 — restaurant_awards (Michelin, 50 Best, Gault&Millau, etc.)
-- Status: PROPOSTA — NÃO EXECUTAR sem aprovação humana
-- Risco: BAIXO (CREATE TABLE nova; sem mexer em michelin_id existente)
-- Pré-requisitos: nenhum (coexiste com restaurant_michelin)
-- Lacuna alvo: Top Gap #3 — curadoria de elite sem 50 Best/Gault&Millau e
--              Michelin reduzido a 4 buckets compartilhados.
-- =====================================================================

BEGIN;

-- 1. Tipos de award reconhecidos (lookup table — extensível sem ALTER)
CREATE TABLE IF NOT EXISTS public.award_types (
  code         text PRIMARY KEY,
  family       text NOT NULL,                     -- 'michelin' | '50_best' | 'gault_millau' | 'other'
  display_name text NOT NULL,
  has_rank     boolean NOT NULL DEFAULT false,    -- true = exige campo rank_value (ex.: 50 Best ranking)
  has_level    boolean NOT NULL DEFAULT false,    -- true = exige campo level (ex.: 1/2/3 stars; 1-5 toques)
  description  text
);

INSERT INTO public.award_types(code, family, display_name, has_rank, has_level, description) VALUES
  ('michelin_star',         'michelin',     'Michelin Star',                  false, true,  '1, 2 ou 3 estrelas'),
  ('michelin_bib_gourmand', 'michelin',     'Michelin Bib Gourmand',          false, false, 'Boa cozinha a bom preço'),
  ('michelin_green_star',   'michelin',     'Michelin Green Star',            false, false, 'Sustentabilidade'),
  ('michelin_guide_listed', 'michelin',     'Michelin Guide (sem estrela)',   false, false, 'Listado no guia, sem distinção'),
  ('50_best',               '50_best',      'World''s 50 Best Restaurants',   true,  false, 'Ranking 1-100'),
  ('50_best_asia',          '50_best',      'Asia''s 50 Best Restaurants',    true,  false, 'Ranking 1-100'),
  ('50_best_latam',         '50_best',      'Latin America''s 50 Best',       true,  false, 'Ranking 1-100'),
  ('50_best_mena',          '50_best',      'MENA''s 50 Best',                true,  false, 'Ranking 1-100'),
  ('50_best_bars_world',    '50_best',      'World''s 50 Best Bars',          true,  false, 'Ranking 1-100'),
  ('gault_millau_toques',   'gault_millau', 'Gault & Millau Toques',          false, true,  '1-5 toques')
ON CONFLICT (code) DO NOTHING;

-- 2. Awards por estabelecimento (histórico por ano)
CREATE TABLE IF NOT EXISTS public.restaurant_awards (
  id              bigserial PRIMARY KEY,
  restaurant_id   varchar     NOT NULL REFERENCES public.db_restaurants(restaurant_id) ON DELETE CASCADE,
  award_code      text        NOT NULL REFERENCES public.award_types(code),
  level           integer,                -- estrelas Michelin (1-3), toques Gault&Millau (1-5)
  rank_value      integer,                -- posição em rankings 50 Best
  year            integer     NOT NULL,   -- ano do reconhecimento (ex.: 2025)
  source_url      text        NOT NULL,   -- URL canônica que comprova o award
  verified_at     timestamptz NOT NULL DEFAULT now(),
  confidence_level text       NOT NULL CHECK (confidence_level IN ('HIGH','MEDIUM','LOW','CONFLICT')),
  notes           text,
  CONSTRAINT restaurant_awards_unique UNIQUE (restaurant_id, award_code, year),
  CONSTRAINT restaurant_awards_level_chk CHECK (level IS NULL OR level BETWEEN 1 AND 5),
  CONSTRAINT restaurant_awards_rank_chk  CHECK (rank_value IS NULL OR rank_value BETWEEN 1 AND 1000),
  CONSTRAINT restaurant_awards_year_chk  CHECK (year BETWEEN 1900 AND 2100)
);

CREATE INDEX IF NOT EXISTS restaurant_awards_restaurant_idx
  ON public.restaurant_awards (restaurant_id);

CREATE INDEX IF NOT EXISTS restaurant_awards_award_year_idx
  ON public.restaurant_awards (award_code, year DESC);

CREATE INDEX IF NOT EXISTS restaurant_awards_recent_michelin_idx
  ON public.restaurant_awards (restaurant_id, year DESC)
  WHERE award_code LIKE 'michelin_%';

COMMENT ON TABLE  public.restaurant_awards IS
  'Awards e distinções por restaurante. Suporta histórico por ano. Não substitui restaurant_michelin (legado mantido).';
COMMENT ON COLUMN public.restaurant_awards.level IS
  'Estrelas Michelin (1-3) ou toques Gault&Millau (1-5). NULL para awards binários.';
COMMENT ON COLUMN public.restaurant_awards.rank_value IS
  'Posição em rankings (ex.: 50 Best #17). NULL para awards binários.';
COMMENT ON COLUMN public.restaurant_awards.source_url IS
  'URL canônica que comprova o award (guiamichelin.com/..., theworlds50best.com/...).';

-- 3. View de conveniência: award mais recente por restaurante
CREATE OR REPLACE VIEW public.v_restaurant_latest_awards AS
  SELECT DISTINCT ON (restaurant_id, award_code)
         restaurant_id, award_code, level, rank_value, year, source_url, verified_at, confidence_level
    FROM public.restaurant_awards
   ORDER BY restaurant_id, award_code, year DESC;

COMMIT;

-- =====================================================================
-- DOWN:
-- =====================================================================
-- BEGIN;
--   DROP VIEW  IF EXISTS public.v_restaurant_latest_awards;
--   DROP TABLE IF EXISTS public.restaurant_awards;
--   DROP TABLE IF EXISTS public.award_types;
-- COMMIT;
