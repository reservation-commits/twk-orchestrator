# Modo Legenda, carrossel, story e bio

## Legenda

O feed mostra cerca de 125 caracteres e esconde o resto atrás de « … plus ». Quase toda legenda que falha, falha ali.

1. **Primeira linha:** a ideia inteira, com um fato concreto e a cidade, dentro do trecho visível.
2. **Corpo:** curto. O que o vídeo não mostrou: o preço por pessoa, a regra, o bastidor.
3. **Um pedido só**, ligado ao vídeo. O caminho medido é « lien en bio ». Não some pedidos.
4. **Hashtags no fim**, até o teto da rede (`donnees/plateformes.json`), com a cidade e o nome da conta.
5. **Meça:** `node outils/wc.js legende legenda.txt --mots-cles "chauffeur privé Nice,soirée jeux"`.
   As palavras de busca são o que alguém digitaria para achar isto: cidade + serviço.
6. Com `--corriger`, a ferramenta devolve o texto com a tipografia francesa: espaço antes de `?` `!` `;` `:` e sem
   caracteres invisíveis. Entregue essa versão.

A ferramenta **aponta** clichês e tiques e não reescreve: em francês, trocar palavra por palavra quebra gênero e
elisão. Reescreva cada frase apontada mantendo o sentido, e rode de novo.

Outras redes: `--plateforme tiktok` ou `--plateforme youtube-shorts` (no Shorts, a "legenda" é o título).

## Carrossel

- **Capa:** uma frase que promete o que está no último slide. Vale o mesmo que um gancho: meça com `accroche`,
  pondo o texto da capa dos dois lados (`capa | capa`) e ignorando o aviso de tela igual à fala.
- **Slides:** uma ideia por slide, até 20 palavras, 5 a 8 slides. O último entrega o que a capa prometeu.
- **Formato:** 1080 × 1350. Paleta do projeto: preto acetinado com roxo, rosa e azul-claro. Capas em painéis de
  história em quadrinhos com traço próprio; nunca a fonte, o logo ou o minimapa do jogo.
- Texto de cada slide passa por `node outils/wc.js garde slide.txt --contexte ecran`: na imagem, a marca do jogo
  é bloqueio.

## Story

Sequência do dia, 3 a 5 quadros: (1) o que está acontecendo agora, com a cidade; (2) o detalhe; (3) uma pergunta
respondível em uma palavra, com a figurinha certa (enquete para escolha, caixa para pergunta aberta); (4) o caminho:
« lien en bio ». Não prometa horário de disponibilidade. Story com passageiro segue a regra do termo de imagem.

## Bio

`node outils/wc.js legende bio.txt --type bio`. Até 150 caracteres. Três linhas: o que é, onde, o próximo passo.
A promessa « Vous jouez. On conduit. » entra inteira. « by The World Keys » identifica a casa. Sem a marca do jogo,
sem número de telefone (o link da bio é a página `/ride`, que registra de onde veio o pedido).
