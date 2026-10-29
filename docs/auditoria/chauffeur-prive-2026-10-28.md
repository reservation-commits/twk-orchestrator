# Auditoria da página `/pt/chauffeur-prive` — 2026-10-28

Página analisada: https://theworldkeys.com/pt/chauffeur-prive (desktop 800 px e mobile 375 px, navegador integrado; inspeção por JavaScript; medições de rede por `curl`). Rótulos: **[FATO]** verificado na página · **[INFERÊNCIA]** conclusão nossa · **[LACUNA]** não foi possível verificar.

Nenhuma mensagem foi enviada no WhatsApp durante o teste: o envio do formulário abre a página `api.whatsapp.com/send` com o texto pronto e parei aí.

## 1. O que a página faz hoje

- **Estrutura** [FATO]: hero (Tesla Model X, chips "6 passageiros · 6 bagagens", CTA "Reservar no WhatsApp" que rola até o formulário) → formulário "Peça este trajeto" → área de atendimento (Nice, Cannes, Saint-Tropez, Mônaco) → 4 serviços (transfers, hora/dia, eventos, longa distância) → o carro e o chauffeur (Julien Guilloteau) → exigências / a bordo → 6 perguntas → CTA final (anchor para o formulário) + telefone.
- **Formulário** [FATO]: 4 campos — Partida (texto, autocompletar Google Places), Destino (idem), Data (`type=date`, `min` = hoje), Horário (`type=time`). Botão "Enviar no WhatsApp". Validação em linha ("Informe o local de partida.", `aria-invalid`), sem foco automático no primeiro campo inválido.
- **Envio** [FATO]: navega **na mesma aba** para `https://api.whatsapp.com/send/?phone=33781937270&text=…`. Texto gerado (teste Aeroporto de Nice → Hôtel de Paris, 05/11, 14:30):

  > Olá Julien, / Gostaria de reservar um motorista particular com a The World Keys. / Partida: Aeroporto de Nice / Destino: Hôtel de Paris, Mônaco / Distância: 33 km / Data: 5 de novembro de 2026 / Horário: 14:30

- **Rastreamento do envio** [FATO, com consentimento "apenas necessários"]: nenhum evento de GA4 nem `dataLayer.push` ao clicar em Enviar; só os `collect` de pageview. Nenhuma chamada ao próprio servidor registra o pedido antes do redirecionamento. [LACUNA] não testei com cookies de analytics aceitos; mesmo que exista evento nesse caso, quem recusa cookies (opção padrão mais privada) some sem rastro.
- **Autocompletar** [FATO]: "Aeroporto de N" sugere Nice, mas também Ajaccio, Nantes, Lille e Nancy/Metz — sem restrição de país nem viés para a Riviera. Console avisa que a página usa a API legada `AutocompleteService` e carrega o Maps sem `loading=async`.
- **SEO/técnico** [FATO]: title, meta description, canonical, hreflang (7 idiomas + x-default), JSON-LD `LimousineService` + `FAQPage` corretos; sitemap e robots incluem a página. `og:image` aponta para `/images/og-default.jpg`, que responde **404** (já apontado na auditoria de 07/10, continua aberto).
- **Peso** [FATO, `curl -I`]: 4,9 MB transferidos no carregamento. As duas versões do Tesla (`tesla-model-x.png` 704 KB e `tesla-model-x-mobile.png` 1,49 MB) são baixadas **as duas** no desktop; `nice.jpg` 634 KB; logo `twk-logo.gif` 146 KB animado. `Cache-Control: max-age=14400` (4 h) nas imagens. Tempos medidos com o painel oculto não são confiáveis; a auditoria de 07/10 mediu LCP 6–9 s no site.
- **Mobile** [FATO]: sem rolagem horizontal; campos e botão com 48 px de altura; **fonte dos campos 14 px** (iOS dá zoom automático em campo com menos de 16 px); CTA do hero visível na primeira tela (topo a 668 px); formulário começa a 1.282 px.
- **Navegação** [FATO]: barra inferior "Explorar" leva a `/pt/explore/paris` numa página da Riviera; "Entrar" aparece duas vezes no mobile (topo e barra inferior) numa página que não precisa de login. `/driver` e `/pt/driver` (URL do cartão impresso) continuam 404.

## 2. Otimizações do formulário (prioridade)

### P1 — o pedido não fica registrado em lugar nenhum
Hoje o lead só existe se o cliente concluir o passo dentro do WhatsApp. Quem cai no interstício "Compartilhe no WhatsApp" no desktop (sem o app) e fecha, desaparece.

1. **Gravar o pedido antes de redirecionar**: `navigator.sendBeacon('/api/chauffeur/lead', {partida, destino, data, hora, idioma, origem})` sem PII além do trajeto; id curto devolvido e incluído na mensagem ("Ref. CH-4F2K") para Julien casar WhatsApp ↔ pedido. Contador independente de consentimento (não é cookie, não identifica pessoa).
2. **Evento de conversão** GA4 `generate_lead` (params: `rota`, `distancia_km`, `antecedencia_dias`, `idioma`) e, se consentido, `page_view` → `form_start` → `form_submit` para medir abandono por campo.
3. **Abrir o WhatsApp em nova aba** (`target=_blank` + `rel=noopener`) e deixar a página num estado "Mensagem preparada — se o WhatsApp não abriu, ligue +33 7 81 93 72 70 ou copie o texto" com botão **Copiar mensagem**. O botão hoje fica desativado após o clique; ao voltar pelo histórico, conferir que reativa [LACUNA].

### P1 — o formulário não pergunta o que Julien precisa para orçar
A própria FAQ promete "informe partida, chegada, data e **número de passageiros**", mas o campo não existe. Cada falta vira uma pergunta de volta no WhatsApp, e o orçamento "em poucos minutos" deixa de ser verdade.

4. **Tipo de serviço** (segmentado, 3 opções): *Transfer* · *À disposição (hora/dia)* · *Evento/noite*. Para "à disposição", trocar Destino por *Duração* (3 h, 6 h, dia) e manter só o ponto de encontro. Hoje o formulário só modela ponto a ponto, embora a página venda quatro serviços.
5. **Passageiros** (1–6) e **bagagens** (0–6) como steppers; acima de 6 → mensagem "para grupos maiores, fale com Julien" com link direto.
6. **Ida e volta** (toggle) com data/hora de retorno; é o caso mais comum em transfer de aeroporto.
7. **Número do voo** (opcional, aparece quando a partida ou destino é aeroporto/estação) — permite acompanhar atraso e evita a pergunta de volta.
8. **Nome** (opcional) — a mensagem hoje chega anônima ("Olá Julien, gostaria…"); um nome permite responder "Bonjour Madame X".
9. **Hora mínima** quando a data é hoje (não aceitar hora já passada) e aviso "pedidos para as próximas 2 h: ligue" — hoje o campo aceita qualquer hora.

### P1 — autocompletar fora da zona de atendimento
10. Restringir a `componentRestrictions: { country: ['fr','mc'] }` com `bounds` Saint-Tropez ↔ Menton e `strictBounds` (ou pelo menos viés). Sugerir **atalhos** acima do campo: *Aeroporto de Nice (NCE)*, *Estação Nice-Ville*, *Cannes Croisette*, *Mônaco Monte-Carlo*, *Heliporto de Mônaco* — um toque preenche. Migrar para `AutocompleteSuggestion` (a API atual é legada) e carregar o Maps com `loading=async` só quando o campo recebe foco (economiza o script na primeira pintura).
11. Se o endereço escolhido cair fora da área, dizer na hora ("Somente Côte d'Azur; para outros trajetos, fale com Julien") em vez de deixar seguir ao WhatsApp.

### P2 — preço e expectativa
12. A página já calcula a distância (33 km no teste). Mostrar **estimativa instantânea** ("Transfer Nice → Mônaco: a partir de 130 €", tabela da premissa de 08/10) ou ao menos faixas por trajeto nas 4 cidades. É o maior ganho de conversão disponível: o cliente que vê o preço manda a mensagem já decidido, e Julien responde confirmando em vez de orçando. [INFERÊNCIA] baseada no padrão Blacklane/Welcome Pickups (preço fechado) citado na premissa.
13. "Orçamento em geral em poucos minutos" sem horário de atendimento: acrescentar "das 7h às 23h" (ou o que for real) e, fora disso, "respondemos a partir das 7h". Promessa sem horário é promessa que falha de madrugada.
14. Mensagem gerada: incluir o **idioma do cliente** (ex. "[PT]") no cabeçalho para Julien responder no idioma certo, e rótulos fixos em francês ao lado (Départ/Arrivée/Date/Heure) — a interface fica no idioma do visitante, a leitura de Julien fica uniforme nas 7 línguas.
15. Botão "Enviar no WhatsApp" → "Pedir orçamento no WhatsApp": diz o que acontece (não é reserva confirmada). O CTA do hero "Reservar no WhatsApp" só rola a página; renomear para "Pedir orçamento" ou levar direto ao campo Partida com foco.
16. Oferecer **atalho sem formulário** para quem "decide na hora": link `wa.me` com texto curto ("Preciso de um carro agora em …") ao lado do telefone.

### P2 — mobile e acessibilidade
17. `font-size: 16px` nos inputs no mobile (evita zoom automático no iOS); `inputmode`/`autocomplete` adequados (`autocomplete="off"` nos endereços está certo por causa do Places).
18. Ao falhar a validação, mover o foco para o primeiro campo inválido e rolar até ele; hoje a mensagem aparece mas o foco não muda.
19. Dar `name` aos inputs (hoje vazios) — facilita autofill do navegador, testes e qualquer gravação futura.

## 3. Outras otimizações da página

20. **Imagens** [P1 para LCP]: servir uma só versão do Tesla via `<picture>`/`next/image` com WebP/AVIF (o PNG mobile de 1,49 MB a 941×1672 é o maior custo da página); `nice.jpg` 634 KB → ≤120 KB; logo GIF → SVG ou WebP animado leve; `Cache-Control` de 1 ano com nome versionado.
21. **`og:image` 404** — compartilhar a página no WhatsApp (o canal da própria conversão) mostra cartão sem imagem. Criar `/images/og-default.jpg` 1200×630 com o Tesla; ideal uma imagem própria por página.
22. **Confiança**: foto de Julien, registro VTC / seguro de passageiros (campo "legal" do cartão impresso está marcado "a fazer"), 2–3 depoimentos reais quando existirem. [INFERÊNCIA] para serviço premium a pessoa compra o motorista, não o carro.
23. **Navegação**: "Explorar" da barra inferior deveria apontar para a Riviera (ou para "Jantar + carro" nas casas da Côte d'Azur), não para Paris; reduzir a presença de "Entrar" nesta página.
24. **Upsell planejado** (docs de 15–17/09): bloco "Jantar na costa com carro à porta" ligando às casas que confirmam na Riviera — a estratégia de 08/10 (balcão B2B) prevê exatamente carro + mesa.
25. **Dados estruturados**: acrescentar `priceRange`, `openingHoursSpecification`, `sameAs` (Instagram) e `image` com URL que exista; `address` em Paris para serviço na Riviera é coerente juridicamente, mas um `areaServed` com `GeoCircle` ajuda o local.
26. **URL do cartão impresso** `/driver` → redirecionar 301 para `/chauffeur-prive` (404 desde 15/09).
27. **Chave do Google Maps** visível no HTML é normal, mas deve estar restrita por referrer `theworldkeys.com` no console do Google [LACUNA: não verificável daqui].

## 4. Ordem sugerida de implementação

| Ordem | Item | Esforço | Efeito |
|---|---|---|---|
| 1 | Gravar lead + evento GA4 + nova aba com fallback (1–3) | 1 dia | passa a existir medição e nenhum pedido se perde |
| 2 | Campos: tipo de serviço, passageiros, ida/volta, voo, nome (4–9) | 1–2 dias | menos idas e voltas no WhatsApp; orçamento em uma resposta |
| 3 | Places restrito + atalhos + carga sob demanda (10–11) | ½ dia | menos erro, menos script na abertura |
| 4 | Imagens e og:image (20–21) | ½ dia | LCP e cartão de compartilhamento |
| 5 | Preço estimado + horário de atendimento + idioma na mensagem (12–14) | 1–2 dias | decisão antes do clique |
| 6 | Confiança, navegação, upsell, schema, redirect (22–27) | 1–2 dias | — |

Lacunas desta auditoria: tempos de carregamento (painel oculto), comportamento com cookies de analytics aceitos, restrição da chave do Maps, estado do botão ao voltar do WhatsApp.
