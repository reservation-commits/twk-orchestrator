# Template de WhatsApp v6b — alerta à equipe em francês, segunda redação (16/11/2026 — **proposta, aguardando o "aprovado" do fundador; nada foi enviado à Meta**)

O `twk_team_alert` (v6) foi aprovado pela Meta em 14/11, mas na categoria **MARKETING**, não UTILITY, apesar de o
pedido ter ido com a categoria travada. Isso tem dois efeitos: cada aviso custa o preço de conversa de marketing
(cerca de cinco vezes o de serviço), e a Meta aplica a mensagens de marketing um limite por destinatário que pode
**descartar avisos sem erro visível** (código 131049). Para um alerta operacional, isso é risco de silêncio.

Esta segunda redação segue a regra que a Meta usa para UTILITY: a mensagem fala de um pedido específico que já existe
e do que fazer com ele, sem convite genérico. Nome novo, porque a Meta não deixa trocar a categoria de um nome já
aprovado. Se vier UTILITY, ela substitui a v6 em `TEAM_ALERT_TEMPLATE`; se vier MARKETING de novo, fica-se com a v6.

| # | Nome na Meta | Quem recebe · quando | Variáveis |
|---|---|---|---|
| 1 | `twk_team_pending_request` | pessoa da equipe · pedido de reserva do Instagram sem resposta há 30 min (ou outro pedido pendente que um agente aponte) | 1 canal · 2 détail (texto e link) · 3 heure (Paris, AM/PM) |

Amostras para a Meta: canal "Instagram @wantedchauffeur" · détail "Il y a une demande de réservation sans réponse
sur ce post : https://www.instagram.com/reel/C9xYz12AbCd/" · heure "16/11 7:31 PM (Paris)".

## Rodapé

| Idioma | Rodapé |
|---|---|
| fr | The World Keys · équipe |

## 1. `twk_team_pending_request` — pedido em espera

**fr**
Cabeçalho: Demande en attente
> Une demande vous attend sur {{1}}.
>
> {{2}}
>
> Reçue le {{3}}. Répondez directement sur le canal indiqué.

Tradução para conferência (não vai à Meta): "Pedido em espera. Um pedido espera por você em {{1}}. {{2}}. Recebido em
{{3}}. Responda diretamente no canal indicado. The World Keys · equipe."

## Como criar (depois do "aprovado")

```
node orchestrator/agents/notificacao-reserva/meta-templates.mjs --doc docs/notificacoes/templates-meta-v6b-equipe-fr-utility-2026-11-16.md --lang fr            # dry-run
node orchestrator/agents/notificacao-reserva/meta-templates.mjs --doc docs/notificacoes/templates-meta-v6b-equipe-fr-utility-2026-11-16.md --lang fr --apply
node orchestrator/agents/notificacao-reserva/meta-templates.mjs --doc docs/notificacoes/templates-meta-v6b-equipe-fr-utility-2026-11-16.md --status
```

Se `APPROVED` com categoria `UTILITY`: no Easypanel da Aria, `TEAM_ALERT_TEMPLATE=twk_team_pending_request`, Deploy.
O código da Aria manda os mesmos três campos (sistema, situação, horário) nas mesmas posições: nada muda no Olheiro.
