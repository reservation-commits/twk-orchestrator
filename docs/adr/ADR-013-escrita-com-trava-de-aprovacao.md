# ADR-013 — Escrita em produção com trava de aprovação (papel `twk_dba`)

**Data:** 2026-09-08 · **Decisor:** fundador ("Execute suas recomendações", após pedido inicial de "acesso TOTAL") · **Status:** aprovado; aguardando criação do papel pelo dono.

## Contexto

Toda escrita no `twk_auth` exigia execução manual do fundador (credencial de agente = `twk_ro`, somente leitura imposta no servidor). O atrito ficou evidente no caso Marlon Food: até apagar um restaurante de teste virava "rode você mesmo o SQL". O fundador pediu acesso total para o agente DBA; o custo disso seria perder a propriedade que nos protegeu na semana de 01–07/09 (vários defeitos operacionais, zero dados tocados — porque escrita era impossível, não apenas proibida), num ambiente com tentativa de injeção via dado observado já registrada e 21,7 mil clientes de PII no banco.

## Decisão

Criar o papel **`twk_dba`**: escrita de LINHAS com teto imposto pelo servidor, sem chave-mestra. Três camadas independentes:

| Camada | O que impõe |
|---|---|
| **Servidor (privilégios do papel)** | SELECT/INSERT/UPDATE/DELETE em `public`; **sem** DDL, TRUNCATE nem mudança de privilégios (o papel não é dono de nada); `nextauth` somente leitura; `statement_timeout` de 60s |
| **Hooks (`.claude/hooks/guard-sql.ps1`)** | inalterados por este ADR: DROP/TRUNCATE sempre bloqueados; DELETE/UPDATE sem WHERE; tautologias; concessões amplas de privilégio |
| **Executor (`orchestrator/agents/dba-escrita/executar.js`)** | única porta de escrita dos agentes: aprovação do fundador obrigatória e gravada no audit (`--aprovacao`); palavras estruturais recusadas; transação obrigatória (`begin`/`commit` no arquivo); DELETE exige backup declarado no cabeçalho e executado ANTES, gravado em `~/.twk/backups/` (fora do OneDrive); sha256 do arquivo e linhas afetadas no audit |

DDL, migração, TRUNCATE, restore e escrita em contas de cliente (`nextauth`) continuam **exclusivamente humanos**.

## Consequências

- Pedidos como o do Marlon Food passam a ser: fundador aprova por frase → agente executa com backup e trilha → verificação pós-execução pela réplica. Minutos, não dias.
- O teto de dano de um agente comprometido cai de "perder o banco" para "mexer em linhas de `public`, com backup e auditoria".
- Segredos de escrita vivem em `~/.twk/` (nunca em pasta sincronizada). Pendência herdada e assumida: `.env.readonly.local` ainda mora no OneDrive — migrar no mesmo padrão.
- Validador do executor coberto por 6 casos (5 bloqueios: estrutural, DELETE sem WHERE, DELETE sem backup, fora de transação, tautologia; 1 válido), rodados em 08/09. Incorporar ao eval harness é o próximo passo.
- Primeira execução real prevista: exclusão do Marlon Food (`proposta-exclusao-marlon-food-2026-09-08.exec.sql`), com a aprovação já dada em chat.
