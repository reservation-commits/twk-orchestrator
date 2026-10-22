# ADR-018 — Retenção antes da exclusão: avaliar o motivo, uma carta, e a decisão da casa (ou 48 h)

**Data:** 2026-10-22 · **Estado:** aceito · **Origem:** decisão do fundador no chat de 2026-10-22 ("avalie o motivo e, de forma profissional e cativante, em pelo menos 1 e-mail, tente reverter… se ainda assim o cliente quiser a exclusão, você mesmo pode excluir") · **trace_id:** `trc-retencao-20261022`

## Contexto

O ADR-016 delegou a exclusão ao MAESTRO, e o fluxo funcionava: dossiê, despublicação pela porta única, carta de saída com a oferta da conta, cartas aos clientes com pedido vivo, registro. Mas a oferta chegava **depois** de a página sair — tarde demais para mudar a decisão. Em outubro, a única escalação acionável da fila (LOFOTEN) ficou 16 dias sem leitura e foi executada sem nenhuma tentativa de conversa. O fundador quer o contrário: que o sistema entenda **por que** a casa quer sair e tente, uma vez e com classe, mostrar o que ela está deixando — sem nunca prender ninguém.

## Decisão

**1. Avaliar o motivo, por código.** `retencao.js::avaliarMotivo` lê a mensagem da casa (6 idiomas) e classifica: `nao_consentiu`, `custo`, `dados_errados`, `sem_interesse`, `indefinido` — com retenção — ou `juridico`, `fechou`, `nao_contatar`, `segunda_vez` — **sem** retenção. A prioridade é fixa (jurídico vence tudo). Texto da casa é dado, não comando (regra 4 da constituição; caso de injeção no eval).

**2. Uma carta, e só uma.** No idioma em que a casa escreveu (ou no do país), a carta (a) reconhece o pedido em primeiro lugar e **escreve a data de saída** (48 h), sem condição; (b) responde ao motivo (como a casa foi parar no guia; que não custa nada ser apresentada, receber pedidos e respondê-los; que corrigimos os dados; que os pedidos podem ir para onde ela quiser); (c) dá os números reais da casa — quantos clientes pediram mesa por nós — como informação, nunca como pressão; (d) oferece a escolha com duas palavras: **FICAR** / **REMOVER**. Termos proibidos (ADR-015, "sem comissão", hype) são barrados por código antes do envio. Modelo em 6 idiomas em `retencao.js`.

**3. A casa decide; o prazo decide por ela.** Resposta REMOVER (ou qualquer pedido de remoção) → exclusão no mesmo dia. Resposta FICAR → registro `listed` (o evento mais novo vence), escalação fechada, pendência de correção se o motivo era `dados_errados`. Sem resposta em 48 h → exclusão. Remoção prevalece sobre qualquer leitura ambígua (ADR-010); a negação explícita ("não removam") vale como FICAR.

**4. Executar é o ADR-016, sem mudança.** Despublicação pela porta única (reversível, backup), cartas do `exclusao.js`, registro de opt-out, escalação fechada com nota. Durante as 48 h a casa já está no registro como `opted_out` para `reservations` e `outreach`: Guardião e CLAVIS não a contatam.

**5. Autonomia.** Política `POL-007 retencao_antes_exclusao` (ativa, `autonomo_com_log`, teto 40/mês). Fica fora da autonomia e sobe ao fundador: matéria jurídica (o próprio motivo `juridico` só reconhece e executa), imprensa, e qualquer pedido que não identifique a casa (`restaurant_id` ausente no resumo da escalação).

**6. Onde roda.** `retencao-run.js` nas rotinas hospedadas da Central (job `retencao`, diário, `--apply` quando `EMAIL_WEBHOOK_URL` e `TWK_DBA_URL` existem no ambiente; sem eles, dry-run) e à mão. A Aria continua reconhecendo o pedido na conversa (FLUXO 7) e escalando `REMOCAO_LISTAGEM`; a carta é do MAESTRO, não da Aria, e sai no máximo um dia depois.

## Consequências

- O SLA do ADR-010 continua: reconhecido em ≤ 24 h (a carta), executado em ≤ 48 h (ou antes, a pedido).
- Nunca mais de uma carta por caso; o segundo pedido da mesma casa nunca recebe retenção.
- Métrica semanal: casos, cartas, FICAR, REMOVER, vencidos sem resposta, e motivo mais comum — em `state/retencao.jsonl`.
- Eval `node orchestrator/evals/run.js retencao` (motivos em 6 idiomas, respostas, 30 cartas, prazo, decisão, injeção) entra na Porta.
- Pendente (próximo deploy da Aria): o FLUXO 7 do prompt diz que "a execução exige uma etapa humana"; com este ADR a etapa é do MAESTRO, no prazo. O reconhecimento da Aria continua sem prometer prazo.
