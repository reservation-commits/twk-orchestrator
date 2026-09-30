# Especificação para o desenvolvedor — conta de estabelecimento (30/09/2026)

Contexto: `manager.theworldkeys.com/register` (fluxo "My restaurant is already on the site") gera e verifica códigos (`public.listing_claim_challenges`: 24 gerados, 17 verificados, 11 consumidos), mas **nenhuma conta de estabelecimento existe**: `public.restaurant_users` está vazia e todos os 23.083 usuários de `nextauth."User"` têm `role = 'CUSTOMER'`. O enum `nextauth."UserRole"` já contém `ESTABLISHMENT`.

## A. Consumo do código (claim de listagem existente)
Ao validar o código (`verified_at`) e o formulário de dados:
1. `nextauth."User"`: criar o usuário se não existir (e-mail do formulário) **ou** promover o existente; em ambos os casos `role = 'ESTABLISHMENT'`, `emailVerified = now()`.
2. `public.restaurant_users`: `INSERT (user_id, restaurant_id, role, is_primary, permissions) VALUES (<user>, <restaurant_id do challenge>, 'owner', true, '{"all":true}')` — idempotente por `(user_id, restaurant_id)`.
3. `listing_claim_challenges.consumed_at = now()` **na mesma transação** dos itens 1–2. Hoje há códigos consumidos sem conta: consumo sem conta é o defeito.
4. Redirecionar para o painel já com o restaurante selecionado. Critério de aceite: `SELECT count(*) FROM restaurant_users` aumenta em 1 e o painel mostra os pedidos pendentes da casa.

## B. Auto-aprovação
Claim com código verificado no e-mail da listagem **não passa por revisão**. Revisão só para `application_type = 'new'`. Remover o aviso "Our team still reviews every request" do fluxo de claim.

## C. Aprovação de candidatura (fluxo com revisão)
Ao mudar `restaurant_invitations.status` para `approved`: criar o usuário (A.1), vincular (A.2) e disparar `POST https://theworldkeys-n8n.xis4ee.easypanel.host/webhook/reset-password` com `{ email, name, resetUrl }` (fluxo existente e verificado) para definir a senha. Caso Eleos (05/09): aprovado e nunca avisado; expirou em 23/09.

## D. E-mail da listagem indisponível
No passo do código: opção *"I don't have access to this email"* → verificação alternativa pelo **telefone da listagem** (`db_restaurants.telephone_of_the_establishment`): código por WhatsApp/SMS quando for celular, ou ticket para o suporte (Aria) ligar e confirmar. Registrar em `listing_claim_challenges` com um campo `channel` (`email` | `phone` | `support`). Sem isso, 4 das 25 casas de Lagos (e-mails devolvidos) e as casas com e-mail genérico não conseguem entrar.

## E. Migração única — vincular quem já se registrou com o e-mail da casa
Arquivo: `docs/estrategia/sql/vincular-contas-existentes.sql` (proposta; execução humana — escreve em `nextauth`). Regra: usuário cujo e-mail (minúsculo) = `email_for_reservations` de um restaurante **publicado** → `role = 'ESTABLISHMENT'` + linha em `restaurant_users` (`owner`, `is_primary`). Excluir e-mails internos da TWK e os dois registros de teste (`restaurante teste`, `74`). Depois: e-mail de "definir senha" (C) para cada um — ou, se já têm senha (entraram como cliente), apenas o aviso com o link do painel.

## F. Landing do manager
Remover *"Trusted by hundreds of restaurants around the world."* (0 contas reais). Substituir por uma frase verdadeira: número de pedidos de mesa encaminhados nos últimos 90 dias (963) ou nada.

## G. Observabilidade (para a Sentinela)
Nada a criar: a Sentinela passa a vigiar `listing_claim_challenges.verified_at IS NOT NULL AND consumed_at IS NULL AND created_at < now() - interval '24 hours'` e `restaurant_invitations.status = 'approved' AND completed_at IS NULL AND created_at < now() - interval '24 hours'`. Cada dono travado vira alerta no dia.

## Teste de aceitação (fundador, 5 minutos)
1. Fazer o claim de uma listagem de teste com um e-mail de teste → conta criada, `role = ESTABLISHMENT`, `restaurant_users` +1, painel com o restaurante.
2. Criar um pedido de mesa de teste → aparece no painel; com o WhatsApp marcado, chega o template `twk_venue_new_request`.
3. Rodar `node orchestrator/agents/chave-girada/observar-cadastro.js` antes e depois: a contagem de contas muda.
