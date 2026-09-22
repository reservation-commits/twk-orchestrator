-- ============================================================================
-- Migração — public.aria_phone_quality
--
-- Registro do veredito E.164 por usuário. Tabela DERIVADA e descartável:
-- reconstruída a qualquer momento por docs/notificacoes/fase0-validar-telefones.cjs.
--
-- NÃO autoriza envio. Quem autoriza é o código, a cada mensagem
-- (Agente de Suporte e Concierge/src/phoneQuality.ts). Esta tabela é para
-- relatório e segmentação.
--
-- O telefone NÃO é copiado para cá — é a mesma PII já guardada em
-- nextauth."User".phone, e o caminho de envio recalcula em memória.
--
-- Proposta e justificativa: docs/notificacoes/fase2-ddl-trava-telefone.md
--
-- EXECUÇÃO: humana. O papel `twk_dba` não tem DDL por desenho (ADR-013), e o
-- servidor impõe isso — este arquivo não roda pelo caminho dos agentes.
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.aria_phone_quality (
  user_id      TEXT        PRIMARY KEY,
  phone_status TEXT        NOT NULL,
  pais         TEXT,
  tipo         TEXT,
  motivo       TEXT,
  checked_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS aria_phone_quality_status_idx
  ON public.aria_phone_quality (phone_status);

COMMENT ON TABLE public.aria_phone_quality IS
  'Veredito E.164 por usuário, derivado de nextauth."User".phone por src/phoneQuality.ts. '
  'Derivado e descartável: a fonte da verdade do telefone continua sendo a plataforma. '
  'NAO autoriza envio — quem autoriza é o código, a cada mensagem.';

COMMENT ON COLUMN public.aria_phone_quality.phone_status IS
  'ENVIAVEL | ENVIAVEL_NAO_MOVEL | AMBIGUO_BR | CORRIGIVEL_BR | INVALIDO | VAZIO';

COMMIT;

-- ============================================================================
-- ROLLBACK (sem perda: a tabela é 100% reconstruível pelo validador)
--
--   DROP TABLE IF EXISTS public.aria_phone_quality;
--
-- ============================================================================
-- CONFERÊNCIA depois do backfill — o esperado, pela validação de 2026-09-21:
--
--   SELECT phone_status, count(*) FROM public.aria_phone_quality
--    GROUP BY 1 ORDER BY 2 DESC;
--
--   ENVIAVEL            16799
--   INVALIDO             4854
--   CORRIGIVEL_BR         544
--   AMBIGUO_BR            245
--   ENVIAVEL_NAO_MOVEL    194
--   VAZIO                   2
--   --------------------------
--   total               22638
-- ============================================================================
