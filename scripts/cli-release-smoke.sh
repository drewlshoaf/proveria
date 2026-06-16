#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_ROOT="${TMPDIR:-/tmp}/proveria-cli-smoke.$$"
SAMPLE_FILE="$TMP_ROOT/sample.txt"
COMPLETIONS_FILE="$TMP_ROOT/_proveria"

cleanup() {
  rm -rf "$TMP_ROOT"
}
trap cleanup EXIT

log() {
  printf '[cli-smoke] %s\n' "$*"
}

run_cli() {
  if [[ -n "${PROVERIA_CLI_BIN:-}" ]]; then
    "$PROVERIA_CLI_BIN" "$@"
  else
    cargo run --manifest-path "$ROOT/apps/proveria-cli/Cargo.toml" -- "$@"
  fi
}

mkdir -p "$TMP_ROOT"
printf 'Proveria CLI release smoke\n' > "$SAMPLE_FILE"

log 'checking help output'
run_cli --help >/dev/null

log 'checking version output'
run_cli --version | grep -Eq '^proveria [0-9]+\.[0-9]+\.[0-9]+'

log 'checking local hash command'
HASH_OUTPUT="$(run_cli hash "$SAMPLE_FILE")"
printf '%s\n' "$HASH_OUTPUT" | grep -Eq '[0-9a-f]{64}'

log 'checking receipt help output'
run_cli receipt --help | grep -q -- '--json'
run_cli receipt --help | grep -q -- '--pdf'

log 'checking shell completions'
run_cli completions zsh > "$COMPLETIONS_FILE"
grep -q 'proveria' "$COMPLETIONS_FILE"

log 'CLI release smoke passed'
