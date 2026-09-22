# Runbook — Mudança em massa de `published` (publicação/despublicação de restaurantes)

**Contexto:** `published` controla a existência da página pública. Em 2026-07-02, um lote despublicou 985 restaurantes sem aviso; 47 receberam pedidos de reserva enquanto fora do ar. Este runbook existe para que isso nunca se repita.

## Antes (obrigatório)
1. Proposta com: universo exato (`SELECT count(*)` + amostra de 10), motivo por linha, e **manifesto com timestamp no nome** (`manifest-unpublish-AAAAMMDD-HHMM.json`) contendo ids + estado anterior completo. NUNCA sobrescrever manifesto existente (o dry-run do script legado destruía o manifesto real — corrigir antes de reutilizá-lo).
2. Verificação de demanda: quantas dessas páginas tiveram reservas/pedidos nos últimos 90 dias? Páginas com demanda ativa exigem justificativa individual.
3. Aprovação humana do lote.
4. Notificação prévia via handoff a **Comercial** (alvos de outreach afetados) e **Editorial** (fichas afetadas).

## Durante
- Em transação; blast-radius conferido contra a contagem prévia; `agent_audit_log` com `old_data`.

## Depois
1. Alerta de reconciliação agendado: itens que recuperarem o critério (ex.: ganharem foto) devem ser republicados — verificar semanalmente até o lote zerar.
2. Verificar variação diária de publicados no `/briefing` (>2%/dia = anomalia).
3. Registro do lote em `orchestrator/logs/` com trace_id.

## Recuperação (lote errado)
Republicar EXATAMENTE pelo manifesto (ids + estado anterior), nunca por flag genérica (`ready_pending_photo` provou-se desconectada). Confirmar contagem final = contagem do manifesto.
