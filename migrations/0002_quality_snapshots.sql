-- Snapshots de qualidade/saúde (antes criados on-the-fly por lib/monitoring.ts).
-- Passa a ser schema versionado; o runtime mantém o CREATE IF NOT EXISTS como fallback.

CREATE TABLE IF NOT EXISTS public.quality_snapshots (
  id               SERIAL PRIMARY KEY,
  table_name       TEXT NOT NULL,
  quality_score    INTEGER,
  total_rows       INTEGER,
  critical_count   INTEGER,
  warning_count    INTEGER,
  info_count       INTEGER,
  duplicates       INTEGER,
  avg_completeness INTEGER,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_quality_snapshots_table_time
  ON public.quality_snapshots (table_name, created_at DESC);
