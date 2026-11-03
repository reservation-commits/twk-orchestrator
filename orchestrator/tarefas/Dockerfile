# COMPASSO Tarefas — gerenciador de tarefas da TWK (Márlon, Lucas, Julien).
#
# CONTEXTO DE BUILD = orchestrator/ (um nível acima desta pasta), como a Central. No EasyPanel:
# Build Path "/orchestrator", Dockerfile "tarefas/Dockerfile". Motivo: as sugestões leem o banco pela mesma
# biblioteca de conexão dos agentes (agents/_lib) — com o contexto só desta pasta ela ficaria de fora.
FROM node:22-alpine
WORKDIR /app
COPY tarefas/package.json ./
# pg é opcional: fica instalado aqui para o livro em Postgres (TAREFAS_DATABASE_URL) e as sugestões (twk_ro).
RUN npm install --omit=dev && npm cache clean --force
COPY tarefas/*.js ./
COPY tarefas/public ./public
COPY tarefas/sql ./sql
COPY agents/_lib ./agents/_lib
# O estado (livro em arquivo, usuários, auditoria) vive em /app/state: VOLUME PERSISTENTE no EasyPanel,
# senão as tarefas somem a cada deploy. Com TAREFAS_DATABASE_URL o livro vai para o Postgres e o volume
# guarda só usuários e auditoria.
RUN mkdir -p /app/state/logs && chown -R node:node /app/state
ENV NODE_ENV=production
ENV PORT=8790
ENV STATE_DIR=/app/state
VOLUME /app/state
EXPOSE 8790
# O EasyPanel injeta PORT=80 no container; o servidor ouve nela. O health check segue a mesma variável.
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- "http://127.0.0.1:${PORT:-8790}/health" || exit 1
USER node
CMD ["node", "server.js"]
