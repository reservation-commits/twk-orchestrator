# ADR-021 — Zelador de Ações: a Central se limpa sozinha, e um tema é uma ação

**Data:** 2026-11-23 · **Estado:** aceito · **Origem:** pedido do fundador no chat de 2026-11-23 ("não quero ficar olhando problemas e clicando em botões pra serem resolvidos, quero um sistema de solução de problemas autônomo") · **trace_id:** `trc-adr021-20261123`

## Contexto

Em 23/11 a Central tinha **103 ações abertas e 19 aprovações pendentes**. Lidas uma a uma: 95 ações eram o analista de IA repetindo o
mesmo tema em dias seguidos com títulos ligeiramente diferentes (o Quill fora do ar aparecia 8 vezes, a latência da Aria 8, a verificação de
catálogo 7); as 19 aprovações eram cartões do Guardião de 22 a 28/10 (lotes do degrau 1 e avisos de degrau 4) cujas mesas já tinham passado
há um mês. A própria Central recomendava, desde 27/10, "expirar cartões de aprovação obsoletos" (AC-20261027000159-1c02) e "invalidar os
lotes de degrau 1 antigos antes que aprovação tardia duplique envios" (AC-20261031205157-e4e3). Ninguém clicou. A triagem manual daquele dia
negou 18 cartões e descartou 52 ações, todos com motivo (`orchestrator/logs/triagem-acoes-2026-11-23.jsonl`).

Fila que só cresce não é segurança: esconde o que importa (um cliente com mesa em menos de 6 h, a retenção falhando, o Quill em 502) atrás de
cem repetições. A tese do ADR-019 vale aqui: escalar para humano não é segurança quando o humano não está lá.

## Decisão

**1. Zelador de Ações** (`orchestrator/command-center/zelador-acoes.js`), todo dia depois das rotinas hospedadas e sob demanda
(`GET /api/zelador/acoes` = ensaio, `POST` = aplica), com estas regras e nenhuma outra:

| Regra | O que fecha | Como |
|---|---|---|
| A1 | aprovação pendente do Guardião "Degrau 4 — avisar cliente … (mesa em Nh)" cuja mesa já passou | negada, motivo com a data da mesa |
| A2 | aprovação pendente "Degrau 1 — lote de e-mails" com mais de 48 h | negada: o degrau 1 roda sozinho desde o ADR-019; reenviar duplicaria cobrança |
| B1 | ação do analista repetida (mesmo agente, mesmo tema, semelhança ≥ 0,45 entre títulos) | descartada; fica a mais recente, e a descartada aponta para ela |
| B2 | ação do analista sem atualização há 21 dias | descartada; se o problema persistir, o analista reabre com dados novos |

O Zelador **nunca aprova**: aprovar vira envio ou handoff, e isso continua sendo decisão de gente. Ações de vigia (`origem: vigia`) não
são tocadas: `resolveStale` já as fecha quando o sinal some. Toda decisão grava o motivo no item e o evento `zelador_acoes` no audit.
Idempotente. Política `POL-010` (`triagem_central`, autônomo com log).

**2. Um tema, uma ação.** O analista, antes de abrir ação, procura ação aberta parecida do mesmo agente (`temaParecido`, mesma régua da
regra B1) e, se encontrar, **atualiza** essa ação (ocorrências +1, diagnóstico novo) em vez de abrir outra. O número de ações passa a medir
temas, não dias.

**3. O que a rotina diz quando falha.** A rotina de retenção grava no caso o último erro e quantas vezes falhou seguido
(`ultimo_erro`, `falhas_seguidas`) e imprime a falha na saída que a Central mostra. E `GET /api/rotinas/log?job=&dia=` devolve a cauda do
log de qualquer rotina sem entrar no container.

**4. O que continua humano, sem exceção.** Tudo da tabela de escalonamento: dinheiro ao cliente, cartão ou pagamento exigido por terceiro,
jurídico, imprensa, publicar/republicar, DDL e `nextauth`, reiniciar serviço fora do ar (o Quill em 502 em 23/11 só volta pelo Easypanel),
e qualquer aprovação cuja mesa ainda está no futuro (ex.: UJDWPGTW no LOFOTEN, mesa em 19/12).

## Consequências

- A fila da Central passa a ter um item por tema vivo. Em 23/11: de 103 para 51 ações e de 19 para 1 aprovação, e assim fica.
- Risco aceito: a régua de semelhança pode juntar dois temas parecidos do mesmo agente. Mitigação: a descartada aponta a mantida
(`mantida_em`), o motivo diz "repetição", e reabrir é um clique na Central. O analista continua vendo as abertas no prompt.
- O que falta para "autônomo" virar "resolvido": os reparos determinísticos (`reparos-aprovados.json`) só têm `rerodar_tarefa_agendada`;
reiniciar um serviço no Easypanel exigiria a API do Easypanel e um procedimento aprovado. Proposta registrada, não executada.

## Como desfazer

Reabrir o item na Central (status `aberta`/`pendente`) ou deixar a vigia/analista reabrir. `ZELADOR_ESTAGNADA_DIAS` muda o prazo da regra B2.
Desligar: remover a chamada em `rotinas.js` (`executar`), ou `POL-010` para `revogada`.
