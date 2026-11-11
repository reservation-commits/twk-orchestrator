# Casas com número bloqueado no WhatsApp (sem WhatsApp no fixo) — levantamento de 10/11/2026

**Pergunta do fundador:** os restaurantes estão recebendo as mensagens de reserva por WhatsApp?
**Resposta curta:** sim, para as casas com celular válido (10 envios a 6 casas em 14 dias, 9 entregues ou lidos). Não para 6 casas cujo único número cadastrado é fixo: a Meta devolveu "Message undeliverable" uma vez e a Aria pôs o número na lista de bloqueio (`aria_contact_consent.whatsapp_indisponivel = true`, v19). Enquanto não houver celular, todo evento dessas casas termina em `sem_destinatario`.

Fonte: `aria_outbound_log`, `aria_delivery_status`, `aria_contact_consent`, `db_restaurants` (papel `twk_ro`, 10/11/2026). Buscas na web de 10/11 para os celulares. Tudo rotulado fato × suposição × lacuna.

## As 6 casas

| Casa | Cidade | Eventos perdidos (14 d) | Pedidos/90 d (quando marcada) | Fixo bloqueado | Celular encontrado | Situação |
|---|---|---|---|---|---|---|
| ATHÉNÉE (58502) | Atenas | 14 | 15 | +30 210 325 1430 | **nenhum** — site atrás de verificação anti-bot (Cloudflare), listagens só com o fixo | pedir à casa |
| SRI TRAT (35219) | Bangkok | 12 | 92 | +66 2 088 0968 | **nenhum** — site sritrat.com recusa conexão; OpenRice, Wongnai e Time Out só com o fixo | pedir à casa |
| LE TOBSIL (81583) | Marrakesh | 6 (antes de 05/11) | — | +212 524 444 052 | **já resolvido**: +212 663 610 534 (contato Christine, celular dado pelo fundador em 05/11); entregas desde então `delivered`/`read` | nada a fazer |
| BOTECO BELMONTE (253542) | Rio de Janeiro | 3 | 29 | +55 21 2267-9909 | **nenhum** — listagens só com fixos por unidade (Flamengo 2552-3349, Lapa 2224-2169); ver alerta de catálogo abaixo | pedir à casa |
| A PETISQUEIRA (69928) | Lagos | 1 | 20 | +351 282 037 406 | **candidato: +351 924 714 439** (listagem "Inside Lagos", PressReader, 04/2024; prefixo 9 = móvel em Portugal). Suposição: tem WhatsApp. Não confirmado | confirmar e cadastrar |
| MY SUSHI (70083) | Lagos | 1 | 45 | +351 282 798 221 | **nenhum** — só o fixo em todas as listagens; página oficial é um Facebook (não lido) | pedir à casa |

Fato: as 6 têm e-mail de reservas no catálogo (`email_for_reservations`), então o pedido de reserva segue chegando por e-mail, se o canal de e-mail estiver ativo para elas. Lacuna: não conferi a entrega desses e-mails neste levantamento.

## Alerta de catálogo (para o DBA e o Editorial)

`db_restaurants.site_url` do BOTECO BELMONTE aponta para `https://botecobelmonte.com.br/`, que hoje é um blog genérico de template (artigos sem relação, contato "(38) 9.9129-3987", e-mail `atendimento@gr3web.com.br`, texto "Lorem ipsum"). O domínio não é mais da casa. Esse telefone **não** é da casa e não deve ser cadastrado. Sugestão: zerar `site_url` ou trocar pelo Instagram oficial (`@boteco_belmonte`) após conferência.

## Como corrigir (pela porta, com registro)

1. **A Petisqueira**: o fundador confirma o celular (uma ligação ou uma mensagem) e, com a frase dele, o DBA grava uma linha nova em `aria_contact_consent` (`tipo = 'estabelecimento'`, `restaurant_id = '69928'`, `whatsapp_reservas = true`, `motivo` com a origem) — mesmo modelo da linha do Le Tobsil de 05/11. A linha antiga do fixo fica como está (bloqueada). Escrita reversível ≤ 200 linhas, com `-- backup:`, por `executar.js --apply --autonomo` (ADR-017).
2. **Athénée, Sri Trat, Boteco Belmonte, My Sushi**: não há celular público. O caminho é **perguntar à casa**, no idioma dela, pelo e-mail de reservas do catálogo: uma frase pedindo o número de WhatsApp onde querem receber os pedidos (modelo do Programa OUI). Envio externo a estabelecimento = aprovação do fundador (tabela de escalonamento); o texto fica pronto para ele aprovar. Quando a casa responder pelo WhatsApp, a Aria tira o número da lista de bloqueio sozinha (v19: "o número nos escreveu — tem WhatsApp").
3. Ordem pela perda: Sri Trat (92 pedidos/90 d) e Athénée (15, mas 14 eventos em 14 dias) primeiro.

## O que não fazer

- Não cadastrar número achado na web sem confirmação da casa: mensagem de reserva a um número errado é vazamento de dado de cliente.
- Não forçar reenvio ao fixo: a Meta já disse `undeliverable`, e insistir derruba a qualidade do número da Aria.
