#!/usr/bin/env bash
set -euo pipefail

sha=${1:?Pass a full commit SHA}
[[ "${GITHUB_REF:-}" = refs/heads/main ]] || { echo 'Release workflow must run from main.' >&2; exit 1; }
[[ "$sha" =~ ^[0-9a-f]{40}$ ]] || { echo 'A full lowercase commit SHA is required.' >&2; exit 1; }
[[ "$(git rev-parse --is-shallow-repository)" = false ]] || { echo 'Full history is required.' >&2; exit 1; }
[[ "$(git cat-file -t "$sha")" = commit ]] || { echo 'Release target must be a commit.' >&2; exit 1; }
git merge-base --is-ancestor "$sha" refs/remotes/origin/main || {
  echo 'Release commit must belong to origin/main.' >&2
  exit 1
}
