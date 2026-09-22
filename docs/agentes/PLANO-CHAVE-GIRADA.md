# Chave Girada — o plano para entregar a chave a quem já confirma

> 2026-09-03 · trace `trc-agentes0902` · Fontes: `twk_auth` via `twk_ro` (180 dias, dedup), ledger da campanha, workflows n8n lidos por dentro (fluxos 1, 3 e `listing-otp`), páginas reais `theworldkeys.com/r/…` e `manager.theworldkeys.com/register` vistas em 03/09. Lista-alvo: `orchestrator/state/chave-girada/alvos-2026-09-03.csv` (33 casas, segmentadas).

## 1. A tese, em uma frase

**Ninguém precisa ser convencido. Os 34 restaurantes que respondem já disseram "sim" 340 vezes em seis meses — 289 delas em nome próprio, pelo link do e-mail. O que falta não é argumento: é tirar da frente deles três coisas que os fazem parar e dar uma coisa que ninguém deu.**

## 2. O que os números dizem (e que ninguém tinha olhado por este ângulo)

| Fato | Número | Fonte |
|---|---|---|
| Publicados com ≥4 pedidos em 180 dias | 101 | `reservations` dedup |
| Desses, **nunca responderam** | 68 | idem |
| Respondem a ≥50% | 14 · a ≥80%: **1** | idem |
| Casas que responderam ≥1 vez (≥3 pedidos) | **34** em 20 cidades | ranking |
| Respostas dessas 34 em 180d | 340 (289 pelo próprio restaurante via `/r/`) | `modified_by` |
| **Contas reais de restaurante na plataforma** | **0** — as 2 linhas de `restaurant_users` são "Le Julien" e "Marlon Food", internos | `restaurant_users` |
| Das 34, quantas a campanha de fundadores já tocou | **33** (1 a 3 e-mails cada) | ledger |
| Quantas ativaram | **0** | `restaurant_users` |
| Confirmadores puros (aceitam tudo, recusam nada, ≥2 aceites) | **11 casas · 69 aceites em 130 pedidos** | ranking |
| Recusadores (SRI TRAT: 193 pedidos, 2 aceites, **116 recusas em nome próprio**) | 3 | ranking |
| Das 34, com horário genérico no catálogo | 17 (50%) | `opening_hours` |
| Das 34, com telefone no catálogo | 34 (100%) | catálogo |

**A leitura correta:** a campanha alcançou exatamente as pessoas certas e não converteu nenhuma. Então o problema não está em *quem* nem em *quanto* — está em *o que acontece quando elas tentam*.

## 3. Onde a chave trava — quatro vazamentos encontrados no funil real

Fui ao funil como um dono de restaurante iria. Foi isto que ele encontra:

1. **O momento de maior intenção está em silêncio.** Quando o restaurante clica "Accept" no `/r/`, recebe o e-mail "The booking is confirmed" (fluxo 3 do n8n). Esse e-mail **não tem um único convite para assumir a página**. Nem o `/r/` tem. Isso aconteceu ~2.300 vezes na história da plataforma (900 respostas assinadas por restaurantes + 1.395 sem autor). É a hora em que ele acabou de fazer o trabalho manualmente e está com o e-mail aberto — e nós não dizemos nada.
2. **O código de acesso chega com a marca errada.** O e-mail "Your Admin Dashboard Is Ready" (n8n `listing-otp`) diz **"The World's Kitchen"**, num template branco sem identidade, em inglês, sem dizer por que a pessoa está recebendo aquilo. O WOO TENDER pediu o código duas vezes e não terminou. Eu também não terminaria: parece phishing.
3. **A página de cadastro se apresenta como outra empresa.** `manager.theworldkeys.com/register`: *"Claim a listing already on The World's Kitchen"*. O dono recebeu semanas de e-mails da The World Keys e, ao decidir, lê o nome de outra marca.
4. **A porta promete o que não existe.** A landing do manager diz *"Trusted by hundreds of restaurants around the world"*. São zero contas reais. O Dossiê já tinha tirado essa frase do site principal; ela sobreviveu no manager, que é justamente onde o dono decide.

Um quinto achado não é de conversão, é de segurança, e vai em separado no §8.

## 4. Por que o pitch anterior não podia funcionar com este grupo

Os e-mails da campanha diziam "**N clientes pediram mesa e estão sem resposta**". Para 148 casas que nunca responderam, é um espelho. Para as 34 que respondem, é uma **acusação errada**: a ATHÉNÉE aceitou 33 de 33 que viu; o SRI TRAT respondeu 118 vezes. Dizer a eles "vocês têm pendências" é dizer que não notamos o trabalho deles. E a escassez ("42 vagas de fundador até 31/08") não move quem já está dentro fazendo o serviço.

## 5. Os sete movimentos — do mais barato ao mais estrutural

| # | Movimento | O que muda | Quem faz · esforço | Sem isso… |
|---|---|---|---|---|
| **1** | **Converter no clique — nos três e-mails que o restaurante recebe.** (a) Notificação do pedido ("Great news!…", fluxo 1) e lembrete de 6h (fluxo 2): linha discreta sob o botão principal *"Prefer to answer every request from one place, in one tap? … Activate my key →"* — **aplicado em 03/09 via API, com backup**; (b) pós-resposta "Establishment (Accept)/(Decline)" (fluxo 3): cartão *"You just replied through the link. Next time, one tap."* — **aplicado em 03/09 pelo fundador**; (c) tela de agradecimento do `/r/` — front, pendente | Cada pedido, cada lembrete e cada resposta viram um convite; a notificação é lida por 100% de quem responde (o fundador tinha razão: era ali que faltava) | n8n feito · front (`/r/`, 2h) pendente | continuávamos calados ~40 vezes por mês |
| **2** | **Fechar o vazamento de marca.** E-mail do código no padrão TWK escuro, no idioma da casa, explicando por quê ("vocês pediram um código para assumir a página de {nome} na The World Keys"). Trocar "The World's Kitchen" no `/register`. Tirar "Trusted by hundreds" da landing | O código passa a parecer nosso; a porta para de mentir | n8n (1 template, 1h) + front (2 strings, 30 min) | quem pede o código não confia no que recebe |
| **3** | **Prova antes do pedido.** Confrontar os horários das casas com o Google Places **antes** de escrever. **Feito em 03/09: 15 consultadas, 15 iguais ao Google, 0 divergem** — para este grupo o "horário genérico" é o horário real. Logo, nada a corrigir e o Extrato **não** diz "corrigimos" (seria mentira). O que fica: o pedido de que eles confirmem a agenda ao ativar. Consequência importante: as 116 recusas do SRI TRAT **não** se explicam por horário de funcionamento — hipóteses (lotação, tamanho de grupo, política) vão para a ligação; o texto da variante C para ele precisa de revisão humana antes do envio | Honestidade preservada; hipótese "genérico = errado" derrubada para estas casas (a auditoria das 413 do catálogo continua, mas por amostra antes de qualquer escrita) | feito (sonda read-only, `orchestrator/state/chave-girada/proposta-horarios-dba.md`) | escreveríamos 15 horários que já estavam certos e mandaríamos 33 e-mails com uma afirmação falsa |
| **4** | **Extrato de Resposta, não fatura de pendências.** Um e-mail por segmento, com os números **deles**, na língua deles: | Reconhecimento em vez de cobrança | Guardião/CLAVIS (templates prontos abaixo) · aprovação em lote | repetimos o pitch que já falhou 33 vezes |
| | · **A — Confirmadores (11):** cartão-extrato *"33 / 33 pedidos aceitos"* + *"Uma das 11 casas, em 1.548, que aceita tudo o que vê"*. Queremos que os clientes vejam o que vocês já fazem — a conta é o primeiro passo. (O selo só é prometido quando o front o publicar.) | | | |
| | · **C — Recusadores (3, SRI TRAT à frente):** cartão *"116 — pedidos que tiveram de recusar"* + *"Recusar quase tudo é um problema nosso para resolver com vocês"*. Com a conta, vocês definem o que a página oferece (horários e política de reserva). **Sem afirmar que é horário** — o Google confirmou os horários deles; a causa real sai na conversa | | | |
| | · **B — Mistos (7) e D — Ocasionais (12):** cartão *"9 respostas · 5 sim · 4 não"* + *"Responder já vos coloca à frente de quase todo o catálogo"*. Cada "não" custa a ambos; a conta dá controle sobre o que chega | | | |
| | **Formato (03/09):** mesma identidade visual dos e-mails transacionais que eles clicam toda semana (fundo escuro, dourado, logo TWK) · pré-visualização com o número deles · um só botão · três passos com o e-mail **mascarado** para onde o código vai (i***@dominio) · assinatura de pessoa (Márlon) · rodapé de opt-out · sem "urgente", sem "última chance", sem "fundador" | | | |
| **5** | **Selo "Responde rápido" na página pública**, para casas com ≥50% de resposta, recalculado toda semana com dado real. Junto, consertar o selo de parceiro (Dossiê 08, travado em falso) | A recompensa é visível para o cliente — e é mérito, não escassez teatral | front (1 badge condicional + job semanal, 1 dia) | a chave não dá nada que o dono veja |
| **6** | **Fechamento humano nos 11 confirmadores — por WhatsApp em texto, no idioma da casa, não por voz.** (Revisado em 03/09: o fundador não fala os idiomas; e estes 34 provaram 289 vezes que respondem a texto.) Mensagem 1 pronta por casa em `orchestrator/state/chave-girada/whatsapp-confirmadores.md`; resposta é colada na sessão e o MAESTRO traduz e redige a réplica; máx. 2 mensagens sem resposta; opt-out registrado se pedirem. Idiomas dos 11: PT 3 (Lagos), EN 5 (Atenas, Istambul, Londres, Doha), IT 2, FR 1 | Ninguém precisa falar a língua; a IA entra como texto, com humano no envio e na decisão. **Voz só como último recurso** (14 dias sem reação, 2–3 casas, aviso explícito de automação) — voz sintética pedindo cadastro é o "robô estranho" que o Cañete temia | Márlon envia; MAESTRO traduz | ligações em 5 idiomas que ninguém do time fala |
| **7** | **Chave pré-girada.** Usar `restaurant_invitations` (construído, 1 linha de uso) para emitir um link pessoal por casa que já chega no formulário preenchido — só falta a senha. Sem OTP de ida e volta | O cadastro vira um clique | front (verificar como o token é consumido; 1–2 dias) | dependemos do OTP, que hoje chega com marca errada |

**Ordem:** semana 1 → movimentos 1, 2, 3 e 6 (sem LLM, sem infra nova; o 6 começa no dia em que o 2 estiver no ar — ligar antes disso manda o dono para um código de outra marca). Semana 2 → movimento 4 para B e C e para os confirmadores que a ligação não alcançou. Semana 3 → movimentos 5 e 7.

## 5b. Quem envia o quê (respondendo "a Aria não pode enviar?", 03/09)

| Canal | Quem envia a 1ª mensagem | Quem conversa depois | Estado |
|---|---|---|---|
| **E-mail (Extratos)** | **MAESTRO**, pelo webhook n8n do Gmail da casa, assinado por Márlon (`orchestrator/agents/chave-girada/enviar.js`, dry-run → `--apply --aprovacao`) — a Aria só sabe *responder* em thread, não iniciar | **Aria**, quando o restaurante responde em reservation@/support@ (FLUXO 6/7) | pronto; falta a sua aprovação do lote |
| **WhatsApp** | **Aria**, via template pré-aprovado pela Meta (`sendTemplate` já existe no código; template ainda não criado) — texto livre só é permitido depois que o restaurante responde | **Aria**, em texto livre, no idioma do restaurante — resolve o problema de idiomas | depende de você criar o template no WhatsApp Manager (`orchestrator/agents/chave-girada/whatsapp-template-meta.md`, 10 min + aprovação da Meta) |
| **WhatsApp manual (interino)** | Márlon, do próprio telefone, com o texto pronto | MAESTRO traduz as respostas na sessão | pronto hoje (`whatsapp-confirmadores.md`) |

## 6. Como saber se funcionou

| KPI | Hoje | 14 dias | 30 dias | Fonte |
|---|---|---|---|---|
| Contas reais em `restaurant_users` (excluindo internas) | **0** | 6 dos 11 confirmadores | 12 das 33 | banco |
| Cliques "Ativar minha chave" por resposta no `/r/` | — (não existe) | medido | ≥15% | n8n `/go` |
| Códigos pedidos → cadastros concluídos | 2 pedidos / 0 concluídos (WOO TENDER) | ≥50% | ≥70% | `restaurant_invitations` |
| Recusas do SRI TRAT por mês | ≈20 | | < 5 (agenda real) | `reservations` |

**Critério de morte:** se em 30 dias houver **menos de 3 contas reais**, o problema não é pitch — é o produto de cadastro. Paramos de escrever e consertamos o `/register` antes de qualquer outra mensagem.

## 7. O que eu faço sozinho e o que depende de você

**Faço agora, sem aprovação:** lista-alvo segmentada (feita) · os três e-mails do Extrato em PT/EN/FR/IT/ES, com os números reais de cada casa · o template TWK do e-mail de código, pronto para colar no n8n · a proposta de correção de horários das 17 casas (leitura + SQL de proposta) · a ficha de ligação dos 12 com telefone e o número exato de cada um para o Márlon dizer ao telefone.

**Depende de um clique seu:** aprovar a troca dos 3 templates no n8n (é alteração em fluxo de produção — eu colo, você confirma) · aprovar o lote de horários · autorizar o envio dos Extratos (lote único, ≤33 e-mails, com opt-out) · pedir ao front as 3 mudanças pequenas (strings do `/register` e da landing; botão no `/r/`) e as 2 médias (selo; `restaurant_invitations` como link direto).

## 8. Achado de segurança — fora do plano, mas não pode esperar

A página `https://theworldkeys.com/r/{código}` de uma reserva **cuja data já passou** (GYWUQ7PG, 02/09 19:00) continua **aceitando Accept / Decline / Propose Reschedule** e **exibe nome, e-mail e telefone do cliente** a qualquer pessoa que tenha o link — sem login. O código tem 8 caracteres e circula em e-mails a caixas que já sabemos comprometidas (JOAQUINA: bounce em domínio de terceiros). Isso é exposição de dado pessoal (GDPR art. 32) e permite alterar reservas alheias.

Correção mínima no front: (a) `/r/` de reserva com `booking_date` passado ou `expired_at` preenchido → só leitura, sem botões; (b) contato do cliente só aparece **depois** de aceitar, nunca antes; (c) registrar em log quem acessou. Coloquei como item crítico no Despacho de amanhã.

## 9. Por que isto não é "solução boba e comum"

Porque não é uma mensagem nova. É a constatação de que a plataforma já tem os 34 clientes mais quentes que poderia ter — pessoas que fazem o trabalho manualmente há meses — e que o funil os perde por se apresentar como outra empresa, por ficar em silêncio no único momento em que eles estão com a mão na porta, e por lhes cobrar pendências que eles não têm. Consertar isso custa três templates e três strings. Só depois disso faz sentido escrever a próxima palavra.
