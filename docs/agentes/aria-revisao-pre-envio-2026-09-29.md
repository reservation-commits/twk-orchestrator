# Aria v10 e v11 — nenhuma resposta sai sem duas revisões; a data prometida é cumprida (29/09/2026)

Pedido do fundador: *"transforme a Aria em um agente perfeito segundo suas funções, ferramentas e poderes. Não permita erros."*

O que "não permitir erros" significa em código: **a Aria não decide sozinha se a própria resposta está boa.** Duas revisões independentes leem cada carta antes de sair, e quando as duas reprovam, a carta não sai — vai para você, com o motivo.

## O erro que motivou (fato, 29/09)

O Juiz de Conversa, na primeira rodada, reprovou uma resposta enviada por e-mail em francês: prometia prazo ("d'ici vendredi 3 octobre en fin de journée") e expunha processo ("j'ai relancé le restaurant", "en attente de réponse"). A porta de regras não conhecia essas formas em francês, e o Juiz lê só uma vez por dia, depois do envio.

## O caminho único de entrega (`src/entrega.ts`)

```
modelo escreve
   → 1ª revisão: regras (porta única, agora com prazo/data e processo em pt/en/fr/es/it)
   → 2ª revisão: leitura semântica (modelo barato, a MESMA régua do Juiz — ADR-015)
   → reprovou?  → o modelo recebe os motivos e REESCREVE a carta inteira (uma vez)
   → reprovou de novo? → RETIDA: nada sai; rascunho e motivo no painel; escalação ALTA
```

Vale igual para WhatsApp e e-mail. Não existe mais um envio que não passe por aqui.

O que barra na revisão semântica: prazo prometido, discrição (processo, fila, espera por terceiro), vocabulário interno, idioma diferente do cliente. "Resolve agora" e "tom" ficam só registrados.

Se o revisor semântico estiver fora do ar, valem as regras e abre-se aviso ALTA (uma vez por hora). Nunca "ok" silencioso.

## O que ficou registrado

- `aria_prechecks`: uma linha por tentativa (aprovada ou não), com origem (regra ou juiz), motivos e um trecho de 300 caracteres. Permite medir: taxa de reescrita, taxa de retenção, motivos mais comuns.
- Escalação `ALTA` com o texto "resposta ao cliente RETIDA" — o cliente ficou sem resposta e alguém precisa responder pelo painel.
- Sentinela: vigia `aria_resposta_retida` (alta, 24 h).

## Custo e latência

Uma chamada extra ao modelo barato por resposta (≈ 1–2 segundos, centavos por dia). Reescrita só quando reprovou: uma chamada extra ao modelo principal, rara por construção.

## O que ainda NÃO é "perfeito" e depende de decisão

1. ~~Compromisso com data~~ — **resolvido na v11** (abaixo).
2. **Quatro números sob controle humano até 2027** — a Aria fica muda com eles por decisão de configuração, não por erro.
3. **Papel de banco da Aria** (`aria_service`): ela ainda entra como dono. É DDL, exclusivamente humano.

## Variáveis

`REVISAO_PRE_ENVIO=false` desliga só a leitura semântica (emergência). As regras nunca se desligam.

## v11 — a Aria cumpre a data que promete

Antes: a data de retorno era proibida porque nada garantia o retorno. Agora existe o processo do ADR-015:

1. Na carta, a Aria só pode dizer "volto a você até sexta" se chamar a ferramenta `registrar_compromisso` na mesma resposta (data de hoje a 7 dias, o que vai trazer, código da reserva). Sem o registro, a porta barra a data como antes. Prazo de terceiro (resposta do restaurante) continua proibido.
2. O compromisso fica em `aria_commitments`, com o contexto da thread de e-mail.
3. No dia, a Aria abre a conversa sozinha, consulta a reserva pelas ferramentas e escreve ao cliente com o que existe: confirmação, alternativas em casas que confirmam pedidos, ou o que já está feito. A carta passa pelas mesmas duas revisões.
4. E-mail: responde na mesma thread. WhatsApp: só com a janela de 24 h aberta; fechada, vira escalação ALTA para envio humano (não existe template de "voltei a você").
5. Retida na revisão, ou envio falhou → escalação ALTA. A Sentinela acusa compromisso vencido não cumprido como **crítico**.

Efeito na satisfação: o cliente que ficou sem resposta do restaurante deixa de ficar no vácuo. Recebe uma data, e na data recebe a Aria — mesmo que a notícia seja "ainda nada, aqui estão duas alternativas".
