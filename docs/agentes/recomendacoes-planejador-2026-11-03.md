# Recomendações · Planejador (COMPASSO) e gestão de tarefas da operação

> 2026-11-03 · trace `trc-planejador1102` · Para: fundador · De: Orquestrador
> Base: `docs/agentes/agente-planejador.md` (spec v1), linha P da matriz de lacunas, arquivos de estado lidos em 02 e 03/11.
> Formato: cada recomendação diz o que decidir, a resposta que recomendo e por quê. Rotulagem FATO · SUPOSIÇÃO · SEM DADO.

## Resumo em cinco linhas

1. **Aprovar o Planejador como agente novo**, com o escopo do dossiê e sem ferramenta de envio externo. É o único componente que fecha o ciclo achado → tarefa → cobrança → efeito medido.
2. **Não comprar gerenciador de tarefas.** Livro único no Postgres, página na Central, Notion só como espelho de leitura se um dia fizer falta.
3. **Fazer a triagem das filas agora, antes do agente existir.** Dos 13 compromissos vencidos, a maioria é de setembro e já foi superada pelos fatos. Fechar o que morreu, executar o que ainda vale.
4. **Fixar três números-norte** no ADR. Sem eles, "sugerir otimizações" não tem limite nem medida.
5. **Construir e ensaiar agora, canário só depois de 21/11**, respeitando o ciclo de duas iniciativas por 30 dias.

## As recomendações

### R1 · Aprovar o agente e abrir o ADR-020

- **Decidir:** o Planejador nasce como agente novo (não como extensão do MAESTRO nem do Orquestrador).
- **Recomendo:** sim, com o ADR-020 escrito a partir do dossiê, com estas cláusulas inegociáveis: zero envio externo; fechamento só com evidência; prioridade fixa para remoção, opt-out, jurídico e dado de cliente; teto de 5 itens novos por dia ao fundador; classes sempre-humanas continuam humanas.
- **Por quê:** FATO: 24 achados do vigia abertos desde 13/09 e nenhum fechado; 13 compromissos vencidos; 10 aprovações e 8 perguntas paradas. O MAESTRO detecta e relata, o Orquestrador roteia uma cadeia por vez. Ninguém é dono da carteira ao longo de semanas. Extensão do MAESTRO misturaria a voz do dia com o plano da semana e concentraria ainda mais num componente que já faz Regência, atendimento e Despacho.

### R2 · Livro único no Postgres, não em SaaS nem em arquivo

- **Decidir:** onde vive a fonte única de tarefas.
- **Recomendo:** quatro tabelas `plan_*` em `public`, eventos append-only por trigger, papel `twk_plan` restrito. Pede a sua frase pela porta única (`CREATE TABLE`) e a criação do papel, que é sempre humana.
- **Por quê:** Postgres é o barramento que Aria hospedada, Central, scripts locais e n8n já alcançam, e já tem o padrão de auditoria (`agent_audit_log`). Arquivo no volume da Central foi o que gerou as oito filas de hoje. SaaS externo viraria segunda verdade e daria aos agentes credencial que não precisam ter. Notion: só espelho de leitura, uma via, se você quiser consultar do celular; decidir isso na fase 3, não agora. Trello: não, a skill existente é um formatador de cartões, não uma integração.

### R3 · Triagem única das filas esta semana, antes do agente

- **Decidir:** se a limpeza espera o agente ou acontece agora.
- **Recomendo:** agora, numa sessão de 30 a 45 minutos comigo, item a item, com três saídas possíveis: fazer, delegar com prazo, ou fechar como superado com motivo gravado.
- **Por quê:** FATO: dos 13 compromissos vencidos, 10 venceram entre 17 e 25 de setembro e tratam da Operação Lagos (presencial, depois substituída por telefone), das sequências T1/T2 de e-mail, do convite do ELEOS e de uma cliente que cancelou ela mesma. SUPOSIÇÃO: a maior parte está superada pelos fatos e nunca foi fechada porque não havia quem fechasse. Dois itens parecem vivos e envolvem cliente: a carta à cliente da reserva SYG8R6HF (LA PETITE MAISON, vencida em 21/09) e o repasse da confirmação do SevenRooms à cliente do pedido EAU7BN4T (vencido em 29/10). Esses dois não devem esperar agente nenhum. Das 24 ações do vigia, 14 estão marcadas críticas, 10 delas de atendimento; precisam de leitura humana uma vez.

### R4 · Três números-norte no ADR

- **Decidir:** contra o que o Planejador otimiza.
- **Recomendo:** (1) jantares confirmados por mês, que é a meta da estratégia de 30/09; (2) serviços de chauffeur confirmados, com a meta de 26 até 11/11 já dada por você; (3) taxa de autonomia da frota, hoje 56,7%, meta 98%. Qualquer proposta de otimização precisa declarar qual dos três ela mexe e em quanto. Proposta que não mexe nenhum dos três não nasce.
- **Por quê:** "acompanha números e sugere otimizações" sem norte vira lista infinita de melhorias plausíveis, e você já tem o Analista produzindo isso. O que falta é escolha, e a escolha é sua, não do modelo.

### R5 · Construir agora, canário depois de 21/11

- **Decidir:** o calendário.
- **Recomendo:** 03 a 09/11 construção e dry-run local sobre dados reais; 10 a 20/11 dry-run nas rotinas hospedadas, com rascunho do Plano da Semana enviado a você para calibrar, sem publicar; a partir de 21/11 canário com cobrança real a agentes; primeira leitura do critério de morte em 20/01/2027.
- **Por quê:** a Constituição limita a duas iniciativas por 30 dias e ADR-018 (22/10) e ADR-019 (28/10) ainda estão assentando: Aria v24 e Guardião autônomo precisam de dados antes de um terceiro componente mexer na fila deles. Você pode encurtar com a frase; eu não recomendo.

### R6 · Confirmar que o Analista está ligado na Central hospedada

- **Decidir:** nada; é verificação.
- **Recomendo:** conferir no Easypanel que `ANTHROPIC_API_KEY` está presente e `MAESTRO_ANALYST` não está em `off`, e ler `analyst-runs.jsonl` no volume. Teto atual: 2 rodadas por dia.
- **Por quê:** SEM DADO se o Analista roda na hospedada. O Planejador se alimenta das propostas dele; sem Analista, trabalha só com vigia, compromissos e filas, e as propostas de otimização ficam pobres.

### R7 · Fila do fundador com teto e sem e-mail

- **Decidir:** como os itens chegam até você.
- **Recomendo:** só pelo Despacho e pela página `#/plano` da Central; no máximo 5 itens novos por dia; item repetido mantém o mesmo id. Alerta no WhatsApp só para item crítico, e só quando o seu número estiver configurado no canal (pendência de 05/10).
- **Por quê:** FATO: 196 e-mails em 22 dias em setembro por bug de agendamento; o despacho por e-mail foi desligado em 24/09. Qualquer aviso novo repete essa regra.

### R8 · Código dentro do repositório raiz, não em repositório próprio

- **Decidir:** onde o agente mora.
- **Recomendo:** `orchestrator/agents/planejador/`, como o Guardião, com eval em `orchestrator/evals/planejador/`.
- **Por quê:** a Porta de Qualidade, o Auditor e a Sentinela já cobrem a raiz; os quatro agentes com repositório próprio ficam fora dessas vigias. Um agente cuja função é vigiar o plano precisa estar sob a vigia.

### R9 · Modelo e custo

- **Decidir:** teto.
- **Recomendo:** Fable 5.1 para o Plano da Semana e a redação de propostas, máximo 2 chamadas por dia, teto €15 por mês com alerta a €12. Sem chave, o ciclo determinístico roda igual.
- **Por quê:** o núcleo não precisa de modelo. O modelo escreve, não decide.

### R10 · Codinome

- **Decidir:** COMPASSO ou outro.
- **Recomendo:** COMPASSO. Direção e cadência, no padrão de nomes da frota.

## O que recomendo NÃO fazer

- Não comprar Notion, Trello, Linear ou Asana como fonte de verdade. Viola a regra 1 e a regra 5 da Constituição.
- Não dar ao Planejador nenhuma ferramenta de envio, nem "só para lembrete". Se precisar, é outro ADR.
- Não ligar canário no notebook. O relógio é a Central hospedada.
- Não pular os evals nem a Porta. Agente sem eval verde não entra em canário, e este agente é o que vai cobrar os outros.
- Não deixar o modelo criar ou alterar meta. Meta é frase do fundador.

## O que precisa de você, em ordem

| # | O quê | Quando |
|---|---|---|
| 1 | Sessão de triagem das filas (R3) | esta semana |
| 2 | Os dois itens de cliente vivos: carta SYG8R6HF e repasse EAU7BN4T | antes da triagem, se possível |
| 3 | Aprovar o ADR-020 e os três números-norte (R1, R4) | antes de 09/11 |
| 4 | Frase para as tabelas `plan_*` e criação do papel `twk_plan` (R2) | antes de 10/11 |
| 5 | Confirmar Analista ligado na hospedada (R6) | antes de 10/11 |
| 6 | Ler e calibrar os rascunhos do Plano da Semana | 10 a 20/11 |
| 7 | Frase do canário, se quiser antes de 21/11 (R5) | a seu critério |

## Divergências e lacunas registradas

- **SEM DADO:** se o Analista roda na Central hospedada; quantas das 24 ações críticas ainda são verdadeiras hoje (o vigia fecha como "resolvida" quando a condição normaliza, mas 0 fechadas sugere que a reavaliação não está rodando ou que as regras não normalizam).
- **SUPOSIÇÃO:** que a maioria dos 13 compromissos vencidos está superada. Só a triagem confirma.
- **FATO:** o medidor de autonomia foi lido pela última vez em 28/10. Rodar `orchestrator/medidor-autonomia/medir.js` antes de fixar a baseline do ADR.
