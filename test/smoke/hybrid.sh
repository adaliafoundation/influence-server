#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${1:-http://localhost:3001}"
PASS=0
FAIL=0

check() {
  local name="$1" cmd="$2" expected="$3"
  result=$(eval "$cmd" 2>/dev/null || echo "CURL_FAILED")
  if echo "$result" | grep -q "$expected"; then
    echo "  ✓ $name"
    PASS=$((PASS + 1))
  else
    echo "  ✗ $name (expected '$expected', got: $result)"
    FAIL=$((FAIL + 1))
  fi
}

echo "Hybrid server smoke test: $BASE_URL"
echo ""

echo "Infrastructure:"
check "Health endpoint reachable" \
  "curl -s \"$BASE_URL/v2/health\"" '"status"'
check "MongoDB connected" \
  "curl -s \"$BASE_URL/v2/health\" | node -e \"let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).checks.mongodb.status))\"" \
  "ok"
check "Game mode is hybrid" \
  "curl -s \"$BASE_URL/v2/health\" | node -e \"let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d).checks.gameMode.mode))\"" \
  "hybrid"
check "World fork exists" \
  "curl -s \"$BASE_URL/v2/world\"" '"forkBlock"'

echo ""
echo "API:"
check "Actions endpoint exists (401 without auth)" \
  "curl -s -o /dev/null -w '%{http_code}' -X POST \"$BASE_URL/v2/actions/ConstructionPlan\"" \
  "401"
check "Unknown action returns error" \
  "curl -s -X POST \"$BASE_URL/v2/actions/FakeAction\" -H 'Content-Type: application/json' -H 'Authorization: Bearer test'" \
  "error"

echo ""
echo "Data:"
check "Entities endpoint returns results" \
  "curl -s \"$BASE_URL/v2/entities?label=1&limit=1\"" \
  "id"

echo ""
echo "Results: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ] || exit 1
