# Cadrage para o front — Chave Girada e segurança do `/r/` (2026-09-03)

> Para quem não participou da sessão. Cada item tem: onde, o que, critério de aceite, prioridade. Fonte dos achados: páginas reais vistas em 03/09 (`manager.theworldkeys.com`, `/register`, `theworldkeys.com/r/GYWUQ7PG`) e workflows n8n lidos por dentro. Plano completo: `docs/agentes/PLANO-CHAVE-GIRADA.md`.

## P0 — Segurança (esta semana)

### 1. `/r/{código}`: reserva passada ou expirada não pode ser acionável, e o contato do cliente só aparece depois do aceite
- **Onde:** `theworldkeys.com/r/{reservation_code}` (página de resposta do restaurante, sem login).
- **Achado:** em 03/09, `GYWUQ7PG` (mesa 02/09 19:00, já passada) mostrava **Accept / Decline / Propose Reschedule ativos** e **nome, e-mail e telefone do cliente** a qualquer portador do link. O código tem 8 caracteres e circula por e-mail para caixas que sabemos comprometidas (JOAQUINA: bounce em domínio de terceiros). GDPR art. 32.
- **Fazer:** (a) se `booking_date + reservation_time` < agora (fuso do restaurante) **ou** `expired_at IS NOT NULL` **ou** `booking_status ∉ {Pending, In Treatment}` → renderizar só leitura, com estado ("Esta solicitação expirou em …" / "Respondida em …"), sem botões; (b) contato do cliente (e-mail, telefone) só após `Accept` — antes, mostrar só primeiro nome e nº de pessoas; (c) registrar acesso (`reservation_code`, ip hash, ts) em log; (d) opcional: token assinado com expiração no link em vez do código puro.
- **Aceite:** `GET /r/GYWUQ7PG` → 200 sem botões e sem e-mail/telefone; `POST` de ação em reserva expirada → 409; reserva viva → comportamento atual **até** o aceite, contato revelado depois.

## P1 — Conversão (esta semana; 3 strings + 1 botão)

### 2. Trocar "The World's Kitchen" por "The World Keys" no `/register`
- **Onde:** `manager.theworldkeys.com/register`, texto *"Claim a listing already on The World's Kitchen, or request a new one."*
- **Aceite:** nenhuma ocorrência de "World's Kitchen" no manager (grep no bundle).

### 3. Tirar "Trusted by hundreds of restaurants around the world" da landing do manager
- **Onde:** `manager.theworldkeys.com` (coluna esquerda, sob os 3 bullets).
- **Achado:** são 0 contas reais de restaurante (`restaurant_users` = 2 linhas internas). O Dossiê já tirou a frase do site principal.
- **Fazer:** substituir por algo verdadeiro — *"Partner program · beta by invitation"* — ou remover.
- **Aceite:** frase ausente.

### 4. Botão "Ativar minha chave" na tela de agradecimento do `/r/` após Accept/Decline
- **Onde:** estado pós-ação do `/r/{código}`.
- **Fazer:** bloco com o mesmo texto do e-mail (`orchestrator/agents/chave-girada/n8n/establishment-cta-chave.html`): *"Você acabou de responder pelo link. Com a sua chave, isso vira um toque no celular."* → `manager.theworldkeys.com/register?claim={restaurant_id}` (ver item 6) ou `/register` se o 6 não existir. Idioma da casa (`db_restaurants.country`).
- **Aceite:** após qualquer ação no `/r/`, o botão aparece; clique registrado (evento `claim_cta_click`, com `restaurant_id`) — é o KPI do movimento 1.

## P2 — Recompensa e atrito (semanas 2–3)

### 5. Selo "Responde rápido" na página pública e conserto do selo de parceiro
- **Onde:** `theworldkeys.com/hospitality/{slug}/` (cabeçalho da ficha) e listagens.
- **Regra do selo (dado real, recalculado semanal):** casa com ≥4 pedidos em 180 dias **e** (aceitos+recusados)/pedidos ≥ 0,5. SQL de referência:
  ```
  WITH d AS (SELECT DISTINCT ON (customer_id, booking_date, reservation_time) restaurant_id, booking_status
             FROM reservations WHERE created_date >= now() - interval '180 days'
             ORDER BY customer_id, booking_date, reservation_time, created_date)
  SELECT restaurant_id FROM d GROUP BY 1
  HAVING count(*) >= 4 AND count(*) FILTER (WHERE booking_status IN ('Accept','Decline'))::float / count(*) >= 0.5;
  ```
  Hoje: 14 casas. Materializar em coluna `responde_rapido boolean` (job semanal) ou view.
- **Selo de parceiro (Dossiê 08):** hoje travado em falso no código; passar a ler `db_restaurants.partner`.
- **Aceite:** ATHÉNÉE (58502) exibe o selo; uma casa que nunca respondeu não exibe; MONAK exibe selo de parceiro.

### 6. Chave pré-girada: `restaurant_invitations` como link direto
- **Onde:** fluxo "My restaurant is already on the site" do `/register`.
- **Achado:** tabela `restaurant_invitations` existe (token, `public_listing_slug`, `suggested_listing_email`, `listing_email_status`) e tem **1 linha de uso** (WOO TENDER, 31/08, `pending`). O front não parece aceitar o token por URL.
- **Fazer:** `GET /register?claim=<token>` pré-seleciona "already on the site", preenche o restaurante e o e-mail de cadastro (mascarado), e envia o código ao clicar. Backoffice: endpoint interno para o time emitir tokens por `restaurant_id` (ou o Guardião/CLAVIS propõe e o DBA insere, sob aprovação).
- **Aceite:** um token emitido para a ATHÉNÉE leva a um formulário onde só falta pedir o código e definir a senha.

### 7. `published=false` → 404 em `/hospitality/{slug}/` (já pedido em 02/09; repetido aqui porque é a mesma sprint)
- **Achado:** DIOR DES LICES, DAL BOLOGNESE e NODAIWA AZABU IIKURA HONTE estão despublicadas e seguem recebendo pedidos. O banco já impede republicação (trigger `listing_consent`); só o front tira a página do ar.
- **Aceite:** `GET /hospitality/canete/` → 404.

## Fora do front (para o mesmo sprint, outros donos)

- **n8n** (fundador cola, eu preparei): template TWK do e-mail de código — `orchestrator/agents/chave-girada/n8n/listing-otp-template-TWK.html`; bloco "Ativar minha chave" nos nós Establishment (Accept)/(Decline) do fluxo 3 — `orchestrator/agents/chave-girada/n8n/establishment-cta-chave.html`.
- **Site principal** (Dossiê 05): página "Para restaurantes" com link no rodapé e "É o dono deste estabelecimento?" em cada ficha — continua sendo a porta que falta para quem **não** responde.
