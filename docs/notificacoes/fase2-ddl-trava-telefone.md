# Proposta de DDL — registro de qualidade de telefone

> Proposta para aprovação do fundador. **Nada foi executado.**
> Dono: Orquestrador · Escrita: `orchestrator/agents/dba-escrita/executar.js`
> Base factual: `docs/notificacoes/fase0-validacao-telefones.md` (2026-09-21)

## O que muda em relação ao que eu propus antes

Na Fase 0 eu sugeri colunas `phone_e164` e `phone_status` em `nextauth."User"`.
**Retiro a proposta.** Dois motivos apareceram depois:

1. `nextauth."User"` é tabela da plataforma. O papel `twk_dba` não escreve em
   `nextauth` por desenho (ADR-013), e mexer no schema de autenticação para um
   dado derivado inverte a posse: o telefone continua sendo da plataforma.
2. A trava de envio **não precisa da coluna**. Ela já existe em código
   (`src/phoneQuality.ts`), roda a cada envio e é testada offline. Guardar o
   veredito no banco é para **relatório e segmentação**, não para autorizar.

Então a proposta é uma tabela derivada em `public`, que ninguém precisa consultar
para enviar com segurança.

## A migração

```sql
BEGIN;

CREATE TABLE IF NOT EXISTS public.aria_phone_quality (
  user_id      TEXT        PRIMARY KEY,
  phone_status TEXT        NOT NULL,
  pais         TEXT,
  tipo         TEXT,
  motivo       TEXT,
  checked_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS aria_phone_quality_status_idx
  ON public.aria_phone_quality (phone_status);

COMMENT ON TABLE public.aria_phone_quality IS
  'Veredito E.164 por usuário, derivado de nextauth."User".phone por src/phoneQuality.ts. '
  'Derivado e descartável: a fonte da verdade do telefone continua sendo a plataforma. '
  'NÃO autoriza envio — quem autoriza é o código, a cada mensagem.';

COMMIT;
```

### O telefone não é copiado — de propósito

Não há coluna `phone_e164`. O número normalizado seria **a mesma PII em mais um
lugar**, e não é necessário: o caminho de envio recalcula em memória, e o
relatório só precisa do veredito. Guardamos o diagnóstico, não o dado.

### Rollback

```sql
DROP TABLE IF EXISTS public.aria_phone_quality;
```

Sem perda: a tabela é 100% reconstruível rodando o validador de novo. Por isso
não pedimos backup antes — não há dado original aqui.

## Backfill

`docs/notificacoes/fase0-validar-telefones.cjs` ganha uma flag `--sql` que emite
`INSERT … ON CONFLICT (user_id) DO UPDATE`, em lotes. O arquivo gerado vai para
`dba-escrita/executar.js`, que exige aprovação gravada no audit e transação no
próprio arquivo.

Volume esperado: **22.638 linhas** (contas ativas com telefone).

Distribuição, pela validação de 2026-09-21:

| `phone_status` | Linhas |
|---|---:|
| `ENVIAVEL` | 16.799 |
| `INVALIDO` | 4.854 |
| `CORRIGIVEL_BR` | 544 |
| `AMBIGUO_BR` | 245 |
| `ENVIAVEL_NAO_MOVEL` | 194 |
| `VAZIO` | 2 |

## Para que serve, na prática

- **Medir** o efeito do seletor de país no site: a fatia `ENVIAVEL` tem que subir.
- **Segmentar** campanha e comunicação: quem não tem WhatsApp válido só recebe e-mail.
- **Trabalhar a quarentena**: 789 clientes (`AMBIGUO_BR` + `CORRIGIVEL_BR`) cujo
  número volta à operação com **uma pergunta** no próximo contato.

## O que esta tabela NÃO faz

- Não autoriza nem bloqueia envio — isso é do código, mensagem a mensagem.
- Não altera `nextauth."User"`.
- Não corrige número nenhum. Adivinhar país é o erro que vaza dado pessoal.

## Cadência

Sob demanda, e obrigatoriamente depois de: seletor de país no site, importação
de base, ou qualquer mudança em `phoneQuality.ts`. `checked_at` diz a idade do
veredito.

## O que preciso de você

1. **Aprovar a criação da tabela** (DDL é humano, sem exceção).
2. **Aprovar o backfill** das 22.638 linhas via `dba-escrita/executar.js`.

Aprovando só o item 1, a tabela nasce vazia e nada quebra — o envio não depende
dela.
