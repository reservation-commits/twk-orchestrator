-- Log de auditoria do agente: tabela própria + imutabilidade real (append-only).
--
-- IMPORTANTE: public.update_events JÁ EXISTE no banco como tabela de negócio
-- (ações de representantes de vendas) com outro schema — por isso o log de
-- auditoria vive em public.agent_audit_log. O trigger impede UPDATE/DELETE
-- por QUALQUER caminho SQL, inclusive pelo próprio agente: a promessa de
-- "log imutável" vira garantia do banco.

CREATE TABLE IF NOT EXISTS public.agent_audit_log (
  id          SERIAL PRIMARY KEY,
  table_name  TEXT NOT NULL,
  operation   TEXT NOT NULL,
  record_id   TEXT,
  old_data    JSONB,
  new_data    JSONB,
  agent       TEXT DEFAULT 'db-architect',
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_audit_log_created_at ON public.agent_audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_audit_log_table_record ON public.agent_audit_log (table_name, record_id);

CREATE OR REPLACE FUNCTION public.agent_audit_log_append_only()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'agent_audit_log é append-only: % bloqueado (log de auditoria imutável)', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_agent_audit_log_append_only ON public.agent_audit_log;
CREATE TRIGGER trg_agent_audit_log_append_only
  BEFORE UPDATE OR DELETE ON public.agent_audit_log
  FOR EACH ROW EXECUTE FUNCTION public.agent_audit_log_append_only();
