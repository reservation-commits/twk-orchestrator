# Cadrage para o front — a porta do cadastro (2026-09-16)

> Para quem não participou da sessão. Contexto: dossiê `docs/TWK-Dossie-Chave-na-Mao.html` (15/09). Em cinco semanas, 185 e-mails a 148 restaurantes deram 0 contas; a única candidatura real (ELEOS) travou no produto. Antes de qualquer visita ou envio, o cadastro precisa passar no **teste de aceite** do fim deste documento. Estado verificado ao vivo em 15/09 22h UTC: `manager.theworldkeys.com/register` ainda diz "The World's Kitchen"; a landing ainda diz "Trusted by hundreds"; `theworldkeys.com` não tem nenhuma entrada para restaurantes. Sucede o `CADRAGE-FRONT-CHAVE-GIRADA.md` (03/09); o que lá era P0 continua P0.

Ordem = impacto sobre esforço. Cada item tem onde, o quê, por quê e critério de aceite.

## 1. Link pré-verificado por casa (`/register?claim=<token>`) — 1 a 2 dias

- **Onde:** `manager.theworldkeys.com/register`, fluxo "My restaurant is already on the site".
- **O quê:** aceitar `?claim=<token>` de `restaurant_invitations.token`. Com token válido (`status in ('pending','approved')`, `expires_at > now()`, `completed_at is null`): pré-selecionar "already on the site", preencher restaurante (`public_listing_slug`) e e-mail de cadastro; pedir o código só se `listing_email_status <> 'verified'`; senha por último. Backoffice: endpoint interno para o time emitir token por `restaurant_id` (ou o DBA insere por `executar.js`, sob aprovação).
- **Por quê:** Google, Yelp e Stripe pré-preenchem e verificam contra o que já está na listagem; senha depois. Formulário de 7 para 3 campos: −44,7% de abandono (UXCam 2026).
- **Aceite:** um token emitido para a ATHÉNÉE (58502) abre um formulário onde só falta confirmar e criar a senha. Token vencido → mensagem "este link expirou; peça outro respondendo ao e-mail", nunca tela genérica.

## 2. Verificação alternativa por WhatsApp do número da listagem — 0,5 dia (processo + 1 campo)

- **O quê:** no backoffice, marcar `listing_email_status = 'verified'` e gravar `evidence_ref` quando a casa confirmar por mensagem enviada **do número que está no catálogo** (`telephone_of_the_establishment`). Nenhum código por e-mail nesse caso.
- **Por quê:** 26 casas com e-mail morto, 262 com e-mail gratuito, 19 domínios compráveis (AUDITORIA-CADASTRO, 06/09). Yelp verifica pelo telefone da listagem. Fecha a falha de segurança e destrava a ativação presencial.
- **Aceite:** uma casa sem e-mail válido conclui o cadastro sem código; o registro de quem verificou, quando e com que prova fica em `restaurant_invitations`.

## 3. Marca, verdade e idioma — 0,5 dia

- **O quê:** (a) "Claim a listing already on The World's Kitchen" → "The World Keys"; (b) remover "Trusted by hundreds of restaurants around the world" da landing (substituir por "Partner programme · beta by invitation" ou nada); (c) `/register` e o e-mail do código no idioma da casa (PT primeiro; `db_restaurants.country_code`), inglês como fallback.
- **Por quê:** remetente, link e página com marcas diferentes leem como phishing; 55% dos compradores B2B só compram em idioma nativo (CSA Research). Nos EUA prova social falsa já é infração (regra FTC, out/2024).
- **Aceite:** `grep -ri "World's Kitchen"` no bundle vazio; a frase "Trusted by hundreds" ausente; `/register?lang=pt` renderiza em português.

## 4. Primeira tela = os dados da casa — 1 dia

- **O quê:** ao entrar pela primeira vez, o painel abre em "Os seus 90 dias na The World Keys": pedidos recebidos, confirmados, sem resposta, e os pedidos **vivos** (`expired_at is null`, `booking_status in ('Pending','In Treatment')`) no topo, com Accept/Decline.
- **Por quê:** 84% abandonam um painel vazio na primeira sessão (Chameleon). Os dados existem.
- **Aceite:** Casa do Prego (69949) vê 87 / 0 / 79 e o pedido vivo, sem nenhum clique.

## 5. Aprovação sem beco — 0,5 dia + teste

- **O quê:** (a) candidatura com posse provada (código ou WhatsApp) entra na hora, sem revisão manual; (b) confirmar com teste ponta a ponta que a aprovação manual dispara o e-mail de senha (existe desde 06/09) e que o link sobrevive ao canal (compensação quoted-printable no n8n, verificada em 07/09); (c) prazo de convite: 7 dias, com e-mail automático 24h antes de vencer e renovação em um clique no backoffice.
- **Por quê:** gate manual sem prazo comunicado é a causa documentada de abandono em marketplaces (Tipalti). O ELEOS venceu e ficou.
- **Aceite:** um dono fictício, a partir de um e-mail, chega ao painel em menos de cinco minutos sem ajuda de ninguém.

## 6. Porta no site do cliente — 0,5 dia

- **O quê:** em cada ficha `theworldkeys.com/hospitality/{slug}/`, linha discreta "É o dono deste estabelecimento? Assuma a sua página" → `/register?slug={slug}`; no rodapé do site, "Para restaurantes". Registrar o clique (`claim_cta_click`, `restaurant_id`).
- **Por quê:** é o mecanismo do Google e do Yelp: o link fica onde o dono já se procura. Hoje a única porta é o botão nos e-mails de pedido.
- **Aceite:** a ficha da Casa do Prego mostra o link; o clique aparece no log.

## 7. Segurança do `/r/{código}` — 1 dia (P0 desde 03/09, ainda aberto em 07/09)

- **O quê:** reserva com `booking_date + reservation_time` passado, `expired_at` preenchido ou status fora de Pending/In Treatment → só leitura, sem botões; contato do cliente (e-mail, telefone) só **depois** do Accept; log de acesso.
- **Por quê:** dado pessoal exposto sem login (GDPR art. 32); caso FBV36VR8 confirmado em 07/09.
- **Aceite:** `GET /r/FBV36VR8` → 200 sem botões e sem e-mail/telefone; `POST` de ação em reserva vencida → 409.

## Fora do front, mesma sprint

- **n8n:** e-mail do código já está na marca TWK (03/09); conferir que sai no idioma da casa. Aria e CLAVIS ainda sem a compensação quoted-printable nos nós de envio (07/09).
- **Banco (DBA, sob aprovação):** renovar convite do ELEOS (`orchestrator/state/proposta-eleos-renovar-convite-2026-09-16.sql`); bloquear envio de código às 26 casas com e-mail morto.

## Teste de aceite da porta (bloqueante para visita e envio)

Uma pessoa de fora do time, a partir de um link recebido por WhatsApp, chega ao painel com a página pronta e os próprios números, em português, em menos de cinco minutos, sem ninguém ajudar. Enquanto isso não passar, ninguém viaja e nenhum e-mail sai.
