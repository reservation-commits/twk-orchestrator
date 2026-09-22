# Regência do MAESTRO — os agentes reportam, o MAESTRO decide, o fundador recebe um despacho

ADR-012. Contrato: `orchestrator/contracts/relato.schema.json`.

```
agentes/coletores ──(relato v1)──► consolidar ──► decisões por autonomia ──► Despacho do MAESTRO
   dba · guardiao · registro-optout · comercial · suporte · editorial · financeiro · central
                                         │                                     │
                                         ├─► acoes.jsonl (críticos/altos, dedup) ├─► STATE_DIR/despachos/<data>.md
                                         └─► relatos/<data>/*.json               ├─► missoes/D-<data>.md (Central)
                                                                                 └─► e-mail ao fundador (MAESTRO_FOUNDER_EMAIL)
```

| Arquivo | Papel |
|---|---|
| `db.js` | leitura única do `twk_auth` via `twk_ro` (aborta se não for read-only) |
| `coletores.js` | um relato por agente; sem credencial/fonte = status + lacuna (falhar alto) |
| `consolidar.js` | Estado do Sistema: manchete, sinais de conversão, experiência, decisões por nível de autonomia |
| `despacho.js` | corpo determinístico + "voz do MAESTRO" opcional (Opus 4.8; **Fable 5.1 quando há crítico ou decisão de marca/legal/dinheiro**), custo em EUR e-4 |
| `run.js` | ciclo `diario` (Despacho) ou `horario` (só alerta crítico novo, dedup 24h); exporta `executar()` para o cron da Central |
| `agendar.ps1` | registra as tarefas no Windows (execução manual, com aprovação) |

Modos de operação:
- **Local (esta máquina):** `node orchestrator/command-center/regencia/run.js` — lê banco (credencial do DBA), estado do Orquestrador e do Guardião; grava na Central local; e-mail só com `EMAIL_WEBHOOK_URL` + `MAESTRO_FOUNDER_EMAIL`.
- **Hospedado (EasyPanel):** `REGENCIA_ENABLED=on` + `REGENCIA_HORA=8` + `DATABASE_URL_RO` no serviço da Central; o servidor roda o ciclo diário e o horário sozinho, com os KPIs das APIs dos agentes injetados. O estado do Guardião chega por `push-state.ps1` (ou o Guardião passa a rodar hospedado — próximo passo).

Nível de autonomia por tipo de decisão (código, não prompt): `autonomo`/`autonomo_com_log` → "em curso"; `requer_aprovacao_orquestrador` → MAESTRO decide com justificativa gravada; `requer_aprovacao_humana` → "Precisa de você" com prazo. O despacho nunca executa: envio externo, `published`, DDL, dinheiro e má notícia continuam no Portão.
