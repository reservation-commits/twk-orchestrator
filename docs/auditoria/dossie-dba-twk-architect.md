# Dossiê do Agente: TWK DB Architect (Gerenciador do Banco de Dados)

> Auditoria de 2026-08-12 · Diretório `Agente Gerenciador do Banco de Dados/` · Next.js + ~85 scripts · **INFRAESTRUTURA CRÍTICA — o único agente com poder de destruição irreversível**

## 1. Missão em uma frase
Guardião e enriquecedor do Postgres de produção da plataforma (`twk_auth`): qualidade de dados, enriquecimento via Places/Claude/web, publicação de restaurantes, consultas e manutenção — hoje operando com poder muito acima do que a missão exige.

## 2. Entradas e saídas
- **Entradas:** operador humano (senha única compartilhada), 42 tools do Agent Chat, ~85 scripts CLI, crons de snapshot.
- **Saídas:** mutações em `db_restaurants` e relacionais, `published` (controla se a página existe no site), `enrichment_log`, `agent_audit_log`, CSVs/manifestos em disco.

## 3. Ferramentas e permissões atuais
11 módulos de UI (7 escrevem) + Agent Chat com 42 tools (11 de escrita). Guardrails bons onde existem: `sql-guard` server-side, `queryWrite` com rollback por blast-radius (500 linhas), confirm-token HMAC no console, `agent_audit_log` append-only por trigger, `migrate.mjs` com checksum.

**Permissões que tem e NÃO deveria ter:**
1. 🔴 **Superusuário `postgres`** para tudo, com `rejectUnauthorized: false`, contra IP público — enquanto `clavis_ro` prova que role restrita já existe no mesmo banco. Prompt-injection via `fetch_url`/`web_search` ou vazamento do `.env.local` = controle total, incluindo `DROP DATABASE`.
2. 🔴 **Sem allowlist de tabelas:** `execute_mutation` alcança `nextauth."User"` (21.772 clientes), `reservations` (15.066), `PasswordResetToken`, `stripe_webhook_events`, `reservation_deposits`.
3. 🔴 **DDL não está realmente bloqueado:** `ALTER TABLE` embutido em `generate_structured_data(apply=true)`, `CREATE TABLE` de auto-cura, `ALTER` em script solto — fora do runner de migrations.
4. 🟠 O modelo pode elevar `max_affected_rows` até 50.000 e passar `allow_full_table=true` sozinho; `WHERE 1=1` passa no regex.

## 4. Dados que produz e consome
- **Consome/administra:** as 45 tabelas do `twk_auth` — núcleo `db_restaurants` (2.207), `reservations`, `nextauth.*` (PII), `aria_*`, depósitos/Stripe.
- **Produz:** enriquecimento (e-mails, telefones, horários, fotos, preços, structured data, traduções), `published`, snapshots de qualidade. **Quatro caminhos de escrita escapam da auditoria:** Photo Studio set-published, `/api/audit` inteiro (sem blast-radius nem transação), todos os scripts soltos, e mutações livres sem `old_data` (irreversíveis por construção).

## 5. KPIs propostos
1. % de escritas em produção com trilha completa em `agent_audit_log` (com `old_data`) — meta: 100%.
2. Restaurantes publicados (com alerta de variação >2%/dia — o incidente de 985 passou invisível).
3. Completude de campos críticos (`email_for_reservations`, `opening_hours`, foto de capa) por cidade.
4. Divergência entre manifesto de despublicação e estado real (reconciliação).
5. Tempo de recuperação testado de backup (hoje: não existe backup no fluxo).

## 6. Modos de falha conhecidos e prováveis
- **Já materializado:** `unpublish_no_photo.js` despublicou **985 restaurantes** em 2026-07-02; rollback desconectado do manifesto (o republish filtra por flag que o unpublish nunca seta); manifesto **sobrescrito até em dry-run**; 979 páginas no limbo por 5 semanas, 47 recebendo pedidos de reserva; nenhum alerta.
- Caminho de destruição mais curto: SQL Console → DELETE em `reservations` → confirmar token → irreversível (sem `old_data`, sem backup).
- `fill_url_twk.js` escreve em produção assim que roda (sem flag, sem preview); Data Enricher grava snippet de busca web direto na coluna, usando a *primeira coluna* da tabela como chave (não a PK).
- Fail-closed de auditoria que não fecha: COMMIT antes do log — falha no log = dado gravado sem trilha.
- LGPD/GDPR: harvesting de e-mails com decodificação de ofuscação, aceite de free-mail (dado pessoal do proprietário), CSVs com e-mails em texto plano no OneDrive, sem base legal registrada, sem log de acesso de leitura a PII.

## 7. Guardrails recomendados
1. **Role `twk_db_agent` sem superusuário** + `sslmode=verify-ca`; `clavis_ro` (ou equivalente) nos módulos de leitura. É a correção nº 1 da operação inteira.
2. **Allowlist de tabelas mutáveis** (catálogo: `db_restaurants` + relacionais) com bloqueio explícito de `nextauth.*`, `reservations*`, `*deposit*`, `stripe_*`.
3. Fechar os 4 bypasses de auditoria; `old_data` capturado na mesma transação para TODA mutação; log dentro da transação (fail-closed de verdade).
4. Backup/snapshot verificado antes de qualquer lote de escrita; manifesto com timestamp no nome (nunca sobrescrever); republish lendo o manifesto; reconciliação `tem foto → republicar` automática.
5. `published` só muda via fluxo com aprovação + notificação aos agentes a jusante (Comercial/Editorial) — é um evento de negócio, não um UPDATE qualquer.

## 8. Nível de autonomia recomendado
| Ação | Nível |
|---|---|
| SELECT no catálogo, auditorias de qualidade, snapshots | `AUTÔNOMO` |
| SELECT em tabelas com PII (`nextauth.*`, `reservations`) | `AUTÔNOMO COM LOG` (log de leitura + máscara por padrão) |
| Enriquecimento idempotente de campo vazio (com proveniência) | `AUTÔNOMO COM LOG` |
| UPDATE em campo preenchido / lote > 50 linhas | `REQUER APROVAÇÃO DO ORQUESTRADOR` |
| Mudança de `published`, DELETE, qualquer DDL/migração, restore | `REQUER APROVAÇÃO HUMANA` |
| DROP/TRUNCATE em qualquer tabela | **NUNCA** (bloqueio determinístico) |

## Adendo (verificação posterior)
- **Dois sistemas de migration paralelos:** `migrations/` (oficial, ledger + checksum) e `audit-output/migrations/` (8 propostas soltas, fora do ledger, separadas do console só por convenção textual).
- **DROP COLUMN irreversível aprovado e pendente há ~14 meses:** `audit-output/migrations/008_zombie_columns_and_localization.sql` ("APROVADO pelo humano em 2026-06-09 — execução pendente"). Migrar para o runner oficial com `pg_dump` prévio, ou arquivar formalmente.
- **Correção de uma linha, a mais barata da lista:** o `ALTER TABLE` em `lib/agent.ts:1113` já foi versionado em `migrations/0003` — o DDL em runtime pode simplesmente ser deletado.
- **Deploy:** hoje só funciona em localhost (sem `DASHBOARD_PASSWORD`); no dia em que for publicado, uma senha única compartilhada será o único controle entre a internet e o superusuário de produção.

## 9. Top 5 recomendações priorizadas
| # | Recomendação | Impacto | Esforço |
|---|---|---|---|
| 1 | Role de menor privilégio + TLS verificado (matar o superusuário) | Alto | P |
| 2 | Allowlist de tabelas + fechar os 4 bypasses de auditoria | Alto | M |
| 3 | `old_data` em toda mutação + log na transação (reversibilidade universal) | Alto | M |
| 4 | Consertar o par unpublish/republish + reconciliação de fotos + alerta de variação de publicados | Alto | P |
| 5 | Backup pré-lote + staging para ensaio de migrações | Alto | M |
