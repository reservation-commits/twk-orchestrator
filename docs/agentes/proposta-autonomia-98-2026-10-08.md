# Proposta — o que falta para um sistema 98% autônomo (08/10/2026)

> Autor: Orquestrador · Fontes: `docs/agentes/00-matriz-de-lacunas.md` (02/09), `docs/agentes/elevacao-sistema-2026-09-22.md`, memória operacional até 07/10 (contas, WhatsApp, Panorama, auditoria do site). Rotulagem: **FATO** · **SUPOSIÇÃO** · **LACUNA**.

## 0. Tese em três frases

1. **O que trava a autonomia hoje não é falta de agente, é falta de chão.** A operação roda num notebook de 4 GB cujas tarefas morrem (FATO, 04/09 e 11/09); a Regência hospedada (Movimento 1 de 22/09) ainda não subiu. Agente novo em cima disso é agente que morre junto.
2. **A segunda trava é a tabela de escalonamento ser lida por humano, não por código.** Cada "sempre" da tabela é um ponto onde o sistema para e espera. 98% exige transformar os "sempre" de baixo risco em **política avaliável** com teto, orçamento e desfazer — como já foi feito para escrita reversível (ADR-017) e reparos (`reparos-aprovados.json`).
3. **Dez das 24 linhas da matriz são produto, não agente** (FATO). Sem um agente que mexa no front, a frota continua contornando defeitos que ela não pode corrigir: porta de contas quebrada, `published` que não derruba a página, login wall no pedido.

**Definição de 98%:** de cada 100 eventos que hoje exigem toque humano, só 2 continuam exigindo — dinheiro ao cliente, jurídico, imprensa, DDL/restore. Tudo o mais é executado e **auditado**, não aprovado. Métrica proposta: `taxa_autonomia = tarefas concluídas sem toque humano / tarefas concluídas`, lida de `orchestrator/logs/` por trace_id. Hoje: **LACUNA** — ninguém mede.

## 1. Infraestrutura e ferramentas (antes de qualquer agente)

| # | Ferramenta | O que faz | Por que é pré-requisito | Esforço |
|---|---|---|---|---|
| T1 | **Regência hospedada + agendador no container** | Movimento 1 de 22/09: Central no Easypanel roda Guardião, Ciclo, Sentinela, porta de qualidade à noite | Agendador do Windows não é confiável (FATO) | 7 variáveis + volume + redeploy (lado do fundador) |
| T2 | **Motor de políticas de aprovação** (`orchestrator/politicas/`) | Converte a tabela de escalonamento em regras JSON: classe da ação, teto por execução, orçamento mensal, janela, desfazer obrigatório. O Orquestrador avalia; aprovação humana só quando a regra não cobre | É o maior multiplicador: generaliza o padrão de `reparos-aprovados.json` e do `--autonomo` para outras classes (cortesia até €X/mês, republicar após correção verificada, envio a casa com opt-in) | 1 semana, sem LLM |
| T3 | **Juízes por agente** (padrão do Juiz de Conversa da Aria) | Juiz Editorial (ficha publicável?), Juiz Comercial (mensagem a casa ok?), Juiz de Catálogo (correção coerente com Places?). Nota gravada; reprovação vira escalação com ids | Autonomia só sobe com segurança se há um avaliador independente da peça produzida. A Aria já provou o padrão (`src/juiz.ts`) | 2–3 dias por juiz |
| T4 | **Barramento de eventos** | Trigger no `agent_audit_log` e em `reservations` (status, `expired_at`) publica eventos; agentes assinam em vez de varrer por cadência | Sentinela e Guardião hoje descobrem por polling; evento elimina atraso e consulta repetida. Dá de graça o `status_changed_at` que a matriz pede (item 16) | 1 semana; exige `CREATE TRIGGER` (DDL — aprovação do fundador) |
| T5 | **Rollback automático de deploy** | Movimento 6: deploy por git, smoke test pós-deploy, volta à imagem anterior se o smoke falha | Sem isso cada deploy é toque humano e risco | depende de T1 |
| T6 | **Medidor de autonomia** | Script que lê logs e grava `orchestrator/state/autonomia.json`: eventos por classe, quantos pararam em humano, tempo parado | Sem baseline, "98%" é slogan | 1 dia |

## 2. Agentes novos — por gargalo medido

Ordem de valor. Cada um nasce de uma linha da matriz ou de medição posterior; os seis rejeitados em 02/09 (churn, conector de software de reserva, fidelização separada…) continuam rejeitados.

### A1 · Agente de Produto (dev autônomo do front)
- **Gargalo (FATO):** porta de contas não cria conta (0 contas, 30/09); `published=false` mantém a página no ar; login wall no pedido; 12 chips de cidade sem clique; og:image 404; 245 fichas órfãs (auditoria 07/10).
- **O que faz:** recebe handoff com defeito e critério de aceite, abre branch, corrige, roda testes e preview, abre PR com evidência. Deploy em canário com T5.
- **Autonomia:** `AUTONOMO_COM_LOG` para correção com teste; merge em produção `REQUER_APROVACAO_HUMANA` até o rollback (T5) existir.
- **Pré-requisito/LACUNA:** acesso ao repositório da plataforma. Hoje a frota não tem. Sem isso, o agente não existe.

### A2 · Porteiro (ativação de contas de restaurante)
- **Gargalo (FATO):** 0 contas; 17 códigos verificados sem conta; 16 donos cadastrados como cliente.
- **O que faz:** dono da ativação ponta a ponta: gera ficha, acompanha o código, confirma em `restaurant_users`, vincula dono ao restaurante (SQL de vínculo já escrito), faz o follow-up por WhatsApp/e-mail no idioma da casa, encerra quando a conta existe.
- **Autonomia:** vínculo e correção são escritas reversíveis (ADR-017) → autônomo. Envio a casa com opt-in e template aprovado → autônomo por política (T2).
- **Pré-requisito:** a porta funcionar (A1). Antes disso é o erro de agosto: 185 e-mails, 0 contas.

### A3 · Telefonista (voz, confirmação com a casa)
- **Gargalo (FATO):** casas respondem 9% quando não são parceiras; Bangkok 699 pedidos e 4 aceites; o Guardião já escala por escrito e para no degrau humano porque o time não fala os idiomas (decisão de 06/09).
- **O que faz:** liga para a casa no idioma dela, lê a pendência, registra aceite/recusa, grava gravação e transcrição no audit, devolve ao Guardião. Não negocia, não promete, não fala com cliente.
- **Autonomia:** canário com 5 casas e aprovação do fundador por casa; depois política por critério (casa sem opt-out, ≥2 pendências vivas, e-mail morto).
- **Custo (SUPOSIÇÃO):** ≈€0,10–0,30/min com voz em tempo real; 100 ligações/mês ≈ €30–90. **Risco de marca:** o maior da lista; por isso canário pequeno e gravação obrigatória.
- **Mudança de decisão necessária:** a regra "sempre por escrito" de 06/09 foi tomada por limitação de idioma, que o agente remove. É decisão do fundador, não minha.

### A4 · Zelador do Catálogo (DBA, rotina autônoma)
- **Gargalo (FATO):** 413 publicados com horário genérico; 26 casas com e-mail morto e 431 pendências presas; 245 fichas órfãs; 25 cidades duplicadas.
- **O que faz:** não é agente novo, é o DBA ganhando cadência: validação MX semanal, horários via Places, dedupe de cidade, órfãs. Cada correção com `-- backup:` → `AUTONOMO_COM_LOG` já hoje.
- **Pré-requisito:** T1 (cadência) e Juiz de Catálogo (T3).

### A5 · Quill autônomo com Juiz Editorial
- **Gargalo (FATO):** impressões −96% desde jun/2025; 9.276 URLs localizadas com corpo em inglês; Quill sem títulos.
- **O que faz:** gera e atualiza fichas/cidades por demanda medida (cidades com pedido e sem conteúdo), publica no banco editorial quando o Juiz aprova.
- **Autonomia:** publicação editorial hoje é humana. Com Juiz + rollback de versão (Quill já versiona) → `AUTONOMO_COM_LOG`.

### A6 · Auditor Interno (red team noturno)
- **O que faz:** roda evals, tenta injeção pelos canais reais (e-mail, WhatsApp, dado do banco), confere ADRs (idioma da resposta, promessa de prazo, opt-out antes de contato), alimenta a porta de qualidade. Reprovação baixa a autonomia do agente afetado (T2).
- **Por quê:** é o que permite subir o teto dos outros com prova em vez de confiança.

### A7 · Pós-jantar (não é agente — é interruptor)
- Lembrete e convite de avaliação já existem na Aria com flags desligadas; 905 jantares sem avaliação. Ligar com um dono por notificação (Aria ou n8n, não os dois).

## 3. O que não fazer

- Agente de churn de parceiro (6 com movimento), conector de software de reserva (0 dados), fidelização do cliente separada: rejeitados em 02/09 e os números não mudaram.
- Agente financeiro novo: Atlas está vazio porque não há receita para reconciliar. Volta quando houver assinatura paga.
- Qualquer agente que envie em massa sem opt-out funcional e sem porta de contas.

## 4. Ordem recomendada e o que depende do fundador

| Semana | Entrega | Depende do fundador |
|---|---|---|
| 1 | T1 Regência hospedada · T6 medidor de autonomia | ligar a Central (7 variáveis + volume) |
| 2 | T2 motor de políticas · primeiras 5 políticas (republicar após correção, envio com opt-in, cortesia zero, reparo, correção de catálogo) | aprovar o conjunto inicial de políticas |
| 3 | T3 juízes (Catálogo, Editorial) · A4 rotina do DBA · A7 ligar pós-jantar | — |
| 4 | A1 Agente de Produto em canário | acesso ao repositório do front |
| 5–6 | A2 Porteiro (após a porta) · T4 eventos · T5 rollback | DDL dos triggers · decisão sobre A3 |
| 7+ | A3 Telefonista canário (5 casas) · A5 Quill autônomo · A6 Auditor | aprovação por casa no canário |

## 5. Lacunas declaradas

- Taxa de autonomia atual: não medida. T6 produz a primeira leitura.
- Acesso ao repositório do front: desconhecido se existe e quem o tem.
- Custo real de voz em tempo real: suposição; medir no canário.
- Volume mensal de pedidos de remoção/correção: ainda 1 caso formal registrado.

## 6. Executado em 08/10/2026 (mesma sessão)

| Item | Entregue | Prova |
|---|---|---|
| T2 motor de políticas | `orchestrator/politicas/politicas.json` (6 ativas, 5 propostas) + `avaliar.js` (classes sempre-humanas no código, proposta nunca se aplica, atributo ausente = não atendido, orçamento mensal) | eval `politicas` 24/24 |
| T3 juízes | `orchestrator/juizes/` — genérico + Catálogo (10 critérios) + Editorial (10) + Comercial (10) | eval `juizes` 31/31 |
| T6 medidor de autonomia | `orchestrator/medidor-autonomia/medir.js` → `state/autonomia.json` e `logs/autonomia/` | eval 16/16 · **67% em 30 dias** (279 ações, 92 paradas humanas) |
| A6 Auditor Interno | `orchestrator/auditor/verificar.js` — 16 checagens (10 hard) por código; etapa nova da Porta | eval 5/5 · hard 10/10 |
| Vigilância | Sentinela: cadências `autonomia_medida` e `auditor_rodou` (7 dias) | `cadencias.json` (26 fontes) |
| Documentação | `docs/runbooks/politicas-de-aprovacao.md`; bullet no `CLAUDE.md` | — |

**Achados do Auditor (soft, para o fundador):** nenhum reparo em `reparos-aprovados.json` está aprovado (a autonomia de reparo do ADR-017 nunca entrou em vigor); 7 compromissos em `compromissos.jsonl` estão abertos e vencidos (quatro do MAESTRO, três do fundador).

**Maiores paradas humanas medidas (30 dias):** envio aprovado pelo fundador (56, Chave Girada) · escrita com frase (11, DBA) · escrita bloqueada por falta de credencial/frase (9). PROP-102 e o `--autonomo` já existente cobrem as duas primeiras quando aprovados/usados.

**Não executado (depende do fundador):** T1 Regência hospedada · T4 triggers (DDL) · T5 rollback de deploy · A1 Agente de Produto (acesso ao repo do front) · A2 Porteiro (porta de contas) · A3 Telefonista (decisão) · A7 ligar pós-jantar (flags no Easypanel da Aria).
