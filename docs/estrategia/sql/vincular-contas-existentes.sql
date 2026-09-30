-- PROPOSTA (não executada) — vincular à sua casa quem já se registrou com o e-mail da listagem.
-- Execução HUMANA: escreve em nextauth."User" (constituição: nextauth é exclusivamente humano).
-- Antes de rodar: backup das duas tabelas; conferir a lista da etapa 1 e remover o que não for dono.
-- Ordem: 1) revisar candidatos · 2) BEGIN · 3) promover papel · 4) vincular · 5) conferir · 6) COMMIT.

-- 1) Candidatos (leitura): usuário cujo e-mail = e-mail de reservas de restaurante PUBLICADO, sem vínculo ainda.
SELECT u.id AS user_id, d.restaurant_id, d.name AS restaurante, d.city, u."createdAt"::date AS usuario_desde
  FROM nextauth."User" u
  JOIN db_restaurants d ON lower(d.email_for_reservations) = lower(u.email)
 WHERE d.published
   AND u."deactivatedAt" IS NULL
   AND NOT EXISTS (SELECT 1 FROM restaurant_users ru WHERE ru.user_id = u.id AND ru.restaurant_id = d.restaurant_id)
   AND d.name NOT IN ('restaurante teste', '74')          -- registros de teste
   AND lower(u.email) NOT LIKE '%@theworldkeys.com'        -- internos
 ORDER BY u."createdAt" DESC;

-- 2) Aplicar (mesma lista, mesma transação)
BEGIN;

-- 3) Papel de estabelecimento
UPDATE nextauth."User" u
   SET role = 'ESTABLISHMENT', "updatedAt" = now()
  FROM db_restaurants d
 WHERE lower(d.email_for_reservations) = lower(u.email)
   AND d.published AND u."deactivatedAt" IS NULL
   AND d.name NOT IN ('restaurante teste', '74')
   AND lower(u.email) NOT LIKE '%@theworldkeys.com'
   AND u.role <> 'ESTABLISHMENT';

-- 4) Vínculo usuário ↔ restaurante (dono principal)
INSERT INTO restaurant_users (user_id, restaurant_id, role, is_primary, permissions, created_at, updated_at)
SELECT u.id, d.restaurant_id, 'owner', true, '{"all": true}'::jsonb, now(), now()
  FROM nextauth."User" u
  JOIN db_restaurants d ON lower(d.email_for_reservations) = lower(u.email)
 WHERE d.published AND u."deactivatedAt" IS NULL
   AND d.name NOT IN ('restaurante teste', '74')
   AND lower(u.email) NOT LIKE '%@theworldkeys.com'
   AND NOT EXISTS (SELECT 1 FROM restaurant_users ru WHERE ru.user_id = u.id AND ru.restaurant_id = d.restaurant_id);

-- 5) Conferir antes de confirmar
SELECT (SELECT count(*) FROM restaurant_users) AS vinculos,
       (SELECT count(*) FROM nextauth."User" WHERE role = 'ESTABLISHMENT') AS usuarios_estabelecimento;

-- 6) COMMIT;   (ou ROLLBACK; se os números não baterem com a lista da etapa 1)
