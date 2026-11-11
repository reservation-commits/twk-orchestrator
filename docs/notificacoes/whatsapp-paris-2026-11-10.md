# WhatsApp das casas de Paris — varredura completa de 10/11/2026

**Pedido do fundador:** "E nas casas em Paris? Vamos verificar todas se encontramos?"

**Base:** 130 casas publicadas com cidade Paris (`db_restaurants`), pedidos de 90 dias (`reservations.created_date`), situação em `aria_contact_consent`, telefone do catálogo classificado pelo prefixo francês (06/07 = celular). Varredura dos 127 sites que não são rede social atrás de link `wa.me`/`api.whatsapp.com`, botão de WhatsApp, link `tel:` e celular no texto, com leitura do contexto de cada número (reserva × comercial × agência × ruído). Buscas na web para as 5 casas com mais pedidos sem celular. Só leitura; nada gravado.

## Panorama

| | Casas |
|---|---|
| Publicadas em Paris | 130 |
| Já recebem por WhatsApp (OK) | 1 (MONAK, 27 pedidos/90 d) |
| Com pedidos em 90 dias | 13 (Monak 27; Gallopin 4; Les Ombres, Maison Rostang, Siena, Staya 2; Boum Boum, Gigi, Girafe, L'Abysse, Le Carmen, Miss Kô, Raffine 1) |
| Celular no catálogo | 8 (1 OK, 7 sem opt-in) |
| Sites lidos / não lidos | 111 / 16 (hotéis com bloqueio 403, 404 e 429) |
| Sites com algum sinal de WhatsApp ou celular | 35, dos quais **9 com número utilizável** depois de ler o contexto |

Fato: a demanda de Paris hoje é pequena e concentrada no Monak. Fato: as casas de Paris reservam por Zenchef/TheFork/site; WhatsApp declarado é raro (5 em 130).

## Grupo A — celular já no catálogo, falta marcar (7)

| Casa | Pedidos 90 d | Celular | Observação |
|---|---|---|---|
| BOUM BOUM (10957) | 1 | +33 6 33 33 88 88 | club |
| CHEZ GALA (268939) | 0 | +33 6 17 93 52 38 | contato do site; o WhatsApp declarado é outro (grupo B) |
| DEFLOWER (281707) | 0 | +33 6 26 53 45 72 | club |
| L'ARC (10946) | 0 | +33 6 51 95 85 52 | club |
| TABOO (281778) | 0 | +33 6 13 18 14 19 | club |
| VERDE (250265) | 0 | +33 6 75 34 90 19 | **site do catálogo sequestrado** (cassino indonésio) — ver grupo E |
| YACATAN (250091) | 0 | +33 6 26 12 38 71 | mesmo número que Giulia e Kalamata: é o WhatsApp do grupo |

## Grupo B — WhatsApp declarado no site oficial (alta confiança, 5 casas)

| Casa | Pedidos 90 d | Número | Prova (lida em 10/11) |
|---|---|---|---|
| GIGI (14458) | 1 | **+33 6 27 34 46 66** | menu "Réservation par WhatsApp" → `wa.me/33627344666` |
| CHEZ GALA (268939) | 0 | **+33 6 59 40 45 14** | botão WhatsApp no rodapé → `wa.me/33659404514` |
| GIULIA (250029) | 0 | **+33 6 26 12 38 71** | botão → `wa.me/33626123871` (também `wa.me/33189710111`, o fixo) |
| KALAMATA (281656) | 0 | **+33 6 26 12 38 71** | "Phone +33189710110 +33626123871", link WhatsApp → mesmo número; é o celular do grupo (Giulia/Kalamata/Yacatan) |
| LE SPEAKEASY Paris (10970) | 0 | **+33 7 56 27 32 32** | botão WhatsApp com texto pronto "Bonjour, je souhaite réserver un dîner" → `wa.me/33756273232` (Cannes: +33 6 45 12 47 82) |

## Grupo C — celular de reservas sem WhatsApp declarado (média, 3 casas)

| Casa | Número | Prova | Cuidado |
|---|---|---|---|
| TERRAZA MIKUNA (312162) | +33 7 69 48 05 86 | "réserver une table… en ligne ou au 0769480586" | celular de reservas; WhatsApp não dito |
| TOUR D'ARGENT (29821) | +33 6 80 15 15 72 | "Demande de réservation… Julia Poubeau, Guest Relations" | celular de uma pessoa nomeada; usar só com o aval dela |
| NOTO (268908) | ? | botão "Discuter sur WhatsApp" (plugin) | número carregado por script, não lido; abrir o site no navegador e clicar |

## Grupo D — números achados que NÃO servem para reservas

- ALCAZAR +33 6 49 50 80 96 — "Privatisation / Groupe", comercial.
- ANDIA +33 6 67 60 86 59 — Sales Manager (comercial), não reservas.
- ALLIANCE +33 6 43 31 54 14 — ao lado do e-mail da cave/loja; incerto.
- GUY SAVOY +33 6 07 07 78 78 — é da agência web (Tiloo Digital).
- KONG, BAR JOSEPHINE, MARCELLO, SOLA, LE CARMEN, CAFÉ RUC, BRASSERIE DU LOUVRE, MACÉO, PACHAMAMA, GATE CLUB/PALAIS MAILLOT, KEI, MARSAN, RELAIS LOUIS XIII, SUGAAR — sequências de dígitos em scripts e ids de Instagram, não telefones.

## Casas com pedidos e só fixo (sem WhatsApp público)

GALLOPIN (4), LES OMBRES (2), MAISON ROSTANG (2), SIENA (2), STAYA (2, fica em Courbevoie), GIRAFE, L'ABYSSE, LE CARMEN, MISS KÔ, RAFFINE (1 cada). Buscas na web e sites só mostram fixo e reserva on-line. Caminho: perguntar à casa (carta curta, em francês, com aprovação do fundador), como no grupo C do levantamento geral.

## Grupo E — erros de catálogo vistos de passagem (DBA/Editorial)

- VERDE (250265): `site_url` sequestrado — página de cassino indonésio ("Mahjong333"). Zerar.
- STAYA (281985): cidade é Courbevoie (92), não Paris.
- Sites não lidos: Ritz (Espadon, Vendome), Peninsula (L'Oiseau Blanc), Shangri-La (Le Botaniste), Dorchester (Le Dali, Relais Plaza), Bristol (Café Antonia, Epicure), Ralph's, Chalet des Îles — bloqueio anti-bot; La Bauhinia, Manko, Shang Palace — 404; Le Baudelaire, Palais Royal, Yacatan — sem resposta.

## Como seguir

1. **Gravar opt-in — FEITO em 10/11/2026, 9 de 11.** Com a frase do fundador ("Sim, gravar as 11"), `orchestrator/state/ativacao/optin-paris-2026-11-10.sql` passou pela porta (`INSERT:9`, log `orchestrator/logs/whatsapp-paris-2026-11-10.jsonl`): Boum Boum, Chez Gala (no número do WhatsApp), Deflower, L'Arc, Taboo, Verde, Gigi, Giulia e Le Speakeasy. **Ficaram de fora KALAMATA e YACATAN**: partilham o celular +33 6 26 12 38 71 com Giulia, a chave de `aria_contact_consent` é o telefone e a Aria busca os números da casa por `restaurant_id` (`db.ts`, linha ~1395). Pendência de modelo para o DBA: permitir um telefone para várias casas (tabela de ligação casa⇄telefone ou chave composta), com ADR. Desfazer: DELETE das 9 linhas por `phone`, pela porta. **Proposta pronta em 10/11 (ADR-020, `docs/adr/ADR-020-um-telefone-para-varias-casas.md`):** tabela de ligação `aria_venue_phones` (DDL em `orchestrator/state/ativacao/ddl-aria-venue-phones-2026-11-10.sql`, espera a frase do fundador), dados das três casas em `optin-grupo-giulia-2026-11-10.sql` e Aria v26 no repositório com fallback para o modelo atual. **11/11: fundador aprovou e colou DDL e dados no Cloud SQL Studio** (banco inacessível do notebook do DBA); conferência da visão `v_aria_casa_telefones` pendente; deploy da Aria v26 pendente.
2. Terraza Mikuna e Noto: confirmar (Noto = abrir o site e clicar no botão).
3. Tour d'Argent: só com o aval da pessoa.
4. Casas com pedidos e fixo: carta em francês, quando o fundador quiser.
