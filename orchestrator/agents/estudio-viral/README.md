# Estúdio Viral

Agente que escreve, **todo dia**, o pacote de conteúdo do @wantedchauffeur para o Julien filmar: 3 Reels (roteiro por
planos, texto de tela, voz off, legenda, hashtags), 1 story, 1 carrossel, respostas a comentários. Nasceu em 19/11/2026,
quando o Márlon decidiu que apoiamos o Julien no conteúdo e não só nas ferramentas.

## Como funciona

| Etapa | Arquivo | O que faz |
|---|---|---|
| Veille | `veille.js` | O modelo pesquisa na web (ferramenta de servidor `web_search`) o que está acontecendo hoje: GTA 6 e gaming, formatos de Reels da semana, Toulouse. Item sem URL é descartado. |
| Contexto | `contexto.js` | Lê a voz, as regras e as travas da skill (cópia em `skill/`), os números do Olheiro (se existirem), o calendário de Toulouse (`donnees/calendario.json`) e os pacotes dos últimos 7 dias (para não repetir). |
| Pacote | `pacote.js` | Pede ao modelo o JSON do pacote; **mede cada peça com o mesmo `wc.js` da skill** (gancho, minutagem por planos, legenda, travas); pede UMA correção ao modelo; o que continua bloqueado sai do pacote. |
| Texto | `render.js` | Markdown em francês « Pour Julien » e HTML sem script (CSP da Central). |
| Rodada | `run.js` | Junta tudo, grava no volume, relato ao MAESTRO, aviso opcional ao Julien pela Aria (uma linha com o link assinado). |
| Skill | `sincronizar-skill.js` | Copia a parte usada da skill `.claude/skills/wanted-chauffeur-studio` para `skill/` (o Dockerfile só vê `orchestrator/`). `--verificar` falha se a cópia estiver velha (está na Porta). |

Modelo: `ESTUDIO_MODEL` (padrão `claude-fable-5-1`, decisão do Márlon em 19/11; `claude-opus-5-5` é a opção mais barata), thinking adaptativo, `ESTUDIO_EFFORT` (padrão `high`). Uma rodada completa
faz 2 a 3 chamadas (veille, pacote, correção). A chave vem só do ambiente da Central.

## Onde roda e como ligar

Na Central hospedada, rotina diária `estudio-viral` (`command-center/rotinas.js`), **só quando** `ESTUDIO_VIRAL=on` e
`ANTHROPIC_API_KEY` existem. Estado em `/app/state/agents/estudio-viral/`: `veille-<dia>.json`, `pacote-<dia>.json`,
`pacote-<dia>.md`, `relato-<dia>.json`.

Para o Julien receber o link no WhatsApp: `ESTUDIO_AVISAR=on` + `ARIA_TEAM_ALERT_SECRET` + `CHAUFFEUR_CONFIRMA_URL` (+
`CHAUFFEUR_CONFIRMA_SECRET` ou `CENTER_TOKEN`). A página é `/studio/<dia>?t=<token>`, sem chave, sem script, sem PII.

Ligar o fluxo é decisão do fundador (tabela de escalonamento: novo fluxo em operação). Runbook: `docs/runbooks/estudio-viral.md`.

## O painel `/estudio` na Central (4.11.0)

| Área | O que tem |
|---|---|
| Hoje | Os 3 Reels com prévia animada (planos, texto de tela e voz no tempo certo), nota do gancho, estado (a filmar, filmado, publicado, descartado). Bancada por Reel: linha do tempo, edição com medida ao vivo, ganchos alternativos, legenda, lista de filmagem, legendas `.srt` para o CapCut, IA. Story, carrossel, respostas e « a evitar » com botão de copiar. |
| Laboratório | Um gancho por linha (`fala \| texto de tela`): nota, seis controles, conselhos e travas na hora, sem modelo. As 19 fórmulas da skill. Conferência de legenda. Com a chave da IA: 10 ganchos escritos e medidos para uma ideia. |
| Radar | Calendário de Toulouse (21 dias) e as novidades da pesquisa na web, com fonte. |
| Desempenho | Seguidores por dia, do roteiro ao resultado, por fórmula e por pilar, Reel por Reel. Cruza o Reel publicado com o post lido pelo Olheiro, pelo link. |
| Arquivo | Todos os dias com pacote. |
| Sistema | O que está ligado, o que falta e a última rodada. |

Peças novas: `timeline.js` (linha do tempo e `.srt`), `estado.js` (estado dos Reels e edições, append-only), `laboratorio.js`
(medidas da skill para o painel), `ia.js` (ganchos, reescrita de um Reel, juiz do primeiro quadro com visão), `desempenho.js`,
`dev-seed.js` (dados de ENSAIO, só no `dev-local.cjs`). Na Central: `command-center/estudio.js` e `public/estudio/`.

Regras do painel: a edição só salva se passar pelas travas (422 com o motivo); o Reel anterior fica em `edicoes.jsonl`; gerar de
novo guarda o pacote anterior em `arquivo/`; a proposta da IA volta como rascunho e nada é salvo sem o clique; a imagem do
juiz do quadro não é gravada. A página do Julien (`/studio/<dia>?t=`) tem prévia, lista de planos com marcação, teleprompter,
legenda, `.srt` e os botões « Filmé », « C'est publié » (com o link do post) e « Pas celui-là ». O que ele publica e descarta
entra no contexto dos próximos pacotes.

Ver localmente: `node orchestrator/command-center/dev-local.cjs` e abrir `http://localhost:8788/estudio`.

## O que ele não faz

Não publica, não comenta, não responde DM, não agenda. Não inventa número, cliente nem depoimento (`{{chiffre}}`). Não
cita preço fora da tabela aprovada (a trava barra). Não promete disponibilidade nem prazo. O Julien lê, filma, ajusta e publica.

## Uso à mão

```bash
node run.js --dia 2026-11-20 --fixture test/fixtures/pacote-2026-11-20.json --relato   # sem modelo: mede e renderiza
node run.js --sem-veille                                                                 # com chave: só calendário + Olheiro
node --test "test/*.test.js"
```

O pacote de 20/11 (`test/fixtures/pacote-2026-11-20.json`) foi escrito à mão em 19/11 a partir da pesquisa do dia (saída
do GTA 6, Marché de Noël de Lalande, Toulouse Game Show) e serve de gabarito: é o que um bom dia do modelo tem de parecer.
