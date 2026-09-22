# Template de WhatsApp para a Aria iniciar a conversa com os restaurantes (Meta · WhatsApp Manager)

> **Por que precisa disto:** pela regra da Meta, uma empresa só pode mandar texto livre a um número que **escreveu para ela nas últimas 24h**. Fora disso, só **template pré-aprovado**. A Aria já tem o código para isso (`sendTemplate` em `src/whatsapp.ts`), mas **nenhum template configurado** — por isso os lembretes dela estão desligados. Com este template aprovado, a Aria envia a primeira mensagem aos 11 e, **assim que o restaurante responder, a janela de 24h abre e ela conversa em texto livre no idioma dele** — italiano, francês, o que for. É a resposta ao problema de idiomas.

## O que você faz (uma vez, ~10 min; aprovação da Meta leva de minutos a 2 dias)

1. business.facebook.com → **WhatsApp Manager** → conta da TWK → **Message templates** → **Create template**.
2. **Categoria:** Utility (é uma conta relacionada a um serviço que eles já usam — responder reservas). Se a Meta reclassificar como Marketing, aceitar: continua funcionando, só muda o custo por mensagem.
3. **Nome:** `twk_conta_profissional_respondedores`
4. **Idiomas:** criar o mesmo template em `en`, `pt_PT`, `fr`, `it`, `es` com os textos abaixo. Variáveis: `{{1}}` = nome do restaurante · `{{2}}` = número de pedidos aceitos (180 dias).
5. **Botão:** "Visit website" → `https://manager.theworldkeys.com/register`
6. Submeter. Quando aprovado, me avisar com o nome exato e os idiomas aprovados: eu configuro `WHATSAPP_ATIVACAO_TEMPLATE` no serviço da Aria e o envio aos 11 vira um comando com aprovação.

## Textos (colar no corpo do template)

**en**
> Hello, {{1}} team. This is Aria, from The World Keys — the reservations platform whose requests you have been answering. You accepted {{2}} table requests with us in the last six months; very few restaurants do that. There is a free professional account for the restaurant: every request in one dashboard, answered in one tap from your phone. Reply here and I will help you activate it in two minutes — in your language. If you prefer not to receive messages from us, just reply STOP.

**pt_PT**
> Olá, equipe do {{1}}. Aqui é a Aria, da The World Keys — a plataforma de reservas cujos pedidos vocês têm respondido. Vocês aceitaram {{2}} pedidos de mesa conosco nos últimos seis meses; pouquíssimos restaurantes fazem isso. Há uma conta profissional gratuita para a casa: todos os pedidos num painel só, respondidos num toque pelo telemóvel. Respondam aqui e eu ajudo a ativar em dois minutos. Se preferirem não receber mensagens nossas, basta responder PARAR.

**fr**
> Bonjour, l'équipe de {{1}}. Ici Aria, de The World Keys — la plateforme de réservation dont vous répondez aux demandes. Vous avez accepté {{2}} demandes de table avec nous ces six derniers mois ; très peu de restaurants le font. Il existe un compte professionnel gratuit pour la maison : toutes les demandes dans un seul tableau de bord, une réponse en un geste depuis le téléphone. Répondez ici et je vous aide à l'activer en deux minutes, dans votre langue. Si vous préférez ne plus recevoir de messages, répondez simplement STOP.

**it**
> Buongiorno, team di {{1}}. Sono Aria, di The World Keys — la piattaforma di prenotazioni alle cui richieste state rispondendo. Avete accettato {{2}} richieste di tavolo con noi negli ultimi sei mesi; pochissimi ristoranti lo fanno. C'è un account professionale gratuito per il locale: tutte le richieste in un unico pannello, con risposta in un tocco dal telefono. Rispondete qui e vi aiuto ad attivarlo in due minuti, nella vostra lingua. Se preferite non ricevere messaggi, basta rispondere STOP.

**es**
> Hola, equipo de {{1}}. Soy Aria, de The World Keys — la plataforma de reservas cuyas solicitudes han estado respondiendo. Aceptaron {{2}} solicitudes de mesa con nosotros en los últimos seis meses; muy pocos restaurantes lo hacen. Hay una cuenta profesional gratuita para la casa: todas las solicitudes en un panel, respondidas en un toque desde el móvil. Respondan aquí y les ayudo a activarla en dos minutos, en su idioma. Si prefieren no recibir mensajes, basta responder STOP.

## Regras que valem quando a Aria assumir este canal

- Enviar **só** aos que estão na lista aprovada (11 confirmadores primeiro), 1 template por casa, **nunca** um segundo template sem resposta — o lembrete, se houver, é humano.
- Consultar o Registro de Opt-out antes; "STOP/PARAR" → `set_outbound_consent` + Registro (escopo outreach), e nunca mais.
- A conversa que se abre é conduzida pelo **FLUXO 6** da Aria (conta profissional), que já existe no prompt — ela verifica `restaurant_users`, orienta o código, não promete nada que não exista e escala PARCEIRO_B2B quando trava.
- A Aria **não** faz o pitch da campanha de fundadores nem cita "pendências": o argumento é o deles (aceites), como no Extrato.
- Este é o **número do concierge de clientes** falando com restaurantes: manter o tom de concierge, não de vendedor. Se o volume crescer, separar um número B2B.

## O que isto NÃO resolve

Quem não responder ao template continua sem canal — e aí voltamos ao e-mail (Extrato) e, por último, à ligação humana em PT/EN. Voz por IA continua fora até haver evidência de que texto não basta.
