# Cópia paralela das reservas de Paris para Maelle Lautard — 2026-11-02

Pedido do fundador: "construir no n8n um fluxo que envia paralelamente todas as reservas de Paris para Maelle Lautard" e vasculhar o banco por qualquer e-mail ligado a ela (concierge ou similar).

## O que o banco diz sobre ela (fato, `twk_ro`, 02/11)

| Onde | O que há |
|---|---|
| `nextauth."User"` | `maellelautard` · `maelle.lautard@gmail.com` · role **CUSTOMER** · criada 16/10/2026 via Google · telefone `+0676787396` |
| `reservations` | 1 pedido: `ZRNDS88T`, BOUM BOUM (Paris), 17/10 01:00, 2 pessoas, detalhe "Vip", Pending → expirado em 18/10 |
| `sales_representatives` | `a2NTp000000gCWDMA2` · **Maelle Lautard** · role **Admin** · cidade **Paris** · 66 rue LaFayette 75009 · mesmo e-mail · telefone `676787396` · foto de documento guardada em base64 (PII sensível na tabela) |
| `contacts_pro`, `rest_contacts`, `restaurant_users`, `nextauth.StaffUser`, `aria_*`, `messages`, `agent_conversations`, `n8n_chat_histories`, `update_events`, `agent_audit_log` | nenhum rastro |

Leitura: ela é a representante ("Admin") de Paris no cadastro herdado do Salesforce — o papel de concierge/representante local que o pedido supõe. O único e-mail dela é o `gmail.com`; não existe endereço corporativo. A tabela `sales_representatives` só é referenciada por `event` e `update_events` (FKs), e nenhuma reserva aponta para ela.

Lacuna: `sales_representatives` tem 7 linhas e guarda `password` (hash) e `id_photo` (foto do documento) — vale uma revisão de retenção à parte; não é o assunto deste fluxo.

## O fluxo

Volume esperado (fato): reservas de Paris por mês, maio a outubro de 2026: 31 · 21 · 19 · 16 · 21 · 12.

O payload do webhook `/nova-reserva` **não traz a cidade** (só `restaurant.id`, `name`, `email`, `phone`). Por isso o fluxo consulta `db_restaurants.city` pelo `restaurant_id` antes de decidir.

Sub-fluxo criado em 02/11 (`nq3IMKBqkP7m0gh0`, **"Paris — cópia para Maelle Lautard"**), fonte da verdade em `orchestrator/agents/notificacao-reserva/copia-paris-maelle.cjs`:

1. `When Executed by Another Workflow` (passthrough: recebe a saída do nó "Code in JavaScript" do fluxo 1).
2. `Restaurante (cidade)` — Postgres, `SELECT … FROM db_restaurants WHERE restaurant_id = $1::text` (credencial "Postgres account 2", a mesma do fluxo 1).
3. `É Paris?` — `city = 'Paris'` (sem distinguir maiúsculas).
4. `Preparar contatos` — Code: junta reserva, casa e cliente e monta os links de contato direto, com mensagem já escrita (código, data, hora, pessoas): `tel:` com o número em formato internacional, `https://wa.me/<dígitos>?text=…` e `mailto:?subject=…&body=…`. Mensagem à casa em francês; ao cliente em inglês (o idioma do cliente não vem no payload). Número sem DDI (ex.: o `+0676787396` da própria Maelle no cadastro de cliente) não ganha botão de WhatsApp e recebe o aviso "numéro sans indicatif international". Escapa HTML dos campos livres (pedido do cliente, nomes).
5. `E-mail para Maelle` — Gmail (credencial "Gmail account"), para `maelle.lautard@gmail.com`, em francês, no visual escuro dos e-mails da casa, em três blocos: RÉSERVATION (código, data, hora, couverts, status, pedido), RESTAURANT (nome, endereço, telefone, e-mail, página) e CLIENT (nome, e-mail, telefone). As ações ficam como **ícones de 28 px na linha do título de cada bloco** (pedido do fundador em 02/11, para caber no celular): telefone, WhatsApp e e-mail nos blocos de casa e cliente; página TWK ("Suivre la demande") no bloco da reserva. Ícones em PNG dourado, porque o Gmail não aceita SVG embutido: WhatsApp, e-mail e site já hospedados no serviço da Aria (`/icons/*.png`); o de telefone foi gerado em 02/11 no mesmo traço (`Agente de Suporte e Concierge/public/icons/phone.png`, Node puro) e é servido pelo n8n em `/webhook/twk-icon-phone` (fluxo ativo `qkU3AliNcrETEpPF`, mesmo padrão aprovado em 28/08 para o ícone do WhatsApp; cache de 1 ano). Rodapé: nunca confirmar mesa antes da resposta do restaurante.
6. Fora de Paris → nó vazio.

Versão em português só para leitura do fundador: gerada pela prévia local (não entra no n8n).

Gancho (**ligado em 02/11**): nó `Paris → Maelle (cópia)` (Execute Workflow, `waitForSubWorkflow=false`) ligado à saída de "Code in JavaScript" no fluxo ativo **"1 - nova reserva (site novo)"**, ao lado de "Tem Email?". Assim a cópia sai no mesmo instante dos e-mails de cliente e casa — paralelo de verdade, sem atrasar a resposta ao webhook. Cobre também a casa de confirmação automática (id 255019) e as casas sem e-mail.

## Estado e aprovação

- Três e-mails de teste enviados a `costa.marlon08@gmail.com` em 02/11 (botões, ícones, botão + barra de ações), pela porta "MAESTRO — Enviar email".
- **Ligado em 02/11 às 19:55 (Europe/Paris 20:55)** com a frase do fundador no chat ("Sim, ligar agora"). O n8n exigiu que o sub-fluxo estivesse publicado antes de ser referenciado: o primeiro `--apply` gravou um rascunho do fluxo 1 e recebeu HTTP 400 na publicação (a versão ativa ficou a antiga, produção intacta); o script passou a ativar o sub-fluxo antes do gancho, e a regravação publicou: fluxo 1 com `activeVersionId = versionId` (15 nós, "Code in JavaScript" → "Tem Email?" | "Paris → Maelle (cópia)"), sub-fluxo `nq3IMKBqkP7m0gh0` ativo (6 nós). Primeiro envio real: na próxima reserva de Paris.
- Desligar: `node orchestrator/agents/notificacao-reserva/copia-paris-maelle.cjs --desligar` (remove o gancho; o sub-fluxo fica ativo e inerte). Tudo gravado em `orchestrator/logs/audit-<data>.jsonl` com `trace_id = trc-copia-paris-maelle-20261102`.

Pontos em aberto (o gancho já está ligado; qualquer um deles se ajusta pelo script):

1. **Dados do cliente no e-mail.** A cópia leva nome, e-mail e telefone do cliente para um endereço `gmail.com` pessoal. Se Maelle só precisa acompanhar o restaurante, dá para tirar o bloco CLIENT (uma linha no script). Se ela também contata o cliente, mantém — e convém um endereço `@theworldkeys.com` para ela.
2. **Só pedidos novos.** O gancho cobre a criação. Respostas da casa (aceite/recusa, fluxo 3) e reagendamentos (fluxo 4) não vão para ela. Se quiser, é o mesmo padrão nos fluxos 3 e 4.
3. **Teste.** O primeiro envio real só acontece quando o próximo pedido de Paris entrar. Para testar antes, o caminho é rodar o sub-fluxo no editor do n8n com um item de exemplo (o script não dispara execuções).
