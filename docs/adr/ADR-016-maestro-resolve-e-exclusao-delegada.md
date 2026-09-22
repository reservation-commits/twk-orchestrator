# ADR-016 — O MAESTRO resolve, e a exclusão de estabelecimento é delegada

**Data:** 2026-09-11 · **Estado:** aceito · **Origem:** decisão do fundador no chat de 2026-09-11 · **trace_id:** `trc-exclusao-20260911`

## Contexto

O ADR-014 já dizia que o atendimento se resolve ponta a ponta, mas na prática o sistema continuava produzindo fila: 11 escalações abertas, a mais antiga de julho, e um pedido de remoção de estabelecimento (La Petite Maison, 10/09) que ninguém tinha executado 24 horas depois — enquanto três clientes seguiam esperando mesa numa casa que já havia pedido para sair.

A trava estrutural era a tabela de escalonamento: **toda** mudança de `published` exigia aprovação humana. Isso transformava o fundador no gargalo do caso mais sensível e mais regulado que temos — o pedido de saída de um estabelecimento —, justo aquele em que a demora tem custo jurídico.

## Decisão

**1. Resolver é a função principal do MAESTRO.** Cliente ou estabelecimento com um problema é assunto meu, do primeiro contato até o fim. Sobem ao fundador apenas: matéria jurídica, imprensa, qualquer valor ao cliente (reembolso, desconto, cortesia) e o que for gravíssimo em risco de marca ou de segurança. Nada mais.

**2. A exclusão de estabelecimento passa a ser delegada.** Quando uma casa pede para sair, eu executo, nesta ordem, sem esperar ninguém:

1. **Identificar.** Ninguém age sobre um id solto. Monta-se o dossiê: quem é a casa, cidade, desde quando está no catálogo, quantos pedidos recebeu, quantos aceitou, se tem conta, quem está esperando mesa agora.
2. **Honrar.** Despublicação pela porta única do DBA (ADR-013): `published=false`, `do_not_relist=true`, `ready_pending_photo=false` (sem isto o republicador em lote desfaz a saída) e o **motivo gravado** em `operational_status_reason`. Nenhum DELETE: nada some, e a decisão fica auditável.
3. **Oferecer, uma vez.** Na mesma carta, a conta profissional gratuita, com os números reais daquela casa — quantos clientes a procuraram e quantos ficaram sem resposta. Atraente, concreta e **jamais como condição para a saída**. A saída já está feita quando a carta chega; a conta é o caminho de volta, não o pedágio.
4. **Não deixar cliente na mão.** Quem tinha pedido vivo recebe carta com duas casas equivalentes na mesma cidade, com link de reserva, e o compromisso de que eu acompanho até a confirmação.
5. **Registrar.** Linha no Registro de Opt-out (fonte única do "não contatar", consultada por Guardião e CLAVIS), ledger próprio e auditoria com trace_id.

**3. Ordem obrigatória, imposta por código.** A carta diz "a sua página saiu". O `exclusao.js` recusa enviá-la enquanto a casa ainda estiver publicada. Dizer ao estabelecimento algo que ainda não é verdade é o mesmo defeito do incidente da Aria.

**4. Verificar na origem, não na borda.** A página pode continuar respondendo 200 por alguns minutos depois da despublicação: é cache do Cloudflare. A conferência válida usa cache-buster. Confirmado hoje: Cañete (despublicado em 28/08) responde 404, e La Petite Maison passou a responder 404 na origem no mesmo minuto.

## O que continua exigindo o fundador

Republicar uma casa que pediu para sair; qualquer DELETE, DDL, migração ou restore; matéria jurídica, imprensa e dinheiro. E o teto de orçamento do ADR-004 segue valendo.

## Consequências

- O caso mais regulado que temos deixa de esperar por uma pessoa. Em compensação, ele passa a ter um ritual fixo e auditável — dossiê, motivo gravado, registro, cartas — e não uma decisão avulsa.
- O risco de despublicar por engano é contido por três camadas: o papel `twk_dba` não faz DDL, o executor exige aprovação e transação, e o SQL traz um `assert` de contagem que aborta se atingir mais de uma linha.
- A oferta da conta vira o único momento comercial do fluxo, e ela nunca atrasa nem condiciona a saída. Se a casa aceitar, republicar é decisão do fundador.
- Ferramenta: `orchestrator/agents/maestro-atendimento/exclusao.js` (dry-run por padrão, `--restaurante`, `--motivo` obrigatório, `--apply --aprovacao`).

## Primeira aplicação

LA PETITE MAISON (Sainte-Maxime, `restaurant_id` 92055), que pediu a supressão em 10/09 alegando nunca ter consentido com a listagem. Dossiê: no catálogo desde 25/07/2023, 60 pedidos recebidos, 3 confirmados, 29 no último ano, sem conta própria. Despublicada em 11/09 com motivo gravado, registrada no opt-off, carta de saída com a oferta da conta, e três clientes com pedido vivo (11/09, 12/09 e 26/09) atendidos individualmente com duas casas equivalentes em Sainte-Maxime.
