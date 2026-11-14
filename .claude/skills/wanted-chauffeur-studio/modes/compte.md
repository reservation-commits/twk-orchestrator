# Modo Conta: os números reais do @wantedchauffeur

O Olheiro do Instagram lê a conta uma vez por dia, pela API oficial da Meta e só para leitura. O que ele leu chega
ao chat pelo conector **COMPASSO Tarefas**, nas ferramentas `instagram_*`. Use-as antes de dizer qualquer coisa
sobre desempenho: número de memória ou estimado não entra em resposta.

| Pergunta | Ferramenta |
|---|---|
| « Comment va le compte ? », « como estamos? », « o que funcionou? » | `instagram_painel` |
| « Montre-moi les vidéos du mois », « qual vídeo foi melhor? » | `instagram_posts` (`dias`, `ordem`) |
| « Fais le bilan », « plano da semana » | `instagram_diario` e depois o `bilan` da ferramenta |
| « Qui attend une réponse ? », « comentários para responder » | `instagram_comentarios` |
| « Cette vidéo, c'était le pilier nuit avec Le Vice » | `instagram_anotar` |

## Sempre

- **Diga a data da leitura.** O painel traz `atualizado_em`. Uma leitura de ontem às 9:00 AM não sabe do vídeo de
  hoje à noite.
- **Lacuna é lacuna.** O que veio em "Não lido nesta rodada" é dito como tal. Público por cidade só aparece a partir
  de 100 seguidores. Contas de referência só com o login pelo Facebook.
- **Múltiplo antes de número bruto.** "2,8× a mediana" diz mais que "5.000 vues" numa conta pequena.
- **Referências são curtidas**, não visualizações: a Meta não mostra as visualizações de outras contas.

## O balanço com os números reais

1. Chame `instagram_diario`. O texto é o diário inteiro, uma linha JSON por post, já no formato da ferramenta.
2. Grave esse texto como `journal.jsonl` numa pasta de trabalho.
3. Rode `node outils/wc.js bilan --dossier <essa pasta>` e leia como manda `modes/bilan.md`.

Os posts do Olheiro têm id `IG-…`. Os posts registrados à mão continuam com `P-…`. Não registre à mão um post que já
está no diário automático: ele contaria duas vezes.

## Anotar

O Olheiro tira da legenda o gancho, a cidade e o personagem quando estão escritos. O **pilar**, o **texto de tela**
e o personagem que só aparece na imagem ninguém lê sozinho: pergunte e anote com `instagram_anotar`. Sem isso, o
balanço por pilar fica vazio. Pilares: `entree`, `nuit`, `a-bord`, `coulisses`, `riviera`.

## Alertas

- **DECOLANDO:** um Reel com 2× ou mais a mediana dos outros na mesma idade. Proponha a continuação para gravar em
  48 h: mesmo gancho, outra cena, mesma cidade na tela. Escreva o roteiro com `modes/reel.md`.
- **ABAIXO:** metade da mediana depois de 48 h. Não repita o gancho. Compare com o melhor do mês.
- **SEGUIDORES:** ganho fora do normal. Descubra qual post puxou e sugira fixá-lo no topo do perfil.

## O que este modo não faz

Não publica, não responde comentário, não manda DM e não mexe no perfil. A conta é do Julien, no celular. Se alguém
pedir para "responder direto" ou "postar pela API", explique que esta fase só lê e que escrever na conta é decisão
do fundador.
