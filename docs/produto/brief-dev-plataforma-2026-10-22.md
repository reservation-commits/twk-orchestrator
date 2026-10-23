# Brief ao dev — o que o site e o manager precisam para o sistema de agentes render (22/10/2026)

**De:** operação TWK (Orquestrador, a pedido do fundador) · **Para:** desenvolvedor do front (theworldkeys.com e manager.theworldkeys.com) · **Como ler:** cada item tem o problema com o número que o prova, o que fazer e como vamos testar. Os números foram medidos em 21 e 22/10 no banco da plataforma e no próprio site. Onde é hipótese, está escrito.

## Em uma frase

Do lado de cá tudo está automatizado: pedidos acompanhados, clientes avisados, casas cobradas, remoções tratadas. O que trava o resultado hoje são quatro coisas do site: **a porta de cadastro não cria conta**, **o link de resposta do restaurante expõe dados de cliente**, **o site manda pedidos para casas que nunca respondem**, e **o pedido de mesa exige conta antes de pedir**. Nesta ordem.

---

## P0 — esta semana

### 1. A porta de cadastro de restaurante não cria conta

**Fato.** 23.221 usuários no banco, **zero** com papel diferente de `CUSTOMER`. `restaurant_users` tem 0 linhas. Em `restaurant_invitations` há 1 convite e 0 concluídos. Desde 30/09 nenhum restaurante conseguiu virar conta, embora 34 casas respondam a pedidos por e-mail e 14 tenham ligado o WhatsApp. Sem conta, a casa responde por e-mail quando lembra, e 70 % dos pedidos morrem sem resposta.

**Causas conhecidas (specs de 07/09 e 16/09 em `docs/agentes/`):**
- aprovar uma candidatura no backoffice **não dispara** o e-mail com o link de criação de senha (`/{restaurants}/invite?token=…`). A página do link já funciona; falta o disparo. Caso real: ELEOS, aprovado em 05/09, convite venceu em 07/09 sem conta;
- o formulário pede 7 campos de quem já está listado; a verificação por código no e-mail da listagem falha quando esse e-mail é genérico ou morto.

**O que fazer.**
1. Ao mudar uma candidatura para `approved`, disparar o e-mail com o link do convite (menos de 1 minuto).
2. Aceitar `/register?claim=<token>` com token de `restaurant_invitations`: restaurante pré-preenchido, só confirmar e criar a senha. Token vencido → "este link expirou; peça outro respondendo ao e-mail".
3. Candidatura com posse provada (código no e-mail da listagem **ou** WhatsApp do número da listagem) entra na hora, sem revisão manual.
4. Primeira tela do painel = os pedidos vivos da casa (`expired_at IS NULL` e `booking_status IN ('Pending','In Treatment')`) com Accept/Decline, e os números dos últimos 90 dias. Painel vazio na primeira sessão é abandono.
5. Em cada ficha pública, linha discreta "É o dono? Assuma a sua página" → `/register?slug={slug}`.

**Aceite.** Uma pessoa de fora, a partir de um link recebido por WhatsApp, chega ao painel com a página pronta e os próprios números em menos de 5 minutos, sem ajuda. Aprovar uma candidatura de teste dispara o e-mail; concluir cria a linha em `restaurant_users` e o usuário deixa de ser `CUSTOMER`.

### 2. `/r/{código}` de reserva vencida continua acionável e expõe dados do cliente

**Fato (reproduzido hoje, 22/10).** `GET https://theworldkeys.com/r/FBV36VR8` (reserva antiga) responde 200 com os botões **Accept / Decline** e com e-mail e telefone do cliente visíveis a qualquer pessoa que tenha o link. Esse link circula por e-mail sem login. É exposição de dado pessoal e permite "aceitar" uma reserva que já passou. Pedido aberto desde 03/09.

**O que fazer.**
1. Se `booking_date + reservation_time` já passou no fuso do restaurante, **ou** `expired_at IS NOT NULL`, **ou** `booking_status` fora de `{Pending, In Treatment}`: renderizar só leitura, com o estado escrito ("Esta solicitação expirou em …"), sem botões; `POST` de ação → 409.
2. Contato do cliente (e-mail, telefone) só **depois** do Accept. Antes: primeiro nome e número de pessoas.
3. Registrar cada acesso (`reservation_code`, hash do IP, timestamp).
4. Na tela de agradecimento depois de Accept/Decline: botão "Ativar minha conta" com o link do convite (item 1.2).

**Aceite.** `GET /r/FBV36VR8` → 200 sem botões e sem e-mail/telefone. `POST` em reserva vencida → 409. Reserva viva: contato só aparece após Accept.

### 3. Rotear pedidos para casas que respondem

**Fato.** Em 30 dias: 189 pedidos, 30 aceites (16 %). Em 90 dias, SRI TRAT (Bangkok) recebeu 91 pedidos e nenhum canal dela recebe. O cliente pede, a casa nunca vê, o cliente fica sem mesa e culpa o site. Taxa de aceite por mês: abril 5 %, setembro 10 %, outubro 19 %.

**O que fazer** (detalhe em `docs/produto/brief-front-roteamento-casas-que-respondem-2026-10-22.md`).
1. Calcular por casa, uma vez por dia, com 90 dias de histórico: pedidos, aceites, % de aceite, mediana de horas até a resposta (consulta pronta no brief).
2. Na ficha: **"Responde em ~X h"** quando a casa tem ≥ 4 pedidos e ≥ 50 % de aceite (critério já usado pelos agentes). Sem histórico: nada. **Nunca** "confirmação em 48 h" nem "a casa não responde".
3. Casa com ≥ 4 pedidos em 90 dias e **0 aceites**: botão de reserva substituído por "Peça uma indicação" (abre o WhatsApp da concierge com o nome da casa na mensagem). A ficha continua no ar; só o pedido muda de caminho.
4. Nas listagens por cidade, entre casas de mesma relevância, as que respondem vêm primeiro.

**Aceite.** Ficha do Monak (Paris) mostra o sinal; ficha da SRI TRAT mostra "Peça uma indicação"; nenhuma ficha mostra texto negativo sobre a casa. Em 60 dias a taxa de aceite sobe de 16 % para ≥ 35 % (medimos nós).

### 4. Pedido de mesa sem conta prévia

**Fato (auditoria de 07/10).** O diálogo de pedido exige criar conta antes de pedir: seis campos e senha. Conversão medida: 0,42 pedido por clique. É a maior perda do funil do cliente.

**O que fazer.** Formulário de três campos no próprio diálogo (nome, WhatsApp com seletor de país, e-mail). A conta nasce implícita, com link mágico no e-mail de confirmação. Google e Apple como atalhos, nunca como exigência.

**Aceite.** Um visitante sem conta envia um pedido em menos de 60 segundos; a reserva nasce com `customer_id`; o e-mail de confirmação chega com o botão de WhatsApp (já existe no fluxo do n8n desde 22/10).

---

## P1 — próximas duas a quatro semanas

### 5. Telefone do cliente em E.164, com país

**Fato.** Nos últimos 180 dias, **286 de 2.243** pedidos (13 %) têm telefone gravado **sem o código do país** ("21 96784…"). Para o WhatsApp isso é inútil e perigoso: "21…" pode ser Rio ou Egito. Hoje os agentes bloqueiam esses envios por segurança; o cliente fica sem aviso.

**O que fazer.** Campo de telefone com seletor de país (bandeira + DDI), validado como E.164 antes de gravar (`libphonenumber-js`, a mesma biblioteca dos agentes), gravado sempre com `+`. Na conta existente, pedir a correção uma vez quando o número não tiver `+`.

**Aceite.** 100 % dos telefones gravados a partir do deploy começam com `+` e passam em `parsePhoneNumber(...).isValid()`.

### 6. Correções de imagem e confiança (auditoria de 07/10, R3 e R5)

**Fatos reproduzidos hoje.** `og:image` da home aponta para `/images/og-default.jpg` → **404** (todo compartilhamento no WhatsApp e no LinkedIn sai sem imagem). Logo em GIF de 146 KB em toda página. LCP de laboratório da ficha: 6 a 9 s no celular.

**O que fazer.** Subir `og-default.jpg`; logo em SVG (< 5 KB); capa da ficha como `<img>` com `fetchpriority="high"`, `srcset` e redimensionamento na borda (`cdn-cgi/image/width=…`); `/contact` com formulário que funcione ou sem a promessa; `<title>` da página de registro "Cadastre seu restaurante | The World Keys".

**Aceite.** `og:image` responde 200; LCP da ficha mais visitada < 3 s no laboratório móvel.

### 7. Cidades em destaque verdadeiras e clicáveis (R2)

**Fato.** Os 12 chips de cidade da home não são links. Entre eles estão Dubai (0 casas publicadas), Singapore (0) e London (1); fora estão Montpellier (62), Nice (35), Cannes (30), Bordeaux (29).

**O que fazer.** Chips viram links; só entram cidades com ≥ 10 casas publicadas; a lista sai do banco, não do código.

### 8. Ligações internas e índice enxuto (R6, R7)

**Fato.** 245 fichas sem nenhum link de entrada; 77 páginas de cidade com ≤ 2 casas no índice; 12.292 URLs no sitemap, 9.276 delas "localizadas" com corpo em inglês. Impressões no Google caíram 96 % desde junho de 2025.

**O que fazer.** Breadcrumb visível na ficha (Home › Paris › Casa) e bloco "Mais em Paris" com 6 casas da mesma cidade; `noindex` e fora do sitemap para cidades com ≤ 2 casas; 301 das duplicatas de slug (`lisboa` → `lisbon`, `-2`); URLs localizadas só quando houver tradução de verdade (o Quill entrega as 200 fichas mais vistas em FR, PT, ES, IT).

### 9. Cabeçalhos de segurança na borda (R4)

**O que fazer.** No Cloudflare, sem tocar no app: HSTS, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`, `X-Frame-Options: DENY`. Meia hora.

---

## P2 — um a três meses

### 10. Página de resultados de busca
Enter leva a `/search?q=sushi` com URL compartilhável, `noindex` por enquanto. Hoje a busca é morta e não deixa dado de intenção.

### 11. Prova social honesta na ficha
Só com dado real: "N pedidos este mês", tempo médio de resposta quando existir (mesmo cálculo do item 3). Nunca nota inventada; as avaliações reais vão nascer em `aria_experience_reviews` e, quando o fundador decidir, podem ser publicadas dali.

### 12. Consulta de horários sem varredura completa
**Fato.** A tabela `opening_hours` (28.776 linhas) recebeu 1,85 milhão de leituras sequenciais e 7 por índice: alguma consulta do site lê a tabela inteira a cada ficha. **O que fazer.** Encontrar essa consulta e filtrar por `restaurant_id`; o índice correspondente está proposto ao fundador (`orchestrator/state/proposta-banco-2026-10-22.sql`).

### 13. Sobre nós com gente
Fundador, endereço de Paris, o que a TWK faz de diferente. É a página que o dono de restaurante abre antes de aceitar.

---

## Já resolvido (não mexer)

- **Despublicar derruba a página.** Em 22/10, `/hospitality/lofoten/` (despublicada no mesmo dia) responde **404**. Em agosto respondia 200 com formulário; o front corrigiu. Obrigado.
- **"The World's Kitchen"** sumiu do `/register`; só "The World Keys" aparece.

## O que não pedimos

Redesign visual (o design é bom), mais cidades ou mais fichas antes dos itens 7 e 8, e qualquer texto que prometa prazo de resposta do restaurante.

## Como nos falar e como testamos

Cada item acima tem um critério de aceite que o próprio sistema verifica: os agentes leem o banco todos os dias e os indicadores (contas criadas, taxa de aceite, telefones com `+`, `og:image` 200) aparecem no painel da operação. Dúvida sobre um item: respondemos com o número e a consulta que o gerou. Specs completas, quando quiser mais detalhe: `docs/agentes/BRIEF-DEV-2026-09-07.md`, `docs/agentes/CADRAGE-FRONT-PORTA-2026-09-16.md`, `docs/agentes/CADRAGE-FRONT-CHAVE-GIRADA.md`, `docs/auditoria/plataforma-theworldkeys-2026-10-07.md`, `docs/produto/brief-front-roteamento-casas-que-respondem-2026-10-22.md`.
