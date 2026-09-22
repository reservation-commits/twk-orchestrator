# Dossiê do Agente: Quill (Editorial)

> Auditoria de 2026-08-12 · Repositório `Agente Editorial/` · Monorepo Next.js 15 (admin) + jobs CLI + Postgres 16 próprio

## 1. Missão em uma frase
Motor editorial e de SEO que reescreve as fichas dos 2.207 restaurantes, páginas de cidade e blog para multiplicar por 5 os cliques orgânicos GSC em 6 meses (888 → ~4.500/mês) — publicando **direto no banco de produção da TWK** após aprovação humana.

## 2. Entradas e saídas
- **Entradas:** fichas reais do banco TWK (read-only via adapter), métricas GSC (ingestão diária D-3), fila `agent_commands` disparada por humano na Central de Comando, crons EasyPanel (não versionados no repo).
- **Saídas:** `UPDATE db_restaurants SET about_text/meta_title/meta_description` e `UPDATE cities SET description` **no banco da plataforma**; blog sem destino (arquivado); e-mails via SMTP.

## 3. Ferramentas e permissões atuais
Sonnet (redação), Haiku (editor-chefe com veto, meta titles, citações IA), Voyage (embeddings/dedup), GSC API, SMTP. Batch API com −50% e cache dual-breakpoint.

**Permissões que tem e NÃO deveria ter (ou tem errado):**
1. 🔴 **Contradição documentada:** `docs/09` promete ao DBA "o Quill nunca escreve no banco TWK", mas `twk-write.ts` faz UPDATE com o mesmo `TWK_DATABASE_URL`. Se o DBA conceder só SELECT, toda publicação quebra; se conceder UPDATE, a promessa é falsa. Precisa de role `quill_writer` com UPDATE **apenas** em `db_restaurants(about_text, meta_title, meta_description)` e `cities(description, ...)`.
2. 🟠 Sem `BASIC_AUTH_USER/PASSWORD` definidos, **o admin que publica em produção fica aberto** (middleware libera).
3. 🟡 `mail-agent.ts` chama a Anthropic sem passar pelo cost-guard.

## 4. Dados que produz e consome
- **Consome:** `db_restaurants` (+ `cities`, `restaurant_michelin`, categorias) — mas o adapter **não lê** `opening_hours`, `price_range_id`, coordenadas, tipos: os fatos estruturados que reduziriam alucinação vêm null.
- **Produz:** banco próprio com 26 migrations — versões editoriais (1 ativa por campo, rollback por flag), aprovações append-only, métricas GSC particionadas, bandit de meta titles, learnings, oportunidades, cannibalização.

## 5. KPIs propostos
1. Cliques orgânicos GSC mensais vs. baseline 888 (a métrica única do projeto — baseline ainda não confirmada contra dado real).
2. Taxa de aprovação humana sem edição (qualidade do redator).
3. % de fichas com ≥3 fatos estruturados reais no snapshot (ataca a raiz da alucinação).
4. Custo real por ficha publicada (hoje subestimado — ver §6).
5. Uplift pré/pós 28d por publicação (com a ressalva de que é correlacional).

## 6. Modos de falha conhecidos e prováveis
- **Cap de custo lê variáveis erradas:** `.env` define `COST_DAILY_USD_CAP`, código lê `LLM_DAILY_CAP_USD` — caps configurados silenciosamente ignorados (defaults 30/250 valem). Ledger de custo omite Haiku, meta-titles, judge, embeddings e mail-agent; fail-open se o banco cair.
- **Alucinação estrutural:** `facts_used` valida que o path existe, não que a afirmação bate com o valor; com snapshot pobre, o modelo preenche com plausibilidade ("aberto em 1998" com source apontando 2011 passa em todos os gates).
- **Dedup pode estar morto sem aviso:** sem pgvector a coluna vira `text` e o dedup é pulado com um warn; near-duplicate nunca bloqueia. Mutirão de 2.207 fichas com dedup inativo = "scaled content abuse".
- Transação distribuída sem 2PC: UPDATE no TWK dentro de BEGIN do Quill — janela de site publicado com Quill achando que não; rollback (`is_active=false`) **não** reverte o texto no site.
- Meta tags gravadas que **o site não renderiza** (dependência do dev do site); bandit e GEO não chegam ao usuário final.
- Atribuição correlacional realimenta o prompt via learnings — risco de aprender ruído/sazonalidade.

## 7. Guardrails recomendados
1. Corrigir nomes das envs de cap + incluir todas as chamadas no ledger + fail-closed.
2. Basic Auth obrigatório por código (falha de config → admin recusa subir, como faz a Aria em produção).
3. Enriquecer o snapshot com `opening_hours`, preço, coordenadas e tipos (é a alavanca #1 contra alucinação — dado que o DBA já tem).
4. Publicação em 2 fases: UPDATE no TWK só após COMMIT local, com job de reconciliação Quill↔TWK e republicação da versão anterior no rollback.
5. Health-check do dedup: pgvector ausente ou modo mock → bloquear lote, não avisar.

## 8. Nível de autonomia recomendado
| Ação | Nível |
|---|---|
| Ingestão GSC, auditoria de conteúdo, scans, geração de rascunho | `AUTÔNOMO` |
| Enfileirar lotes de reescrita | `AUTÔNOMO COM LOG` |
| Publicar no banco TWK (fichas, cidades, meta) | `REQUER APROVAÇÃO HUMANA` (como hoje — manter o clique) |
| Migração no banco TWK (`db/twk/*.sql`) | `REQUER APROVAÇÃO HUMANA` + execução pelo DBA, nunca pelo Quill |
| Ajustar style guide / forbidden tokens | `REQUER APROVAÇÃO HUMANA` (afeta 2.207 páginas) |

## 9. Top 5 recomendações priorizadas
| # | Recomendação | Impacto | Esforço |
|---|---|---|---|
| 1 | Corrigir envs do cap de custo + ledger completo | Alto | P |
| 2 | Role `quill_writer` de menor privilégio + Basic Auth fail-closed | Alto | P |
| 3 | Snapshot enriquecido (horários, preço, coordenadas) | Alto | M |
| 4 | Health-check de dedup/pgvector bloqueante | Médio | P |
| 5 | Reconciliação Quill↔TWK + republicação no rollback | Médio | M |
