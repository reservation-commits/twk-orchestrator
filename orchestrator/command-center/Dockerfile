# MAESTRO Command Center — cockpit + cérebro embarcado (Anthropic SDK) + rotinas hospedadas (A1, 2026-10-22)
#
# CONTEXTO DE BUILD = orchestrator/ (um nível acima desta pasta). No EasyPanel: Build Path "/orchestrator",
# Dockerfile "command-center/Dockerfile". Motivo: as rotinas hospedadas rodam o MESMO código dos agentes
# locais (orchestrator/agents/*), e um Dockerfile só enxerga o que está no seu contexto — com o contexto
# antigo (orchestrator/command-center) os agentes ficariam de fora e nada rodaria.
FROM node:22-alpine
WORKDIR /app
COPY command-center/package.json ./
# `pg` é dependência opcional: fica instalada aqui (as rotinas e a Regência leem o banco com twk_ro).
RUN npm install --omit=dev && npm cache clean --force
# Copia TODOS os módulos da raiz da Central (server.js, brain.js, kpis.js, rotinas.js e futuros).
# Nunca voltar a listar arquivo por arquivo: esquecer um módulo novo aqui derruba
# o container em MODULE_NOT_FOUND e o EasyPanel mantém a versão anterior no ar,
# fazendo o deploy "não surtir efeito" sem erro visível na interface.
COPY command-center/*.js ./
COPY command-center/regencia ./regencia
COPY command-center/public ./public
# Panorama: o texto das páginas fica FORA de public/ (descreve o sistema por dentro; sai só pela API com chave)
COPY command-center/plataforma-conteudo ./plataforma-conteudo
# Rotinas hospedadas: os agentes locais, sem o estado deles (state/ é ignorado pelo git e vive no VOLUME).
# _lib (conexão com nova tentativa), registro-optout e chave-girada/n8n são dependências dos quatro jobs.
COPY agents/_lib ./agents/_lib
COPY agents/guardiao-reserva ./agents/guardiao-reserva
COPY agents/ciclo-cliente ./agents/ciclo-cliente
COPY agents/sentinela-silencio ./agents/sentinela-silencio
COPY agents/zelador-privilegios ./agents/zelador-privilegios
COPY agents/registro-optout ./agents/registro-optout
COPY agents/chave-girada/n8n ./agents/chave-girada/n8n
# ADR-018: retenção antes da exclusão (MAESTRO) e a porta única de escrita que ela usa (TWK_DBA_URL no ambiente).
COPY agents/maestro-atendimento ./agents/maestro-atendimento
COPY agents/dba-escrita ./agents/dba-escrita
# DURABILIDADE (v4.4): a carga-semente vai para /app/SEED (dentro da imagem),
# NUNCA para /app/state. O /app/state é o diretório VIVO — deve ser um VOLUME
# PERSISTENTE montado no EasyPanel, senão as conversas somem a cada deploy.
# Na partida, server.js copia de /app/seed → /app/state apenas o que estiver
# FALTANDO (nunca sobrescreve dado vivo); frota.md (referência) é sempre atualizada.
# Assim um volume vazio é semeado direito e um volume com dados é preservado.
# A pasta state/ é ignorada pelo git (PII, auditoria): num build a partir do GitHub ela NÃO existe,
# e um COPY de pasta ausente derruba o build. O curinga `state*` ao lado de um arquivo que sempre
# existe (package.json) torna a semente opcional: com state/ (zip local) ela vai; sem (GitHub), só
# o package.json vai, e seed.js o ignora. O volume /app/state já povoado continua intacto nos dois casos.
COPY --chown=node:node command-center/package.json command-center/state* ./seed/
RUN mkdir -p /app/state/missoes /app/state/logs/tarefas /app/state/threads /app/state/anexos /app/state/agents /app/state/relatos \
 && chown -R node:node /app/state /app/seed /app/agents
ENV NODE_ENV=production
ENV PORT=8787
ENV STATE_DIR=/app/state
ENV SEED_DIR=/app/seed
ENV TWK_STATE_ROOT=/app/state
ENV TWK_AGENTS_DIR=/app/agents
VOLUME /app/state
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://127.0.0.1:8787/health || exit 1
USER node
CMD ["node", "server.js"]
