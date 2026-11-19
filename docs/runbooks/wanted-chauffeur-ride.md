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

## O que a página NÃO faz ainda (Fase 2)

- Não manda nada ao cliente: a confirmação e o lembrete por template da Meta precisam de 2 ou 3 templates aprovados.
- O Julien não confirma por link: o status é marcado pelo Márlon no painel.
- Mentions légales e Conditions de réservation no rodapé ainda são links vazios (fundador + advogado).

## Testar sem mandar nada

Local: `.claude/launch.json` → `central-dev` (`http://localhost:8788/ride?o=T`, painel em `/chauffeur`, estado numa
pasta temporária). Os avisos só saem se `ARIA_TEAM_ALERT_SECRET` estiver no ambiente; sem ele, a reserva grava e a
ficha registra `nova_reserva_falhou`. Testes: `node --test "test/*.test.js"` em `orchestrator/agents/wanted-chauffeur`
e `node --test "regencia/test/chauffeur.test.js"` em `orchestrator/command-center`.
