# Proveria CLI

The Proveria CLI is a Rust command-line client for the public API. It is the
primary local interface for hashing files, creating proof records, verifying
hashes or files, retrieving receipts, and exporting evidence.

## Setup

Install the released CLI with Homebrew:

```bash
brew tap proveria/tap
brew install proveria/tap/proveria
proveria --version
```

Upgrade an existing install:

```bash
brew update
brew reinstall proveria/tap/proveria
proveria --version
```

For local source development, install the CLI from the monorepo:

```bash
cargo install --path apps/proveria-cli --force
```

Confirm the binary is on your path:

```bash
proveria --help
```

If `proveria` is not found, make sure Cargo's bin directory is on your shell
path:

```bash
export PATH="$HOME/.cargo/bin:$PATH"
```

Configure the local API target:

```bash
export PROVERIA_API_URL=http://127.0.0.1:3001
export PROVERIA_WORKSPACE=evaluation-workspace
```

During development, this wrapper is still available if you do not want to
install the binary:

```bash
pnpm cli -- help
```

This delegates to the Rust package in [apps/proveria-cli](/Users/drewshoaf/proveria/apps/proveria-cli).

## Create An API Key

API keys are workspace-bound. Sign in with an admin account, then create a key
for the selected workspace:

```bash
proveria auth login \
  --email admin-producer-eval@example.com \
  --password admin-producer-eval-password-123

proveria api-keys create \
  --name "CLI development" \
  --scope read \
  --scope write \
  --expires-in 90d \
  --use-key
```

The token is shown once. `--use-key` also saves it as the active CLI key, so
you do not need to export `PROVERIA_API_KEY` for later commands. You can still
provide a key explicitly:

```bash
export PROVERIA_API_KEY=prv_v1_replace_me
```

Useful API key commands:

```bash
proveria api-keys list
proveria api-keys rotate <api-key-id> --name "CLI development rotated" --expires-in 90d --use-key
proveria api-keys revoke <api-key-id>
proveria auth logout
```

`api-keys create` and `api-keys list` show the workspace name, slug, and
expiration for each key. `api-keys list` also shows aggregate usage telemetry:
successful use count plus the last authenticated method, route, status, and
timestamp. A key can only operate against that workspace slug, even if the same
user has access to other workspaces. Use `--expires-in` with minutes, hours,
days, or weeks, such as `90m`, `12h`, `90d`, or `4w`.
`api-keys rotate` creates a replacement token, revokes the old key, and can save
the replacement token into local CLI config with `--use-key`.

When QAing rotation, verify both sides:

```bash
# Replacement key should work.
PROVERIA_API_KEY=<replacement-token> proveria records get <attestation-id>

# Original key should fail with 401 invalid_api_key.
PROVERIA_API_KEY=<original-token> proveria records get <attestation-id>
```

If `--expires-in` was accepted but `api-keys list` still shows `never`, the
running API or database is stale. Run migrations and recreate the API container
from current source before retesting.

## List Projects

```bash
proveria projects list
```

## Create A Hash Proof

Use this when the file was already hashed outside Proveria:

```bash
proveria prove bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb \
  --project evaluation-evidence \
  --name invoice-2026-05 \
  --file-name invoice.pdf \
  --byte-size 1234
```

The command creates an attestation and returns JSON. The attestation starts in
`validating`; use `records get` to poll until it becomes `confirmed`.

## Prove A Local File

Use this when the CLI should hash the file locally:

```bash
proveria prove ./invoice.pdf \
  --project evaluation-evidence \
  --name invoice-2026-05
```

The file bytes stay local. The CLI sends the SHA-256 and file metadata to the
API.

## Attach Compliance JSON

Attach a compliance JSON document with `--compliance-json`.

```bash
proveria prove bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb \
  --project evaluation-evidence \
  --name invoice-2026-05 \
  --file-name invoice.pdf \
  --byte-size 1234 \
  --compliance-json docs/examples/compliance-controls.json
```

The CLI validates `docs/examples/compliance-controls.json`, canonicalizes it
with stable sorted JSON keys, hashes it locally, and sends only this metadata to
the API:

```json
{
  "sha256": "<compliance-json-sha256>",
  "fileName": "compliance-controls.json",
  "byteSize": 85,
  "mediaType": "application/json",
  "canonicalization": "json-stable-v1"
}
```

The compliance JSON content itself is not uploaded. Its hash is committed as a
second file leaf in the same attestation manifest, so the final receipt covers
both the primary file hash and the compliance document hash.

## Create A Dataset Inventory Receipt

Use this path for AI dataset provenance workflows. The CLI recursively hashes a
local folder, writes a dataset inventory record, and keeps raw dataset bytes
local.

```bash
proveria dataset collect ./dataset \
  --output ./dataset-inventory.json \
  --name "Training Dataset" \
  --version 2026.06 \
  --classification confidential
```

Inspect the canonical hash and dataset summary:

```bash
proveria dataset inspect ./dataset-inventory.json
```

Submit the inventory record hash as an attestation:

```bash
proveria dataset attest ./dataset-inventory.json \
  --project evaluation-evidence \
  --name "Training Dataset 2026.06 inventory"
```

The final receipt covers the canonical inventory hash, dataset root hash, file
count, total bytes, and classification metadata. It does not upload raw dataset
files.

## Create A Dataset Revision Receipt

Use `proveria dataset revision` to compare two inventory records and produce a
`dataset_revision_record`.

```bash
proveria dataset revision \
  --base ./dataset-2026.05.json \
  --next ./dataset-2026.06.json \
  --output ./dataset-revision.json
```

Inspect and submit the revision record:

```bash
proveria dataset inspect ./dataset-revision.json

proveria dataset attest ./dataset-revision.json \
  --project evaluation-evidence \
  --name "Training Dataset 2026.05 to 2026.06 revision"
```

The revision record reports new, changed, removed, and unchanged paths. The
public API receives the canonical revision hash and summary metadata, not raw
dataset bytes.

## Create A Model Release Receipt

Use this path for API-first model governance workflows. The starter file is a
claim-backed provenance record, not a generic model metadata blob.

```bash
proveria model-release init --output ./model-release.json
```

Edit the record, then inspect the canonical hash that will be committed:

```bash
proveria model-release inspect ./model-release.json
```

Submit the release record hash as an attestation:

```bash
proveria model-release attest ./model-release.json \
  --project evaluation-evidence \
  --name "Graduation Model 2026.06 release"
```

The CLI canonicalizes the JSON locally, computes the SHA-256 of the canonical
record, extracts the model release claim metadata, and sends only hash metadata
to the public API. The model release JSON body stays local unless you separately
store it in your own evidence repository.

## Compliance Receipt QA Flow

Use this sequence when testing the CLI compliance workflow end to end. It keeps
the primary hash, compliance JSON, record lookup, receipt export, and verifier
lookup tied to one attestation.

Create the proof:

```bash
proveria prove bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb \
  --project evaluation-evidence \
  --name cli-compliance-qa-final \
  --file-name qa-sample.pdf \
  --byte-size 1234 \
  --compliance-json docs/examples/compliance-controls.json
```

Copy the returned attestation id, then poll until the record is confirmed:

```bash
proveria records get <attestation-id>
```

Expected status output:

```text
state: confirmed
receipt: available
```

Check receipt metadata:

```bash
proveria receipt <attestation-id>
```

Expected receipt output:

```text
receipt_json: available
receipt_pdf: available
```

Export both receipt artifacts:

```bash
proveria receipt <attestation-id> \
  --json \
  --pdf \
  --output ./tmp-cli-receipt
```

Expected files:

```text
./tmp-cli-receipt/<attestation-id>.receipt.json
./tmp-cli-receipt/<attestation-id>.receipt.pdf
```

Inspect the JSON receipt:

```bash
cat ./tmp-cli-receipt/<attestation-id>.receipt.json
```

For a compliance JSON attestation, `leaf_counts.file` should be `2`: one leaf
for the primary file hash and one leaf for the compliance JSON hash.

Verify a matching hash:

```bash
proveria verify bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb \
  --attestation <attestation-id>
```

Verify a clean no-match:

```bash
proveria verify dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd \
  --attestation <attestation-id>
```

## Get Attestation Status

```bash
proveria records get <attestation-id>
```

## Get Receipt Metadata

```bash
proveria receipt <attestation-id>
```

## Export Receipt Artifacts

Use `receipt` with `--json`, `--pdf`, or both. `--output` is a directory, not a
file path.

```bash
proveria receipt <attestation-id> --json --pdf --output ./receipts
```

This writes:

```text
./receipts/<attestation-id>.receipt.json
./receipts/<attestation-id>.receipt.pdf
```

## Verify A Hash

```bash
proveria verify bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb \
  --attestation <attestation-id>
```

## Verify A Local File

```bash
proveria verify ./invoice.pdf --attestation <attestation-id>
```

## Events And Evidence Export

```bash
proveria events

proveria export --output ./evidence-export.json

proveria export collect --limit 100 --output ./evidence --zip ./evidence.zip --tar ./evidence.tar

proveria export create --limit 100 --output ./evidence-export.json

proveria export jobs

proveria export get <job-id> --output ./evidence-export.json

proveria export bundle <job-id> --output ./evidence-bundle.json

proveria export inspect ./evidence-bundle.json

proveria export inspect ./evidence-bundle.json --output json

proveria export check ./evidence-bundle.json

proveria export unpack ./evidence-bundle.json --output ./evidence

proveria export check ./evidence

proveria export zip ./evidence-bundle.json --output ./evidence.zip

proveria export tar ./evidence-bundle.json --output ./evidence.tar
```

## Current Commands

```text
proveria auth login --email <email> --password <password>
proveria auth logout
proveria api-keys create --name <name> --scope read --scope write [--expires-in 90d] [--use-key]
proveria api-keys list
proveria api-keys rotate <api-key-id> [--name <name>] [--scope read] [--scope write] [--expires-in 90d] [--use-key]
proveria api-keys revoke <api-key-id>
proveria config set --api-url <url> --workspace <slug> --api-key <key>
proveria config show
proveria completions zsh
proveria hash <file>
proveria projects list
proveria projects create <slug> --name <name>
proveria attestations [--project <slug>] [--status <state>] [--limit <n>]
proveria prove <sha256> --project <slug> --name <name> [--file-name <name>] [--byte-size <bytes>] [--compliance-json <path>]
proveria prove <file> --project <slug> [--name <name>] [--compliance-json <path>]
proveria prove hash <sha256> --project <slug> --name <name> [--file-name <name>] [--byte-size <bytes>] [--compliance-json <path>]
proveria prove file <file> --project <slug> [--name <name>] [--compliance-json <path>]
proveria dataset init --output <file>
proveria dataset collect <folder> --output <file> --name <name> --version <version>
proveria dataset inspect <file> [--output json]
proveria dataset attest <file> --project <slug> [--name <name>] [--output json]
proveria model-release init --output <file>
proveria model-release inspect <file> [--output json]
proveria model-release attest <file> --project <slug> [--name <name>] [--output json]
proveria records get <attestation-id>
proveria receipt <attestation-id> [--json] [--pdf] [--output <dir>]
proveria access grant <attestation-id> --email <email> [--message <text>]
proveria access revoke <attestation-id> --grant <grant-id>
proveria verify <sha256> --attestation <attestation-id>
proveria verify <file> --attestation <attestation-id>
proveria verify passage <text> --attestation <attestation-id>
proveria events [--category <category>] [--limit <n>]
proveria export [--output <file>]
proveria export collect [--limit <n>] --output <dir> [--zip <file>] [--tar <file>]
proveria export create [--limit <n>] [--output <file>]
proveria export jobs [--limit <n>]
proveria export get <job-id> [--output <file>]
proveria export bundle <job-id> [--output <file>]
proveria export inspect <bundle-json> [--output json]
proveria export check <bundle-json-or-directory> [--output json]
proveria export unpack <bundle-json> --output <dir>
proveria export zip <bundle-json> --output <file>
proveria export tar <bundle-json> --output <file>
proveria webhooks create --url <url> --event <event>
proveria webhooks list
proveria webhooks test <endpoint-id>
proveria webhooks deliveries
proveria webhooks disable <endpoint-id>
```

## Final Installed CLI Smoke

Use this before calling a CLI release ready. Run it against the installed
Homebrew binary, not `pnpm cli`.

```bash
proveria --version
proveria config show
proveria projects list
proveria api-keys list
proveria prove bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb \
  --project evaluation-evidence \
  --name cli-release-smoke \
  --file-name qa-sample.pdf \
  --byte-size 1234 \
  --compliance-json docs/examples/compliance-controls.json
proveria records get <attestation-id>
proveria receipt <attestation-id>
proveria receipt <attestation-id> --json --pdf --output ./tmp-cli-receipt
proveria verify bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb \
  --attestation <attestation-id>
proveria verify dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd \
  --attestation <attestation-id>
```

For API key lifecycle QA:

```bash
proveria api-keys create \
  --name "CLI rotation smoke" \
  --scope read \
  --scope write \
  --expires-in 1d \
  --output json

proveria api-keys rotate <api-key-id> \
  --name "CLI rotation smoke replacement" \
  --scope read \
  --scope write \
  --expires-in 1d \
  --output json

PROVERIA_API_KEY=<replacement-token> proveria records get <attestation-id>
PROVERIA_API_KEY=<original-token> proveria records get <attestation-id>

proveria api-keys revoke <replacement-api-key-id>
```

Expected results:

- the created key and replacement key show real `expiresAt` values;
- the original token fails with `401 invalid_api_key` after rotation;
- the replacement token can read records;
- temporary QA keys are revoked after the test.

## Troubleshooting

### `api-keys list` Shows `EXPIRES never` After `--expires-in`

Confirm the running API container and database match the current source:

```bash
DATABASE_URL=postgres://proveria:proveria_dev@127.0.0.1:5432/proveria \
  pnpm --filter @proveria/db db:migrate

docker compose --profile app up -d --build api worker
```

Then confirm the migration exists:

```bash
docker compose exec -T postgres psql -U proveria -d proveria \
  -c "select column_name from information_schema.columns where table_name = 'api_keys' and column_name = 'expires_at';"
```

The query should return `expires_at`.

### `401 invalid_api_key`

The API key is missing, expired, revoked, or scoped to a different workspace.
Check the active config and key list:

```bash
proveria config show
proveria api-keys list
```

If you are testing a specific token, pass it directly:

```bash
PROVERIA_API_KEY=<token> proveria records get <attestation-id>
```

### Receipt Is Not Available Yet

`receipt_not_available` means the attestation exists but the worker has not
finished validation and receipt generation. Confirm the worker is running:

```bash
docker compose ps worker
docker compose logs worker --tail 80
```

Then retry:

```bash
proveria records get <attestation-id>
proveria receipt <attestation-id>
```

### Docker App Containers Are Stale

The app-profile containers are built images. They do not automatically pick up
source changes from your checkout. After pulling changes that affect API,
worker, or verifier code, rebuild/recreate them:

```bash
docker compose --profile app up -d --build api worker verifier
```
