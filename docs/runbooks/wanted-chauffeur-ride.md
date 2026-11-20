# Wanted Chauffeur — a página /ride no ar, com reserva guardada e aviso ao Julien (Fase 1)

Escrito em 19/11/2026. O que a Fase 1 entrega: a página de reserva servida pela Central, a reserva inteira guardada
(quem embarca, WhatsApp, trajeto, valor, status), o Julien avisado no WhatsApp assim que o pedido chega, o Márlon
avisado quando um pedido fica 30 min sem resposta, e a agenda das 9:00 AM lendo as reservas em vez da planilha.
O cliente continua mandando a mensagem pelo botão do WhatsApp e o Julien continua respondendo no número da marca.
Fase 2 (confirmação e lembrete ao cliente por template da Meta) vem depois.

## Como funciona

1. Cliente abre `theworldkeys.com/ride?o=T` (a letra diz a rede), preenche a missão, o nome de quem embarca e o WhatsApp.
2. "Préparer le message" → a página grava a reserva na Central (`POST /api/chauffeur/reserva`) e mostra a referência.
3. A Central avisa o Julien pela Aria em 1 linha, em francês: produto, dia, hora, pessoas, valor, trajeto, nome.
4. Cliente abre o WhatsApp com a mensagem pronta (a mesma referência) e manda ao número da marca.
5. Julien responde com hora, nome e valor. O Márlon marca `confirmado` no painel `/chauffeur` pelo código.
6. Pedido 30 min sem status → aviso ao Márlon. Às 9:00 AM, agenda do dia ao Julien com os confirmados.

## Ligar (Lucas + fundador, ~20 minutos)

1. **Deploy da Central** (build 4.9.0): Easypanel, Build Path `/orchestrator`, Dockerfile `command-center/Dockerfile`, Deploy.
   Conferir em `/health`: `build` começa com `4.9.0` e `wanted_chauffeur.reservas` diz `arquivo`.
2. **Domínio.** Duas opções; a primeira é a recomendada:
   - **Rewrite no front** (theworldkeys.com, Next.js): em `next.config.js`, `rewrites()` com duas linhas,
     `{ source: '/ride', destination: 'https://<central>/ride' }` e `{ source: '/api/chauffeur/:path*', destination: 'https://<central>/api/chauffeur/:path*' }`.
     A página e a gravação ficam no mesmo domínio; nada de CORS. (Suposição: o front usa `next.config` padrão; conferir.)
   - **Subdomínio direto**: no Easypanel, adicionar `ride.theworldkeys.com` ao serviço da Central (e o CNAME no DNS).
     Nesse caso os links da bio apontam para `https://ride.theworldkeys.com/?o=T` e a Central precisa de
     `CHAUFFEUR_PAGINA=https://ride.theworldkeys.com/` para o painel mostrar os links certos.
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
