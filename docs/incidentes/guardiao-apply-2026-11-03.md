# Incidente — Guardião da Reserva em modo apply: reconstrução e julgamento dos envios de 29/10 a 03/11/2026

**Achado de origem:** `AC-20261103190834-5cdb` (Central, analista, severidade crítica, 03/11 19:08 UTC) — "Pausar modo apply e auditar 24 envios feitos sem nenhuma aprovação decidida".
**Traces auditados:** `trc-guard-20261029`, `trc-guard-20261030`, `trc-guard-20261031`, `trc-guard-20261101`, `trc-guard-20261102`, `trc-guard-20261103`.
**Data da reconstrução:** 2026-11-03 (sessão de auditoria, somente leitura: `twk_ro` + chave da Central + caixa de saída do Gmail). Nada foi enviado, nenhuma configuração ou estado foi alterado.

## 1. Veredito

**Os 24 e-mails (25 reservas, 24 casas) são degrau 1 autônomo dentro do ADR-019 / POL-009. Nenhum envio está fora da regra.**

| Trava (ADR-009/ADR-019, código em `engine.js` e `run.js`) | Resultado nos 24 envios |
|---|---|
| Só degrau 1, canal e-mail, lote diário | 24/24 — o runner só entrega `email_restaurante`; nenhum degrau 2–4 saiu (degraus 2–3 ficaram em CSV, degrau 4 é da Aria) |
| Pedido ≥ 24 h sem resposta | 24/24 — mínimo 31 h (PIERLUIGI), máximo 4.806 h (TRATTORIA AL MORO) |
| Registro de opt-out consultado e casa fora dele | 24/24 — registro lido em todas as rodadas (`registro_optout_lido`, fonte banco + arquivo); nenhuma das 24 casas está em `v_listing_consent_atual` (15207, 70057, 70626, 92055) nem nos eventos só em arquivo (31607, 14384) |
| `published=true`, sem `do_not_relist`, sem opt-out na Aria | 24/24 (banco, 03/11) |
| Casa sem WhatsApp vivo (senão é da Aria) | 24/24 — `casa_whatsapp=false`; a única casa com WhatsApp (868QP9K5) foi delegada à Aria e não recebeu e-mail |
| 1 e-mail por casa por 24 h | 24/24 — cada casa recebeu exatamente 1 e-mail no período inteiro; LA FINE BOUCHE recebeu 1 e-mail com 2 reservas (agrupamento previsto) |
| Máx. 2 contatos por reserva | 25/25 — 1 contato por reserva |
| Teto 50 e-mails/dia | 19 (29/10) · 2 (30/10) · 2 (31/10) · 0 (01/11) · 1 (02/11) · 0 (03/11) |
| Janela 08–22 h no fuso da casa | 24/24 — horas locais entre 8 h (Lisboa) e 16 h (Pequim, Macau, Singapura) |
| Casa de teste excluída | 24/24 — nenhuma em `orchestrator/state/excluidos-teste.json` |
| `GUARDIAO_AUTONOMO=on` ativo | sim em todas as rodadas (ver §3) |
| Registro em audit com trace | 24/24 — `email_envio` com `aprovacao_ref: ADR-019`, HTTP 200 do n8n |
| E-mail realmente saiu | 24/24 — 24 mensagens em `in:sent` de reservation@theworldkeys.com entre 29/10 e 02/11, assunto no idioma da casa |

**Lacunas (declaradas, não resolvidas):** (a) quem e quando definiu `GUARDIAO_AUTONOMO=on` no Easypanel não fica em nenhum log — a variável é configuração do fundador segundo o ADR-019 §"Consequências"; (b) o conteúdo HTML de cada e-mail não foi reaberto (o template `templates.js` é fixo e o assunto conferido no Gmail bate com ele).

## 2. O que o achado afirma × o que o sistema diz

| Afirmação do achado | Fato |
|---|---|
| "Houve envio externo real a 23 casas sem que nenhuma aprovação humana tenha sido decidida" | Verdadeiro quanto aos cartões (20 pendentes, `ultima_decidida=null`). Mas desde 28/10 o degrau 1 **não exige cartão**: ADR-019 §5 e `POL-009` (status `ativa`, decisão `autonomo_com_log`). A aprovação é a do fundador no ADR, gravada a cada rodada como `autonomia_adr019`. |
| "A flag de modo foi alterada para 'apply' sem vincular a execução a um id de aprovação; o caminho apply ignora o gate" | O caminho `--apply --autonomo` existe por desenho (`run.js`, linhas 75–80): `aprovacaoRef = 'ADR-019'`. A Central escolhe `--apply --autonomo` só quando `GUARDIAO_AUTONOMO === 'on'` **e** o canal de e-mail está configurado (`rotinas.js`, `jobs()`); sem a variável, volta a `--gate`. |
| "Restaura a regra inegociável de que envio externo exige aprovação humana" | A tabela de escalonamento (CLAUDE.md) foi alterada em 28/10: "Degrau 1 do Guardião … **autônomo com log** (ADR-019)". O analista da Central avaliou com a regra anterior. |
| "Evita contato duplicado quando as 20 aprovações antigas forem decididas" | Aprovar um cartão antigo **não reenvia o lote do cartão**: `run.js --apply --aprovacao <id>` só confere o status e recalcula o lote com o ledger atual; as casas já contatadas caem no cooldown de 24 h e, com `email_restaurante` já no ledger, seguem ao degrau 2 (fila humana). Os cartões, porém, são obsoletos e enganam o painel — ver `AC-20261031205157-e4e3`. |
| 24 envios até 31/10 | 24 reservas no ledger até 31/10 (20 + 2 + 2). Em 02/11 saiu mais 1 (BEIJING DADONG). Hoje: `enviados_total=25`, `casas_contatadas=24`, `ultimo_envio=2026-11-02T08:00:18Z`. Este relatório cobre os 25 registros = 24 e-mails. |

## 3. Como o modo mudou de gate para apply

- 28/10 08:01 UTC — rodada `gate` (`trc-guard-20261028`): cartão `APR-20261028080122-8021` com 18 casas, ledger `proposto` (não conta como contato por código: `CONTA = {enviado, fila_criada, aprovado}`).
- 28/10 — ADR-019 aceito; `run.js` ganha `--autonomo`; `rotinas.js` passa a montar `['--apply','--autonomo']` quando `GUARDIAO_AUTONOMO=on` e o webhook de e-mail existe.
- 29/10 08:00 UTC — primeira rodada `apply` (`trc-guard-20261029`): audit `autonomia_adr019` → `registro_optout_lido` → `delegadas_aria_whatsapp` (868QP9K5) → 19 `email_envio` → `execucao` (modo apply, 43 avaliadas, 20 `email_restaurante`, 0 bloqueado, 0 cooldown, 14 fora da janela).
- Evidência de que a variável está ligada: `GET /api/rotinas` em 03/11 traz `faltam: []` (a lista incluiria `GUARDIAO_AUTONOMO=on (Guardião só no portão — ADR-019)` se estivesse desligada), job `guardiao-gate` com `modo: "real"` e `exit 0`, e o evento `autonomia_adr019` em todas as seis rodadas.
- Fuso: as rotinas rodam às 9 h de Paris; por isso Ásia recebe às 15–16 h locais e as Américas ficam "fora da janela" (14–19 por dia), o que é o comportamento esperado da janela 08–22 h.

## 4. Tabela dos 24 envios (25 reservas)

Colunas: data/hora do envio (UTC); casa (`restaurant_id`, domínio do e-mail da casa — nunca o endereço); reserva; mesa (data e hora local); horas desde o pedido no momento do envio; hora local da casa no envio; opt-out (registro `listing_consent` + arquivo); WhatsApp vivo da casa; contatos da casa em 24 h / contatos da reserva; status da reserva em 03/11; classificação.

Todos: degrau **1**, canal **e-mail**, `aprovacao_ref` **ADR-019**, n8n **HTTP 200**, `published=true`, `partner=false`, `do_not_relist=false`, presente em `in:sent` do Gmail.

| # | Envio (UTC) | Casa (id · domínio) | Cidade | Reserva | Mesa | h desde pedido | h local | Opt-out | WhatsApp vivo | Contatos casa/24 h · reserva | Status 03/11 | Classificação |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 29/10 08:00:17 | PLUM (40772 · capesienna.com) | Phuket | 3QD93TGM | 02/11 06:00 | 3.682 | 15 | não | não | 1 · 1 | Pending, expirada 03/11 (pg_cron) | degrau 1 autônomo — ADR-019 |
| 2 | 29/10 08:00:19 | SAFRAN (301020 · safranmarrakech.com) | Marrakesh | NUWA4XQM | 07/11 20:00 | 1.043 | 9 | não | não | 1 · 1 | Pending | degrau 1 autônomo — ADR-019 |
| 3 | 29/10 08:00:21 | STRAVINSKIJ (43268 · roccofortehotels.com) | Roma | CZFHFBT2 | 08/11 17:30 | 132 | 9 | não | não | 1 · 1 | Pending | degrau 1 autônomo — ADR-019 |
| 4 | 29/10 08:00:22 | Karaköy Lokantası (17019 · karakoylokantasi.com) | Istambul | ZDPHVY9V | 09/11 20:30 | 868 | 11 | não | não | 1 · 1 | **Accept** (a casa respondeu por e-mail após o lembrete) | degrau 1 autônomo — ADR-019 |
| 5 | 29/10 08:00:24 | CHINA GRILL (16560 · hyatt.com) | Pequim | 4ATGW59Q | 11/11 19:00 | 832 | 16 | não | não | 1 · 1 | Pending | degrau 1 autônomo — ADR-019 |
| 6 | 29/10 08:00:26 | BAAN CHIANG (35171 · gmail.com) | Bangkok | 74F3AZAG | 23/11 19:00 | 1.055 | 15 | não | não | 1 · 1 | Pending | degrau 1 autônomo — ADR-019 |
| 7 | 29/10 08:00:28 | PIERLUIGI (44586 · pierluigi.it) | Roma | EAU7BN4T | 24/11 19:30 | 31 | 9 | não | não | 1 · 1 | Pending | degrau 1 autônomo — ADR-019 |
| 8 | 29/10 08:00:31 | LA FINE BOUCHE (13048 · gmail.com) | Chamonix | LF3LRM2L | 30/11 12:30 | 1.347 | 9 | não | não | 1 · 1 | Pending | degrau 1 autônomo — ADR-019 (1 e-mail com 2 reservas) |
| 9 | 29/10 08:00:31 | LA FINE BOUCHE (13048 · gmail.com) | Chamonix | EPJXRMDE | 06/12 20:00 | 1.671 | 9 | não | não | 1 · 1 | Pending | degrau 1 autônomo — ADR-019 (mesmo e-mail do nº 8) |
| 10 | 29/10 08:00:33 | PARTHENOPI (10547 · gmail.com) | Cannes | RWLY32CN | 01/12 20:00 | 426 | 9 | não | não | 1 · 1 | Pending | degrau 1 autônomo — ADR-019 |
| 11 | 29/10 08:00:34 | STAYA (281985 · staya-restaurant.com) | Paris | VMH6F4RB | 02/12 22:30 | 57 | 9 | não | não | 1 · 1 | Pending | degrau 1 autônomo — ADR-019 |
| 12 | 29/10 08:00:36 | TRATTORIA AL MORO (17051 · ristorantealmororoma.it) | Roma | PPVJSA7D | 16/12 19:30 | 4.806 | 9 | não | não | 1 · 1 | Pending | degrau 1 autônomo — ADR-019 |
| 13 | 29/10 08:00:38 | TERRAZZA BORROMINI (45387 · gmail.com) | Roma | YSSND9E8 | 22/12 20:30 | 2.509 | 9 | não | não | 1 · 1 | Pending | degrau 1 autônomo — ADR-019 |
| 14 | 29/10 08:00:40 | ÉBULLITION (75071 · restaurant-ebullition.fr) | Montpellier | YE2TCC5B | 25/12 19:30 | 665 | 9 | não | não | 1 · 1 | Pending | degrau 1 autônomo — ADR-019 |
| 15 | 29/10 08:00:42 | Onyx (28284 · doco.com) | Viena | KLAYYD49 | 31/12 23:00 | 2.894 | 9 | não | não | 1 · 1 | Pending (auto-resposta da casa em 29/10) | degrau 1 autônomo — ADR-019 |
| 16 | 29/10 08:00:44 | JADE DRAGON (22092 · cod-macau.com) | Macau | PWP2TZS6 | 01/01/27 12:00 | 1.381 | 16 | não | não | 1 · 1 | Pending | degrau 1 autônomo — ADR-019 |
| 17 | 29/10 08:00:46 | RAMIRO (16898 · cervejariaramiro.pt) | Lisboa | ZVJAHKLA | 05/01/27 16:30 | 350 | 8 | não | não | 1 · 1 | Pending | degrau 1 autônomo — ADR-019 |
| 18 | 29/10 08:00:48 | L'ATELIER D'EDMOND (13144 · atelier-edmond.com) | Val d'Isère | WWXQ4BGU | 13/01/27 12:30 | 94 | 9 | não | não | 1 · 1 | Pending | degrau 1 autônomo — ADR-019 |
| 19 | 29/10 08:00:49 | LI BAI (20485 · libairestaurant.com) | Singapore (país no catálogo: Malaysia) | G64948AS | 05/02/27 13:30 | 2.356 | 16 | não | não | 1 · 1 | Pending | degrau 1 autônomo — ADR-019 (idioma pelo país = inglês, sem efeito) |
| 20 | 29/10 08:00:51 | GAGGAN ANAND (35630 · gaggananand.com) | Bangkok | YNH2QEHT | 15/02/27 19:00 | 361 | 15 | não | não | 1 · 1 | Pending (mensagem da casa na própria thread minutos após o envio — provável auto-resposta) | degrau 1 autônomo — ADR-019 |
| 21 | 30/10 08:00:18 | IL BARETTO (18025 · ilbarettomilano.it) | Milão | YKK9GE6E | 11/11 12:30 | 38 | 9 | não | não | 1 · 1 | Declined (client) | degrau 1 autônomo — ADR-019 |
| 22 | 30/10 08:00:20 | ZUM SCHWARZEN KAMEEL (28234 · kameel.at) | Viena | WMBNCW3T | 24/11 18:00 | 42 | 9 | não | não | 1 · 1 | Pending | degrau 1 autônomo — ADR-019 |
| 23 | 31/10 08:00:20 | LA CLOSERIE (19438 · yahoo.fr) | Tunis | UW9VEACU | 07/11 21:00 | 36 | 9 | não | não | 1 · 1 | Pending | degrau 1 autônomo — ADR-019 |
| 24 | 31/10 08:00:21 | THE CLOUD (52907 · gmail.com) | Maldivas | F7B8UHA8 | 18/12 18:30 | 32 | 13 | não | não | 1 · 1 | Pending | degrau 1 autônomo — ADR-019 |
| 25 | 02/11 08:00:24 | BEIJING DADONG (19672 · 163.com) | Pequim | KZC7TC3N | 24/12 19:00 | 45 | 16 | não | não | 1 · 1 | Pending (já na fila do degrau 2 em 03/11) | degrau 1 autônomo — ADR-019 |

Fontes por coluna: envio e HTTP = `GET /api/logs?date=…` da Central (o mesmo `audit-<dia>.jsonl` que o `run.js` grava no volume, `TWK_STATE_ROOT=/app/state`); casa, reserva, mesa, pedido, status, `published`, `partner`, `do_not_relist`, consentimento = `twk_ro` em 03/11 (`reservations`, `db_restaurants`, `aria_contact_consent`, `v_listing_consent_atual`); opt-out em arquivo = `orchestrator/state/listing-consent.jsonl` (7 linhas: 15207, 92055, 70626, 31607) + os ids que o audit diz estarem só no arquivo hospedado (31607, 14384); hora local = fuso da casa no catálogo; Gmail = `in:sent after:2026/10/28 before:2026/11/04` com os assuntos de `templates.js`.

## 5. Efeito observado (fato, 03/11)

- 1 casa respondeu por e-mail e aceitou na plataforma: Karaköy Lokantası (reserva ZDPHVY9V hoje `Accept`).
- 2 mensagens automáticas ou imediatas (Onyx: auto-resposta; GAGGAN ANAND: mensagem na própria thread minutos após o envio, reserva segue `Pending`). 1 reserva recusada pelo cliente (IL BARETTO). 1 expirou pelo pg_cron (PLUM, mesa 02/11).
- 0 reclamações, 0 pedidos de remoção vindos das 24 casas na caixa de entrada entre 29/10 e 03/11 (busca por domínio).
- 19 das casas contatadas em 29/10 passaram ao degrau 2 em 30/10 (`fila_whatsapp=19`): fila humana em CSV, nada enviado.

## 6. Observações fora do veredito (não são violações, mas pedem decisão)

1. **O analista da Central julga com a regra velha.** O achado — e os dois anteriores sobre o mesmo tema, `AC-20261031205157-182e` e `AC-20261101205150-b0d0` — reafirma "envio externo exige aprovação humana", revogado para o degrau 1 em 28/10. O analista precisa ler `orchestrator/politicas/politicas.json` (ou o ADR-019) antes de abrir achado crítico; hoje ele vai reabrir o mesmo achado a cada rodada.
2. **Pendências zumbis entraram no lote.** Pedidos de abril (PPVJSA7D, 4.806 h), maio (3QD93TGM, 3.682 h), junho (KLAYYD49) e julho (YSSND9E8, G64948AS) receberam um "aguarda a sua resposta" meses depois. Está dentro da regra (≥ 24 h), mas é o caso de `AC-20261023000643-5a44` (degrau terminal para zumbis): cobrar uma casa por um pedido de seis meses não melhora a marca.
3. **20 cartões obsoletos na fila** (6 lotes de degrau 1 de 22–28/10 com as mesmas casas, 14 avisos de degrau 4 que o ADR-019 extinguiu). Aprová-los não reenvia e-mail (§2), mas confundem o painel e o analista. `AC-20261031205157-e4e3` já pede a invalidação.
4. **Opt-out de 14384 (Kitchen6) só existe no arquivo hospedado**, não em `listing_consent`. O Guardião leu e respeitou, mas a fonte única (ADR-010) está divergente.
5. **LI BAI (20485)**: cidade Singapore, país Malaysia no catálogo — já aberto em `AC-20261103190834-3359`.

## 7. Duas opções para o fundador (nenhuma executada aqui)

**Opção A — manter o apply, com as travas confirmadas.** Nada a mudar no Easypanel. O que este relatório confirma: as travas do ADR-019 funcionaram em 24/24 envios, com rastro completo (audit + ledger + Gmail). Custo: continuam saindo e-mails a pendências antigas até existir um degrau terminal. Complemento recomendado: fechar o achado `AC-20261103190834-5cdb` como "falso positivo — ADR-019", e os dois irmãos, e dar ao analista a leitura das políticas.

**Opção B — voltar ao gate.** Remover `GUARDIAO_AUTONOMO=on` no Easypanel da Central (ou `run.js --pause "motivo"` no volume, que bloqueia qualquer modo). A partir da rodada seguinte o Guardião volta a gerar um cartão por dia que ninguém decidiu desde 11/09 — foi exatamente esse vazio que o ADR-019 fechou (0 envios em 48 dias de portão). Só faz sentido se o fundador quiser rever o template ou a cadência antes de continuar.

Recomendação da auditoria: **A**, acompanhada de (i) degrau terminal ou corte de idade do pedido antes do degrau 1 (proposta a ser escrita, não existe ainda), (ii) invalidação dos 20 cartões obsoletos, (iii) analista lendo as políticas. Nenhuma das três é decidida neste documento.

## 8. Resumo em cinco linhas

1. Os 24 e-mails (25 reservas, 24 casas) enviados de 29/10 a 02/11 são todos degrau 1 autônomo dentro do ADR-019 / POL-009; nenhum envio está fora da regra.
2. Todas as travas foram conferidas no código, no audit da Central, no banco (`twk_ro`) e na caixa de saída do Gmail: opt-out, published, WhatsApp vivo, ≥ 24 h, 1 e-mail por casa, 1 contato por reserva, teto diário (máx. 19), janela local (8–16 h).
3. O achado parte da regra anterior a 28/10; `GUARDIAO_AUTONOMO=on` está ativo (rotinas sem "faltam", audit `autonomia_adr019` em todas as rodadas); quem ligou a variável não fica em log (lacuna).
4. Efeito: 1 casa respondeu e aceitou, 2 respostas automáticas, 0 reclamações; 19 casas seguiram ao degrau 2 (fila humana); pendências de até seis meses entraram no lote, dentro da regra mas sem valor para a marca.
5. Decisão do fundador: manter o apply (recomendado, com degrau terminal e cartões obsoletos invalidados) ou voltar ao gate; nada foi alterado ou enviado nesta auditoria.
