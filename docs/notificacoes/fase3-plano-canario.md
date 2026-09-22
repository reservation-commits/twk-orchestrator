# Plano de canário — notificação de reserva por WhatsApp

> Fase 3. Requer os templates aprovados na Meta e o deploy com as migrations.
> Painel: `docs/notificacoes/fase3-painel-canario.cjs` · Eval: `notificacao-reserva`

## O que o canário prova — e o que não prova

**Prova:** que a trava de telefone está calibrada em tráfego real, que os
templates entregam, que o idioma escolhido faz sentido, e que o cliente não
reage mal (opt-out).

**Não prova:** que a mensagem *converte*. Com ~13 pedidos/dia e 6,8% de aceite,
sete dias não dão amostra para afirmar efeito em conversão. Quem prometer isso
ao fim do canário está lendo ruído. O canário é sobre **segurança de operação**;
conversão se mede depois, em meses.

## Escopo — deliberadamente estreito

| Dimensão | Canário | Por quê |
|---|---|---|
| Evento | **só `pedido_recebido`** | maior volume (~400/mês) e menor dano se errar: não afirma mesa nenhuma |
| Telefone | **só `ENVIAVEL`** | imposto pelo código, não por configuração |
| Idioma | **só `en`** | 1ª leva de templates; US+GB+SG+CA+AU+HK dominam a base |
| Teto | **25 envios/dia** | volume normal ~13/dia; 25 dá folga e ainda barra um surto |
| Duração | **7 dias corridos** | pega um fim de semana, que tem perfil diferente |

Aceite, recusa e cancelamento entram **na fase seguinte**, não nesta. Motivo:
"seu pedido foi recebido" é a mensagem que, se sair errada, causa menos dano —
não promete mesa, não dá má notícia, não oferece alternativa.

O reagendamento fica fora enquanto `reschedule_proposed_date` estiver vazia em
toda a tabela.

## Ligar — nesta ordem

1. **Deploy** com as migrations (cria `aria_outbound_log`). Sem isso o canário
   fica cego e o teto diário barra tudo, por ser fail-closed.
2. Conferir no log do boot: `[dashboard] migrations ok`.
3. Variáveis:

```
RESERVATION_EVENTS_ENABLED=true
RESERVATION_EVENTS_SECRET=<segredo forte>
RESERVATION_EVENT_TEMPLATE_RECEBIDO=twk_reservation_received
RESERVATION_EVENTS_DAILY_CAP=25
REMINDERS_LOCALES=en
REMINDERS_DEFAULT_LOCALE=en
```

Os outros `RESERVATION_EVENT_TEMPLATE_*` ficam **vazios**. Evento sem template
não envia e abre finding — é assim que se vê se o n8n está mandando evento fora
do escopo combinado.

4. No n8n, **um** nó HTTP Request apenas no workflow 1 ("nova reserva"):

```
POST https://<aria>/webhook/reservation-event
     x-aria-secret: <RESERVATION_EVENTS_SECRET>
     { "event": "pedido_recebido",
       "reservation_code": "{{ ... }}",
       "trace_id": "{{ $execution.id }}" }
```

5. **Pré-requisito que não é negociável:** `/webhook/nova-reserva` está sem
   autenticação e com injeção de SQL. Corrigir antes, não depois.

## Acompanhar — todo dia

```bash
cd "Agente Gerenciador do Banco de Dados/twk-db-agent" && NODE_PATH="$PWD/node_modules" node ../../docs/notificacoes/fase3-painel-canario.cjs "$PWD/.env.readonly.local" 7
```

O painel sai com código 1 se algum critério de parada for atingido.

**E uma coisa que o painel não vê:** o *quality rating* do número, que só existe
no WhatsApp Manager. Conferir manualmente todo dia. Se cair para "Medium",
investigar; "Low", parar.

## Critérios de parada

Qualquer um destes derruba o canário. Não são para discussão no calor do
momento — foram escolhidos agora, a frio.

| Critério | Limite | Por quê |
|---|---:|---|
| Falha de envio na Cloud API | **> 5%** dos tentados | template ou número com problema estrutural |
| Opt-out entre quem recebeu | **> 3%** | a mensagem está incomodando |
| Barrados pela trava de telefone | **> 35%** dos eventos | contra 19% medidos em 21/09: a base piorou ou a trava está severa |
| Findings automáticos | **> 3/dia** | algo sistemático quebrou |
| Quality rating na Meta | **Low** | risco de perder o número |
| Qualquer mensagem a destinatário errado | **1 caso** | vazamento de PII; para na hora |

O último não tem percentual de propósito. Um caso basta.

**Como parar:** `RESERVATION_EVENTS_ENABLED=false` e redeploy. Um envio já feito
não volta atrás; por isso o teto diário.

## Go / no-go para a fase seguinte

Seguir para aceite + recusa + cancelamento se, ao fim dos 7 dias:

- nenhum critério de parada atingido;
- **≥ 60 envios** com sucesso (abaixo disso a amostra não diz nada);
- **zero** casos de entrega a destinatário errado;
- a fatia `ENVIAVEL` no painel bater com os 81,2% medidos, ± 10 pontos.

Se o volume não chegar a 60 em 7 dias, **estender o canário** em vez de declarar
sucesso com amostra pequena.

## Riscos aceitos conscientemente

- ~~A camada HTTP não tem teste automatizado.~~ **Resolvido em 21/09.** A guarda
  saiu de dentro da rota para `src/webhookAuth.ts` (módulo puro), com 9 testes
  unitários e 4 casos no eval — incluindo os três buracos clássicos: segredo
  vazio liberando tudo, `timingSafeEqual` lançando com tamanhos diferentes (que
  devolveria 500 em vez de 401) e canal desligado respondendo 401 em vez de 404.
  Provada por mutação: as três sabotagens da guarda reprovam a suíte.
  Resta apenas o roteamento do Express em si, que nenhum teste cobre — vale o
  `curl` de sanidade no primeiro dia (um sem header, um com header errado).
- **O SQL do painel foi validado contra tabela simulada**, não contra a tabela
  real — que não existia quando foi escrito.
- **Número brasileiro para audiência anglófona.** Não é bloqueio do canário, mas
  se o opt-out vier alto, esta é a primeira hipótese a testar.
- **O mesmo número serve o outreach do CLAVIS.** Se o outreach frio rodar durante
  o canário, os dois efeitos se misturam no quality rating. Recomendo **não**
  rodar outreach nos 7 dias.
