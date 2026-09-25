# syntax=docker/dockerfile:1
# Adapted from Cwork (backend/Dockerfile), see NOTICE.

# ---- deps -------------------------------------------------------------------
FROM node:22-bookworm-slim AS deps
WORKDIR /app
# Prisma's engines need OpenSSL at build and run time.
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci

# ---- build ------------------------------------------------------------------
# Keeps devDependencies, so this stage doubles as the tools image that runs
# `prisma migrate deploy` and the demo seed (the `migrate` service in
# docker-compose.yml). The runtime image below never uses it directly.
FROM deps AS build
COPY prisma ./prisma
COPY prisma.config.ts tsconfig*.json nest-cli.json ./
RUN npx prisma generate
COPY src ./src
RUN npm run build

# ---- prod-deps --------------------------------------------------------------
FROM build AS prod-deps
RUN npm prune --omit=dev

# ---- runtime ----------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

RUN apt-get update && apt-get install -y --no-install-recommends openssl curl \
    && rm -rf /var/lib/apt/lists/*

# Run as a non-root user: a compromised process should not own the filesystem.
RUN useradd --system --create-home --uid 10001 erp
USER erp

COPY --chown=erp:erp --from=prod-deps /app/node_modules ./node_modules
COPY --chown=erp:erp --from=prod-deps /app/dist ./dist
COPY --chown=erp:erp --from=prod-deps /app/prisma ./prisma
COPY --chown=erp:erp prisma.config.ts package.json ./

# 3000 is the API. 9464 serves /metrics for a scraper inside the network and is
# deliberately not published by docker-compose.yml (docs/TELEMETRY.md).
EXPOSE 3000 9464

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3000/health || exit 1

CMD ["node", "dist/main.js"]
