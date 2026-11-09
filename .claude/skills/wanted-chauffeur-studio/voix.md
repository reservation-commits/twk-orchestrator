# voix.md — a voz do Wanted Chauffeur

Fonte: plano de 09/11/2026 (`docs/estrategia/plano-night-ride-gta6-2026-11-09.html`) e decisões do fundador no mesmo
dia. Rótulos da casa: **FATO** (está no plano ou foi decidido), **PROPOSTA** (sugestão ainda sem decisão),
**A CONFIRMAR** (ninguém conferiu). Este arquivo é para ser editado: quando o fundador decidir, troque o rótulo.

## O que é

- **FATO** Um Tesla Model X na Côte d'Azur, com PS5 a bordo, teto estrelado e LEDs nas portas, e um chauffeur (Julien)
  que troca de personagem. Projeto da The World Keys.
- **FATO** Conta: `@wantedchauffeur`, o mesmo nome em Instagram, TikTok, YouTube e Twitch. **A CONFIRMAR** a
  disponibilidade do nome nos quatro.
- **FATO** Promessa: **« Vous jouez. On conduit. »** A mesma frase em toda bio, capa e último segundo de vídeo.
- **FATO** O que o carro vende, nesta ordem: a entrada (porta Falcon abrindo), o tempo a bordo, o destino.

## Idioma

- **FATO** (fundador, 09/11) A conta publica em **francês**.
- **FATO** (fundador, 09/11) Texto de tela em **francês**. O plano previa inglês para turistas; decidiu-se que cidade e
  hora na tela (« NICE · 9 PM ») se leem em qualquer idioma e a legenda do Instagram traduz sozinha. Cliente é local.
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

Grupos de amigos (4 a 6, noite em Nice, Cannes e Mônaco), turistas que reservam com semanas de antecedência, empresas
e eventos, hotéis e conciergeries. O conteúdo desta conta fala com os dois primeiros. Viral é global, cliente é local:
**todo vídeo diz a cidade nos dois primeiros segundos.**

## Como soa

- Frases curtas, ditas em voz alta sem tropeçar. Se o Julien não diria assim, é retomada, não rascunho.
- Concreto antes de bonito: « 82 euros chacun », « la porte Falcon », « Monte-Carlo, minuit ». Nunca « une expérience
  unique ».
- Humor seco e honesto. O enjoo, a regra dos 10 minutos e a limpeza depois da noite fazem parte da história.
- Preço por pessoa, não por quilômetro. Vende-se o tempo a bordo.
- Um pedido por peça. O caminho é: vídeo → link na bio → página `/ride` → WhatsApp.
- Emoji: **PROPOSTA** nenhum ou um, no fim. Nunca como marcador de lista.

Palavras do projeto: Night Ride, Game Night, Soirée, Wanted Live, porte Falcon, ciel étoilé, à bord, la Riviera.
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
| sexta | A noite na Riviera: o destino | 15 a 30 s | `riviera` |

Formato fixo da série **Night Ride #N**: 0–1 s porta Falcon abrindo com a cidade na tela · 1–4 s a reação, sem corte ·
4–12 s o momento a bordo · último segundo « Vous jouez. On conduit. » + @wantedchauffeur.

## Produtos e preços (PROPOSTA de 09/11, ainda sem aprovação do fundador)

Transfer Experience 150 € (25 € por pessoa) · Night Ride 2 h 350 € (58 €) · Game Night 3 h 490 € (82 €) ·
Soirée 390 € + jantar (65 € + jantar) · Dia inteiro 750 € (125 €). Por pessoa considera 6 passageiros. Sempre TTC.
Até a aprovação, toda peça com preço sai marcada para conferência.

Regras de bordo que fazem parte do produto: cinto afivelado para jogar; só maiores de 18 jogam; o motorista nunca vê
a tela; sem álcool a bordo; pausa de 10 minutos se alguém enjoar.

## O que nunca aparece

A lista completa, com o motivo de cada uma, está em `donnees/garde-fous.json` e é conferida pela ferramenta. As que
mais pesam: a marca do jogo só na fala e na legenda, nunca na tela, na capa, na bio ou no nome; nenhum recorde
"do mundo"; nada de pegar passageiro sem reserva; LEDs só com o carro parado; motorista nunca filma nem joga; rosto
de passageiro só com termo assinado; nenhuma música famosa.
