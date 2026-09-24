-- ═══════════════════════════════════════════════════════════════════════════
-- Role de MENOR PRIVILÉGIO para o TWK DB Architect: twk_db_agent
--
-- EXECUÇÃO MANUAL PELO FUNDADOR (este arquivo NUNCA é executado pelo app):
--   1. Conecte no Cloud SQL como superusuário (Cloud SQL Studio ou
--      `gcloud sql connect <instância> --user=postgres`).
--   2. Troque a senha do placeholder abaixo e execute este script inteiro.
--   3. Atualize o DATABASE_URL do app para usar twk_db_agent (nunca postgres):
--        postgresql://twk_db_agent:<senha>@<host>:5432/<db>?sslmode=verify-ca
--   4. Defina DB_CA_CERT com o certificado CA da instância (Cloud SQL →
--      Conexões → Certificados) para que o app verifique o servidor
--      (sslmode=verify-ca; sem DB_CA_CERT o app cai em TLS sem verificação).
--
-- Princípios:
--   · SELECT apenas nas tabelas que o app lê (catálogo + auditoria).
--   · INSERT/UPDATE apenas nas tabelas da allowlist de mutação (lib/sql-guard.ts).
--   · DELETE NÃO é concedido — deleções exigem revisão humana com outra role.
--   · agent_audit_log: INSERT + SELECT (append-only é garantido por trigger da
--     migration 0001; UPDATE/DELETE não são concedidos nem funcionariam).
--   · NENHUM grant no schema nextauth nem nas tabelas de negócio protegidas
--     (reservations*, deposit*, stripe_webhook_events, favorites, messages,
--     event, wp_user_phones, sales_representatives, n8n_chat_histories, aria_*).
--     Checks de consistência que leem essas tabelas passarão a reportar erro de
--     permissão — comportamento intencional.
-- ═══════════════════════════════════════════════════════════════════════════

-- Role de login sem privilégios administrativos.
CREATE ROLE twk_db_agent
  LOGIN
  NOSUPERUSER
  NOCREATEDB
  NOCREATEROLE
  NOREPLICATION
  PASSWORD 'TROQUE-ESTA-SENHA-ANTES-DE-EXECUTAR';

-- Acesso básico: conectar no banco e enxergar o schema public.
-- O banco da plataforma chama-se twk_auth (corrigido em 2026-09-21; antes dizia "postgres",
-- que é OUTRO banco da mesma instância — o papel nasceria sem conseguir conectar).
GRANT CONNECT ON DATABASE twk_auth TO twk_db_agent;
GRANT USAGE ON SCHEMA public TO twk_db_agent;

-- Sequences do schema public: necessárias para INSERTs em colunas SERIAL.
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO twk_db_agent;

-- ── Leitura: tabelas que o app consulta ─────────────────────────────────────
GRANT SELECT ON
  public.db_restaurants,
  public.opening_hours,
  public.restaurant_category_map,
  public.restaurant_categories,
  public.establishment_type_map,
  public.establishment_types,
  public.restaurant_awards,
  public.restaurant_michelin,
  public.restaurant_about_hours,
  public.restaurant_price_range,
  public.cities,
  public.countries,
  public.contacts_pro,
  public.rest_contacts,
  public.restaurant_field_verifications,
  public.quality_snapshots,
  public.update_events,
  public.agent_audit_log
TO twk_db_agent;

-- ── Escrita: INSERT/UPDATE apenas na allowlist de mutação (lib/sql-guard.ts) ─
GRANT INSERT, UPDATE ON
  public.db_restaurants,
  public.opening_hours,
  public.restaurant_category_map,
  public.restaurant_categories,
  public.establishment_type_map,
  public.establishment_types,
  public.restaurant_awards,
  public.restaurant_michelin,
  public.restaurant_about_hours,
  public.restaurant_price_range,
  public.cities,
  public.countries,
  public.contacts_pro,
  public.rest_contacts,
  public.restaurant_field_verifications,
  public.quality_snapshots,
  public.update_events
TO twk_db_agent;

-- ── Trilha de auditoria: INSERT-only ────────────────────────────────────────
-- (SELECT já concedido acima para o Activity Logs; UPDATE/DELETE ficam de fora
--  e o trigger append-only da migration 0001 bloqueia qualquer tentativa.)
GRANT INSERT ON public.agent_audit_log TO twk_db_agent;

-- ── Explicitamente NADA além disso ──────────────────────────────────────────
-- Sem GRANT em: schema nextauth (autenticação), reservations,
-- reservations_backup, reservation_deposits, deposit_rules,
-- deposit_billing_config, stripe_webhook_events, favorites, messages, event,
-- wp_user_phones, sales_representatives, n8n_chat_histories, aria_*.
-- Sem CREATE no schema public (nenhum DDL em runtime):
REVOKE CREATE ON SCHEMA public FROM twk_db_agent;
