-- Extensões de performance (tolerante: pode exigir privilégio/flag no Cloud SQL).
-- pg_trgm habilita busca fuzzy/dedup por similaridade direto no SQL (GIN index).
-- pg_stat_statements alimenta a tool slow_queries (exige shared_preload_libraries
-- no Cloud SQL — a flag é configurada no console; o CREATE aqui só formaliza).

DO $$
BEGIN
  BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_trgm;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'pg_trgm não pôde ser criada: %', SQLERRM;
  END;
  BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'pg_stat_statements não pôde ser criada: %', SQLERRM;
  END;
END $$;

-- Índice trigram para dedup/fuzzy por nome (só cria se a extensão existir).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    CREATE INDEX IF NOT EXISTS idx_db_restaurants_name_trgm
      ON public.db_restaurants USING gin (lower(name) gin_trgm_ops);
  END IF;
END $$;
