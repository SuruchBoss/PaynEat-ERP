# syntax=docker/dockerfile:1
# Copyright 2026 Suruch Chakrapeesirisuk
# SPDX-License-Identifier: Apache-2.0

# Adapted from Cwork (web/Dockerfile), see NOTICE.

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:1.27-alpine AS runtime
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY security-headers.conf /etc/nginx/snippets/security-headers.conf
EXPOSE 80
HEALTHCHECK --interval=10s --timeout=5s --retries=6 CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
