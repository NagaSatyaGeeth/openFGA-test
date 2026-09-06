# Build context is the repo root (docker-compose.yml / render.yaml both set
# it that way). node_modules lives at /app (repo root) rather than under
# web/, because lib/ and web/ are sibling directories and both need it on
# their module-resolution ancestor chain (lib/db.js requires pg/bcryptjs
# too, not just web/server.js).
FROM node:22-alpine

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY lib ./lib
COPY seed ./seed
COPY model ./model
COPY web ./web

ENV PORT=4000
EXPOSE 4000
CMD ["node", "web/server.js"]
