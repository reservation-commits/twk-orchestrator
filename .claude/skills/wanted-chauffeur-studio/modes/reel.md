# Modo Reel: da ideia ao roteiro medido

Um Reel desta conta tem **três ganchos que disparam juntos**, e não são a mesma frase:

1. **A imagem de abertura.** Nesta conta, quase sempre a porta Falcon abrindo. É o que para o dedo.
2. **O texto na tela.** Lido antes de a fala ser ouvida. Seis palavras ou menos, com a cidade.
3. **A primeira fala.** Até 3 segundos. Em pilares sem fala (terça, o carro à noite), não existe: a tela carrega tudo.

## Passo a passo

1. **Entenda a ideia.** Qual pilar da semana (`voix.md`), qual personagem, qual cidade, que fato concreto existe
   (um número, uma reação, um objeto). Se faltar o fato, pergunte antes de escrever. Uma pergunta só, agrupada.
2. **Escolha três fórmulas diferentes** em `donnees/formules.json`. Leia o campo `rate` de cada uma: é como ela
   costuma ser estragada. Se já existe `veille.md` ou `bilan`, prefira as fórmulas que estão rendendo lá.
3. **Escreva três opções**, uma por linha, no formato `fala | texto de tela`, e grave em arquivo.
4. **Meça:** `node outils/wc.js accroche ganchos.txt`. Reescreva o que veio `FRACA` ou `BLOQUEADA`. Duas rodadas é
   normal. Cinco quer dizer que a ideia não tem gancho: volte ao passo 1.
5. **Roteiro** da opção escolhida pela pessoa (ou das duas melhores, se ela não escolheu). Formato do arquivo:

   ```
   > Nice · 9:00 PM                          ← texto de tela (linha com ">", não conta tempo)
   (1.5s) porte Falcon qui s'ouvre           ← plano sem fala, com a duração entre parênteses
   Il ne savait pas qu'il y avait une PS5.   ← fala
   ```

6. **Meça o roteiro:** `node outils/wc.js minutage roteiro.txt --cible 20`. Corrija cada aviso ou diga por que fica.
7. **Legenda:** siga `modes/legende.md`.
8. **Entregue** no formato de `SKILL.md`: francês, tradução, medida, e a lista de filmagem (planos, quem aparece,
   se precisa de termo de imagem).

## O que a medida olha

| Controle | O que mede | Como subir |
|---|---|---|
| `entree` | começa na coisa, sem saudação nem preâmbulo | corte até a primeira palavra que importa |
| `concret` | número, lugar, objeto, nome próprio | troque o adjetivo por um fato |
| `lieu` | cidade na fala ou na tela | ponha a cidade na tela: custa duas palavras |
| `duree` | fala de até 3 s | corte palavras; ajuste `--mpm` ao ritmo real do Julien |
| `tension` | negação, contraste, pergunta, algo em jogo | diga o que a pessoa não sabia ou o que quase deu errado |
| `ecran` | texto de tela curto e diferente da fala | seis palavras, sem ponto final |

Nota = 60% da média + 40% do controle mais fraco, porque um defeito basta para perder o espectador.

**Diga com honestidade:** são verificações de superfície, sem dados desta conta ainda. Elas pegam gancho ruim. Entre
dois ganchos bons, não sabem qual vai viajar: isso depende da imagem, do som, da edição e de quem a rede escolhe
mostrar. Depois de 20 posts registrados, `bilan` diz quais controles têm relação com resultado **nesta** conta.

## Cuidados de filmagem que mudam o roteiro

- O motorista não filma, não joga e não vê a tela. Toda cena a bordo é de câmera fixa.
- LEDs acesos só com o carro parado e a porta aberta. É a cena de abertura, não uma cena em movimento.
- Passageiro só aparece com termo de imagem assinado. Sem termo: de costas ou desfocado. Escreva isso na lista de
  filmagem.
- A tela do jogo aparece de relance, sem logo em destaque. O vídeo mostra a reação e o carro.
- Som: tema original ou biblioteca comercial da rede. Não escreva roteiro que dependa de uma música famosa.
