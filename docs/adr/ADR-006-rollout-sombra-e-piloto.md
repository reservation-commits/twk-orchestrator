# ADR-006 — Rollout em sombra; piloto = fluxo de publicação de restaurante

**Status:** aceito · 2026-08-12

## Contexto
Nada está em produção oficial; e a operação tem uma ferida aberta mensurável: 979 restaurantes despublicados no limbo, 47 deles com pedidos de reserva nos últimos 90 dias — perda direta causada por ausência de coordenação DBA→Editorial→Comercial.

## Decisão
1. **Sombra (semana 1):** Orquestrador apenas observa e gera `/briefing`; em paralelo, executam-se as correções P0 dos dossiês (superusuário do DBA, envs de custo do Quill, identidade cross-customer da Aria, URL n8n do CLAVIS, 4-eyes do Atlas).
2. **Piloto (semana 2):** fluxo **publicação de restaurante** ponta-a-ponta, começando pela reconciliação real das 979 páginas: DBA identifica quem já tem foto → propõe lote de republicação → aprovação humana → Editorial confirma qualidade da ficha → Comercial é notificado dos alvos reativados. KPI antes/depois: nº de publicados, reservas em páginas reativadas.
3. **Expansão:** venda→onboarding→cobrança; opt-out unificado; só um fluxo novo por vez.
4. **Reversão explícita:** KPI-chave piora >10% por 3 dias → o fluxo volta ao modo independente (parar de rotear; nada a desinstalar).

## Alternativas consideradas
1. **Piloto = venda→onboarding→cobrança** (sugerido no brief original): mais valioso no longo prazo, mas atravessa o funil do CLAVIS que **nunca disparou um e-mail real** — pilotar sobre um fluxo que ainda não existe mede pouco. Fica como segunda onda.
2. **Big-bang (ligar todos os fluxos):** anti-objetivo explícito. Rejeitada.
