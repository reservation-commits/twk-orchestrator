# Avaliação de eficiência e plano de otimização — 2026-10-21

Base: `panorama-sistema-2026-10-21.md` (números medidos hoje) e as medições abaixo. Rotulagem: **fato** · **suposição** · **lacuna**.

## 1. Veredito

**Não é um sistema eficiente. É um sistema robusto, seguro e auditável, construído para um volume 30 a 50 vezes maior do que o que passa por ele.** A tecnologia não é o gargalo; o gargalo está em quatro lugares que nenhum agente novo resolve: demanda, casas que não respondem, decisões paradas e o notebook como servidor.

### Esforço × resultado (fato)

| Esforço | Resultado em 30 dias |
|---|---|
| ~100 mil linhas de código em 6 repositórios (Quill 24,8 k · DBA 24,5 k · Aria 20,5 k · Orquestrador 13,4 k · CLAVIS 9,6 k · Atlas 7,3 k) | 189 pedidos de mesa |
| 84 documentos, 7.470 linhas, 17 ADRs | 30 aceites (16 %) |
| 1.027 checagens na Porta, 82 arquivos de teste, 10 suítes de eval | 3 conversas reais de WhatsApp, 14 respostas |
| 9 agentes locais, 3 vigias, 3 juízes, motor de políticas, Central hospedada | 12 WhatsApps enviados a casas, 19 e-mails do ciclo, 0 e-mails do Guardião, 0 contas criadas |
| 82 chamadas Opus + 52 Haiku na Aria | 0 avaliações pós-visita |

Tendência de aceite por mês (fato): abr 5 % · mai 6 % · jun 11 % · jul 8 % · ago 12 % · set 10 % · out 19 %. A taxa sobe, mas o volume cai: 484 pedidos em abril, 125 em outubro.

### Nota por dimensão (0 a 10)

| Dimensão | Nota | Por quê |
|---|---|---|
| Segurança e auditabilidade | 9 | hooks, porta única, `twk_ro`, `outboundGate`, audit append-only. Caro, mas certo. |
| Custo monetário | 8 | infra barata; LLM em volume baixo. O custo real é tempo humano. |
| Confiabilidade de execução | 3 | depende do notebook ligado; tarefas falham ao acordar; vigias dormiram 4 semanas; Central sem volume. |
| Autonomia real | 4 | 74 % medida com volume mínimo; 92 paradas humanas em 30 dias (08/10); Guardião em dry-run há 49 dias. |
| Qualidade do atendimento | 5 | juiz reprova 30 % (6 de 20, escala 0 a 6); as reprovadas não resolvem nada agora; 15 escalações sem leitura. *(Corrigido em 22/10: a versão anterior dizia 100 %.)* |
| Conversão de valor (jantares por unidade de esforço) | 2 | 24 aceites em outubro para toda a frota. |

## 2. Onde o sistema desperdiça (fato)

1. **Quatro superfícies de leitura, nenhuma lida**: Regência local (desligada), Central hospedada (estado vazio), Panorama (71 consultas), briefing. O mesmo número é calculado quatro vezes.
2. **Dry-run infinito**: o Guardião avalia 60 a 70 pendências por dia desde 02/09 e nunca agiu. Custo quase zero, valor zero, e 3 clientes hoje com mesa em 6 a 29 h sem resposta.
3. **A fila de escalação virou log**: 14 das 15 escalações abertas foram geradas pelo próprio sistema (juiz avisando que o juiz reprovou, revisão avisando que reteve). Escalação sem ação humana possível não é escalação, é telemetria.
4. **750 tentativas de WhatsApp para 12 envios**: 98 % morrem na trava de opt-in ou telefone, a cada tique, todos os dias. O log cresce; a casa continua sem saber do pedido.
5. **O juiz existe, o prompt não o ouve**: 20 k linhas na Aria e o texto ainda diz "inteligência de atendimento" e promete prazo de terceiro. Uma em cada três respostas reprova (6 de 20). O juiz julga depois de enviar; devia alimentar a reescrita antes.
6. **Dois agentes congelados**: Quill (24,8 k linhas) e Atlas (7,3 k) sem commit desde 24/09, Atlas com espelho Stripe vazio. Testados a cada Porta, sem produzir nada.
7. **Decisões paradas há semanas**: lote canário do Guardião, PROP-101 a 105, reparo aprovado, volume da Central, `.env.local` do DBA, porta de cadastro (front). Nenhuma otimização muda o número de jantares enquanto estas não saem.

## 3. O que NÃO fazer

- Não criar agente novo (regra da matriz de lacunas; o gargalo não é falta de agente).
- Não pôr LLM onde o problema é determinístico (telefone, janela de 24 h, fila).
- Não construir mais painéis. Construir ação.

## 4. Otimizações propostas, por ordem de alavanca

### Nível A — tirar o notebook do caminho (confiabilidade, 1 semana)

| # | O quê | Efeito medido |
|---|---|---|
| A1 | Guardião, Ciclo do Cliente, Sentinela, Zelador, Auditor e Medidor como **cron dentro da Central hospedada** (`REGENCIA_ENABLED=on`; o código já está no container), 09:00 Paris, com 3 tentativas de conexão em backoff | elimina a classe inteira de falhas `0xC000013A` e `timeout expired`; vigias rodam todo dia sem ninguém |
| A2 | **Volume persistente** em `/app/state` + cópia diária para bucket | conversas e estado sobrevivem ao redeploy |
| A3 | **Um único `estado-da-frota.json`** gerado pelo cron e lido por Central, Panorama e briefing | mata 3 das 4 superfícies; um número, uma origem |
| A4 | Desligar `TWK _teste ciclo (temp)` e as duas tarefas da Regência local depois de A1 | zero tarefa no Windows |

### Nível B — fechar o loop: de dry-run a ação com trava de código (1 semana)

| # | O quê | Trava | Efeito |
|---|---|---|---|
| B1 | **Guardião degrau 1 em produção**: e-mail à casa, canário Paris/Atenas/Marrakech, teto 20/dia, só casas sem opt-out e `published=true` | spec aprovada em 02/09; falta a frase do fundador | primeira vez que uma pendência é cobrada sem humano |
| B2 | **Degrau 4 automático via Aria**: aviso honesto ao cliente com alternativas, já `AUTONOMO_COM_LOG` pelo ADR-014 | `outboundGate` + critério de casa que confirma (≥4/90 d, ≥50 %) | hoje 3 clientes ficariam sem mesa sem saber |
| B3 | **Fallback de canal**: janela de 24 h do WhatsApp fechada → a mesma carta sai por e-mail | só reservas com e-mail do cliente | remove as escalações "enviar manualmente" (2 de 15 hoje) |
| B4 | **Fila de escalação com dono e SLA**: juiz e revisão gravam em `aria_quality_scores` e `aria_scope_blocks`, não em `aria_escalations`; escalação exige ação humana nomeada; pedido de remoção aciona `exclusao.js` no mesmo dia | regra em código, não em prompt | fila cai de 15 para o que de fato precisa de gente (hoje: LOFOTEN) |
| B5 | **Reparo aprovado**: `rerodar_tarefa_agendada: true` | já previsto no ADR-017 | Sentinela repara sozinha o primeiro silêncio |

### Nível C — qualidade e conversão (2 a 3 semanas; é aqui que a tecnologia pesa)

| # | O quê | Meta |
|---|---|---|
| C1 | **Aria na fórmula do ADR-015 antes de sair**: o juiz deixa de ser pós-envio e vira a segunda passada da revisão (reprovou → reescreve com os motivos → só então sai); retirar "inteligência de atendimento", hype e qualquer prazo de terceiro do prompt; os 20 casos reprovados viram few-shots negativos | nota média ≥ 8 em 14 dias; 0 retenções por vocabulário interno |
| C2 | **Opt-in do cliente que funciona**: instrumentar o clique do botão (utm) e trocar por deep link `wa.me` com texto pré-preenchido no idioma do cliente; medir pedidos → clique → primeira mensagem | ≥ 30 % dos pedidos com opt-in em 30 dias (hoje 0) |
| C3 | **Normalização determinística de telefones das casas**: `libphonenumber` + país do restaurante (não o DDI) resolve os 124 ambíguos FR/TH × BR; os 6 undeliverable viram lista de 1 ligação cada | tentativas mortas de 98 % para < 30 % |
| C4 | **Rotear pedidos para quem responde** (produto, com o dev do front): ficha mostra "responde em ~X h" ou esconde o botão quando a casa não confirma (critério do Guardião); pedidos entram primeiro nas casas com aceite ≥ 50 % | aceite de 16 % para ≥ 35 %; é a única alavanca que muda jantares confirmados |
| C5 | **Banco**: índice e `ANALYZE` em `opening_hours` (1,85 M seq scans, 7 idx scans); `VACUUM ANALYZE` em `reservations` e `db_restaurants`; mover as 14 tabelas do Atlas para fora do `twk_auth` | latência do site; higiene |

### Nível D — reduzir (o que cortar para liberar atenção)

- Congelar Quill e Atlas na Porta (rodar só quando houver commit) até existir conteúdo novo ou receita a medir. 32 k linhas paradas custam 5 min por Porta e atenção a cada auditoria.
- Arquivar o Panorama se a Central passar a ler o mesmo `estado-da-frota.json` (A3).
- Reduzir a Porta a um modo rápido diário (evals + hooks + auditor, ~5 min) e o modo completo semanal.

## 5. Cinco números para acompanhar toda semana

1. Jantares confirmados (`booking_status = 'Accept'`).
2. Taxa de aceite por casa e mediana de horas até a resposta.
3. Pedidos com opt-in de WhatsApp do cliente (%).
4. Nota média do Juiz de Conversa e retenções do `outboundGate`.
5. Tarefas que rodaram no hospedado ontem (sim/não) e escalações abertas com dono.

## 6. Decisões do fundador que destravam tudo

| Decisão | Destrava |
|---|---|
| Frase para o lote canário do Guardião (degrau 1) | B1, B2 |
| `REGENCIA_ENABLED=on` e volume `/app/state` no Easypanel | A1, A2 |
| `rerodar_tarefa_agendada: true` | B5 |
| PROP-101 a 105 (políticas propostas) | taxa de autonomia |
| Trocar `.env.local` do DBA para `twk_dba` | achado crítico do Zelador |
| Briefing ao dev do front: porta de cadastro + roteamento por casa que responde | C4, contas |

## 7. Ordem de execução proposta

- **Semana 1**: A1, A2, A3, A4 (hospedar e unificar) · B4 (fila com dono) · C1 (prompt e juiz antes de sair).
- **Semana 2**: B1, B2, B3, B5 (Guardião vivo) · C2, C3 (opt-in e telefones).
- **Semana 3+**: C4 com o dev do front · C5 · Nível D.

Cada item entra pela Porta de Qualidade, com eval própria e desfazer declarado, como manda a constituição. Nada acima cria agente novo.
