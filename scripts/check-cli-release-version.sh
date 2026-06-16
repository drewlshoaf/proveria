#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage:
  scripts/check-cli-release-version.sh <release-tag>

Example:
  scripts/check-cli-release-version.sh proveria-cli-v0.1.0

The release tag must match the workspace package version in Cargo.toml.
USAGE
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

if [[ $# -ne 1 ]]; then
  usage >&2
  exit 2
fi

TAG="$1"

if [[ ! "$TAG" =~ ^proveria-cli-v([0-9]+)\.([0-9]+)\.([0-9]+)([-+][A-Za-z0-9._-]+)?$ ]]; then
  printf 'error: tag must look like proveria-cli-v0.1.0, got %s\n' "$TAG" >&2
  exit 2
fi

TAG_VERSION="${TAG#proveria-cli-v}"
CARGO_VERSION="$(
  awk '
    /^\[workspace\.package\]/ { in_workspace_package = 1; next }
    /^\[/ { in_workspace_package = 0 }
    in_workspace_package && /^version[[:space:]]*=/ {
      gsub(/"/, "", $3)
      print $3
      exit
    }
  ' Cargo.toml
)"

if [[ -z "$CARGO_VERSION" ]]; then
  printf 'error: could not read workspace package version from Cargo.toml\n' >&2
  exit 2
fi

if [[ "$TAG_VERSION" != "$CARGO_VERSION" ]]; then
  printf 'error: release tag version %s does not match Cargo.toml version %s\n' "$TAG_VERSION" "$CARGO_VERSION" >&2
  exit 1
fi

printf 'CLI release version ok: %s\n' "$CARGO_VERSION"
