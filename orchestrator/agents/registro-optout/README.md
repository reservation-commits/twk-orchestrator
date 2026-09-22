# Registro de Opt-out de Listagem & Intake de Remoção — código

Spec: `docs/agentes/agente-registro-optout.md` · ADR-010. **Não é agente**: extensão de Aria (FLUXO 7 + tags `REMOCAO_LISTAGEM`/`CORRECAO_LISTAGEM`) + DBA (migração) + regras determinísticas.

| Arquivo | Papel |
|---|---|
| `registro.js` | fonte interina `orchestrator/state/listing-consent.jsonl` (append-only; último evento vence); `bloqueiaContato(rid, reg, escopo)` consultado por Guardião/CLAVIS; `carregar()` lança se o arquivo faltar (fail-closed) |
| `classificador.js` | classificador determinístico multilíngue (remoção · correção · reclamação · prospect · spam · outro) + detecção de injeção; remoção prevalece sobre tudo |
| `varredura.js` | rede de segurança diária: classifica um export de mensagens e gera relatório; dry-run, nunca grava no registro |
| `rodape-optout.js` | rodapé de opt-out/correção em 5 idiomas para todo e-mail em massa (`temOptout(html)` para testes) |
| `migracao-listing_consent.sql` | DDL proposta (tabela append-only, view do estado atual, projeção `do_not_relist`, trigger que bloqueia republicação) — **execução do fundador** |

Eval: `node orchestrator/evals/run.js registro-optout` (43 casos, sem LLM). Casos com modelo (FLUXO 7) em `Agente de Suporte e Concierge/eval/cases.ts` (`npm run eval`, exige `ANTHROPIC_API_KEY`).

Fluxo operacional: e-mail → Aria classifica (FLUXO 7) e escala → humano aprova reconhecimento (24h) → DBA despublica + flag + silêncio da Aria (48h, aprovação do fundador) → registro recebe evento `sla_done_at` só quando a página responder 404.
