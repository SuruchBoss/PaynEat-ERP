# syntax=docker/dockerfile:1
# Copyright 2026 Suruch Chakrapeesirisuk
# SPDX-License-Identifier: Apache-2.0

# Adapted from Cwork (web/Dockerfile), see NOTICE.

# Built from the repository root (docker-compose.yml): the console's public demo imports the
# backend's pure rules and demo data (ADR-0021), and `npm run build` typechecks them, so they
# sit next to web/ as they do in the repository. A normal build bundles none of them.
FROM node:22-bookworm-slim AS build
WORKDIR /app/web
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
COPY backend/src/ /app/backend/src/
COPY backend/prisma/demo-data.ts /app/backend/prisma/demo-data.ts
RUN npm run build

FROM nginx:1.27-alpine AS runtime
COPY --from=build /app/web/dist /usr/share/nginx/html
COPY web/nginx.conf /etc/nginx/conf.d/default.conf
COPY web/security-headers.conf /etc/nginx/snippets/security-headers.conf
EXPOSE 80
HEALTHCHECK --interval=10s --timeout=5s --retries=6 CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
