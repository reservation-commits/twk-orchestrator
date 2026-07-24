-- Log de auditoria: tabela + imutabilidade real (append-only).
-- O trigger impede UPDATE/DELETE em update_events por QUALQUER caminho SQL,
-- inclusive pelo próprio agente — a promessa de "log imutável" vira garantia do banco.

CREATE TABLE IF NOT EXISTS public.update_events (
  id          SERIAL PRIMARY KEY,
  table_name  TEXT NOT NULL,
  operation   TEXT NOT NULL,
  record_id   TEXT,
  old_data    JSONB,
  new_data    JSONB,
  agent       TEXT DEFAULT 'db-architect',
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_update_events_created_at ON public.update_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_update_events_table_record ON public.update_events (table_name, record_id);

CREATE OR REPLACE FUNCTION public.update_events_append_only()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'update_events é append-only: % bloqueado (log de auditoria imutável)', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_update_events_append_only ON public.update_events;
CREATE TRIGGER trg_update_events_append_only
  BEFORE UPDATE OR DELETE ON public.update_events
  FOR EACH ROW EXECUTE FUNCTION public.update_events_append_only();
