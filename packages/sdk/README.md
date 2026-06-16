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
