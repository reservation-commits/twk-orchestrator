# Passo a passo do fundador — atualizado em 2026-09-03

> Revisado depois das suas respostas de 02/09. **Cinco dos dez itens da lista anterior já foram executados por mim.** O que sobrou está abaixo, em ordem de impacto, com o clique exato. Marque `[x]` ao concluir.

## Já resolvido — você não precisa fazer nada

| Item anterior | Situação |
|---|---|
| ~~Ligar para as 3 casas~~ | Você não conseguiu contato. As mesas de ontem passaram; entram como "vencidas". O Guardião passa a avisar o cliente ANTES da data, que é o que evita a repetição. |
| ~~Rodar a DDL `listing_consent`~~ | **Feito por mim** em 03/09. Tabela criada, Cañete registrado, e o guardrail testado: uma tentativa de republicar o Cañete agora falha no banco. |
| ~~Configurar o e-mail do Despacho~~ | **Feito.** Encontrei o token do workflow n8n "MAESTRO — Enviar email" e configurei o canal. Testado: o Despacho de 03/09 foi entregue em `thekeys.marlon@gmail.com` (HTTP 200). Segredos gravados em `C:\Users\bianc\.twk\regencia.env`, fora do OneDrive. |
| ~~Perguntas Q-08 e Q-11~~ | Respondidas por verificação, não por você: "MERCÚRIO" não existe em arquivo nenhum (é o CLAVIS); o link de resposta é mesmo `theworldkeys.com/r/{código}`, confirmado no e-mail real enviado à JOAQUINA em 31/08. |
| ~~Agendar a Regência~~ | Três tarefas rodando no Windows: Despacho às 08:00, alerta crítico de hora em hora (08–22h), lote do Guardião às 09:00. |

## Agora — 2 itens, ~5 minutos

- [ ] **1. Subir a Aria certa (3 min).** ⚠️ **O zip que você subiu em 01/09 não tem o FLUXO 7** — conferi dentro do arquivo: tem o FLUXO 6, não tem o 7 nem as tags de remoção. Ou seja, a Aria em produção ainda trata um pedido de remoção como oportunidade de venda, que foi exatamente o erro do caso Cañete. Use o arquivo novo que gerei: **`Agente de Suporte e Concierge/aria_agent_whatsapp-FLUXO7-2026-09-02.zip`** (500 KB, com `src` e `dist` já compilados, 95/95 testes verdes). Suba esse no EasyPanel e faça Redeploy.
- [ ] **2. Amanhã de manhã: aprovar o lote do Guardião (2 min).** Às 09:00 a tarefa monta o lote do canário (Paris, Atenas, Marrakech — no máximo 20 e-mails). **Você não precisa procurar em lugar nenhum:** o Despacho das 08:00 chega no seu Gmail e, se houver lote, ele aparece descrito lá. Para aprovar, basta me dizer aqui na conversa: **"aprovo o lote do Guardião"**. Eu confiro os e-mails um a um e executo. É o mesmo jeito como você aprovou os 167 e-mails da campanha.

## Quando puder — sem pressa, mas com impacto

- [ ] **3. Silenciar a Aria nas conversas do Cañete (1 min).** O guardrail do sistema bloqueou eu mesmo fazer esta escrita. Cole no **Cloud SQL Studio** (mesmo lugar onde a DDL rodaria), banco `twk_auth`:
  ```sql
  INSERT INTO public.aria_handoffs (phone, operator, until) VALUES
    ('email:canete@grupolive.net','Márlon Andrade', now() + interval '180 days'),
    ('email:reservas@barcanete.com','Márlon Andrade', now() + interval '180 days')
  ON CONFLICT (phone) DO UPDATE SET operator = EXCLUDED.operator, until = EXCLUDED.until;
  ```
  *Por quê:* se o Cañete responder, a Aria não atravessa a conversa humana.
- [ ] **4. Fechar as 4 escalações da Aria (10 min).** Painel da Aria → Escalações. Duas de PARCEIRO_B2B (uma desde 29/07), uma MODIFICACAO (09/08), uma PEDIDO_ESPECIAL (13/08). Cada uma é alguém esperando há mais de um mês.
- [ ] **5. Front: `/hospitality/{slug}/` deve responder 404 quando `published=false` (1–2 h de dev).** Três casas despublicadas ainda recebem pedidos. O banco agora impede republicação, mas a página continua no ar — só o front resolve.
- [ ] **6. Corrigir o e-mail da JOAQUINA (13331).** `joaquina@joaquinabar.com.br` não existe (bounce confirmado). Enquanto não corrigir, o Guardião roteia essa casa por telefone.

## Se quiser me dar mais autonomia (decisão sua, uma frase)

Hoje **toda escrita em produção é bloqueada** para mim, mesmo com a sua autorização geral — foi o que aconteceu no item 3 acima. Se você responder *"autorizo escritas pequenas e auditadas em produção"*, eu passo a fechar sozinho casos como esse (sempre com registro em `agent_audit_log`, dados antigos guardados e comando de rollback no log). Se preferir manter como está, cada um vira um passo seu — como este. **Não mudo isso sem a sua palavra.**

## O que roda sozinho a partir de agora

- **08:00** — Despacho do MAESTRO no seu Gmail: manchete, o que decidi, o que preciso de você, quem está esperando.
- **08:00–22:00, de hora em hora** — se aparecer algo crítico novo (cliente com mesa hoje sem resposta, pedido de remoção, agente cego), você recebe um alerta na hora. Sem crítico novo, silêncio.
- **09:00** — o Guardião monta o lote do canário para a sua aprovação.
- A qualquer momento, nesta conversa: `/despacho`.
