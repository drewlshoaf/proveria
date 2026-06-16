#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage:
  scripts/render-homebrew-formula.sh <tag> <checksums-dir>

Example:
  scripts/render-homebrew-formula.sh proveria-cli-v0.1.0 ./release-artifacts > Formula/proveria.rb

The checksums directory must contain:
  proveria-aarch64-apple-darwin.tar.gz.sha256
  proveria-x86_64-unknown-linux-gnu.tar.gz.sha256
USAGE
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

if [[ $# -ne 2 ]]; then
  usage >&2
  exit 2
fi

TAG="$1"
CHECKSUMS_DIR="$2"

if [[ ! "$TAG" =~ ^proveria-cli-v([0-9]+)\.([0-9]+)\.([0-9]+)([-+][A-Za-z0-9._-]+)?$ ]]; then
  printf 'error: tag must look like proveria-cli-v0.1.0, got %s\n' "$TAG" >&2
  exit 2
fi

RELEASE_BASE_URL="https://github.com/proveria/proveria-cli/releases/download/$TAG"

read_checksum() {
  local artifact="$1"
  local checksum_file="$CHECKSUMS_DIR/$artifact.sha256"
  if [[ ! -f "$checksum_file" ]]; then
    printf 'error: missing checksum file %s\n' "$checksum_file" >&2
    exit 2
  fi
  awk '{print $1}' "$checksum_file"
}

DARWIN_ARM64_ARTIFACT="proveria-aarch64-apple-darwin.tar.gz"
LINUX_X64_ARTIFACT="proveria-x86_64-unknown-linux-gnu.tar.gz"

DARWIN_ARM64_SHA="$(read_checksum "$DARWIN_ARM64_ARTIFACT")"
LINUX_X64_SHA="$(read_checksum "$LINUX_X64_ARTIFACT")"

cat <<RUBY
class Proveria < Formula
  desc "CLI for local hashing, attestations, receipts, and API workflows"
  homepage "https://github.com/proveria/proveria-cli"

  on_macos do
    on_arm do
      url "$RELEASE_BASE_URL/$DARWIN_ARM64_ARTIFACT"
      sha256 "$DARWIN_ARM64_SHA"
    end
  end

  on_linux do
    on_intel do
      url "$RELEASE_BASE_URL/$LINUX_X64_ARTIFACT"
      sha256 "$LINUX_X64_SHA"
    end
  end

  def install
    bin.install "proveria"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/proveria --version")
    assert_match "Proveria CLI", shell_output("#{bin}/proveria --help")
  end
end
RUBY
