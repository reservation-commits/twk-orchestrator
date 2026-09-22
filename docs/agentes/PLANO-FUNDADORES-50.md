# Programa Fundadores 50 — o plano de ativação de estabelecimentos

> 2026-09-10 · trace `trc-agentes0902` · Sucede o PLANO-CHAVE-GIRADA (03/09), incorporando o que foi medido desde então. Tom da casa: fato × suposição × lacuna, sempre rotulado.

## 1. Diagnóstico — o que 20 dias de campanha mediram

| Fato | Número | Fonte |
|---|---|---|
| Restaurantes tocados por e-mail | 148 (185 envios, 21/08–05/09) | ledger `envios-fundadores-2026-08.csv` |
| Candidaturas geradas | 1 (ELEOS, 05/09) | `restaurant_invitations` |
| Contas reais de restaurante hoje | **0** | `restaurant_users` (limpo em 08–09/09) |
| Conversão do pitch de escassez ("42 vagas") | 148 → 0 | ledger + banco |
| Conversão do Extrato (reconhecimento + números da casa) | 11 → 1 em 13h (**9%**) | ledger + `restaurant_invitations` |
| Aceite de pedidos: parceiro × não-parceiro (30d) | 68% × 8% | snapshot Regência |
| Respondedores reais (≥3 pedidos/180d, responderam ≥1×) | 34 casas, 20 cidades | `alvos-2026-09-03.csv` |

**Leitura.** O funil perdeu três vezes por infraestrutura, não por mensagem: (1) candidatura aprovada sem e-mail de senha (caso ELEOS); (2) links corrompidos pelo canal de e-mail (defeito QP, corrigido 07/09); (3) Aria morta por créditos de API desde 06/09. As três estão resolvidas ou com solução conhecida. **A campanha, no sentido próprio, começa agora.** O único experimento com a porta aberta — o Extrato — deu 9% em 13h no segmento quente.

## 2. A tese

Nos marketplaces que venceram este mesmo problema (Airbnb, OpenTable, Uber Eats, DoorDash), a oferta nunca foi ativada por campanha: foi ativada **à mão, um a um, com a demanda como argumento e o esforço reduzido a um clique**, concentrando por cidade até existir prova social — e só então escalando por mensagem. É exatamente o que os nossos números pedem.

## 3. A oferta — real, escassa e verificável

Nada aqui exige inventar. Cada item é executável hoje ou está no brief do dev.

| Benefício do Fundador | Como se cumpre | Depende de |
|---|---|---|
| Selo **Founding Partner** na ficha pública | badge condicional (`db_restaurants.partner` + flag fundador) | dev (P2.1) |
| Prioridade na listagem da cidade por 12 meses | ordenação por flag | dev |
| **30 dias de "nós respondemos por você"** | Guardião + Aria cobrem as pendências enquanto o dono aprende o painel | já existe (Guardião) + créditos API |
| Linha de concierge no WhatsApp | número do time, resposta humana | fundador |
| Zero comissão para os 50 primeiros, para sempre | política comercial | decisão do fundador |

> **Versão final do plano de reserva direta (14/09, noite): `docs/agentes/plano-reserva-direta.html`.** As seções 3-bis e 3-ter abaixo são a memória de como se chegou lá; em caso de divergência, vale a versão final.

## 3-bis. Dois modelos de reserva — a porta para quem não responde

> Proposta de 2026-09-14 · trace `trc-reserva-direta-20260914` · **aguarda aprovação do fundador** (novo fluxo em operação). Documento de argumentação: `docs/agentes/reserva-direta-rastreada.html`.

**Fato (180 dias, casas publicadas, `reservations`):** 365 casas receberam pedidos. **311 nunca aceitaram nem recusaram nenhum**, e para elas foram **1.276 dos 2.091 pedidos (61%)**. Desses, 1.072 expiraram sem resposta, deixando 1.152 clientes sem mesa. Enquanto isso, casas de primeira linha respondem por e-mail que só reservam pelo próprio sistema: AI MERCANTI (prenota-web), AROMA (três vezes), LE PLONGEOIR, LES OMBRES (OpenTable), SHELLONA (SevenRooms), BIRDLAND ("We do not accept reservations through third parties"), LASAI, JUNGSIK, AL COVO. **Os movimentos abaixo cobrem as 54 casas que respondem; até aqui nada cobria as outras 311.**

| | Modelo 1 · Pedido TWK (hoje) | Modelo 2 · Reserva direta rastreada (novo) |
|---|---|---|
| Para quem | casa que responde (`confirma_pedidos`) ou que tem conta | casa que pediu, ou casa muda (≥4 pedidos em 90 dias e 0 respostas) **com meio de reserva verificado** |
| Fluxo | pedido → casa aceita/recusa → confirmação TWK | cliente escolhe data, horário e pessoas → botão **"Reserve direto com o estabelecimento"** → reserva registrada com código TWK e status próprio → abre o meio da casa já preenchido (WhatsApp/LINE com mensagem pronta no idioma da casa, página de reservas do site ou sistema com data e pessoas, ou ligação) → acompanhamento até a mesa |
| O que medimos | aceite, recusa, tempo de resposta | cada reserva pelo código: encaminhada → com o estabelecimento → confirmada (pelo cliente no e-mail ou pela casa na conta) → concluída (visita e avaliação) |
| Argumento de conversão | "responda com um toque" | **"fizemos o que vocês pediram: a nossa plataforma leva os clientes ao seu sistema"** |

**Ciclo profissional da reserva direta.**
- **Registro antes de sair.** Toda reserva direta tem código, meio usado, data, horário e pessoas. Não entra na fila de pendentes: o Guardião não cobra a casa e a Aria sabe que a confirmação vem do restaurante.
- **Acompanhamento do cliente por e-mail**, sem custo de mensagem:
  - "a casa confirmou?", respondido em um toque;
  - com o sim, seguem lembrete e pré-visita;
  - com o não, a Aria oferece na hora casas da mesma cidade que confirmam pedidos;
  - depois da data, "você foi?" e a avaliação.
- **Força do sinal, do mais forte ao mais fraco:**
  - a casa confirma na conta;
  - o cliente confirma no e-mail;
  - o cliente avalia depois da data;
  - o toque sozinho só mede intenção.
- **Nenhum dado pessoal repassado.** Quem envia a mensagem ou liga é o próprio cliente, do celular dele.
- **Extrato mensal à casa:** quantos clientes chegaram ao WhatsApp, ao site ou ao telefone dela pela TWK, e quantos foram. É o argumento da conta, onde a casa confirma essas reservas e controla o próprio meio, os horários e os fechamentos.
- **Verificação semanal do meio de cada casa.** Meio que falha volta a casa ao Modelo 1, com alerta. O botão nunca promete disponibilidade.

**Roteamento.** A regra é determinística, reavaliada toda semana e reversível, e usa o mesmo critério do Guardião:
- Sem meio de reserva verificado, a casa fica no Modelo 1 com o Guardião.
- A casa que passa a responder ou ativa a conta volta ao Modelo 1, se quiser.
- Casa com opt-out não tem página: nenhum dos modelos se aplica.

**Segmento novo na conversão: F · "Traga o seu sistema".** Destinado a casas que recusaram terceiros ou nunca responderam. Primeiro toque: **"fizemos o que vocês pediram: a nossa plataforma leva os clientes ao seu sistema"**. Na comunicação externa, o retorno da campanha de agosto é descrito como "muito lento".

**Piloto de 30 dias (suposição a medir, não promessa).** Casas com link de reserva verificado nos sites em 14/09:
- AI MERCANTI (prenota-web)
- LE PLONGEOIR
- LES OMBRES (OpenTable)
- SHELLONA Saint-Tropez (SevenRooms)
- JUNGSIK Seoul
- AL COVO
- BUCA MARIO
- GIGI Paris (telefone, informado na resposta da própria casa; 10 pedidos em 180 dias)

A AROMA, que pediu três vezes e recebeu 35 pedidos em 180 dias, entra quando o meio de reserva estiver confirmado. Os links são gravados pelo executor do DBA, com aprovação do fundador.

Na segunda semana, o piloto se amplia às 26 casas mudas com 10 ou mais pedidos. Elas concentram 675 pedidos, 53% dos que ficaram sem resposta, e o sistema de reservas de cada uma é verificado à mão.

Medimos:
- cliques no botão;
- mesas declaradas pelo cliente;
- mensagens "sem resposta" à Aria sobre essas casas;
- respostas das casas e contas abertas.

**Critério de morte:** se em 30 dias nenhum cliente clicar ou nenhum declarar mesa, o botão sai e as casas voltam ao Modelo 1.

## 3-ter. Reserva direta, versão otimizada (14/09, noite)

> Análise completa e referências em `docs/agentes/dossie-reserva-direta.html`. Benchmarks: Google (roteia, não opera), OpenTable e Tabelog (cobram por cliente sentado; Tabelog só se comparece), Resy (mensalidade fixa, Notify), SevenRooms (a casa é dona dos dados), concierges premium (confirmam por telefone).

Dez mudanças sobre a seção 3-bis:
1. **Confirmação em 4 camadas**, da mais forte à mais fraca: sistema da casa/afiliados → casa na conta → cliente no e-mail → avaliação pós-visita. Só 1, 2 ou 4 fecham a reserva como concluída; 3 vale como "mesa provável".
2. **Unidade cobrável = reserva concluída** (cliente sentado). Piloto sem cobrança. Afiliação (OpenTable, TheFork, Quandoo) onde a casa usa esses sistemas: condições a confirmar antes de projetar receita.
3. **Grupo de controle aleatório** (50/50) entre casas mudas com meio verificado que não pediram; quem pediu recebe o botão sem sorteio. Base: 8% de aceite nas casas sem conta.
4. **Meios em 4 níveis**: A sistema integrado com link pré-preenchido · B página de reservas do site · C WhatsApp/LINE com mensagem pronta · D telefone. Robô testa A e B todo dia; C e D confirmados com a casa a cada 30 dias. Meio que falha volta a casa ao Modelo 1 na hora, com alerta.
5. **Roteador com histerese**: entra com ≥4 pedidos/90d, 0 respostas e meio verificado, ou pedido explícito; sai com 2 respostas/30d ou conta ativada. Calculado todo dia, aplicado às segundas.
6. **Nenhum dado pessoal em link**: data, horário, pessoas, origem TWK e código. O nome, o cliente digita.
7. **Ao "não"**: alternativas só de casas `confirma_pedidos` na mesma cidade + lista "avise-me se abrir" (fase 2, exige dev).
8. **Faixa assistida** (≥6 pessoas, corporativo, casa premiada): o Guardião confirma por telefone/WhatsApp em nome do cliente. Prazo interno de 4h úteis, medido na Regência, **nunca prometido ao cliente** (ADR-015). Exige decidir quem atende.
9. **Conversão por telefone, 26 casas primeiro**: as mudas com ≥10 pedidos somam 675 pedidos (53% do que ficou sem resposta); todas têm telefone no catálogo, 8 só têm rede social. Lagos concentra 13 casas e 286 pedidos (22%). Ligação com a frase oficial → extrato de reservas diretas por e-mail 48h depois → conta como painel para confirmar.
10. **Operação como serviço**: eventos com código e trace_id; painel diário no Despacho (encaminhadas, com o estabelecimento, confirmadas, concluídas, meios com falha); SLO de 99% dos dias com meios verificados; desligar em um comando.

**Metas de 30 dias (suposições calibráveis) e morte (fixa):** ≥25% das reservas diretas confirmadas pela camada 1, 2 ou 4; −50% de mensagens "sem resposta" à Aria sobre as casas do piloto; ≥3 das 26 casas com conta. **Morte:** <8% confirmadas ou nenhuma concluída → botão sai, casas voltam ao Modelo 1.

**Não copiar:** cobrança por clique; disponibilidade que não vem do sistema da casa; sugerir parceria com provedores; mensagem em nome do cliente; comissão sem contrato; prazo prometido ao cliente.

## 4. A mecânica — quatro movimentos

### Movimento 1 · Operação Lagos (semanas 1–2) — a cidade-prova
Lagos é a cidade mais densa do radar: **6 casas** (SCARTUCCIO 69979, LUCA'S 69845, REPOLHO 69843 — confirmadoras; MY SUSHI 70083, VENEZA 70345, DOM VINHO 70463 — ocasionais), todas em português, o idioma do time. Meta: **4 fundadores em Lagos em 14 dias.**
- **Chave pré-girada** para as 6: token em `restaurant_invitations` emitido pelo backoffice, link pessoal → tela de senha. Um clique. (Hoje o `/register` exige código no e-mail da listagem — que em muitas casas é caixa genérica ou inválida: `contatos-invalidos-*.csv`. É o atrito escondido nº 1.)
- Sequência por casa: Extrato com os números dela (e-mail, rastreado) → 48h depois WhatsApp em texto pelo fundador (`whatsapp-confirmadores.md`) → resposta traduzida e redigida pelo MAESTRO → link pré-girado no WhatsApp.
- Ao 3º fundador de Lagos: gravar a prova social (uma frase deles, com permissão) para o Movimento 3.

### Movimento 2 · Demanda como gatilho (contínuo, automático)
Cada pedido real leva o cartão "Activate my key" (fluxos 1/2/3, desde 09/09, rastreado). Cada pendência ≥24h dispara o e-mail do Guardião com o mesmo cartão (46 casas prontas). É o e-mail de maior intenção que existe e sai sozinho.

### Movimento 3 · Sequência de 5 toques em 21 dias para os 34 respondedores
Um canal por vez; cada toque com valor distinto; nunca repetir o mesmo argumento.

| Dia | Toque | Canal | Argumento |
|---|---|---|---|
| 0 | Extrato | e-mail | os números deles (feito para 19; 12 D-ocasionais a enviar) |
| 2 | Mensagem 1 | WhatsApp (fundador) | "posso ativar agora com você?" |
| 7 | Prova social | e-mail | "X casas de Lagos já giraram a chave" + citação |
| 12 | Chave pré-girada | e-mail + WhatsApp | link pessoal, um clique |
| 21 | Fechamento da coorte | e-mail | data real de fechamento dos 50 (escassez verdadeira) |

Regras: máx. 40 envios/dia; opt-out consultado antes de todo lote; aprovação do fundador por lote; template novo só após teste na caixa dele.

### Movimento 4 · Expansão por cidade (semanas 3–8)
Atenas (ATHÉNÉE, PAPADAKIS), Roma (GIRARROSTO, IL SANLORENZO, Hamasei, AL MORO), Lisboa (Menina Sardinha), Milão (BICE, Salumaio) — levando a prova social de Lagos. Só depois: as ~110 casas das coortes, com o formato que tiver medido melhor.

## 5. Medição — o funil semanal (agora possível)

`enviado → clicou (/go: extrato-*, guardiao, notif-*, resposta-*) → reivindicou (restaurant_invitations) → senha criada (restaurant_users) → primeira resposta pelo painel (modified_by)`.
Descontar cliques de scanner (chegam em pares, segundos após o envio).

| Meta | 14 dias | 30 dias | 60 dias |
|---|---|---|---|
| Fundadores em Lagos | 4 | 5 | 6 |
| Contas reais (total) | 6 | **10–17 dos 34** | **50** |
| Aceite médio das casas com conta | — | ≥60% | ≥65% |

Referência de mercado (suposição informada): frio B2B para pequenos negócios 1–3%; concierge em segmento quente 30–50%. As metas acima estão dentro disso.

**Critério de morte:** 14 dias de Operação Lagos com chave pré-girada + WhatsApp e **zero** fundadores → o problema não é ativação, é proposta de valor; parar e ouvir os 6 donos antes de escrever mais.

## 6. Pré-requisitos — o que não é meu

| Item | Dono | Bloqueia |
|---|---|---|
| Chave pré-girada (`?claim=<token>` / emissão de convite por casa) | dev (era P2.2, vira **P0**) | Movimentos 1 e 3 |
| Créditos da API (Aria viva) | fundador | "nós respondemos por você" |
| Selo Founding Partner + prioridade | dev | oferta visível |
| WhatsApp de Lagos (6 conversas) | fundador | Movimento 1 |
| Reaprovação do ELEOS + lote do Guardião | fundador | Onda 0/1 |
| Botão "Reserve direto com o estabelecimento" com o seletor de data/horário/pessoas; meio de reserva por casa (tipo: site, WhatsApp, LINE, telefone + destino; `booking_url` já existe, falta o tipo, que é DDL); registro da reserva direta com código e status próprio, fora da fila de pendentes; link rastreado só para o destino gravado da própria casa (nunca redirecionamento aberto) | dev (DDL com aprovação do fundador) | Modelo 2 / segmento F |
| Destino do `/go` para `/register`: hoje abre a tela de login, e os passos dos e-mails mandam escolher uma opção que só existe no cadastro | dev / n8n (aprovação do fundador) | todos os movimentos |
| Aprovação do piloto do Modelo 2 e posição de receita sobre reserva externa | fundador | Modelo 2 |

## 7. O que eu faço sozinho, a partir de agora
Extratos rastreados para os 12 D-ocasionais e para as 6 de Lagos (regeneração com `/go`); os 5 textos da sequência em PT/EN/FR/IT/ES; a fila diária de envios com aprovação por lote; o funil semanal no Despacho; e a revisão dos textos de WhatsApp de Lagos para o fundador colar.
