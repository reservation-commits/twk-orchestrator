# Proposta — poderes novos e agentes novos (2026-09-21)

> Orquestrador · Fontes: `00-matriz-de-lacunas.md` (02/09), `auditoria-frota-2026-09-21.md`, banco `twk_auth` via `twk_ro` (medições desta sessão). Rotulagem: **fato** × **suposição** × **lacuna**.
> Regra de casa (ADR-009): agente novo só nasce de gargalo **medido**; máx. **2 iniciativas por ciclo de 30 dias**; nada entra em canário sem `node orchestrator/evals/run.js` verde. O Guardião entrou em 02/09 → **resta 1 vaga neste ciclo** (até 02/10); o próximo ciclo abre 2.

## 0. O que a medição de hoje diz, e que muda a proposta

| Medição | Valor | Consequência |
|---|---:|---|
| Restaurantes publicados com **celular** (WhatsApp possível) | **338 de 1.546 (22%)** | WhatsApp ao restaurante não pode ser o canal universal — 70% são linha fixa |
| Idem, entre os 63 com pendência viva | **12 (19%)** | o gargalo nº 1 (H) não se resolve por WhatsApp; resolve-se por e-mail acionável, telefone e — hipótese — voz |
| Clientes que reservam com celular válido | **81%** (Fase 0) | do lado do **cliente**, o WhatsApp é o canal certo — já construído hoje |
| Agentes escrevendo como `postgres` | 3 | o poder que mais importa agora é o que **impede regressão**, não o que adiciona feature |
| Outbound da Aria inerte sem ninguém notar | meses | falta um vigia de **silêncio**, não de erro |

## 1. Ordem recomendada

| # | Iniciativa | Tipo (ADR-009) | Gargalo medido | Custo | Precisa de você |
|---|---|---|---|---|---|
| **1** | **Zelador de Privilégios** — *entregue hoje* | extensão do DBA | 3 agentes como `postgres`; 2 papéis nunca criados | feito | aprovar entrada na Regência (novo fluxo) |
| **2** | **Sentinela de Silêncio** | extensão da Regência (zero LLM) | outbound inerte por meses; agendador do notebook morre calado | 1 dia | aprovar como coletor |
| **3** | **Sentinela n8n** | extensão do Orquestrador | item 19: webhooks abertos + SQL interpolado; conector vê 17 de 61; IF booleano engoliu lote (17/09) | 1–2 dias | `N8N_API_KEY` só-leitura |
| **4** | **Registro de desfecho de ligação** | extensão do Guardião | item 16: tempo de resposta do restaurante **SEM DADO** | ½ dia | usar o formulário/CLI a cada ligação |
| **5** | **WhatsApp interativo ao restaurante — canário nos 22%** | extensão Guardião + Aria | H (6,8% de aceite) — alcance limitado a 338 casas | 3–4 dias | template na Meta; decisão do número; consentimento de listagem |
| **6** | **Juiz de conversa da Aria** | extensão de eval | prompt de 678 linhas com 8 evals | 2 dias + API | orçamento de tokens |
| **7** | **Hospedar Regência e crons** | infra (não conta como iniciativa) | incidentes 04/09 e 11/09 | ½ dia | Easypanel |
| — | Agente de voz para restaurantes | **hipótese** | 1.075 casas só com fixo | alto | reverter a decisão de 06/09 ("sempre por escrito") |

**Este ciclo (1 vaga):** a Sentinela de Silêncio (2). É a mais barata e a que protege todo o resto — inclusive o que foi ligado hoje.
**Próximo ciclo (2 vagas, a partir de 02/10):** Sentinela n8n (3) e o canário de WhatsApp ao restaurante (5), com o registro de desfecho (4) rodando antes para haver baseline.

Nada aqui é **agente novo** no sentido do ADR-009. Depois de ler a matriz e o código, a conclusão é a mesma de 02/09: o que falta não é inteligência, é registro, vigia e hospedagem.

---

## 2. As propostas

### 2.1 Zelador de Privilégios — entregue

`orchestrator/agents/zelador-privilegios/verificar.js`. Lê o **usuário** das URLs de banco nos `.env` locais (nunca a senha), cruza `pg_roles`, `pg_db_role_setting` e `pg_class.relacl` via `twk_ro`, e emite achados no contrato do relato (ADR-012). Rodou hoje: **9 achados, 4 críticos**, todos com a correção ao lado (`docs/runbooks/privilegios-minimos-2026-09-21.md`). Achou um que a auditoria manual não viu: `clavis_ro` sem `default_transaction_read_only` imposto pelo servidor.

### 2.2 Sentinela de Silêncio

**O problema.** Os vigias existentes detectam *erro* e *queda de número*. Ninguém detecta *ausência*: o outbound da Aria ficou inerte por meses com `[reminders] ativo` no log; o ciclo-cliente morre com o notebook e o log do dia simplesmente não existe; o `followup_6h_sent_at` está em 0 desde sempre porque o n8n envia e não grava.

**O poder.** Um coletor determinístico na Regência com uma tabela de **cadências esperadas**:

| Fonte | Esperado | Silêncio = |
|---|---|---|
| `aria_outbound_log` | ≥1 linha/dia útil quando `RESERVATION_EVENTS_ENABLED` | 2 dias sem linha |
| `agent_audit_log` (pg_cron `expire_stale_pendings`) | 1 linha/dia às 03:00 | 1 dia sem |
| `orchestrator/logs/tarefas/ciclo-cliente-<data>.log` | 1 arquivo/dia | ausente |
| Guardião `state/eventos.jsonl` | ≥1 evento/dia com pendência viva > 0 | 2 dias sem |
| n8n execuções do workflow 1 | ≥1/dia (há ~13 pedidos/dia) | 1 dia sem |
| `aria_messages` inbound | ≥1/dia | 3 dias sem (WhatsApp caído ou webhook quebrado) |

Métrica ausente é lacuna, nunca zero (regra da casa). Achado `critica` quando a fonte tem dado histórico e para.

**Custo.** 1 dia. Zero LLM. **Aprovação:** entra na Regência = novo fluxo orquestrado.

### 2.3 Sentinela n8n

**O problema.** O n8n é ponto único de falha de toda a comunicação (61 workflows), o conector MCP vê 17, os webhooks de produção estão abertos e o workflow 1 interpola SQL — achados de 24/08 sem confirmação de correção. Em 17/09 um agendamento rodou `success` em 7 s e enviou 0 e-mails.

**O poder.** Export diário de **todos** os workflows pela API REST (`/api/v1/workflows`, escopo só-leitura), diff contra o export anterior (guardado em `orchestrator/state/n8n/`), e um lint determinístico: webhook sem autenticação, nó Postgres com `{{ }}` dentro de string SQL, IF booleano sobre campo que pode faltar, nó Gmail com `<img>` (lição de 24/08), workflow ativo sem nós conectados. Achado por regra, com o JSON do nó como evidência.

**Custo.** 1–2 dias. **Precisa:** `N8N_API_KEY` com `workflow:read` apenas (a credencial atual tem `delete/update/execute` — reduzir).

### 2.4 Registro de desfecho de ligação

**O problema.** Matriz item 16: tempo de resposta do restaurante é **SEM DADO**; `update_events` vazia; nada grava quando o time liga. O Guardião gera a fila (`fila-ligacoes-<data>.csv`), mas o desfecho volta em silêncio.

**O poder.** `node orchestrator/agents/guardiao-reserva/desfecho.js <codigo> <atendeu|nao_atendeu|aceitou|recusou|propos> --nota "…"` grava no ledger `eventos.jsonl` e, quando o desfecho for aceite/recusa/proposta, aplica pela plataforma (`gerir-reserva.js`, que já existe). Com isso nasce a primeira baseline de SLA por casa — e o Guardião para de re-enfileirar quem já foi ligado.

**Custo.** ½ dia. Determinístico. A disciplina de usar é humana.

### 2.5 WhatsApp interativo ao restaurante — canário nos 22%

**O problema.** H: 6,8% de aceite. O degrau 2 do Guardião é fila humana de WhatsApp.

**O poder.** Para as casas com celular válido (`phoneQuality` sobre `telephone_of_the_establishment`) **e** sem opt-out de listagem, o degrau 2 vira template com três botões — *Aceitar · Recusar · Propor horário* — cuja resposta a Aria aplica pela API da plataforma (`manageReservation`, o mesmo caminho do `/r/`). Reaproveita `sendInteractiveButtons`, o registro de opt-out e o ledger do Guardião.

**Limites, com número.** Alcança **338 casas** (22%) e **12 das 63** com pendência hoje. É complemento, não substituto, do telefone. Divide o *quality rating* com a notificação ao cliente — outreach a restaurante bloqueado derruba a mensagem ao cliente junto. Por isso: canário de 30 dias, teto diário, e decisão prévia sobre o número (o `+55 21` para casas em Paris e Roma é o mesmo problema da Fase 2).

**Custo.** 3–4 dias. **Precisa:** template aprovado na Meta (categoria UTILITY, idiomas FR/IT/EN/PT), a decisão do número, e a regra da constituição: registro de opt-out ilegível = nenhum contato.

### 2.6 Juiz de conversa da Aria

**O problema.** 156 testes unitários e **8** evals com modelo para um system prompt de 678 linhas. O comportamento do modelo é o menos medido de todos, e foi onde aconteceu o incidente de 11/09.

**O poder.** 50+ casos a partir de conversas reais anonimizadas (`aria_messages`, sem PII), com um juiz (Haiku) sobre as regras do ADR-015: promessa de prazo, disponibilidade, idioma, vocabulário interno, alternativa só com `confirma_pedidos`. Roda no CI da Aria com orçamento fixo. Reprova = não deploya.

**Custo.** 2 dias + tokens (estimar antes; teto no config).

### 2.7 Hospedar Regência e crons

Não é iniciativa de agente; é o que impede que 2.2, 2.4 e o ciclo-cliente morram com o notebook. O README da Regência já descreve o modo hospedado (`REGENCIA_ENABLED=on` no serviço da Central). ½ dia.

### 2.8 Hipótese rejeitada por ora — voz para restaurantes

**Fato:** 1.075 casas publicadas só têm linha fixa; o time não fala os idiomas (C1). **Suposição:** um agente de voz (Claude + telefonia) seria a única automação que alcança 70% das casas. **Bloqueio:** contradiz a decisão de 06/09 ("contato sempre por escrito") e não há medição de quantas pendências morrem em casas *só* com fixo. **Próximo passo barato:** medir isso (uma consulta) antes de qualquer conversa sobre voz.

---

## 3. Adições de poder por agente existente (sem ciclo, sem aprovação nova)

| Agente | Adição | Por quê |
|---|---|---|
| **DBA** | scripts da raiz chamam a API do app (`/api/db mutate`) em vez de conectar direto | herdam allowlist, HMAC e raio de dano; hoje só 9 dos 35 auditam |
| **Quill** | `SERP_MODE=real` com provedor e teto de custo | canibalização/oportunidades rodam sobre mock |
| **CLAVIS** | consumir a fila do Guardião em vez de motor próprio de fulfillment | dois donos da mesma pendência é o que a matriz proíbe |
| **Atlas** | nada até haver volume | está dimensionado acima do uso; mérito |
| **MAESTRO** | identidade por operador na Central (como Atlas e Aria têm) | um token único não diz quem aprovou |
| **Aria** | mapear IT/DE em `locale.ts` | 991 clientes entregáveis caem em inglês |

## 4. O que eu não sei

Se o n8n ainda tem o SQL interpolado (só a API confirma); qual o custo real do juiz (depende do tamanho médio das conversas); se a Meta aprova template com botões para restaurante na categoria UTILITY (é interação transacional, deve aprovar — **suposição**).
