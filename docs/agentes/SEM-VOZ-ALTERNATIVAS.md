# Sem telefone: como falar com restaurantes em oito idiomas

> 2026-09-06 · Decisão do fundador: nenhuma recomendação nossa pode depender de ligação, porque o time não fala os idiomas das casas. A voz saiu do sistema — abaixo, o que entra no lugar.

## O que já foi trocado no sistema

| Antes | Agora |
|---|---|
| "Fila de ligações" no acompanhamento de reservas | **Fila de mensagens**: WhatsApp em texto, no idioma da casa |
| Degrau 3: telefone quando a mesa está a menos de 48 horas | Degrau 3: **WhatsApp urgente em texto**, mesma fila com prioridade |
| "Ligar para o restaurante agora" no relatório diário | "Mandar agora a mensagem pronta, no idioma da casa" |
| Verificação de identidade por telefone | Prova por escrito (abaixo) |

Um teste automático agora reprova qualquer versão futura do sistema que volte a propor ligação. **Não é só o texto que mudou: a regra virou código.**

---

## A alternativa, e por que ela é mais forte que o telefone

**A assistente é poliglota. Nós não precisamos ser.**

A Aria lê e escreve em qualquer idioma. O problema nunca foi a empresa não falar grego — foi tentarmos falar. Se a conversa é escrita, ela conduz do começo ao fim e ninguém do time precisa entender uma palavra.

Isso muda três coisas de uma vez:

**1. Cobertura.** Todos os 1.546 restaurantes publicados têm telefone no catálogo, e a maioria dos telefones de restaurante é WhatsApp. É um canal que nunca usamos e que tem taxa de leitura muito maior que e-mail.

**2. Velocidade.** Uma mensagem de WhatsApp é lida em minutos. Um e-mail, em horas. Para uma mesa que é hoje à noite, é a diferença entre salvar e não salvar.

**3. Continuidade.** No e-mail, cada mensagem é um evento isolado. No WhatsApp, a conversa fica aberta: o dono responde em turco, a Aria responde em turco, e a ativação acontece ali dentro, sem ele precisar ir a lugar nenhum.

### O que falta para ligar isso

Uma coisa só: **aprovar o modelo de mensagem no WhatsApp Manager da Meta**. A regra da Meta é que a primeira mensagem a um número novo tem que usar um texto pré-aprovado. Depois que a pessoa responde, a conversa fica livre por 24 horas e a Aria conduz.

O texto já está pronto em cinco idiomas e o passo a passo está em `orchestrator/agents/chave-girada/whatsapp-template-meta.md`. São dez minutos seus no WhatsApp Manager e de minutos a dois dias de aprovação da Meta. **É o maior desbloqueio pendente da operação, e agora é o único caminho para casos urgentes.**

Enquanto a Meta não aprova, o caminho manual funciona: eu escrevo a mensagem no idioma da casa, você cola e envia, e me passa a resposta para eu traduzir e responder.

---

## Verificação de identidade sem telefone

Para os 18 restaurantes cujo domínio de e-mail pode ser comprado, eu havia recomendado confirmar por telefone. Substituo por três provas que funcionam por escrito, em ordem de força:

**1. Mensagem do WhatsApp oficial da casa.** O número está no nosso catálogo e no Google. Se a pessoa escrever de lá, é a mesma prova que uma ligação daria — e fica registrada.

**2. Uma foto com um código nosso.** Mandamos um código de quatro dígitos e pedimos uma foto do salão, da fachada ou do cardápio com o código escrito num papel. Nenhum idioma envolvido, impossível de falsificar à distância, e leva dois minutos para quem realmente está no restaurante.

**3. Um e-mail no domínio que aparece no site oficial ou no Google.** Serve quando o e-mail do nosso catálogo está morto mas a casa tem outro endereço público.

Qualquer uma das três resolve. A Aria conduz a conversa no idioma da pessoa, e o time só vê o resultado: verificado ou não.

---

## Uma ideia a mais, que não precisa de idioma nenhum

**Um vídeo de trinta segundos mostrando o painel.** Sem narração, só a tela: o pedido chegando, o toque para aceitar, os horários sendo ajustados. Serve para restaurante em qualquer país, entra como link no e-mail e no WhatsApp, e responde a pergunta que o texto não responde bem: "o que eu ganho com isso?"

É a peça de conversão mais barata que ainda não temos, e a única que funciona igualmente bem em Istambul, Lagos e Quioto.
