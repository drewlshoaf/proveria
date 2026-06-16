# Proveria CLI v0.1.0

Initial developer-preview release of the Rust Proveria CLI.

## Highlights

- Configure a workspace-scoped API target and API key.
- Create and list projects.
- Create attestations from local files or external SHA-256 hashes.
- Attach a compliance JSON document by canonical hash and metadata without
  uploading the JSON body.
- Inspect attestation records and receipt availability.
- Download attestation receipt JSON and PDF artifacts.
- Grant and revoke verifier access.
- Verify local files, SHA-256 hashes, and text passages against an attestation.
- Download verification result artifacts.
- List workspace events.
- Create and inspect evidence export manifests/jobs.
- Manage webhook endpoints and delivery visibility.
- Generate shell completions.

## Install

For this repository-local developer preview:

```bash
cargo install --path apps/proveria-cli --force
proveria --version
```

After publishing release artifacts, use the platform archive from the GitHub
release or the future Homebrew tap path:

```bash
brew install proveria/tap/proveria
```

## Quickstart

```bash
export PROVERIA_API_URL=http://127.0.0.1:3001
export PROVERIA_WORKSPACE=evaluation-workspace

proveria auth login \
  --email admin-producer-eval@example.com \
  --password admin-producer-eval-password-123

proveria api-keys create \
  --name "CLI v0.1.0 quickstart" \
  --scope read \
  --scope write \
  --use-key

proveria projects list

proveria prove bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb \
  --project evaluation-evidence \
  --name cli-release-quickstart \
  --file-name qa-sample.pdf \
  --byte-size 1234 \
  --compliance-json docs/examples/compliance-controls.json
```

Then poll, retrieve receipt artifacts, and verify:

```bash
proveria records get <attestation-id>
proveria receipt <attestation-id> --json --pdf --output ./receipts
proveria verify bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb \
  --attestation <attestation-id>
```

## Known Limitations

- This is a developer-preview CLI release, not a full production support
  package.
- API compatibility is centered on the current `/v1` local stack and may still
  evolve before wider public distribution.
- Homebrew support is prepared through formula generation, but the public tap
  may not exist until release artifacts are published and reviewed.
- The CLI uses workspace API keys for producer/admin API workflows; desktop
  device-signature flows remain separate.
- Receipt and result artifact retrieval requires the API and worker to have
  completed background processing.

## Validation

Release validation should include:

```bash
cargo fmt
cargo check -p proveria
cargo test -p proveria
scripts/check-cli-release-version.sh proveria-cli-v0.1.0
scripts/cli-release-smoke.sh
```

For an installed or extracted binary:

```bash
PROVERIA_CLI_BIN=/path/to/proveria scripts/cli-release-smoke.sh
```
