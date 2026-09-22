# Operação Lagos — por telefone e WhatsApp, de Paris · 16 a 30 de setembro de 2026

> trace `trc-lagos-20260916` · decisões do fundador em 16/09: "Vamos seguir com o plano de converter ativações nessa semana" → "Siga suas melhores recomendações" → "Não consigo ir de porta a porta em Portugal. Não temos funcionários lá." Base: `docs/TWK-Dossie-Chave-na-Mao.html`. Rotulagem: fato × suposição × lacuna. Nada aqui foi enviado; todo envio externo passa pela sua palavra.

## 0. O que mudou e por quê

Sem presença em Portugal, o canal presencial sai. Pela pesquisa do dossiê, o segundo canal que mais converte com dono de restaurante é **telefone no idioma da casa, no intervalo entre serviços** (10 a 15% de ligação para reunião nos melhores times de PME; 2 a 5% na média), seguido de **WhatsApp manual e personalizado como segundo toque** (8 a 15%; 15 a 20% em PT quando personalizado). Você fala a língua das 25 casas, tem os números de cada uma e a página já pronta. A "reunião" aqui é a própria chamada: a conta se ativa **durante a ligação**, com o link chegando por WhatsApp enquanto o dono está na linha. É o modelo de onboarding assistido de Superb, TheFork e OpenTable (chamada de 30 minutos, a plataforma configura), só que em cinco.

**Expectativa ajustada (suposição):** 25 ligações em duas tardes → 8 a 12 conversas com quem decide → 3 a 5 contas em 30 dias. Presencial daria 8; é o preço de não estar lá. Um freelancer local em Lagos (20 a 35 €/hora, 10 horas) pode entrar depois, se as ligações mostrarem interesse e faltar "mão" para fechar; não é pré-requisito.

## 1. O alvo, em números (banco 15/09, dedup, casa de teste excluída)

| | |
|---|---|
| Casas publicadas em Lagos | 26 · 0 com acordo |
| Na lista de ligações | **25** · CAMPIMAR fora de contato (§6) |
| Pedidos em 90 dias | 272 · 30% de toda a plataforma |
| Cinco silenciosas de maior demanda | CASA DO PREGO 87 · O ANTÓNIO 61 · MY SUSHI 57 (1 resposta) · DON SEBASTIÃO 50 (Michelin) · A PETISQUEIRA 37 = 292 pedidos em 180 d |
| Respondem em nome próprio pelo link (180 d) | SCARTUCCIO 9 · LUCA'S 4 · REPOLHO 2 · DOM VINHO 1 · VENEZA 1 · MAR 1 |
| Temporada | jul 118 · ago 89 · set (½) 36 · out/2025 29 · nov/2025 5 |

Lista completa com telefone, e-mail, endereço e tier: `orchestrator/state/lagos/alvos-lagos-2026-09-16.csv`.

## 2. Cronograma

Horário de Lagos = Paris menos 1 hora. Janela boa para restaurante: **14h30 às 17h de Lagos = 15h30 às 18h de Paris**, terça a quinta. Nunca 12h às 14h nem depois das 19h.

| Dia | O quê | Quem |
|---|---|---|
| qua 16 | ELEOS renovado e reenviado (feito). Front recebe `CADRAGE-FRONT-PORTA-2026-09-16.md`. Você compra o número português de WhatsApp Business (eSIM ou pré-pago). | fundador · front |
| qui 17 – sex 18 | Front entrega itens 3, 5 e 7 do cadrage (marca, aprovação sem beco, segurança). Você lê o caderno de ligações e grava o vídeo de 30 s do painel (sem narração). | front · fundador |
| sáb 19 – seg 21 | Front entrega 1, 2, 4 e 6 (link pré-verificado, verificação por WhatsApp, primeira tela com os dados da casa, porta no site). **Teste de aceite da porta por alguém de fora.** | front · MAESTRO testa |
| seg 21, 10h–12h Lagos | WhatsApp de agendamento às 6 casas que já respondem (§4). | fundador |
| ter 22 e qua 23, 15h30–18h Paris | **Ligações.** Tarde 1: as 5 silenciosas de alta demanda + as 6 que respondem (agendadas). Tarde 2: as 14 restantes. Cada ligação termina com o link no WhatsApp da casa, no mesmo minuto. | fundador · MAESTRO à distância para dado ou tradução |
| qui 24, 15h30–18h | Segunda tentativa a quem não atendeu; ativação assistida por chamada de vídeo a quem pediu. | fundador |
| sex 25 | Leitura 1: contas ativas, pedidos respondidos pelo painel. Decidir se entra o freelancer local. | MAESTRO · fundador |
| 26/09 – 15/10 | Nutrição (§5). Leitura final em 15/10. | Aria · Guardião · MAESTRO |

## 2-bis. Decisão de 16/09 à noite: e-mail primeiro, WhatsApp a partir de 17/09

| Quando | O quê | Estado |
|---|---|---|
| **qui 17/09, 10h00 Brasília** (13h UTC · 14h Lagos) | **T1 a 25 casas**, pelo n8n hospedado (workflow `aG8Wzs2Gdy3ssyFy`), destinatários lidos do banco na hora, opt-out conferido | agendado e ativo |
| qui 17/09, até 10h30 BRT | ler execução, gravar ledger, conferir 1 mensagem em Enviados, desativar o workflow | MAESTRO |
| qui 17/09 | cadastrar os 3 templates de WhatsApp na Meta (`whatsapp-templates-lagos-2026-09-17.md`); comprar o número português | fundador |
| dom 20/09 | **T2** só a quem não clicou nem respondeu; aprovação do fundador; agendar pelo mesmo caminho | a decidir |
| sex 25/09 | **T3** pela mesma regra; nunca um 4º | a decidir |
| ter 22 – qui 24/09 | ligações às casas que reagiram (SIM, clique, resposta), na janela 15h30–18h Paris | fundador |

Fallback se o n8n não rodar: `node orchestrator/agents/chave-girada/sequencia-enviar.js --toque 1 --apply --aprovacao "<frase>"` (mesmas travas, ledger local).

## 3. Ordem das ligações (25 casas)

- **Tarde 1, bloco A (silenciosas que mais perdem):** CASA DO PREGO · O ANTÓNIO · DON SEBASTIÃO · MY SUSHI · A PETISQUEIRA. Argumento: os clientes que já escolheram a casa.
- **Tarde 1, bloco B (já respondem, agendadas por WhatsApp na segunda):** SCARTUCCIO · LUCA'S · REPOLHO · DOM VINHO · VENEZA · MAR. Argumento: reconhecimento pelo trabalho que já fazem; a conta tira o trabalho do e-mail e põe no telemóvel. É aqui que nasce a prova social: pedir uma frase a quem ativar.
- **Tarde 2 (o resto do catálogo):** ABRIGO · MULLEN'S (só telefone e WhatsApp: e-mail do catálogo parece ser de outra casa) · THE CURRY LEAF · MARIA PETISCA · NO PÁTIO · ALMA LUSA · LINDA · BON VIVANT · LACUS · LAZY JACKS · TASCA JOTA · 2 IRMÃOS · TRAVIA · QUAY. Argumento: "as suas vizinhas já usam" (só se for verdade até lá).

## 4. Roteiro da ligação (PT-PT, 4 a 6 minutos) e mensagens

**Abertura (10 s).** "Boa tarde, é o Márlon, da The World Keys, a plataforma de reservas. Falo com quem trata das reservas da casa?" Se não: nome, melhor hora, WhatsApp da pessoa. Agradecer, desligar, anotar.

**O número deles (20 s).** Silenciosa: "Este verão, {p90} clientes escolheram o {casa} pelo nosso site e pediram mesa. Estou a ligar para que esses pedidos passem a chegar a vocês." Respondedora: "Vocês responderam a {n} pedidos nossos pelo link do e-mail, e agradeço. Estou a ligar para vos entregar a conta da casa."

**A oferta (30 s).** "A página do {casa} já está publicada, sem custo. Com a conta da casa, gratuita, os pedidos chegam num painel só e respondem-se num toque pelo telemóvel; os horários, os dias de fecho e a política de reserva ficam nas vossas mãos. Não substitui a forma como reservam hoje; complementa."

**Fechar na chamada (2 a 4 min).** "Posso ativar consigo agora? Mando-lhe o link por WhatsApp, leva um minuto." Enviar o link do manifesto na hora; confirmar horários reais e dias de fecho enquanto ele abre; se travar em qualquer passo, anotar o passo exato (é dado para o front). Se não puder agora: marcar hora para a ativação assistida (chamada de vídeo ou só telefone com o link aberto).

**Objeções.** "Quanto custa?" → nada, sem cartão, sem contrato. "Já reservamos pelo WhatsApp / pelo nosso sistema" → "Ótimo, a conta não muda isso; os clientes que nos encontram passam a chegar a vocês." Se a casa preferir, oferecer o botão de reserva direta (plano de 14/09) e confirmar o meio. "Não pedimos para estar aí" → "Entendo. Se quiser, tiro a página do ar hoje; se quiser ficar, a conta dá-vos o controlo, inclusive de sair." Registrar opt-out no mesmo dia se for o caso.

**Nunca:** dizer "pendências", "clientes à espera", prometer disponibilidade ou confirmação imediata ao cliente, prometer prazo de terceiros.

**WhatsApp de agendamento (seg 21) e pós-ligação:** `orchestrator/state/lagos/whatsapp-agendamento-lagos.md`. Regra: uma mensagem, um lembrete em 48h, e nunca mais.

## 5. Nutrição, dias 1 a 30 (quem ativou)

Mensagem de WhatsApp a cada pedido respondido na primeira semana; lembrete humano se um pedido ficar 6 horas sem resposta; extrato no dia 30 ("14 clientes chegaram, 9 reservaram, 7 foram"). Cinco interações no primeiro mês, que é o número que segura retenção. Compromissos com data em `compromissos.jsonl`; nada é prometido ao cliente final.

## 6. CAMPIMAR fica fora de contato

E-mail `campimar@grupoadm.pt` = **Grupo Adega da Marina**, que em 29/07 pediu remoção alegando listagem não autorizada; duas casas do grupo têm opt-out registrado (70626, 70057). Decisão do fundador de 14/09: a CAMPIMAR fica publicada e não é citada. Aplicado: nenhuma ligação, nenhuma mensagem. Se o grupo escrever, o pedido é honrado no mesmo dia pelo `exclusao.js`.

## 7. Decisões tomadas (fundador, 16/09)

1. **Sem presencial.** Telefone + WhatsApp de Paris, na janela 15h30–18h (Paris), terça a quinta. Freelancer local só se as ligações mostrarem interesse sem fechamento.
2. **WhatsApp Business dedicado, número português novo.** Motivo: número local converte mais e protege o número que atende clientes. Depende de você comprar o número.
3. **Front na ordem do cadrage** (3, 5, 7; depois 1, 2, 4, 6). Depende de você nomear o desenvolvedor.
4. **CAMPIMAR:** mantida a decisão de 14/09.
5. **ELEOS:** prazo renovado e e-mail reenviado em 16/09 (log do dia).

## 8. O kit (gerado, não enviado)

- `orchestrator/state/lagos/ficha-visita-lagos.html`: caderno de ligações, uma página por casa com números, contato, argumento e checklist da chamada.
- `orchestrator/state/lagos/cartas/E-*.html` e `P-*.html`: carta por casa em português (Extrato ou apresentação). Uso: **e-mail de acompanhamento no mesmo dia da ligação**, a quem atendeu. Sai só com a sua aprovação por lote, depois da porta.
- `orchestrator/state/lagos/folha-a-sua-pagina-pt.html`: folha "A sua página na The World Keys", para anexar em PDF ao e-mail pós-ligação.
- `orchestrator/state/lagos/manifesto-lagos.csv`: o que existe para quem, com o link de ativação por casa.
- Quando o front publicar o link pré-verificado (`?claim=<token>`), regero as cartas e o manifesto com ele.

## 9. Como saberemos

| Quando | Sinal | Ação |
|---|---|---|
| sex 25/09 | < 2 contas ativas após 25 ligações e ≥ 8 conversas com decisor | rever a oferta e a hora das ligações antes de continuar; considerar o freelancer local |
| 15/10 | ≥ 5 ativas com pedido respondido pelo painel | segundo ciclo por telefone: Roma e Atenas (confirmadores), Paris a pé |
| 15/10 | < 3 ativas com porta testada e 25 ligações feitas | a página gratuita não vale sozinha; o trabalho vira a ferramenta (dossiê, Parte II, padrão 3) |

Métrica que conta: **pedido respondido pelo painel**. Cadastro sem resposta não conta.
