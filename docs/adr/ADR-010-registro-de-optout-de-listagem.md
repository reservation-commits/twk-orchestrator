# ADR-010 — Registro de Opt-out de Listagem como fonte única de consentimento do estabelecimento

**Status:** aceito · 2026-09-02 · trace `trc-agentes0902`

## Contexto
`aria_contact_consent` cobre só telefone (0 linhas hoje). O caso Bar Cañete (28/08) foi honrado à mão: despublicado sem marca "não relistar", `republish_no_photo.js` republicaria por flag, o front segue servindo a página, a campanha (148 casas) não tem opt-out e o CLAVIS não consulta consentimento. Pedido de remoção tem prioridade sobre qualquer meta comercial (guardrail 8 desta sessão).

## Decisão
1. Existe **uma** fonte de verdade para o consentimento do estabelecimento: `public.listing_consent` (DDL proposta em `orchestrator/agents/registro-optout/migracao-listing_consent.sql`, execução pelo fundador). Até a DDL, a fonte interina é `orchestrator/state/listing-consent.jsonl` (append-only), com backfill obrigatório na migração.
2. **Dono: Suporte (Aria)**, como já é do consentimento de contato (ADR-004). Comercial, Guardião, DBA (importador/publicador) e Editorial **consultam antes de agir**; ausência do registro = bloqueio (fail-closed), nunca "assume que pode".
3. Campos mínimos: `restaurant_id`, `status` (`listed|correction_requested|opted_out|claimed`), `do_not_relist`, `scope`, `requested_at/by`, `legal_basis`, `evidence_ref`, `sla_ack_at`, `sla_done_at`, `trace_id`.
4. SLA: reconhecer ≤24h, executar ≤48h; "executado" só fecha quando a página responder 404 — sem maquiar.
5. Todo e-mail em massa de qualquer agente leva link de retirada/correção que grava neste registro.

## Alternativas consideradas
- Estender `aria_contact_consent` com coluna de listagem: mistura consentimento de contato (pessoa) com listagem (estabelecimento) e chave por telefone; rejeitada.
- Só flag `do_not_relist` em `db_restaurants`: perde base legal, prazo, evidência e escopo; rejeitada (a flag existe, mas como projeção do registro).

## Consequências
Migração pendente do fundador; até lá, JSONL. `republish_no_photo.js`, `import_csv.js` e o botão de publicar passam a respeitar `do_not_relist` (propostas ao DBA/front).
