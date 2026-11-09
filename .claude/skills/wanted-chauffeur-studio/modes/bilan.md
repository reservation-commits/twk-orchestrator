# Modo Bilan: o diário, o balanço e o plano da semana

É aqui que a skill deixa de adivinhar. Cada post publicado entra no diário; os números entram depois; o balanço diz
o que rende **nesta conta** e se a nota de gancho tem alguma relação com o resultado.

Neste repositório: `--dossier docs/estrategia/wanted-chauffeur` em todos os comandos abaixo.

## Registrar um post (no dia em que sai)

```bash
node outils/wc.js journal ajouter --accroche "Il ne savait pas qu'il y avait une PS5 dans la voiture" \
  --ecran "Nice · il ne savait pas" --format reel --personnage vice --pilier entree --ville Nice \
  --duree 14 --heure "9:00 PM" --date 2026-11-19
```

`--accroche` é a primeira frase, literal. `--personnage`: vice, fugitif, agent, partenaire, tatoue.
`--pilier`: entree, nuit, a-bord, coulisses, riviera. `--plateforme`: instagram (padrão), tiktok, youtube-shorts.
A ferramenta devolve o id do post (`P-20261119-01`).

## Pôr os números (48 horas e 7 dias depois)

A pessoa lê no painel da rede e dita ou cola. Você não entra na conta.

```bash
node outils/wc.js journal maj P-20261119-01 --vues 18400 --portee 15200 --partages 210 \
  --enregistrements 96 --commentaires 41 --abonnes 73 --leads 4
```

O diário só acrescenta linhas: a leitura de 48 h não some quando entra a de 7 dias. `--leads` é o número de pedidos
que chegaram por esta rede no período, pela referência `WTD-…` do funil; se o funil ainda não mede, deixe de fora.
Nunca estime um número que a pessoa não deu.

## Ler o balanço

```bash
node outils/wc.js bilan
```

- **Múltiplo:** visualizações do post divididas pela mediana da própria conta naquele formato. É o que ordena tudo.
- **Por fórmula, personagem, pilar, cidade e dia:** múltiplo mediano e `n`. Com `n` menor que 3, não conclua nada.
- **Taxas:** envios e salvamentos por mil de alcance dizem mais que visualização; seguidores por mil visualizações
  diz se o vídeo trouxe gente para a conta; pedidos por dez mil visualizações diz se trouxe cliente.
- **A nota de gancho prevê algo?** Só aparece com 20 posts medidos. Compara posts com cada controle alto e baixo.
  Controle sem diferença não mede nada nesta conta: diga isso e pare de usá-lo como argumento.

Ao relatar: o que rendeu, o que não rendeu, o tamanho da amostra, e **uma** mudança para a semana seguinte. É
correlação em amostra pequena; não escreva "o personagem X causa mais visualizações".

Lembre a regra do plano: viral é global, cliente é local. Um post com múltiplo alto e zero pedido é audiência, não
venda. Mostre as duas colunas.

## Plano da semana

1. Rode `bilan` e leia `veille.md`, se existir.
2. Monte os cinco pilares da semana (`voix.md`): um por dia útil, com fórmula, personagem e cidade.
3. Repita o que rendeu **uma** vez, com outra cena. Teste **uma** coisa nova. O resto segue o formato fixo.
4. Para cada dia: a ideia em uma frase, a fórmula, o que precisa existir antes de filmar (termo de imagem, carro
   parado, cidade), e quem aprova.
5. Fim de semana: o melhor vídeo recortado em versão de 60 s ou mais e um carrossel.

Entregue o plano em português para o fundador, com as frases em francês só onde forem o texto final.
