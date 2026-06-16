#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

API_URL="${PROVERIA_SMOKE_API_URL:-http://127.0.0.1:3001}"
TMP_ROOT="${TMPDIR:-/tmp}"
API_LOG="$TMP_ROOT/proveria-exact-image-api.log"
WORKER_LOG="$TMP_ROOT/proveria-exact-image-worker.log"
API_PID=""
WORKER_PID=""

log() {
  printf '[exact-image] %s\n' "$*"
}

cleanup() {
  if [[ -n "$API_PID" ]] && kill -0 "$API_PID" 2>/dev/null; then
    kill "$API_PID" 2>/dev/null || true
  fi
  if [[ -n "$WORKER_PID" ]] && kill -0 "$WORKER_PID" 2>/dev/null; then
    kill "$WORKER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

wait_for_api() {
  for _ in $(seq 1 60); do
    if curl -fsS "$API_URL/readyz" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  return 1
}

log "starting Postgres, Redis, and MinIO"
docker compose up -d postgres redis minio minio-init

log "stopping containerized app services so local API/worker own the ports"
docker compose stop api worker portal verifier >/dev/null 2>&1 || true

if command -v lsof >/dev/null 2>&1 && lsof -nP -iTCP:3001 -sTCP:LISTEN >/dev/null 2>&1; then
  log "port 3001 is already in use; stop that process and rerun"
  lsof -nP -iTCP:3001 -sTCP:LISTEN || true
  exit 1
fi

log "applying database migrations"
pnpm --filter @proveria/db db:migrate

: > "$API_LOG"
: > "$WORKER_LOG"

log "starting API (log: $API_LOG)"
pnpm --filter @proveria/api dev >"$API_LOG" 2>&1 &
API_PID="$!"

log "starting worker (log: $WORKER_LOG)"
pnpm --filter @proveria/worker dev >"$WORKER_LOG" 2>&1 &
WORKER_PID="$!"

log "waiting for API readiness at $API_URL"
sleep 1
if ! kill -0 "$API_PID" 2>/dev/null; then
  log "API process exited before readiness"
  tail -n 80 "$API_LOG" || true
  exit 1
fi

if ! wait_for_api; then
  log "API did not become ready"
  tail -n 80 "$API_LOG" || true
  exit 1
fi

log "running exact image smoke flow"
PROVERIA_SMOKE_API_URL="$API_URL" pnpm --filter @proveria/worker smoke:exact-image

log "exact image smoke passed"
