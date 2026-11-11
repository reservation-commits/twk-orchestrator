# Aria v26 — um telefone recebe os avisos de reserva por várias casas (11/11/2026)

**Pacote (use este):** `Agente de Suporte e Concierge/aria_agent_whatsapp-2026-11-10-v26.zip` (141 arquivos, todos com `/`, gerado com o `tar.exe` do System32 a partir de lista explícita; = os 138 do v25 + `src/casaTelefones.ts`, `test/casaTelefones.test.ts` e `public/icons/phone.png`, este último commitado em 02/11 e ausente do zip anterior). **Porta de Qualidade:** verde, 1224 checagens em 11/11 (`orchestrator/logs/porta/2026-11-11.md`). **Commits:** nenhum ainda — o fundador não pediu. **ADR:** `docs/adr/ADR-020-um-telefone-para-varias-casas.md` (aceito em 11/11).

**Estado em 11/11:** a Aria em produção é a v25 e **não lê** `aria_venue_phones`. O fundador colou a DDL e as três ligações do celular +33 6 26 12 38 71 (GIULIA 250029, KALAMATA 281656, YACATAN 250091) no Cloud SQL Studio; a conferência pela visão está pendente (banco inacessível do notebook do DBA). Até o Redeploy, KALAMATA e YACATAN seguem sem aviso.

## O que muda

1. **Tabela de ligação casa⇄telefone.** Quando `public.aria_venue_phones` existe (a Aria descobre por `to_regclass`, reconferindo a cada 5 min), os destinatários de uma casa são as ligações dela **mais** a linha legada de `aria_contact_consent` que não tenha ligação equivalente; a ligação vence para o mesmo par, inclusive para desligar uma casa sem mexer nas outras. Sem a tabela, comportamento idêntico à v25.
2. **As travas do telefone continuam do telefone.** PARAR (`outbound_opted_out`) e lista de bloqueio (`whatsapp_indisponivel`) ficam em `aria_contact_consent` e são lidas por `phone` em todo ramo: um número bloqueado não recebe por nenhuma casa. `marcarWhatsAppIndisponivel`, `limparWhatsAppIndisponivel` e o PARAR/VOLTAR não mudaram.
3. **Webhook `/webhook/consent` para estabelecimento.** Com a tabela, a marcação da casa vai para a ligação, em transação, e o `restaurant_id` legado deixa de ser sobrescrito (até a v25 a segunda casa roubava o número da primeira). A resposta ganha `ligacao: true|false`.
4. **Aviso de sistema da casa que escreve.** Quando o número atende várias casas, o aviso nomeia as outras, pede o código do pedido em caso de dúvida e junta os pendentes de todas.
5. **Varreduras da casa** (lembrete de 24 h, agenda de amanhã) usam o mesmo critério de "casa marcada" nos dois ramos.

## Antes do Redeploy

- [ ] Conferir no Cloud SQL Studio (ou pelo `twk_ro`, quando o notebook voltar à rede autorizada):
  ```sql
  SELECT restaurant_id, origem, recebe FROM public.v_aria_casa_telefones WHERE phone = '+33626123871';
  ```
  Esperado: 3 linhas `ligacao`, `recebe = true`. Se a tabela não existir, o Redeploy é inofensivo: a v26 se comporta como a v25.
- [ ] Conferir que o papel do `PGUSER` da Aria tem `SELECT/INSERT/UPDATE/DELETE` em `aria_venue_phones` (a DDL concedeu a `aria_agent` se o papel existia; sem o GRANT, a leitura falha e a casa termina em `sem_destinatario` com motivo "registro de consentimento ilegível", e o webhook de estabelecimento devolve 500).

## No Easypanel (serviço da Aria)

1. **Ambiente:** nenhuma variável nova.
2. **Origem:** enviar `aria_agent_whatsapp-2026-11-10-v26.zip` e fazer **Deploy/Redeploy**, como no v25.
3. **Conferir** `/health`: `build: "2026-11-10-v26-um-telefone-varias-casas"`. No log de boot, com a tabela presente, aparece `[consent] tabela de ligação casa⇄telefone encontrada (public.aria_venue_phones) — modelo ADR-020 ativo` na primeira consulta de destinatários.

## Depois

- Primeiro pedido de KALAMATA ou YACATAN: `aria_outbound_log` deve registrar `pedido_recebido:estabelecimento` com desfecho `enviado` para `+33626123871`; a Sala do WhatsApp na Central mostra a entrega.
- **Desfazer:** Redeploy do zip v25 (`aria_agent_whatsapp-2026-11-09-v25.zip`); a tabela pode ficar — a v25 a ignora. Apagar as três ligações é `DELETE FROM public.aria_venue_phones WHERE phone = '+33626123871'`, pela porta (reversível, com backup).
- Fase 2 (sem pressa, só leitura): Guardião, Central, canário e `ligacoes-telefone-casas.cjs` passarem a ler `v_aria_casa_telefones`.
