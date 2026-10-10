# Aria v20 — opt-in pedido pelo cliente, alerta no celular e vigia de entrega (05/10/2026)

Pedido do fundador em 05/10: "correções e otimizações definitivas para o sistema de WhatsApp" e "o passo a passo com a melhor execução de opt-in de clientes"; em seguida, "pode seguir". As casas (números sem WhatsApp, leva 2) ficaram para depois por decisão dele: só entram as que já têm contato de WhatsApp, as outras recebem por e-mail.

## O que foi medido antes (twk_ro, `/health`, Meta — 05/10)

- Aria v19 no ar, 90 de 90 templates aprovados, avaliação 89/89.
- **Nenhuma entrega confirmada na história do canal**: 5 envios rastreados, 5 "undeliverable" (fixos sem WhatsApp); 6 envios de 30/09 sem rastreio.
- **Nenhum cliente com opt-in**: toda mensagem a cliente morria em `sem_opt_in`. Dos 25 pedidos de 14 dias, 9 tinham telefone inválido ou fixo na conta.
- **A Aria ficou 70 horas sem responder** (02/10 14:50 → 05/10 12:55 UTC, saldo de crédito da Anthropic), com 76 escalações URGENTE do mesmo fato e nenhum aviso fora do painel. O fundador ligou a recarga automática em 05/10.
- Duas variáveis do Easypanel apontavam para templates de um idioma só (`twk_reservation_declined`, `avaliacao_experiencia_6h`). Corrigidas pelo fundador em 05/10.
- Um pedido aceito em menos de 2 minutos (Monak, 02/10) não avisou ninguém: o vigia só anunciava linha nova se estivesse pendente.

## O que a v20 muda

| Tema | Arquivo | Mudança |
|---|---|---|
| Opt-in do cliente | `src/optInRegra.ts` (puro), `src/optIn.ts`, `src/index.ts` | Mensagem curta que cita o WhatsApp e traz exatamente um código de reserva = pedido de acompanhamento. Grava o opt-in no **número que escreveu**, liga o número ao cliente (`customer_id`), reabre os lembretes fechados por falta de opt-in e confirma em texto livre, no idioma da mensagem. Não passa pelo modelo: funciona com a IA fora do ar. Código desconhecido, reserva antiga ou número de estabelecimento seguem para a Aria como conversa. |
| Número confirmado vale mais | `src/db.ts` (`TELEFONE_CLIENTE`) | Evento, lembrete de 2 h, véspera, avaliação e as duas mensagens de pendência passam a usar o número confirmado do cliente antes do telefone da conta. |
| Coluna nova | `src/dashboard/migrations.ts` | `aria_contact_consent.customer_id` (+ índice), criada no boot como as anteriores. **Subir a v20 é a aprovação desse `ADD COLUMN`.** |
| Idioma | `idiomaPreferidoDoOptIn` | O e-mail do botão é em inglês para todos: a mensagem pronta em inglês não diz o idioma do cliente. Só idioma diferente do inglês é gravado como preferência; senão o template sai pelo país do telefone (ADR-015). |
| Alerta no celular | `src/alertaRegra.ts` (puro), `src/alertaOperador.ts`, `src/monitor.ts` | Template `twk_ops_alert` para `OPERATOR_ALERT_WHATSAPP_TO`: na 2ª checagem seguida em falha (10 min), a cada 12 h enquanto durar, e uma vez na volta. As 70 horas de 02–05/10 teriam dado 7 mensagens no celular, não 76 linhas num painel fechado. |
| Uma escalação por incidente | `src/db.ts` (`logEscalationUnica`, `resolverEscalacoes`), `src/monitor.ts`, `src/claude.ts` | Enquanto houver escalação aberta do modelo fora, não abre outra; quando o modelo volta, o monitor fecha com a nota. |
| Falha de entrega que não é número | `src/index.ts` | `failed` com código diferente de 131026 numa notificação rastreada vira escalação ALTA (uma por código enquanto aberta). Antes ia só para o console. |
| Aceite antes da primeira foto | `src/watchRegra.ts`, `src/watcher.ts` | Reserva vista pela primeira vez já aceita ou recusada (e recente, ≤ 6 h) avisa o cliente do desfecho. |
| Registro | `src/consentRegra.ts`, `src/venueEvents.ts`, `src/reminders.ts` | "Sem destinatário" diz o porquê (não marcada · lista de bloqueio · PARAR · opt-out de listagem). As varreduras de 2 h, véspera e avaliação deixam de gravar três linhas iguais por reserva. |
| `/health` | `src/index.ts` | Seção `notificacoes`: nomes dos templates carregados, idiomas, teto diário; `etapas.alertaOperador`. Nome de template não é segredo. |
| Teste sem segredo | `test/_env.ts` | `deliveryStatus.test.ts` dependia de um `.env` que não está mais na pasta e derrubava a Porta. |

Sentinela (`orchestrator/agents/sentinela-silencio/`): cinco cadências novas (`wa_entrega_confirmada`, `wa_entrega_sem_status`, `wa_falha_que_nao_e_numero`, `wa_falha_envio_cloud`, `wa_optin_clientes`) e a comparação **templates configurados × Meta** (`templates-meta.js`), que teria acusado as duas variáveis erradas antes do primeiro envio. Em 05/10 ela já acusa: nenhuma entrega confirmada em 7 dias e nenhum opt-in de cliente.

## Verificação (05/10)

- `tsc --noEmit` limpo; `npm test` 244/244 (sem `.env`).
- Avaliação `notificacao-reserva`: 101 casos, 101 aprovados. Mutação: 20 defeitos plantados (9 nas regras da v20, aplicados no `dist`), 0 sobreviventes.
- SQL novo conferido contra o banco real com `twk_ro`: as 10 consultas de leitura rodaram; as 6 de escrita foram só preparadas (sintaxe, colunas e tipos), nada executado.
- Porta de Qualidade da frota: **verde, 942 checagens** (`orchestrator/logs/porta/2026-10-05.md`). A primeira rodada do dia ficou vermelha na Aria por causa do teste que dependia do `.env`.
- Build `2026-10-05-v20-optin-do-cliente-e-alerta-no-celular`. Zip `Agente de Suporte e Concierge/aria_agent_whatsapp-2026-10-05-v20.zip` (tar.exe, 282 entradas, 0 barras invertidas, sem `.env` nem `node_modules`).
- Não verificado: o comportamento em produção (a coluna `customer_id` nasce no deploy; o opt-in só se prova com um pedido de teste real).

## Como o cliente entra (passo a passo aprovado)

1. O e-mail "solicitação enviada" (n8n, fluxo 1) ganha o botão **Receive updates on WhatsApp**. Proposta pronta em `docs/notificacoes/templates/familia/wf1-solicitacao-enviada-cliente.v20-proposta.html` — substitui a linha "Need anything? Message our concierge on WhatsApp". **O n8n não foi tocado**: entra depois do "aprovado" do fundador e de um pedido de teste.
2. O toque abre o WhatsApp com a mensagem pronta: `Hello! I would like to follow my request <CÓDIGO> on WhatsApp.`
3. O cliente envia. A Aria grava o opt-in e responde:
   > Done. From now on, updates on your request will arrive here.
   >
   > *Restaurant:* MONAK
   >
   > To stop, reply STOP.
   > Aria · The World Keys
4. Daí em diante, aceito, recusado, cancelado, lembrete de 2 h, avaliação e as mensagens de pendência chegam naquele número, no idioma do país do telefone.
5. `PARAR`/`STOP` desliga, como sempre.

Textos nos seis idiomas em `src/optInRegra.ts` (a mensagem pronta e a confirmação). Cada confirmação passa pela `outboundGate` e não contém prazo, mesa nem confirmação — coberto por teste, por avaliação e por mutação.

Risco aceito (dito ao fundador em 05/10): quem tem o código da reserva consegue ligar o próprio número a ela. O código só vai ao e-mail do cliente; a posse do código é tratada como prova. O registro guarda se o número é o da conta ou outro (`aria_outbound_log`, evento `opt_in_cliente`).

O que **não** se faz: marcar clientes à mão pelo banco (não é consentimento do cliente) nem marcar a base antiga em massa.

## Checklist do fundador

1. Subir `aria_agent_whatsapp-2026-10-05-v20.zip` no Easypanel. Conferir `/health`: `build` começa com `2026-10-05-v20` e aparece a seção `notificacoes`.
2. Aprovar o template do alerta (`docs/notificacoes/templates-meta-v4-operacao-2026-10-05.md`). Depois de criado e aprovado na Meta: `OPERATOR_ALERT_WHATSAPP_TO=+<celular>`, `OPERATOR_ALERT_TEMPLATE=twk_ops_alert`, redeploy, `/health` → `etapas.alertaOperador: true`.
3. Aprovar o botão do e-mail (preview). Depois: aplicar no n8n, fazer um pedido de teste com o próprio número e tocar no botão.
4. Conferir depois do teste (twk_ro):

```sql
-- o opt-in entrou, no número que escreveu, ligado ao cliente
SELECT tipo, source, idioma, customer_id IS NOT NULL AS ligado, updated_at
  FROM aria_contact_consent WHERE source = 'cliente_whatsapp' ORDER BY updated_at DESC LIMIT 5;

-- o registro do opt-in e o que saiu depois dele
SELECT created_at, evento, desfecho, motivo, locale FROM aria_outbound_log
 WHERE created_at > now() - interval '1 day' ORDER BY created_at DESC LIMIT 20;

-- entrega e leitura
SELECT template, locale, destinatario, status, count(*) FROM aria_delivery_status
 WHERE sent_at > now() - interval '7 days' GROUP BY 1,2,3,4 ORDER BY 1,2;
```

5. Duas semanas depois: `node orchestrator/agents/sentinela-silencio/verificar.js` — `wa_optin_clientes` e `wa_entrega_confirmada` devem estar verdes. Se a adesão ao botão for baixa, os próximos passos são do desenvolvedor: o mesmo botão na tela de confirmação do site, a caixa de consentimento na última etapa do pedido (`POST /webhook/consent`, que já existe) e o seletor de país no telefone.

## v21 — autoteste do alerta na subida (05/10, à tarde)

O fundador subiu a v20 às 14:48 UTC e pediu o teste da mensagem de alerta. Medido no `/health`: variáveis de template corrigidas, teto 50, **alerta ao operador desligado** (`OPERATOR_ALERT_TEMPLATE` vazio no container) e o template `twk_ops_alert` ainda não existia na Meta. A v20 não tinha como testar o alerta sem derrubar o modelo.

- **Template criado na Meta** em 05/10 (`twk_ops_alert`, pt_BR, UTILITY, id 1593251919268411) — texto do preview mostrado ao fundador.
- **Autoteste na subida** (`alertaDeBoot` em `src/alertaOperador.ts`, regra pura `deveAvisarBoot`): cada versão nova manda uma vez "Teste do alerta: a Aria subiu (versão …) e este canal está funcionando". Mesmo build reiniciando só repete depois de 6 h. Se falhar (template ainda em análise), tenta de novo a cada 30 min por 24 h. Desliga com `OPERATOR_ALERT_ON_BOOT=false`.
- **Todo alerta fica registrado**: `aria_outbound_log` (origem `alerta`, desfecho `alerta_enviado` / `alerta_falhou`, não conta no teto) e **entrega rastreada** em `aria_delivery_status` (destinatário `operador`).
- **Alerta que não sai abre escalação ALTA** (`[alerta-operador] o alerta ao operador NÃO saiu`), fechada sozinha no primeiro envio que der certo. Sentinela: cadência `wa_alerta_operador_saiu`.

Para o teste: no Easypanel, `OPERATOR_ALERT_WHATSAPP_TO=+<celular em E.164>` e `OPERATOR_ALERT_TEMPLATE=twk_ops_alert`; subir `aria_agent_whatsapp-2026-10-05-v21.zip`. A mensagem chega em até um minuto depois da subida (ou na primeira tentativa depois de a Meta aprovar o template). Conferência:

```sql
SELECT created_at, evento, desfecho, motivo FROM aria_outbound_log WHERE origem = 'alerta' ORDER BY created_at DESC LIMIT 5;
SELECT sent_at, evento, status, error_title, status_at FROM aria_delivery_status WHERE destinatario = 'operador' ORDER BY sent_at DESC LIMIT 5;
```

## Lacunas declaradas

- Não vi as variáveis do Easypanel: a correção das duas variáveis e o teto diário só ficam verificáveis de fora depois da v20 (seção `notificacoes` do `/health`).
- O alerta ao operador depende de dois passos do fundador (aprovar o template, informar o número). Até lá a v20 se comporta como a v19 nesse ponto, mas com uma escalação por incidente, e a Sentinela acusa `wa_alerta_operador_desligado`.
- O e-mail "solicitação enviada" é em inglês para todos; a confirmação do opt-in responde em inglês a quem tocar no botão. Os templates seguintes saem no idioma do país do telefone.
- As casas não mudam nesta versão: 4 das 14 marcadas continuam com número sem WhatsApp, e La Cucina só entra na lista de bloqueio no próximo envio.
- A porta de saída não reconhece "Sie/Ihrer" como segunda pessoa em alemão (reconhece "Ihnen/Ihre"): uma resposta alemã curta e sem saudação pode ser retida. Fail-closed, não corrigido aqui; a confirmação em alemão foi escrita com "Ihnen".
