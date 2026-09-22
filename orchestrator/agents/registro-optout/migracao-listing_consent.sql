-- PROPOSTA DE MIGRAÇÃO (DDL) — execução exclusiva do fundador (tabela de escalonamento do CLAUDE.md).
-- ADR-010 · trace trc-agentes0902 · 2026-09-02
-- Rodar via runner oficial (migrate.mjs do DBA) com backup verificado antes. NÃO rodar por agente.
--
-- Objetivo: fonte única de consentimento do ESTABELECIMENTO (listagem, reservas, prospecção),
-- dona: Suporte (Aria). Consultada por Guardião, CLAVIS, importador e publicador.

BEGIN;

CREATE TABLE IF NOT EXISTS public.listing_consent (
  id              bigserial PRIMARY KEY,
  restaurant_id   varchar NOT NULL REFERENCES public.db_restaurants(restaurant_id),
  status          text    NOT NULL CHECK (status IN ('listed','correction_requested','opted_out','claimed')),
  do_not_relist   boolean NOT NULL DEFAULT false,
  scope           text[]  NOT NULL DEFAULT ARRAY['listing'],   -- listing | reservations | outreach
  requested_at    timestamptz NOT NULL,
  requested_by    text    NOT NULL,           -- referência: 'email:<endereço>' | 'click:<token>' | 'humano:<nome>'
  legal_basis     text,                       -- obrigatório quando opted_out (checado por trigger abaixo)
  evidence_ref    text    NOT NULL,           -- 'gmail:<id>' | 'n8n:<execução>' | 'chat:<data>'
  sla_ack_at      timestamptz,
  sla_done_at     timestamptz,
  notes           text,
  trace_id        text    NOT NULL,
  registered_at   timestamptz NOT NULL DEFAULT now(),
  registered_by   text    NOT NULL DEFAULT current_user
);
-- Append-only: estado atual = último evento por restaurante.
CREATE INDEX IF NOT EXISTS idx_listing_consent_restaurant ON public.listing_consent (restaurant_id, registered_at DESC);

CREATE OR REPLACE FUNCTION public.listing_consent_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'listing_consent é append-only (ADR-010): use um novo evento';
  END IF;
  IF NEW.status = 'opted_out' AND (NEW.legal_basis IS NULL OR length(trim(NEW.legal_basis)) = 0) THEN
    RAISE EXCEPTION 'opted_out exige legal_basis';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_listing_consent_guard ON public.listing_consent;
CREATE TRIGGER trg_listing_consent_guard BEFORE INSERT OR UPDATE OR DELETE ON public.listing_consent
  FOR EACH ROW EXECUTE FUNCTION public.listing_consent_guard();

-- Visão do estado atual (o que Guardião/CLAVIS/importador consultam).
CREATE OR REPLACE VIEW public.v_listing_consent_atual AS
SELECT DISTINCT ON (restaurant_id) *
FROM public.listing_consent
ORDER BY restaurant_id, registered_at DESC;

-- Projeção na tabela do catálogo (leitura rápida pelo publicador/importador).
ALTER TABLE public.db_restaurants ADD COLUMN IF NOT EXISTS do_not_relist boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.listing_consent_project() RETURNS trigger AS $$
BEGIN
  UPDATE public.db_restaurants SET do_not_relist = NEW.do_not_relist WHERE restaurant_id = NEW.restaurant_id;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_listing_consent_project ON public.listing_consent;
CREATE TRIGGER trg_listing_consent_project AFTER INSERT ON public.listing_consent
  FOR EACH ROW EXECUTE FUNCTION public.listing_consent_project();

-- Guarda no catálogo: ninguém republica quem pediu para não ser relistado.
CREATE OR REPLACE FUNCTION public.db_restaurants_no_relist_guard() RETURNS trigger AS $$
BEGIN
  IF NEW.published = true AND NEW.do_not_relist = true THEN
    RAISE EXCEPTION 'restaurant_id % tem do_not_relist=true (listing_consent): republicação bloqueada', NEW.restaurant_id;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_db_restaurants_no_relist ON public.db_restaurants;
CREATE TRIGGER trg_db_restaurants_no_relist BEFORE INSERT OR UPDATE OF published, do_not_relist ON public.db_restaurants
  FOR EACH ROW EXECUTE FUNCTION public.db_restaurants_no_relist_guard();

-- Privilégios: Suporte escreve (aria_agent), demais leem. twk_ro já herda SELECT por ALTER DEFAULT PRIVILEGES.
-- GRANT INSERT, SELECT ON public.listing_consent TO aria_agent;   -- descomentar quando a role existir
-- GRANT USAGE, SELECT ON SEQUENCE public.listing_consent_id_seq TO aria_agent;

-- Backfill obrigatório: importar orchestrator/state/listing-consent.jsonl (1 evento hoje: Bar Cañete, 15207).
INSERT INTO public.listing_consent (restaurant_id, status, do_not_relist, scope, requested_at, requested_by, legal_basis, evidence_ref, sla_ack_at, notes, trace_id, registered_by)
VALUES ('15207','opted_out',true,ARRAY['listing','reservations','outreach'],'2026-08-28T00:00:00+02:00','email:canete@grupolive.net',
        'Ausência de consentimento (importação em massa 2023-07-25) + GDPR art. 21','gmail:1a04a246dd10a9e1','2026-08-28',
        'front ainda responde 200 em /hospitality/canete/ — executado só fecha com 404','canete-unpublish-2026-08-28','backfill trc-agentes0902');

-- Auditoria na mesma transação (padrão db-audited.js):
INSERT INTO public.agent_audit_log (table_name, operation, record_id, old_data, new_data, agent)
VALUES ('listing_consent','DDL+BACKFILL','15207',NULL,jsonb_build_object('status','opted_out','do_not_relist',true),'fundador (ADR-010)');

COMMIT;

-- ROLLBACK (só se nada mais dependeu da tabela):
-- BEGIN; DROP TRIGGER IF EXISTS trg_db_restaurants_no_relist ON public.db_restaurants; DROP FUNCTION IF EXISTS public.db_restaurants_no_relist_guard();
-- ALTER TABLE public.db_restaurants DROP COLUMN IF EXISTS do_not_relist; DROP VIEW IF EXISTS public.v_listing_consent_atual;
-- DROP TABLE IF EXISTS public.listing_consent; DROP FUNCTION IF EXISTS public.listing_consent_guard(); DROP FUNCTION IF EXISTS public.listing_consent_project(); COMMIT;
