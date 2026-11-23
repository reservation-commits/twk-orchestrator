# Wanted Chauffeur — a página /ride no ar, com reserva guardada e aviso ao Julien (Fase 1)

Escrito em 19/11/2026. O que a Fase 1 entrega: a página de reserva servida pela Central, a reserva inteira guardada
(quem embarca, WhatsApp, trajeto, valor, status), o Julien avisado no WhatsApp assim que o pedido chega, o Márlon
avisado quando um pedido fica 30 min sem resposta, e a agenda das 9:00 AM lendo as reservas em vez da planilha.
O cliente continua mandando a mensagem pelo botão do WhatsApp e o Julien continua respondendo no número da marca.
Fase 2 (confirmação e lembrete ao cliente por template da Meta) vem depois.

## O que falta para o site novo ir ao ar (verificado em 23/11/2026)

**Estado lido em produção** (`/health` público da Central e as URLs abaixo, 23/11):

| Item | Hoje |
|---|---|
| Central no ar | build `4.12.0`: ainda serve a página antiga em `/ride`, com "Léa Martin" e "Place du Capitole" pré-preenchidos |
| Site em pastas + agenda (build `4.13.0`) | commitado e **não enviado ao GitHub** (3 commits à frente); `/ride/js/main.js` e `/api/chauffeur/disponibilidade` ainda não existem lá |
| `theworldkeys.com/ride` | 404: o rewrite no site principal não foi feito |
| Aviso ao Julien e ao Márlon | `off` (sem `ARIA_TEAM_ALERT_SECRET`); a vigia roda a cada 5 min mas não consegue avisar |
| Link de confirmar do Julien | `off` (sem `CHAUFFEUR_CONFIRMA_URL` e segredo) |
| Confirmação e lembretes ao cliente | `off` (sem `WC_WA_*`); templates `wc_ride_confirmed` e `wc_ride_reminder` APPROVED desde 20/11 |
| Agenda das 9:00 AM | desligada (sem `CHAUFFEUR_AGENDA=on`) |
| Reservas | no volume da Central (`arquivo`); funciona, banco opcional |

**Em ordem:**

1. **Enviar os commits ao GitHub** (Márlon ou Claude, com o ok do Márlon): `git push` na raiz do repositório.
2. **Deploy da Central** (Easypanel, quem tem acesso): Build Path `/orchestrator`, Dockerfile `command-center/Dockerfile`.
   Pronto quando `/health` mostra `build` começando com `4.13` e `https://theworldkeys-maestro.xis4ee.easypanel.host/ride/js/main.js` abre um arquivo JavaScript, não a página.
3. **Variáveis no Easypanel da Central**, todas de uma vez, e Deploy de novo:
   - `ARIA_TEAM_ALERT_SECRET` = o `TEAM_ALERT_SECRET` do serviço da Aria. Na Aria, `TEAM_ALERT_TO` precisa ter `julien=+33…` e `marlon=+…`.
   - `CHAUFFEUR_CONFIRMA_URL=https://theworldkeys-maestro.xis4ee.easypanel.host` e `CHAUFFEUR_CONFIRMA_SECRET` = uma frase longa qualquer.
   - `WC_WA_TOKEN` e `WC_WA_PHONE_NUMBER_ID` = os `WHATSAPP_ACCESS_TOKEN` e `WHATSAPP_PHONE_NUMBER_ID` da Aria (decisão de 20/11: número da TWK).
   - `WC_TEMPLATE_CONFIRMED=wc_ride_confirmed` e `WC_TEMPLATE_REMINDER=wc_ride_reminder`.
   - `CHAUFFEUR_AGENDA=on`.
   Pronto quando `/health` → `wanted_chauffeur` mostra `aviso_julien: on`, `link_confirmar: on`, `cliente: on`, e `rotinas.agenda_julien` deixa de ser `null`.
4. **Rewrite no site principal** (Lucas, theworldkeys.com em Next.js): três linhas em `next.config.js`, `/ride`, `/ride/:path*` e
   `/api/chauffeur/:path*` para a Central (código pronto no README do site, `orchestrator/sites/wanted-chauffeur-ride/README.md`).
   Pronto quando `https://theworldkeys.com/ride` abre a página e a faixa de dias aparece.
5. **Do Julien** (perguntas, não cards): confirmar quanto tempo cada produto ocupa (Transfer 1 h 30, Night Ride 1 h,
   Game Night 3 h, Soirée 5 h são suposição); passar as folgas dele, que o Márlon marca em `/chauffeur` → Agenda; confirmar se o
   número na página continua o dele (+33 7 81 93 72 70) ou passa ao número novo da marca (`public/js/config.js`).
6. **Do fundador com o advogado:** textos de Mentions légales e Conditions de réservation (hoje links vazios no rodapé).
7. **Links nas bios e QR dos hotéis**, só depois do passo 4: `https://theworldkeys.com/ride?o=I` (Instagram), `?o=T` (TikTok),
   `?o=H` (cartão e QR dos hotéis). Lista pronta em `/chauffeur` → Links por rede.
8. **Teste de ponta a ponta:** pedido com o seu WhatsApp em `theworldkeys.com/ride` → aviso chega ao Julien com o link → ele
   confirma → a confirmação chega no seu celular → o horário aparece ocupado na página. Marcar `cancelado` no painel depois.

**Opcional, sem pressa:** frase do fundador para as tabelas no banco (`chauffeur-reservas.sql`), depois
`CHAUFFEUR_RESERVAS_BANCO=on` e `migrar.js --apply`. Até lá as reservas ficam no volume, que é persistente.

**Lacunas conhecidas, não bloqueiam:** resposta do cliente ao template cai na conversa da Aria (ela ainda não reconhece a
referência `WTD-`); pedido de hotel não recebe cópia (o formulário não pede o contato do hotel).

## Como funciona

1. Cliente abre `theworldkeys.com/ride?o=T` (a letra diz a rede), preenche a missão, o nome de quem embarca e o WhatsApp.
2. "Préparer le message" → a página grava a reserva na Central (`POST /api/chauffeur/reserva`) e mostra a referência.
3. A Central avisa o Julien pela Aria em 1 linha, em francês: produto, dia, hora, pessoas, valor, trajeto, nome.
4. Cliente abre o WhatsApp com a mensagem pronta (a mesma referência) e manda ao número da marca.
5. Julien responde com hora, nome e valor. O Márlon marca `confirmado` no painel `/chauffeur` pelo código.
6. Pedido 30 min sem status → aviso ao Márlon. Às 9:00 AM, agenda do dia ao Julien com os confirmados.

## Ligar (Lucas + fundador, ~20 minutos)

1. **Deploy da Central** (build 4.13.0 ou depois): Easypanel, Build Path `/orchestrator`, Dockerfile `command-center/Dockerfile`, Deploy.
   Conferir em `/health`: `build` começa com `4.13` e `wanted_chauffeur.reservas` diz `arquivo`.
2. **Domínio.** Desde 22/11 o site é um projeto próprio em `orchestrator/sites/wanted-chauffeur-ride/`, e o
   [README dele](../../orchestrator/sites/wanted-chauffeur-ride/README.md) tem as três formas de hospedar. A recomendada:
   **rewrite no front** (theworldkeys.com, Next.js), com três linhas em `next.config.js`: `/ride`, `/ride/:path*` e
   `/api/chauffeur/:path*` apontando para a Central. A página mora no caminho `/ride/` (os arquivos são citados como
   `/ride/css/…`); num subdomínio, ela fica em `https://ride.theworldkeys.com/ride` e a Central precisa de
   `CHAUFFEUR_PAGINA` com esse endereço para o painel mostrar os links certos.
3. **Aviso ao Julien** (Aria): `TEAM_ALERT_TO` da Aria com `julien=+33…` e `marlon=+…`; na Central,
   `ARIA_TEAM_ALERT_SECRET=<o TEAM_ALERT_SECRET da Aria>` (se o Olheiro já usa, já está lá). Sem o segredo a reserva
   é gravada do mesmo jeito e o painel mostra a lacuna.
4. **Agenda das 9:00 AM**: `CHAUFFEUR_AGENDA=on` (já lê as reservas; não precisa de planilha). `ROTINAS_ENABLED=on` já está.
5. **Teste de ponta a ponta**: abrir `/ride?o=T`, mandar um pedido com nome "Teste" → ele aparece em `/chauffeur`
   com ✓ ao lado do código (Julien avisado) e o Julien recebe a linha no WhatsApp. Marcar `cancelado` no painel.

Variáveis opcionais na Central: `CHAUFFEUR_ORIGINS` (padrão theworldkeys.com e www), `CHAUFFEUR_TETO_HORA=30`,
`CHAUFFEUR_PENDENTE_MIN=30`, `CHAUFFEUR_PENDENTE_PARA=marlon`, `CHAUFFEUR_AVISO_NOVA=off` (desliga o aviso ao Julien),
`CHAUFFEUR_VIGIA=off` (desliga a vigia).

## Passar as reservas para o banco (quando o fundador der a frase)

1. `node orchestrator/agents/dba-escrita/executar.js orchestrator/agents/dba-escrita/exemplos/chauffeur-reservas.sql --apply`
   (CREATE TABLE em `public`: exige a frase e o `GRANT CREATE` ao `twk_dba`; ADR-017).
2. Na Central: `CHAUFFEUR_RESERVAS_BANCO=on` (o `TWK_DBA_URL` já existe) e Deploy. `/health` passa a dizer `banco`.
3. Dentro do container (ou local com `TWK_DBA_URL` e o volume): `node agents/wanted-chauffeur/migrar.js --dir /app/state/agents/wanted-chauffeur --apply`.
   Rodar duas vezes não duplica. Limite conhecido: `criado_em` fica com a data da migração no banco.

## Fase 2 (código pronto em 19/11): o Julien confirma por link, o cliente recebe no WhatsApp

Como fica o fluxo: o aviso ao Julien leva um link → ele abre a ficha no celular e toca "Confirmer la course" → o status vira
`confirmado` e o cliente recebe a confirmação por escrito (template `wc_ride_confirmed`, FR ou EN) → na véspera às 8:00 PM e
2 h antes o cliente recebe o lembrete (`wc_ride_reminder`) e o Julien recebe a linha "Dans 2 h : …" pela Aria. Marcar
`confirmado` no painel tem o mesmo efeito. Tudo uma vez por reserva, registrado na ficha (letras J, C, V, 2h no painel).

Ligar, nesta ordem:

1. **Templates na Meta** (fundador aprova o texto; Lucas ou eu rodamos): `docs/notificacoes/templates-meta-wc-cliente-2026-11-19.md`.
   `node orchestrator/agents/notificacao-reserva/meta-templates.mjs --doc docs/notificacoes/templates-meta-wc-cliente-2026-11-19.md --lang fr,en --apply`
   e depois `--status` até `APPROVED` (normalmente no mesmo dia; UTILITY).
2. **Link de confirmar**, na Central: `CHAUFFEUR_CONFIRMA_URL=https://<endereço público da Central>` e
   `CHAUFFEUR_CONFIRMA_SECRET=<uma frase longa qualquer>` (sem ela, usa o `CENTER_TOKEN`). `/health` → `wanted_chauffeur.link_confirmar: on`.
3. **Canal da Meta**, na Central: `WC_WA_TOKEN` e `WC_WA_PHONE_NUMBER_ID` (os mesmos `WHATSAPP_TOKEN` / `WHATSAPP_PHONE_NUMBER_ID`
   da Aria, ou os de um número só da marca na mesma conta de negócios), `WC_TEMPLATE_CONFIRMED=wc_ride_confirmed`,
   `WC_TEMPLATE_REMINDER=wc_ride_reminder`. Deploy. `/health` → `wanted_chauffeur.cliente: on`.
4. **Teste**: pedido de teste com o seu WhatsApp → abrir o link do aviso → "Confirmer" → a confirmação chega no seu celular;
   no painel a linha ganha J e C. Marcar `cancelado` depois.

**Decisão do fundador (20/11/2026): o número da TWK, o mesmo da Aria.** O cliente vê "The World Keys" como remetente e o rodapé
do template diz "Wanted Chauffeur · The World Keys · Toulouse". Os valores de `WC_WA_TOKEN` e `WC_WA_PHONE_NUMBER_ID` são os mesmos
`WHATSAPP_ACCESS_TOKEN` e `WHATSAPP_PHONE_NUMBER_ID` do serviço da Aria no Easypanel (copiar de lá; nunca no chat). Templates
`wc_ride_confirmed` e `wc_ride_reminder` APPROVED em FR e EN em 20/11. Consequência: a resposta do cliente ao template cai na
conversa da Aria; até ela reconhecer a referência WTD-, trata como mensagem comum.

## O que ainda não existe

- Cópia da confirmação ao hotel (origem H): o formulário não pede o contato do hotel.
- Resposta do cliente ao template cai no número que enviou (o da TWK, se for o da Aria), não no do Julien: a Aria precisa
  reconhecer a referência `WTD-` e encaminhar; até lá, o cliente que responder ao template é atendido pela Aria como qualquer mensagem.
- Mentions légales e Conditions de réservation no rodapé ainda são links vazios (fundador + advogado).

## Testar sem mandar nada

Local: `.claude/launch.json` → `central-dev` (`http://localhost:8788/ride?o=T`, painel em `/chauffeur`, estado numa
pasta temporária). Os avisos só saem se `ARIA_TEAM_ALERT_SECRET` estiver no ambiente; sem ele, a reserva grava e a
ficha registra `nova_reserva_falhou`. Testes: `node --test "test/*.test.js"` em `orchestrator/agents/wanted-chauffeur`
e `node --test "regencia/test/chauffeur.test.js"` em `orchestrator/command-center`.
