#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "Usage: $0 prerelease|production [--provisioner-keyfile] [--check-only] [-- --profile indexer]" >&2
}

if [ "$#" -lt 1 ]; then
  usage
  exit 1
fi

deploy_env="$1"
shift

case "$deploy_env" in
  prerelease)
    export NODE_ENV=prerelease
    compose_files=(-f compose.yaml -f compose.prerelease.yaml)
    ;;
  production)
    export NODE_ENV=production
    compose_files=(-f compose.yaml -f compose.prod.yaml)
    ;;
  *)
    usage
    exit 1
    ;;
esac

compose_args=()
check_only=0
provisioner_keyfile=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --provisioner-keyfile)
      provisioner_keyfile=1
      compose_files+=(-f compose.provisioner-keyfile.yaml)
      ;;
    --check-only)
      check_only=1
      ;;
    --)
      shift
      compose_args+=("$@")
      break
      ;;
    *)
      usage
      exit 1
      ;;
  esac
  shift
done

if [ "$provisioner_keyfile" -eq 1 ] && [ ! -f /etc/influence/secrets/starter_pack_admin_private_key ]; then
  echo "Refusing to deploy: /etc/influence/secrets/starter_pack_admin_private_key does not exist." >&2
  exit 1
fi

if [ "${#compose_args[@]}" -gt 0 ]; then
  rendered_config="$(docker compose "${compose_files[@]}" "${compose_args[@]}" config)"
else
  rendered_config="$(docker compose "${compose_files[@]}" config)"
fi

if printf '%s\n' "$rendered_config" | grep -q 'target: /app'; then
  echo "Refusing to deploy: rendered compose config bind-mounts local source into /app." >&2
  echo "Check Docker Compose version/support for the prod/prerelease volume override before deploying." >&2
  exit 1
fi

if [ "$check_only" -eq 1 ]; then
  echo "Compose config check passed for ${deploy_env}."
  exit 0
fi

if [ "${#compose_args[@]}" -gt 0 ]; then
  docker compose "${compose_files[@]}" "${compose_args[@]}" up -d
else
  docker compose "${compose_files[@]}" up -d
fi
