# syntax=docker/dockerfile:1

############################
# Runtime image
############################
FROM node:18-slim AS runtime

ENV NODE_ENV=production
ENV BUFFER_GLOBAL=1
ENV SKIP_PREFLIGHT_CHECK=1

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

# MongoDB database tools
RUN apt-get update && apt-get install -y curl gnupg \
  && curl -fsSL https://pgp.mongodb.com/server-6.0.asc | gpg --dearmor -o /usr/share/keyrings/mongodb.gpg \
  && echo "deb [ signed-by=/usr/share/keyrings/mongodb.gpg ] https://repo.mongodb.org/apt/debian bullseye/mongodb-org/6.0 main" \
     > /etc/apt/sources.list.d/mongodb-org.list \
  && apt-get update \
  && apt-get install -y mongodb-database-tools \
  && rm -rf /var/lib/apt/lists/*

EXPOSE 3001

CMD ["npm", "run", "start"]

############################
# Unit test image
############################
# Debian 11 (bullseye) max for mongo 6
FROM node:18-bullseye-slim AS unittest

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

# Mongodb-memory-server dependencies
RUN apt-get update \
 && apt-get install -y --no-install-recommends libcurl4 \
 && rm -rf /var/lib/apt/lists/*

CMD ["npm", "test"]
