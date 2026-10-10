# Análise da plataforma theworldkeys.com — 07/10/2026

Auditoria externa do site público, feita pelo navegador e por rastreio próprio, sem credencial e sem acesso ao código do front. Rotulagem: **fato** (observado e reproduzível), **suposição** (inferência fundamentada), **lacuna** (não verificado).

## 0. Escopo e método

| O que foi examinado | Como |
|---|---|
| Home (EN e PT), `/explore/paris`, ficha `pierre-gagnaire`, `/log-in`, `/about-us`, `/contact`, `/chauffeur-prive`, legais | navegador integrado (desktop 1024px e mobile 375px), `get_page_text`, JavaScript de inspeção |
| Fluxo de pedido de mesa até o passo que exige conta | cliques reais na ficha |
| As **198 páginas de cidade** únicas do sitemap | rastreio completo com `curl` (HTML salvo e analisado) |
| **90 fichas** sorteadas das 1.546 do sitemap | rastreio e leitura do JSON-LD |
| Cabeçalhos HTTP, robots, sitemap, DNS (SPF/DKIM/DMARC), manifest, `manager.theworldkeys.com` | `curl`, `Resolve-DnsName` |
| Acessibilidade | axe-core 4.10 na home |
| Desempenho | medições de laboratório no navegador (LCP, CLS, TTFB), a partir do Brasil, em notebook lento |

**Fora do escopo (lacunas):** área logada do cliente, telas pós-pedido, `/r/{código}`, e-mails transacionais, n8n, fluxos do manager, Core Web Vitals de campo (a API do PageSpeed devolveu cota esgotada), Consent Mode do GA4.

Artefatos: tabela das cidades em `docs/auditoria/plataforma-2026-10-07-cidades.csv`.

## 1. Veredito

1. **O catálogo é rico e o invólucro é pobre.** Nas 90 fichas amostradas: 100% têm schema `Restaurant`, descrição mediana de 885 caracteres, horários em 100%, 79% com cinco ou mais fotos. O problema do site não é dado faltando.
2. **O site não se deixa percorrer.** A home linka para **uma** página de cidade (Paris). As 12 cidades em destaque são `<div>` decorativos, sem clique. As fichas não linkam para nada (nem para a cidade, nem para casas vizinhas). 245 restaurantes em 15 cidades só existem para o Google pelo sitemap.
3. **O Google vê 12.292 URLs e a maioria é fina ou duplicada.** 125 das 198 páginas de cidade (63%) têm cinco estabelecimentos ou menos; 6 têm zero (Dubai e Singapore entre elas, ambas em destaque na home). As versões em 6 idiomas traduzem o menu e deixam o corpo da ficha em inglês: 9.276 URLs que, pela definição do próprio Google, são duplicatas.
4. **Pedir mesa exige criar conta** com seis campos (nome, país, WhatsApp, e-mail, senha, confirmação) ou Google. É a maior barreira de conversão que o site impõe a si mesmo.
5. **Higiene técnica atrasada:** imagem de compartilhamento (`og:image`) em 404, logo GIF de 146 KB em toda página, LCP da ficha de 6,6 s (desktop) e 9,1 s (mobile) em laboratório, nenhum cabeçalho de segurança, DMARC em `p=none`.

## 2. Achados

### 2.1 Conversão — o pedido de mesa

| # | Achado | Tipo | Evidência |
|---|---|---|---|
| C1 | "Continue to request" abre o diálogo **Sign In / Sign Up**. Cadastro: Full Name, seletor de país, WhatsApp, Email, Password, Confirm Password, ou "Continue with Google". Sem Apple, sem link mágico, sem pedido como convidado. | fato | ficha `pierre-gagnaire`, 07/10, 13h00 (Paris) |
| C2 | A taxa de 0,42 pedido por clique (estratégia de 30/09) prova que quem chega pede; **não prova** quantos desistem no diálogo de conta, porque não há evento medindo isso. | lacuna | sem funil no GA4 |
| C3 | Mobile tem barra fixa "Request table" com "Requests available" — bom. O calendário respeita dias fechados (sáb/dom/seg bloqueados para o Pierre Gagnaire) — bom. | fato | screenshot 375px |
| C4 | Os botões de horário não têm nome acessível (sete `button` vazios para leitor de tela). | fato | `read_page` |
| C5 | `/contact` diz "To send a message, use the form below" e **não existe formulário**: só WhatsApp e `mailto:`. | fato | `read_page` interativo de `/contact` |
| C6 | "Claim this listing" leva a `manager.theworldkeys.com/register?listing=…`, página pública cujo `<title>` é **"TWK Admin Dashboard"**. Dono de restaurante lê "admin" antes de ler "cadastre seu restaurante". | fato | `curl` |
| C7 | "Request removal" abre modal com nome, e-mail e motivo — existe e funciona como porta de opt-out (ADR-010). | fato | `read_page` |

### 2.2 Descoberta e navegação

| # | Achado | Tipo | Evidência |
|---|---|---|---|
| N1 | As 12 cidades da home (PARIS, TOKYO, NEW YORK, LONDON, BARCELONA, MILAN, DUBAI, NICE, MONTPELLIER, COPENHAGEN, SINGAPORE, SÃO PAULO) são `<div>` com `cursor: auto`, sem `href` e sem handler. Não clicam. | fato | JavaScript de inspeção |
| N2 | O diálogo "para onde vamos?" lista **5** "mais visitadas" (Bangkok, Lagos, Rome, Nice, Paris) + busca. Não há como ver a lista de cidades. `/explore` responde 404. | fato | navegador, `curl` |
| N3 | No mobile, o item "Explorar" da barra inferior aponta fixo para `/explore/paris`. | fato | `href` lido no DOM |
| N4 | **Cidades em destaque sem conteúdo:** `/explore/dubai` = 0 estabelecimentos, `/explore/singapore` = 0, `/explore/london` = **1**, `/explore/tokyo` = 9, Copenhagen vive no slug `copenhague` com 3. | fato | rastreio 07/10 |
| N5 | A ficha `artemis` tem `addressLocality: Singapore` e `addressCountry: Malaysia`; seu breadcrumb manda para `/explore/singapore`, que mostra zero. Há registros de cidade duplicados ou com país errado no catálogo. | fato → causa é suposição | JSON-LD da ficha |
| N6 | Busca: autocomplete funciona (digitar "sushi" lista Akiko's, Keisuke Matsushima, Kosushi, My Sushi…), mas **Enter não faz nada** e não existe página de resultados com URL. O `SearchAction` do schema aponta para `/explore/{termo}`, que responde 404. | fato | navegador; `curl /explore/michelin` → 404 |
| N7 | Página de cidade mostra 20 cartões + "Load More" por JavaScript. `?page=2` devolve os mesmos 20 com canonical para a página 1. Em 15 cidades com mais de 20 casas, **245 fichas não têm nenhum link de entrada** além do sitemap. | fato | rastreio |
| N8 | A ficha não tem link para a cidade (o breadcrumb existe só no JSON-LD), nem "mais em Paris", nem casas semelhantes. Beco sem saída para o usuário e para o rastreador. | fato | `grep href` no HTML da ficha: zero links `/explore/` ou `/hospitality/` |

### 2.3 SEO e conteúdo — a explicação estrutural da queda de 96% nas impressões

| # | Achado | Tipo | Evidência |
|---|---|---|---|
| S1 | Sitemap: 12.292 URLs = (1.546 fichas + 198 cidades + 7 estáticas) × 7 idiomas, com **5 URLs de cidade repetidas** (london, manchester, birmingham, monte-carlo, saint-tropez). 10.822 URLs com `priority 0.9`; `lastmod` da home = hora da requisição. Sinais que o Google ignora. | fato | `sitemap.xml` |
| S2 | Versões `/pt`, `/fr`, `/es`, `/it`, `/zh`, `/ja` da ficha traduzem título, menu e rótulos; o **texto principal continua em inglês** ("Pierre Gagnaire Restaurant in Paris offers…" aparece na página PT). Pela documentação do Google, página com só o boilerplate traduzido é duplicata. São 9.276 URLs assim. | fato | `curl /pt/hospitality/pierre-gagnaire` |
| S3 | Distribuição das 198 páginas de cidade por número de estabelecimentos: **0: 6 · 1–2: 71 · 3–5: 48 · 6–10: 37 · 11–30: 31 · 31+: 5.** Todas usam a mesma meta description (um único template); título "Best Restaurants in X" em páginas com uma casa; 23 sem imagem de capa. | fato | CSV anexo |
| S4 | Rótulos de país saídos do banco: "Usa" (38 páginas), "Uae", "South africa", "South korea", "Israël" (grafia francesa no site em inglês), "Holland", "Quebec" como país, "West indies". Entram no `<title>` e no H1. | fato | títulos rastreados |
| S5 | Slugs das cidades mais importantes com sufixo técnico ou grafia francesa: `nyc-2`, `amsterdam-2`, `las-vegas-2`, `hong-kong-2`, `chicago-2`, `berlin-2`, `buenos-aires-2`, `shangai-2` (erro), `hambourg`, `copenhague`, `palerma`; `lisboa` e `lisbon` coexistem. | fato | sitemap |
| S6 | Nomes de restaurante em CAIXA ALTA em 92% da amostra (83/90), e cidades com caixa errada ("La rochelle", "Rio de janeiro", "San francisco"). Vão para título, H1, cartões e resultados de busca. | fato | amostra de 90 fichas |
| S7 | Fotos da ficha são `background-image` em CSS, não `<img>`: sem `alt`, sem `srcset`, invisíveis para o Google Imagens. A ficha renderizada pelo servidor tem **uma** `<img>`: o logo. | fato | HTML da ficha |
| S8 | Dados estruturados: `Restaurant` completo (horários, geo, telefone, faixa de preço, cozinha), mas `hasMenu`/`menu` apontam para a home do restaurante e não há `aggregateRating`. `CollectionPage` da cidade **sem `ItemList`**. Home com FAQ visível **sem `FAQPage`**. `SearchAction` quebrado (N6). | fato | JSON-LD |
| S9 | `og:image` padrão `/images/og-default.jpg` → **404**. Toda partilha da home (e de qualquer página sem imagem própria) sai sem imagem. | fato | `curl` |
| S10 | `/log-in` é indexável (`index, follow`) e reaproveita o título da home. | fato | HTML |
| S11 | Não existe `llms.txt`; robots permite bots de IA por omissão (ok). | fato | 404 |

### 2.4 Desempenho (laboratório; campo é lacuna)

| Métrica | Valor | Onde |
|---|---|---|
| LCP da ficha, desktop | 6,6 s | `pierre-gagnaire`, imagem de capa |
| LCP da ficha, mobile 375px | 9,1 s | idem |
| CLS da página de cidade | 0,142 | `/explore/paris` (limite "bom" é 0,1) |
| TTFB da home (Cloudflare HIT) | 0,36–0,52 s | 3 amostras |
| HTML bruto | home 245 KB · cidade 200 KB · ficha 129 KB (27 KB comprimido) | `curl` |
| Scripts carregados | 31 | home |

Causas observadas (fato): capa da ficha é o **arquivo original** (174 KB) via CSS, sem redimensionamento `cdn-cgi` e sem prioridade de carregamento, enquanto os cartões já usam `cdn-cgi/image/width=640` corretamente; logo `twk-logo.gif` de **146 KB** em todas as páginas; fichas servidas com `Cache-Control: private, no-cache, no-store` (nenhum cache de CDN — cada acesso de bot às 10.822 URLs de ficha bate na origem).

### 2.5 Segurança, privacidade, e-mail

| # | Achado | Tipo |
|---|---|---|
| G1 | Nenhum cabeçalho de segurança em `theworldkeys.com` nem em `manager.`: sem HSTS, CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy. `x-powered-by: Next.js` exposto. | fato |
| G2 | DMARC `p=none` (só relatório). Qualquer um envia e-mail "de" `@theworldkeys.com` sem ser rejeitado. SPF inclui `_spf.salesforce.com` — se a Salesforce não envia mais, é superfície a mais. | fato / lacuna |
| G3 | O GA4 dispara `collect` antes do consentimento. Não há cookie `_ga` antes de aceitar, o que sugere Consent Mode em modo negado (ping sem cookie) — a verificar. | lacuna |
| G4 | `/r/{código}` de reserva vencida acionável e expondo dados do cliente é P0 aberto desde 03/09 (cadrage de 16/09). Não pude testar sem um código. | lacuna |
| G5 | axe na home: 7 falhas sérias de contraste, dois `main` na mesma página. | fato |

### 2.6 Institucional e confiança

- `/about-us` é genérico: sem fundador, sem equipe, sem número, sem foto, sem imprensa. Para o Google (E-E-A-T) e para o dono de restaurante que chega por "Claim this listing", não há quem seja a TWK. (fato)
- O schema `Organization` declara telefone "TollFree" e atendimento 24/7 em todas as línguas. Discrição (ADR-015) pede prometer só o que existe. (fato)
- `/chauffeur-prive` é a melhor página do site: específica, com nome do motorista, área, carro, preço por WhatsApp. É o padrão a copiar na ficha. (fato)

## 3. Recomendações

Ordem por impacto ÷ esforço. "Dev" = desenvolvedor do front (fora deste repositório). Impactos numéricos são **suposições** declaradas.

### A. Esta semana — bugs e confiança (cada item ≤ 1 dia)

**R1 · Pedido de mesa sem conta.** Formulário de três campos (nome, WhatsApp, e-mail) no próprio diálogo; a conta nasce implícita, com link mágico no e-mail de confirmação; Google e Apple como atalhos, nunca como exigência. Senha e "confirmar senha" saem do caminho crítico. Medir antes e depois com três eventos no GA4: `ficha_cta`, `dialogo_conta_aberto`, `pedido_enviado`. Suposição: esta é a única alavanca capaz de mover a conversão por clique sem depender do Google. — **Dev**

**R2 · Cidades em destaque verdadeiras e clicáveis.** Os 12 chips viram links. Sair do destaque: Dubai (0), Singapore (0), London (1), Tokyo (9) até terem ≥ 10 casas; entrar: Montpellier (62), Nice (35), Cannes (30), Bordeaux (29), Bangkok (27), Milan (27), Lagos. "Explorar" do mobile deixa de apontar para Paris e abre a lista de cidades. O diálogo "para onde vamos?" lista todas as cidades com contagem, não só cinco. — **Dev**; lista de cidades pelo **DBA** (CSV anexo).

**R3 · Três correções de imagem.** Subir `og-default.jpg` (hoje 404). Trocar o logo GIF por SVG (146 KB → < 5 KB em toda página). Capa da ficha como `<img>` com `fetchpriority="high"`, `srcset` e `cdn-cgi/image/width=…` como os cartões já fazem. Suposição: LCP da ficha cai de 6–9 s para < 3 s só com isso. — **Dev**

**R4 · Cabeçalhos de segurança na borda (Cloudflare, sem tocar no app).** HSTS, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`, `X-Frame-Options: DENY` (ou `frame-ancestors` no CSP), CSP em `report-only` por duas semanas antes de impor; remover `x-powered-by`. DMARC: `p=quarantine; pct=25` após duas semanas lendo os relatórios que já chegam em `reservation@`. — **Fundador** (painel Cloudflare), 1 hora.

**R5 · Copy que promete o que não existe.** `/contact`: ou entra o formulário ou sai a frase. Manager: `<title>` "Cadastre seu restaurante | The World Keys" na página de registro. Schema `Organization`: tirar "TollFree" e manter só canais reais. `/log-in`: `noindex` e título próprio. — **Dev**, meio dia.

### B. Duas a quatro semanas — estrutura que o Google consegue percorrer

**R6 · Ligações internas (o maior ganho de SEO por linha de código).** Na ficha: breadcrumb visível (Home › Paris › Pierre Gagnaire) e bloco "Mais em Paris" com 6 casas da mesma cidade (prioridade: mesma faixa de preço, depois mesma cozinha). Na página de cidade: paginação de verdade (`?page=2` com conteúdo distinto e links numerados) em vez de "Load More". Página `/explore` com todas as cidades agrupadas por país. Resultado: as 245 fichas órfãs e as 198 cidades passam a ter caminho a partir da home. — **Dev**, 2–3 dias.

**R7 · Enxugar o índice em vez de inflá-lo.** (a) `noindex` e fora do sitemap para as 77 páginas de cidade com ≤ 2 casas, até terem conteúdo; 301 das duplicatas (`lisboa`→`lisbon`, `copenhague`→`copenhagen`, `-2` para o slug limpo quando o limpo não existe). (b) Fichas em idioma sem texto traduzido: `canonical` para a versão EN e fora do sitemap; manter hreflang só onde o corpo é traduzido. (c) Corrigir rótulos de país e `lastmod` real. O sitemap desce de 12.292 para algo como 2.000 URLs que valem a pena. Decisão do fundador, porque reduz "tamanho" aparente; suposição fundamentada: o Google recompensa índice limpo depois de um core update. — **DBA** (países, duplicatas, slugs) + **Dev** (canonical, sitemap).

**R8 · Traduzir de verdade as fichas que importam.** O Quill traduz o texto principal das 200 fichas com mais impressões (GSC) para FR, PT, ES e IT, versionado no banco editorial. Só essas voltam ao sitemap localizado. ZH e JA ficam em EN até haver demanda medida. — **Quill**, contínuo.

**R9 · Ficha: título com promessa, texto visível, nome legível.** Título no padrão já aprovado no Movimento 3 ("Casa do Prego, Lagos — reserve pelo concierge, resposta no WhatsApp"). Aba "About" aberta por padrão (hoje a primeira coisa que o visitante lê é a tabela de horários). Nome do restaurante e cidade em caixa normal **na exibição** (transformação no front, não no banco). `ItemList` na página de cidade, `FAQPage` na home, `SearchAction` apontando para uma rota que exista. — **Dev** + **Quill**.

**R10 · Página de resultados de busca.** Enter leva a `/search?q=sushi` com URL compartilhável; `noindex` por enquanto. Resolve a busca morta e dá dado de intenção (o que as pessoas procuram e não acham). — **Dev**, 1 dia.

### C. Um a três meses — alavancas de produto

**R11 · Prova social honesta na ficha.** Só com dado real: "responde a pedidos" para casas com ≥ 4 pedidos em 90 dias e ≥ 50% aceitos (o mesmo critério do Guardião e do ADR-015), "N pedidos este mês", tempo médio de resposta quando houver. Nada de nota inventada. — **Dev** + **DBA** (consulta).

**R12 · Sobre nós com gente.** Fundador, endereço de Paris, o que a TWK faz de diferente (concierge, resposta no WhatsApp), Instagram, uma frase de imprensa se houver. É a página que o dono de restaurante abre antes de aceitar. — **Fundador** + **Quill**, meio dia.

**R13 · Vigia do site na Sentinela.** Checagem diária, sem LLM: `og:image` responde 200, logo < 20 KB, sitemap sem duplicata, contagem de cidades com 0 casa, LCP de laboratório da ficha mais visitada, cabeçalhos de segurança presentes. Qualquer regressão vira relato na Regência. — **Orquestrador**, 1 dia, dentro de `sentinela-silencio`.

**R14 · `llms.txt` e política para bots de IA.** Um arquivo com o que a TWK é, as cidades fortes e o caminho das fichas. Custo zero; presença em respostas de assistentes (GEO) é onde a busca está migrando. — **Quill**, 1 hora.

### O que não recomendo

- Mais cidades ou mais fichas antes de R6/R7: volume é o que o core update puniu.
- Mídia paga antes de R1: pagar por clique para cair num cadastro de seis campos.
- Remover o hreflang inteiro: as versões traduzidas de verdade (R8) precisam dele.
- Redesign visual: o design é bom; o que falta é caminho, velocidade e texto.

## 4. Como medir em 30 dias

| Indicador | Hoje | Fonte |
|---|---|---|
| Fichas sem link de entrada | 245 | rastreio (repetir o script) |
| Páginas de cidade com ≤ 2 casas no índice | 77 | CSV anexo / GSC |
| URLs no sitemap | 12.292 | `sitemap.xml` |
| LCP da ficha (laboratório, mobile) | 9,1 s | navegador |
| Diálogo de conta → pedido enviado | não medido | GA4 após R1 |
| Impressões das páginas de cidade | 268 em 90 dias (estratégia 30/09) | GSC |

## 5. Lacunas declaradas

Core Web Vitals de campo; abandono real no diálogo de conta; Consent Mode; segurança do `/r/`; fluxos do manager; deliverability de e-mail; se o país errado de Artemis é caso isolado ou padrão (o DBA mede em uma consulta: `addressCountry` por cidade).
