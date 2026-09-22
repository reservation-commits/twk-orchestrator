# Runbook — Tirar os segredos do OneDrive (e rotacioná-los)

**Por quê:** `.env` com credenciais reais existem em `Agente Comercial/`, `Agente Editorial/` (+ `.secrets/gsc-service-account.json`), `Agente Financeiro/` (`.env` e `.env.easypanel`) e `Agente Gerenciador do Banco de Dados/twk-db-agent/.env.local` — todos dentro de pasta sincronizada pelo OneDrive, com histórico de versões na nuvem pessoal. Os zips de deploy foram verificados em 2026-08-12 e estão limpos.

**Princípio: mover não basta.** Se um segredo já sincronizou para a nuvem, considere-o exposto ao histórico do OneDrive — o procedimento é **rotacionar**, e só então limpar.

## Procedimento (fundador; ~1h; janela sem deploys)

1. **Criar o cofre local fora do OneDrive:** `C:\twk-secrets\` (pasta simples) — ou, melhor, um gerenciador (Bitwarden/1Password) como cópia canônica.
2. **Por projeto**, copiar o `.env` real para `C:\twk-secrets\<projeto>\.env` e conferir que a aplicação local lê do novo caminho (opções: mover o repositório inteiro para fora do OneDrive — recomendado a médio prazo — ou apontar o processo local para o novo `.env`).
3. **Rotacionar, nesta ordem de criticidade:**
   - Senha do usuário `postgres` do Cloud SQL (e só então criar as roles novas: `twk_db_agent`, `aria_agent`, `quill_writer` — scripts em `db/roles/` de cada projeto).
   - Chaves Anthropic (todas — há chave duplicada entre `.env` e `.env.easypanel` do Atlas).
   - `STRIPE_SECRET_KEY` (corrigir também o valor `pk_live` gravado no campo errado, apontado na auditoria do Atlas).
   - Tokens Meta/WhatsApp (System User), service account GSC (gerar chave nova, revogar a antiga no IAM), Google Places/Maps, `CLAVIS_API_TOKEN`, `DASHBOARD_PASSWORD`/`DASHBOARD_TOKEN`, secrets de webhook.
4. **Atualizar o EasyPanel** com os valores novos (lá é o lugar certo de segredo de produção) e redeployar um serviço por vez, verificando `/health` de cada um.
5. **Limpar o OneDrive:** apagar os `.env` reais das pastas sincronizadas e **esvaziar a lixeira/histórico de versões do OneDrive** para esses arquivos. Apagar também `email_results_*.csv` e `enrich_run.log` da pasta do DBA APÓS decidir a retenção (ver `docs/politica-retencao-pii.md`).
6. **Verificar:** cada `.gitignore` continua cobrindo `.env*`; cada projeto tem `.env.example` sem valores; nenhum `Test-Path .env` verdadeiro dentro do OneDrive.

## Depois
Registrar a rotação (data + quais chaves) em `orchestrator/logs/` via sessão do Orquestrador. Meta de médio prazo: Secret Manager (GCP) para produção, como o doc 06 do Quill já exige.
