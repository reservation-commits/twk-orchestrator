# MAESTRO Command Center — cockpit + cérebro embarcado (Anthropic SDK)
FROM node:22-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev && npm cache clean --force
# Copia TODOS os módulos da raiz (server.js, brain.js, kpis.js e futuros).
# Nunca voltar a listar arquivo por arquivo: esquecer um módulo novo aqui derruba
# o container em MODULE_NOT_FOUND e o EasyPanel mantém a versão anterior no ar,
# fazendo o deploy "não surtir efeito" sem erro visível na interface.
COPY *.js ./
COPY regencia ./regencia
COPY public ./public
# Panorama: o texto das páginas fica FORA de public/ (descreve o sistema por dentro; sai só pela API com chave)
COPY plataforma-conteudo ./plataforma-conteudo
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
COPY --chown=node:node package.json state* ./seed/
RUN mkdir -p /app/state/missoes /app/state/logs /app/state/threads /app/state/anexos && chown -R node:node /app/state /app/seed
ENV NODE_ENV=production
ENV PORT=8787
ENV STATE_DIR=/app/state
ENV SEED_DIR=/app/seed
VOLUME /app/state
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://127.0.0.1:8787/health || exit 1
USER node
CMD ["node", "server.js"]
