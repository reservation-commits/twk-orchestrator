# Template de WhatsApp v4 — alerta ao operador (05/10/2026 — **proposta, aguardando o "aprovado" do fundador; nada foi enviado à Meta**)

De 02/10 14:50 a 05/10 12:55 UTC a Aria ficou 70 horas sem responder ninguém (saldo de crédito da Anthropic). O único aviso era a escalação URGENTE no painel — 76 delas. A Aria v20 passa a avisar **no celular de quem opera**, por um template que não depende do modelo, do painel nem do e-mail.

Não é mensagem a cliente nem a estabelecimento: vai só para o número em `OPERATOR_ALERT_WHATSAPP_TO`. Por isso existe num idioma só (pt_BR) e o rodapé não é o de opt-out.

| # | Nome na Meta | Quem recebe · quando | Variáveis |
|---|---|---|---|
| 1 | `twk_ops_alert` | operador · na 2ª checagem seguida em falha (10 min), de novo a cada 12 h enquanto durar, e uma vez na volta | 1 sistema · 2 situação · 3 horário (Paris) |

Amostras para a Meta: sistema "Aria (atendimento)" · situação "Modelo de IA fora do ar. A Aria não responde clientes até voltar." · horário "05/10 14:55 (Paris)".

## Rodapé

| Idioma | Rodapé |
|---|---|
| pt_BR | The World Keys · operação |

## 1. `twk_ops_alert` — alerta operacional

**pt_BR**
Cabeçalho: Alerta operacional
> Aviso automático da operação.
>
> *Sistema:* {{1}}
> *Situação:* {{2}}
> *Horário:* {{3}}
>
> Os detalhes estão no painel de escalações.

## Como criar (depois do "aprovado")

```
node orchestrator/agents/notificacao-reserva/meta-templates.mjs --doc docs/notificacoes/templates-meta-v4-operacao-2026-10-05.md --lang pt_BR            # dry-run
node orchestrator/agents/notificacao-reserva/meta-templates.mjs --doc docs/notificacoes/templates-meta-v4-operacao-2026-10-05.md --lang pt_BR --apply
node orchestrator/agents/notificacao-reserva/meta-templates.mjs --doc docs/notificacoes/templates-meta-v4-operacao-2026-10-05.md --status
```

Depois de aprovado pela Meta, no Easypanel da Aria: `OPERATOR_ALERT_WHATSAPP_TO=+<seu celular em E.164>`, `OPERATOR_ALERT_TEMPLATE=twk_ops_alert`, redeploy, e conferir `/health` → `etapas.alertaOperador: true`.

As três situações que a v20 envia hoje:

- "Modelo de IA fora do ar por falta de crédito na Anthropic. A Aria não responde clientes até voltar."
- "Modelo de IA continua fora do ar há 12 h (falta de crédito na Anthropic). A Aria segue sem responder clientes."
- "Modelo de IA voltou a responder, depois de 70 h fora. As mensagens de WhatsApp recebidas nesse intervalo estão sendo reprocessadas."
