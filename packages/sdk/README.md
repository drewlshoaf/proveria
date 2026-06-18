# @proveria/sdk

Developer-preview TypeScript SDK for the Proveria public API.

For public API authentication, idempotency, retry, error-envelope, pagination,
and credential-telemetry rules, see
`docs/public-api-integration-policy.md`.

```ts
import { ProveriaClient } from '@proveria/sdk';

const proveria = new ProveriaClient({
  apiKey: process.env.PROVERIA_API_KEY!,
  tenant: process.env.PROVERIA_TENANT!,
  apiUrl: process.env.PROVERIA_API_URL,
  retry: {
    maxAttempts: 3,
  },
});
```

## API Docs And OpenAPI

The docs endpoints are public, so you can fetch them without an API key:

```ts
const docs = new ProveriaClient({
  apiUrl: process.env.PROVERIA_API_URL,
});

const openapi = await docs.docs.getOpenApi();
const docsConfig = await docs.docs.getConfig();

console.log(openapi.info.title, docsConfig.docsUrl);
```

## Credential Introspection

```ts
const credential = await proveria.apiKeys.current();

console.log(
  credential.data.keyPrefix,
  credential.data.scopes,
  credential.data.usageCount,
  credential.data.lastUsedAt,
);
```

## Producer Flow

```ts
import { ProveriaClient, sha256Hex } from '@proveria/sdk';

const proveria = new ProveriaClient({
  apiKey: process.env.PROVERIA_API_KEY!,
  tenant: process.env.PROVERIA_TENANT!,
  apiUrl: process.env.PROVERIA_API_URL,
});

const sha256 = sha256Hex('example file bytes');

await proveria.projects.create({
  slug: 'evaluation-evidence',
  name: 'Evaluation Evidence',
});

const attestations = await proveria.attestations.list({
  project: 'evaluation-evidence',
  status: 'confirmed',
  limit: 25,
});

console.log(attestations.meta.pagination.hasMore);
console.log(attestations.meta.rateLimit?.remaining);

const created = await proveria.attestations.createHash({
  project: 'evaluation-evidence',
  label: 'sdk-example',
  sha256,
  idempotencyKey: 'upstream-job-123',
});

console.log(created.data.id);

const receipt = await proveria.receipts.get(created.data.id);
const receiptJson = await proveria.receipts.getJson(created.data.id);
const receiptPdf = await proveria.receipts.getPdf(created.data.id);

console.log(receipt.data.receiptAvailable, receiptJson, receiptPdf.byteLength);
```

## Dataset Inventory Receipts

Use `createDatasetInventory` when you have a canonical dataset inventory record
object. The SDK canonicalizes the JSON, hashes it locally, extracts dataset
summary metadata, and sends only hash metadata to the public API.

```ts
const datasetInventoryRecord = {
  record_type: 'dataset_inventory_record',
  schema_version: '0.1',
  dataset: {
    name: 'Training Dataset',
    version: '2026.06',
    inventory_scope: 'folder',
    source_owner: 'Data Governance',
    license_usage_basis: 'Internal governed dataset approval.',
    data_classification: 'confidential',
    retention_rule: '7 years',
  },
  summary: {
    file_count: 2,
    total_bytes: 1536,
    dataset_root_hash: 'b'.repeat(64),
    hash_algorithm: 'sha256',
  },
  files: [
    { path: 'train/a.jsonl', sha256: 'c'.repeat(64), byte_size: 1024 },
    { path: 'eval/b.jsonl', sha256: 'd'.repeat(64), byte_size: 512 },
  ],
};

const datasetInventory = await proveria.attestations.createDatasetInventory({
  project: 'evaluation-evidence',
  record: datasetInventoryRecord,
  label: 'Training Dataset 2026.06 inventory',
  idempotencyKey: 'dataset-inventory-2026-06',
});

console.log(datasetInventory.data.id);
```

## Model Release Receipts

Use `createModelRelease` when you have a claim-backed model provenance record
object. The SDK canonicalizes the JSON, hashes it locally, extracts the model
release metadata, and sends only hash metadata to the public API.

```ts
const modelReleaseRecord = {
  record_type: 'model_provenance_record',
  schema_version: '0.1',
  model: {
    name: 'Graduation Model',
    version: '2026.06',
    type: 'classifier',
    release_stage: 'production',
  },
  claim: {
    claim_type: 'model_release_approved',
    claim_text: 'This model version was approved for production release.',
    claim_scope: 'full_release_package',
    subject_type: 'model_artifact',
    subject_identifier: 'registry://models/graduation/2026.06',
    subject_hash: 'b'.repeat(64),
  },
  artifacts: {
    artifact_manifest_hash: 'c'.repeat(64),
    model_card_hash: 'd'.repeat(64),
  },
  data_provenance: { dataset_manifest_hash: 'e'.repeat(64) },
  evaluation: { evaluation_report_hash: 'f'.repeat(64) },
  policy: {
    policy_id: 'AI-GOV-001',
    policy_version: '2026.1',
    policy_decision: 'approved',
  },
  approval: {
    final_approver: 'Model Risk Committee',
    final_approval_timestamp: '2026-06-04T18:00:00Z',
  },
  disclosure: {
    disclosure_mode: 'public_receipt_private_evidence',
    verification_policy: 'verify_model_release_claim',
  },
};

const modelRelease = await proveria.attestations.createModelRelease({
  project: 'evaluation-evidence',
  record: modelReleaseRecord,
  label: 'Graduation Model 2026.06 release',
  idempotencyKey: 'model-release-2026-06',
});

console.log(modelRelease.data.id);
```

## Verifier Access

```ts
const grant = await proveria.attestations.grantVerifierAccess({
  attestationId: created.data.id,
  email: 'verifier@example.com',
  message: 'Please verify this proof package.',
});

await proveria.attestations.revokeVerifierAccess({
  attestationId: created.data.id,
  grantId: grant.data.id,
});
```

## Evidence Exports

```ts
const manifest = await proveria.evidenceExports.manifest({
  includeEvents: true,
});

console.log(manifest.data.export.workspace.name);

const exportJob = await proveria.evidenceExports.createJob({
  includeEvents: true,
});

console.log(exportJob.data.job.id);

const completedExport = await proveria.evidenceExports.getJob(exportJob.data.job.id);

console.log(completedExport.data.manifest.export.counts);
```

## Webhooks

```ts
const webhook = await proveria.webhooks.createEndpoint({
  url: 'https://example.com/proveria/webhooks',
  events: ['receipt.issued', 'lookup.match.issued'],
  description: 'Production receiver',
});

console.log(webhook.data.signingSecret);
```

Receivers can verify signed deliveries with the webhook helpers. Preserve the
raw request body bytes and verify `proveria-webhook-signature` before parsing
the JSON payload:

```ts
import { verifyWebhookSignatureDetailed } from '@proveria/sdk';

const verification = verifyWebhookSignatureDetailed({
  signingSecret: process.env.PROVERIA_WEBHOOK_SECRET!,
  signatureHeader: req.headers['proveria-webhook-signature'] as string,
  body: rawBody,
});

if (!verification.valid) {
  throw new Error(`Invalid webhook signature: ${verification.reason}`);
}
```

The helper expects Proveria's `t=<timestamp>,v1=<hex>` signature format and uses
a 300 second timestamp tolerance by default. See
`packages/sdk/examples/webhook.ts` for a minimal Node receiver.

## Errors, Metadata, And Pagination

Protected API calls return public API metadata on `meta`, including
`requestId`, `apiKeyId`, optional `pagination`, and parsed rate-limit headers
when the API includes them:

```ts
const projects = await proveria.projects.list({ limit: 100 });

console.log(projects.meta.requestId);
console.log(projects.meta.pagination.returned);
console.log(projects.meta.rateLimit?.reset);
```

API failures throw `ProveriaApiError` with the public error contract:

```ts
try {
  await proveria.projects.create({
    slug: 'Invalid Slug',
    name: 'Invalid project',
    idempotencyKey: 'project-invalid-slug-1',
  });
} catch (error) {
  if (error instanceof ProveriaApiError) {
    console.log(error.code, error.requestId, error.retryable);
    console.log(error.fieldErrors);
  }
}
```

Retries are opt-in. When enabled, the SDK retries network failures and public
API errors with `retryable: true`. Mutating helpers reuse the same
`Idempotency-Key` and request body for every retry. `Retry-After` is honored
when the API returns it.

The alpha exports:

- `ProveriaClient`
- `ProveriaApiError`
- `sha256Hex`
- `passageProofHashes`
- `verifyWebhookSignature`
- `verifyWebhookSignatureDetailed`
- current API key metadata helper
- public docs helpers for `/v1/openapi.json` and `/v1/docs/config.json`

The client covers the current public API surface for project creation, hash
attestation creation, attestation lookup, receipt metadata and artifacts,
verifier access grants, events, evidence exports, webhook endpoints, and
display-safe current API key metadata.

Write helpers that create durable server-side records automatically send an
`Idempotency-Key`. Pass your own `idempotencyKey` when replay stability needs
to survive process restarts or match an upstream job id. Preserve that same key
and request body when retrying a mutating request.

This package is still internal to the monorepo. It is intended to become the
public `@proveria/sdk` package after the V5 API contract stabilizes.

The SDK uses the public API's stable `/v1/tenants/{slug}` paths. In the V5
product model, that slug is the workspace slug.
