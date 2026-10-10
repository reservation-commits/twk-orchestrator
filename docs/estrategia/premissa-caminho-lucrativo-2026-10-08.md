# Premissa do caminho mais lucrativo para theworldkeys.com — entrega 1 (08/10/2026)

Consultoria de estratégia encomendada pelo fundador. Esta entrega traz só a premissa e a demonstração; o plano de execução vem depois da análise do fundador. Rótulos: **[FATO]** com fonte · **[INFERÊNCIA]** com raciocínio · **[SUPOSIÇÃO A VALIDAR]** · **[NÃO VERIFICADO]**. Fontes internas = banco `twk_auth` lido por `twk_ro`, Search Console (conta do Quill) e documentos deste repositório, sempre com data. Pesquisa externa feita em 08/10/2026 (≈100 buscas, ≈50 fontes lidas).

## 0. Dados internos usados (preenchem os campos vazios do briefing)

| Campo do briefing | Valor usado | Origem |
|---|---|---|
| Visitas e origem de tráfego | Google: 1,65 M impressões e 7.281 cliques em jun/2025 → 58,8 k e 558 em set/2026 (−96% / −92%). Analytics fechado: tráfego direto, social e referência **desconhecidos** | [FATO] GSC, `docs/estrategia/reservas-2026-09-30.md` §1 |
| Usuários ativos | 22.995 cadastrados (17/09) · 23.083 (30/09) · **3.917 fizeram algum pedido em 12 meses** (17%) · recorrência 11% (433 de 3.891) | [FATO] banco 17/09 e 30/09 |
| Pedidos/mês e confirmação | set/2026: 274 pedidos, 27 aceitos (10%). 90 d: 916–963 pedidos, 103 aceites. Casas parceiras aceitam 48%; não parceiras 9%. Lagos = 30% da demanda; Paris 217 pedidos/12 m, 62 aceites (≈5 jantares/mês); Riviera 220 pedidos/12 m, **7 aceites** | [FATO] banco 15–17/09 e 30/09 |
| Restaurantes listados × conta ativa | 3.764 fichas, 1.548 publicadas · **0 contas de restaurante** (`restaurant_users` vazia; os 23.083 usuários são todos CUSTOMER) · 185 e-mails de campanha → 3 respostas → 0 contas · o fluxo de ativação não cria conta (bug especificado ao dev em 30/09) | [FATO] `contas-2026-09-30.md`, dossiê 15/09 |
| Receita por linha | Assinaturas: **nenhuma receita registrada** (espelho Stripe do Atlas vazio, 0 contas). Motorista e conciergerie: **sem registro no sistema** → cenário conservador na §7 | [FATO] Atlas · [LACUNA] |
| Ticket e margem de motorista | Tabela do protótipo TWK (15/09): transfer CDG–Paris 180 €, disposição 95 €/h (mín. 3 h), Soirée 390 €; comissão TWK exemplo 25%. Os documentos de 15–17/09 tratavam o motorista como parceiro; **o fundador confirmou em 09/10/2026 que o motorista é da empresa (folha da SAS)** → vale o cenário O da §7 e a adenda de 09/10. Corrigir os documentos de 15/09 e 17/09 | [FATO] resposta do fundador 09/10; `servico-private-driver.html`, plano 17/09 |
| Parceiros de conciergerie | **0 com reserva paga**; registro de ligações `ligacoes-servicos.csv` vazio em 08/10; as 4 URLs de serviço davam 404 em 17/09; hoje existe `/chauffeur-prive` (só Riviera, só WhatsApp) | [FATO] `orchestrator/state/servicos/`, site 08/10 |
| Horas do fundador e devs | não informadas → assumo **20 h/semana de venda do fundador** e devs ocupados com a porta de contas | [SUPOSIÇÃO A VALIDAR] |
| Orçamento 90 dias | [VALOR] não informado → assumo **≤ 2.000 €** em caixa (cartões, deslocamento, 1 feira) | [SUPOSIÇÃO A VALIDAR] |

## 1. Veredito

O modelo de assinatura de restaurantes está morto nos dados: 13 meses, 0 contas, 10% de aceite, Google −96%, e o mercado mostra que o restaurante só paga por demanda incremental (TheFork, por couvert) ou por independência (Zenchef, 129–249 €/mês) — a TWK não entrega nenhuma das duas. O motorista é a única linha que gera caixa, mas, vendido como está ("um só chauffeur", só Riviera, orçamento por WhatsApp), é uma commodity de 70–140 € por trajeto. O caminho mais lucrativo em 90 dias é **vender a noite resolvida (carro + mesa + experiência) a quem já compra isso todo dia e já paga comissão por isso: concierges de hotel, gestores de aluguel premium, DMCs e agências de evento em Paris, Cannes e Mônaco**, com preço fechado, pré-pagamento e margem por serviço. O site deixa de ser um motor de pedidos de mesa gratuitos e passa a ser a tabela de preços e a porta de reserva desse balcão. Confiança: média para 1.600 € até 11/11 (baixa temporada, 5 semanas, 0 parceiros assinados); alta de que é o melhor caminho entre os seis.

## 2. Diagnóstico — por que o modelo atual não rende

**2.1 O produto vendido ao restaurante não tem comprador.**
- [FATO] 0 contas de restaurante em `restaurant_users`; 185 e-mails (21/08–05/09) → 3 respostas → 1 candidatura → 0 contas; o fluxo de ativação não cria conta (`docs/estrategia/contas-2026-09-30.md`).
- [FATO] As 34 casas que respondem a pedidos receberam a campanha; 0 ativaram (`chave-girada`, 03/09). Critério de morte do plano de 03/09 (<3 contas em 30 dias) atingido em 15/09.
- [FATO] O mercado só aceita dois preços: comissão por couvert vindo do marketplace (TheFork ~139 €/mês + 2–4 €/couvert, [Eat App, jul/2026](https://restaurant.eatapp.co/fr/blog/best-restaurant-reservation-software-apps-in-france-2026); queixa sindical GNI/UMIH/SNRTC de 18/11/2022, [GHR](https://www.ghr.fr/actualites/nos-reserves-sur-les-festivals-organises-par-la-plateforme-thefork)) ou assinatura "zero comissão" (Zenchef 129/169/249 €/mês, [zenchef.com/fr/tarifs](https://www.zenchef.com/fr/tarifs)). [INFERÊNCIA] A TWK não traz demanda incremental mensurável (5 jantares/mês em Paris) nem substitui o software da casa; logo não há preço que ela possa cobrar do restaurante hoje.

**2.2 A demanda que o site tinha era demanda sem resposta.**
- [FATO] Jun/2025: 1.135 pedidos, 3% aceitos. Set/2026: 274 pedidos, 10% aceitos. Os 8 restaurantes mais pedidos somaram 348 pedidos em 90 dias e aceitaram 3 (`reservas-2026-09-30.md`).
- [FATO] 97% dos pedidos de 2025 viraram cliente decepcionado; o Google rebaixou o site na atualização de 30/06/2025 (fichas de casas famosas idênticas a dezenas de outras).
- [INFERÊNCIA] Recuperar tráfego para fichas que não respondem é pagar para decepcionar. O ativo útil que sobrou é o grupo de casas que confirma (Paris 40% de aceite; 11 confirmadores puros), não o catálogo de 1.548.

**2.3 O site promete o que a operação não sustenta (auditoria como cliente, 08/10).**
- [FATO] Home: "Confirmamos com o estabelecimento", "Suporte personalizado 24/7", "Serviço VIP", "Benefícios exclusivos" — contra 10% de aceite real e nenhum benefício concreto listado.
- [FATO] FAQ: "A mesa só é confirmada quando o estabelecimento ou o nosso concierge aceita"; "normalmente não adiciona taxas" — o cliente aprende que não há garantia e que o serviço é gratuito, isto é, sem valor percebido para pagar depois.
- [FATO] `/explore/paris` (sem prefixo de idioma, URL usada pelo schema `SearchAction`) responde 404; `/pt/explore/paris` funciona (118 casas, 25 estrelas). Chips de cidade da home sem clique; Dubai e Singapura com 0 casas (auditoria 07/10).
- [FATO] Pedido de mesa exige conta antes de enviar (login wall, auditoria 07/10); a ficha avisa "Data e horário preferidos são um pedido".
- [FATO] Motorista: `/chauffeur-prive` diz "Um só chauffeur, a cada trajeto", "Nice, Cannes, Saint-Tropez e Mônaco **uniquement**", orçamento por WhatsApp "em geral em alguns minutos", sem preço, sem Paris — enquanto o briefing descreve Paris + Riviera, multi-motorista e multi-categoria. A home chama de "Motorista particular na Côte d'Azur", a página de "Lifestyle Management".
- [FATO] Contato promete formulário ("use the form below") que não existe; "open 24/7".

**2.4 Auditoria como parceiro (08/10).**
- [FATO] Não há entrada "Parceiros/Devenir partenaire" no site público. A ficha tem "Revendiquer cette fiche" → `manager.theworldkeys.com/register?listing=…`; o manager se apresenta como "TWK Admin Dashboard · BETA"; `/sign-up` e `/pricing` do manager dão 404; `/register` do site público dá 404. Não existe preço público da assinatura em lugar nenhum.
- [FATO] Para prestadores de serviço (motorista, barco, heli) não há página, formulário nem tabela no banco; a prospecção é por e-mail e o contrato não existe (briefing + `ligacoes-servicos.csv` vazio).

**2.5 Incoerência de posicionamento.** [INFERÊNCIA] Três promessas num só domínio: "reserve os restaurantes mais celebrados do planeta" (12 cidades, 7 idiomas), "um motorista na Riviera" (1 carro, 4 cidades, WhatsApp) e "conciergerie" (ainda invisível). Para um concierge de hotel ou um DMC, isso parece um agregador sem operação; para um cliente HNW, parece uma landing de VTC. A marca registrada nas classes 39 (transporte), 41, 43 (restauração) e 36 permite unificar sob "balcão de execução", mas o site não faz isso.

## 3. Dores reais (uma dor só entra com evidência de pagamento ou queixa pública)

| Dor | Quem sente | Evidência e fonte | Como é resolvida hoje | Quanto se paga |
|---|---|---|---|---|
| Fornecedor que não responde; concierge de hotel que leva uma semana | Travel advisor, gestor de villa, hóspede | [FATO] [TravelSort, 09/10/2022](https://travelsort.com/dear-hotel-concierges-please-respond-promptly): desks de luxo silenciam "a week or more"; [Pearl, set/2026](https://joinpearl.co/blogs/inside-the-concierge-call-booking-the-table-thats-actually-worth-it) (fonte comercial) | Follow-up manual; agência intermedia | Sem preço; custo = cliente perdido |
| Precisar de carro + mesa + experiência na semana de evento, quando tudo esgota | Participante e organizador de Film Festival, Lions, MIPCOM; DMC | [FATO] Cannes: Film Festival US$ 705/noite (+20% vs 2024), 1 em 10 hotéis disponível; Lions 100% indisponível ([HospitalityNet/Lighthouse, 09/05/2025](https://www.hospitalitynet.org/news/4127115.html)); Mônaco reforça frota de táxis em 2025 ([Monaco Life](https://monacolife.net/taxis-de-monaco-boosts-summer-service-with-new-all-electric-fleet)) | Reserva com meses; DMC; shuttles oficiais | Diária 2–3× o normal; táxi fixo 85 € |
| Intermediário quer ser remunerado para indicar | Concierge de hotel, agência, gestor de villa | [FATO] SnapCar reparte 20% com agências ([L'Écho Touristique](https://www.lechotouristique.com/article/quand-les-chauffeurs-vtc-roulent-pour-les-pros,88580)); Welcome Pickups paga comissão ao hotel por transfer ([Mews](https://www.mews.com/en/products/marketplace/welcome-pickups)); concierge recebe 10% da conta ou 15–35 €/pax do restaurante em Barcelona ([ARA, 01/08/2026](https://en.ara.cat/food/commissions-and-free-meals-the-reward-for-some-hotel-receptionists-for-making-reservations-at-barcelona-restaurants_1_5812981.html)); DMC markup 15–25% ([dmcquote](https://dmcquote.com/how-to-get-dmc-rates), vendor — [INFERÊNCIA] para a Riviera) | Acordos informais; grade B2B | 10–25% do serviço |
| Transfer aeroporto Nice → Cannes/Mônaco: preço, sobretaxa, oferta no verão | Viajante, hóspede | [FATO] Táxi tarifa fixa 2026: Cannes 85 €, Mônaco 95 €, com balcão de reclamação por sobretaxa ([Aéroport Nice](https://www.nice.aeroport.fr/en/directions/taxis)); VTC privado 81–139 € ([Transfeero](https://www.transfeero.com/fr/transferts-de-laeroport-de-nice-cote-dazur-nce/transfert-de-aeroport-de-nice-a-cannes/)) | Táxi, VTC pré-reservado, heli 195 €/assento ([Blade](https://www.blade.com/nice-monaco)) | 85–140 € por trajeto |
| Mesa em casa disputada (Paris, Mônaco, Cannes, Saint-Tropez) | Viajante HNW | [FATO] Dorsia vende a mesa com gasto mínimo pré-pago e opera em Paris, Mônaco, Cannes e Saint-Tropez ([FAQ](https://www.dorsia.com/faq); [PR, 21/05/2025](https://persportaal.anp.nl/artikel/CSN-210525156/-dorsia-the-global-hospitality-and-tech-leaders-announce-their-european-summer-2025-line-up)); conciergerie em Cannes cobra a partir de 250 € por mesa ([conciergerie-cannes.fr](https://conciergerie-cannes.fr/en/services-conciergerie-cannes.html)); Paris 150–500 €/pedido ([allovoyages, 17/09/2026](https://allovoyages.fr/a-la-une/conciergerie-de-luxe-paris/)) | Membership, concierge privado, cartão Amex (Resy embutido, US$ 895/ano) | Dorsia US$ 200–25.000/ano + mínimo; 150–500 € por ato |
| "Quem resolve por mim" sem app | Cliente HNW residente | [FATO] Vaga "Concierge Privé" Paris, 08/10/2026, 30 k€ + variável sem teto ([Michael Page](https://www.michaelpage.fr/job-detail/concierge-priv%C3%A9-hf/ref/jn-092026-7100890)); Quintessentially não publica preço | Conciergeries privadas; John Paul (B2B) | 3–15 k€/ano (não auditado) |
| Reserva confirmada e restaurante fechado; suporte por bot | Cliente de TheFork | [FATO] Trustpilot thefork.fr: 22.425 avaliações, 12% com 1 estrela, queixas de 07 e 08/10/2026 ([Trustpilot](https://fr.trustpilot.com/review/thefork.fr)) | Não é resolvida | Zero em dinheiro; noite perdida |
| No-show | Restaurateur | [FATO] 10% das reservas, até 15% do faturamento (CEO Zenchef, AFP 09/03/2025, [Paris Match BE](https://www.parismatch.be/lifestyle/food/2025/03/09/votre-compte-the-fork-a-t-il-ete-supprime-voici-comment-la-celebre-plateforme-compte-baisser-de-30-les-reservations-non-honorees-au-restaurant-GFDCGODVFVD45J4UVTFMREADCY/)); TheFork estima 1.650 €/ano por casa de 500 k€ ([Tendance Hôtellerie, 30/01/2025](https://www.tendancehotellerie.fr/articles-breves/communique-de-presse/23675-article/thefork-dresse-le-bilan-annuel-2024-du-secteur-de-la-restauration-a-la-dynamique-contrastee-et-annonce-des-perspectives-ambitieuses-et-solides-pour-2025)) | Empreinte bancaire, pré-pagamento | 10–15% do CA |
| Comissão por couvert e ranking punitivo; ou assinatura com taxa de cartão escondida | Restaurateur | [FATO] GNI/UMIH/SNRTC, 18/11/2022 ([GHR](https://www.ghr.fr/actualites/nos-reserves-sur-les-festivals-organises-par-la-plateforme-thefork)); Zenchef 129–249 €/mês com cartão 2–6% ([FrontDeskReview, set/2026](https://frontdeskreview.com/software/restaurant-reservation/zenchef/)) | Fica por hábito ou migra | 139 €/mês + 2–4 €/couvert; 1,5–3 k€/ano |
| Motorista depende de hotel/agência para ter cliente | Chauffeur VTC | [FATO] [L'Écho Touristique](https://www.lechotouristique.com/article/quand-les-chauffeurs-vtc-roulent-pour-les-pros,88580); grade pro para hotéis ([Keobiz](https://www.keobiz.fr/fiches-pratiques/vtc-clientele-privee-hors-plateformes/)); Blacklane paga a oferta integral ao parceiro e vive do spread ([Blacklane partner-help](https://partner-help.blacklane.com/en/articles/8420677-what-does-it-mean-to-become-a-blacklane-partner)) | Grade B2B; plataformas | 12–25% por indicação; take rate de plataforma 24–25% (Bolt [24%](https://bolt.eu/en/support/articles/4405169503890/)) |
| Barco e heli: ativo caro e ocioso, canal caro | Dono/operador | [FATO] Click&Boat até 26% do dono + frais do locatário ([Help C&B](https://help.clickandboat.com/hc/en-gb/articles/4416568609938)); gestão locativa Côte d'Azur 50% do CA ([Boatcible, 06/05/2026](https://boatcible.com/2026/05/06/gestion-locative-bateau-cote-dazur-2026/)); GetYourGuide 20–30% ([Arival, 2025](https://arival.travel/article/getyourguide-commission-increasing-for-some-operators)) | Brokers, marketplaces, agências | 15–30% da venda |
| Gestor de villa: comissão alta e opaca | Proprietário, hóspede | [FATO] Saint-Tropez 25% HT vs 20,3% média França ([Toploc, 2026](https://toploc.com/blog/hotes/tarifs-conciergerie-location-saisonniere)); Le Collectionist 20–22% + 5.000 €/semana de conciergerie ([Connexion](https://connexionfrance.com/magazine/introducing-le-collectionist-the-luxury-rental-home-company/414657)) | Mandato com % | 20–30% + extras |

**Sem evidência de pagamento (procurado e não achado):** preço atual da Quintessentially; comissão de concierge a VTC especificamente na Côte d'Azur (só fóruns anônimos); queixa literal "trop de plateformes" de restaurateur em 2024–26; revenda de mesas em Paris (só Nova York); estatística oficial francesa de no-show. Esses pontos ficam fora da tese.

## 4. Caminhos avaliados

Critérios: evidência da dor · quem paga e quanto · tempo até a 1ª receita · esforço de dev antes da 1ª venda · capital · margem · recorrência · defensabilidade · risco de execução para um fundador. Descartada qualquer rota que dependa de investimento, viralização, tráfego novo em volume ou >4 semanas de dev antes da 1ª venda.

| Caminho | Evidência da dor | Quem paga / quanto | 1ª receita | Dev antes da venda | Margem · recorrência | Defensabilidade | Risco p/ 1 fundador | Veredito e motivo |
|---|---|---|---|---|---|---|---|---|
| **a) Corrigir o modelo de restaurantes** (porta de conta, cobrar assinatura/comissão) | Alta para no-show e comissão (§3), **mas a TWK não resolve nenhuma das duas** | Restaurante: 0 € hoje; mercado paga 129–249 €/mês por software ou 2–4 €/couvert por cliente novo | ≥ 3 meses (porta + venda presencial; OpenTable precisou de 3,2 visitas/venda, dossiê 15/09) | 4+ semanas (porta de conta) | Média · alta se existisse | Baixa: Zenchef/TheFork/SevenRooms | Alto: 13 meses sem 1 conta | **Descartado como fonte de receita.** Mantém-se só o essencial: consertar a porta para as ~34 casas que confirmam, porque elas são a "mesa" do caminho escolhido |
| **b) Centrar em mobilidade B2C** (site de chauffeur com reserva instantânea) | Alta (transfer e evento, §3) | Cliente final: 81–139 € Nice–Cannes, 80–140 € CDG–Paris, ~100 €/h ([Transfeero](https://www.transfeero.com/fr/transferts-de-laeroport-de-nice-cote-dazur-nce/transfert-de-aeroport-de-nice-a-cannes/), [conciergerie-cannes](https://conciergerie-cannes.fr/en/services-conciergerie-cannes.html)) | Já existe (WhatsApp) | 2–3 semanas para pagamento online | 25% (parceiro) a ~55% (próprio) · recorrência média | Baixa: commodity; Blacklane, Welcome, Transfeero | Médio: 1 carro, 1 pessoa | **Descartado como centro:** depende de tráfego novo (Google −96%, SEO leva meses, Ads 2–5 €/clique sobre ticket de 130 €). Fica como **produto-ponta** do caminho d |
| **c) Conciergerie vendida ao cliente final** (membership ou por ato) | Alta (Dorsia na Riviera, 250 €/mesa em Cannes) | Cliente HNW: 150–500 €/ato; 3–15 k€/ano | 1–2 meses, se houver cliente | 0 | Alta por ato · recorrência baixa sem membership | Média (marca, idiomas) | Alto: venda consultiva 1:1, demanda própria da base na Riviera = 7 jantares/ano | **Descartado como centro:** não há demanda própria (Riviera 7 aceites/ano), baixa temporada, e a TWK não pode prometer mesa (10% de aceite). Entra como **add-on** do caminho d |
| **d) B2B: balcão de execução para intermediários** (hotéis boutique, gestores de aluguel premium, DMCs, agências de evento, delegações corporativas em congressos) | Alta: fornecedor que não responde, semana de evento, intermediário remunerado por comissão (§3) | O cliente final paga o serviço (pré-pago); o intermediário recebe 10% ou tarifa net; a TWK fica com 15–25% | **2–6 semanas** (telefone em francês + tabela de preços; sem código) | 0 para a 1ª venda (Modo A: cliente paga o prestador; Stripe link) | 15–25% motorista, 5–10% experiências · **recorrência alta** (o mesmo concierge compra toda semana) | Média: resposta <1 h, PT/FR/EN, mesa em casas que confirmam, marca classes 39/43 | Médio: vende-se com 20 h/semana; capacidade depende da rede de motoristas | **Escolhido.** Único caminho com pagador identificado, demanda existente sem tráfego novo, 1ª receita em semanas e recorrência |
| **e) Monetizar a base de 23 k** (e-mail/WhatsApp com oferta paga) | Média: 3.917 ativos em 12 m, 433 recorrentes; Paris 185 clientes/ano | Cliente da base: Soirée 390 €; "frais de conciergerie" | 2–4 semanas | 0 | 25% · recorrência 11% | Baixa | Alto em consentimento (marketing para quem só pediu mesa) e em reputação (97% já ficaram sem resposta) | **Descartado como centro:** base pequena para Paris/Riviera (≈5 jantares/mês), consentimento a verificar (§8). Vira **canal secundário**: a Aria oferece a Soirée no momento do aceite |
| **f) Mesa paga sob confirmação** ("só cobramos se conseguirmos", 50–250 €) | Alta (Dorsia, Appointment Trader US$ 80–200/mesa, 250 € em Cannes) | Cliente: 50–250 € por mesa confirmada | 2–4 semanas | 0–2 semanas | Alta por ato · baixa recorrência | Média | Alto: a TWK confirma 10%; sem conta/relacionamento com a casa, a taxa de sucesso não é controlável | **Descartado como centro;** teste tardio dentro do caminho d (cobrar a mesa só para intermediários, embutida no pacote) |

## 5. A premissa do plano

**Para concierges de hotéis 4–5 estrelas sem frota própria, gestores de aluguel e villas premium, DMCs e agências de evento em Paris, Cannes e Mônaco (e delegações corporativas lusófonas e francesas nos congressos de outubro a dezembro), que sofrem com fornecedores que não respondem e com a falta de um só fornecedor confiável para carro + mesa + experiência nas datas em que tudo esgota, a World Keys vai operar um balcão de execução B2B — chauffeur com preço fechado (transfer, disposição, Soirée), mesa em casa que confirma, experiências de parceiros — com resposta em menos de uma hora e pré-pagamento, cobrando margem por serviço (25% no motorista, 10% nas experiências, dos quais 10 pontos vão ao intermediário) em vez de assinatura, porque já tem a operação de motorista rodando em Paris e na Côte d'Azur, uma rede de motoristas parceiros, 34 casas que confirmam pedidos (Paris 40%), a marca registrada nas classes 39 e 43, o site em 7 idiomas e um fundador que vende em francês, inglês e português.**

## 6. Por que vai dar certo

**Evidências de mercado**
- [FATO] O canal B2B é como as empresas de chauffeur conseguem demanda: Welcome Pickups paga comissão a hotéis e gestores de aluguel para ser o transfer deles ([Mews](https://www.mews.com/en/products/marketplace/welcome-pickups); afiliados 8–9%, [Travelpayouts](https://www.travelpayouts.com/en/offers/welcome-pickups-partner-program)); SnapCar divide 20% com agências ([L'Écho Touristique](https://www.lechotouristique.com/article/quand-les-chauffeurs-vtc-roulent-pour-les-pros,88580)); Sixième Étoile e Kingdom Limousines têm páginas dedicadas a DMCs, agências e hotéis (Le Bristol, Crillon, George V — alvos listados em `orchestrator/state/servicos/alvos-servicos-2026-09-17.csv`).
- [FATO] O intermediário já é pago em 10–25% em toda a cadeia (§3): concierge 10% da conta, DMC markup 15–25%, villa 20–25%, broker náutico 15–20%. [INFERÊNCIA] Oferecer 10% ao intermediário não pede nada novo; só redireciona um fluxo que existe.
- [FATO] "Mesa + carro + experiência" já é vendido como pacote na Riviera (conciergerie-cannes: mesa desde 250 €, Classe S 95–110 €/h; Dorsia em Cannes/Mônaco/Saint-Tropez). [INFERÊNCIA] O mercado aceita o pacote; o que falta é um fornecedor que responda rápido em três idiomas para o intermediário, não mais um site B2C.
- [FATO] Pré-pagamento é o mecanismo que elimina no-show e financia a plataforma (Tock/Resy 2–3% sobre pré-pago, [resy.com](https://resy.com/join/plans-pricing/); Dorsia perde 100% em no-show, [FAQ](https://www.dorsia.com/faq); Welcome fare pré-paga). O pacote B2B nasce pré-pago.
- [FATO] Take rate de 24–30% é o idioma de marketplaces de mobilidade e experiência (Bolt 24%, GetYourGuide 20–30%, Click&Boat até 26%). Os 25% do protótipo TWK estão no centro da faixa.

**Ativos aproveitados sem desperdício**
- Operação de motorista rodando na Côte d'Azur e um parceiro em Paris (Tesla Model X, 6 lugares); rede de motoristas parceiros (a confirmar: pergunta 5) → capacidade sem capital.
- 34 casas que confirmam, Paris com 40% de aceite, Monak 74% → a "mesa" entra só com casas que confirmam (critério do Guardião: ≥4 pedidos em 90 dias, ≥50% aceitos). Nunca se promete mesa.
- Marca registrada nas classes 36/39/41/43 → "The World Keys" cobre transporte, lazer e restauração sem rebranding.
- Site em 7 idiomas e fundador trilíngue → nicho lusófono corporativo nos congressos de Cannes (ninguém atende em português — [SUPOSIÇÃO A VALIDAR] já registrada no plano de 14/09).
- 23 k cadastros, 3.917 ativos → canal secundário: Soirée oferecida pela Aria no aceite da mesa em Paris (contexto transacional, sem marketing frio).
- Protótipo pronto de página, checkout (Stripe Connect) e conta profissional do motorista (15/09) → o dev de 2–3 semanas já está desenhado; a 1ª venda não depende dele.

**Precedentes de modelo semelhante**
- [FATO] Welcome Pickups: transfer pré-pago com demanda vinda de hotéis e gestores de aluguel (ver links acima).
- [FATO] John Paul (Accor): concierge vendido B2B em white-label a bancos, hotéis e marcas; 600 pessoas, 35 programas ([johnpaul.com/faq-en](https://www.johnpaul.com/faq-en); [Tendance Hôtellerie, 07/2026](https://www.tendancehotellerie.fr/articles-breves/communique-de-presse/19197-article/john-paul-filiale-accor-celebre-ses-15-ans)). O pagador escalável do concierge é a empresa, não o indivíduo.
- [FATO] Blacklane: preço fixo ao cliente, parceiro recebe a oferta integral, margem no spread ([partner-help](https://partner-help.blacklane.com/en/articles/8420677-what-does-it-mean-to-become-a-blacklane-partner)) — revenda com marca, não marketplace neutro. É exatamente a estrutura da TWK com motoristas parceiros.
- [FATO] Chabé (1921) vende confiabilidade a corporativo e eventos sob orçamento, sem preço público ([chabe.com Nice](https://www.chabe.com/en/news/chauffeured-services-nice/)). [INFERÊNCIA] A TWK não compete com Chabé nos palaces; entra nos hotéis boutique, gestores de aluguel e agências menores, com preço fechado e três idiomas.

**Sazonalidade: o caminho não depende da alta temporada para a primeira receita; depende dela para os 10 k€/mês.** Calendário verificado em sites oficiais (08/10):

| Semana | Côte d'Azur | Paris | Leitura |
|---|---|---|---|
| 8–11/10 | Les Assises cyber, Mônaco 7–10 (fonte terceira) | — (Fashion Week acabou 6/10) | Baixa |
| 12–18/10 | **MIPCOM 12–15**, Cannes, 10.600+ participantes ([mipcom.com](https://www.mipcom.com/en-gb.html)) | **Mondial de l'Auto 12–18** ([mondial.paris](https://mondial.paris/infos-pratiques)), **SIAL 17–21** ([sialparis.com](https://www.sialparis.com/)) | Alta nas duas regiões |
| 19–25/10 | Sportel 19–21, Mônaco | SIAL até 21; **Art Basel Paris 23–25** ([artbasel.com](https://www.artbasel.com/paris)) | Alta em Paris |
| 26/10–1/11 | nada verificado; Toussaint (17/10–2/11), feriado 1/11 | Salon du Chocolat; qualificatórias Rolex Paris Masters | Baixa/lazer |
| 2–8/11 | **MAPIC 3–4**, Cannes ([mapic.com](https://www.mapic.com/en-gb.html)); Marathon Nice–Cannes 8/11 | **Equip'Hotel 2–5** (hoteleiros = prospects, [equiphotel.com](https://www.equiphotel.com/en-gb/ticketing.html)); **Rolex Paris Masters 31/10–8/11** ([Paris La Défense](https://www.parisladefense.com/en/news/events/rolex-paris-masters-back-october-31-november-8-2026)) | Alta nas duas regiões |
| 9–11/11 | nada verificado | feriado 11/11 (qua) | Baixa |
| Depois | **ILTM Cannes 30/11–3/12** — a feira dos travel advisors de luxo, 85.000 reuniões ([iltm.com](https://www.iltm.com/cannes/en-gb.html)); Monte-Carlo Jazz 18–26/11; festas 19/12–4/1; Rallye Monte-Carlo 21–24/1; Carnaval de Nice 9–28/2; **MIPIM 15–19/3**; **Rolex Monte-Carlo Masters 3–11/4**; Festival de Cannes 11–22/5; GP de Mônaco 4–6/6 | Paris Photo 12–15/11; Maison&Objet 14–18/1; PFW masculina e alta-costura 19–28/1; Salon de l'Agriculture 27/2–7/3; PFW feminina 1–9/3 | Alta temporada da Riviera = abr–jun/2027 |

[INFERÊNCIA] Três das cinco semanas até 11/11 têm congresso em Cannes e feira em Paris ao mesmo tempo: a demanda do 4º trimestre é corporativa e de evento, exatamente a que compra via DMC, agência e hotel. O lazer na Riviera só volta em abril; por isso o alvo de 10 k€/mês é para a primavera, não para o inverno.

## 7. Economia unitária (contas visíveis)

Preços de referência do mercado [FATO]: Nice→Cannes berline 81 €, premium 139 €; Nice→Mônaco 92 €; táxi fixo 85/95 € ([Transfeero](https://www.transfeero.com/fr/transferts-de-laeroport-de-nice-cote-dazur-nce/transfert-de-aeroport-de-nice-a-principaute-de-monaco/), [Aéroport Nice](https://www.nice.aeroport.fr/en/directions/taxis)); CDG→Paris berline premium 120–140 € ([tspvip](https://www.tspvip.com/chauffeur-cdg), [MyDriverParis](https://www.mydriverparis.com/fr/transfert-aeroport-charles-de-gaulle-paris/)); mise à disposition Classe S 95–110 €/h ([conciergerie-cannes](https://conciergerie-cannes.fr/en/services-conciergerie-cannes.html)); heli Nice–Mônaco privado 700–2.500 € ([Blade](https://www.blade.com/nice-monaco)).

Tabela TWK proposta (preço ao cliente, IVA incl.) e margem por cenário. **Cenário P (conservador, motorista parceiro):** TWK retém 25%; **via intermediário**, 10 pontos vão a ele → TWK fica com 15%. **Cenário O (motorista próprio na folha):** margem bruta ≈ 55% após energia, pedágio, estacionamento e hora do motorista ([SUPOSIÇÃO A VALIDAR] — depende da pergunta 1).

| Produto | Preço | P direto (25%) | P via intermediário (15%) | O direto (≈55%) |
|---|---|---|---|---|
| Transfer Nice–Cannes / Nice–Mônaco | 130 € | 32,50 € | 19,50 € | 71,50 € |
| Transfer CDG/Orly–Paris | 150 € | 37,50 € | 22,50 € | 82,50 € |
| Disposição 4 h | 400 € | 100,00 € | 60,00 € | 220,00 € |
| Dia 8 h | 750 € | 187,50 € | 112,50 € | 412,50 € |
| Soirée (ida, espera 4 h, volta + mesa em casa que confirma) | 390 € | 97,50 € | 58,50 € | 214,50 € |
| Heli Nice–Mônaco privado (parceiro; comissão 10%, 5% via intermediário) | 700 € | 70,00 € | 35,00 € | — |

Taxa Stripe (1,5% + 0,25 € cartão UE) e IVA sobre a comissão não estão deduzidos; reduzem a margem em ≈2 pontos.

**Meta de 1.600 € líquidos até 11/11/2026 (5 semanas).** Cenário P, mix 70% via intermediário / 30% direto:

| Serviços | Qtde | Margem TWK |
|---|---|---|
| Dia 8 h: 5 via intermediário + 3 diretos | 8 | 562,50 + 562,50 = 1.125,00 € |
| Soirée: 4 via + 2 diretas | 6 | 234,00 + 195,00 = 429,00 € |
| Transfer (média 140 €): 8 via + 4 diretos | 12 | 168,00 + 140,00 = 308,00 € |
| **Total** | **26 serviços ≈ 5 por semana** | **≈ 1.860 €** sobre GMV ≈ 10.000 € |

Isso exige 3–5 contas B2B ativas gerando 1–2 pedidos/semana cada, mais a Soirée no aceite de Paris. No cenário O, a mesma meta cai para **≈ 11 serviços** (2 por semana). Volume de 26 serviços cabe em 1 carro (≈ 8 dias cheios + 18 trajetos curtos); acima disso, a rede de parceiros é obrigatória.

**Para 10.000 € líquidos por mês.** Margem média ponderada ≈ 75 €/serviço (cenário P, mix com mais dias e eventos) → **≈ 130 serviços/mês (4–5 por dia), GMV ≈ 45–50 k€/mês**. Um carro produz no máximo ≈ 15–18 k€ de GMV/mês (25 dias × 700 €); logo são precisos **3–4 carros ativos** nos dias de pico e **12–15 contas intermediárias** comprando 8–10 serviços/mês cada, ou 6 contas mais 2 contratos corporativos de congresso. No cenário O com 2 carros próprios, o número cai para ≈ 55 serviços/mês. [INFERÊNCIA] Esse patamar não chega antes da alta temporada (Rolex Masters, Festival de Cannes, GP de Mônaco, Cannes Lions, abr–jun/2027); o 4º trimestre serve para montar as contas e provar o processo em MIPCOM/MAPIC/ILTM e em Paris.

**Sensibilidade.** Cada 5 pontos de take rate a mais (30% em vez de 25%) reduzem 17% o volume necessário; cada ponto de comissão ao intermediário acima de 10% exige 7% mais volume. A alavanca que mais mexe o resultado é a proporção de **dias inteiros** (margem 112–187 €) sobre transfers (20–37 €).

### Adenda de 09/10/2026 — motorista é da empresa (resposta do fundador à pergunta 1)

Custos variáveis por serviço [SUPOSIÇÃO A VALIDAR]: transfer 15 € (energia, pedágio, estacionamento), Soirée 25 €, dia inteiro 30 €. Custo fixo já pago hoje [SUPOSIÇÃO A VALIDAR]: motorista ≈ 3.500 €/mês (custo empregador) + carro, seguro e manutenção ≈ 1.800 €/mês = **≈ 5.300 €/mês**.

| Produto | Preço | Contribuição direta | Via intermediário (−10%) |
|---|---|---|---|
| Transfer Nice–Cannes / Nice–Mônaco | 130 € | 115 € | 102 € |
| Transfer CDG/Orly–Paris | 150 € | 135 € | 120 € |
| Disposição 4 h | 400 € | 380 € | 340 € |
| Dia 8 h | 750 € | 720 € | 645 € |
| Soirée | 390 € | 365 € | 326 € |

- **1.600 € até 11/11, lido como receita nova acima do que o motorista já fatura:** 2 dias via intermediário (1.290 €) + 1 Soirée direta (365 €) = 1.655 € → **3 serviços**; ou 5 Soirées via intermediário (1.630 €). Teto superior: 14 transfers.
- **1.600 € até 11/11, lido como lucro depois de salário e carro (≈ 6.120 € em 5 semanas):** contribuição necessária ≈ 7.720 € → 8 dias + 6 Soirées + 4 transfers ≈ **18 serviços**, 1 carro basta.
- **10.000 €/mês líquidos depois do fixo:** contribuição ≈ 15.300 €/mês → 10 dias inteiros + 16 Soirées + 24 transfers ≈ **50 serviços/mês num só carro, ocupação ≈ 70–75%**, com **6–8 contas B2B** compradoras; motoristas parceiros (25%) só para o excedente dos picos. Antes (cenário P) eram 130 serviços, 3–4 carros e 12–15 contas.
- **Jurídico:** o serviço de motorista passa a ser produzido pela SAS → fora do L211-1; exige a SAS inscrita no registre des VTC como exploitant, carte pro do motorista, RC pro e capacidade financeira; a TWK fatura o cliente diretamente e pode emitir **fatura única ao hotel para a parte de motorista desde já**. Parceiros de experiência continuam em Modo A até o registro Atout France; rede de motoristas parceiros continua exigindo a declaração de centrale de réservation.

## 8. O que pode dar errado e critérios objetivos de abandono

**Restrições legais que afetam a recomendação** (fontes primárias lidas em 08/10; não é parecer jurídico — os pontos [INFERÊNCIA] vão ao advogado)

1. **Código do Turismo, L211-1.** [FATO] Aplica-se a quem "vend ou offre à la vente" serviços de viagem que não produz — transporte, aluguel de veículo, "outros serviços de viagem" — mesmo em venda unitária; exclusões só para bilheteria por conta do transportador, ocasional sem fim lucrativo etc. ([L211-1 a L211-24](https://www.legifrance.gouv.fr/codes/section_lc/LEGITEXT000006074073/LEGISCTA000006143163/)). Condições: registro Atout France (**295 € por pedido desde 1/3/2026, validade 3 anos**, [arrêté 20/02/2026](https://www.legifrance.gouv.fr/jorf/id/JORFTEXT000053525608)), garantia financeira sobre a totalidade dos fundos (mínimo 200.000 € no arrêté de 2009; vigência [NÃO VERIFICADO]) e RC pro ([L211-18](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000036242744)); sanção 1 ano e 15.000 € (L211-23). [FATO] "Motorista + mesa" na mesma noite (<24 h, sem pernoite) **não** é forfait nem prestação de viagem ligada (L211-2). [INFERÊNCIA] Barco, heli, aluguel de carro **e o motorista parceiro** vendidos em nome da TWK exigem o registro; a posição de "apporteur d'affaires" não tem confirmação oficial. **Impacto:** lançar em **Modo A** (cliente contrata e paga o prestador; a TWK fatura a comissão ao prestador — vale também para o Julien enquanto for parceiro) e, se o fundador quiser o balcão com fatura única (modelo revendedor, o mais natural para hotéis e DMCs), pedir o registro Atout France já em outubro: 295 € mais o custo da garantia, que é a incógnita a levar ao advogado.
2. **VTC e intermediação de motoristas.** [FATO] Carro próprio: carte professionnelle do condutor, inscrição do exploitant no registre des VTC, RC pro, capacidade financeira ([Code des transports, L3120–L3122](https://www.legifrance.gouv.fr/codes/section_lc/LEGITEXT000023086525/LEGISCTA000023071045/)). Rede de parceiros profissionais = **centrale de réservation**: declaração anual ao ministério dos Transportes (online, Kbis + RC pro, [démarche](https://demarche.numerique.gouv.fr/commencer/declaration-activite-centrales-reservation)), verificação de permis, seguro, carte pro, atestado de registro e veículo antes da 1ª mise en relation e todo ano, provas guardadas 3 anos ([R3141–R3143](https://www.legifrance.gouv.fr/codes/section_lc/LEGITEXT000023086525/LEGISCTA000037653483/2021-10-11/)); não declarar = 15.000 €; intermediar motorista não habilitado = 2 anos e 300.000 € ([Titre IV](https://www.legifrance.gouv.fr/codes/section_lc/LEGITEXT000023086525/LEGISCTA000033737551/2020-12-30/)). Lei 2026-534 (25/06/2026) acrescenta dever de vigilância das plataformas até 1/12/2027. Preço: o forfait legal (L3122-2) foi ab-rogado em 2015; vale "conditions fixées à l'avance" → cotação fechada escrita na reserva. [FATO] **Mônaco:** embarcar dentro do Principado exige vignette (100 anuais a 750 €, 200 de alta temporada a 600 €; **pedidos da anual 2027 de 1/10 a 15/12/2026**, empresa com ≥3 anos, [monentreprise.gouv.mc](https://monentreprise.gouv.mc/en/themes/transports/access-traffic-and-parking/traffic/how-to-apply-for-tax-stickers-for-foreign-companies-operating-private-hire-vehicles-with-driver-and-luxury-chauffeured-vehicles)); sem vignette, só desembarque com declaração em 10 min e **retorno para os mesmos passageiros entre 3 e 8 h depois** ([procedimento](https://monentreprise.gouv.mc/en/themes/transports/access-traffic-and-parking/traffic/how-to-declare-provision-of-private-hire-public-road-passenger-transport-and-foreign-taxi-services)). **Impacto:** a Soirée em Mônaco funciona sem vignette (deixa, espera, recolhe os mesmos clientes); o transfer Mônaco → aeroporto não. A declaração de central de reserva é pré-requisito para operar a rede; pedir a vignette 2027 até 15/12.
3. **Intermediação de pagamento.** [FATO] Receber em conta própria e repassar é serviço de pagamento reservado a PSP; a exceção de agente comercial raramente cabe a plataformas ([ACPR](https://acpr.banque-france.fr/fr/professionnels/lacpr-vous-accompagne/parcours-fintech/contenus-pedagogiques/de-quel-statut-releve-mon-activite/jencaisse-des-fonds-et-les-reverse-une-tierce-personne)). Com Stripe Connect em *direct charges* o parceiro é o vendedor registrado e a Stripe é a entidade regulada ([Stripe](https://stripe.com/en-bg/guides/how-psd2-impacts-marketplaces-and-platforms), [docs](https://docs.stripe.com/connect/charges)). **Impacto:** três modelos possíveis — Modo A (prestador cobra; TWK fatura comissão), Modo B (Stripe Connect, parceiro vendedor registrado) ou revendedor (TWK cobra e paga o prestador como fornecedor; exige o registro do item 1). Nunca "recebe e repassa" pela conta bancária da SAS.
4. **Marketing para a base de 23 k.** [FATO] CNIL (ficha de 10/06/2026): opt-in obrigatório em B2C; a exceção de "cliente existente" **não** vale quando "aucune vente ou prestation de service n'a été effectuée, y compris lorsque le client a créé un compte en ligne" ([CNIL](https://www.cnil.fr/fr/la-prospection-commerciale-par-courrier-electronique)); WhatsApp segue a mesma lógica mais a política da Meta. [INFERÊNCIA] Quem só pediu mesa é prospect; motorista não é "serviço similar" a reserva de restaurante. **Impacto:** o caminho e) está juridicamente fechado hoje (`aria_contact_consent` vazia); a oferta da Soirée no aceite deve ser validada pelo advogado como conteúdo transacional ou passar por caixa de opt-in no pedido — por isso ela é canal secundário do teste, não o principal.

**Riscos de mercado e execução**
1. **O intermediário já tem fornecedor** (Chabé, Sixième Étoile, motorista "da casa") e relação de comissão. Mitigação: entrar nos hotéis boutique e gestores de aluguel, não nos palaces; vender resposta <1 h, três idiomas e o pacote com mesa. **Abandono:** após 30 decisores alcançados, menos de 3 aceitam a tabela e nenhum faz pedido em 14 dias.
2. **Baixa temporada na Riviera até abril.** A demanda de out–dez é corporativa e de congresso; Paris carrega o resto. **Abandono:** se em 30/11 não houver 3 intermediários com ≥1 serviço pago, não abrir a Riviera além dos congressos.
3. **A mesa não é controlável** (10% de aceite global). Mitigação: só casas que confirmam, nunca prometer, discrição (ADR-015). **Abandono do componente mesa:** se <50% dos pedidos B2B de mesa forem confirmados em 7 dias, vender só carro + experiência.
4. **Capacidade e confiabilidade da rede de parceiros.** 1 carro = 15–18 k€ GMV/mês. **Abandono do crescimento:** se não houver 3 motoristas parceiros com documentos verificados até 15/12, o teto do negócio é ≈ 4 k€ de margem/mês.
5. **Tempo do fundador.** 20 h/semana de telefone em francês competem com a gestão dos devs. **Sinal de erro:** menos de 10 contatos qualificados por semana durante 3 semanas.
6. **Margem fina em transfers.** Se o mix ficar em transfers (20–37 €), a meta de 10 k€ exige 300+ serviços/mês — inviável. **Abandono do produto transfer avulso:** se, após 60 dias, dias inteiros e Soirées forem <40% do GMV.

**Nível de confiança declarado.** 1.600 € líquidos até 11/11: ≈ 40% (5 semanas, 0 parceiros, baixa temporada). 1.600 €/mês recorrentes em janeiro/2027: ≈ 65%. 10 k€/mês até junho/2027: ≈ 45%, condicionado à rede de motoristas e a 12+ contas ativas.

**O que precisa ser verdade:** (1) intermediários de Paris e Cannes aceitam um fornecedor novo se ele responder em <1 h com preço fechado; (2) a TWK consegue 3+ motoristas parceiros confiáveis; (3) o jurídico permite operar em Modo A sem Atout France até o parecer; (4) o fundador dedica 20 h/semana à venda por telefone.

**O que provaria a tese errada:** 30 contatos qualificados sem nenhum pedido pago em 14 dias; ou intermediários que pedem exclusividade de comissão >20% sem volume; ou taxa de recompra <30% nas contas que compraram uma vez (medida em fevereiro).

## 9. Teste de validação em 14 dias (pouco ou nenhum código)

**Objetivo:** provar que intermediários compram carro + mesa + experiência da TWK com preço fechado antes de investir nas 2–3 semanas de checkout.

**Preparação (dias 1–2, sem código):**
- Tabela de preços de 1 página em FR/EN/PT com os 6 produtos da §7 (tarifa pública e tarifa net −10% para o parceiro), política de cancelamento e "resposta em menos de 1 hora, 8h–22h". PDF + mesma tabela na página `/chauffeur-prive` (texto, sem reserva online).
- Número de WhatsApp Business dedicado e link de pagamento Stripe (Modo A por padrão: o prestador fatura e recebe; a TWK fatura a comissão ao prestador — ver §8).
- Lista de 30 alvos: 10 hotéis 4–5 estrelas boutique em Paris sem frota própria; 8 gestores de aluguel/villas premium (Paris e Cannes); 6 DMCs e agências de evento com clientes em MIPCOM, MAPIC ou ILTM; 6 expositores ou delegações brasileiras e portuguesas dos congressos de outubro e novembro em Cannes (lista pública dos eventos). Só números comerciais publicados (B2B por telefone é legal; e-mail B2B genérico com opt-out; nada de WhatsApp frio).

**Execução (dias 3–14):**
- 10 ligações por dia em francês (fundador), seguidas de e-mail com a tabela; registro em `ligacoes-servicos.csv` (já existe).
- A Aria oferece a Soirée (texto aprovado) no e-mail de aceite de toda mesa em Paris no período (≈5–10 aceites esperados) — **só após o advogado confirmar que cabe como conteúdo transacional** (§8, item 4); se não couber, a oferta fica visível na página de confirmação do site e o canal da base sai do teste.
- Em Mônaco, vender a Soirée (deixa, espera, recolhe os mesmos passageiros em 3–8 h, com declaração) e não o transfer de saída, enquanto não houver vignette.
- Toda cotação respondida em <1 h; todo serviço executado gera pedido de avaliação em 24 h.

**Métricas e limiares (sucesso / falha):**

| Métrica | Sucesso | Derruba a premissa |
|---|---|---|
| Decisores alcançados (de 30) | ≥ 20 | < 12 |
| Aceitam a tabela e pedem ao menos 1 cotação | ≥ 6 | ≤ 2 |
| Serviços pagos em 14 dias | ≥ 4 (≥ 1 dia inteiro ou Soirée) | 0 |
| Margem gerada | ≥ 400 € | < 100 € |
| Tempo médio de resposta | < 60 min | > 4 h |
| Soirée vendida no aceite de Paris | ≥ 1 | 0 em ≥ 8 aceites |

Custo do teste: horas do fundador + ≤ 200 € (impressão, deslocamento a 3 hotéis em Paris). Nenhuma linha de código obrigatória; a única dependência de dev é opcional (publicar a tabela na página existente).

## 10. Perguntas, em ordem de impacto na recomendação

1. **O motorista com o Tesla Model X é funcionário da SAS ou parceiro (Julien Guilloteau)?** Qual foi a receita bruta e a margem da operação de motorista em 2026, mês a mês, e quem dirige em Paris? Isso decide entre o cenário P (25%) e O (55%) e muda a meta de 26 para 11 serviços.
2. **Quem compõe a "rede de motoristas parceiros"?** Quantos, em que cidades, com que contrato, comissão e documentos (carte VTC, REVTC, RC Pro) verificados? Sem 3 parceiros confiáveis o teto é ≈ 4 k€/mês.
3. **Quantas horas por semana você consegue dedicar a telefone em francês nas próximas 5 semanas, e onde estará fisicamente (Paris ou Riviera) em outubro e novembro?**
4. **Qual é o [VALOR] do orçamento de 90 dias** e ele cobre um stand ou presença no ILTM Cannes (dezembro) ou só visitas?
5. **Situação jurídica atual:** a THE WORLD KEYS SAS está inscrita no registre des VTC como exploitant? Já declarou atividade de centrale de réservation? Tem RC Pro? Tem (ou pediu) registro Atout France e vignette de Mônaco? O advogado recebeu os seis pontos do plano de 17/09 e respondeu? Isso decide entre Modo A, Modo B e revendedor, e se a fatura única ao hotel é possível antes de 2027.
6. **Já existe algum cliente B2B ou relação viva** (hotel, agência, concierge, empresa) que compre ou já tenha comprado carro ou mesa da TWK? Nomes abrem a lista de 30.
7. **A base de 23 k tem consentimento de marketing registrado** (`aria_contact_consent` estava vazia em 15/09) e o acesso ao GA4 foi aberto? Isso decide se a base é canal ou só contexto transacional.

---
*Fim da entrega 1. Aguarda a análise do fundador antes de qualquer plano de execução.*
