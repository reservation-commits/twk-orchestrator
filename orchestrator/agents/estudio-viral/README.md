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

Modelo: `ESTUDIO_MODEL` (padrão `claude-opus-5-5`), thinking adaptativo, `ESTUDIO_EFFORT` (padrão `high`). Uma rodada completa
faz 2 a 3 chamadas (veille, pacote, correção). A chave vem só do ambiente da Central.

## Onde roda e como ligar

Na Central hospedada, rotina diária `estudio-viral` (`command-center/rotinas.js`), **só quando** `ESTUDIO_VIRAL=on` e
`ANTHROPIC_API_KEY` existem. Estado em `/app/state/agents/estudio-viral/`: `veille-<dia>.json`, `pacote-<dia>.json`,
`pacote-<dia>.md`, `relato-<dia>.json`.

Para o Julien receber o link no WhatsApp: `ESTUDIO_AVISAR=on` + `ARIA_TEAM_ALERT_SECRET` + `CHAUFFEUR_CONFIRMA_URL` (+
`CHAUFFEUR_CONFIRMA_SECRET` ou `CENTER_TOKEN`). A página é `/studio/<dia>?t=<token>`, sem chave, sem script, sem PII.

Ligar o fluxo é decisão do fundador (tabela de escalonamento: novo fluxo em operação). Runbook: `docs/runbooks/estudio-viral.md`.

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
