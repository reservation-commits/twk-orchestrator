-- Snapshots de qualidade/saúde (antes criados on-the-fly por lib/monitoring.ts).
-- Shape espelha a tabela REAL já existente em produção (captured_at + metadata).

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
  metadata         JSONB,
  captured_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_quality_snapshots_table_time
  ON public.quality_snapshots (table_name, captured_at DESC);
