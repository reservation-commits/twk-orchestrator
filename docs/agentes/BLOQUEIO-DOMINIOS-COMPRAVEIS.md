# Fechar a porta: 18 restaurantes cujo e-mail de contato pode ser comprado

> Para o desenvolvedor · 2026-09-06 · Verificado por consulta de registro de domínio (DNS) em 06/09. Dados em `orchestrator/state/dominios-compraveis-2026-09-06.json`.

## O problema em três frases

O código de acesso que permite assumir a página de um restaurante é enviado para o e-mail que está no nosso catálogo. Dezoito desses e-mails usam domínios que **não estão mais registrados** — qualquer pessoa compra o domínio por cerca de dez euros, cria a caixa, pede o código e vira dono da página. Nesses restaurantes há **285 clientes** cujos dados o painel exibe.

Não é hipótese: testei o registro de cada domínio, um a um.

## Os 18

| ID | Restaurante | Cidade | Domínio livre | Clientes expostos |
|---|---|---|---|---|
| 14328 | BILLIONAIRE | Gammarth | billionaire-gammarth.com | **149** |
| 61198 | EL RINCON | Manchester | elrinconderafamanchester.com | **62** |
| 13144 | L'ATELIER D'EDMOND | Val d'Isère | atelier-edmond.com | **26** |
| 19304 | ODE PORTO | Porto | odewinehouse.com | 14 |
| 32783 | ASIA ASIA | Abu Dhabi | asia-asiaabudhabi.com | 10 |
| 17404 | BURJ AL-HAMAM | Doha | hdc-glocal.com | 4 |
| 19956 | Ncw | Joanesburgo | ncwrestaurant.co.za | 4 |
| 70567 | LINDA | Lagos | lindabeachbar.pt | 3 |
| 47461 | AT THAI ON FERRY | Gold Coast | atthaionferry.com | 3 |
| 17586 | ORIENT PEARL | Doha | orientpearlqatar.co | 3 |
| 250091 | YACATAN | Paris | yacatan-paris.com | 2 |
| 20823 | SUMIBI STEAK SAKAI | Quioto | g-taste.co.jp | 1 |
| 12104 | CASA | Saint Barths | casastbarth.com | 1 |
| 12110 | Sky Bar | Saint Barths | skybarstbarth.com | 1 |
| 11272 | MOULIN ROUGE | Genebra | moulinrouge-geneve.ch | 1 |
| 27115 | ORI | Salvador | orirestaurante.com.br | 1 |
| 281656 | KALAMATA | Paris | kalamata-paris.com | 0 |
| 22384 | L'INATTENDU BAYONNE | Bayonne | linattendubayonne.com | 0 |

## O que fazer — em ordem

**1. Agora (minutos): parar o envio de código para esses 18.**
Quando alguém pedir o código de acesso para um desses restaurantes, não enviar. Mostrar: *"Para confirmar que você representa este restaurante, escreva para reservation@theworldkeys.com"*. A verificação acontece por escrito e a assistente conduz no idioma da pessoa. Isso fecha a porta sem fechar o caminho — um dono legítimo continua conseguindo, por outro canal.

**2. Esta semana: a regra geral, para não depender desta lista.**
Antes de enviar qualquer código, verificar se o domínio do e-mail está registrado. Um domínio de restaurante sem registro nunca deveria receber código. Assim a proteção vale também para os domínios que expirarem no futuro — e vão expirar.

**3. Esta semana: mostrar o sinal a quem aprova.**
Na tela de aprovação, destacar quando: o e-mail do cadastro for diferente do e-mail do catálogo; o e-mail do catálogo for gratuito (Gmail, Hotmail — são 262 casas); ou o domínio for recém-registrado.

**4. Reduzir o prêmio: histórico de clientes só a partir da posse.**
Quem assume a página hoje vê todo o histórico. Se enxergasse apenas as reservas dali para a frente, um ataque bem-sucedido daria acesso a quase nada. É a proteção mais valiosa das quatro, porque não depende de acertarmos a verificação.

## O que já foi feito deste lado

- Nenhum dos restaurantes desta lista está em qualquer campanha nossa — verificado antes dos envios de hoje.
- Os 18 já constam da lista de contatos inválidos, então nossos próprios e-mails também não vão para eles.
- O acompanhamento diário passa a avisar se aparecer pedido de cadastro vindo de um destes.

## Sobre esses restaurantes

Domínio expirado quase sempre significa casa fechada ou que trocou de identidade. Vale conferir se ainda existem antes de manter a página no ar. O BILLIONAIRE, com 149 clientes atendidos, merece uma mensagem no WhatsApp do catálogo, escrita pela assistente no idioma local.
