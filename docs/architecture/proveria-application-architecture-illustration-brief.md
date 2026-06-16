# Proveria Application Architecture Illustration Brief

This document is an illustrator-facing brief for a high-level application and network architecture view of Proveria. It should help produce a polished visual that explains the major runtime components, local Docker Compose infrastructure, data flows, and optional/future integration points without becoming a low-level deployment diagram.

Use "Proveria" as the product name in the illustration.

## Visual Goal

Show Proveria as a trust and evidence platform built around local hashing, signed submissions, an API service, asynchronous workers, durable data stores, object artifacts, developer surfaces, verifier workflows, and optional external integrations.

The image should make these ideas clear:

- Producers and admins use the desktop app, CLI, SDKs, or API to create attestations and manage workspaces.
- Verifiers use a verifier web app or public receipt/result links to check evidence.
- The API is the main control plane for authentication, tenancy, projects, attestations, events, exports, webhooks, and developer access.
- The worker handles asynchronous validation, receipt generation, webhook delivery, and evidence export packaging.
- Postgres is the system of record.
- Redis is the queue, rate-limit, and short-lived coordination layer.
- S3-compatible object storage holds immutable evidence artifacts and export bundles.
- Blockchain anchoring should appear as an optional/future provider plugin path, not as a required core runtime dependency.

## Recommended Layout

Use a left-to-right diagram with layered bands:

1. Client and user layer on the left.
2. Proveria application network in the center.
3. Data stores and artifact storage below or behind the core services.
4. External integrations on the right.
5. Docker Compose local runtime as a foundation strip at the bottom.

Recommended zones:

- Left: "Users and Developer Surfaces"
- Center: "Proveria Application Services"
- Lower center: "Durable Data and Artifact Stores"
- Right: "External Outputs and Integrations"
- Bottom: "Local Docker Compose Runtime"

Use solid arrows for implemented runtime paths. Use dotted arrows and a "optional / future" label for blockchain anchoring and provider plugins.

## User And Client Layer

Show these as entry points into Proveria:

- Desktop app
  - Used by producers and admins.
  - Handles local file selection, local hashing, signed device requests, workspace/admin workflows, evidence exports, events, users, API keys, and verifier access.
  - Important visual note: raw customer files stay local during normal attestation creation; hashes, proofs, and metadata are submitted.
- Verifier web app
  - Used for private verifier lookup links and public receipt/result pages.
  - Talks to the API rather than directly reading databases.
- CLI
  - Used for scripted attestation, verification, receipt, evidence export, API key, webhook, and workspace workflows.
- TypeScript SDK
  - Used by API-first developers and Node/TypeScript integrations.
- Python SDK
  - Used by Python developers, automation scripts, and dataset/evidence pipelines.
- Public API consumers
  - Server-to-server integrations using API keys and the public `/v1` API.

Illustration cue: place these clients outside the Proveria application network boundary and connect them to the API service with authenticated arrows. Add small lock/key labels such as "session auth", "device signatures", and "API keys".

## Proveria Application Services

### API Service

The API service is the control plane and request gateway.

Responsibilities to show:

- Authentication and session handling.
- Trusted desktop devices and signed device requests.
- Optional OIDC sign-in providers.
- Tenant, organization, workspace, user, invitation, and workspace access management.
- Project and attestation APIs.
- Verifier access requests and grants.
- Receipt/result/public verification APIs.
- Events and immutable audit log reads.
- Evidence export job creation and cleanup.
- API key management.
- Webhook endpoint configuration and test delivery creation.
- OpenAPI and developer docs surface.
- Rate-limit checks and job enqueueing through Redis.

Visual cue: draw this as the central service box labeled `api` / `proveria-api`, with arrows to Postgres, Redis, and S3-compatible object storage.

### Worker Service

The worker service is the asynchronous execution layer.

Responsibilities to show:

- Consumes Redis-backed queues.
- Validates attestation manifests and proofs.
- Generates receipt JSON and receipt PDFs.
- Writes validation results, receipts, lookup results, and export bundles to object storage.
- Updates job status and progress in Postgres.
- Creates audit/event records for lifecycle actions.
- Builds evidence export manifests and artifact bundles.
- Delivers signed webhooks and records delivery status/retries.
- Can later submit anchoring jobs to external blockchain providers.

Visual cue: draw this as a separate service box labeled `worker` / `proveria-worker`, connected strongly to Redis and object storage.

## Durable Data And Storage Layer

### Postgres

Postgres is the system of record.

It stores:

- Users, invitations, memberships, trusted devices, and workspace access.
- Organizations, tenants, workspaces, and projects.
- Attestations, attempts, validation state, receipt metadata, and verifier lookup metadata.
- Verifier access requests and grants.
- API keys.
- Webhook endpoints and webhook delivery records.
- Evidence export jobs, job state, progress, expiration, and retention metadata.
- Immutable event/audit records.
- Audit checkpoints and future anchoring metadata.

Visual cue: use a database cylinder labeled `Postgres` / `proveria-postgres`.

### Redis

Redis is not the system of record. It is the queue and coordination layer.

It is used for:

- Worker queues.
- Job scheduling and retry coordination.
- Rate-limit counters.
- Short-lived coordination/cache state.

Visual cue: use a queue/cache icon labeled `Redis` / `proveria-redis`. Put it between the API and worker to show job enqueue/consume flow.

### S3-Compatible Object Storage

Object storage holds evidence artifacts and generated files.

In local Docker Compose this is MinIO. In a hosted deployment it can be S3 or another S3-compatible object store.

It stores:

- Attestation manifests.
- Leaves JSONL files.
- Validation results.
- Receipt JSON.
- Receipt PDFs.
- Verifier lookup result JSON.
- Evidence export manifests.
- Evidence export bundles.
- Missing-artifact markers when an export cannot include a referenced object.

Visual cue: use a cloud bucket or storage icon labeled `S3-compatible object storage` with local label `MinIO / proveria-minio`. Add bucket label `proveria-artifacts` and note "versioning enabled locally".

## Crypto, Proof, And Document Packages

These packages are internal application libraries, not separate network services, but the visual can show them as a supporting "Proof and Receipt Engine" layer used by the API and worker.

Include:

- `crypto-core`: hashes, signatures, and cryptographic primitives.
- `manifest`: evidence package and manifest structures.
- `proofs`: proof validation.
- `receipt`: receipt JSON/PDF generation support.
- `shingling`: content passage proof support.
- `ocr`: OCR-related proof support.
- `evidence-export`: export manifest and bundle helpers.
- `audit`: audit event categories/actions.
- `db`: database schema and persistence helpers.
- `sdk` and `python-sdk`: developer client surfaces.

Visual cue: a smaller shared library layer under API/worker labeled "Shared proof, receipt, audit, and export libraries".

## External Integrations

### Webhook Receivers

Show customer systems receiving signed webhook deliveries from Proveria.

Current webhook flow:

- Customers configure webhook endpoints through API/CLI/SDK.
- Proveria creates delivery records.
- Worker sends signed HTTP POST requests.
- Receivers verify the `proveria-webhook-signature` header.
- Delivery status and retries are stored in Postgres.

Visual cue: arrow from worker to "Customer webhook receiver" with a lock/signature badge.

### OIDC Identity Providers

Show optional sign-in integrations.

Examples:

- Microsoft Entra ID / Azure AD.
- Google OIDC.
- Generic OIDC-compatible identity providers.

Visual cue: dotted or secondary arrow from desktop/API auth flow to "OIDC providers". This is an authentication integration, not an evidence storage path.

### Optional / Future Blockchain Anchoring

Blockchain anchoring should be shown as an optional/future provider plugin layer.

Suggested providers:

- Arbitrum.
- Optimism.
- Ethereum mainnet or other EVM-compatible networks.

Future anchoring responsibilities:

- Submit selected attestation roots, batch roots, or audit checkpoint roots.
- Record transaction ID, block number, timestamp, provider, and confirmation state.
- Surface anchoring status in receipts, verifier pages, timelines, APIs, SDKs, CLI, events, and evidence exports.

Visual cue:

- Draw a dotted arrow from worker or "Audit checkpoints" to an "Anchoring provider plugin" box.
- From the plugin box, dotted arrows go to Arbitrum, Optimism, and Ethereum.
- Draw a dotted return arrow back to Postgres/events labeled "tx id, block, confirmations".
- Label this whole area "optional / future external anchoring".

Important: do not make blockchain appear mandatory for attestation creation or verification.

## Main Runtime Flows

### 1. Attestation Creation

1. Producer chooses a local file, text passage, or evidence package in the desktop app, CLI, SDK, or API integration.
2. Client computes hashes and proof metadata locally when possible.
3. Client sends hash/proof metadata and attestation request to the API.
4. API writes records to Postgres and enqueues validation work in Redis.
5. Worker consumes the queue, validates manifests/proofs, and writes artifacts to S3-compatible storage.
6. Worker updates Postgres and emits immutable events.
7. Worker generates receipt JSON/PDF artifacts and optionally queues webhook deliveries.
8. Client sees confirmed attestation and receipt/result links.

Visual note: include a "raw files stay local" label near the client side.

### 2. Verifier Lookup

1. Verifier opens a private lookup link or public receipt/result page.
2. Verifier web app talks to the API.
3. Verifier submits a file hash, file-derived hash, or content passage proof for comparison.
4. API checks access rules and records lookup activity.
5. Lookup result artifacts are written to object storage when applicable.
6. Events capture lookup activity.
7. Public result and receipt pages can be opened without direct database access.

Visual note: show the verifier going through the API. Do not show verifier directly reading Postgres.

### 3. Evidence Export

1. Admin, CLI, SDK, or API creates an evidence export job.
2. API creates the job row in Postgres and enqueues work in Redis.
3. Worker collects matching records from Postgres and artifacts from object storage.
4. Worker writes an export manifest and bundle to object storage.
5. Client downloads manifest and bundle.
6. Expired export cleanup can delete opted-in bundle objects, clear object keys, mark jobs expired, and write retention deletion audit events.

Visual cue: show export output as a bundle/document stack: `manifest.json`, `bundle.json`, ZIP/TAR or artifact files.

### 4. Webhook Delivery

1. Customer registers a webhook endpoint.
2. Proveria creates webhook deliveries for supported events.
3. Worker signs each delivery and posts it to the customer endpoint.
4. Customer receiver verifies the signature.
5. Delivery success/failure/retry status is stored in Postgres.

### 5. Optional Future Anchoring

1. Admin policy selects which roots should be anchored.
2. Worker or scheduled anchoring job batches attestation roots or audit checkpoint roots.
3. Anchoring provider plugin submits transaction to configured network.
4. Confirmation metadata returns to Proveria.
5. Receipts, verifier pages, APIs, SDKs, CLI, events, and exports show anchoring state.

## Docker Compose Local Runtime

The local Docker Compose project is named `proveria`.

| Compose service | Container | Port(s) | Role | Persistence |
| --- | --- | --- | --- | --- |
| `postgres` | `proveria-postgres` | `5432` by default | Primary relational database and system of record | `proveria-postgres-data` |
| `redis` | `proveria-redis` | `6379` by default | Queues, rate limiting, short-lived coordination | `proveria-redis-data` |
| `minio` | `proveria-minio` | API `9000`, console `9001` by default | Local S3-compatible object storage | `proveria-minio-data` |
| `minio-init` | `proveria-minio-init` | none | One-shot bucket bootstrap; creates `proveria-artifacts` and enables versioning | none |
| `api` | `proveria-api` | `3001` by default | API service; app profile | container only |
| `worker` | `proveria-worker` | none | Async worker; app profile | container only |
| `verifier` | `proveria-verifier` | `3003` by default | Verifier web app; app profile | container only |

All Compose services run on the `proveria` Docker network.

In day-to-day local development, developers may run only the data stores in Docker and run app processes from `pnpm dev`. For one-command demos or app-profile runs, Docker Compose can also run the API, worker, and verifier containers.

## Suggested Labels For The Final Image

Use these labels directly or adapt them:

- "Desktop app: local hashing, signed device requests, admin workflows"
- "CLI, TypeScript SDK, Python SDK, Public API"
- "Verifier web: private lookup and public receipt/result pages"
- "API service: auth, tenancy, attestations, events, exports, webhooks"
- "Redis: queues, rate limits, retries"
- "Worker: validation, receipts, exports, webhook delivery"
- "Postgres: system of record and immutable events"
- "S3-compatible object storage: manifests, receipts, results, bundles"
- "Customer webhook receivers: signed deliveries"
- "OIDC providers: optional sign-in"
- "Anchoring provider plugin: optional/future blockchain commitments"
- "Arbitrum / Optimism / Ethereum"
- "Raw files stay local; Proveria stores hashes, proofs, metadata, receipts, and artifacts"

## Visual Cues

- Use a clear boundary around "Proveria application network".
- Use cylinders for Postgres and Redis.
- Use a bucket/cloud storage icon for MinIO/S3.
- Use a queue icon or stacked line icon for Redis-backed jobs.
- Use document/PDF icons for receipts and export bundles.
- Use a lock, key, or signature icon for API keys, trusted devices, session auth, and signed webhooks.
- Use a chain/link icon for blockchain anchoring.
- Use dotted lines for optional/future provider integrations.
- Use solid lines for current implemented data flow.
- Keep the desktop, CLI, SDKs, and verifier outside the internal network boundary.
- Keep API and worker as separate boxes.
- Show Postgres as the source of truth, not Redis.

## Things The Diagram Should Not Imply

- Do not imply raw customer files are uploaded to Proveria for normal local-file attestation. The intended story is local hashing and proof metadata.
- Do not imply Redis is durable business storage. It is queue/cache/rate-limit infrastructure.
- Do not imply the verifier web app directly reads Postgres or object storage. It talks through the API and public artifact URLs where applicable.
- Do not imply blockchain anchoring is required for core attestations. Show it as optional/future external anchoring.
- Do not imply MinIO is the production-only object store. It is the local S3-compatible implementation; production can use S3-compatible storage.
- Do not imply Google Drive file download/picker is part of the primary architecture image unless explicitly needed. If shown, label it as local import/source metadata rather than server-side Drive storage.

## One Possible Diagram Structure

```text
Users and clients
  Desktop app
  Verifier web
  CLI
  TypeScript SDK
  Python SDK
  Public API consumers
        |
        v
Proveria application network
  API service  <---->  Postgres
      |                  ^
      v                  |
    Redis  -------->  Worker
      ^                  |
      |                  v
      +---------- S3-compatible object storage

External outputs and integrations
  Customer webhook receivers  <--- signed deliveries from Worker
  OIDC providers              <--- optional auth flow
  Anchoring provider plugin   <--- optional/future from Worker/Audit checkpoints
       |---- Arbitrum
       |---- Optimism
       |---- Ethereum

Docker Compose foundation
  postgres, redis, minio, minio-init, api, worker, verifier
  network: proveria
  volumes: proveria-postgres-data, proveria-redis-data, proveria-minio-data
```

