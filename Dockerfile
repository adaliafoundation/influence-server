# syntax=docker/dockerfile:1

# Production dependencies and runtime share the same pinned OS/Node ABI.
FROM node:22-trixie-slim@sha256:7b8a0c89c54499bee567618f96578e1a12a800f062fbdbfd1fb6a443fa6f6284 AS production-base
WORKDIR /app
ENV NODE_ENV=production
# Security update newer than the pinned upstream image; keep versions explicit.
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    libssl3t64=3.5.7-1~deb13u2 openssl-provider-legacy=3.5.7-1~deb13u2 \
  && rm -rf /var/lib/apt/lists/*

FROM production-base AS production-dependencies
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM production-base AS production-test
ENV NODE_ENV=test
ENV MONGOMS_VERSION=7.0.14
RUN apt-get update \
  && apt-get install -y --no-install-recommends libcurl4t64 git \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --include=dev
COPY . .
CMD ["npm", "test"]

FROM production-base AS production
# Installers are build tools; production commands run Node directly.
RUN rm -rf /usr/local/lib/node_modules/npm /opt/yarn-* \
  && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/yarn /usr/local/bin/yarnpkg /usr/local/bin/corepack
ARG IMAGE_REVISION=local
ENV IMAGE_REVISION=$IMAGE_REVISION
ENV NODE_OPTIONS="--require=/app/src/common/lib/productionBootstrap.js --no-warnings"
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY src ./src
COPY bin ./bin
COPY .fonts ./.fonts
COPY config/default.json config/production.json config/prerelease.json config/custom-environment-variables.json config/local.js ./config/
USER 1000:1000
EXPOSE 3001
CMD ["node", "src/api/server.js"]

# Existing development/prerelease consumers intentionally retain their dependencies and tools.
############################
# Runtime image
############################
FROM node:22-slim AS runtime

ARG NODE_ENV=production
ENV NODE_ENV=$NODE_ENV

ENV BUFFER_GLOBAL=1
ENV SKIP_PREFLIGHT_CHECK=1

# MongoDB database tools
RUN apt-get update && apt-get install -y curl gnupg \
  && curl -fsSL https://pgp.mongodb.com/server-6.0.asc | gpg --dearmor -o /usr/share/keyrings/mongodb.gpg \
  && echo "deb [ signed-by=/usr/share/keyrings/mongodb.gpg ] https://repo.mongodb.org/apt/debian bullseye/mongodb-org/6.0 main" \
     > /etc/apt/sources.list.d/mongodb-org.list \
  && apt-get update \
  && apt-get install -y mongodb-database-tools \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

EXPOSE 3001

CMD ["npm", "run", "start"]

# Keep the existing CI/Compose target name on the maintained production test image.
FROM production-test AS unittest
