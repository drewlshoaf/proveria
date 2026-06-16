# V4 API Foundation

This document records the V4 API foundation: workspace-bound API keys, the public
read surface, idempotent mutations, API-created hash attestations, verifier
access, and webhook endpoint configuration.

## API Key Management

Workspace admins can manage API keys with the existing session-authenticated
desktop/admin surface. The path remains `/tenants/:slug` for API stability, but
`:slug` is the workspace slug:

- `GET /tenants/:slug/api-keys`
- `POST /tenants/:slug/api-keys`
- `DELETE /tenants/:slug/api-keys/:id`

API keys are returned only once on creation. The database stores a display
prefix and a SHA-256 hash of the secret, not the plaintext key.

API key create/list responses include the workspace id, slug, and name so
machine clients can display or audit exactly which workspace a token belongs to.
Keys may also include an optional expiration timestamp. Expired keys are
rejected by the public API before scope checks or last-used metadata updates.
The CLI also supports a rotation workflow that creates a replacement workspace
key, revokes the old key, and can save the replacement token locally.

The first supported scopes are:

- `read`
- `write`

## Public V1 Read API

Machine clients authenticate with:

```http
Authorization: Bearer prv_v1_...
```

Supported read endpoints:

- `GET /v1/openapi.json`
- `GET /v1/tenants/:slug/projects`
- `GET /v1/tenants/:slug/attestations`
- `GET /v1/tenants/:slug/attestations/:id`
- `GET /v1/tenants/:slug/attestations/:id/receipt`
- `POST /v1/tenants/:slug/attestations/:id/lookup`
- `GET /v1/tenants/:slug/events`
- `GET /v1/tenants/:slug/webhook-endpoints`
- `GET /v1/tenants/:slug/webhook-deliveries`

Supported mutation endpoints:

- `POST /v1/tenants/:slug/projects`
- `POST /v1/tenants/:slug/projects/:projectSlug/attestations`
- `POST /v1/tenants/:slug/attestations/:id/verifier-access`
- `DELETE /v1/tenants/:slug/attestations/:id/verifier-access/:grantId`
- `POST /v1/tenants/:slug/webhook-endpoints`
- `DELETE /v1/tenants/:slug/webhook-endpoints/:endpointId`

Hash attestation creation accepts a whole-file SHA-256 produced outside
Proveria:

```json
{
  "label": "invoice-2026-05",
  "sha256": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  "fileName": "invoice.pdf",
  "byteSize": 1234
}
```

The API builds a normal manifest with one `file/sha256/v1` leaf, signs it with
the Proveria platform key, writes it to the standard immutable attempt prefix,
and enqueues the same worker validation path used by desktop submissions. The
attestation starts in `validating`; the worker confirms it and issues normal
receipt artifacts.

Verifier access creation accepts an email and optional message:

```json
{
  "email": "verifier@example.com",
  "message": "Please verify this proof package."
}
```

If the verifier already has a Proveria user account, the grant is claimed
immediately. If the email is unknown, the response includes a one-time
`claimToken` that the calling system can hand off out of band. Grant creation is
idempotent by `Idempotency-Key`; revocation soft-revokes the grant row.

Webhook endpoint creation accepts a receiver URL and event list:

```json
{
  "url": "https://example.com/proveria/webhooks",
  "events": ["receipt.issued"]
}
```

The response includes a one-time `signingSecret` with the `whsec_` prefix. Each
delivery log stores the event payload and an HMAC-SHA256 signature in the form
`t=<timestamp>,v1=<hex>`, computed over `<timestamp>.<json body>`. Delivery
events currently emitted by workers are `attestation.confirmed`,
`attestation.failed`, and `receipt.issued`.

The V5 event catalog and deferred webhook events are tracked in
`docs/v5-webhook-catalog.md`.

Webhook delivery jobs POST the signed JSON body to the endpoint URL. A 2xx
response marks the delivery `delivered`; non-2xx responses and network errors
record response details and retry with exponential backoff until the worker's
attempt limit is reached. `POST /v1/tenants/:slug/webhook-endpoints/:id/test`
creates and enqueues a `webhook.test` delivery for receiver validation.

Every public V1 response includes a `meta.requestId` so client logs can be
correlated with server logs. Public V1 errors use a stable envelope:

```json
{
  "error": {
    "code": "not_found",
    "message": "The requested resource was not found.",
    "retryable": false,
    "requestId": "..."
  }
}
```

## Boundaries

- API keys are workspace-bound and cannot read another workspace slug.
- Revoked API keys are rejected.
- Project creation requires a `write`-scoped API key.
- Hash attestation creation requires a `write`-scoped API key.
- Verifier access grant and revoke requires a `write`-scoped API key.
- Webhook endpoint configuration requires a `write`-scoped API key.
- Mutating public API requests require an `Idempotency-Key` header.
- API keys are separate from desktop device keys.
- Public API-created attestations are Proveria-signed and have no desktop
  device origin.

## CLI Alpha

The first developer CLI package lives at `apps/proveria-cli` and exposes the
`proveria` binary. It is intentionally API-backed and separate from
`proveria-hash`, which remains the local/offline hashing utility.

CLI authentication uses the same workspace-bound public API key model as the V1
API:

```bash
export PROVERIA_API_URL=http://127.0.0.1:3001
export PROVERIA_API_KEY=prv_v1_...
export PROVERIA_WORKSPACE=evaluation-workspace
```

The alpha commands are:

```bash
proveria projects list
proveria projects create evaluation-evidence --name "Evaluation Evidence"
proveria prove ./invoice.pdf --project evaluation-evidence
proveria prove bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb \
  --project evaluation-evidence \
  --name invoice-2026-05
proveria records get <attestation-id>
proveria verify ./invoice.pdf --attestation <attestation-id>
proveria verify bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb \
  --attestation <attestation-id>
proveria receipt <attestation-id>
proveria access grant <attestation-id> --email verifier@example.com
proveria access revoke <attestation-id> --grant <grant-id>
proveria webhooks create --url https://example.com/proveria/webhooks --event receipt.issued
proveria webhooks list
proveria webhooks test <endpoint-id>
proveria webhooks deliveries
```

The CLI writes successful API envelopes as JSON on stdout. Usage errors and API
errors are JSON on stderr. Exit codes are:

- `0` for success;
- `1` for API, network, or runtime failures;
- `2` for CLI usage/configuration errors.

## TypeScript SDK Alpha

The first TypeScript SDK package lives at `packages/sdk` and is intended to
become the public `@proveria/sdk` package after the V4 API contract stabilizes.

The alpha exports:

- `ProveriaClient`
- `ProveriaApiError`
- `sha256Hex`
- `passageProofHashes`
- `verifyWebhookSignature`

The typed client covers the first public API flows:

```ts
const proveria = new ProveriaClient({
  apiKey: process.env.PROVERIA_API_KEY!,
  tenant: process.env.PROVERIA_WORKSPACE!,
  apiUrl: process.env.PROVERIA_API_URL,
});

await proveria.projects.list();
await proveria.attestations.createHash({
  project: 'evaluation-evidence',
  label: 'invoice-2026-05',
  sha256: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
});
await proveria.attestations.verifyHash({
  attestationId: '<attestation-id>',
  sha256: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  lookupKind: 'whole_file',
});
await proveria.receipts.get('<attestation-id>');
```

## Python SDK Spike

The Python spike lives at `packages/python-sdk` and is intended to become the
public `proveria` PyPI package after the V4 API contract stabilizes.

The spike intentionally uses only the Python standard library. It covers:

- `ProveriaClient`
- API-key authentication
- `list_projects()`
- `create_hash_attestation()`
- `get_attestation()`
- `verify_hash()`
- `get_receipt()`
- `sha256_hex()`
- `verify_webhook_signature()`

Example:

```python
from proveria import ProveriaClient, sha256_hex

client = ProveriaClient(
    api_key="prv_v1_...",
    tenant="evaluation-workspace",
    api_url="http://127.0.0.1:3001",
)

created = client.create_hash_attestation(
    project="evaluation-evidence",
    label="python-example",
    sha256=sha256_hex(b"example file bytes"),
)
```

## Contract Tests

The first contract tests pin:

- the served OpenAPI path list;
- authentication error envelopes;
- successful data envelopes;
- idempotent project creation replay and conflict behavior;
- idempotent whole-file SHA-256 attestation creation;
- verifier access grant and revoke behavior;
- webhook endpoint configuration and delivery log visibility;
- webhook test-event enqueue behavior;
- cross-tenant `not_found` envelopes.
