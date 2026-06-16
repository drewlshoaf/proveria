# CLI Compliance And Receipt QA Checklist

Use this checklist to verify the command-line compliance JSON attachment,
receipt export, and verify flow. Record tester name, date, environment, and any
issue links for failed items.

## Setup

- [ ] Pull latest `main`.
- [ ] Start local infra, API, worker, and any required supporting services.
- [ ] Run database migrations if the API startup path did not already run them.
- [ ] Run `pnpm eval:seed`.
- [ ] Confirm API health is available at `http://127.0.0.1:3001/healthz`.
- [ ] Install or update the released CLI binary with Homebrew:

```bash
brew update
brew reinstall proveria/tap/proveria
proveria --version
```

- [ ] Confirm `proveria --version` shows the expected release.

- [ ] If testing unreleased source changes, install the Rust CLI binary from
      the monorepo instead:

```bash
cargo install --path apps/proveria-cli --force
proveria --help
```

- [ ] Export CLI environment variables:

```bash
export PROVERIA_API_URL=http://127.0.0.1:3001
export PROVERIA_WORKSPACE=evaluation-workspace
```

- [ ] Sign in with the seeded admin account:

```bash
proveria auth login \
  --email admin-producer-eval@example.com \
  --password admin-producer-eval-password-123
```

- [ ] Create and activate a workspace API key with write access:

```bash
proveria api-keys create \
  --name "CLI compliance QA" \
  --scope read \
  --scope write \
  --expires-in 90d \
  --use-key
```

- [ ] Confirm `proveria api-keys list` shows the key with expiration, usage
      count, and last-use columns.
- [ ] Rotate the workspace API key and activate the replacement:

```bash
proveria api-keys rotate <api-key-id> \
  --name "CLI compliance QA rotated" \
  --scope read \
  --scope write \
  --expires-in 90d \
  --use-key
```

- [ ] Confirm the rotated replacement key can list projects.
- [ ] Confirm the original key is revoked in `proveria api-keys list`.
- [ ] Confirm the replacement key shows an expiration value.
- [ ] Confirm the original token fails with `401 invalid_api_key` when used
      directly:

```bash
PROVERIA_API_KEY=<original-token> proveria records get <attestation-id>
```

## Happy Path

- [ ] Confirm the sample compliance JSON exists at
      `docs/examples/compliance-controls.json`.

- [ ] Create a hash attestation with the compliance JSON attached:

```bash
proveria prove bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb \
  --project evaluation-evidence \
  --name cli-compliance-qa-final \
  --file-name qa-sample.pdf \
  --byte-size 1234 \
  --compliance-json docs/examples/compliance-controls.json
```

- [ ] Confirm the command returns JSON with an attestation id and `state` of `validating`.
- [ ] Poll the attestation until it is `confirmed`:

```bash
proveria records get <attestation-id>
```

- [ ] Confirm the record output says `state: confirmed`.
- [ ] Confirm the record output says `receipt: available`.
- [ ] Confirm receipt metadata is available:

```bash
proveria receipt <attestation-id>
```

- [ ] Confirm the receipt output says `receipt_json: available`.
- [ ] Confirm the receipt output says `receipt_pdf: available`.
- [ ] Export both receipt artifacts:

```bash
proveria receipt <attestation-id> \
  --json \
  --pdf \
  --output ./tmp-cli-receipt
```

- [ ] Confirm the CLI writes both files:

```text
./tmp-cli-receipt/<attestation-id>.receipt.json
./tmp-cli-receipt/<attestation-id>.receipt.pdf
```

- [ ] Open the JSON receipt and confirm it is valid JSON:

```bash
cat ./tmp-cli-receipt/<attestation-id>.receipt.json
```

- [ ] Confirm the attestation can verify the primary file hash:

```bash
proveria verify bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb \
  --attestation <attestation-id>
```

- [ ] Confirm the matching verify command returns `MATCH`.
- [ ] Confirm a known wrong hash returns a clean no-match:

```bash
proveria verify dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd \
  --attestation <attestation-id>
```

- [ ] Confirm the wrong-hash verify command returns `NO MATCH`.

## Compliance JSON Behavior

Set the attestation id from the happy-path command:

```bash
export ATTESTATION_ID=<attestation-id>
```

Fetch the manifest object key from Postgres:

```bash
export MANIFEST_KEY=$(docker compose exec -T postgres psql -U proveria -d proveria -Atc "select manifest_object_key from attestations where id = '$ATTESTATION_ID';")
```

Download the manifest from local MinIO:

```bash
docker run --rm \
  --network proveria \
  --entrypoint /bin/sh \
  -e MANIFEST_KEY="$MANIFEST_KEY" \
  minio/mc:latest \
  -c 'mc alias set local http://minio:9000 proveria proveria_dev_minio >/dev/null && mc cat "local/proveria-artifacts/$MANIFEST_KEY"' \
  > ./tmp-cli-receipt/$ATTESTATION_ID.manifest.json
```

Confirm the manifest has two file leaves:

```bash
jq '.leaf_counts.file' ./tmp-cli-receipt/$ATTESTATION_ID.manifest.json
```

Expected:

```text
2
```

Inspect the compliance JSON leaf metadata:

```bash
jq '.leaf_set[] | select(.metadata.source == "compliance_json") | .metadata' ./tmp-cli-receipt/$ATTESTATION_ID.manifest.json
```

Expected fields:

```json
{
  "source": "compliance_json",
  "media_type": "application/json",
  "canonicalization": "json-stable-v1",
  "file_name": "compliance-controls.json"
}
```

Confirm the manifest source summary:

```bash
jq '.source_summary.compliance_document_count' ./tmp-cli-receipt/$ATTESTATION_ID.manifest.json
```

Expected:

```text
1
```

Confirm the compliance JSON body was not stored directly:

```bash
rg "control_owner|encryption_at_rest|retention_days|soc2|hipaa" ./tmp-cli-receipt/$ATTESTATION_ID.manifest.json
```

Expected: no matches.

- [ ] Confirm the compliance JSON file contents were not uploaded directly.
- [ ] Confirm the receipt or manifest evidence shows two file leaves.
- [ ] Confirm one file leaf has metadata source `public_api`.
- [ ] Confirm one file leaf has metadata source `compliance_json`.
- [ ] Confirm the compliance leaf metadata includes:
  - [ ] `media_type` of `application/json`.
  - [ ] `canonicalization` of `json-stable-v1`.
  - [ ] `file_name` of `compliance-controls.json`.
- [ ] Confirm the manifest source summary includes `compliance_document_count: 1`.

## Negative Cases

- [ ] Run with a missing JSON path and confirm the CLI fails before making an API request.
- [ ] Run with invalid JSON and confirm the CLI reports `Invalid --compliance-json`.
- [ ] Run with a JSON array instead of an object and confirm the CLI reports `Invalid --compliance-json`.
- [ ] Run with the same SHA-256 for the primary hash and compliance hash and confirm the API rejects it.
- [ ] Run with `proveria api-keys create --name "expired" --expires-in 0d` and confirm the CLI rejects the expiration before creating a key.
- [ ] Run after `proveria config set --api-key ""` and confirm the CLI reports missing API key.

## Operational Troubleshooting QA

- [ ] Confirm the local database has API key expiration support:

```bash
docker compose exec -T postgres psql -U proveria -d proveria \
  -c "select column_name from information_schema.columns where table_name = 'api_keys' and column_name = 'expires_at';"
```

Expected: one row containing `expires_at`.

- [ ] If `api-keys list` shows `EXPIRES never` after a command with
      `--expires-in`, run migrations and rebuild app containers:

```bash
DATABASE_URL=postgres://proveria:proveria_dev@127.0.0.1:5432/proveria \
  pnpm --filter @proveria/db db:migrate

docker compose --profile app up -d --build api worker
```

- [ ] Confirm API health is still green after rebuild:

```bash
curl -sS http://127.0.0.1:3001/healthz
```

- [ ] Confirm receipt errors are understandable when the worker is not ready,
      and confirm they clear after the worker is running.

## Documentation

- [ ] Confirm [docs/cli.md](/Users/drewshoaf/proveria/docs/cli.md) includes the compliance JSON command.
- [ ] Confirm [docs/cli.md](/Users/drewshoaf/proveria/docs/cli.md) includes API key expiration and rotation commands.
- [ ] Confirm [docs/cli.md](/Users/drewshoaf/proveria/docs/cli.md) includes the Homebrew install and upgrade commands.
- [ ] Confirm [docs/cli.md](/Users/drewshoaf/proveria/docs/cli.md) includes CLI troubleshooting for stale Docker containers, missing migrations, `401 invalid_api_key`, and receipt availability.
- [ ] Confirm [docs/cli.md](/Users/drewshoaf/proveria/docs/cli.md) includes the receipt artifact export command.
- [ ] Confirm [apps/proveria-cli/README.md](/Users/drewshoaf/proveria/apps/proveria-cli/README.md) includes the receipt artifact output filenames.
- [ ] Confirm [docs/public-api-examples.md](/Users/drewshoaf/proveria/docs/public-api-examples.md) includes the API shape for compliance JSON metadata.

## Sign-Off

- [ ] All blocking failures are linked to issues or PRs.
- [ ] Known limitations are documented.
- [ ] Tester signs off with name and date.
