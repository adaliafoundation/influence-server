#!/usr/bin/env bash
set -euo pipefail

image=${1:?Pass the production image reference}
project="influence-smoke-$$"
root=$(cd "$(dirname "$0")/.." && pwd)
secrets_dir=$(mktemp -d)
cleanup() {
  status=$?
  if [ "$status" -ne 0 ]; then
    docker logs --tail 40 "$project-elastic" >&2 || true
  fi
  docker rm -f "$project-api" "$project-mongo" "$project-redis" "$project-elastic" >/dev/null 2>&1 || true
  docker network rm "$project" >/dev/null 2>&1 || true
  rm -rf "$secrets_dir"
}
trap cleanup EXIT

test "$(docker image inspect "$image" --format '{{.Config.User}}' 2>/dev/null || true)" = '1000:1000' || {
  docker pull "$image"
  test "$(docker image inspect "$image" --format '{{.Config.User}}')" = '1000:1000'
}
docker network create "$project" >/dev/null
printf '%s\n' 'smoke-mongo-root-password' > "$secrets_dir/mongo-root"
printf '%s\n' 'smoke-redis-password' > "$secrets_dir/redis-password"
printf '%s\n' 'smoke-elastic-password' > "$secrets_dir/elastic-password"
printf '%s\n' 'mongodb://influence:smoke-mongo-password@mongo:27017/production_smoke' > "$secrets_dir/mongo"
printf '%s\n' 'redis://:smoke-redis-password@redis:6379' > "$secrets_dir/redis"
printf '%s\n' 'http://elastic:smoke-elastic-password@elasticsearch:9200' > "$secrets_dir/elastic"
printf '%s\n' 'smoke-jwt-secret-do-not-log' > "$secrets_dir/jwt"
cat > "$secrets_dir/init.js" <<'JS'
db.getSiblingDB('production_smoke').createUser({
  user: 'influence', pwd: 'smoke-mongo-password',
  roles: [{ role: 'readWrite', db: 'production_smoke' }]
});
JS
chmod 755 "$secrets_dir"
chmod 444 "$secrets_dir"/*
# Representative pinned dependency fixture; the stack owns production integration coverage.
docker run -d --name "$project-mongo" --network "$project" --network-alias mongo \
  -v "$secrets_dir:/run/secrets:ro" -v "$secrets_dir/init.js:/docker-entrypoint-initdb.d/app.js:ro" \
  -e MONGO_INITDB_ROOT_USERNAME=root -e MONGO_INITDB_ROOT_PASSWORD_FILE=/run/secrets/mongo-root \
  mongo:7.0.41@sha256:8102f674c3d5b5c3b5a248397778b8d148a998c6409f390ff62628eb617f0847 >/dev/null
docker run -d --name "$project-redis" --network "$project" --network-alias redis \
  -v "$secrets_dir:/run/secrets:ro" \
  redis:7.2.16-alpine@sha256:ccd6aa8d45ff3f033d6fa15b8cc1a50579f65c89f38cf9bb607a954c4f2128ed \
  sh -c 'exec redis-server --requirepass "$(cat /run/secrets/redis-password)"' >/dev/null
# Elasticsearch requires its bootstrap password file to be private and owned by its user.
docker run --rm --user 0 --entrypoint sh -v "$secrets_dir:/run/secrets" \
  docker.elastic.co/elasticsearch/elasticsearch:8.19.20@sha256:e4797708584bd0df7c746b33a6640d243018a0ae8c8b088391c6f4675a3bef52 \
  -c 'chown 1000:0 /run/secrets/elastic-password && chmod 600 /run/secrets/elastic-password'
docker run -d --name "$project-elastic" --network "$project" --network-alias elasticsearch \
  -v "$secrets_dir:/run/secrets:ro" \
  -e discovery.type=single-node -e xpack.security.enabled=true -e xpack.security.http.ssl.enabled=false \
  -e ELASTIC_PASSWORD_FILE=/run/secrets/elastic-password -e ES_JAVA_OPTS=-Xms512m\ -Xmx512m \
  docker.elastic.co/elasticsearch/elasticsearch:8.19.20@sha256:e4797708584bd0df7c746b33a6640d243018a0ae8c8b088391c6f4675a3bef52 >/dev/null

docker run --rm --name "$project-api" --network "$project" --read-only --tmpfs /tmp \
  --cap-drop ALL --security-opt no-new-privileges \
  -v "$secrets_dir:/run/secrets:ro" \
  -v "$root/test/deployment/production-image.cjs:/app/production-image.cjs:ro" \
  -e MONGO_URL_FILE=/run/secrets/mongo -e JWT_SECRET_FILE=/run/secrets/jwt \
  -e REDIS_URL_FILE=/run/secrets/redis -e REDIS_DISABLE_TLS=1 \
  -e ELASTICSEARCH_URL_FILE=/run/secrets/elastic \
  -e CLIENT_URL=http://client.local -e BRIDGE_CLIENT_URL=http://bridge.local -e IMAGES_SERVER_URL=http://images.local \
  -e ETHEREUM_PROVIDER=http://rpc.invalid -e STARKNET_RPC_PROVIDER=http://rpc.invalid \
  -e API_SERVER=1 -e IMAGES_SERVER=1 -e PORT=3001 -e LOG_LEVEL=info \
  -e HEALTH_NAMESPACE="$project" -e WORKER_MAX_AGE_MS=300000 \
  "$image" node production-image.cjs
