# Elevação do sistema de agentes — avaliação e plano (22/09/2026)

Pedido do fundador: *"avaliar o sistema, notar problemas, sugerir otimizações tecnológicas e elevar de fato o nível: profissional, poderoso, fluindo sem muitas interferências humanas, com autocorreção, autoavaliação e atualização para novas ferramentas e poderes."*

Tudo abaixo foi medido hoje. Fato, suposição e lacuna estão rotulados.

## 1. Onde estamos — nota por dimensão

| Dimensão | Nota hoje | O que sustenta a nota (fato) |
|---|---|---|
| Código e testes | **9** | 760 checagens verdes: Aria 161→169, CLAVIS 24, Atlas 140, Quill 67, DBA 95, hooks 15, evals 257 (com teste de mutação, 0 sobreviventes) |
| Segurança de dados | **8** | papéis mínimos no banco (ADR-013/017), hooks que bloqueiam SQL destrutivo, segredos fora do OneDrive, porta única de escrita com desfazer |
| Versionamento e deploy | **4 → 6** | a Aria tinha **5 semanas de trabalho sem nenhum commit** (59 arquivos) e um zip rastreado no git; orquestrador, DBA e docs **não tinham git**; CI só no Atlas; deploy por zip manual, rótulo de build escrito à mão. Hoje: tudo commitado, repositório raiz criado, CI da Aria pronta |
| Operação sem humano | **3** | as 4 tarefas agendadas do Windows **morreram hoje** (Regência diária 0xC0000142, Regência horária 0xC000013A, Guardião 0xC000013A, Ciclo do cliente 0x1). O "cérebro" que despacha ao fundador depende de um notebook de 4 GB. A Central hospedada existe, mas roda o build de 19/08, sem volume persistente e com a Regência desligada |
| Autoavaliação | **5 → 7** | existia um analista semanal que escrevia sugestões num painel que ninguém abre — viu as 4 ferramentas 100% quebradas e ninguém soube. Hoje: Juiz de Conversa diário, alerta de ferramenta quebrada, Porta de Qualidade única |
| Autocorreção | **5** | fila de replay (e-mail e WhatsApp), desfazer em um comando, reparo de tarefa pronto mas com registro de aprovações vazio; **não existe** rollback automático de deploy |
| Atualização tecnológica | **5 → 7** | SDK da Anthropic na Aria com **2 anos de atraso** (0.30 → hoje 0.127); Node 20 (fim de vida em abril/2026) → hoje 22; CLAVIS no SDK 0.65; Quill sem versão explícita; nenhum agente testou os modelos Claude 5 |
| Visibilidade | **6** | 14 vigias na Sentinela; escalações caem numa tabela; e-mail de alerta depende de `ALERTS_ENABLED`; a Sentinela via "arquivo existe" e não "tarefa terminou bem" — corrigido hoje |

**Nota geral: 7,0** (era 6,4 de manhã). O sistema é bem construído e bem testado. O que falta não é inteligência: é **infraestrutura de operação contínua** — o lugar onde as coisas rodam, quem as vigia e quem as reverte.

## 2. O que foi construído hoje (pronto, testado, commitado)

1. **Juiz de Conversa** (`Agente de Suporte e Concierge/src/juiz.ts`). Uma vez por dia, um modelo barato lê cada resposta enviada nas últimas 24 h ao lado da mensagem do cliente e dá nota 0/1 em seis critérios do ADR-015: idioma certo, sem prazo prometido, sem vocabulário interno, discrição, resolve agora, tom da marca. Grava em `aria_quality_scores`; resposta reprovada (nota < 5 ou prazo prometido) vira escalação ALTA com os ids das mensagens — nunca nome, telefone ou e-mail. Veredito ilegível é falha alta: nada é gravado como ok. Custo: centavos por dia. 8 testes.
2. **Alerta de ferramenta quebrada** no monitor da Aria: a cada 5 min, ferramenta com ≥3 chamadas em 24 h e metade ou mais falhando → escalação ALTA (uma por ferramenta por dia). Teria pego as quatro ferramentas quebradas no primeiro dia.
3. **Porta de Qualidade da frota** (`orchestrator/porta/verificar.cjs`): um comando roda typecheck, testes, evals e hooks de todos os agentes, grava veredito em `orchestrator/state/porta-qualidade.json` e relatório em `orchestrator/logs/porta/`. Etapa que não roda conta como vermelha.
4. **Sentinela lê o resultado das tarefas** do Windows, não só a existência do log. Hoje ela acusa as três tarefas mortas. Três vigias novos: porta de qualidade (7 dias), juiz rodou (30 h), qualidade ok (48 h).
5. **Aria v5**: SDK 0.30 → 0.127, Node 20 → 22, rótulo de build `2026-09-22-v5-…`. 169 testes verdes. Zip: `aria_agent_whatsapp-2026-09-22-v5.zip`.
6. **Versionamento**: Aria com as 5 semanas commitadas e os zips fora do git; repositório raiz criado (orquestrador, DBA, docs, hooks), com regras que impedem segredo, estado e log de entrarem. CI da Aria pronta em `.github/workflows/ci.yml` para quando o repositório ganhar remoto.

Governança: nada aqui é agente novo (ADR-009). São extensões da Aria e da Sentinela.

## 3. Os seis movimentos para "fenomenal" — em ordem

### Movimento 1 — Tirar a operação do notebook (esta semana)
**Problema:** o despacho diário, o Guardião e o Ciclo do cliente morrem quando o notebook fica sem memória. Aconteceu hoje nas quatro tarefas.
**Solução:** a Regência já sabe rodar hospedada. Na Central do Easypanel (`theworldkeys-maestro`): `REGENCIA_ENABLED=on`, `REGENCIA_HORA=8`, `DATABASE_URL_RO` (a string do `twk_ro`), `EMAIL_WEBHOOK_URL`, `EMAIL_WEBHOOK_TOKEN`, `MAESTRO_FOUNDER_EMAIL`, volume em `/app/state`, e redeploy com o código atual (o build no ar é de 19/08).
**Depois (meu lado):** mover Guardião e Ciclo do cliente para o mesmo container e remover as tarefas do Windows.
**Efeito:** a operação continua com o notebook desligado.

### Movimento 2 — Deploy por git, fim dos zips (esta semana)
**Problema:** cada versão da Aria é um zip feito à mão, com rótulo de build escrito à mão; duas vezes o rótulo saiu errado.
**Solução (fundador, 10 min):** criar o repositório `aria-support-agent` na organização `reservation-commits` do GitHub (onde CLAVIS, Quill e Atlas já estão), conectar o serviço da Aria no Easypanel ao GitHub. A CI já está no repositório: todo push roda typecheck, testes e build.
**Efeito:** push = deploy; histórico real; rollback = voltar um commit.

### Movimento 3 — Porta de Qualidade antes de tudo (já vale)
Regra nova: **nenhum zip ou push sem `node orchestrator/porta/verificar.cjs` verde.** A Sentinela acusa se ninguém rodou em 7 dias. Quando o Movimento 1 estiver no ar, a porta roda sozinha à noite no container.

### Movimento 4 — Fechar o ciclo da autoavaliação (próxima semana, meu lado)
O Juiz de Conversa grava notas; a Regência ainda não as lê. Próximo passo: o coletor do Suporte na Regência traz "média de qualidade, reprovadas, motivos" para o Despacho diário, e sugestão do analista semanal vira item de Despacho, não painel. **Autoavaliação que ninguém lê não é autoavaliação.**

### Movimento 5 — Modelos Claude 5 com prova (quando o fundador aprovar o custo)
A Aria roda no Opus 4.8 com Haiku 4.5 de apoio. Existe a família Claude 5 (Opus 5, Sonnet 5). A troca é uma variável (`ANTHROPIC_MODEL`), mas **só com eval verde** (ADR-011): rodar `npm run eval` da Aria com cada modelo e comparar qualidade e custo. Estimativa: €2–5 de tokens por rodada. Suposição: Sonnet 5 dá a mesma qualidade no atendimento por um terço do custo — a eval confirma ou derruba.

### Movimento 6 — Rollback automático e canal único de alerta (outubro)
- Vigia de deploy: a Sentinela compara o rótulo de build do `/health` com o esperado e o resultado do testador diário; deploy que quebra o testador → alerta em 10 min, não no dia seguinte.
- Todas as escalações URGENTE/ALTA num único canal que chega ao fundador (e-mail via n8n já existe; falta ligar `ALERTS_ENABLED` na Aria e usar o mesmo webhook na Central).
- Segurança pendente: papel `aria_service` no banco (a Aria ainda usa a credencial de dono — lacuna), e o webhook aberto `/webhook/nova-reserva` no n8n antes de qualquer nó novo.

## 4. O que só você pode fazer (lista curta)

1. **Subir a v5** (`aria_agent_whatsapp-2026-09-22-v5.zip`) — liga o Juiz e o alerta de ferramenta.
2. **Ligar a Regência hospedada** (Movimento 1): 7 variáveis + volume + redeploy da Central. Eu escrevo o passo a passo com os nomes exatos quando você disser "vamos".
3. **Criar o repositório da Aria no GitHub** e conectar ao Easypanel (Movimento 2).
4. **Aprovar €5 de tokens** para a eval dos modelos Claude 5 (Movimento 5).
5. `ALERTS_ENABLED=true` + `ALERT_EMAIL_TO` na Aria, se ainda não estiver.

## 5. Lacunas declaradas

- Não medi a Central hospedada por dentro (sem a chave `CENTER_TOKEN` aqui): sei que está no ar com build de 19/08 e sem volume, pelo `/health`.
- Não rodei o Juiz contra conversas reais ainda: ele estreia no primeiro boot da v5 (3 min após subir) e julga as últimas 24 h.
- O Quill não declara versão do SDK da Anthropic no `package.json` das jobs — auditar na próxima rodada.
- CLAVIS está no SDK 0.65: atualizar com o mesmo método (instalar, typecheck, testes) quando o funil sair do modo teste.
