# voix.md — a voz do Wanted Chauffeur

Fonte: plano v4 de 16/11/2026 (`docs/estrategia/plano-wanted-chauffeur-toulouse-2026-11-16.html`, aprovado pelo
fundador), que substitui o plano de 09/11 (`docs/estrategia/plano-night-ride-gta6-2026-11-09.html`) no que diz respeito
a cidade, preços e datas; a voz, os personagens e as travas vêm do plano de 09/11 e continuam valendo. Rótulos da casa:
**FATO** (está no plano ou foi decidido), **PROPOSTA** (sugestão ainda sem decisão), **A CONFIRMAR** (ninguém conferiu).
Este arquivo é para ser editado: quando o fundador decidir, troque o rótulo.

## O que é

- **FATO** (fundador, 16/11) Um Tesla Model X em **Toulouse**, com PS5 a bordo, teto estrelado e LEDs nas portas, e um
  chauffeur (Julien) que troca de personagem. Projeto da The World Keys. Até 16/11 o plano era a Côte d'Azur (plano de 09/11);
  nada da Riviera entra no conteúdo.
- **FATO** Conta: `@wantedchauffeur`, o mesmo nome em Instagram, TikTok, YouTube e Twitch. **A CONFIRMAR** a
  disponibilidade do nome nos quatro.
- **FATO** Promessa: **« Vous jouez. On conduit. »** A mesma frase em toda bio, capa e último segundo de vídeo.
- **FATO** O que o carro vende, nesta ordem: a entrada (porta Falcon abrindo), o tempo a bordo, o destino.

## Idioma

- **FATO** (fundador, 09/11) A conta publica em **francês**.
- **FATO** (fundador, 09/11) Texto de tela em **francês**. O plano previa inglês para turistas; decidiu-se que cidade e
  hora na tela (« TOULOUSE · 9:00 PM ») se leem em qualquer idioma e a legenda do Instagram traduz sozinha. Cliente é local.
- **FATO** (fundador, 09/11) Tratamento em **dois registros**:
  - **« tu »** em todo o conteúdo: Reels, legendas, stories, carrosséis, bio, respostas a comentários e DM de quem
    quer reservar. É a norma do nicho (carros, gaming, noite) e cabe num gancho de 3 segundos.
  - **« vous »** no comercial: DM a marcas, hotéis, conciergeries e parceiros; texto da página `/ride`; mensagens de
    reserva no WhatsApp. Quem paga 350 € quer sentir uma empresa atrás.
  - A promessa « Vous jouez. On conduit. » usa « vous » de plural (o grupo) e convive com o « tu ».
- **FATO** Hora sempre em AM/PM: « 9:00 PM », nunca « 21h ». Duração pode ser em horas (« 3 h à bord »).
- **FATO** (fundador, 09/11) Ritmo de fala de referência: **190 palavras por minuto**, usado pela ferramenta
  (`--mpm`). É uma estimativa até alguém cronometrar o Julien lendo um roteiro de 30 segundos; quando isso acontecer,
  troque o número aqui e no padrão de `outils/wc.js`.

## Para quem

Grupos de amigos de Toulouse (4 a 6, noite no Capitole, nos Carmes, em Saint-Cyprien), executivos da aviação (Airbus,
Aeromart, MEETT), torcedores do Stade Toulousain em dia de jogo (Ernest-Wallon, Stadium), hotéis 4★ do centro e seus
concierges, e os clientes privados que o Julien já tem. O conteúdo desta conta fala com os dois primeiros e com os
torcedores; hotéis e concierges recebem tabela e mensagem, não Reels. Viral é global, cliente é local: **todo vídeo
escreve TOULOUSE na tela nos dois primeiros segundos.**

## Como soa

- Frases curtas, ditas em voz alta sem tropeçar. Se o Julien não diria assim, é retomada, não rascunho.
- Concreto antes de bonito: « 58 euros chacun », « la porte Falcon », « place du Capitole, minuit ». Nunca « une
  expérience unique ».
- Humor seco e honesto. O enjoo, a regra dos 10 minutos e a limpeza depois da noite fazem parte da história.
- Preço por pessoa, não por quilômetro. Vende-se o tempo a bordo.
- Um pedido por peça. O caminho (FATO, plano v4) é: vídeo → link no perfil → `theworldkeys.com/ride` → WhatsApp com a
  mensagem já escrita, o código de origem e « Réservation au nom de <quem embarca> ». O código diz de onde veio o
  pedido: `WTD-T-xxxx` TikTok, `I` Instagram, `Y` YouTube, `W` Twitch, `H` hotel, `S` site. Nunca número de telefone
  solto no texto: o link mantém a origem.
- Emoji: **PROPOSTA** nenhum ou um, no fim. Nunca como marcador de lista.

Palavras do projeto: Night Ride, Game Night, Soirée, Noël Ride, Match Day, Wanted Live, porte Falcon, ciel étoilé,
à bord, la Ville rose.
Palavras que não usamos: expérience unique, inoubliable, incontournable, luxe absolu, haut de gamme, premier au monde.

## Personagens (nomes em francês: FATO, fundador 09/11)

| Personagem | Roupa | Onde entra | Limite |
|---|---|---|---|
| Le Vice | terno azul-claro, camisa rosa | toda corrida paga; carro à noite | nenhum; é o uniforme da marca |
| Le Fugitif | uniforme laranja de detento | esquetes com o carro parado, abertura das lives | só para a câmera; nunca buscar cliente assim |
| L'Agent | agente do FBI | procura o Fugitivo; interroga passageiros | FBI evidente; sem distintivo exibido, sem arma, sem sirene |
| Le Partenaire | regata, bandana, correntes | anfitrião das Game Nights | sem sinais de gangue, sem sotaque imitado |
| Le Tatoué | sem camisa, tatuado | praia, treino, bastidores | só em gravação; fora de qualquer peça B2B |

O Fugitivo e o Agente nunca aparecem juntos: são a mesma pessoa, e essa é a piada da série.

## Pilares da semana (FATO, do plano)

| Dia | Pilar | Duração | `--pilier` |
|---|---|---|---|
| segunda | A entrada: reações à porta, ao teto, à tela | 7 a 15 s | `entree` |
| terça | O carro à noite: exterior, sem fala | 10 a 20 s | `nuit` |
| quarta | A bordo: jogo, conversa, enjoo | 20 a 45 s | `a-bord` |
| quinta | Bastidores: instalação, limpeza, carga | 30 a 60 s | `coulisses` |
| sexta | A noite em Toulouse: o destino | 15 a 30 s | `toulouse` |

Formato fixo da série **Night Ride #N**: 0–1 s porta Falcon abrindo com a cidade na tela · 1–4 s a reação, sem corte ·
4–12 s o momento a bordo · último segundo « Vous jouez. On conduit. » + @wantedchauffeur.

**Vídeo diário (FATO, plano v4 de 16/11):** um vídeo por dia, de **12 segundos**, com **« TOULOUSE » escrito na tela nos
2 primeiros segundos**, a tarja `@wantedchauffeur` e a frase final « Vous jouez. On conduit. ». Três cenas bastam;
o Julien filma 10 minutos por dia com câmeras fixas e, se os LEDs aparecem, o carro está parado. Publicação às 7:00 PM
do dia seguinte.

## Produtos e preços (FATO, fundador 16/11)

TTC, por carro, até 6 passageiros; por pessoa considera 6. **Abaixo desses valores a corrida não é aceita.**

| Produto | O que é | Preço | Por pessoa |
|---|---|---|---|
| Transfer | aeroporto de Blagnac ↔ centro, ou MEETT | 80 € | 13 € |
| Mise à disposition | por hora, mínimo 2 h, cidade e arredores | 90 €/h | 15 €/h |
| Night Ride | 1 h pela cidade iluminada, até 2 paradas | 250 € | 42 € |
| Game Night | 3 h, PS5, 2 manettes, bebidas sem álcool | 350 € | 58 € |
| Soirée | ida + espera de 4 h + volta, com mesa no restaurante | 390 € + jantar | 65 € + jantar |

Ofertas por data usam a mesma tabela: Noël Ride = Night Ride (250 €), Match Day = mise à disposition (90 €/h),
transfer da Aeromart = Transfer (80 €). A ferramenta (`garde`) alerta todo preço citado e marca o que está fora da tabela.

## As datas (FATO, plano v4)

| Data | O que acontece | O que vendemos |
|---|---|---|
| 19/11 | GTA 6 sai | vídeo do jogo chegando ao carro: « Il est arrivé. Première Game Night mardi, à Toulouse. » |
| terça 24/11, 9:00 PM | primeira Game Night filmada em Toulouse | vídeo de lançamento da conta |
| 26/11 a 27/12 | Marché de Noël do Capitole | Noël Ride, 1 h pelas luzes, 250 € |
| 1 a 3/12 | Aeromart no MEETT | transfers aeroporto ↔ feira ↔ hotel, 80 € |
| 05/12 e 26/12 | Stade Toulousain × Racing 92 · × Toulon, no Ernest-Wallon | Match Day: hotel → estádio → jantar, 90 €/h |

Fontes das datas, segundo o plano: Toulouse Tourisme, calendário do Stade Toulousain, EventsEye (Aeromart, sujeita a
mudança). Confirmar a data na véspera de qualquer peça que a cite.

Regras de bordo que fazem parte do produto: cinto afivelado para jogar; só maiores de 18 jogam; o motorista nunca vê
a tela; sem álcool a bordo; pausa de 10 minutos se alguém enjoar.

## O que nunca aparece

A lista completa, com o motivo de cada uma, está em `donnees/garde-fous.json` e é conferida pela ferramenta. As que
mais pesam: a marca do jogo só na fala e na legenda, nunca na tela, na capa, na bio ou no nome; nenhum recorde
"do mundo" (só « la seule voiture de Toulouse où… »); nada de pegar passageiro sem reserva (WhatsApp, mesmo 10 minutos
antes); LEDs só com o carro parado; motorista nunca filma, joga nem vê a tela; rosto de passageiro só com termo
assinado (QR no encosto); sem álcool a bordo; hora sempre AM/PM; nenhuma música famosa.
