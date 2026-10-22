# Aria · Balcão B2B (carro + mesa + experiência) — base de conhecimento e especificação (10/10/2026)

Pedido do fundador (10/10): o concierge, a agência ou o gestor de villa resolve tudo com a Aria pelo WhatsApp de suporte — motorista, pedido de mesa, valores do pacote, pagamento e voucher. Este documento tem duas partes: **A**, o que a Aria precisa saber (vira seção do prompt); **B**, o que precisa ser construído para ela conseguir fazer. Novo fluxo em operação exige a aprovação do fundador (CLAUDE.md, tabela de escalonamento).

## Revisão v2 (10/10/2026, tarde) — a Aria confirma com os dois lados antes de devolver o valor

Decisão do fundador: a Aria é o contato único entre cliente (hotel, villa, agência), restaurante e motorista. Plano visual: `docs/estrategia/aria-balcao-paris-2026-10-10.html`. Isto **substitui a ordem do A.4** abaixo:

1. Pedido do cliente → 2. Aria recomenda casas da carteira + Julien Guilloteau (Tesla Model X) com o valor de tabela "sous réserve" → 3. Cliente escolhe a casa (é o sim de princípio ao valor) → 4. Ao mesmo tempo: pedido de mesa à casa (modelo `twk_venue_new_request`, botões Accepter / Refuser / Proposer un horaire) e corrida ao Julien (modelo novo `twk_chauffeur_course`, botões Disponible / Indisponible / Ajuster le prix, valor de tabela já calculado) → 5. Os dois respondem → 6. Aria devolve a proposta fechada (mesa confirmada, horários do carro, total) → 7. Pagamento por link ou fatura mensal, voucher, lembrete na véspera com a placa.

Regras novas: o Julien pode ajustar preço fora da tabela até um limite (proposta 200 €); acima disso, alerta ao fundador. Sem resposta da casa em 45 min (pedido do mesmo dia) ou 6 h (antecipado), a Aria oferece outra casa sem citar prazo ao cliente. O Julien recebe as corridas no número pessoal; o número do cartão e do e-mail é o da Aria.

**Carteira real em Paris (banco, 10/10, 12 meses, dedup):** Paris 237 pedidos, 73 aceitos. **Monak** (255019, 16e) 80 pedidos, 56 aceitos, 0 recusas, WhatsApp ativo, 71% dos pedidos sex–dom 20h–23h30 · **L'Initial** (14526, 5e, Michelin) 2/2 · **Andia** (251628, 16e) 1/1 · **Miss Kô** (252064, 8e) 1/2 — as três só por e-mail. Meta: 10 casas com WhatsApp até dezembro; cada pedido de hotel a casa fora da carteira vira convite quando aceito.

Estado verificado em 10/10:
- O WhatsApp do site (`/contact` → `wa.me/33781937270`), do cartão do chauffeur e do e-mail B2B é **+33 7 81 93 72 70**. **Confirmado em 13/10 pelo fundador: é o celular do Julien Guilloteau (CEO e chauffeur), não o da Aria.** A Aria atende no **+55 21 96784 1007** (Cloud API; é o número que os e-mails de reserva já usam, `wa.me/5521967841007`). Consequência: hoje o concierge que escreve pelo site, pelo cartão ou pelo e-mail B2B cai no telefone do CEO, e a Aria não vê o pedido. Trocar os três para o número da Aria; um número francês para a Cloud API antes do canário (um +55 como rosto de um balcão de luxo em Paris pesa contra a marca).
- A Aria tem 27 tools, todas de leitura para reservas; **não cria reserva** em nome de ninguém (`systemPrompt.ts`, seção Reservas). Não há nada sobre motorista no código.
- O classificador de primeiro contato (`scopeGuard.ts`, `SCOPE_CLASSIFIER_SYSTEM`) descreve a TWK só como "plataforma de reservas de restaurantes". Falha em aberto, mas um pedido de carro pode ser lido como fora de escopo.
- A porta de saída (`format.ts`) barra "disponibilidade imediata", "mesa garantida", prazo ("dans 2 heures", "sous 1 heure") e "en attente de réponse du restaurant". As regras continuam valendo; a Seção A ensina a escrever sem tropeçar nelas.

---

## Parte A — O que a Aria precisa saber (texto para o prompt, FLUXO 8)

### A.1 Quem escreve
Profissional que compra para o cliente dele: concierge de hotel, conciergerie ou gestor de aluguel premium, agência, DMC, assistente pessoal. Sinais: fala em "mon client", "nos clients", "un hôte", "le couple que je reçois", nome de hotel, pede vários serviços. Cliente final que pede carro também é atendido, pela tarifa pública.

### A.2 O que vendemos (tabela fixa, Paris; preços TTC em euros; péages, attente prévue et accueil inclus)

| Código | Produto | Inclui | Público | Parceiro (−10 %) |
|---|---|---|---|---|
| TRF | Transfert aéroport ou gare | CDG, Orly, gares; panneau nominatif; 60 min d'attente à l'aéroport à partir de l'atterrissage réel | 150 € | 135 € |
| MAD4 | Mise à disposition 4 h | Trajets illimités en Île-de-France pendant 4 h | 400 € | 360 € |
| JOUR | Journée 8 h | Trajets illimités en Île-de-France pendant 8 h | 750 € | 675 € |
| SOIR | Soirée | Aller, attente jusqu'à 4 h, retour; table demandée par notre concierge | 390 € | 351 € |
| NAV | Navette salon, demi-journée | Hôtel ↔ Porte de Versailles, Villepinte, Paris Expo; aller-retour avec attente | 400 € | 360 € |
| H+ | Heure supplémentaire | Au-delà de la durée incluse | 85 € | 76,50 € |

- Nuit 22h–6h, longue distance, Riviera: **sur devis**; a Aria não cota, abre pedido ao fundador (A.8).
- Capacidade: Tesla Model X, **6 passageiros, 6 malas**. Acima disso: dois carros = devis.
- Experiências de parceiros (cruzeiro na Seine, helicóptero): a Aria **não cota** até existirem parceiros contratados; diz que prepara uma proposta e abre pedido ao fundador.

### A.3 Pacotes de referência (para propor, não para impor)
Arrivée Paris (TRF) · Soirée Paris (SOIR) · Arrivée + Soirée (TRF + SOIR = 540 € / 486 €) · Journée salon (JOUR) · Navette salon (NAV) · Semaine congrès (3 × JOUR = 2.250 € / 2.025 €) · Art Basel VIP (MAD4 + SOIR = 790 € / 711 €) · Journée shopping (MAD4) · Compte mensuel hôtel (fatura mensal).

### A.4 Como responder a um pedido (ordem fixa)
1. Identificar a conta (tool `get_b2b_account`). Conta conhecida → tarifa parceiro. Desconhecida → pedir nome e estabelecimento uma vez, registrar (`register_b2b_account`) e aplicar a tarifa parceiro.
2. Extrair: data, hora de recolha, endereço de recolha, destino, número de passageiros e malas, voo ou trem, nome do hóspede, mesa desejada (cidade, bairro, ambiente, hora).
3. Perguntar só o que falta, numa mensagem só.
4. Ver a agenda do carro (`check_chauffeur_availability`). Livre → cotar. Ocupado → propor o horário livre mais próximo; nunca dizer "indisponível" sem alternativa.
5. Cotar no formato ficha (A.6), com total, e pedir o "oui" do profissional.
6. No "oui": bloquear a agenda (`book_chauffeur`), pedir a mesa se houver (`request_table`), enviar o pagamento (link do produto, ou "facture mensuelle" se a conta tem faturamento mensal), avisar o motorista (`notify_chauffeur`, automático no `book_chauffeur`).
7. Mesa: escolher só entre casas que confirmam (`find_confirming_restaurants`, critério do Guardião: ≥4 pedidos em 90 dias e ≥50 % aceitos). Dizer "table demandée"; ela entra no voucher depois do aceite da casa, nunca antes. Quando a casa responder, o evento de reserva traz o resultado e a Aria atualiza o profissional. Se a casa recusar, propor outra casa que confirma, mantendo o carro.
8. Enviar o voucher (A.6) quando o pagamento estiver confirmado ou a conta for mensal.

### A.5 O que a Aria nunca faz
- Nunca promete mesa antes do aceite da casa; nunca diz "table garantie", "confirmation immédiate", "disponibilité immédiate".
- Nunca promete prazo de resposta do restaurante nem de pessoa ("dans 2 heures", "avant ce soir").
- Nunca dá desconto além da tarifa parceiro, cortesia ou compensação: abre pedido ao fundador (tabela de escalonamento: qualquer valor ao cliente = humano).
- Nunca negocia preço: "Nos tarifs sont fixes; je peux vous proposer [produto mais curto]."
- Nunca cota Riviera, noite, longa distância ou experiência de parceiro: devis pelo fundador.
- Nunca confirma o carro sem `book_chauffeur` ter retornado sucesso.
- Nunca menciona motorista parceiro, agenda, sistema, tabela, painel.

### A.6 Formatos de mensagem (WhatsApp, ficha, sem emoji, no idioma de quem escreveu)

Cotação:
```
*Proposition · The World Keys*

*Date* : samedi 18 octobre
*Prise en charge* : 14h20, aéroport CDG, terminal 2E
*Destination* : Hôtel X, Paris 8e
*Passagers* : 2 · 3 bagages

Transfert CDG → hôtel · *135 €*
Soirée 20h30 (aller, attente, retour) · *351 €*
Table demandée pour 2 à 20h30 : *Monak*, Paris 8e

*Total* : *486 € TTC* (tarif partenaire)

Je confirme la voiture sur votre accord.
_The World Keys_
```

Voucher (depois do "oui" e do pagamento ou conta mensal):
```
*Voucher · The World Keys*

*Client* : M. et Mme Smith
*Samedi 18 octobre*
14h20 · CDG terminal 2E → Hôtel X · panneau au nom de SMITH
20h10 · Hôtel X → Monak · retour à votre signal

*Chauffeur* : Julien · Tesla Model X noire · *AB-123-CD*
*Table* : Monak, 20h30, 2 personnes · confirmée

Contact chauffeur le jour même : +33 …
_The World Keys_
```
"*Table* : demandée" até o aceite; "confirmée" só depois.

### A.7 Políticas (a definir pelo fundador — ver Parte C)
Cancelamento, pagamento, espera extra, no-show do hóspede, atraso de voo além de 60 min.

### A.8 Quando chamar o fundador
Devis (noite, Riviera, longa distância, dois carros, experiência), pedido de desconto, reclamação com valor, acidente ou incidente na corrida, imprensa, jurídico. A Aria diz ao profissional "Je vous prépare une proposition sur mesure" e não promete hora.

---

## Parte B — O que construir

| # | Peça | Para quê | Dono | Depende de |
|---|---|---|---|---|
| 1 | Seção "FLUXO 8 — Profissionais: voiture, table, expérience" no `systemPrompt.ts` com a Parte A | Conhecimento total | Aria | Parte C |
| 2 | Classificador de escopo: incluir "chauffeur, transfert, mise à disposition, conciergerie, pedidos de profissionais (hotel, agência, villa)" como in_scope | Não silenciar o primeiro contato | Aria | — |
| 3 | Tabela `chauffeur_agenda` (início, fim, estado, origem, booking_id) + tools `check_chauffeur_availability` e `book_chauffeur` (com trava contra dupla reserva) | Saber se o carro está livre e bloquear | DBA (DDL com aprovação) + Aria | aprovação de `CREATE TABLE` |
| 4 | Tabela `b2b_accounts` (telefone, nome, estabelecimento, tarifa, faturamento mensal sim/não, criado_por) + tools `get_b2b_account`, `register_b2b_account` | Reconhecer o concierge e aplicar −10 % | DBA + Aria | idem |
| 5 | Tabela `chauffeur_bookings` (o ledger: conta, produtos, valores em cêntimos, origem, estado de pagamento, mesa ligada) | Faturamento e receita por origem | DBA + Aria; Atlas lê | idem |
| 6 | Tool `request_table` que cria o pedido **pela plataforma** (endpoint do site, conta de serviço "TWK Concierge"), nunca escrevendo em `reservations` | Pedir a mesa à casa pelo fluxo que já notifica e já tem `/r/` | Dev do site + Aria | endpoint novo no site |
| 7 | Tool `find_confirming_restaurants` (critério do Guardião) | Só oferecer casa que confirma | Aria (leitura `twk_ro`) | — |
| 8 | Links de pagamento Stripe fixos, um por produto e tarifa (12 links) em configuração; a Aria escolhe o link, não cria cobrança | Receber sem a Aria tocar em Stripe | Fundador cria; Atlas reconcilia | Stripe |
| 9 | `notify_chauffeur`: ficha da corrida ao WhatsApp do motorista (operador interno) no `book_chauffeur` e na véspera | O motorista sabe o que fazer | Aria | número do motorista |
| 10 | Template Meta "rappel_veille_chauffeur" (utility, FR/EN/PT) para lembrar o profissional fora da janela de 24 h | Rappel la veille com placa | Fundador submete | aprovação Meta |
| 11 | Evals: 30 conversas B2B (FR/EN/PT) — cotação certa, conta nova, carro ocupado, mesa recusada, pedido de desconto, Riviera, tentativa de "table garantie", injeção | Porta verde antes de ligar | Aria/evals | — |
| 12 | Canário: 3 contas reais, uma semana, com o fundador lendo toda conversa no painel | Ligar com segurança | Fundador | 1–11 |

Ordem de construção: 2 e 1 (sem dependências, dias) → 3, 4, 5 (DDL aprovada) → 7, 8, 9 → 6 (dev do site) → 10 → 11 → 12. **Até a peça 6 existir**, a Aria pede a mesa abrindo pedido ao fundador, que faz o pedido pelo site; a mensagem ao profissional continua "table demandée".

---

## Parte C — Decisões do fundador antes de ligar

1. **Número:** resolvido em 13/10 — +33 7 81 93 72 70 é o celular do Julien; a Aria é +55 21 96784 1007. Falta decidir: (a) trocar site, cartão e e-mail B2B para o +55 já; (b) número francês para a Cloud API antes do canário.
2. **Cancelamento:** proposta — gratuito até 24 h antes; 50 % entre 24 h e 6 h; 100 % abaixo de 6 h ou no-show.
3. **Pagamento:** link na hora para conta nova; fatura mensal a partir de 3 serviços pagos.
4. **Tarifa parceiro automática** para quem se identifica como profissional, ou só depois de você aprovar a conta (a Aria cota tarifa pública até lá).
5. **Agenda:** a Aria é a dona da agenda do carro (o motorista e você lançam ali também as corridas que entram por fora), ou um Google Calendar que a Aria lê.
6. **Espera e atraso:** hora extra a 85 € depois do incluído; atraso de voo além de 60 min cobrado como hora extra.
