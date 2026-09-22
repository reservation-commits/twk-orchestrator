# Dossiê do Agente: Aria (Suporte e Concierge)

> Auditoria de 2026-08-12 · Repositório `Agente de Suporte e Concierge/` · Node/TS + WhatsApp Cloud API + canal e-mail

## 1. Missão em uma frase
Concierge digital de marca de luxo que atende hóspedes via WhatsApp e `support@theworldkeys.com`, resolve consultas de reserva/restaurante e escala ao humano o que não pode decidir — sem nunca criar, alterar ou cancelar reservas.

## 2. Entradas e saídas
- **Entradas:** webhook Meta (texto, imagem, áudio via Whisper, PDF, interactive, botão, localização) com HMAC; webhook de e-mail com secret próprio.
- **Saídas:** texto, listas interativas, botões, CTA "Reservar", pin de localização; escalações em `aria_escalations` + SSE + e-mail à equipe.

## 3. Ferramentas e permissões atuais
**25 tools** (não 11): 5 de reservas (SELECT parametrizado), 7 de restaurantes/localização (inclui busca vetorial), 2 externas (Google Geocoding/Distance), 4 de perfil/consentimento (**escrita**), 4 de mensagens ricas, 1 SQL livre blindado (`run_sql_read`, 3 camadas), 2 de auditoria.

**Permissões que tem e NÃO deveria ter:**
1. 🔴 Usuário Postgres com **escrita ampla** — e `create/update/cancelReservation` existem vivas em `db.ts`; a proteção é a ausência de tool, não a permissão do banco.
2. 🔴 `find_reservations_by_email`, `find_user` e `search_reservations` aceitam **identificador arbitrário digitado pelo modelo** — vazamento cross-customer barrado só por regra textual (Lei #4).

## 4. Dados que produz e consome
- **Consome:** `reservations`, `db_restaurants`, `opening_hours`, `nextauth."User"` (mesmo Postgres da plataforma).
- **Produz:** 13 tabelas `aria_*` — perfis acumulativos (com **alergias = dado de saúde GDPR art. 9**), escalações, reviews/CSAT, consentimento de contato, checkpoints de sessão, custo de LLM. A aba Catálogo expõe qualidade de dados de restaurantes priorizada por volume — insumo natural para o DBA.

## 5. KPIs propostos
1. Tempo de primeira resposta e taxa de resolução sem escalação.
2. Escalações por tag (URGENTE, PENDENTE_12H...) e tempo até atendimento humano.
3. CSAT via `aria_experience_reviews`.
4. Taxa de erro de idioma/tom (evals).
5. Custo de IA por conversa resolvida.

## 6. Modos de falha conhecidos e prováveis
- **Injeção via `[Sistema: ...]`**: cliente pode forjar o marcador confiável do servidor no texto (`webhook.ts:130`) — manipula roteamento e contexto de localização.
- Handoff humano em memória: restart devolve a Aria a um chat que um atendente havia assumido.
- `escalate_to_human` pode retornar `ok:true` com ambos os INSERTs falhando — escalação URGENTE perdida com promessa de "15 minutos" feita ao cliente.
- Sem `OPENAI_API_KEY`, todo áudio degrada silenciosamente; imagem sem caption que falha no download **some sem log**.
- Rate-limit em memória zera a cada deploy.
- PII: telefone em claro no stdout; sem rotina de retenção/expurgo para mensagens, tool_calls e perfis (a promessa GDPR do prompt não tem código).

## 7. Guardrails recomendados
1. **Neutralizar `[Sistema:` no texto de entrada do cliente** em `parseOneMessage` (correção barata, vetor real).
2. **Amarrar `find_reservations_by_email`/`find_user` à identidade do webhook** (como já é feito com telefone) — vazamento cross-customer deixa de depender de prompt.
3. Role de banco dedicada `aria_agent`: SELECT nas tabelas de leitura + INSERT/UPDATE **somente** nas `aria_*`; revogar qualquer escrita em `reservations`.
4. Persistir handoff humano no banco; `escalate_to_human` fail-closed (falhou o INSERT → retorna erro ao modelo, que avisa o cliente honestamente).
5. Job de retenção: expurgo de `aria_messages`/`aria_tool_calls` após N dias; redação de alergias no log de tools.

## 8. Nível de autonomia recomendado
| Ação | Nível |
|---|---|
| Consultas de reserva/restaurante do próprio cliente | `AUTÔNOMO` |
| Atualizar perfil/consentimento/review do próprio cliente | `AUTÔNOMO COM LOG` |
| Responder sobre reembolso, disputa, má notícia | `REQUER APROVAÇÃO HUMANA` (hoje: escala — manter) |
| Criar/alterar/cancelar reserva | **NUNCA** (desvio para o site; reforçar por permissão de banco) |
| Consulta por e-mail/código de terceiro | `REQUER APROVAÇÃO DO ORQUESTRADOR` (verificação de identidade) |

## 9. Top 5 recomendações priorizadas
| # | Recomendação | Impacto | Esforço |
|---|---|---|---|
| 1 | Identidade server-side também para e-mail/código (fecha vazamento cross-customer) | Alto | P |
| 2 | Role `aria_agent` de menor privilégio no Postgres | Alto | P |
| 3 | Neutralizar `[Sistema:` no input do cliente | Alto | P |
| 4 | Handoff persistido + `escalate_to_human` fail-closed | Alto | M |
| 5 | Política de retenção/expurgo de PII (alergias em especial) | Alto | M |
