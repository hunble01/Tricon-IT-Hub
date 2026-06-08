# syntax=docker/dockerfile:1
# Production image for the NestJS API.
# Built from the MONOREPO ROOT context (see docker-compose.prod.yml) so the
# pnpm workspace + Prisma schema are available.

# ---- Build stage: install, generate Prisma client, compile ----
FROM node:20-slim AS build
# Prisma needs openssl + ca-certificates.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app

# Copy the whole workspace and install. (Simple + reliable for a small repo;
# the .dockerignore keeps node_modules/dist out of the context.)
COPY . .
RUN pnpm install --frozen-lockfile
# Generate the Prisma client with the engine native to THIS image.
RUN pnpm --filter @tricon/db exec prisma generate
# Compile the API to apps/api/dist.
RUN pnpm --filter @tricon/api build

# ---- Runtime stage ----
FROM node:20-slim AS runtime
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate
WORKDIR /app
ENV NODE_ENV=production

# Carry over the fully-installed, built workspace (incl. generated Prisma
# client and pnpm symlinks). prisma CLI stays available for `migrate deploy`.
COPY --from=build /app /app

WORKDIR /app/apps/api
EXPOSE 4000
CMD ["node", "dist/main.js"]
