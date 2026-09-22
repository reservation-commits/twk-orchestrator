# O cadastro de restaurante é seguro e eficiente? — auditoria antes da segunda leva

> 2026-09-06 · Pedido do fundador antes de liberar mais 21 restaurantes para o fluxo. Tudo abaixo foi verificado, não suposto: consultas ao banco, teste de registro dos domínios (DNS) e leitura das telas reais.

## Veredito em uma frase

**Eficiente: sim, agora que a tela de senha existe.** **Seguro: não o suficiente para convidar em escala** — existe um caminho pelo qual um estranho assume a página de um restaurante e passa a ver dados de clientes. Dá para fechar em um dia, e a segunda leva pode sair no mesmo dia se for feito na ordem certa.

---

## 1. Como o processo funciona hoje

1. A pessoa abre a página de cadastro e escolhe "meu restaurante já está no site".
2. O sistema manda um código de acesso **para o e-mail que está no nosso catálogo** daquele restaurante.
3. A pessoa digita o código. Isso prova que ela controla aquela caixa de e-mail.
4. A equipe revisa e aprova.
5. O sistema envia o link para criar a senha. Ela entra.

Toda a segurança do processo se apoia no passo 2: **quem controla o e-mail do catálogo, controla o restaurante.**

---

## 2. A falha — e ela é concreta

Nosso catálogo tem 26 restaurantes cujo e-mail não funciona mais. Testei o registro de cada domínio.

> **19 desses domínios não estão registrados hoje. Qualquer pessoa pode comprá-los por cerca de dez euros.**

Quem comprar um deles cria a caixa de e-mail do restaurante, pede o código de acesso, recebe, e passa a ser o dono da página na nossa plataforma.

**O que essa pessoa passa a ver.** A nossa própria página de vendas promete "perfis de hóspedes e análises" e "dados dos clientes num só painel". Nesses 16 restaurantes há **285 clientes distintos e 312 reservas**. Nome, contato e histórico de quem jantou.

Alguns dos domínios livres: `atelier-edmond.com`, `casastbarth.com`, `moulinrouge-geneve.ch`, `kalamata-paris.com`, `skybarstbarth.com`, `billionaire-gammarth.com`.

**A única barreira hoje é a revisão manual da equipe.** Ela funcionou por acaso: o ELEOS caiu em revisão porque usou um e-mail pessoal. Mas uma revisão humana, feita com pressa, olhando um cadastro que passou na verificação de e-mail, tende a aprovar. É uma barreira de atenção, não de sistema.

### Três riscos menores, mas reais

- **262 restaurantes usam e-mail gratuito** (230 no Gmail). Um ex-funcionário que ainda tenha a senha da caixa pode assumir a página. Não há como distinguir isso de um dono legítimo.
- **O código de acesso** tem 6 dígitos. Não sei se há limite de tentativas nem prazo de validade — não testei para não abusar do sistema. É pergunta de dez minutos para o desenvolvedor, e importa: sem limite, seis dígitos se quebram por tentativa.
- **Nada verifica se a pessoa trabalha lá.** "Gerente" é um campo de texto livre.

---

## 3. O que fazer antes de convidar mais gente

**Hoje, antes da segunda leva (uma hora de trabalho):**

1. **Bloquear o cadastro dos 26 restaurantes com e-mail morto.** Marcar essas casas como "contato a reconfirmar" e recusar o envio de código para elas. É a correção que fecha a porta.
2. **Confirmar com o desenvolvedor** se o código expira e se há limite de tentativas. Se não houver, colocar: cinco tentativas e quinze minutos.

**Esta semana:**

3. **Toda aprovação passa a mostrar um alerta** quando o e-mail do cadastro for diferente do e-mail do catálogo, ou quando o e-mail do catálogo for gratuito. A pessoa que aprova precisa ver o sinal, não adivinhar.
4. **Ao assumir a página, os dados de clientes só aparecem a partir daquela data.** O histórico anterior fica fora. Quem acabou de chegar não precisa ver quem jantou lá em março, e isso remove o prêmio de um ataque.
5. **Registrar quem assumiu o quê, e quando.** Hoje temos a data, mas não de onde veio nem qual e-mail foi usado.

**Boa prática, quando houver volume:** para casas sem e-mail corporativo, pedir uma prova por escrito — mensagem do WhatsApp oficial da casa, ou foto do salão com um código nosso. Nunca ligação: o time não fala os idiomas das casas.

---

## 4. Sobre a eficiência

**O que está bom:** o caminho é curto. O cadastro de teste levou 52 segundos do início ao fim. Não pede cartão, não pede documento, e a promessa é clara.

**O que atrapalha:**

- **Tudo em inglês.** A segunda leva vai para casas em Portugal, Itália, França e Grécia. Nosso e-mail chega no idioma delas e a porta abre em inglês. Foi o mesmo tipo de desencontro que fez o cadastro dizer o nome de outra empresa até anteontem.
- **A revisão manual custa um dia.** O ELEOS esperou 10 horas por ela e depois ficou preso. Se a pessoa que aprova estiver ocupada, a intenção esfria.
- **Ninguém sabe o que fazer depois.** Não existe nada preparado para o primeiro acesso ao painel. Uma conta criada e abandonada conta como fracasso, não como conversão.

---

## 5. Recomendação sobre a segunda leva

**Não é um "não". É um "nesta ordem".**

O e-mail que vamos enviar leva a pessoa a um caminho que hoje tem uma porta destrancada em 19 endereços. Nenhum dos 21 restaurantes da segunda leva está entre eles — verifiquei. Então o risco não vem de quem vamos convidar; vem de o convite tornar o fluxo mais visível e mais usado enquanto a porta está aberta.

**Minha recomendação:** bloquear o cadastro das 26 casas com e-mail morto primeiro. É uma correção pequena. Feito isso, a segunda leva pode sair no mesmo dia, e eu envio.

Se preferir enviar já, também é defensável: os 21 destinatários são seguros e o risco existe desde antes desta campanha. Mas então o bloqueio vira urgente, não importante — porque a partir do envio o fluxo passa a ser usado de verdade.
