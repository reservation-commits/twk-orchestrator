# ADR-019 — Autonomia no atendimento comum: a Aria e o Guardião resolvem sem pedir e sem escalar

**Data:** 2026-10-28 · **Estado:** aceito · **Origem:** decisão do fundador no chat de 2026-10-28 ("sobre muitas coisas mais comuns, quero que a Aria e o guardião sejam autônomos, porém façam um trabalho confiável e extremamente profissional, sem precisar me pedir ou escalar para humanos") · **trace_id:** `trc-adr019-20261028`

## Contexto

O levantamento de 27/10 (`docs/auditoria/levantamento-whatsapp-2026-10-27.md`) mediu o que a autonomia atual produzia: em 30 dias, 10 de 30 rascunhos da Aria foram retidos na revisão e viraram escalação para uma pessoa que não lê a fila (6K9UTC47 venceu sem aviso; o Marriott/Kitchen6 esperou três dias); parte das retenções era falso positivo do próprio revisor (nome do restaurante e "The World Keys" lidos como vocabulário interno; "você recebe o e-mail assim que confirmarem" lido como prazo) e dois bugs da porta de saída (acentos, formas de tratamento). O Guardião, por sua vez, nunca enviou nada: o degrau 1 esperava um cartão de aprovação que ninguém aprovava (9 cartões de 11/09 ainda pendentes) e o degrau 4 duplicava o que a Aria já faz sozinha desde a v16/v22. E em 28/10 um aviso do SevenRooms exigindo cartão até 18:17 foi tratado como ruído.

A conclusão do fundador é a tese deste ADR: **escalar para humano não é segurança quando o humano não está lá.** Segurança é código que não deixa o destinatário sem carta, não mente, não promete prazo de terceiro e registra tudo.

## Decisão

**1. Silêncio é decisão, não retenção.** A resposta `[[SILENCIO]]` do modelo (ruído: newsletter, relatório de SaaS, auto-resposta) é registrada em `aria_scope_blocks` (camada semântica, com o comentário do modelo) e **não** abre escalação. (`entrega.ts`)

**2. Três tentativas, depois a carta de espera — nunca o vazio.** Rascunho reprovado → reescrita com os trechos exatos → terceira tentativa em modo estrito (carta de até 5 frases, estrutura fixa) → se ainda reprovar, a **carta de espera** determinística (`fallbackCarta.ts`, 6 idiomas, cliente e estabelecimento): diz o que é verdade (a mensagem está com a Aria) e a data em que **ela** volta, registrada em `aria_commitments` e cumprida por `compromissos.ts`. A carta passa pela porta de saída com o compromisso como a única data permitida. Escalação `RESPONDER` só se nem a carta de espera passar. Política `POL-008`.

**3. Revisor calibrado.** A régua do Juiz (pré-envio e diário) ganha a lista do que **não** é violação (nome da casa, marca, código, link, "você recebe a confirmação automaticamente", "conta profissional", "página de reserva") e a obrigação de citar o trecho literal que motivou cada zero — a reescrita recebe o trecho, não a categoria. (`juizRegua.ts`)

**4. Aviso de sistema de reservas é ação, não ruído.** `avisoOperacional.ts` reconhece SevenRooms, TheFork, OpenTable, Resy, Zenchef, TableCheck, Quandoo, Bookatable, Tock, CoverManager e Guestonline. **Cartão ou pagamento exigido → escalação `PEDIDO_ESPECIAL` ao fundador com casa, cliente, data e prazo** (pagamento é sempre humano, tabela de escalonamento), sem resposta ao endereço automático. Cancelamento e confirmação pelo sistema seguem para o modelo com a instrução de agir pelas ferramentas (LEI 17 do prompt).

**5. Guardião: degrau 1 autônomo; degrau 4 é da Aria.** Nas rotinas hospedadas, com `GUARDIAO_AUTONOMO=on` e o canal de e-mail configurado, `run.js --apply --autonomo` envia o lote do degrau 1 (e-mail de lembrete à casa, pedido ≥ 24 h sem resposta) sem cartão. Tetos inalterados (ADR-009): 50 e-mails/dia, 1 e-mail por casa por 24 h, 2 contatos por reserva, janela de horário local, registro de opt-out consultado (ilegível = bloqueado), `published=false` nunca contatada. **Casas com WhatsApp marcado e que entrega ficam com a Aria** (pedido novo com botão + lembrete de 24 h): o Guardião as exclui do lote. Degraus 2 e 3 (WhatsApp a casa sem canal) continuam fila humana em CSV; o degrau 4 (aviso ao cliente) deixa de gerar cartão: é a cadência da Aria (`pending_nudge` 24 h, `pending_close` véspera, por WhatsApp ou e-mail). Política `POL-009`.

**6. O que continua humano, sem exceção.** Dinheiro ao cliente (reembolso, desconto, cortesia, compensação), cartão/pagamento exigido por terceiro, jurídico, imprensa, publicar/republicar, DDL e `nextauth`, pedido de remoção com base jurídica, modelo fora do ar. Nada deste ADR toca a tabela de escalonamento nesses pontos.

## Consequências

- A fila `aria_escalations` deve conter quase só o que uma pessoa precisa fazer. Medida: escalações `RESPONDER` por mês (meta: 0) e `aria_prechecks` origem `fallback` (meta: < 5 % das respostas; acima disso o prompt está errado, não a trava).
- `aria_commitments` passa a ter compromissos automáticos: a Sentinela (`aria_compromisso_vencido`) acusa qualquer um vencido sem cumprimento.
- O Guardião passa a produzir ledger `enviado` todo dia; a Sentinela acompanha pelo `rotina_central` (`guardiao_gate`).
- Variáveis novas no Easypanel da Central: `GUARDIAO_AUTONOMO=on` (e o canal de e-mail já existente). Sem elas, tudo continua como antes — o código não assume o sim.

## Verificação

- Aria v24 (`2026-10-28-v24-autonomia-adr019`): testes `fallbackCarta.test.ts` (toda carta passa pela porta com o compromisso, nos 6 idiomas; sem compromisso é retida), `avisoOperacional.test.ts` (caso Pierluigi), suíte completa verde.
- Guardião: `run.js` em dry-run mostra "Delegadas à Aria"; `--apply --autonomo` só com canal de e-mail; auditoria `autonomia_adr019` em cada rodada.
- `orchestrator/auditor/verificar.js` confere que `POL-008`/`POL-009` existem e que `entrega.ts` ainda chama a porta de saída antes da carta de espera.
