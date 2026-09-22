# Runbook — Pedido de remoção de perfil por um estabelecimento

**Criado em 2026-08-28, a partir do caso Bar Cañete (restaurant_id 15207).**
Use quando um restaurante pedir para sair da plataforma, alegar que não consentiu em constar, ou reclamar de reservas que não pode honrar.

> Por que este runbook existe: 413 restaurantes publicados têm horários genéricos e já receberam reservas (ver `orchestrator/state/risco-horarios-genericos-2026-08-28.csv`). Cada um pode abrir o mesmo caso. Trate como processo recorrente, não como exceção.

## 0. Classifique em 1 minuto

| Sinal na mensagem | Significa | Urgência |
|---|---|---|
| "no consent", "não autorizamos", menção a GDPR/LOPD/AEPD | pedido formal, risco regulatório | **alta — responder no mesmo dia** |
| "horários não batem", "cliente reservou e não podíamos atender" | dano já causado ao cliente **deles** | **alta** |
| "removam nosso perfil" sem mais contexto | pedido simples | normal |

Pedido formal + menção a proteção de dados: **nunca responda com pitch de vendas puro**. Honre primeiro, ofereça depois.

## 1. Apure antes de responder (somente leitura)

Peça ao DBA, com o `restaurant_id`:

1. **Proveniência** — `created_date` e quantos registros nasceram no mesmo minuto. Se for coorte de importação em massa (ex.: 2023-07-25 14:16 → 1.934 registros), a alegação de não-consentimento é **procedente** e você deve reconhecê-la.
2. **Horários** — `opening_hours` vs `business_hours_json`. Sinais de preenchimento genérico: mesmo intervalo idêntico em todos os dias, sem serviço partido. Verifique também se as duas fontes divergem.
3. **Reservas futuras** — `booking_date >= CURRENT_DATE` por `booking_status`. Se houver qualquer `Pending`/`In Treatment`/`Accept`/`Paid`, **pare**: o cliente precisa ser avisado antes de a página sair.
4. **Titularidade** — compare o remetente com `email_for_reservations`. Se o domínio diferir, corrobore por endereço físico e `site_url` da assinatura. Responda ao remetente **com cópia ao e-mail de cadastro** — isso fecha a verificação sem burocracia.

## 2. Despublique (aprovação do fundador — sempre)

SQL de referência: `orchestrator/state/despublicar-canete-15207.sql`. Obrigatório:

- Contagem prévia: alvo deve ser exatamente 1.
- `SET published = false, ready_pending_photo = false` — a segunda evita que `republish_no_photo.js` republique sozinho.
- Registro em `agent_audit_log` **dentro da mesma transação**; se o log falhar, `ROLLBACK`. Despublicar sem trilha é pior que adiar.
- Guardar o `old_data` (`to_jsonb` da linha) — é o que torna a ação reversível.

⚠️ **Despublicar não tira a página do ar.** `/hospitality/{slug}/` continua em 200 com formulário de reserva. Até o front corrigir, abra chamado e trate as solicitações que chegarem manualmente — não as repasse ao restaurante.

## 3. Silencie a Aria para aquele contato

O canal de e-mail da Aria respeita "modo humano" por conversa, com chave `email:<endereço>`:

```sql
INSERT INTO public.aria_handoffs (phone, operator, until)
VALUES ('email:contato@dominio.com', 'Nome do responsável', now() + interval '180 days')
ON CONFLICT (phone) DO UPDATE SET operator = EXCLUDED.operator, until = EXCLUDED.until;
```

Inclua **todos** os endereços do grupo (remetente, cadastro, administração, DPO). Sem isso a Aria responde sozinha e atravessa a conversa humana.

## 4. Responda — a estrutura que converte sem faltar com a verdade

Modelo pronto: `orchestrator/state/email-canete-recuperacao-ES.html`. A ordem importa:

1. **Reconhecimento total logo na abertura** ("Vocês têm razão"), antes de qualquer explicação. Desarma e gera reciprocidade.
2. **Honre o pedido incondicionalmente** e diga o que já foi feito — sem contrapartida, sem "mas".
3. **Diga que auditou** e confirme os erros ponto a ponto. Investigar sem ser cobrado é o que mais constrói confiança.
4. **Só então** ofereça a conta profissional, pedindo licença ("se nos concederem um minuto").
5. **Ofereça as duas saídas com igual dignidade** — botão de acesso e botão de retirada. A saída visível é o que torna a oferta crível.
6. **Assinatura pessoal** com nome e cargo, e "quem lê sou eu".

Escreva no idioma do estabelecimento, mesmo que tenham escrito em inglês.

**Regra de ouro:** toda promessa operacional no texto ("sua ficha deixa de receber solicitações") precisa ser verdadeira no instante do envio. Eles conferem — é a própria página deles.

## 5. Feche o ciclo

- Notificar **CLAVIS**: remover do funil, não prospectar.
- Notificar **Quill**: sitemap, listas da cidade, structured data, links órfãos.
- Registrar em `orchestrator/logs/` com `trace_id`, `old_data`, id da mensagem enviada e compromissos assumidos (marcando quais ficaram pendentes).
- Se responderem **RETIRAR**: executar a remoção definitiva no mesmo dia.

## Anexo — Rotina de expiração de pendências (2026-08-31)

Pendência viva = `expired_at IS NULL`. Para o entulho não reacumular (25 novas venceram em só 3 dias):

- **Job pronto**: `Agente Gerenciador do Banco de Dados/expire_stale_pendings.js` — idempotente, audita em `agent_audit_log`, preserva `booking_status`. Rodar com `--apply`.
- **Agendamento ATIVO no servidor (2026-08-31)**: flag `cloudsql.enable_pg_cron` ativada pelo fundador; extensão instalada no banco `postgres` (exigência do Cloud SQL) e job `expire-stale-pendings` (id 1) agendado via `cron.schedule_in_database` — **diário às 03:15 UTC, executando em `twk_auth`**, com trilha em `agent_audit_log` (agent = 'pg_cron'). Verificar execuções: `SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 5;` conectado ao banco `postgres`. O script local `expire_stale_pendings.js` vira redundância manual, não rotina.
- **Escrita auditada nos scripts**: novo módulo `db-audited.js` na raiz do DBA — captura `old_data` por registro e grava `agent_audit_log` na MESMA transação, com teto de linhas (`maxRows`). `republish_no_photo.js` já foi refatorado para usá-lo; os demais scripts de escrita (`enrich_*`, `fill_*`, `import_csv`…) devem migrar quando forem tocados.
