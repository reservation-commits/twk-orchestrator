# Aria v22 — fechar o loop (22/10/2026)

Pedido do fundador em 22/10: "vamos executar todas as suas poderosas recomendações" (plano `docs/auditoria/avaliacao-eficiencia-2026-10-21.md`, itens B2, B3, B4, C1, C3). Build `2026-10-22-v22-fechar-o-loop`.

## O que foi medido antes (twk_ro, 21/10)

- 15 escalações abertas; 14 geradas pelo próprio sistema ([juiz], [revisao], [compromisso]); a única acionável (LOFOTEN, remoção) ficou 16 dias sem leitura.
- Duas cartas prontas a clientes (6K9UTC47 em 16/10, RMJHTGQ6 em 19/10) venceram em "janela de 24 h fechada — enviar manualmente". Ninguém enviou.
- Em 30 dias, 168 mensagens de pendência ao cliente morreram em `sem_opt_in` e 93 em telefone inválido; 0 clientes com opt-in.
- 124 lembretes a casas em quarentena por "duas leituras válidas (FR/TH ou BR)" quando o cadastro dizia o país.
- Juiz de Conversa: 6 de 20 respostas reprovadas (escala 0 a 6, mínimo 5); motivos: hype, "inteligência de atendimento", não resolve nada agora, prazo de terceiro.

## O que a v22 muda

| Tema | Arquivo | Mudança |
|---|---|---|
| Fila de escalação (B4) | `src/escalacaoRegra.ts` (puro), `src/db.ts` (`logEscalationAcionavel`, `fecharEscalacoesTelemetria`), `src/juiz.ts`, `src/revisao.ts`, `src/entrega.ts`, `src/compromissos.ts`, `src/index.ts` | Escalação sem ação humana possível é telemetria: nota reprovada fica em `aria_quality_scores`, revisor indisponível no console/painel. Resposta retida, compromisso sem canal e envio falhado viram **uma** escalação `RESPONDER` por conversa, com dono (`assigned_to = MAESTRO`) e a ação no resumo. Na subida, as `[juiz]` abertas e as `[revisao]`/`[compromisso]` com mais de 7 dias são fechadas com nota (nunca apagadas). |
| Compromisso por e-mail (B3) | `src/compromissos.ts`, `src/db.ts` (`emailDoCliente`) | Janela do WhatsApp fechada → a mesma carta sai pelo e-mail do cliente (opt-in → reserva → telefone da conta). Sem e-mail: `RESPONDER`. |
| Pendência por e-mail (B2/B3) | `src/pendenciaEmail.ts` (puro, 6 idiomas × 2 cartas), `src/reminders.ts`, `src/db.ts` | "Seu pedido segue conosco" (24 h) e "encerramento honesto" (véspera) saem por e-mail quando o WhatsApp não é possível (sem telefone, inválido, sem opt-in, número sem WhatsApp). `PARAR` continua valendo para tudo. As consultas deixam de exigir telefone (`CLIENTE_ALCANCAVEL`). Cada carta passa pela `outboundGate` antes de sair; idioma = preferência registrada > país do telefone com `+` > inglês. Registro em `aria_outbound_log` com evento `pending_*:email`. |
| Prompt (C1) | `src/systemPrompt.ts` | "Concierge de reservas" no lugar de "inteligência de atendimento"; item 10-bis com os cinco defeitos reais que o juiz reprovou; a régua é a mesma seis vezes. |
| Telefone da casa (C3) | `src/phoneQuality.ts` (`avaliarTelefone(bruto, paisEsperado)`), `src/venueEvents.ts` | O país do cadastro (`db_restaurants.country_code`) desempata o número ambíguo da casa, de forma determinística. Cliente continua sem desempate (viaja). |
| `/health` | `src/index.ts` | `etapas.pendenciaPorEmail` (exige `EMAIL_ENABLED=true`). |

## Verificação (22/10)

- `tsc --noEmit` limpo; `npm test` **261/261** (34 suítes; novas: `escalacaoRegra`, `pendenciaEmail`, `phoneQualityPais`). As 12 cartas por e-mail passam na porta de saída do ADR-015 — a primeira versão em espanhol ("para el sábado…") foi barrada como data prometida e reescrita.
- Não verificado em produção: envio por e-mail em thread nova pelo fluxo do n8n (o `sendOperatorEmail` já abre thread nova pelo mesmo caminho); a limpeza da fila na subida (esperado: ~11 escalações fechadas com nota).

## Depois do deploy (fundador: Easypanel → redeploy com o zip; conferir `/health` build v22)

1. `node orchestrator/agents/dba-escrita/executar.js --sql orchestrator/state/reabrir-compromissos-v22-2026-10-22.sql --apply --autonomo` — reabre os 3 compromissos de 16 e 19/10 para a v22 cumpri-los por e-mail.
2. Olhar `aria_escalations` com `status='open'`: deve sobrar só o que exige gente, com `assigned_to` preenchido.
3. Em 7 dias: `aria_outbound_log` com `evento LIKE 'pending_%:email'` e `desfecho='enviado'` — é o número que diz se o cliente passou a ouvir a verdade.
