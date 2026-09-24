# Migrations versionadas

Toda mudança de schema passa por aqui — o agente tem DDL **bloqueado** em runtime
(`execute_mutation` rejeita CREATE/ALTER/DROP) exatamente para que o schema só
evolua por este ledger reproduzível.

## Uso

```bash
node scripts/migrate.mjs --status    # o que está aplicado/pendente
node scripts/migrate.mjs --dry-run   # simula
node scripts/migrate.mjs             # aplica pendentes (transação por arquivo)
```

## Regras

1. Nome: `NNNN_descricao.sql` (ordem lexicográfica = ordem de aplicação).
2. **Nunca edite uma migration já aplicada** — o checksum trava o conteúdo; crie uma nova.
3. Idempotência é bem-vinda (`IF NOT EXISTS`), mas o ledger é a fonte da verdade.
4. Cada arquivo roda dentro de uma transação; falhou → rollback e o runner para.
