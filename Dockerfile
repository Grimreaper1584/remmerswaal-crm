FROM node:20-bookworm-slim AS base

# build-essential + python3 are required to compile the better-sqlite3 native addon
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY server ./server
COPY public ./public

RUN mkdir -p /app/data

ENV NODE_ENV=production
ENV PORT=3000
ENV DATA_DIR=/app/data

EXPOSE 3000

VOLUME ["/app/data"]

CMD ["node", "server/index.js"]
