# Zelador de Privilégios

Vigia determinístico da credencial de banco. Nasceu da auditoria de 2026-09-21
(`docs/agentes/auditoria-frota-2026-09-21.md`): três agentes escrevendo como `postgres`,
dois papéis desenhados e nunca criados, e nada acusando.

**Não é agente novo** (ADR-009): é uma extensão do DBA no formato do relato (ADR-012),
sem LLM, sem escrita, credencial `twk_ro` — aborta se a sessão não for read-only.

```
node orchestrator/agents/zelador-privilegios/verificar.js            # relatório; sai 1 se houver crítico
node orchestrator/agents/zelador-privilegios/verificar.js --relato   # grava state/relato-<data>.json
```

| Checa | Severidade | Correção (humana) |
|---|---|---|
| agente configurado com usuário `postgres` | crítica | criar o papel desenhado e trocar a URL |
| papel esperado ausente (`twk_db_agent`, `quill_writer`…) | alta | executar o `.sql` do repositório do agente |
| SUPERUSER / CREATEROLE / CREATEDB / BYPASSRLS em papel de agente | alta | `ALTER ROLE … NOCREATEROLE NOCREATEDB` |
| papel de leitura sem `default_transaction_read_only=on` | alta | `ALTER ROLE … SET default_transaction_read_only = on` |
| DML em `reservations` ou `nextauth` por papel de agente (exceto `twk_dba` em `public`) | crítica | `REVOKE` |
| tabelas do Atlas dentro do `twk_auth` | média | `DROP` após confirmar 0 linhas |

Lê **só o usuário** das URLs nos `.env` locais — nunca a senha, nunca imprime a URL.
O que está no Easypanel não é visível daqui: lacuna declarada no relato.

Para entrar na Regência como coletor diário: importar `verificar.js` em
`command-center/regencia/coletores.js` e anexar os achados ao relato do `dba`.
É **novo fluxo orquestrado** — exige aprovação do fundador (constituição).
