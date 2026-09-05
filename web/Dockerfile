# Build context is the repo root (docker-compose.yml / render.yaml both set
# it that way) because this service needs ../lib, ../seed, ../model too.
FROM node:22-alpine

WORKDIR /app/web
COPY web/package.json web/package-lock.json* ./
RUN npm install --omit=dev

WORKDIR /app
COPY lib ./lib
COPY seed ./seed
COPY model ./model
COPY web ./web

WORKDIR /app/web
ENV PORT=4000
EXPOSE 4000
CMD ["node", "server.js"]
