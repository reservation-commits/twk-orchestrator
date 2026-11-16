# Template de WhatsApp v6 — alerta à equipe em francês (14/11/2026 — **aprovado pelo fundador ("Sim, envia") e enviado à Meta em 14/11: id 1454597642744983, UTILITY, PENDING**)

O fundador pediu em 14/11 que o Julien receba em francês o aviso de pedido de reserva sem resposta no Instagram do
@wantedchauffeur. O alerta ao operador (`twk_ops_alert`, v4) só existe em português e a Meta não deixa mandar texto
livre fora da janela de 24 horas. Por isso, um template de equipe em francês, genérico: serve a este aviso e a
qualquer outro aviso interno para quem fala francês.

Não é mensagem a cliente nem a estabelecimento: a Aria só manda para nomes da lista `TEAM_ALERT_WHATSAPP`. O rodapé
não é o de opt-out.

| # | Nome na Meta | Quem recebe · quando | Variáveis |
|---|---|---|---|
| 1 | `twk_team_alert` | pessoa da equipe · quando outro agente pede (primeiro uso: pedido de reserva no Instagram sem resposta há 30 min) | 1 sujet · 2 situation · 3 heure (Paris, AM/PM) |

Amostras para a Meta: sujet "Instagram @wantedchauffeur" · situation "Il y a une demande de réservation sans réponse
sur ce post : https://www.instagram.com/reel/C9xYz12AbCd/" · heure "14/11 7:31 PM (Paris)".

## Rodapé

| Idioma | Rodapé |
|---|---|
| fr | The World Keys · équipe |

## 1. `twk_team_alert` — alerta à equipe

**fr**
Cabeçalho: Alerte équipe
> Message automatique pour l'équipe.
>
> *Sujet :* {{1}}
> *Situation :* {{2}}
> *Heure :* {{3}}
>
> Merci de vérifier dès que possible.

Tradução para conferência (não vai à Meta): "Alerta à equipe. Mensagem automática para a equipe. Assunto: {{1}}.
Situação: {{2}}. Horário: {{3}}. Por favor, verifique assim que possível. The World Keys · equipe."

## Como criar (depois do "aprovado")

```
node orchestrator/agents/notificacao-reserva/meta-templates.mjs --doc docs/notificacoes/templates-meta-v6-equipe-fr-2026-11-14.md --lang fr            # dry-run
node orchestrator/agents/notificacao-reserva/meta-templates.mjs --doc docs/notificacoes/templates-meta-v6-equipe-fr-2026-11-14.md --lang fr --apply
node orchestrator/agents/notificacao-reserva/meta-templates.mjs --doc docs/notificacoes/templates-meta-v6-equipe-fr-2026-11-14.md --status
```

Depois de `APPROVED`, no Easypanel da Aria: `TEAM_ALERT_TEMPLATE=twk_team_alert` e `TEAM_ALERT_LOCALE=fr`, Deploy.
Pronto quando: o `/health` da Aria mostra `alertaEquipe: true` e o primeiro aviso chega ao Julien em francês.
