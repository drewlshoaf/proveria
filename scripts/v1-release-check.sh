#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

API_URL="${PROVERIA_SMOKE_API_URL:-http://127.0.0.1:3001}"
VERIFIER_URL="${PROVERIA_VERIFIER_URL:-http://127.0.0.1:3003}"
TMP_ROOT="${TMPDIR:-/tmp}"
API_LOG="$TMP_ROOT/proveria-v1-release-api.log"
WORKER_LOG="$TMP_ROOT/proveria-v1-release-worker.log"
VERIFIER_LOG="$TMP_ROOT/proveria-v1-release-verifier.log"
API_PID=""
WORKER_PID=""
VERIFIER_PID=""

log() {
  printf '[v1-release] %s\n' "$*"
}

cleanup() {
  for pid in "$VERIFIER_PID" "$WORKER_PID" "$API_PID"; do
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
    fi
  done
}
trap cleanup EXIT

wait_for_url() {
  local url="$1"
  for _ in $(seq 1 60); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  return 1
}

assert_port_free() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1 && lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    log "port $port is already in use; stop that process and rerun"
    lsof -nP -iTCP:"$port" -sTCP:LISTEN || true
    exit 1
  fi
}

run() {
  log "$*"
  "$@"
}

log "running static and package checks"
run env CI=true pnpm typecheck
run env CI=true pnpm --filter @proveria/api test
run env CI=true pnpm --filter @proveria/worker test
run env CI=true pnpm --filter @proveria/desktop test
run pnpm --filter @proveria/verifier build

log "starting local infrastructure"
run docker compose up -d postgres redis minio minio-init
log "stopping containerized app services so local processes own the ports"
docker compose stop api worker verifier >/dev/null 2>&1 || true
assert_port_free 3001
assert_port_free 3003

log "applying database migrations"
run pnpm --filter @proveria/db db:migrate

: > "$API_LOG"
: > "$WORKER_LOG"
: > "$VERIFIER_LOG"

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
if ! wait_for_url "$API_URL/readyz"; then
  log "API did not become ready"
  tail -n 80 "$API_LOG" || true
  exit 1
fi

log "starting verifier (log: $VERIFIER_LOG)"
pnpm --filter @proveria/verifier start >"$VERIFIER_LOG" 2>&1 &
VERIFIER_PID="$!"

log "waiting for verifier at $VERIFIER_URL"
sleep 1
if ! kill -0 "$VERIFIER_PID" 2>/dev/null; then
  log "verifier process exited before readiness"
  tail -n 80 "$VERIFIER_LOG" || true
  exit 1
fi
if ! wait_for_url "$VERIFIER_URL"; then
  log "verifier did not become ready"
  tail -n 80 "$VERIFIER_LOG" || true
  exit 1
fi

log "running verifier responsive viewport smoke"
run env CI=true PROVERIA_VERIFIER_BASE_URL="$VERIFIER_URL" pnpm --filter @proveria/verifier smoke:responsive

log "running desktop-signed happy path"
run env CI=true PROVERIA_SMOKE_API_URL="$API_URL" pnpm --filter @proveria/desktop smoke:happy-path

log "running verifier live smoke with self-seeded attestation"
run env CI=true PROVERIA_VERIFIER_URL="$VERIFIER_URL" pnpm --filter @proveria/verifier smoke:live

log "V1 release checks passed"
