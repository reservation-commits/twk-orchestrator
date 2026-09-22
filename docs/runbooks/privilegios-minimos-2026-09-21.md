# Poder total pela porta — o que só você pode fazer (15 minutos, uma vez)

> Versão curta, reescrita em 21/09 depois da sua devolutiva. A anterior era um documento de operador.
> Desenho: ADR-017 (proposto). Verificador: `node orchestrator/agents/zelador-privilegios/verificar.js`.

## O que já mudou sozinho, sem você

Os 35 scripts do DBA e o app do DBA passaram a usar o usuário **`twk_dba`** (o que você criou em 08/09),
lendo a credencial de `~/.twk/dba.env`. Esse usuário pode inserir, alterar e **apagar em qualquer tabela
do negócio** — poder total em dados — e não pode destruir estrutura nem tocar contas de cliente.
Confirmado hoje: `[db-config] papel em uso: twk_dba`.

O que sobra para você são **quatro colagens** no Cloud SQL Studio e **uma conferência**. Depois disso,
nunca mais uma linha de SQL: os agentes têm a porta, o backup e o desfazer.

## Onde

**console.cloud.google.com → SQL → a instância (IP 35.239.247.237) → Cloud SQL Studio.**
Database `twk_auth` · User `postgres` · a senha do postgres. Abre um editor: cole, clique **Run**.
✅ Deu certo = nenhuma linha vermelha.

## Colagem 1 — o Quill deixa de usar a chave-mestra

Abra no Bloco de Notas `Agente Editorial\db\twk\roles_quill_writer.sql`, troque `'TROQUE_ESTA_SENHA'`
por uma senha longa que você inventar, copie tudo, cole, **Run**.
Depois, no arquivo `Agente Editorial\.env` **e** no Easypanel do Quill, na linha `TWK_DATABASE_URL=`,
troque `postgres:SENHA-ANTIGA` por `quill_writer:SENHA-NOVA`. Só isso na linha.

## Colagem 2 — o `twk_dba` ganha o direito de construir (ADR-017)

```sql
GRANT CREATE ON SCHEMA public TO twk_dba;
ALTER DEFAULT PRIVILEGES FOR ROLE twk_dba IN SCHEMA public GRANT SELECT ON TABLES TO twk_ro;
```
Com isso os agentes podem criar tabela e adicionar coluna pela porta (com aprovação sua por frase,
nesta primeira versão). Apagar tabela continua seu.

## Colagem 3 — o Atlas ganha usuário próprio (no banco `atlas`, não no `twk_auth`)

No Cloud SQL Studio, troque o *Database* para **`atlas`** e cole:

```sql
CREATE ROLE atlas_service LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD 'SENHA-LONGA-QUE-VOCE-INVENTAR';
GRANT CONNECT ON DATABASE atlas TO atlas_service;
GRANT USAGE ON SCHEMA public TO atlas_service;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO atlas_service;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO atlas_service;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE ON TABLES TO atlas_service;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO atlas_service;
```
Depois, em `Agente Financeiro\.env` e no Easypanel do Atlas: `DATABASE_URL=` → `atlas_service:SENHA-NOVA`.
(As migrations do Atlas, que criam tabelas, continuam rodando com `postgres` no deploy — é DDL.)

### Correção de 2026-09-22 — a colagem 3 foi executada no `twk_auth`

Verificado pelo Zelador: `atlas_service` ficou com INSERT/UPDATE nas 90 tabelas da plataforma e
CREATE no schema, e com **zero** privilégios no banco `atlas`. Desfazer (no `twk_auth`):

```sql
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM atlas_service;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM atlas_service;
REVOKE ALL PRIVILEGES ON SCHEMA public FROM atlas_service;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE SELECT, INSERT, UPDATE ON TABLES FROM atlas_service;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE USAGE, SELECT ON SEQUENCES FROM atlas_service;
REVOKE CONNECT ON DATABASE twk_auth FROM atlas_service;
```

Refazer (no banco **`atlas`**, sem a linha `CREATE ROLE` — o papel já existe):

```sql
GRANT CONNECT ON DATABASE atlas TO atlas_service;
GRANT USAGE, CREATE ON SCHEMA public TO atlas_service;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO atlas_service;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO atlas_service;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE ON TABLES TO atlas_service;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO atlas_service;
GRANT USAGE ON SCHEMA drizzle TO atlas_service;
GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA drizzle TO atlas_service;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA drizzle TO atlas_service;
```

### Complemento de 2026-09-22 — o container do Atlas não subia com `atlas_service`

O `Dockerfile` do Atlas roda `node dist/db/migrate.js && node dist/server/index.js`. O migrador do
drizzle executa, ANTES de ler o histórico, `CREATE SCHEMA IF NOT EXISTS "drizzle"` e
`CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations"` — o `IF NOT EXISTS` não dispensa a checagem
de permissão. Sem CREATE no banco e no schema, o migrate falha, o servidor nunca inicia e o Easypanel
mantém o container antigo (ainda como `postgres`). No banco **`atlas`**:

```sql
GRANT CREATE ON DATABASE atlas TO atlas_service;
GRANT CREATE ON SCHEMA drizzle TO atlas_service;
```
Depois: Deploy de novo no Easypanel. Prova: `pg_stat_activity` mostra `atlas_service` no banco `atlas`.

## Colagem 4 — fechar o que estava aberto demais (volte para `twk_auth`)

```sql
ALTER ROLE clavis_rw NOCREATEROLE NOCREATEDB;
REVOKE INSERT, UPDATE, DELETE ON public.reservations FROM clavis_rw;
ALTER ROLE clavis_ro SET default_transaction_read_only = on;
ALTER ROLE clavis_ro SET statement_timeout = '25s';
```
`vertex_readonly` também tem CREATEROLE/CREATEDB, mas é membro de um papel `cloudsql*` — pode ser do
Google. **Não mexa** sem confirmar no console de quem é.

## A conferência — a rede de segurança de catástrofe

No console: **SQL → instância → Backups**. Confira que **backups automáticos** estão ligados e que
**Point-in-time recovery** está ativado. É isso que permite voltar o banco inteiro a qualquer segundo dos
últimos 7 dias — e é a condição para dar aos agentes o poder que o ADR-017 propõe.

## Depois

Me avise. Eu rodo o Zelador: deve devolver **zero críticos**. E, se você aprovar o ADR-017 com uma frase,
escrevo `TWK_AUTONOMIA_ESCRITA=on` no seu `~/.twk/dba.env` (fora do OneDrive) e os agentes passam a apagar
contato, corrigir dado e criar conta de restaurante **sem te perguntar** — com desfazer em um comando.

## O que pode esperar

As 14 tabelas vazias que o Atlas deixou no `twk_auth` (nunca `stripe_webhook_events`, que é da
plataforma). Tem um bloco pronto que se recusa a apagar se qualquer uma tiver linha:

```sql
DO $$ DECLARE t text; n bigint; BEGIN
  FOREACH t IN ARRAY ARRAY['audit_log','fx_rates','ledger_entries','stripe_balance_transactions','stripe_charges',
    'stripe_customers','stripe_disputes','stripe_events','stripe_invoices','stripe_payouts','stripe_refunds',
    'stripe_subscription_items','stripe_subscriptions','sync_outbox'] LOOP
    IF to_regclass('public.' || t) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('SELECT count(*) FROM public.%I', t) INTO n;
    IF n > 0 THEN RAISE EXCEPTION 'public.% tem % linhas — NAO apagar sem investigar', t, n; END IF;
  END LOOP; END $$;
```
Se passar sem erro, o DROP dessas 14 é seguro — me chame e eu te passo a linha.

## Arquivo antigo

`twk-db-agent/db/roles/twk_db_agent.sql` (usuário sem DELETE para o app) foi **substituído** por este
desenho: o app usa `twk_dba`. Pode ignorar o arquivo.
