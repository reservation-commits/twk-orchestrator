-- COMPASSO Tarefas — livro único de tarefas (plan_*) e papel twk_plan.
-- EXIGE A FRASE DO FUNDADOR: CREATE TABLE em public (ADR-017, pela porta única, com GRANT CREATE ao twk_dba)
-- e CREATE ROLE (papéis de banco são sempre humanos). Rodar como dono do banco, numa transação.
-- Reversão: DROP TABLE plan_eventos, plan_sugestoes, plan_tarefas; DROP ROLE twk_plan; (também humano).
BEGIN;

CREATE TABLE IF NOT EXISTS public.plan_tarefas (
  id            text PRIMARY KEY,                 -- T-AAAAMMDD-NNNN
  dados         jsonb NOT NULL,                   -- a tarefa inteira (titulo, area, dono, etapas, notas, origem, carimbos)
  estado        text NOT NULL CHECK (estado IN ('todo','doing','wait','done')),
  dono          text NOT NULL CHECK (dono IN ('marlon','lucas','julien')),
  vence_em      date,
  criado_em     timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  excluida_em   timestamptz                       -- exclusão é lógica; o ledger guarda o evento
);
CREATE INDEX IF NOT EXISTS plan_tarefas_abertas ON public.plan_tarefas (estado, vence_em) WHERE excluida_em IS NULL;

CREATE TABLE IF NOT EXISTS public.plan_eventos (
  id        bigserial PRIMARY KEY,
  ts        timestamptz NOT NULL DEFAULT now(),
  tarefa_id text,
  tipo      text NOT NULL,                        -- criada | atualizada | estado | excluida | sugestao_assumida | sugestao_descartada
  quem      text,
  trace_id  text,
  detalhe   jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS plan_eventos_tarefa ON public.plan_eventos (tarefa_id, ts);

-- append-only por trigger, no mesmo padrão de agent_audit_log: ninguém altera ou apaga evento.
CREATE OR REPLACE FUNCTION public.plan_eventos_somente_insercao() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'plan_eventos é append-only (%)', TG_OP; END $$;
DROP TRIGGER IF EXISTS plan_eventos_imutavel ON public.plan_eventos;
CREATE TRIGGER plan_eventos_imutavel BEFORE UPDATE OR DELETE ON public.plan_eventos
  FOR EACH ROW EXECUTE FUNCTION public.plan_eventos_somente_insercao();

CREATE TABLE IF NOT EXISTS public.plan_sugestoes (
  id        text PRIMARY KEY,                     -- s-<hash da chave de origem>
  dados     jsonb NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT now()
);

-- Papel do app: só estas tabelas, nada de DDL, nada fora de plan_*.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'twk_plan') THEN
    CREATE ROLE twk_plan LOGIN PASSWORD '<definir-na-hora>' NOINHERIT NOCREATEDB NOCREATEROLE NOSUPERUSER;
  END IF;
END $$;
ALTER ROLE twk_plan SET statement_timeout = '8s';
GRANT USAGE ON SCHEMA public TO twk_plan;
GRANT SELECT, INSERT, UPDATE ON public.plan_tarefas, public.plan_sugestoes TO twk_plan;
GRANT SELECT, INSERT ON public.plan_eventos TO twk_plan;
GRANT USAGE, SELECT ON SEQUENCE public.plan_eventos_id_seq TO twk_plan;
-- (sem DELETE em lugar nenhum; a exclusão de tarefa é UPDATE de excluida_em)

COMMIT;

-- Conferência (como twk_plan): deve falhar
--   DELETE FROM plan_tarefas WHERE false;            -- permission denied
--   UPDATE plan_eventos SET tipo='x' WHERE false;    -- permission denied (e o trigger barra o dono)
--   SELECT 1 FROM nextauth."User" LIMIT 1;           -- permission denied
