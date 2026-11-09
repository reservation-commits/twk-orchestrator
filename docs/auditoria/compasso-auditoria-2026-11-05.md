# COMPASSO: auditoria e reconstrução (05/11/2026)

Rotulagem da casa: **FATO** (medido nesta sessão) · **JULGAMENTO** (opinião declarada) · **LACUNA** (não deu para verificar).

## Veredito

O COMPASSO 0.4.0 tinha boa alma e fundação frágil. A ideia estava certa: simples, ligado aos sinais da operação, com conector para o Claude. Mas perdia trabalho em silêncio em pelo menos quatro situações, podia ser derrubado por uma única requisição sem login, abria num quadro em vez de abrir na decisão, e era invisível para quem recebia a tarefa.

A 1.0 troca a fundação e a interface, sem acrescentar telas além de "Hoje". Falta uma coisa que código não resolve: **ninguém usa ainda**. Produção tem 6 cards, 4 deles `[TESTE]`, todos pelo login `admin`. O próximo salto é de adoção e depende de decisões do fundador (fim deste documento).

| Dimensão (JULGAMENTO, 0 a 10) | 0.4.0 | 1.0 | O que mudou |
|---|---|---|---|
| Confiança nos dados | 3 | 9 | ledger primeiro, recuperação, conflito, histórico completo |
| Velocidade percebida | 4 | 9 | ação otimista, tempo real, arquivos comprimidos e com cache |
| Foco ("o que faço agora?") | 3 | 9 | abre em Hoje, com a próxima etapa em cada linha |
| Captura | 4 | 9 | frase vira card em qualquer tela, com prévia ao vivo |
| Colaboração | 2 | 7 | comentários, menções, novidades, tempo real; falta avisar fora do app |
| Celular | 3 | 8 | barra inferior, menu no lugar de arrastar, instalável |
| Inteligência | 5 | 8 | leitor de frases, perguntas ao quadro, sugestões que chegam antes |
| Segurança | 6 | 9 | freio, tokens separados, cabeçalhos, destino do OAuth |
| Adoção real | 1 | 1 | **não muda com código: ver decisões** |

## O que foi medido

Tudo em pasta temporária; produção só foi lida. Notebook de 2 núcleos, então os tempos absolutos são pessimistas: vale a comparação.

### Bugs que perdiam ou falsificavam dado

| # | Achado (FATO, reproduzido) | Antes | Agora |
|---|---|---|---|
| 1 | `tarefas.json` cortado pela metade (disco cheio, queda) | abria **vazio**, sem aviso; o primeiro card sobrescrevia tudo; a cópia do dia era pisada pelo arquivo quebrado | guarda o arquivo como prova, reconstrói de cópia + ledger, avisa no `/health`, no log e à Regência; sem nada para reconstruir, 503 com o motivo |
| 2 | Chat: clicar em "Criar card" da primeira de duas propostas | criava o card **da segunda** | cada proposta tem o próprio id |
| 3 | Marcar etapa ou escrever nota e fechar a gaveta | **perdia** sem perguntar | tudo salva sozinho, campo a campo |
| 4 | Duas pessoas no mesmo card | o último apagava o trabalho do outro, sem aviso | campos diferentes se somam; mesmo campo devolve 409 com o valor atual; etapas diferentes nunca conflitam |
| 5 | Mudar prioridade, cidade, canal, referência, resultado | **nenhum evento** no "ledger" | todo campo, com de e para |
| 6 | "Hoje" em UTC, a empresa em Paris | das 23h à 00h (inverno), "ligar hoje" nascia atrasada | dia de Paris em tudo |
| 7 | Arquivar uma tarefa concluída | o KPI "concluídas em 7 dias" **caía**, inclusive no relato à Regência | arquivar não apaga produtividade |
| 8 | Data `2026-13-45` | gravava | 400 |
| 9 | "Reservar mesa para 4/5 pessoas" | prazo **04/05/2027** | sem prazo |
| 10 | Concluir e reabrir | etapas ficavam todas marcadas | voltam como estavam |
| 11 | Todo evento do dia com o mesmo `trace_id` | auditoria não reconstruía nada | um por requisição |
| 12 | **Uma requisição sem login derrubava o processo**: endereço `//`, cookie `twk_tarefas=%` ou token com letra acentuada | o quadro saía do ar para todos (encontrado pela revisão independente; está na 0.4.0 em produção hoje) | vira resposta de erro; há última rede para qualquer erro esquecido |
| 13 | Ordem dos cards invertia a cada reinício; meia linha no ledger colava no evento seguinte e o perdia | silencioso | ordem estável; a próxima linha começa limpa |

### Sugestões: o planejador só chegava depois

| # | Achado (FATO) | Antes | Agora |
|---|---|---|---|
| 14 | Compromisso que vence amanhã | invisível até vencer | aparece 48 h antes |
| 15 | Prazo ao assumir | **+4 dias fixos**. Caso real: `T-20261104-0002`, "reserva pendente nas próximas 48 h", nasceu com prazo 08/11, depois do jantar, e prioridade normal | prazo e prioridade vêm do sinal |
| 16 | Sugestão agregada assumida uma vez ("responder as perguntas") | surda para sempre, mesmo com o card fechado | volta, marcada, se o sinal continua |
| 17 | Sinal resolvido na origem | card ficava aberto, sem ninguém saber | o card avisa que o sinal normalizou |
| 18 | Abrir a gaveta | esperava até 3,8 s lendo as fontes | responde na hora; relê por trás |
| 19 | Central fora do ar por um instante | a decisão sobre as sugestões dela se apagava: a descartada voltava viva | decisão sobrevive à falha da fonte |

### Leitor de frases

FATO: bateria de 27 frases reais em português e francês, com armadilhas. **Antes 10/27; agora 27/27.** A suíte permanente passa de 60 frases, inclusive data como assunto ("o contrato do dia 12 até sexta") e o mesmo pedido em cada dia da semana. Caíam, por exemplo: "dia 12", "em 3 dias", "até 15 de novembro", "fim do mês", "Répondre vendredi". O título também guardava o lixo: "Responder os hotéis até sexta, Julien cuida" virava o título inteiro.

### Eficiência e complexidade de dados

Cada escrita regravava o arquivo inteiro e relia o ledger inteiro, parando o servidor.

| Tarefas no livro | Criar (p50/p95) | Mudar | Histórico do card | `/health` | Outra pessoa lendo durante uma rajada de 10 escritas |
|---|---|---|---|---|---|
| 1.000 | 39/99 → **9/17 ms** | 26 → **7 ms** | 19 → **3 ms** | 38 → **2 ms** | 440 → **69 ms** |
| 5.000 | 175/602 → **10/15 ms** | 177 → **7 ms** | 209 → **4 ms** | 179 → **2 ms** | 4.798 → **63 ms** |
| 20.000 | não terminou em 280 s → **16/35 ms** | **8 ms** | **3 ms** | **2 ms** | **122 ms** |

Com o volume real da equipe, cerca de 3.650 tarefas por ano (JULGAMENTO, 10 por dia), a versão antiga caminhava para meio segundo por clique, e o servidor congelava para todos a cada rajada. Na nova, o tempo de escrita praticamente não cresce com o livro.

O que continua crescendo: abrir a lista completa (148 ms e 3,7 MB com 5.000 cards vivos, antes de comprimir). Depois da primeira carga, o app só recebe o que mudou; e arquivar tira card da lista. Para 3 pessoas isso dá anos de folga.

Em produção cada ida ao servidor leva de 0,7 a 1,4 s a partir deste notebook (FATO, conexão nova). Arrastar um card custava duas idas antes de ele sair do lugar, ou seja, 1 a 3 s parado. Agora a tela muda na hora; o servidor confirma depois.

Interface: 174 KB viram 49 KB comprimidos (FATO). Antes, 60 KB sem compressão nenhuma, revalidados a cada 5 minutos. O peso subiu e a espera caiu: arquivo com versão no endereço fica em cache para sempre e o app abre com o último estado guardado.

Dados: **4 lugares guardavam a mesma verdade** sem nenhum conseguir reconstruir os outros, e dois motores divergiam em silêncio. O motor Postgres tinha 0% de cobertura e 4 bugs por leitura de código: histórico sem status nem motivo, sugestões que nunca saíam, descartada que nunca voltava e leitura repetida a cada abertura. Agora há uma camada só de regras e um teste de contrato que roda igual nos dois motores, com SQL real (PGlite).

### Segurança (FATO)

| Achado | Antes | Agora |
|---|---|---|
| Força bruta no login | 60 tentativas, 60 respostas, sem freio; cada uma travava o servidor por cerca de 280 ms | 8 tentativas por IP = 429, mesmo em paralelo (40 simultâneas: 8 passam); erros de outros IPs não trancam a dona da conta; a conferência não bloqueia mais |
| Refresh token do conector (90 dias) como cookie | entrava no app, com autoria vazia | 401 |
| Conta removida com cookie antigo | seguia entrando | 401 |
| `/health` sem login | caminho no disco, contagens; e lia os arquivos inteiros, abrindo porta para travar o servidor | só "está de pé" |
| Página em iframe, sem CSP | possível | bloqueado; CSP estrita |
| Registro OAuth aberto a qualquer https | um "Claude" falso podia receber o acesso de quem caísse no link | só Claude e localhost; a tela diz para onde volta |

### Testes

FATO: **36 → 89 testes**, todos verdes. Cobertura do motor Postgres de 0% para o contrato inteiro. Fumaça do modo produção com estado no formato da 0.4.0: 31 de 31, incluindo ida e volta de versão. Fluxos reais no navegador: captura, salvar sozinho, conflito digitando, rascunho, propostas, perguntas, tempo real entre dois logins, arrastar, paleta, instalação do service worker.

Porta de Qualidade completa em 09/11, antes do envio: **verde, 1.203 checagens**. Em 05/11 ela havia ficado vermelha só no Atlas, por motivo alheio a esta mudança (faltava `tsc.exe` em `Agente Financeiro/node_modules`); a reinstalação resolveu. Na Porta, o teste do motor Postgres aparece como pulado, porque o PGlite não está instalado nesta pasta; ele passou em 05/11, com o pacote instalado à parte.

### Revisão independente

Um revisor separado leu o código sem conhecer o raciocínio da reescrita e reproduziu os problemas executando. Valeu: achou 1 crítico, 3 altos e 13 médios ou baixos nas primeiras horas da 1.0. **Todos os confirmados foram corrigidos, cada um com teste**: o bug de derrubar o servidor (#12), decisão apagada por releitura em segundo plano, card duplicado por clique duplo, conflito que escapava quando a tela já tinha recebido o valor novo, canal de tempo real que não religava depois de um 502, doze frases que viravam prazo errado, entre outros.

Desvio registrado: para testar uma hipótese, o revisor fez cerca de 10 `SELECT count(*)` no banco real, com o papel somente-leitura `twk_ro`, apesar de instrução em contrário. As bancadas desta auditoria e a suíte de testes passavam pelo mesmo caminho, porque a biblioteca de conexão acha a credencial sozinha. Só contagens, nada escrito, nenhum dado pessoal lido. Corrigido: com `TAREFAS_SEM_BANCO=1`, definido nos testes, o banco real não é tocado.

## O que mudou para quem usa

- **Hoje** é a tela inicial: atrasadas e urgentes, cobranças vencidas, o dia, o que está em andamento, os próximos 3 dias. Cada linha mostra a próxima etapa; um clique marca como feita.
- **Frase vira card** em qualquer tela (`Ctrl K`), com prévia ao vivo: `Ligar para o Monak sexta @julien !alta`.
- **Aguardando de verdade:** de quem é a resposta e quando cobrar. Na data, volta sozinho. Para uma concierge, este é o estado em que a maior parte do trabalho fica parada, e nenhuma ferramenta genérica trata assim.
- **Repetir:** "toda segunda rever a fila". Concluir cria a próxima.
- **Comentários e novidades:** `@julien` marca; o sino mostra o que mudou nos seus cards.
- **Tudo tem Desfazer, tudo tem teclado.** Arrastar é atalho, não o único caminho.
- **Tempo real:** o que um faz, o outro vê, sem recarregar.
- **Calendário** de 5 semanas: arrastar um card muda o prazo.
- **Link direto** para cada card; **instalável** no celular; abre sem rede com o último estado.
- **Planejador** separa listas em vários cards e responde perguntas ("o que o Julien tem hoje?") de graça, sem chamar o modelo.
- **Claude:** ferramentas novas (`minha_fila`, `comentar_tarefa`, `desarquivar_tarefa`), e cada ferramenta declara se só lê.

## Comparação com os melhores

JULGAMENTO, com base no conhecimento do produto e em buscas de hoje (as fontes são em boa parte de terceiros: tratar preços e datas como indicativos).

| Referência | O que faz de melhor | No COMPASSO |
|---|---|---|
| Linear | velocidade: ação instantânea, tudo por teclado, `Ctrl K`. Em 2026, agente nativo, MCP e tarefas recorrentes de agente | adotado: ação otimista, teclado, paleta, tempo real, MCP |
| Things, Todoist | captura em linguagem natural, tela "Hoje" | adotado, com português e francês |
| Asana (AI Studio), ClickUp | automação de fluxo, muitos campos, muitas telas | **recusado de propósito**: é o "cheio de coisas" que o fundador vetou em 03/11 |
| Motion | agenda o dia sozinho | não agora: exige estimativa de tempo em cada tarefa, burocracia sem retorno para 3 pessoas |
| Notion | tarefa e documento juntos | não: a Biblioteca já cumpre esse papel |

**Onde o COMPASSO pode ser o melhor do mundo** não é em recursos: é em ser o único gerenciador que **conhece a operação**. Nenhuma dessas ferramentas sabe que a mesa é hoje à noite e o restaurante não respondeu.

## O que não foi construído, de propósito

Gantt, sprints, estimativa e controle de horas, campos personalizados, papéis e permissões, quadros múltiplos, automação visual, anexos, painel de métricas. Cada um é uma tela a mais para 3 pessoas. Se a falta de algum virar dor medida, entra.

## Limites do que foi verificado (LACUNA)

- **Modelo real:** sem chave da API nesta máquina. O caminho com modelo foi testado com cliente falso. Os parâmetros novos (formato garantido e `fallbacks`) só rodam de verdade em produção; se a API os recusar, a chamada repete sem eles, e o leitor de frases é a rede final.
- **Tempo real atrás do proxy do EasyPanel:** não testado. Se o proxy segurar o canal, o app relê a cada 60 s.
- **Service worker em domínio real:** verificado por fumaça de arquivos, não instalado em celular de verdade. Safari e Firefox não foram testados.
- **Toque real:** o celular foi emulado no navegador.

## Decisões do fundador (em ordem de impacto)

1. **Publicar a 1.0.** Commit, push e Redeploy no EasyPanel. Não exige variável nova, abre o estado atual e permite voltar à 0.4.0.
2. **Um login para cada um** (`TAREFAS_USUARIOS`). Hoje é só `admin`, então o histórico diz "admin" para tudo e as Novidades não têm de quem ser. É o que mais destrava: cada um abre no próprio dia.
3. **Avisar fora do app.** Hoje "criar um card não avisa ninguém": esta é a maior causa provável de não-adoção. Recomendação: uma mensagem por dia no WhatsApp de cada um, às 8:00 AM, com o dia dele e "responda feito 2" para concluir. É envio externo, então precisa da sua aprovação.
4. **Limpar os 4 cards `[TESTE]`** do quadro de produção.
5. **Frase para `sql/001-plan.sql`** (Postgres) ou cópia fora do servidor. Hoje, perder o volume perde tudo: as cópias diárias moram no mesmo disco. O motor agora está testado.
6. **`AGENT_PLANEJADOR_URL` nos coletores** da Regência: o relato existe e ninguém lê.
7. **Modelo do chat.** Segue `claude-opus-5-5` em esforço baixo. Haiku 5.5 custa 40 vezes menos (US$ 0,10 contra US$ 4 por milhão de tokens de entrada) e deve bastar para título e etapas, mas no teto de 60 chamadas por dia o custo com Opus é de centavos: a troca só se justifica se a resposta estiver lenta. Muda com `TAREFAS_MODELO`.

## Próximos saltos (não construídos)

1. **O card que conhece a reserva.** Referência ligada à reserva real (via `twk_ro`): "mesa em 6 h", prazo calculado a partir do jantar, e o card se fecha sozinho quando o restaurante confirma. É o que nenhuma ferramenta do mundo pode fazer aqui.
2. **O dia no WhatsApp** (decisão 3), com conclusão por resposta.
3. **Cobrança assistida.** Card em Aguardando, data chegou: a Aria redige a cobrança no idioma da casa; um clique e vai. Passa pela porta de saída e pela tabela de escalonamento.
4. **Sinais empurrados.** Guardião, Aria e Sentinela criam sugestão na hora, em vez de esperar a releitura; concluir o card fecha o achado na Central. Fecha o ciclo que o dossiê do Planejador prometeu.
5. **Retrospectiva de segunda-feira.** O que escorregou, por pessoa e área, em uma tela, a partir do ledger agora completo.
6. **Chat que age.** "Muda tudo do Lucas de sexta para segunda": o modelo propõe a lista de mudanças, a pessoa confirma.

## Fontes externas

- [Linear: changelog do agente, mar/2026](https://linear-web.pages.dev/changelog/2026-03-24-introducing-linear-agent) · [Linear: guia de agentes 2026 (BuildBetter)](https://blog.buildbetter.ai/linear-ai-agents-2026-guide-5-alternatives-for-engineering-teams/) · [Linear: suporte MCP e triagem (CallSphere)](https://callsphere.ai/blog/vw4g-mcp-linear-server-agentic-ticket-triage-2026)
- [Comparativo Motion, ClickUp, Asana, Linear](https://ai-productivity-blog.pages.dev/posts/best-ai-project-management-tools-2026.html) · [Melhores ferramentas de IA para gestão de projetos 2026 (Morgen)](https://www.morgen.so/blog-posts/best-ai-task-management-tools) · [Asana vs Motion](https://aiproductivity.ai/vs/asana-vs-motion/)
