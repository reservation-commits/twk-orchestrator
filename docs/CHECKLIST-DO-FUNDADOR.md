# Checklist do Fundador — o que fazer agora, na ordem

> Atualizado em 2026-08-12. Marque com [x] conforme concluir. Detalhe de cada passo nos runbooks citados.

## Hoje (~1h30 no total)

- [ ] **1. Salvar as mudanças de código (5 min)** — abrir uma sessão do Claude nesta pasta e dizer: *"revise e commite as mudanças de hardening nos 5 repositórios"*. Ou fazer manualmente com `git add -A` + `git commit` em cada pasta de agente.
- [ ] **2. Criar as 3 roles no banco (20 min)** — no Google Cloud Console → SQL → sua instância → **Cloud SQL Studio**, logar como `postgres` e colar, um por vez, o conteúdo de:
  - `Agente Gerenciador do Banco de Dados/twk-db-agent/db/roles/twk_db_agent.sql`
  - `Agente de Suporte e Concierge/db/roles/aria_agent.sql`
  - `Agente Editorial/db/twk/roles_quill_writer.sql`
  - Em cada arquivo, trocar `<DEFINA_UMA_SENHA_FORTE>` por uma senha gerada (anotar as 3).
- [ ] **3. Apontar cada app para sua role nova (15 min)** — no EasyPanel, em cada serviço, trocar a connection string (`DATABASE_URL` / `PGUSER`+`PGPASSWORD` / `TWK_DATABASE_URL`) do usuário `postgres` para a role nova + senha nova. Redeploy um a um, conferindo o `/health` de cada.
- [ ] **4. Variáveis novas no EasyPanel (10 min)**:
  - Quill admin: `BASIC_AUTH_USER` e `BASIC_AUTH_PASSWORD` (sem elas o admin agora responde 503 em produção — proposital).
  - Atlas: `ATLAS_ALLOW_SELF_CONFIRM=true` **somente enquanto a operação for de uma pessoa** (remove o 4-olhos; tirar quando houver segundo operador). `ATLAS_PROPOSAL_TTL_HOURS` e `ATLAS_REFUND_MAX_MINOR` só se quiser mudar os defaults (72h / €500).
  - CLAVIS: `CLAVIS_DB_WRITE_ENABLED=true` apenas se quiser escrita em banco via Portão (o default virou desligado) + **montar volume persistente** em `CLAVIS_STATE_DIR`.
- [ ] **5. Rotacionar os segredos e tirá-los do OneDrive (~40 min)** — seguir `docs/runbooks/segredos-fora-do-onedrive.md` na ordem de lá (senha do postgres → chaves Anthropic → Stripe → Meta/GSC/Places → tokens internos). Regra: mover sem rotacionar não resolve.

## Esta semana

- [ ] **6. Sessão nova do Claude nesta pasta** (os subagentes e hooks carregam no início da sessão) e rodar `/briefing`.
- [ ] **7. Piloto das 979 páginas no limbo** — rodar `orchestrator/piloto/reconciliacao-limbo.sql` (somente leitura) no Cloud SQL Studio e trazer os números para a sessão; ou simplesmente dizer: *"/delegar reconciliar os restaurantes despublicados que já têm foto"*.
- [ ] **8. Decisão pendente:** a migração `audit-output/migrations/008` do DBA (DROP COLUMN aprovado em 2026-06 e nunca executado) — executar via runner oficial com backup, ou arquivar formalmente.

## Quando fizer sentido (sem pressa)

- [ ] Jobs de expurgo da política de PII (`docs/politica-retencao-pii.md`) — posso implementar via `/delegar`.
- [ ] `metadata.twk_partner_id` nos objetos Stripe (mudança na plataforma; liga receita a parceiro no Atlas).
- [ ] Mover os repositórios para fora do OneDrive definitivamente.
