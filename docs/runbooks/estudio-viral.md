# Ligar o Estúdio Viral (pacote diário de conteúdo do @wantedchauffeur)

O Estúdio escreve todo dia, em francês, 3 Reels medidos (roteiro, tela, voz, legenda), 1 story, 1 carrossel e respostas a
comentários, a partir do que está acontecendo hoje (pesquisa na web), dos números da conta (Olheiro) e das travas do projeto.
O Julien recebe um link no WhatsApp, lê no celular, filma e publica. Nada é publicado sozinho.

Ligar é pôr um fluxo novo em operação: pela constituição, é decisão do fundador. Fazer os passos abaixo é a aprovação.

## 1. Easypanel, serviço da Central (Environment) e Deploy

```
ESTUDIO_VIRAL=on
ANTHROPIC_API_KEY=<já existe se o cérebro do MAESTRO está ligado>
ESTUDIO_MODEL=claude-opus-5-5          (opcional; padrão)
ESTUDIO_EFFORT=high                    (opcional; padrão)
```

Pronto quando: `GET /api/rotinas` (com X-Center-Key) lista o job `estudio-viral` e, depois da primeira rodada,
`GET /api/estudio/pacote` devolve o pacote do dia.

## 2. O link do Julien (opcional, recomendado)

```
ESTUDIO_AVISAR=on
ARIA_TEAM_ALERT_SECRET=<o mesmo da Aria>     (já usado pelo Olheiro e pela agenda)
CHAUFFEUR_CONFIRMA_URL=https://<central>      (já usado pelo link de confirmar)
```

Com isso, a cada rodada o Julien recebe UMA linha: « Le pack vidéo du jour est prêt (3 Reels à filmer) : https://…/studio/2026-11-20?t=… ».
A página é só leitura, sem script e sem dado de cliente; o token vale só para aquele dia.

## 3. Conferir

- `GET /api/estudio/dias` → os dias com pacote.
- `GET /api/estudio/pacote?dia=AAAA-MM-DD` → JSON + markdown + link.
- Relato ao MAESTRO em `state/agents/estudio-viral/estudio-viral.json` (status `ok` · `parcial` · `bloqueada`).
- Pacote `bloqueada` = nenhum Reel passou pelas travas: ler `pacote-<dia>.json` (campo `_verificacao.problemas`).

## Custo (ordem de grandeza)

2 a 3 chamadas por dia ao modelo (veille com até 8 buscas, pacote, correção). Com `claude-opus-5-5`, algo como 0,30 a 0,80 €
por dia, dependendo do tamanho da veille. Medido pelo `usage` gravado em `pacote-<dia>.json`.

## Rodar à mão (sem ligar a rotina)

```
POST /api/rotinas/run?so=estudio-viral     (X-Center-Key)
```

## Se der errado

| Sintoma | Causa provável | O que fazer |
|---|---|---|
| job não aparece | `ESTUDIO_VIRAL` ≠ `on` ou chave ausente | conferir as duas variáveis e Deploy |
| `bloqueada` todo dia | travas barrando tudo (ex.: o modelo insiste em pôr GTA na tela) | ler `_verificacao.problemas`; ajustar o prompt em `pacote.js` ou as travas na skill |
| Julien não recebe | falta `ESTUDIO_AVISAR`, segredo da Aria ou `CHAUFFEUR_CONFIRMA_URL` | `GET /api/estudio/link` diz o motivo |
| página 404 | token de outro dia ou segredo trocado | pegar o link de novo em `/api/estudio/link?dia=` |
