# ADR-017 — Autonomia ampliada com desfazer

**Data:** 2026-09-21 · **Status:** **APROVADO em 2026-09-22** — frase do fundador no chat: "Aprovo ADR-017" (audit `trc-adr017`) · **Decisor:** fundador
**Em vigor:** `TWK_AUTONOMIA_ESCRITA=on` e `TWK_AUTONOMIA_MAX_LINHAS=200` gravados em `~/.twk/dba.env`; tabela de escalonamento do `CLAUDE.md` atualizada no mesmo ato. Pendente: colagem 2 do runbook (`GRANT CREATE` ao `twk_dba`) para a DDL aditiva; aprovação individual de cada reparo em `reparos-aprovados.json`.

## Contexto

O fundador pediu, em 21/09, agentes com autoridade para "criar, apagar, construir e desfazer, sempre que for preciso", sem que cada ação volte para a mesa dele — e, ao mesmo tempo, sem "ações desajustadas, bugs ou erros ridículos".

A tabela de escalonamento vigente (constituição, ADR-013) coloca todo DELETE atrás de aprovação humana por execução. Isso protegia porque não havia como desfazer. A partir de hoje há: o executor grava backup com metadados de chave primária e `desfazer.js` restaura qualquer apagamento ou alteração em um comando.

O que se aprendeu nas semanas de 01–21/09: as travas não reduziram autonomia — **foram elas que a permitiram**. A Aria só recebeu o atendimento inteiro (ADR-014/016) depois da porta única de saída; o Guardião só opera porque tem 49 casos de eval. Poder sem reversibilidade não é autonomia: é aposta.

## Decisão (proposta)

**Princípio:** o que é reversível e pequeno é autônomo; o que é irreversível, externo ou financeiro continua com aprovação. O interruptor da autonomia é ligado **uma vez** pelo fundador, fora do OneDrive.

| Ação | Antes (ADR-013) | Agora |
|---|---|---|
| INSERT em tabelas do negócio (`public`) | aprovação por execução | **`AUTONOMO_COM_LOG`** pela porta única |
| UPDATE / DELETE **com backup declarado**, ≤ 200 linhas por tabela, sem `nextauth` | aprovação por execução | **`AUTONOMO_COM_LOG`** (`--autonomo`), desfazível em um comando |
| UPDATE / DELETE sem backup, ou acima do teto | aprovação | aprovação (o executor recusa `--autonomo`) |
| Criar conta de restaurante na plataforma, apagar contato, corrigir dado | aprovação | **autônomo** (são DML reversíveis acima) |
| `CREATE TABLE` / `ALTER TABLE … ADD COLUMN` no schema `public` | humano | **`twk_dba` ganha CREATE no schema** → executor aceita DDL aditiva com `--aprovacao` (não autônoma nesta versão) |
| `DROP TABLE`, `TRUNCATE`, `DROP COLUMN` | humano | humano — com o ponto-no-tempo do Cloud SQL como rede |
| Papéis de banco, `nextauth`, restore, migração de schema | humano | humano — não têm desfazer |
| Reparos determinísticos (rerodar tarefa, religar coletor) | inexistentes | **autônomos após aprovação única do procedimento** (`reparos-aprovados.json`) |
| Dinheiro, envio externo em massa, `published`, jurídico, imprensa | aprovação | aprovação — inalterado |

## Mecanismo (já construído)

1. `~/.twk/dba.env`: `TWK_AUTONOMIA_ESCRITA=on` (o interruptor) e `TWK_AUTONOMIA_MAX_LINHAS=200` (o teto).
2. `dba-escrita/executar.js --apply --autonomo`: só passa se `verificarReversibilidade()` aprovar (todo DELETE/UPDATE com `-- backup:` da própria tabela; nada de `nextauth`) e cada backup tiver ≤ teto. Grava `_meta.json` com chave primária por tabela. Auditoria com `modo: autonomo`.
3. `dba-escrita/desfazer.js --ultimo --apply --motivo "…"`: UPSERT das linhas antigas pela chave primária. Tabela sem chave simples → recusa.
4. Um papel de escrita para a operação inteira: `twk_dba` — usado pelo executor, pelo app do DBA e pelos 35 scripts (`db-config.js` e `lib/db.ts` preferem `~/.twk/dba.env`). Uma porta, um papel, uma trilha.
5. `sentinela-silencio/reparar.js` + `reparos-aprovados.json`: procedimentos aprovados uma vez, executados sempre.
6. Eval `dba-escrita` (44 casos) cobre validação, reversibilidade e o UPSERT de restauração; nada entra em canário sem harness verde (ADR-011).

## Consequências

- O fundador deixa de aprovar apagamento de contato, correção de dado e criação de conta de restaurante. Aprova **procedimentos**, não execuções.
- Todo erro dessas classes custa um comando de desfazer, não um dia.
- O teto de dano de um agente comprometido continua sendo "linhas de `public`, com backup e auditoria" — agora com restauração garantida.
- Fica **exclusivamente humano**: criar papel, tocar `nextauth`, `DROP`/`TRUNCATE`, restore. São as únicas coisas sem desfazer.
- Pré-requisito de rede de segurança: **point-in-time recovery** ligado no Cloud SQL (conferir no console: instância → Backups). Sem ele, a coluna "humano" desta tabela não deve ser afundada mais.

## Como entra em vigor

Uma frase do fundador no chat ("aprovo o ADR-017") + `TWK_AUTONOMIA_ESCRITA=on` em `~/.twk/dba.env`. A constituição (`CLAUDE.md`, tabela de escalonamento) é atualizada no mesmo ato.
