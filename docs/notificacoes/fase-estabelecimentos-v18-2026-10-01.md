# WhatsApp para estabelecimentos — fase 1 (casas selecionadas), estado em 01/10/2026 e Aria v18

Pergunta do fundador (01/10): "o que falta para o sistema de notificações por WhatsApp para estabelecimentos selecionados, nesse primeiro momento, usuários ainda não". Resposta medida no banco (`twk_ro`), na Meta (`meta-templates.mjs --status`) e no `/health` da Aria; autorização do fundador em seguida: "fique à vontade para executar suas mais altas recomendações".

## O que já estava de pé (fato)

- 14 casas com opt-in (`aria_contact_consent`, tipo `estabelecimento`, origem `fundador`, 30/09): A Petisqueira, Athénée, Billionaire, Boteco Belmonte, Casa do Prego, La Cucina, La Route du Miam, La Table de Marie, Le Tobsil, L'Evangelista, Monak, My Sushi, Scartuccio, Sri Trat. Todas publicadas, todas em E.164.
- Aria v17 no ar desde 30/09 17:18 UTC com as etapas de casa ligadas: pedido novo, lembrete 24 h, véspera, agenda do dia. Véspera ao cliente (com e sem mapa) desligada.
- 20 templates de casa na Meta; 16 aprovados. Pendentes em 01/10: `twk_venue_request_reminder` fr/it, `twk_venue_agenda` en/it/es.
- Primeiros envios reais (30/09 17:20 UTC): 6 lembretes de pedido pendente — Billionaire, Boteco Belmonte (3), Casa do Prego, L'Evangelista. **Todos em inglês.**
- Resposta da casa pelo WhatsApp é reconhecida (`venueIdentity.ts`): a Aria sabe que é casa e recebe os pedidos pendentes dela no contexto. A confirmação continua pela página `/r/{código}`.
- `PARAR` vale para casa: `outbound_opted_out` é respeitado no envio ao estabelecimento.

## O que faltava (achados), do mais grave ao menor

1. **O avaliador de telefone ignorava o "+".** `avaliarTelefone` descartava o sinal e testava a leitura brasileira: "+33 98…" virava "DDD 33 + celular", "+66 20…" virava "DDD 66". La Cucina e Sri Trat, duas das 14, nunca receberam e a varredura repetia a cada 20 min — 57 tentativas cada em 19 h. **Corrigido na v18.**
2. **Idioma errado.** Os 6 envios saíram em inglês para casas pt/fr/it. A escolha de locale só aceita o que está em `REMINDERS_LOCALES` no Easypanel. Suposição forte: a variável em produção está em `en`. Correção é configuração (abaixo), **depois** da aprovação dos templates pendentes nesses idiomas.
3. **Templates pendentes** nos idiomas das 14 (fr, it). Criados 30/09 15:53 UTC; prazo normal da Meta.
4. **Não sabíamos se a casa recebeu ou leu.** O webhook de status (`sent → delivered → read`, `failed`) só imprimia o `failed` no console. **Corrigido na v18:** tabela `aria_delivery_status`.
5. **Resposta da casa cai no atendimento geral.** Aceitável na fase 1: a Aria conduz para o link.
6. **26 casas candidatas fora.** `optin-sql.cjs` gera hoje 40 casas válidas (0 excluídas por telefone); 14 aplicadas. Casas com movimento fora da lista: Don Sebastião, Repolho, Puny, Stravinskij, Trattoria del Tribunale, Papadakis, Joaquina; com evento já barrado por "sem destinatário": Clementine, Epona, Fratelli, Sou Omakase, O António. **Decisão do fundador** (leva 2 = um arquivo pela porta única, `AUTONOMO_COM_LOG`).
7. **Teto diário em zero = sem teto.** Configuração (abaixo).
8. Repositório da Aria 14 commits à frente do GitHub (deploy por zip).

## O que a v18 muda (código da Aria, 01/10)

| Arquivo | Mudança |
|---|---|
| `src/phoneQuality.ts` | "+" na frente declara o país: sem leitura brasileira alternativa. Sem "+", a quarentena `AMBIGUO_BR` continua. "+21 9…" (celular BR com "+" e sem 55) cai em `INVALIDO`, não no Egito. |
| `src/whatsapp.ts` | `sendTemplate` devolve `{ ok, messageId }` (o `wamid` da Meta). `postWithRetry` continua booleano para o texto livre. |
| `src/deliveryStatus.ts` (novo) | `registrarMensagemEnviada` após cada template aceito; `atualizarStatusEntrega` no webhook; status só avança (`sent < delivered < read`; `failed` terminal); `resumoEntregas(dias)` para painel e relato. Sem telefone. |
| `src/dashboard/migrations.ts` | `CREATE TABLE IF NOT EXISTS aria_delivery_status` (wa_message_id PK, reservation_code, template, locale, destinatario, evento, status, error_title, sent_at, status_at). Mesmo mecanismo das 28 tabelas `aria_*`. |
| `src/index.ts` | Todo status do webhook avança a linha; `failed` continua no console. |
| `src/venueEvents.ts` | Novo desfecho `telefone_nao_enviavel` quando todos os números marcados da casa são inválidos/ambíguos — **definitivo** para a varredura (não repete a cada tique). Registra o `wamid` de cada envio. |
| `src/reservationEvents.ts`, `src/reminders.ts` | Registram o `wamid` (destinatário `cliente`). |
| `test/phoneQuality.test.ts`, `test/deliveryStatus.test.ts` | 3 casos novos do "+" (La Cucina, Sri Trat, Singapura com e sem "+"); 4 casos da ordem de status. |

Porta: `tsc --noEmit` limpo; `npm test` 219/219. Build `2026-10-01-v18-mais-declara-pais-e-entrega-rastreada`. Zip `aria_agent_whatsapp-2026-10-01-v18.zip` (tar.exe, 267 entradas, 0 barras invertidas).

## Checklist do fundador (Easypanel, serviço `theworldkeys-aria-whatsapp-agent`)

1. Subir o zip v18. Conferir `/health` → `build` começa com `2026-10-01-v18`.
2. `RESERVATION_EVENTS_DAILY_CAP=50` — teto compartilhado cliente+casa; com 14 casas, 50/dia é folga e é rede de segurança.
3. Quando `meta-templates.mjs --status --doc docs/notificacoes/templates-meta-v3-novas-2026-09-30.md` mostrar fr e it aprovados em `twk_venue_request_reminder`: `REMINDERS_LOCALES=en,pt_BR,fr,it,es,de`. Antes disso, um idioma ligado com template pendente falha na Cloud API (a v17 não queima a marca; só suja o registro).
4. `REMINDERS_TEMPLATE=twk_reminder_2h` — o nome antigo `lembrete_reserva_2h` não existe mais na conta da Meta (lado do cliente; barrado hoje por opt-in, falharia quando passar).
5. Leva 2 de casas, se quiser: `node orchestrator/agents/chave-girada/ativacao/optin-sql.cjs`, revisar `orchestrator/state/ativacao/optin-estabelecimentos.sql` (apagar as que não quiser), `node orchestrator/agents/dba-escrita/executar.js <arquivo> --apply --autonomo`.

## Como verificar depois do deploy (twk_ro)

```sql
-- La Cucina e Sri Trat devem sair do "ambíguo" na primeira varredura após o deploy
SELECT template, desfecho, count(*), max(created_at)
  FROM aria_outbound_log WHERE created_at >= now() - interval '1 day' GROUP BY 1,2 ORDER BY 1,2;

-- entregue / lido por casa (v18)
SELECT d.destinatario, d.template, d.locale, d.status, count(*), max(d.status_at)
  FROM aria_delivery_status d WHERE d.sent_at >= now() - interval '7 days' GROUP BY 1,2,3,4 ORDER BY 1,2,3,4;
```

## Lacunas declaradas

- Não vi as variáveis de produção (sem acesso ao Easypanel): o `REMINDERS_LOCALES=en` é inferido dos 6 envios em inglês.
- A marca queimada por `telefone_nao_enviavel` não reabre quando o número é corrigido; vale só para as próximas reservas. Escolha consciente: silêncio no registro vale mais que uma segunda chance automática.
- A origem dos 7 GB que sumiram do disco do notebook em 30/09 antes do reinício continua sem explicação (não é deste documento, fica registrado).
