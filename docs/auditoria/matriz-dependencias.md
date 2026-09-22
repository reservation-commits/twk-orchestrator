# Matriz de Dependências entre Agentes

> Insumo principal do design do Orquestrador. Auditoria de 2026-08-12.
> Legenda de frequência: contínua (a cada operação) · diária · semanal · eventual.

## Dependências por dado

| Quem depende | De quem | Por qual dado | Frequência | Estado hoje |
|---|---|---|---|---|
| **Comercial** | DBA | `email_for_reservations`, `telephone`, `site_url`, `partner`, `negotiation_status` em `db_restaurants` | contínua | Implícita via banco. **E-mail errado gravado pelo DBA vira outreach errado do CLAVIS.** |
| **Comercial** | DBA | `published` (alvo de outreach precisa ter página no ar) | contínua | Sem evento/notificação — o incidente das 985 despublicações passou invisível ao CLAVIS. |
| **Comercial** | Suporte | `aria_contact_consent` (opt-out de WhatsApp) | contínua | **NÃO CONSULTADO.** Supressão do CLAVIS é arquivo local; dois agentes podem contatar quem pediu opt-out no outro. Risco GDPR. |
| **Editorial** | DBA | `about_text`, `images_json.slider[0]`, categorias, Michelin — matéria-prima da reescrita | contínua | Implícita via banco. Snapshot pobre = alucinação. |
| **Editorial** | DBA | `opening_hours`, `price_range_id`, coordenadas (fatos anti-alucinação) | contínua | **Dados existem e o adapter não lê** — maior alavanca de qualidade parada. |
| **Editorial** | DBA | Grants (`quill_writer`), colunas `meta_*`, migrações `db/twk/*.sql` | eventual | Contradição aberta: doc promete read-only, código faz UPDATE. |
| **Suporte** | DBA | `db_restaurants`, `opening_hours`, `reservations`, `nextauth."User"` | contínua | Implícita via banco. Aba Catálogo da Aria já aponta lacunas de dados priorizadas por volume — feedback que hoje ninguém consome. |
| **Suporte** | Editorial | Conteúdo publicado (a Aria recomenda restaurantes cujo texto o Quill escreve) | contínua | Sem contato direto — coerência de tom não verificada. |
| **Financeiro** | DBA/plataforma | `reservation_deposits`, `stripe_webhook_events`, `partner` (ligar receita a domínio) | diária | **ZONA MORTA.** Atlas só vê Stripe; ninguém mede receita por parceiro/reserva. |
| **Comercial** | Financeiro | Status de pagamento/assinatura de parceiro (antes de cobrar ou prospectar) | eventual | Inexistente. CLAVIS não sabe se o parceiro está inadimplente. |
| **DBA** | Suporte | Fila de qualidade da aba Catálogo (o que enriquecer primeiro) | semanal | Inexistente como fluxo. |
| **DBA** | Editorial | `structured_data_json`, traduções `about_*` (quem é dono do texto?) | eventual | **Conflito de dono:** DBA tem `translate_description(apply=true)` e o Quill é o dono editorial — podem sobrescrever um ao outro. |
| **Todos** | DBA | Integridade do `twk_auth` (o banco é o barramento de fato) | contínua | Superusuário + 4 bypasses de auditoria = risco sistêmico para os 4 agentes a jusante. |

## Fluxos ponta-a-ponta que atravessam agentes

1. **Venda → onboarding → cobrança** (Comercial → DBA → Suporte → Financeiro): CLAVIS converte parceiro → `partner=true`, `commission_per_person` (DBA) → Aria dá boas-vindas/atende → depósitos/assinatura viram receita (Atlas). Hoje: cada elo existe isolado; nenhum handoff formal.
2. **Publicação de restaurante** (DBA → Editorial → Comercial → Suporte): foto/contato completos → `published=true` → Quill reescreve ficha → CLAVIS pode prospectar → Aria pode recomendar. Hoje: o elo DBA→resto quebrou de forma comprovada (985 despublicados sem aviso).
3. **Reserva Pending de parceiro** (Suporte → Comercial): cliente pergunta à Aria sobre reserva pendente ↔ Cobrador do CLAVIS faz nudge ao restaurante. Hoje: nenhuma coordenação; o cliente pode receber "aguarde" enquanto ninguém cobra o restaurante.
4. **Opt-out** (Suporte ↔ Comercial): opt-out em qualquer canal deve suprimir TODOS os canais. Hoje: dois sistemas de supressão desconectados.

## Fonte única de verdade por tipo de dado (proposta — ver ADR-004)

| Dado | Dono (única fonte) | Os demais |
|---|---|---|
| Catálogo (`db_restaurants` estrutural, `published`, contatos, horários) | **DBA** | consultam |
| Texto editorial (`about_*`, `meta_*`, `cities.description`) | **Editorial** | DBA não traduz/escreve texto editorial |
| Reservas (`reservations`, status) | **Plataforma** (nenhum agente escreve) | consultam |
| Pagamentos/receita | **Financeiro** (espelho Stripe + ledger) | consultam via Atlas |
| Consentimento de contato (opt-in/opt-out unificado) | **Suporte** (`aria_contact_consent` estendida) | Comercial consulta antes de todo envio |
| Relacionamento comercial (`partner`, `negotiation_status`, funil) | **Comercial** | DBA grava sob proposta do Comercial |
| Estado de tarefas/orquestração | **Orquestrador** (`orchestrator/state`) | todos reportam |
