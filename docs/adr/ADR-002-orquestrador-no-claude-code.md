# ADR-002 — Orquestrador roda no Claude Code, não como serviço 24/7

**Status:** aceito · 2026-08-12 · revisitar após piloto

## Contexto
Todos os agentes estão em fase de teste (confirmado pelo fundador). Os fluxos que precisam de coordenação hoje são de cadência humana (publicações, campanhas, cobranças), não de milissegundos. Um serviço 24/7 novo criaria mais um deploy, mais uma credencial-mestre, mais um ponto de ataque — antes de o valor da orquestração estar provado.

## Decisão
O Orquestrador vive **neste repositório**, executado via Claude Code com o fundador como operador: subagentes (`.claude/agents/`), hooks determinísticos (`settings.json`), slash commands operacionais, estado em arquivos versionáveis. Os 5 agentes continuam autônomos em seus deploys — o modo atual É o modo de contingência.

## Alternativas consideradas
1. **Serviço Node no EasyPanel desde o dia 1:** infra e superfície de ataque antes do valor; sem operador olhando, os erros de coordenação inicial virariam incidentes. Rejeitada por ora.
2. **n8n como orquestrador:** bom para workflows determinísticos, fraco para decomposição/arbitragem com raciocínio; e o n8n já é ponto único de falha do canal de saída do CLAVIS. Rejeitada como cérebro; mantido como músculo (transporte).

## Critério de promoção a serviço
Quando um fluxo orquestrado rodar 4 semanas com ≤1 intervenção além das aprovações previstas E o custo de latência humana for comprovadamente o gargalo — projeta-se o serviço com as mesmas regras deste repo.
