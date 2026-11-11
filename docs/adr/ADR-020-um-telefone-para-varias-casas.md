# ADR-020 — Um telefone recebe os avisos de reserva por várias casas: tabela de ligação `aria_venue_phones`

**Data:** 2026-11-10 · **Estado:** **aceito em 2026-11-11** — frase do fundador no chat ("Aprovo a DDL"); DDL e dados colados por ele no Cloud SQL Studio em 11/11 ("Colei, pode rodar" / "Colei os dados"), porque o `twk_dba` não tem CREATE em `public` e o banco estava inacessível do notebook do DBA. **Conferência da visão pendente** (ver Verificação) · **Origem:** opt-in das casas de Paris em 10/11/2026 ("Sim, gravar as 11"): 9 gravadas, 2 impossíveis pela chave · **trace_id:** `trc-adr020-20261110`

## Contexto

Quem recebe os templates de WhatsApp de reserva é decidido por `public.aria_contact_consent`, cuja chave primária é o **telefone**. A linha guarda, numa só, três coisas de natureza diferente: a identidade do número (`tipo`, `idioma`), as **travas do número** (`outbound_opted_out` = PARAR; `whatsapp_indisponivel` = a Meta devolveu "undeliverable") e a **marcação da casa** (`whatsapp_reservas` + `restaurant_id`). A Aria resolve os destinatários de um evento por `restaurant_id` (`src/db.ts`, fragmento `CASA_MARCADA`; `src/venueEvents.ts::getVenueRecipients`) e identifica quem escreve por `phone` (`src/venueIdentity.ts`).

Em 10/11/2026 o levantamento de Paris (`docs/notificacoes/whatsapp-paris-2026-11-10.md`) encontrou o celular **+33 6 26 12 38 71** declarado como WhatsApp de reservas por três casas do mesmo grupo: GIULIA (250029), KALAMATA (281656) e YACATAN (250091). Só GIULIA pôde ser gravada (`orchestrator/state/ativacao/optin-paris-2026-11-10.sql`, `INSERT:9`). Pior: o `ON CONFLICT (phone) DO UPDATE … restaurant_id = COALESCE(EXCLUDED.restaurant_id, …)` do webhook `/webhook/consent` faria a segunda casa **roubar** o número da primeira em silêncio. Grupos com um WhatsApp central não são exceção (hotéis com vários restaurantes, redes com reserva centralizada): o modelo precisa aceitar N casas por telefone sem perder a regra de que o PARAR e a lista de bloqueio são do telefone.

Fato: as três casas têm 0 pedidos em 90 dias — a urgência é de modelo, não de volume. Fato: hoje a tabela nasce e cresce pelas migrations de boot da Aria (`src/dashboard/migrations.ts`), mas a constituição manda DDL em `public` pela porta única com a frase do fundador; este ADR segue a constituição e **não** acrescenta a tabela ao boot.

## Opções

### A — Tabela de ligação `aria_venue_phones` (recomendada)

`aria_venue_phones (restaurant_id, phone, whatsapp_reservas, idioma, source, motivo, updated_at)`, chave `(restaurant_id, phone)`, `phone` com FK para `aria_contact_consent(phone)`. Uma linha por par casa⇄telefone. `aria_contact_consent` passa a ser **só a identidade e as travas do número**; o `restaurant_id` que já está lá continua valendo como "linha legada" onde não houver ligação para o mesmo par.

- **Leitura (Aria):** destinatários da casa = ligações da casa **∪** linha legada da casa sem ligação equivalente, cada uma **juntada por `phone`** a `aria_contact_consent` para trazer `outbound_opted_out` e `whatsapp_indisponivel`. A regra única `decidirEnvioWhatsApp` decide por linha. A ligação vence a linha legada para o mesmo par (inclusive para desligar uma casa sem tocar nas outras).
- **Travas por telefone continuam por telefone:** `marcarWhatsAppIndisponivel`, `limparWhatsAppIndisponivel`, `setOutboundConsent` (PARAR/VOLTAR) e o `consent.ts` **não mudam** — um `UPDATE … WHERE phone = $1` segue bloqueando (ou liberando) o número em todas as casas, porque a consulta de destinatários lê a trava pelo telefone.
- **Escrita:** o webhook `/webhook/consent` (tipo `estabelecimento` + `restaurant_id`) grava a ligação e deixa de sobrescrever o `restaurant_id` legado; a porta única do DBA grava ligações por SQL como hoje.
- **Fallback:** enquanto a tabela não existir, a Aria descobre isso por `to_regclass` e usa exatamente a consulta da v25. A DDL entra em vigor sem redeploy (reconferência a cada 5 min); apagar a tabela é o rollback.
- **Frota:** Guardião (`guardiao-reserva/db.js`), Central (`command-center/whatsapp.js`), canário (`notificacao-reserva/canario-clientes-sql.cjs`), lista de ligações (`ligacoes-telefone-casas.cjs`) e `chave-girada/ativacao/optin-sql.cjs` leem `aria_contact_consent` por `restaurant_id`. Continuam corretos para toda casa gravada até hoje (todas têm linha legada) e passam a ler a visão `v_aria_casa_telefones` (uma linha por par, com `recebe` já calculado) numa segunda etapa — leitura, sem pressa, sem DDL nova.

### B — Chave composta `(phone, restaurant_id)` em `aria_contact_consent`

- Exige **trocar a chave primária** (`DROP CONSTRAINT` + nova PK): não é DDL aditiva, é migração de schema — **sempre humano** (ADR-017), sem desfazer.
- Clientes têm `restaurant_id` NULL: chave composta com NULL não existe; seria preciso um sentinela ou índices parciais, e toda linha de cliente mudaria de contrato.
- As travas do telefone passariam a existir em N linhas: PARAR, VOLTAR e a lista de bloqueio teriam de atualizar todas (e o `WHERE phone = $1 AND whatsapp_indisponivel = false` de hoje bloquearia só parte delas até alguém lembrar).
- Quebra todo `ON CONFLICT (phone)` da Aria (4 pontos em `db.ts`), do exemplo da porta (`dba-escrita/exemplos/whatsapp-optin.sql`), dos scripts de ativação e das consultas da Central que assumem uma linha por número.
- O ganho (não criar tabela) não paga nada disso.

## Decisão (proposta)

**Opção A.** Em três atos, nesta ordem:

1. **DDL, com a frase do fundador** — `orchestrator/state/ativacao/ddl-aria-venue-phones-2026-11-10.sql`: a tabela, o índice por telefone, a visão `v_aria_casa_telefones` e os GRANTs (`twk_ro` lê; `twk_dba` e o papel da Aria escrevem). O executor da porta ainda recusa palavra estrutural (`create`) — o dry-run deste arquivo termina em BLOQUEADO **de propósito**; o caminho é o fundador colar no Cloud SQL Studio, como nas colagens do runbook de privilégios, ou a porta ganhar DDL aditiva (pendência do ADR-017, colagem 2).
2. **Dados, pela porta, autônomo** — `orchestrator/state/ativacao/optin-grupo-giulia-2026-11-10.sql`: três ligações do celular +33626123871 (GIULIA, KALAMATA, YACATAN), `INSERT … ON CONFLICT`, com `-- backup:` e assert de contagem. A frase de 10/11 já cobria as três casas; o que faltava era a chave.
3. **Aria v26** (`2026-11-10-v26-um-telefone-varias-casas`), já no repositório: `src/casaTelefones.ts` (puro: SQL das duas fontes, filtro de destinatários, casa principal + outras), `db.ts` (`temTabelaLigacaoCasas`, `getVenueConsentRows`, `getCasasDoNumero`, `setWhatsAppReservas` por ligação, `casaMarcada()` nas varreduras), `venueEvents.ts`, `venueIdentity.ts` (o aviso de sistema diz ao modelo que o número também atende as outras casas e junta os pendentes de todas), `buildInfo.ts`. Deploy pode sair antes ou depois da DDL: sem a tabela, comportamento da v25.

## Impacto nas leituras da Aria

| Arquivo | Antes | Depois |
|---|---|---|
| `src/consentRegra.ts` | regra única por linha | **inalterado** — a linha mesclada já traz as travas do telefone |
| `src/consent.ts` | PARAR/VOLTAR por telefone | **inalterado** — e é o comportamento certo: o número pediu, o número para, em todas as casas |
| `src/db.ts` `getConsentRow`, `podeReceberWhatsAppReservas` | por telefone (cliente) | inalterados |
| `src/db.ts` `marcarWhatsAppIndisponivel` / `limparWhatsAppIndisponivel` | `WHERE phone = $1` | **inalterados** — a trava é do telefone e vale para todas as casas por construção |
| `src/db.ts` `CASA_MARCADA` (lembrete 24 h à casa, agenda de amanhã) | só `aria_contact_consent` | `sqlCasaMarcada(ligacao)`: ligação **ou** legado sem ligação, travas nos dois ramos |
| `src/db.ts` `setWhatsAppReservas` | `ON CONFLICT (phone)` sobrescrevia `restaurant_id` | com a tabela: grava a ligação em transação; o legado só muda se era da mesma casa ou não tinha casa |
| `src/venueEvents.ts` `getVenueRecipients` / `motivoSemDestinatario` | SQL próprio por `restaurant_id` | `getVenueConsentRows` + `filtrarDestinatariosCasa` (dedup por número, ligação vence, teto 3) |
| `src/venueIdentity.ts` | 1 casa por telefone (`LIMIT 1`) | casa principal (legada) + `outras`; pendentes de todas no aviso |
| `src/juiz.ts` (é casa?) | `phone IN (…) AND tipo='estabelecimento'` | inalterado — a identidade continua em `aria_contact_consent` |

## Consequências

- `aria_contact_consent.restaurant_id` vira **legado para estabelecimento**: não se apaga (a frota lê), não se sobrescreve, e toda marcação nova de casa pelo webhook vai para a ligação. Uma varredura futura pode copiar as linhas legadas para `aria_venue_phones` (INSERT reversível, pela porta) e depois a frota passa a ler só a visão.
- "Sem destinatário" continua explicado (`explicarSemDestinatario`) e o canário continua distinguindo não marcada ≠ bloqueada ≠ PARAR ≠ opt-out de listagem.
- Registro de Opt-out de Listagem segue por casa e continua vencendo tudo (`v_listing_consent_atual` é lida antes de qualquer destinatário).
- A Sentinela e o Auditor não precisam de checagem nova: a porta única de saída e as travas de envio não mudaram. Vale acrescentar ao Auditor, quando a tabela existir, que `getVenueRecipients` continua passando por `filtrarDestinatariosCasa` (é onde a trava do telefone chega às N casas).
- Em 10/11 nada foi aplicado; em 11/11 o fundador colou a DDL e os dados no Cloud SQL Studio (log `orchestrator/logs/adr-020-telefone-varias-casas-2026-11-10.jsonl`). Como foi colagem e não porta, não há backup do executor — o desfazer dos dados é `DELETE FROM public.aria_venue_phones WHERE phone = '+33626123871'`. Nenhum commit sem o fundador pedir.
- Lição para a porta: a DDL aditiva aprovada por frase ainda não tem caminho automático (`executar.js` recusa `create`; `twk_dba` sem CREATE). Enquanto a colagem 2 do ADR-017 não for feita, toda DDL será colagem humana — e o notebook do DBA precisa estar na rede autorizada do Cloud SQL para a conferência e para a escrita pela porta (em 11/11 o IP 177.192.17.100 não alcançava a 5432).

## Verificação

- Aria: `npm run typecheck` e `npm test` verdes em 10/11/2026 com `test/casaTelefones.test.ts` (PARAR e lista de bloqueio valem nos dois ramos; ligação desligada não recebe; dedup por número com a ligação vencendo; teto 3; SQL sem a tabela é o da v25; SQL com a tabela une as fontes e tira as travas de `aria_contact_consent` por `phone`; casa principal + outras) e caso novo em `test/venueIdentity.test.ts` (aviso nomeia as outras casas).
- Porta: dry-run de `optin-grupo-giulia-2026-11-10.sql` passa (só INSERT, reversível); dry-run da DDL é BLOQUEADO por palavra estrutural, como esperado.
- Depois da DDL e dos dados: `SELECT * FROM public.v_aria_casa_telefones WHERE phone = '+33626123871'` deve devolver 3 linhas com `recebe = true`; `/health` da Aria deve mostrar `v26`; um `pedido_recebido` de KALAMATA deve terminar `enviado` em `aria_outbound_log` para esse número.
