# WhatsApp das casas mais pedidas — levantamento de 10/11/2026

**Pedido do fundador:** "Dos restaurantes mais procurados, nós precisamos encontrar o contato do WhatsApp deles."

**Base:** `reservations` (pedidos criados nos últimos 90 dias, por casa publicada), `aria_contact_consent` (situação do WhatsApp da casa), `db_restaurants` (telefone, site, e-mail), `contacts_pro`, `restaurant_invitations`, `aria_messages` (assinaturas de e-mail) — tudo por `twk_ro`. Fora do banco: varredura dos sites de 53 casas atrás de link `wa.me`/`api.whatsapp.com` e 20 buscas na web. Rótulos: fato × suposição × lacuna.

**Resumo.** Das 60 casas mais pedidas, 9 já recebem por WhatsApp (OK). Das 51 restantes: 6 têm celular no próprio catálogo e só falta marcá-las para receber; 3 ganharam um número novo achado na web (1 com alta confiança); as outras 42 só têm fixo e nenhum celular público — o caminho é perguntar à casa. Nada foi gravado no banco.

## Grupo A — o catálogo já tem celular; falta marcar para receber (6 casas)

| Casa | Cidade | Pedidos 90 d | Celular no catálogo | Observação |
|---|---|---|---|---|
| ATELIER DE LA PLAZA (32694) | Bogotá | 6 | +57 318 882 7216 | prefixo 3 = móvel na Colômbia |
| PLUM (40772) | Phuket | 4 | +66 86 414 5465 | prefixo 8 = móvel na Tailândia; site 404 |
| ZAZÁ (16401) | Rio de Janeiro | 3 | +55 21 99530-7173 | celular BR |
| THE CURRY LEAF (70131) | Lagos | 3 | +351 966 860 071 | prefixo 9 = móvel PT |
| BAGATELLE (14092) | São Paulo | 3 | +55 11 98568-4430 | celular BR; o site da Bagatelle cita WhatsApp |
| MULLEN'S (70041) | Lagos | 2 | +351 918 480 071 | prefixo 9 = móvel PT |

Fato: o número é móvel pelo prefixo. Suposição: tem WhatsApp. O primeiro template diz a verdade: se a Meta devolver "undeliverable", a Aria bloqueia o número sozinha (v19) e a casa volta para o grupo C. Regra da Meta: mensagem iniciada pela empresa exige opt-in do destinatário; as linhas de outubro foram gravadas com `source = 'fundador'` — a mesma decisão vale aqui, e é do fundador.

## Grupo B — número novo encontrado na web (3 casas)

| Casa | Pedidos 90 d | Número | Origem | Confiança |
|---|---|---|---|---|
| EM (33956), Cidade do México | 3 | **WhatsApp +52 55 6450 1302** | site oficial `itsemilia.rest`, rodapé "Whatsapp +525564501302" (lido em 10/11) | **alta** — é o canal declarado pela casa |
| A PETISQUEIRA (69928), Lagos | 12 | +351 924 714 439 | listagem "Inside Lagos" (PressReader, 04/2024) | média — móvel, WhatsApp não confirmado |
| SKYE (14068), São Paulo | 7 | (11) 3055-4702 | avaliação de cliente no Mapstr dizendo "reservas por WhatsApp"; número também citado em 2013 como linha de reservas | baixa — fixo, pode ter WhatsApp Business; jantar só para hóspedes até 19h30 |

## Grupo C — só fixo, nenhum celular público: perguntar à casa (por demanda)

| Casa | Cidade | Pedidos 90 d (30 d) | Fixo do catálogo | O que a busca mostrou |
|---|---|---|---|---|
| SRI TRAT (35219) | Bangkok | 82 (20) | +66 2 088 0968 (bloqueado) | site fora do ar; Wongnai/Time Out só com o fixo; `contacts_pro` tem o gerente "PIM", sem telefone |
| MY SUSHI (70083) | Lagos | 38 (4) | +351 282 798 221 (bloqueado) | só o fixo; página oficial é Facebook |
| ATHÉNÉE (58502) | Atenas | 28 (14) | +30 210 325 1430 (bloqueado) | site atrás de verificação anti-bot; Panas Group |
| DON SEBASTIÃO (70105) | Lagos | 21 (0) | +351 282 780 480 | Michelin e VisitPortugal só com o fixo |
| BOTECO BELMONTE (253542) | Rio | 19 (2) | +55 21 2267-9909 (bloqueado) | fixos por unidade; Instagram `@boteco_belmonte` |
| O ANTÓNIO (70535) | Lagos | 16 (0) | +351 282 763 560 | só o fixo (VisitPortugal) |
| LA CUCINA (79616) | Nice | 10 (1) | +33 9 83 48 91 39 (bloqueado) | casa pequena, "sem reservas" segundo avaliações |
| PARTHENOPI (10547) | Cannes | 7 (2) | +33 4 93 68 00 64 | só o fixo |
| STRAVINSKIJ (43268) | Roma | 7 (1) | +39 06 3288 8874 | bar do Hotel de Russie (Rocco Forte) — pedir ao concierge |
| Il Salumaio di Montenapoleone (18044) | Milão | 6 (2) | +39 02 7600 1123 | só o fixo; e-mails da casa sem celular na assinatura |
| PAPADAKIS (57181) | Atenas | 6 (2) | +30 210 360 8621 | site não respondeu |
| Fervor (16199) | Buenos Aires | 6 (1) | +54 11 4804-4944 | "reserva imprescindível"; só fixos e e-mail |
| Karaköy Lokantası (17019) | Istambul | 6 (0) | +90 212 292 4455 | só Instagram |
| Menina Sardinha (298865) | Lisboa | 5 (0) | +351 21 886 3677 | só fixo; listada como "Sardinha" |
| JOAQUINA (13331) | Rio | 5 (0) | +55 21 2275-8569 | só fixo |
| IL SANLORENZO (43298) | Roma | 5 (2) | +39 06 686 5097 | site não respondeu |
| BEIJING DADONG (19672), KING'S JOY (16558) | Pequim | 8, 6 | fixos +86 10 | China: WhatsApp pouco usado; canal é WeChat — deixar fora |
| demais 24 casas com 2–4 pedidos | — | — | fixo | não pesquisadas uma a uma |

## Grupo D — erros de catálogo encontrados de passagem (para o DBA/Editorial)

- BICE (17986, Milão): `site_url` aponta para o Pullman Doha West Bay (Catar); o `wa.me` achado lá (+974) **não é da casa**.
- BOTECO BELMONTE: `site_url` é domínio perdido (blog de template).
- SKYE, PLUM, BEIJING DADONG: `site_url` responde 404.

## Como seguir

1. **Grupo A (6) + EM — FEITO em 10/11/2026.** Com a frase do fundador ("Sim, gravar as 7"), as 7 linhas foram gravadas em `aria_contact_consent` pela porta (`orchestrator/state/ativacao/optin-casas-mais-pedidas-2026-11-10.sql`, `INSERT:7`, log `orchestrator/logs/whatsapp-casas-2026-11-10.jsonl`). O próximo pedido de cada casa sai por WhatsApp; se a Meta devolver "undeliverable", a Aria bloqueia o número e a casa volta ao grupo C. Desfazer: DELETE das 7 linhas por `phone`, pela porta.
2. **A Petisqueira e Skye**: confirmar com a casa antes de gravar (uma ligação de Julien/Márlon basta).
3. **Grupo C**: carta curta por e-mail, no idioma da casa, pedindo o número de WhatsApp para receber os pedidos (modelo do Programa OUI). Envio externo a estabelecimento = aprovação do fundador. Ordem: Sri Trat, My Sushi, Athénée, Don Sebastião, Belmonte, O António. Quando a casa responder pelo WhatsApp, a Aria desbloqueia sozinha.
4. Não cadastrar número da web sem confirmação (Grupo B média/baixa) e não insistir nos fixos já bloqueados.
