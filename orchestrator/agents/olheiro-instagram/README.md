# Olheiro do Instagram

Agente que lê a conta do **@wantedchauffeur** uma vez por dia, pela API oficial da Meta, e **só lê**. Nasceu em
14/11/2026, a pedido do fundador, para dar à skill Wanted Chauffeur Studio os números reais da conta.

## O que ele faz

| Peça | Arquivo | O que faz |
|---|---|---|
| Cliente | `api.js` | Fala com a Meta só por GET. Esconde o token de todo erro. Métrica recusada vira lacuna, não queda. |
| Coleta | `coletar.js` | Conta, métricas do dia, público (semanal), posts e Reels com métricas, stories no ar, comentários sem nome de quem comentou, marcações, contas de referência. |
| Cérebro | `cerebro.js` | Histórico por post, diário no formato da skill, alertas, fila de comentários, resumo e relato ao MAESTRO. Sem LLM. |
| Rodada | `run.js` | Junta tudo e grava no volume. `--relato` grava o relato do dia. `--fixture` ensaia sem a Meta. |
| Chave | `renovar-chave.js` | Renova a chave de 60 dias do login do Instagram e mostra a nova. Não grava nada. |

## Onde roda

Na Central hospedada, como rotina diária (`command-center/rotinas.js`), **só quando** `IG_ACCESS_TOKEN` existe no
ambiente. Estado em `/app/state/agents/olheiro-instagram/`: `estado.json`, `resumo.json`, `journal.jsonl`,
`anotacoes.json`, `relato-<dia>.json`.

## Quem lê o que ele grava

- **O chat do Claude**, pelo conector do COMPASSO: `instagram_painel`, `instagram_posts`, `instagram_diario`,
  `instagram_comentarios`, `instagram_anotar`. A Central serve os dados em `/api/instagram*` com a chave da Central.
- **O MAESTRO**, pelo relato (`contracts/relato.schema.json`, agente `olheiro-instagram`) e pelo coletor da Regência.
- **A Sentinela**, que acusa a rotina parada (`cadencias.json`, chave `olheiro_instagram`).

## Alertas e achados

| Achado | Quando | Severidade |
|---|---|---|
| Pedido de reserva sem resposta | comentário que pede preço, data ou reserva, sem resposta há 30 min | alta, dono Julien |

**Aviso ao Julien (14/11):** a Central roda `run.js --comentarios` a cada 5 minutos. Pedido de reserva sem resposta
há 30 minutos, feito nas últimas 24 h, vira um pedido à Aria (`POST /webhook/alerta-equipe`, nome "julien", nunca o
número), que manda no WhatsApp: "Tem um pedido de reserva não respondido nesse post:" e o link. Um aviso por pedido.
| Reel decolando | 2× a mediana dos outros Reels na mesma idade, com 3+ comparáveis | info, MAESTRO repassa |
| Tentativa de manipulação | comentário que tenta dar ordem ao assistente | média, só registro |
| Chave vencendo | 10 dias antes de `IG_TOKEN_EXPIRA_EM` | alta |
| Sem credencial | chave ausente, vencida ou sem permissão | alta |

## O que ele não faz

Não publica, não comenta, não responde, não manda DM e não mexe no perfil. Escrever na conta é outra fase e precisa da
frase do fundador (tabela de escalonamento: publicação em canal oficial e envio externo).

## Testes

```bash
node --test "test/*.test.js"
```

Meta simulada: token que não vaza, métrica recusada, comentários classificados, alerta de Reel, relato sem PII, o
diário lido pelo `bilan` da skill. Está na Porta de Qualidade (chave `olheiro`).

Como ligar: `docs/runbooks/olheiro-instagram.md`.
