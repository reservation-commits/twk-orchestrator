# Brief ao desenvolvimento do site — rotear pedidos para casas que respondem (plano C4, 2026-10-22)

**Para:** dev do front (theworldkeys.com / manager) · **De:** Orquestrador, a pedido do fundador · **Prioridade:** a única alavanca que muda o número de jantares confirmados.

## O problema, com números (twk_ro, 21/10/2026)

| Mês | Pedidos | Aceites | Taxa |
|---|---|---|---|
| abril | 484 | 26 | 5 % |
| julho | 396 | 33 | 8 % |
| setembro | 276 | 28 | 10 % |
| outubro (até 21) | 125 | 24 | 19 % |

Em 30 dias: 189 pedidos, 30 aceites, 114 ainda pendentes. O cliente faz o pedido, a casa não responde (a maioria recebe por e-mail e nunca abre), e o cliente fica sem mesa e sem saber. Exemplo: SRI TRAT (Bangkok) recebeu 91 pedidos em 90 dias e o canal dela está morto.

## O que pedimos (três mudanças, nesta ordem)

1. **Sinal de resposta na ficha.** Cada ficha publicada mostra, perto do botão de reserva, um de três estados calculados pelo histórico de 90 dias:
   - **"Responde em ~X h"** quando a casa tem ≥ 4 pedidos e ≥ 50 % de aceites (critério já usado pelo Guardião da Reserva e pelo MAESTRO para indicar alternativas);
   - **"Confirmação em até 48 h"** nunca — não prometemos prazo de terceiro (ADR-015). Quando não há histórico suficiente, nenhum texto;
   - **botão de reserva oculto** (ou substituído por "Peça uma indicação") quando a casa tem ≥ 4 pedidos em 90 dias e 0 aceites — o pedido vai morrer, e cada um deles é um cliente que se decepciona em nosso nome.
2. **Ordem das listagens por cidade.** Entre casas com a mesma relevância editorial, as que respondem vêm primeiro. O campo pode ser uma coluna materializada (`responde_pct_90d`, `mediana_resposta_h`) recalculada uma vez por dia.
3. **Porta de cadastro.** Continua quebrada desde 30/09 (0 contas de restaurante criadas; 23.221 usuários, todos `CUSTOMER`). Sem conta, a casa não consegue responder pelo painel. Esta é a correção que destrava as duas acima. Spec já entregue em `docs/` (contas-porta-quebrada, 30/09).

## Dados prontos (somente leitura)

```sql
-- Casas que respondem (critério do Guardião): ≥ 4 pedidos em 90 dias e ≥ 50 % aceitos.
SELECT r.restaurant_id, d.name, d.city,
       count(*)                                                   AS pedidos_90d,
       count(*) FILTER (WHERE r.booking_status = 'Accept')        AS aceites_90d,
       round(100.0 * count(*) FILTER (WHERE r.booking_status = 'Accept') / count(*)) AS aceite_pct,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (coalesce(r.expired_at, now()) - r.created_date)) / 3600)
         FILTER (WHERE r.booking_status IN ('Accept', 'Decline'))  AS mediana_resposta_h
  FROM public.reservations r
  JOIN public.db_restaurants d ON d.restaurant_id = r.restaurant_id
 WHERE r.created_date >= now() - interval '90 days' AND d.published
 GROUP BY 1, 2, 3
HAVING count(*) >= 4
 ORDER BY aceite_pct DESC, pedidos_90d DESC;
```

Uma view (`v_restaurant_responsiveness`) com esta consulta é DDL: proposta ao fundador, não executada por agente.

## O que não fazer

- Não mostrar "a casa não respondeu" ao cliente (discrição, ADR-015). O sinal é positivo ("responde em ~X h") ou ausente.
- Não esconder a casa do catálogo: só o botão de pedido muda.
- Não inventar prazo.

## Como medimos o efeito (semanal, pelo Orquestrador)

Taxa de aceite (meta: de 16 % para ≥ 35 % em 60 dias), mediana de horas até a resposta, pedidos em casas com 0 aceites (meta: zero).
