# Wanted Chauffeur — ferramentas de operação

Ferramentas (não conteúdo: roteiros, legendas e ideias são do Julien). Escritas em 18/11/2026 para os cards do COMPASSO; **Fase 1 (19/11): a página /ride servida pela Central, a reserva inteira guardada, o Julien avisado na hora.** Como ligar: `docs/runbooks/wanted-chauffeur-ride.md`.

## 1. A página `/ride` e as reservas (Fase 1)

| Peça | Onde | O que faz |
|---|---|---|
| Página pública | `orchestrator/command-center/public/ride/` (`index.html`, `ride.js`, `bd.webp`) | a página de reserva em francês, servida pela Central em `/ride` (sem chave). Lê a origem pelo link (`?o=T`…), monta a mensagem do WhatsApp com a referência `WTD-<letra>-XXXX` e, ao clicar em "Préparer le message", **grava a reserva na Central** antes de abrir o WhatsApp. Se a gravação falhar, o cliente ainda abre o WhatsApp (a referência vai na mensagem). Script externo porque a Central tem CSP `script-src 'self'` |
| Reservas | `reservas.js` | o único lugar onde a reserva mora: código, origem, produto, data, hora (AM/PM), pessoas, horas, partida, destino, **nome de quem embarca, WhatsApp** (normalizado, `+33…`), recado, caixa de imagens, `valor_cent` (centavos, tabela de 16/11), status por evento (append-only). Dois modos com a mesma interface: **arquivo** (`STATE_DIR/agents/wanted-chauffeur/reservas.jsonl` + `reservas-eventos.jsonl` + `nao-contatar.jsonl`, o modo de hoje) e **banco** (tabelas `chauffeur_reservas`, `_eventos`, `_nao_contatar`; liga com `CHAUFFEUR_RESERVAS_BANCO=on` depois da DDL). `anonimizar(365)` apaga a pessoa 12 meses depois da corrida |
| Rotas | `orchestrator/command-center/chauffeur.js` | **POST `/api/chauffeur/reserva`** (público: origem permitida, formato estrito, teto por endereço; grava e avisa o Julien), **POST `/api/chauffeur/lead`** (o protótipo de 18/11, sem pessoa), **GET `/api/chauffeur/leads?dias=30`** (painel), **GET `/api/chauffeur/reserva/<codigo>`** (ficha com a linha do tempo), **POST `/api/chauffeur/lead/resultado`** (status), **GET `/api/chauffeur/links`** — os quatro últimos com a chave da Central |
| Painel | `https://<central>/chauffeur` (`public/chauffeur/`) | pedidos por origem, produto, dia, quantos viraram corrida e o valor confirmado; cada linha: quem embarca, WhatsApp **mascarado**, trajeto, valor, ✓ quando o Julien foi avisado, seletor de status (orçado · confirmado · feito · perdido · cancelado) |
| Avisos | `avisar.js` | pela Aria (`/webhook/alerta-equipe`, template `twk_team_alert`, 300 caracteres, uma linha): **pedido novo → Julien** (em francês, com o nome de quem embarca, nunca o telefone) e **pedido parado → Márlon** (em português). Só nomes de destinatário; a Aria resolve o número |
| Vigia | `vigia-reservas.js` (rotinas.js, a cada 5 min) | reserva em `pedido` há ≥ 30 min (`CHAUFFEUR_PENDENTE_MIN`) sem status → um aviso ao Márlon, registrado na reserva para não repetir; uma vez por dia anonimiza as reservas velhas. Falha 2 vezes seguidas → Ação na Central |
| DDL | `orchestrator/agents/dba-escrita/exemplos/chauffeur-reservas.sql` | as 3 tabelas (CREATE TABLE em `public`: **exige a frase do fundador**, ADR-017). Depois: `migrar.js --apply` passa os `.jsonl` para o banco sem perder linha |
| Testes | `test/reservas.test.js` (7), `test/agenda-run.test.js` (6), `test/agenda.test.js` (4) e `command-center/regencia/test/chauffeur.test.js` (7) | na Porta, chaves `chauffeur` e `regencia` |

**O que fica guardado:** a reserva inteira, inclusive a pessoa. É dado pessoal no mesmo nível do `nextauth."User"`: acesso mínimo (painel atrás da chave, WhatsApp mascarado na lista), nunca no aviso de WhatsApp, apagado 365 dias depois da corrida. A planilha do Google (seção 2) deixa de ser fonte e vira exportação.

**Status:** `pedido` (chegou) → `orcado` → `confirmado` (o Julien respondeu com hora, nome e valor) → `feito` · `perdido` · `cancelado`. Quem marca: o Julien, pelo link no aviso (Fase 2), ou o Márlon no painel, pelo código da conversa.

## 1b. Fase 2 (19/11): o Julien confirma por link e o cliente recebe no WhatsApp

| Peça | Onde | O que faz |
|---|---|---|
| Link de confirmar | `confirmar.js` + rota pública `GET/POST /c/<codigo>?t=<token>` em `chauffeur.js` | o aviso de pedido novo leva `https://<central>/c/WTD-…?t=…` (token = HMAC do código com `CHAUFFEUR_CONFIRMA_SECRET`, ou `CENTER_TOKEN`; base em `CHAUFFEUR_CONFIRMA_URL`). Página sem script, em francês, com a ficha e sem o telefone; "Confirmer la course" → `confirmado` por `julien`; "Refuser" → `perdido`. Sem URL ou segredo: o aviso sai sem o link e o painel continua valendo |
| Mensagens ao cliente | `cliente.js` (Cloud API da Meta direto da Central) | `wc_ride_confirmed` quando o status vira `confirmado` (pelo link ou pelo painel) e `wc_ride_reminder` na véspera às 8:00 PM e 2 h antes; FR ou EN pelo idioma da página; só com `WC_WA_TOKEN`, `WC_WA_PHONE_NUMBER_ID`, `WC_TEMPLATE_CONFIRMED`, `WC_TEMPLATE_REMINDER`; sem WhatsApp ou em `nao_contatar` não sai; cada mensagem uma vez por reserva, tudo registrado como evento (`confirmacao_cliente`, `lembrete_vespera`, `lembrete_2h`, `sem_canal`, `*_falhou`) |
| Lembrete ao Julien | `vigia-reservas.js` | 2 h antes de cada corrida confirmada, uma linha pela Aria (`lembrete_julien`) |
| Templates | `docs/notificacoes/templates-meta-wc-cliente-2026-11-19.md` | 2 templates × FR/EN, formato de ficha, UTILITY; `meta-templates.mjs --doc … --lang fr,en` cria depois do "aprovado" do fundador |
| Testes | `test/fase2.test.js` (4) + 2 em `chauffeur.test.js` | canal, idioma, travas, link, página, lembretes nas janelas certas |

Pedido de hotel (origem H) ainda não recebe cópia: o formulário não pede o contato do hotel.

**Letras de origem:** T TikTok · I Instagram · Y YouTube · W Twitch · H hotel · S site · R direto (sem link).
Link na bio de cada rede: `https://theworldkeys.com/ride?o=T` (I, Y, W); cartão e QR dos hotéis: `?o=H`; botões do site: `?o=S`.

## 2. Planilha de clientes (card T-20261116-0013) — agora exportação, não fonte

`planilha/clientes.csv`, `planilha/nao-contatar.csv`, `planilha/videos.csv`: modelos para o Google Sheets (Arquivo → Importar). Desde 19/11 a reserva mora na Central (seção 1); a aba `clientes` só serve se `CHAUFFEUR_AGENDA_FONTE=planilha`. A aba `videos` continua sendo a fonte dos 3 números de segunda (views, comentários, pedidos por código).

## 3. Agenda do dia às 9:00 AM (card T-20261116-0012)

`agenda-run.js` roda sozinho na Central às 9:00 AM Paris e manda ao Julien pela Aria; está desligada até `CHAUFFEUR_AGENDA=on`. **Desde 19/11 lê as reservas da Central** (os `confirmado` do dia, em ordem de hora, com o nome de quem embarca e o valor da tabela; os ainda em `pedido`/`orcado` entram como "à confirmer"). Para voltar à planilha: `CHAUFFEUR_AGENDA_FONTE=planilha` + `CHAUFFEUR_AGENDA_CSV_URL`. Como ligar: `docs/runbooks/agenda-julien-9am.md`.

À mão, com um CSV: `node agenda-do-dia.js <clientes.csv> [--dia AAAA-MM-DD] [--ideia "…"] [--hotel "…"]` imprime a mensagem e não envia nada. Testes: `node --test "test/*.test.js"`.
