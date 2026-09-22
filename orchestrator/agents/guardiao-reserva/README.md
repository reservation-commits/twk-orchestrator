# Guardião da Reserva — código

Spec: `docs/agentes/agente-guardiao-reserva.md` · Arquitetura: `docs/agentes/03-arquitetura-integracao.md` · ADR-009/011.

| Arquivo | Papel |
|---|---|
| `engine.js` | núcleo puro (sem I/O, sem LLM): `avaliar({agora, reservas, restaurantes, bloqueios, contatosMortos, eventos, config})` → decisões por reserva, propostas (e-mails agrupados por casa, fila humana, clientes a avisar), contagens, anomalias |
| `templates.js` | e-mail do degrau 1 em PT/EN/FR/ES/IT (com rodapé de opt-out) e rascunho estruturado do degrau 4 (validado contra tokens proibidos) |
| `db.js` | leitura via `twk_ro` (aborta se a sessão não for read-only); nunca seleciona PII de cliente |
| `run.js` | cron/manual: `dry-run` (padrão) · `--gate` (fila de aprovações da Central) · `--apply --aprovacao <id>` (envio do lote via n8n `maestro-email`) · `--pause` / `--resume` · `--canario "Paris,Athens"` · `--max-emails N` |
| `state/` | `eventos.jsonl` (ledger append-only), `propostas-<data>.json`, `fila-ligacoes-<data>.csv`, `decisoes-<data>.json`, `relatorio-<data>.md`, `PAUSADO` |

Eval: `node orchestrator/evals/run.js guardiao-reserva` (44 casos, sem LLM). Reprovado em `hard` → não entra em canário.

Variáveis: `N8N_MAESTRO_EMAIL_URL`, `N8N_MAESTRO_EMAIL_TOKEN` (só para `--apply`), `TWK_LINK_RESPOSTA` (padrão `https://theworldkeys.com/r/`), `TWK_GO_BASE` (link de opt-out), `TWK_RO_ENV` (caminho alternativo do `.env.readonly.local`).

Regras que o código impõe e nenhum prompt altera: registro de opt-out ilegível → execução bloqueada; opt-out/`published=false`/`do_not_relist` → sem contato ao restaurante; máx. 2 contatos por reserva; 1 e-mail/casa/24h; 50 e-mails/dia; janela 08–22h local; `dry-run`/`gate` não contam como contato no ledger.
