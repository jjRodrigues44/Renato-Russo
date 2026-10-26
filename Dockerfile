# Grana (casal) — imagem de produção. Sem dependências: só Node nativo.
FROM node:22-alpine

WORKDIR /app
COPY . .

ENV NODE_ENV=production
ENV DATA_DIR=/data
# Os dados (SQLite + segredo das sessões) ficam neste volume persistente.
VOLUME /data

EXPOSE 3000
CMD ["node", "--no-warnings", "server/index.js"]
