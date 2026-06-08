# syntax=docker/dockerfile:1
# Production image for the Next.js web app (standalone output).
# Built from the MONOREPO ROOT context (see docker-compose.prod.yml).

# ---- Build stage ----
FROM node:20-slim AS build
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app

COPY . .
RUN pnpm install --frozen-lockfile

# NEXT_PUBLIC_* vars are inlined at BUILD time, so they must be passed as build
# args. NEXT_PUBLIC_API_BASE_URL is the PUBLIC origin the browser will call
# (e.g. https://hub.example.com or http://203.0.113.10) — never localhost.
ARG NEXT_PUBLIC_API_BASE_URL
ARG NEXT_PUBLIC_AUTH_DISABLED=false
ENV NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL
ENV NEXT_PUBLIC_AUTH_DISABLED=$NEXT_PUBLIC_AUTH_DISABLED
RUN pnpm --filter @tricon/web build

# ---- Runtime stage: minimal standalone server ----
FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Standalone trace output (monorepo layout preserves apps/web/server.js).
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /app/apps/web/public ./apps/web/public

EXPOSE 3000
CMD ["node", "apps/web/server.js"]
