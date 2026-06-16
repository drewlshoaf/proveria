# Proveria CLI

Rust-first command line client for the API-first Proveria restart.

This CLI is intended to become the primary local client for:

- hashing files locally
- proving files through the public API
- verifying hashes, files, and passages
- reading projects, attestations, receipts, and events
- producing portable evidence artifacts for CI, compliance, and data workflows

## Install

```bash
brew tap proveria/tap
brew install proveria/tap/proveria
proveria --version
```

Upgrade an existing Homebrew install:

```bash
brew update
brew reinstall proveria/tap/proveria
proveria --version
```

For source development inside the monorepo:

```bash
cargo install --path apps/proveria-cli --force
proveria --help
proveria --version
```

If your shell cannot find `proveria`, add Cargo's bin directory to your path:

```bash
export PATH="$HOME/.cargo/bin:$PATH"
```

## Local Usage

```bash
proveria --help
proveria --version
proveria config set --api-url http://127.0.0.1:3001 --workspace evaluation-workspace --api-key prv_v1_...
proveria config show
proveria completions zsh > _proveria
proveria hash ./example.pdf
proveria projects list
proveria projects create evaluation-evidence --name "Evaluation Evidence" --visibility private
proveria api-keys list
proveria api-keys create --name "CLI development" --scope read --scope write --expires-in 90d --use-key
proveria api-keys rotate <api-key-id> --name "CLI development rotated" --scope read --scope write --expires-in 90d --use-key
proveria api-keys revoke <api-key-id>
proveria attestations
proveria attestations --project evaluation-evidence
proveria attestations --project evaluation-evidence --status confirmed --limit 25
proveria prove <sha256> --project evaluation-evidence --name external-proof
proveria prove <sha256> --project evaluation-evidence --name external-proof --file-name invoice.pdf --byte-size 1234 --compliance-json docs/examples/compliance-controls.json
proveria prove ./example.pdf --project evaluation-evidence
proveria prove ./example.pdf --project evaluation-evidence --compliance-json docs/examples/compliance-controls.json
proveria records get <attestation-id>
proveria receipt <attestation-id>
proveria receipt <attestation-id> --json --pdf --output ./receipts
proveria access grant <attestation-id> --email verifier@example.com --message "Please verify this proof package."
proveria access revoke <attestation-id> --grant <grant-id>
proveria result <verification-link-id>
proveria result <verification-link-id> --json --pdf --output ./results
proveria verify <sha256> --attestation <attestation-id>
proveria verify ./example.pdf --attestation <attestation-id> --output json
proveria verify passage "paste a source passage here" --attestation <attestation-id>
proveria events
proveria events --category verification_lookup --limit 25
proveria events --output json
proveria export
proveria export --output ./evidence-export.json
proveria export collect --limit 100 --output ./evidence --zip ./evidence.zip --tar ./evidence.tar
proveria export jobs
proveria export get <job-id> --output ./evidence-export.json
proveria export bundle <job-id> --output ./evidence-bundle.json
proveria export inspect ./evidence-bundle.json
proveria export check ./evidence-bundle.json
proveria export unpack ./evidence-bundle.json --output ./evidence
proveria export check ./evidence
proveria export zip ./evidence-bundle.json --output ./evidence.zip
proveria export tar ./evidence-bundle.json --output ./evidence.tar
proveria export create --limit 100 --output ./evidence-export.json
proveria webhooks create --url https://example.com/proveria/webhooks --event receipt.issued
proveria webhooks list
proveria webhooks test <endpoint-id>
proveria webhooks deliveries
proveria webhooks disable <endpoint-id>
```

`proveria api-keys list` shows expiration, workspace, scope, prefix, usage
count, and the last authenticated method/route/status for each key.

Environment variables can override config:

```bash
PROVERIA_API_URL=http://127.0.0.1:3001
PROVERIA_API_KEY=prv_v1_...
PROVERIA_WORKSPACE=evaluation-workspace
```

## Compliance JSON

`--compliance-json <path>` can be added to `prove` commands. The CLI validates
that the file is a JSON object, canonicalizes it with stable sorted keys, hashes
the canonical JSON locally, and sends only hash metadata to the API. The JSON
body itself is not uploaded.

The final attestation manifest contains a second file leaf with metadata like:

```json
{
  "source": "compliance_json",
  "media_type": "application/json",
  "canonicalization": "json-stable-v1",
  "file_name": "compliance-controls.json"
}
```

The manifest should not contain the compliance JSON document body.

## Release Smoke

Run the local CLI smoke from source:

```bash
scripts/cli-release-smoke.sh
```

Run it against an installed or extracted binary:

```bash
PROVERIA_CLI_BIN="$(command -v proveria)" scripts/cli-release-smoke.sh
```

## Receipt Artifacts

Use `receipt` without flags for status and metadata:

```bash
proveria receipt <attestation-id>
```

Use `--json`, `--pdf`, or both to download durable artifacts:

```bash
proveria receipt <attestation-id> --json --pdf --output ./receipts
```

The output directory receives deterministic file names:

```text
./receipts/<attestation-id>.receipt.json
./receipts/<attestation-id>.receipt.pdf
```

For a compliance JSON attestation, the receipt JSON should show two file leaves:
the primary file/hash and the compliance JSON hash.

## Troubleshooting

- If `--expires-in` is accepted but `api-keys list` shows `never`, run
  migrations and rebuild the Docker API container:

  ```bash
  DATABASE_URL=postgres://proveria:proveria_dev@127.0.0.1:5432/proveria \
    pnpm --filter @proveria/db db:migrate
  docker compose --profile app up -d --build api worker
  ```

- If a command returns `401 invalid_api_key`, check whether the key is missing,
  revoked, expired, or scoped to another workspace:

  ```bash
  proveria config show
  proveria api-keys list
  ```

- If `receipt` says the receipt is not available yet, confirm the worker is
  running and retry after the record is confirmed:

  ```bash
  docker compose ps worker
  proveria records get <attestation-id>
  proveria receipt <attestation-id>
  ```
