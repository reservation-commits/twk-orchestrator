# Ciclo do cliente — véspera · pós-visita · boas-vindas

Agente determinístico (sem LLM) que fecha três lacunas da auditoria de 10/09. Lê a réplica (`twk_ro`), monta os e-mails com os blocos do padrão TWK (`chave-girada/n8n/_blocos-twk.js`) e envia pelo canal do MAESTRO (`maestro-email`, compensado contra o defeito QP).

| Tarefa | Gatilho | Destinatário | Conteúdo |
|---|---|---|---|
| `vespera` | reserva `Accept*`, `expired_at IS NULL`, mesa amanhã | cliente (e-mail da conta) | horário em destaque, endereço, telefone, mapa (lat/lon), "precisa mudar?" → `/users/reservations` |
| `pos-visita` | reserva `Accept*`, mesa ontem | cliente | duas notas + uma linha; responder por e-mail (Aria, FLUXO 4) ou botão WhatsApp com o código |
| `boas-vindas` | linha em `restaurant_users` criada nas últimas 24h (fora `excluidos-teste.json`) | dono/gerente (e-mail da conta) | três coisas que importam, "Open my dashboard", promessa dos números no dia 7 |

## Uso
```
node run.js                 # dry-run (padrão): lista candidatos, grava previews em state/previews/
node run.js --tarefa vespera
node run.js --amostra       # renderiza os três templates com dados fictícios
node run.js --apply --aprovacao "<frase do fundador>"
```
Em operação desde 2026-09-11 (aprovação do fundador no chat). Agendado no Windows pela `orchestrator/command-center/regencia/agendar.ps1` como `TWK Ciclo do Cliente (diario)`, 09:15 hora do notebook (America/Sao_Paulo = 14:15 Paris), log em `orchestrator/logs/tarefas/ciclo-cliente-<data>.log`. Véspera e pós-visita cobrem "amanhã" e "ontem" pelo `current_date` do banco (UTC). O `run.js` tem `connectionTimeoutMillis` de 15 s e watchdog de 4 min: nunca fica pendurado em silêncio. **Antes de dizer que o ciclo rodou, ler o log do dia** — o agendador local morre quando o notebook está sem memória (incidente 2026-09-11).

## Guardrails
Dry-run por padrão · aprovação obrigatória no `--apply` · ledger `state/envios.jsonl` (nunca dois envios do mesmo tipo para a mesma chave) · consentimento (`aria_contact_consent`, por telefone e `email:<endereço>`) · casas de teste fora · máx. 40 por execução · e-mail do cliente nunca gravado (só domínio) · audit por envio · o texto ao cliente nunca promete mesa além do que o status diz.

## Pendências conhecidas
- Aria: o FLUXO 4 (avaliação) está escrito para WhatsApp (telefone); no e-mail a identidade é o remetente — adicionar a variante no prompt para que uma resposta ao "How was…?" seja registrada via `save_experience_review`.
- Dia 7 do parceiro ("seus primeiros números"): segunda tarefa a construir, com os KPIs do Guardião por casa.
- Idioma: cliente sempre em EN (padrão dos transacionais); a conta do cliente não guarda idioma.
