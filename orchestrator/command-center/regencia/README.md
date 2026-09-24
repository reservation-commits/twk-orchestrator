# Regência do MAESTRO — os agentes reportam, o MAESTRO decide, o fundador recebe um despacho

ADR-012. Contrato: `orchestrator/contracts/relato.schema.json`.

```
agentes/coletores ──(relato v1)──► consolidar ──► decisões por autonomia ──► Despacho do MAESTRO
   dba · guardiao · registro-optout · comercial · suporte · editorial · financeiro · central
                                         │                                     │
                                         ├─► acoes.jsonl (críticos/altos, dedup) ├─► STATE_DIR/despachos/<data>.md
                                         └─► relatos/<data>/*.json               ├─► missoes/D-<data>.md (Central)
                                                                                 └─► (exceção) alerta curto por e-mail: só crítico novo, ≤1/dia
```

**Desde 2026-09-24 o Despacho é pull, não push** (decisão do fundador: 196 e-mails em 22 dias sem utilidade — a tarefa horária perdia o `--modo horario` por um `$args` do PowerShell e mandava o Despacho completo a cada hora). Regras em código:
- O Despacho diário fica na Central (`despachos/` + Missões). **Nunca vai por e-mail.**
- E-mail só como exceção: `MAESTRO_ALERTA_EMAIL=on` liga um **alerta curto** (só itens críticos novos + onde decidir), dedup por chave de `REGENCIA_ALERTA_DEDUP_DIAS` (7) dias, **teto de 1 envio por dia** (`regencia-alertas.jsonl` guarda `email_enviado_em`). `MAESTRO_DESPACHO_EMAIL` não vale mais.
- Toda decisão é botão na Central: nenhuma frase pede "responda este e-mail" (`limpar()` reescreve; teste cobre).
- Item que já aparece há mais de `REGENCIA_DIVIDA_DIAS` (3) dias sai de Urgente/Importante e vai para **"Esperando decisão"**, listado uma vez com a data desde quando espera (`historico.js`, lendo `relatos/<dia>/estado-do-sistema*.json`). O que sumiu desde o último Despacho aparece em **"Resolvido"**.
- `MAESTRO_CENTRAL_URL` (opcional) vira link no rodapé e no alerta.

| Arquivo | Papel |
|---|---|
| `db.js` | leitura única do `twk_auth` via `twk_ro` (aborta se não for read-only) |
| `coletores.js` | um relato por agente; sem credencial/fonte = status + lacuna (falhar alto) |
| `consolidar.js` | Estado do Sistema: manchete, sinais de conversão, experiência, decisões por nível de autonomia |
| `despacho.js` | corpo determinístico + "voz do MAESTRO" opcional (Opus 4.8; **Fable 5.1 quando há crítico ou decisão de marca/legal/dinheiro**), custo em EUR e-4 |
| `historico.js` | memória curta: idade de cada item (novo × dívida), resolvidos, dedup do alerta, teto de e-mail — funções puras sobre o estado gravado |
| `run.js` | ciclo `diario` (Despacho na Central) ou `horario` (só crítico novo, dedup 7 dias); exporta `executar()` para o cron da Central |
| `agendar.ps1` | registra as tarefas no Windows (execução manual, com aprovação). As duas tarefas da Regência estão **desabilitadas desde 2026-09-24** |
| `test/despacho.test.js` | 7 testes do redesenho; roda na porta de qualidade (`--so regencia`) |

Modos de operação:
- **Local (esta máquina):** `node orchestrator/command-center/regencia/run.js` — lê banco (credencial do DBA), estado do Orquestrador e do Guardião; grava na Central local; alerta por e-mail só com `MAESTRO_ALERTA_EMAIL=on` + `EMAIL_WEBHOOK_URL` + `MAESTRO_FOUNDER_EMAIL`.
- **Hospedado (EasyPanel):** `REGENCIA_ENABLED=on` + `REGENCIA_HORA=8` + `DATABASE_URL_RO` no serviço da Central; o servidor roda o ciclo diário e o horário sozinho, com os KPIs das APIs dos agentes injetados. O estado do Guardião chega por `push-state.ps1` (ou o Guardião passa a rodar hospedado — próximo passo).

Nível de autonomia por tipo de decisão (código, não prompt): `autonomo`/`autonomo_com_log` → "em curso"; `requer_aprovacao_orquestrador` → MAESTRO decide com justificativa gravada; `requer_aprovacao_humana` → "Precisa de você" com prazo. O despacho nunca executa: envio externo, `published`, DDL, dinheiro e má notícia continuam no Portão.
