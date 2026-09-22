# 00 · Matriz de Lacunas — do Dossiê à decisão "precisa de agente?"

> Sessão 2026-09-02 · trace `trc-agentes0902` · Autor: Arquiteto-Chefe de Agentes
> Fontes primárias: `docs/TWK-Dossie-Conversao-Retencao.fonte.html` (Dossiê, 2026-09-02) · banco `twk_auth` via role `twk_ro` (consultas desta sessão, somente leitura) · `orchestrator/logs/*.json` (campanha, Cañete, saneamento) · `orchestrator/state/*.csv` (ledger, funil, triagem) · Notion "Fluxos n8n — The World Keys" (2026-09-01).
> Rotulagem: **FATO** (verificado na fonte) · **SUPOSIÇÃO** (inferência declarada) · **SEM DADO** (vai para a Fila de Perguntas, não vira agente).

## 0. Números de referência desta sessão (todos FATO, salvo indicação)

| Métrica | Valor | Fonte / método |
|---|---|---|
| Catálogo · publicados · parceiros | 3.764 · 1.548 · 24 | `db_restaurants`, 2026-09-02 |
| Restaurantes com conta profissional | **2** (`restaurant_users`, nenhuma criada após 2026-08-20) | `restaurant_users` |
| Convites de acesso | 1 emitido, 0 concluídos | `restaurant_invitations` |
| Pedidos de mesa/mês (dedup `customer_id`+`booking_date`+`reservation_time`) | abr 464 · mai 543 · jun 407 · jul 378 · **ago 294** | `reservations`, `created_date` |
| Agosto/2026: aceitos · recusados · pendentes | 34 (11,6%) · 66 · 194 (66%) | idem |
| Últimos 90 dias, não-parceiros | 1.051 pedidos · 95 aceitos (**9%**) · 249 casas | `reservations` ⋈ `db_restaurants.partner` |
| Últimos 90 dias, parceiros | 53 pedidos · 27 aceitos (**51%**) · 6 casas | idem |
| Pendências vivas hoje (`expired_at IS NULL`, data futura) | **104 em 66 restaurantes** | `reservations` |
| Casas com ≥1 / ≥5 / ≥10 pedidos em 90d | 255 / 46 / 23 | idem |
| Jantares aceitos já ocorridos · convites de avaliação enviados | 905 · **0** | `review_request_sent_at` |
| `followup_6h_sent_at` preenchido | **0** (o n8n envia o lembrete mas não grava — Notion "Fluxos n8n") | `reservations` |
| Publicados com horário idêntico todos os dias (genérico) | **413 de 1.546** | `opening_hours` (k=1 intervalo, ≥6 dias) |
| Contatos de e-mail mortos (DNS) em publicados | 26 casas, 431 pendências presas | `contatos-invalidos-2026-08-28.csv` |
| `booking_url` preenchido em publicados | **0** | `db_restaurants` |
| `aria_contact_consent` · `aria_handoffs` · `aria_escalations` | 0 · 4 · 4 linhas | tabelas Aria |
| Tempo de primeira resposta do restaurante | **SEM DADO** — não existe timestamp de mudança de `booking_status`; `update_events` está vazia | schema |
| Campanha "Círculo de Fundadores" | 167 envios · 148 restaurantes únicos · 7 ondas (21/08 a 01/09) | `envios-fundadores-2026-08.csv` |
| Campanha: abertura | **SEM DADO** (sem pixel de abertura; cliques via n8n `/go` ainda não lidos) | logs de disparo |
| Campanha: funil parcial (40 casas das ondas 1-2, em 31/08) | 1 "ativou" (não verificável em `restaurant_users`) · 3 só auto-resposta · 33 sem reação · 3 não entregues | `funil-campanha-fundadores-2026-08-31.csv` |
| Clientes que voltaram a pedir | Dossiê: 0,8% · esta sessão: 1.112 de 13.970 (8,0%) por dedup de data+hora — **divergência de método**, ver §3 | `reservations` |
| Pedidos de remoção/correção recebidos | 1 formal (Bar Cañete, 28/08) · volume mensal **SEM DADO** | `2026-08-28-canete-remocao.json` |

> Nota sobre "~130 e-mails, abertura alta, criação de conta baixa" (enunciado desta sessão): o número real é 167 envios / 148 casas; "abertura alta" **não está medida em lugar nenhum** — é SUPOSIÇÃO do enunciado. O que é FATO: 0 contas novas em `restaurant_users` desde o início da campanha. O diagnóstico "conversão/fricção/ausência de humano" se sustenta pelo caso WOO TENDER (pediu código de acesso 2×, não concluiu o formulário) e pelo Dossiê nº 05 (não há porta de entrada no site).

## 1. A matriz

Legenda de cobertura: **total** = alguém já resolve · **parcial** = existe mecanismo, mas incompleto ou desligado · **zero** = ninguém.
Legenda de solução: `PRODUTO` · `N8N` (regra determinística) · `EXT:<agente>` (extensão de agente existente) · `HUMANO` · **`AGENTE NOVO`**.

| # | Problema (Dossiê) | Evidência (número/fonte) | Quem cuida hoje | Cobertura | Melhor solução | Justificativa |
|---|---|---|---|---|---|---|
| H | **Gargalo nº 1: pedido nasce pendente e morre sem resposta** | 6/100 confirmados (Dossiê); ago: 34 aceitos de 294; não-parceiro aceita 9% (banco) | n8n lembrete 6h/12h (cliente 2×, restaurante 1×; nada gravado) · Aria `pendingWatch` DESLIGADA · CLAVIS `fulfillment` só parceiros (6 casas com movimento) · esteira manual de 31/08 (14 nudges à mão) | parcial | **AGENTE NOVO — Guardião da Reserva** (núcleo determinístico, LLM só na composição) | Nenhum componente existente é dono da reserva ponta-a-ponta, nenhum escala de canal, nenhum fala a verdade ao cliente, nenhum mede. O n8n não pode fazer roteamento por canal + estado + handoff a Aria/CLAVIS sem virar um segundo orquestrador. |
| 01 | Nota falsa no schema do Google (`aggregateRating`) | 12.299 páginas (Dossiê) | ninguém (dado em `structured_data_json`, dono Editorial) | zero | `PRODUTO` + `EXT:editorial` (validação) | É remoção de marcação no front. O Quill só precisa de um check "nunca emitir rating sem review real" no gerador. Sem agente. |
| 02 | Promessa "confirmação instantânea" | 1.540 casas sem dono na página (Dossiê) | ninguém | zero | `PRODUTO` (copy por status parceiro/não-parceiro) | Texto de site. O Guardião **consome** a expectativa honesta ("confirmamos em até X h") mas não a cria. |
| 03 | Horários fatiados em 30 min vendidos como vaga | Pierre Gagnaire sempre livre (Dossiê); 413 horários genéricos (banco) | ninguém | zero | `PRODUTO` (preferência, não vaga) + item 13 | Lógica de UI. O dado genérico é o item 13. |
| 04 | Formulário de contato inexistente | 1 página (Dossiê) | ninguém | zero | `PRODUTO` | Um formulário; opção "sou restaurante" roteia ao CLAVIS por n8n. |
| 05 | Restaurante não tem por onde entrar | 2 contas/1.548; convite usado 9× na história (Dossiê); hoje 1 convite, 0 concluídos (banco) | ninguém | zero | `PRODUTO` (página "Para restaurantes" + "é o dono?" em cada ficha) | **Pré-requisito** de qualquer agente de ativação. Mandar 148 e-mails sem porta deu 0 contas: o gargalo é a porta, não o follow-up. |
| 06 | Nunca contamos ao dono a demanda dele | SRI TRAT 410 pedidos/ano (Dossiê); 255 casas com movimento em 90d (banco) | CLAVIS (composer + ledger) — usado 1× na campanha, com número real por casa | parcial | `EXT:comercial` — relatório mensal determinístico, **depois** do 05 | Já foi feito uma vez (167 envios com "N clientes pediram mesa"): 0 ativações verificáveis. Repetir mensalmente sem porta de entrada é ruído. Vira rotina do CLAVIS quando o 05 existir. |
| 07 | Quem pediu para sair pode voltar ao ar | Cañete: despublicado à mão; sem marca "não relistar"; `republish_no_photo.js` republica por flag (log 28/08) | runbook manual `docs/runbooks/pedido-de-remocao-estabelecimento.md` | parcial | **`EXT:suporte-concierge` + `EXT:dba`** — Registro de Opt-out de Listagem (tabela + intake + SLA) | Volume mensal SEM DADO (1 caso), mas o risco é assimétrico e o mecanismo não existe (`aria_contact_consent` = 0 linhas; nada cobre listagem). Determinístico: tabela, flag respeitada por importador/publicador, classificação de intake pela Aria (que já lê support@). Não justifica agente próprio. |
| 08 | Parceiros invisíveis (selo travado em falso) | 14 parceiros marcados (Dossiê); 24 no banco | ninguém | zero | `PRODUTO` | Bug de front. |
| 09 | Não existe vida depois do jantar | 905 jantares aceitos, 0 avaliações, 0 lembretes (banco); flags `REMINDERS/REVIEW/BRIEFING_ENABLED` = false na Aria; cron n8n de review desativado | Aria (código pronto, desligado) | parcial | `EXT:suporte-concierge` (ligar flags após medir represado) + `N8N` (um dono por notificação) | Interruptor, não agente. Volume: ~34 aceitos/mês → ~34 lembretes + ~34 convites/mês. Regra: **um dono por notificação** (Aria OU n8n), senão o cliente recebe dois. |
| 10 | Muro de cadastro no último passo | ponto de abandono (Dossiê) — taxa **SEM DADO** | ninguém | zero | `PRODUTO` | Reserva como convidado. Sem agente. |
| 11 | Calendário cobre o botão | defeito de UI (Dossiê) | ninguém | zero | `PRODUTO` | Horas de front. |
| 12 | Telefone/site entregues antes da reserva | vazamento de demanda (Dossiê) — volume **SEM DADO** | ninguém | zero | `PRODUTO` | Decisão de layout. |
| C1 | Concierge fechando por telefone (Atenas, Marrakech, Paris; Bangkok 699 pedidos/4 aceites) | Dossiê "Contínuo"; kit de ligações existe (`kit-ligacoes-whatsapp.md`) | humano (Márlon), sem fila nem medição | parcial | **Guardião da Reserva** gera a fila de mensagens (texto no idioma da casa) + `HUMANO` envia | Contato humano, mas SEMPRE por escrito: o time não fala os idiomas das casas (decisão do fundador, 06/09). O que falta é a fila priorizada por urgência com o texto pronto, e o registro do desfecho — isso o Guardião produz. |
| C2 | Concentrar o catálogo (25 cidades duplicadas, 160 com <10 casas, vitrine de Londres) | Dossiê "Segundo mês" | DBA + Quill (donos), sem tarefa aberta | zero | `EXT:dba` + `EXT:editorial` via `/delegar` | Trabalho de especialista existente. Sem agente. |
| 13 | Horários genéricos no catálogo | **413/1.546 publicados**; 28 dos 66 com pendência viva (banco) | DBA (`fill_hours_places.js`) · n8n "Atualização horarios" (Places → `opening_hours`, escopo desconhecido) | parcial | `EXT:dba` (rodar auditoria + proposta em lote, aprovação) | Cada um é um Cañete em potencial. Script existe; falta rodar com aprovação e medir. Hipótese 7 da Seção 4.1 **rejeitada como agente**. |
| 14 | Contatos de e-mail mortos | 26 casas, 431 pendências presas, 5 com demanda em 90d | DBA (varredura de 28/08) | parcial | `EXT:dba` (validação MX recorrente) + Guardião **roteia por telefone/WhatsApp** quando e-mail morto | O Guardião precisa saber que o canal está morto para não "escalar" para o vazio. |
| 15 | Sem registro de consentimento/opt-out unificado | `aria_contact_consent` = 0 linhas; CLAVIS não consulta (frota.md); e-mails da campanha **sem link de opt-out** (verificado nos templates) | Suporte (dono declarado, ADR-004), nada implementado | zero | mesma solução do 07 (Registro de Opt-out) + `EXT:comercial` (rodapé com opt-out) | Guardrail 8 desta sessão: "nunca contato em massa sem opt-out funcional". Hoje a campanha viola isso. |
| 16 | Tempo de resposta do restaurante não é medido | sem timestamp de status; `update_events` vazia; lembrete n8n não grava | ninguém | zero | Guardião (tabela própria de eventos) + `PRODUTO` (coluna `status_changed_at` na plataforma) | Sem isso não há KPI de SLA nem baseline. O Guardião cria o próprio ledger de eventos; a coluna na plataforma é pedido ao front. |
| 17 | Software de reserva por restaurante (TheFork, Zenchef, OpenTable…) | `booking_url` = 0 preenchidos; sem coluna de software | ninguém | zero | **SEM DADO** → Fila de Perguntas; coleta barata: campo no formulário "é o dono?" + Places `website`/`reservation` | Hipótese 3 (Conector) **rejeitada** por falta de dado e de parceiros (24). |
| 18 | Aria respondia a donos sem conhecer o fluxo de conta (WOO TENDER) | log 31/08 | Aria — FLUXO 6 adicionado em 31/08, **redeploy pendente** | parcial | `EXT:suporte-concierge` (já feita; falta deploy) | Resolvido em código. |
| 19 | Webhooks n8n sem autenticação + SQL interpolado no fluxo 1 | 14/17 webhooks abertos (Notion) | ninguém | zero | `PRODUTO`/infra (n8n) | Segurança. Fora do escopo de agente, mas bloqueia qualquer agente que dependa do n8n para enviar. |
| F1 | **Fidelizar o restaurante** (parceiro que ativou precisa sentir valor) | 24 parceiros; 6 com movimento em 90d; 51% de aceite vs 9%; assinaturas pagas: **SEM DADO** nesta sessão (Atlas não consultado) | CLAVIS (funil) · Atlas (receita) — sem sinal de churn definido | zero | `EXT:comercial` + `EXT:financeiro` — **adiar** até haver ≥30 parceiros ativos | Hipótese 5 **rejeitada agora**: com 6 parceiros com movimento, "detectar churn" é olhar uma lista. O relatório mensal (item 06) cobre o "sentir valor". |
| F2 | **Fidelizar o cliente final** (quem reservou pode voltar) | Dossiê 0,8% · sessão 8,0% (métodos diferentes); 10.397 pediram 1× e sumiram sem resposta | Aria (flags desligadas) | parcial | `EXT:suporte-concierge` (item 09) + Guardião (o cliente que ouviu a verdade volta; o que ficou no vácuo não) | A retenção do cliente é consequência de resposta. Sem agente próprio. Hipótese 6 **rejeitada**. |

**Contagem:** 24 linhas · **1** agente novo (H) · 2 extensões aprovadas para construção (07/15 → Registro de Opt-out; 06 adiada) · 10 linhas resolvidas por produto/infra · 3 SEM DADO (10, 12, 17 + tempo de resposta e volume de remoções).

## 2. O que a matriz diz, em três frases

1. **O gargalo nº 1 é operacional, não de visibilidade**: 294 pedidos em agosto, 34 aceitos. Um restaurante que responde vale mais que cem e-mails de prospecção.
2. **Metade do Dossiê é front-end**: itens 01, 02, 03, 04, 05, 08, 10, 11, 12 não têm agente possível. Sem o 05 (porta de entrada), qualquer agente de ativação empurra o dono para uma parede.
3. **O que falta não é inteligência, é dono e registro**: opt-out (0 linhas), tempo de resposta (sem timestamp), software de reserva (0 dados). Antes de "agente", tabela.

## 3. Divergências e lacunas de dado registradas (vão para a Fila de Perguntas em `03-arquitetura-integracao.md` §9 e `SUMARIO.md`)

- **Retorno de cliente:** Dossiê diz 0,8%; a consulta desta sessão dá 8,0% (1.112/13.970 clientes com ≥2 combinações data+hora distintas). SUPOSIÇÃO: o Dossiê mede "voltou a pedir *depois de ter mesa confirmada*". Precisa de definição única antes de virar KPI.
- **Abertura de e-mail:** não medida. Cliques existem no n8n (`/go`, workflow `HoFjhfqzPmCAkrnZ`, invisível ao conector; o painel da Aria lê via `N8N_API_KEY`).
- **Ativações:** 0 novas linhas em `restaurant_users` desde 20/08. O "ativou" do BOTECO BELMONTE (25/08) não é verificável no banco.
- **Tempo de resposta:** impossível reconstruir historicamente. Baseline do Guardião começa no dia 0 do canário.
- **Pedidos de remoção/correção por mês:** 1 caso formal. O canário do Registro de Opt-out (classificador sobre as caixas support@/reservation@) produz o primeiro número.
- **Software de reserva por casa:** 0 dados.
- **Receita por parceiro / assinaturas ativas:** não consultado nesta sessão (Atlas); necessário para F1.
