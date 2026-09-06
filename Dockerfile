# App image (backend + static frontend). OpenFGA runs as its own service.
FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY openfga ./openfga
COPY src ./src
COPY public ./public
COPY scripts ./scripts
ENV PORT=4000
EXPOSE 4000
CMD ["node", "src/server.js"]
