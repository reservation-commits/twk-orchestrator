# Aria v25 — reserva confirmada à casa e hora em AM/PM (05/11/2026)

**Pacote (use este):** `Agente de Suporte e Concierge/aria_agent_whatsapp-2026-11-09-v25.zip` (138 arquivos, todos com `/`, gerado com o `tar.exe` do System32; mesma lista de arquivos do v24). **Commits:** `9fe9783` + `b70f503` no repositório da Aria (não enviados ao GitHub). **Porta de Qualidade:** verde, 1203 checagens (`orchestrator/logs/porta/2026-11-09.md`).

**Estado em 09/11:** o zip de 05/11 foi ao ar em 05/11 às 4:04 PM (Paris) com o código da v25, mas (a) ainda rotulado `v24` no `/health` — o rótulo em `src/buildInfo.ts` não tinha sido trocado — e (b) **sem** a variável `RESERVATION_EVENT_TEMPLATE_VENUE_CONFIRMADA`: `/health` mostra `confirmadaCasa: false` e o MONAK não recebeu as reservas J669RDHJ (06/11) e TPT3TW3N (07/11). O zip de 09/11 só troca o rótulo para `2026-11-09-v25-casa-confirmada-am-pm`.

## O que muda

1. **Reserva confirmada à casa.** Reserva que o vigia vê pela primeira vez já em `Accept` (confirmação automática) manda à casa marcada o template `twk_venue_confirmed`. Caso de origem: MONAK, 6 de 7 reservas em 30 dias chegaram já aceitas e a casa não recebia nada por WhatsApp. O aceite de um pedido feito pela própria casa (pending → accept) continua sem aviso à casa. Textos: `templates-meta-v5-casa-confirmada-2026-11-05.md`; preview: `templates/whatsapp-casa-monak-preview-2026-11-05.png`.
2. **Hora em AM/PM em tudo.** "8:00 PM" em todo país e idioma, para cliente e casa (decisão do fundador, 05/11). Não exige nada na Meta: a hora é variável.

## Antes do Redeploy

- [x] `twk_venue_confirmed` **APPROVED** na Meta nos 6 idiomas — conferido em 05/11/2026 (minutos depois do envio):
  ```
  node orchestrator/agents/notificacao-reserva/meta-templates.mjs --doc docs/notificacoes/templates-meta-v5-casa-confirmada-2026-11-05.md --status
  ```
  Enviado em 05/11 nos 6 idiomas (en, pt_BR, fr, es, it, de), status PENDING no envio. Se fizer o Redeploy antes da aprovação, a hora em AM/PM já vale; o aviso de confirmada deve esperar: deixe a variável abaixo **vazia** até a Meta aprovar (envio com template não aprovado falha e vira escalação URGENTE).

## No Easypanel (serviço da Aria)

1. **Ambiente:** acrescentar
   `RESERVATION_EVENT_TEMPLATE_VENUE_CONFIRMADA=twk_venue_confirmed`
   (só depois da aprovação da Meta; nenhuma outra variável muda.)
2. **Origem:** enviar o zip `aria_agent_whatsapp-2026-11-09-v25.zip` e fazer **Deploy/Redeploy**, como no v24.
3. **Conferir** `/health` da Aria:
   - `build: "2026-11-09-v25-casa-confirmada-am-pm"`
   - `etapas.confirmadaCasa: true`
   - `notificacoes.templates.casaConfirmada: "twk_venue_confirmed"`
   - `etapas.pedidoNovoCasa`, `vesperaCasa` etc. iguais a antes.

## Depois

- Na próxima reserva do MONAK, o log do vigia mostra `[watch] aceito · reserva <código> · cliente: … · casa: enviado (1 número(s))`, e a Sala do WhatsApp na Central mostra a entrega de `twk_venue_confirmed`.
- **Desfazer:** apagar a variável `RESERVATION_EVENT_TEMPLATE_VENUE_CONFIRMADA` desliga o aviso sem novo deploy de código (basta reiniciar). Para voltar ao 24 h, é preciso fazer o Redeploy do zip v24.
