# V6 API Producer Quickstart

This quickstart is for server-side producer integrations that create projects,
submit whole-file SHA-256 attestations, fetch receipts, and optionally grant a
verifier access without using the desktop app for the workflow itself.

For the public API contract and operational rules, see
`docs/public-api-integration-policy.md`. For endpoint-by-endpoint examples, see
`docs/public-api-examples.md`.

For model governance workflows, use
`docs/v6-model-card-provenance-attachment.md` to connect a model card to model
release, dataset inventory, dataset revision, evaluation, policy, approval, and
audit-package receipts.

## Prerequisites

Start the local stack and seed evaluation data:

```bash
pnpm dev:infra
pnpm dev
pnpm eval:seed
```

Create a workspace API key with read and write scopes. Locally, the fastest path
is to sign in with the CLI and create a key for the seeded evaluation workspace:

```bash
proveria auth login \
  --email admin-producer-eval@example.com \
  --password admin-producer-eval-password-123

proveria api-keys create \
  --name "API producer quickstart" \
  --scope read \
  --scope write \
  --expires-in 90d \
  --use-key
```

Set environment variables for API calls:

```bash
export PROVERIA_API_URL=http://127.0.0.1:3001
export PROVERIA_WORKSPACE=evaluation-workspace
export PROVERIA_API_KEY=prv_v1_replace_me
export PROVERIA_PROJECT=api-producer-quickstart
```

## Curl Path

Create or replay a project creation request. Mutating public API calls require a
stable `Idempotency-Key`.

```bash
curl -sS "$PROVERIA_API_URL/v1/tenants/$PROVERIA_WORKSPACE/projects" \
  -H "Authorization: Bearer $PROVERIA_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: project-api-producer-quickstart-001" \
  -d '{
    "slug": "api-producer-quickstart",
    "name": "API Producer Quickstart",
    "visibility": "private"
  }'
```

Hash a local file without uploading its bytes to Proveria:

```bash
printf "Proveria API producer quickstart\n" > ./tmp-api-producer.txt
export PROVERIA_FILE_SHA256=$(shasum -a 256 ./tmp-api-producer.txt | awk '{print $1}')
export PROVERIA_FILE_BYTES=$(wc -c < ./tmp-api-producer.txt | tr -d ' ')
```

Create the attestation from the local hash:

```bash
curl -sS "$PROVERIA_API_URL/v1/tenants/$PROVERIA_WORKSPACE/projects/$PROVERIA_PROJECT/attestations" \
  -H "Authorization: Bearer $PROVERIA_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: attestation-api-producer-quickstart-001" \
  -d "{
    \"label\": \"api-producer-quickstart\",
    \"sha256\": \"$PROVERIA_FILE_SHA256\",
    \"fileName\": \"tmp-api-producer.txt\",
    \"byteSize\": $PROVERIA_FILE_BYTES
  }"
```

The response starts in `validating`. Save the returned `data.id`, then poll
until `state` is `confirmed`:

```bash
export PROVERIA_ATTESTATION_ID=<attestation-id>

curl -sS "$PROVERIA_API_URL/v1/tenants/$PROVERIA_WORKSPACE/attestations/$PROVERIA_ATTESTATION_ID" \
  -H "Authorization: Bearer $PROVERIA_API_KEY"
```

Fetch receipt metadata and artifacts:

```bash
curl -sS "$PROVERIA_API_URL/v1/tenants/$PROVERIA_WORKSPACE/attestations/$PROVERIA_ATTESTATION_ID/receipt" \
  -H "Authorization: Bearer $PROVERIA_API_KEY"

curl -sS "$PROVERIA_API_URL/v1/tenants/$PROVERIA_WORKSPACE/attestations/$PROVERIA_ATTESTATION_ID/receipt.json" \
  -H "Authorization: Bearer $PROVERIA_API_KEY" \
  -o ./tmp-api-producer.receipt.json

curl -sS "$PROVERIA_API_URL/v1/tenants/$PROVERIA_WORKSPACE/attestations/$PROVERIA_ATTESTATION_ID/receipt.pdf" \
  -H "Authorization: Bearer $PROVERIA_API_KEY" \
  -o ./tmp-api-producer.receipt.pdf
```

Verify the same hash against the attestation:

```bash
curl -sS "$PROVERIA_API_URL/v1/tenants/$PROVERIA_WORKSPACE/attestations/$PROVERIA_ATTESTATION_ID/lookup" \
  -H "Authorization: Bearer $PROVERIA_API_KEY" \
  -H "Content-Type: application/json" \
  -d "{
    \"submittedHash\": \"$PROVERIA_FILE_SHA256\",
    \"lookupKind\": \"whole_file\"
  }"
```

Optionally grant a verifier access:

```bash
curl -sS "$PROVERIA_API_URL/v1/tenants/$PROVERIA_WORKSPACE/attestations/$PROVERIA_ATTESTATION_ID/verifier-access" \
  -H "Authorization: Bearer $PROVERIA_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: grant-api-producer-quickstart-001" \
  -d '{
    "email": "verifier-eval@example.com",
    "message": "Please verify this quickstart attestation."
  }'
```

## TypeScript SDK Path

The SDK hashes locally and sends only the SHA-256 plus metadata:

```ts
import { readFile } from 'node:fs/promises';

import { ProveriaApiError, ProveriaClient, sha256Hex } from '@proveria/sdk';

const proveria = new ProveriaClient({
  apiKey: process.env.PROVERIA_API_KEY!,
  tenant: process.env.PROVERIA_WORKSPACE!,
  apiUrl: process.env.PROVERIA_API_URL,
  retry: { maxAttempts: 3 },
});

const project = process.env.PROVERIA_PROJECT ?? 'api-producer-quickstart';
const fileName = './tmp-api-producer.txt';
const file = await readFile(fileName);
const sha256 = sha256Hex(file);

try {
  await proveria.projects.create({
    slug: project,
    name: 'API Producer Quickstart',
    visibility: 'private',
    idempotencyKey: 'project-api-producer-quickstart-001',
  });

  const created = await proveria.attestations.createHash({
    project,
    label: 'api-producer-quickstart',
    sha256,
    fileName,
    byteSize: file.byteLength,
    idempotencyKey: 'attestation-api-producer-quickstart-001',
  });

  let attestation = created.data;
  while (attestation.state === 'validating') {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    attestation = (await proveria.attestations.get(attestation.id)).data;
  }

  const receipt = await proveria.receipts.get(attestation.id);
  const verification = await proveria.attestations.verifyHash({
    attestationId: attestation.id,
    sha256,
    lookupKind: 'whole_file',
  });

  console.log({
    attestationId: attestation.id,
    state: attestation.state,
    receiptAvailable: receipt.data.receiptAvailable,
    verification: verification.data.resultType,
  });
} catch (error) {
  if (error instanceof ProveriaApiError) {
    console.error(error.code, error.requestId, error.retryable, error.fieldErrors);
    process.exitCode = 1;
  } else {
    throw error;
  }
}
```

## Production Notes

- Use workspace API keys for server-side producer jobs. Do not embed API keys in
  browsers, desktop clients, or mobile apps.
- Use durable idempotency keys from your own system, such as source record ids,
  queue job ids, dataset revision ids, or CI build ids.
- Log `meta.requestId` and `meta.apiKeyId` from API responses.
- Retry only network failures or API errors with `retryable: true`; preserve
  the same request body and idempotency key.
- Hash evidence locally. Proveria receives the hash, file metadata, lifecycle
  records, and generated receipt artifacts, not the original file bytes.
