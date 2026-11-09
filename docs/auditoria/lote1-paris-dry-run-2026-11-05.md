# Lote 1 — Paris, dry-run (2026-11-05)

Objetivo: publicar +200 casas em Paris com dados completos verificados e fotos de qualidade. Este é o primeiro lote, só leitura: nada foi escrito no banco. Consultas com `twk_ro`; recuperação de dados e piloto de fotos em modo sem escrita.

## Estoque (fato, 2026-11-05)

| Paris | Casas |
|---|---|
| Total no catálogo | 237 |
| Publicadas | 123 |
| Despublicadas ativas, sem veto | 100 |
| · com foto de capa ou slider | 22 |
| · sem foto, dados completos (`ready_pending_photo`) | 23 |
| · sem foto, dados incompletos | 55 |
| Despublicadas fechadas ou sem status | 14 |

Opt-out (`orchestrator/state/listing-consent.jsonl`, 7 linhas, 4 vetos): **nenhuma** das 100 ativas está vetada.

## Recuperação de dados — `recover_catalog_gaps.js --city Paris --only-with-photo`

29 casas despublicadas com foto (22 ativas + 7 fechadas/sem status). **Nada preenchível automaticamente** — o lote de 03/11 já levou o que era fácil. 27 pendências humanas:

| Motivo | Casas |
|---|---|
| Site não expõe e-mail de reserva | 20 |
| E-mail achado só com confiança baixa (pessoal: icloud, gmail, hotmail) | 3 — MARZO, L'AQUARIUM, LES ENFANTS ROUGES |
| `place_id` aponta para ficha errada | 3 — Lutetia ("Paris"), CACHE (Mercato Beaubourg), SUR MESURE (Mandarin Oriental) |
| Provável duplicata | 1 — VICTORIA PARIS (292661) = VICTORIA (95341, publicada) |
| Horários genéricos sem fonte | 4 — BRASSERIE LIPP, L'ORANGERIE, CACHE, Lutetia |
| Sem site | 2 — L'ÉCRIN, Lutetia |
| Fechada (definitivo / temporário) | 2 / 3 |

Sem pendência mas sem telefone: SEPTIME (4 pedidos), CLUB PARADISIO.

Leitura: o e-mail de reserva é o gargalo estrutural. Casas de hotel (Le Cinq, Plaza Athénée, Lutetia, 114 Faubourg, Pré Catelan) nunca expõem e-mail; o caminho é telefone ou o Programa OUI.

## Piloto de fotos — `enrich_photos_v2.js --ids …` (sem escrita)

38 casas com `ready_pending_photo` (as 23 completas e mais 15). Critério da v2: capa paisagem ≥ 1500 px, sem pessoas, sem cardápio, classificada por visão.

**9 qualificadas** (capa + galeria encontradas no site oficial):

| Casa | Tipo | Capa |
|---|---|---|
| Akrame | ambiente | 1600×1024 + 2 |
| Buddha-Bar Paris | ambiente | 2560×1707 + 2 |
| Granite | ambiente | 2200×1238 + 2 |
| Le Grand Véfour | ambiente | 1600×1067 + 2 |
| Sphère | ambiente | 1920×1280 + 4 |
| Substance — Matthias Marc | ambiente | 2200×1238 + 1 |
| Comice | prato | 2500×1667 + 3 |
| Restaurant La Scène — Stéphanie Le Quellec | prato | 2000×1333 + 3 |
| Sola | prato | 1500×1000 + 1 |

Suspeita a conferir: Granite e Substance têm capa do mesmo tamanho e mesmo caminho (`/assets/img/hero.jpg`) — mesmo estúdio de site; verificar que as imagens são diferentes antes de gravar.

**29 não qualificadas**: 14 sem imagem em alta resolução no site, 8 com melhor imagem abaixo de 1500 px ou em retrato (Aldehyde 2500 retrato, Le Florimond 2500 retrato, Aux Lyonnais 1978, Mâche 1807, Verjus 1400, FIEF/Passionné/Petrossian 1200), 6 sem ambiente ou prato aprovado pela visão, 1 erro de API (Drouant, pedido rejeitado pela API de visão — imagem grande demais, a investigar).

## O que o lote 1 entrega, se aprovado

- **9 casas** ganhariam foto e, como são completas, ficariam prontas para publicar (das 23 completas: Akrame, Buddha-Bar, Granite, Sphère, Sola; as outras 4 — Comice, Grand Véfour, La Scène, Substance — precisam de conferência de completude).
- **0 casas** das 22 com foto avançam sem trabalho humano: todas dependem de e-mail de reserva por telefone, ou de correção de `place_id`.

Previsão honesta do lote 1: 9 publicáveis por automação, contra os 30–40 estimados ontem. A diferença é o e-mail de reserva e a qualidade das fotos nos sites.

## Decisões pendentes do fundador

1. **Direitos das fotos**: as 9 capas vêm dos sites oficiais. Gravar com origem no `enrichment_log` (risco jurídico assumido) ou só via Programa OUI.
2. **E-mail de reserva**: aceitar telefone como contato suficiente para publicar (hoje o critério exige e-mail), ou fila de ligação em francês para as 20 casas.
3. **Aprovação por lote**: uma frase por lote de até 50 casas, com lista impressa.

## Execução (2026-11-05, após "Sim, gravar as 9")

- **Gravadas 8 fotos** pela porta única, frase do fundador no audit, sha256 `ed53ea79d7d34c1c`, trace `twk-20261105094259-fotos-paris-l1`: Akrame, Buddha-Bar Paris, Granite, Le Grand Véfour, La Scène, Sola, Sphère, Substance. Granite × Substance conferidas antes: imagens e hashes diferentes.
- **Nada publicado.** As 8 seguem `published=false` com `ready_pending_photo=true`; Paris continua com 123 publicadas. São exatamente as 8 que `republish_no_photo.js --apply --only-with-photo` publicaria — publicar continua decisão do fundador.
- **Comice ficou fora:** a porta barra a palavra `copy` em qualquer ponto do SQL, e o arquivo da capa se chama `DSCF5934+copy.jpg`. Falso positivo, não contornado (regra 3). Opções: o fundador aprova ajustar a regra para ignorar literais de texto, ou escolher outra capa do site.
- **Achado:** `executar.js` audita só em `orchestrator/logs/`; a tabela `agent_audit_log` do banco não recebe as escritas da porta (só o pg_cron escreve lá).
- Desfazer: `node orchestrator/agents/dba-escrita/desfazer.js --backup "C:\Users\bianc\.twk\backups\2026-11-05-lote1-fotos8-ed53ea" --apply --motivo "…"`

## Publicação (2026-11-05, após "Sim, publicar as 8")

- **Publicadas 5:** Akrame, Buddha-Bar Paris, Granite, Sola, Sphère. Porta única, sha256 `03198e9ccd1b1cf5`, `ready_pending_photo` zerado junto. Paris passa de 123 para **128** publicadas.
- **Seguram 3** por falta de texto descritivo (critério "dados completos verificados" do próprio pedido): Le Grand Véfour, La Scène, Substance. Já têm foto; entram assim que o Quill escrever o texto.
- **Páginas no ar:** as 5 `/hospitality/{slug}` respondem 200 e mostram a capa nova. As 4 removidas seguem em 404.
- **Lacuna:** presença na listagem `/explore/paris` não verificada (carrega no cliente). Logo após a publicação, o site devolveu 404 por alguns minutos até para casas antigas; normalizou sozinho.
- Handoffs `TWK-20261105-0001` (Comercial: funil e consentimento) e `TWK-20261105-0002` (Editorial: links internos e texto das 3), trace `trc-f64cc445887d`.
- Desfazer: `node orchestrator/agents/dba-escrita/desfazer.js --backup "C:\Users\bianc\.twk\backups\2026-11-05-publicar5-03198e" --apply --motivo "…"`

## Textos e publicação das 3 (2026-11-05)

- **Padrão medido** nas 128 publicadas de Paris: só `about_text` e `about_html` são usados, em inglês; mediana de 906 caracteres. A página exibe `about_html` quando existe. Modelo adotado: as 35 fichas com 4 blocos de subtítulo em negrito centralizado (ex.: Bonnie).
- **Redação pelo Editorial**, só com fatos lidos nos sites oficiais (fontes no log). Estrelas: La Scène 2 e Substance 1 desde 2022, ambas segundo o site da casa, porque o Guia Michelin bloqueou o acesso automático. Le Grand Véfour sem estrelas, porque não há fonte atual.
- **Substance renomeada**: o site oficial credita os chefs Flavio Lucarini e Aurora Storari; Matthias Marc não aparece mais. O slug ficou como estava, para não mudar a URL.
- **Publicadas**: Le Grand Véfour, La Scène, Substance. Porta única, sha256 `23a5695e89ce3e58`. Paris passa a **131** publicadas.
- Desfazer: `node orchestrator/agents/dba-escrita/desfazer.js --backup "C:\Users\bianc\.twk\backups\2026-11-05-textos3-23a569" --apply --motivo "…"`

**Achados de qualidade do texto no catálogo:**
- As 5 publicadas mais cedo (Akrame, Buddha-Bar, Granite, Sola, Sphère) têm só um texto genérico idêntico de 100 a 218 caracteres, sem `about_html`. O critério de "texto ≥ 100" deixou passar; o certo é o padrão de 4 blocos.
- 70 fichas publicadas de Paris começam com o defeito `<h6>: restaurant in </h6>`.
- 2 fichas (ex.: Le Taillevent) têm HTML colado de uma interface de chat, com classes de CSS alheias.

## Reescrita das 5 (2026-11-05, após "Sim, reescrever as 5")

- **Reescritas 4:** Buddha-Bar Paris, Granite, Sola, Sphère, no padrão de 4 blocos (1.339 a 1.399 caracteres). Porta única, sha256 `34c6efc5593a7e41`. As páginas respondem 200 com o texto novo, e o genérico sumiu.
- **Fatos cortados na revisão:** a estrela da Sola, que só aparece na descrição da página do site e não no texto visível; e "técnicas japonesas" na Sphère, porque o site diz apenas restaurante francês.
- **A porta parte o SQL no ponto e vírgula**, mesmo dentro de texto ("UPDATE sem WHERE"). Não contornado: as duas frases foram reescritas com ponto.
- **Akrame ficou fora.** O site oficial diz "temporairement fermé pour rénovation", mas a casa foi publicada hoje e segue `operational_status = active`. Não há reservas para ela. Despublicar até a reabertura é decisão do fundador.
- **Achados:** o slug `buddha-bar-paris-paris` está duplicado. A estrela da Sola precisa ser confirmada no Guia Michelin, que bloqueia acesso automático.
- Desfazer: `node orchestrator/agents/dba-escrita/desfazer.js --backup "C:\Users\bianc\.twk\backups\2026-11-05-textos4-34c6ef" --apply --motivo "…"`

## Akrame despublicada (2026-11-05, após "Sim, despublicar")

- **Despublicada** pela porta única, sha256 `875dc91b3b26c520`. O `operational_status` passou a `temporarily_closed`, e o `ready_pending_photo` ficou desligado, para que a republicação em lote não a traga de volta.
- **Sem veto de relistagem:** o fechamento é temporário. Quando a casa reabrir, republicar continua sendo decisão do fundador.
- **Conferido:** a página `/hospitality/akrame-paris` responde 404, com e sem cache-buster. Paris fica com **130** publicadas.
- Avisos: `TWK-20261105-0003` ao Comercial (fora do funil até reabrir) e `TWK-20261105-0004` ao Editorial (tirar dos links e escrever o texto na reabertura).
- Desfazer: `node orchestrator/agents/dba-escrita/desfazer.js --backup "C:\Users\bianc\.twk\backups\2026-11-05-despublicar-akrame-875dc9" --apply --motivo "…"`

## Mudança de código

`Agente Gerenciador do Banco de Dados/enrich_photos_v2.js` ganhou `--dump <arquivo.json>` (no piloto, guarda o `images_json` qualificado para gerar SQL reversível) e `--ids a,b,c` (casas escolhidas, publicadas ou não, sem capa nem slider); em `--apply` a condição idempotente passa a ser "sem capa nem slider" em vez de `images_json IS NULL`. Não commitado.

Artefatos: relatório JSON da recuperação e logs em `C:\Users\bianc\AppData\Local\Temp\claude\3c74125683239a8f\489441df-13b4-44e9-b74b-448c95265564\scratchpad\` (`lote1-recover.json`, `lote1-recover.log`, `lote1-fotos.log`).
