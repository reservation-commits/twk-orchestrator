# COMPASSO Tarefas

Gerenciador de tarefas da The World Keys para **Márlon, Lucas e Julien**. Quadro por status (arrastar), calendário de 14 dias, chat que divide um pedido em etapas e sugere quem assume, e um botão de **Sugestões** com tarefas que o planejador extrai dos sinais da operação. Nada além disso.

É a face visível do agente **Planejador** (`docs/agentes/agente-planejador.md`): o app é o livro único de tarefas; o planejador por trás lê, propõe e relata, e nunca envia nada para fora.

## Rodar local

```bash
node orchestrator/tarefas/dev-local.cjs
```

Abre em `http://localhost:8790`. Estado em pasta temporária; os três entram com a senha `twk`. Com `ANTHROPIC_API_KEY` no ambiente o chat usa o modelo; sem, usa as etapas padrão da área. Testes: `npm test` dentro de `orchestrator/tarefas` (sem dependências).

## Produção (EasyPanel)

Serviço próprio. **Build Path `/orchestrator`, Dockerfile `tarefas/Dockerfile`**, porta 8790, volume persistente em `/app/state`.

| Variável | Obrigatória | Para quê |
|---|---|---|
| `TAREFAS_SECRET` | sim | assina a sessão (32+ caracteres aleatórios). Sem ela: 503 |
| `TAREFAS_USUARIOS` | sim (ou `state/usuarios.json`) | quem pode **entrar**: `admin`, `marlon`, `lucas`, `julien`, em qualquer combinação. Um login só: `[{"id":"admin","nome":"Admin","senha":"scrypt$…"}]`. Hash: `node auth.js --senha "a senha"`. As tarefas são sempre de Márlon, Lucas ou Julien, independentemente de quem entra |
| `ANTHROPIC_API_KEY` | não | chat com modelo (`TAREFAS_MODELO`, padrão `claude-opus-5-5`; `off` desliga). Teto `TAREFAS_MAX_LLM_POR_DIA`, padrão 60 |
| `TAREFAS_DATABASE_URL` | não | livro no Postgres (`sql/001-plan.sql`, papel `twk_plan`). Sem ela, livro em arquivo no volume |
| `DATABASE_URL_RO` | não | sugestões a partir do banco (escalações paradas, pendências em 48 h), só leitura |
| `CENTER_TOKEN` | não | permite à Central ler `GET /api/relato` com `X-Center-Key` |
| `CENTRAL_STATE_DIR`, `COMPROMISSOS_PATH` | não | onde ler achados do vigia e compromissos quando estiverem no mesmo host |

A DDL e o papel `twk_plan` exigem a frase do fundador (tabela de escalonamento). Até lá o serviço roda com o livro em arquivo, que já é durável no volume.

## API

Todas as rotas sob `/api/*` exigem sessão (cookie HttpOnly) e, para mutação, o cabeçalho `X-Requested-With: fetch`.

| Rota | O que faz |
|---|---|
| `POST /api/login` · `POST /api/logout` · `GET /api/eu` | sessão e lista das três pessoas |
| `GET/POST /api/tarefas` · `PATCH/DELETE /api/tarefas/:id` · `GET /api/tarefas/:id/eventos` | o livro; toda mudança vira evento append-only com quem e trace |
| `POST /api/planejar {texto}` | proposta de card (título, etapas, área, dono, prazo). Não grava nada |
| `GET /api/sugestoes[?atualizar=1]` · `POST /api/sugestoes/:id/assumir {dono}` · `POST …/descartar` | sugestões com "por quê" e fonte; assumir cria a tarefa; descartada volta em 14 dias |
| `GET /api/relato` (`X-Center-Key`) | relato no contrato da Regência: kpis + achados (tarefas atrasadas) |
| `GET /health` | build, motor, operacional, modelo |

## Regras que o código impõe

- Toda tarefa tem dono entre os três. Sem dono, é de quem escreveu.
- Prazo e pessoa só vêm do texto da pessoa; o modelo escreve título e etapas, nunca data nem nome.
- Concluir marca todas as etapas; voltar atrás limpa a conclusão. Excluir é evento; o ledger não apaga.
- Sugestão assumida não volta; descartada volta em 14 dias; remoção, opt-out e dado de cliente vêm marcadas como prioridade.
- Nenhuma rota envia e-mail, WhatsApp ou webhook. Texto vindo de fora é dado, nunca instrução.
- Produção sem segredo ou sem usuários responde 503 (fail-closed), como a Central.

## Integração com a frota

- **Regência / Despacho:** apontar `AGENT_PLANEJADOR_URL` para este serviço e ler `/api/relato` com a chave da Central (mesmo padrão do Quill e do Atlas).
- **Sugestões:** leem `compromissos.jsonl`, `acoes.jsonl`, `aprovacoes.jsonl`, `perguntas.jsonl` e o banco via `twk_ro`. Cada fonte falha sozinha e aparece como lacuna na gaveta.
- **Auditoria:** `STATE_DIR/logs/audit-AAAA-MM-DD.jsonl` e o ledger de eventos (`eventos.jsonl` ou `plan_eventos`).
