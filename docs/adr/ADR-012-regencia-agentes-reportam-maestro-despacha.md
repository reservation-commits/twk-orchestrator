# ADR-012 — Regência: agentes reportam ao MAESTRO por contrato; o MAESTRO despacha ao fundador por um único canal

**Status:** aceito · 2026-09-02 · trace `trc-agentes0902` · Decisão do fundador (chat 2026-09-02): "o MAESTRO deve receber todos os dados, relatórios, conclusões e parâmetros dos outros agentes, inclusive os novos, e isso precisa ser passado para mim por meio do MAESTRO".

## Contexto
Até aqui a comunicação agente → Orquestrador era por handoff (tarefa a tarefa) e o fundador precisava ir de painel em painel. Nenhum agente reportava por conta própria; a Central via só KPIs quando havia URL configurada. Foco declarado da empresa: conversão de estabelecimentos comuns em parceiros e de usuários em clientes que voltam, com atendimento que surpreende.

## Decisão
1. **Contrato de relato** (`orchestrator/contracts/relato.schema.json`): todo agente/coletor emite, por ciclo, um relato com KPIs, **sinais de conversão**, **experiência (quem espera por nós)**, achados com severidade e nível de autonomia, ações autônomas executadas, aprovações pendentes, custo em inteiros e cobertura (fontes e lacunas). Sem PII. Métrica ausente é lacuna declarada.
2. **Ciclos autônomos**: diário (Despacho completo) e horário (só alerta crítico novo, com dedup de 24h). Coletores são determinísticos e rodam sem modelo.
3. **O MAESTRO decide por nível de autonomia** (tabela da constituição): autônomo → registra; nível orquestrador → decide e grava justificativa; nível humano → entra no "Precisa de você" com prazo. Nunca executa envio externo, `published`, DDL, dinheiro ou má notícia.
4. **Um canal para o fundador**: o Despacho do MAESTRO (Central → Missões + e-mail para `MAESTRO_FOUNDER_EMAIL`). Respostas do fundador voltam pela Conversa/Aprovações da Central. Ninguém mais escreve ao fundador em nome do sistema.
5. **Modelo**: voz do MAESTRO em Opus 4.8; **Fable 5.1 quando há item crítico ou decisão de marca/legal/dinheiro**. O modelo só sintetiza o JSON consolidado (regra: nenhum número fora do JSON); o corpo determinístico é sempre produzido e enviado mesmo sem modelo.
6. **Falhar alto**: agente sem leitura aparece como "cego" no Despacho; ciclo que não rodou vira achado do vigia.

## Alternativas consideradas
- Cada agente e-mailar o fundador: multiplica canais e ruído; rejeitada.
- Só o chat da Central sob demanda: exige o fundador puxar; contraria a decisão. Mantido como canal de resposta, não de push.

## Consequências
Módulo `orchestrator/command-center/regencia/` (roda local ou hospedado); rotas `/api/relatos` e `/api/despachos`; `REGENCIA_ENABLED` no servidor; agendamento local via `agendar.ps1` (execução com aprovação). Os 5 serviços passam a poder POSTar relatos em `/api/relatos` (ingest) — migração gradual dos coletores "pull" para "push".
