# Biblioteca TWK — site estático dos planos, com senha (zero dependências).
FROM node:22-alpine
WORKDIR /app
COPY server.js package.json ./
COPY public ./public
ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://127.0.0.1:8080/health || exit 1
USER node
CMD ["node", "server.js"]
