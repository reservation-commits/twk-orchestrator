# Runbook — Políticas de aprovação, juízes, medidor de autonomia e Auditor Interno

> Criado em 2026-10-08. Implementa a proposta `docs/agentes/proposta-autonomia-98-2026-10-08.md` (itens T2, T3, T6 e A6). Zero LLM, zero rede, zero banco em todos os quatro módulos.

## 1. Motor de políticas — `orchestrator/politicas/`

A tabela de escalonamento do `CLAUDE.md` como código. Antes de executar uma ação, o agente (ou o Orquestrador) descreve a ação por **classe** e **atributos** e pergunta ao motor:

```bash
node orchestrator/politicas/avaliar.js --classe escrita_reversivel --agente dba --trace trc-x --atributos "{\"backup_declarado\":true,\"linhas_max_por_tabela\":40,\"toca_nextauth\":false,\"ddl\":false,\"porta_unica\":true}" --registrar
```

Resposta: `decisao` (`autonomo` · `autonomo_com_log` · `requer_aprovacao_orquestrador` · `requer_aprovacao_humana`), `politica` que decidiu, `motivo` e `faltam` (condições não atendidas, com o valor recebido). `--registrar` grava `politica_avaliada` no audit e consome o orçamento mensal da política.

Regras que o código impõe, e que nenhuma política muda:

| Regra | Efeito |
|---|---|
| `CLASSES_SEMPRE_HUMANO` (reembolso, DDL, nextauth, publicar/republicar, envio em massa, jurídico, imprensa…) | sempre `requer_aprovacao_humana`; o loader recusa política nessas classes |
| `status: "proposta"` | nunca aplicada; a resposta nomeia a proposta e a frase para aprovar |
| atributo ausente | condição não atendida (falhar alto) |
| classe sem política | humano |
| orçamento mensal (Europe/Paris) esgotado | cai para `requer_aprovacao_orquestrador` |
| política ativa sem `desfazer` | o arquivo não carrega |

Listar tudo: `node orchestrator/politicas/avaliar.js --listar`.

**Como aprovar uma proposta.** O fundador escreve a frase da política (ex.: `Aprovo PROP-101`) no chat. O Orquestrador então: (1) grava `aprovacao_adr`-like no audit com a frase, (2) muda `status` para `ativa` em `politicas.json`, (3) roda `node orchestrator/evals/run.js politicas` e o Auditor. Sem os três passos, a proposta não vale.

Propostas pendentes em 08/10: PROP-101 republicar após correção (Juiz de Catálogo ≥ 8) · PROP-102 envio a casa com opt-in (Juiz Comercial ≥ 8) · PROP-103 publicação editorial (Juiz Editorial ≥ 8) · PROP-104 correção no front com teste (Agente de Produto) · PROP-105 Telefonista (canário, continua humano por casa).

## 2. Juízes — `orchestrator/juizes/`

Padrão do Juiz de Conversa da Aria para peças de outros agentes. Critérios determinísticos; `eliminatorio` reprovado = nota 0; aprovado = nota ≥ 8; critério que lança exceção reprova.

| Juiz | Função | Alimenta | Eliminatórios |
|---|---|---|---|
| Catálogo | `julgarCatalogo(ficha, {dominios_mortos, cidades_canonicas})` | `juiz_catalogo_nota` (PROP-101) | opt-out ativo publicada · pedido de remoção publicada · despublicada com `ready_pending_photo` |
| Editorial | `julgarEditorial(peca, {titulos_existentes})` | `juiz_editorial_nota` (PROP-103) | `aggregateRating` sem review · idioma ≠ locale · vocabulário interno · promessa de confirmação/prazo · marca errada |
| Comercial | `julgarComercial(mensagem)` | `juiz_comercial_nota` (PROP-102) | opt-out não consultado/ativo · idioma ≠ casa · prazo de terceiro · marca errada · vocabulário interno |

Cada resultado traz `lacunas`: o que o juiz **não** vê (veracidade de fatos, foto, tom). Isso continua humano ou modelo.

## 3. Medidor de autonomia — `orchestrator/medidor-autonomia/medir.js`

```bash
node orchestrator/medidor-autonomia/medir.js --dias 30
```

Lê `orchestrator/logs/audit-*.jsonl`, classifica cada linha (autônoma · humana · aviso · falha · trava · ignorada) e grava `orchestrator/state/autonomia.json` + `orchestrator/logs/autonomia/AAAA-MM-DD.md`. Taxa = autônomas / (autônomas + humanas). Avisos ao fundador, falhas, travas de guardrail e telemetria ficam fora do denominador e são contados à parte.

Primeira leitura (08/10, 30 dias): **67%**, com 92 paradas humanas. As maiores: envio aprovado pelo fundador (56, Chave Girada) e escrita com frase (11, DBA). A taxa real é menor ou igual: aprovações dadas em chat sem linha no audit não aparecem.

Limites conhecidos: o hook `guard-sql.ps1` grava `guardrail_block` sem marcar teste, e a suíte `test-guards.ps1` produz 15 por rodada da Porta; por isso a trava é classe própria.

## 4. Auditor Interno — `orchestrator/auditor/verificar.js`

```bash
node orchestrator/auditor/verificar.js
```

16 checagens por código (10 `hard`, 6 `soft`) sobre o repositório e o estado: `outboundGate` nos dois canais, prompt da Aria sem prazo, porta única com `-- backup:`, políticas válidas, supressão no CLAVIS, JSON-LD sem rating falso, hooks presentes, DBA sem `postgres`, evals de injeção, Porta recente, autonomia medida, níveis alinhados ao contrato, cadências, reparos aprovados, compromissos vencidos, critério 404 no runbook de remoção. `hard` reprovada = Porta vermelha. Grava `orchestrator/state/auditor.json` e `orchestrator/logs/auditor/AAAA-MM-DD.md`.

## 5. Onde cada peça está ligada

- Porta de Qualidade (`orchestrator/porta/verificar.cjs`): etapa `auditor` nova; etapa `evals` passou de 6 para 10 suítes (`politicas`, `medidor-autonomia`, `juizes`, `auditor`).
- Sentinela (`cadencias.json`): `autonomia_medida` (7 dias, média) e `auditor_rodou` (7 dias, alta).
- Estado: `orchestrator/state/autonomia.json`, `auditor.json`, `politicas-orcamento.json`.

## 6. O que ainda depende do fundador

1. Ligar a Regência hospedada (Movimento 1 de 22/09): sem isso medidor, auditor e porta rodam só quando alguém abre o notebook.
2. Aprovar propostas PROP-101 a PROP-104 com a frase, uma a uma, ou dizer quais não quer.
3. Aprovar ao menos um procedimento em `reparos-aprovados.json` (hoje todos `false`: a autonomia de reparo do ADR-017 nunca entrou em vigor).
4. Acesso ao repositório do front para o Agente de Produto (PROP-104).
5. Decidir sobre a Telefonista (PROP-105).
