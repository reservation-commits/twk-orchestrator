# Criar os templates de WhatsApp na Meta pela API (runbook, 29/09/2026)

**O que é:** em vez de colar 66 formulários no WhatsApp Manager, um script lê o documento aprovado (`docs/notificacoes/templates-meta-2026-09-25.md`) e cria cada template em cada idioma pela API oficial da Meta. Ele nunca apaga nem edita o que já existe.

## O que o fundador precisa fazer (uma vez, 10 minutos)

O script precisa de duas informações. **Nunca cole nenhuma delas no chat.** Elas vão num arquivo fora do OneDrive.

### 1. O ID da conta do WhatsApp Business (WABA ID)
WhatsApp Manager → engrenagem **Configurações da conta** → o número em **ID da conta do WhatsApp Business** (só dígitos).

### 2. Um token de usuário do sistema
1. business.facebook.com → **Configurações do negócio** (Business Settings) → **Usuários** → **Usuários do sistema**.
2. **Adicionar** → nome `twk-templates`, função **Administrador** → criar.
3. Com ele selecionado: **Adicionar ativos** → **Contas do WhatsApp** → marcar a conta da TWK → **Controle total** → Salvar.
4. **Gerar novo token** → escolher o app do WhatsApp da TWK → validade **60 dias** (ou "nunca expira") → marcar **`whatsapp_business_management`** e **`whatsapp_business_messaging`** → Gerar → copiar.

### 3. Guardar no arquivo
Abrir o Bloco de Notas e salvar como `C:\Users\bianc\.twk\meta.env` (a pasta já existe) com duas linhas:

```
META_WABA_ID=000000000000000
META_TOKEN=EAAB...
```

Depois é só me dizer **"arquivo salvo"**. Eu rodo o resto.

## O que eu faço em seguida

```bash
node orchestrator/agents/notificacao-reserva/meta-templates.mjs --list
```
Mostra o que já existe na conta (incluindo por que o `lembrete_reserva_2h` está falhando).

```bash
node orchestrator/agents/notificacao-reserva/meta-templates.mjs --apply --lang en
```
Cria os 10 templates em inglês primeiro (o de reagendamento fica de fora até a plataforma gravar a data proposta). Depois `--lang pt_BR,fr`, depois `es,it,de`.

```bash
node orchestrator/agents/notificacao-reserva/meta-templates.mjs --status
```
Status de aprovação de cada um. Aprovado = `APPROVED`. Quando um idioma estiver aprovado em todos os templates ligados, ele entra em `REMINDERS_LOCALES` no Easypanel.

Tudo fica registrado em `orchestrator/logs/meta-templates-<data>.jsonl` (sem o token).

## Se algo for recusado
A Meta devolve o motivo (`rejected_reason`). Os casos comuns: texto com cara de marketing (mudar uma frase), variável no começo ou no fim do corpo, amostra faltando. Eu ajusto o documento e reenvio só aquele template com `--only <nome> --lang <idioma>`.
