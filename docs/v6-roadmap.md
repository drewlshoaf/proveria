# Proveria V6 Roadmap

V6 is the API-first developer platform release with AI dataset provenance as
the flagship commercial use case.

V4 established the public API foundation. V5 clarified the product semantics
around workspaces, access, events, exports, receipts, and verification. V6
should turn those foundations into a product developers can adopt directly,
while using AI dataset builders as the first concrete audience for examples,
SDKs, docs, and packaging.

## Recommendation

Make V6 the Commercial API Platform release.

Do not make V6 a narrow AI-only vertical. AI dataset provenance should be the
first flagship workflow because it is commercially sharp, but the durable asset
is the API platform underneath it: API keys, SDKs, webhooks, idempotent
workflows, stable docs, sandbox data, and evidence packages.

## Product Goal

A developer should be able to integrate Proveria into an existing system
without using the desktop app as the primary workflow.

V6 should make it obvious:

- how a developer authenticates a server-side integration;
- how an integration creates attestations and receives receipts;
- how an integration verifies files, passages, receipts, and result packages;
- how customers subscribe to lifecycle events instead of polling;
- how dataset builders create repeatable provenance packages for inventories,
  revisions, licensed-content audits, and model-card attachments;
- how API behavior is versioned, documented, tested, and supported.

## Primary Pillars

### 1. Commercial API Maturity

- Treat `/v1` as the primary integration surface.
- Define and document public compatibility rules.
- Harden the API key model for machine clients, separate from desktop device
  keys.
- Add scoped API credentials for producer, verifier, admin, and integration
  workflows.
- Add idempotency keys for attestation creation, access-grant changes, export
  job creation, and webhook retry-sensitive workflows.
- Define a stable commercial error model with:
  - stable code;
  - message;
  - retryability;
  - field errors where applicable;
  - support correlation id.
- Add rate-limit semantics by tenant, credential, endpoint, and plan.
- Add API usage analytics by tenant and credential.
- Maintain contract tests that fail when public response shapes drift.

### 2. Developer Docs And Sandbox

- Make public developer docs a first-class V6 deliverable.
- Publish quickstarts for:
  - API-only producer integration;
  - verifier lookup integration;
  - webhook receiver;
  - evidence export and package verification;
  - AI dataset provenance workflow.
- Add sandbox tenant mode or repeatable seeded examples with deterministic
  request and response samples.
- Add Postman or Insomnia collection coverage for core API flows.
- Add copy-paste examples for curl, TypeScript, Python, and CLI where possible.
- Document authentication, idempotency, pagination, rate limits, errors,
  webhooks, exports, and support troubleshooting.

### 3. TypeScript SDK

- Generate or maintain a typed API client from the OpenAPI contract.
- Support API-key authentication for server-side integrations.
- Include helpers for:
  - file hashing;
  - passage hashing;
  - PDF text extraction where browser/runtime support allows;
  - pagination;
  - retries;
  - idempotency keys;
  - webhook signature verification;
  - receipt/result package verification.
- Provide browser-safe helpers for verifier-side hashing.
- Provide Node-safe helpers for server-side automation.
- Include examples for Next.js, Express/Fastify, Electron, and worker queues.

### 4. Python SDK For Data And AI Workflows

- Add a Python client for enterprise data, legal, compliance, and AI workflows.
- Use Pydantic models for typed-ish request and response handling.
- Support API-key authentication.
- Include helpers for:
  - file hashing;
  - passage hashing;
  - receipt/result package verification;
  - webhook signature verification.
- Add notebook examples for dataset inventory review and audit workflows.
- Add Airflow or Dagster examples for scheduled provenance jobs if the base
  client is stable enough.

### 5. Webhooks

- Add tenant-configured webhook endpoints.
- Sign webhook deliveries with timestamp and replay protection.
- Implement retries with exponential backoff.
- Show delivery logs and health status in admin/developer surfaces.
- Add a test event sender.
- Add webhook secret rotation.
- Start with the V6 event catalog needed for developer adoption:
  - `attestation.created`;
  - `attestation.confirmed`;
  - `attestation.failed`;
  - `receipt.issued`;
  - `verifier_access.granted`;
  - `verifier_access.revoked`;
  - `access_request.created`;
  - `access_request.approved`;
  - `access_request.denied`;
  - `verification.lookup_performed`;
  - `evidence_export.created`;
  - `evidence_export.completed`;
  - `evidence_export.failed`;
  - `evidence_export.expired`.

### 6. CLI As Reference Implementation

- Keep the CLI aligned with the public API rather than private routes.
- Support scriptable producer and verifier workflows:
  - `proveria login` or API-key configuration;
  - `proveria projects list/create`;
  - `proveria attest file <path>`;
  - `proveria attest text <path>`;
  - `proveria attest batch <folder>`;
  - `proveria verify file <path> --attestation <id>`;
  - `proveria verify passage --attestation <id>`;
  - `proveria receipt get/open/export`;
  - `proveria access grant/revoke/list`;
  - `proveria requests approve/deny/list`;
  - evidence export collect/check/inspect/unpack/zip/tar workflows.
- Preserve JSON output mode and CI-friendly exit codes.
- Treat CLI behavior as executable documentation for API and SDK workflows.

### 7. AI Dataset Provenance Flagship

- Define a dataset provenance product model that maps cleanly onto existing
  projects, attestations, receipts, verification results, events, and exports.
- Support dataset inventory attestations from manifests or folders.
- Support dataset revision receipts that distinguish new, changed, removed, and
  unchanged files or records.
- Support licensed-content audit packages for publisher or rights-holder review.
- Support model-card provenance attachments that reference relevant receipts,
  datasets, revisions, and audit packages.
- Provide Python and CLI examples for:
  - creating a dataset inventory attestation;
  - creating a dataset revision receipt;
  - exporting an evidence package for a dataset;
  - verifying a sampled file or passage against a dataset record;
  - producing a package suitable for legal/compliance review.
- Keep privacy boundaries explicit: V6 should continue to prefer local hashing
  and proof generation unless hosted ingestion is separately designed.

## Explicit Non-Goals For V6

- Do not build CMS plugins in V6 unless a customer deal forces one narrow
  integration.
- Do not build browser extensions in V6.
- Do not add perceptual image similarity in V6.
- Do not ship blockchain/external anchoring in V6.
- Do not build full enterprise SCIM/SAML administration in V6 beyond what API
  platform work directly requires.
- Do not re-enable Google Drive as a V6 default unless the product decision is
  made separately.
- Do not introduce hosted ingestion of arbitrary files as an assumption.

## Developer Surface Impact

V6 should turn the developer surfaces into the product, not merely document the
desktop app.

Expected impacts:

- API key and credential management;
- OpenAPI contract and compatibility tests;
- CLI commands and output stability;
- TypeScript SDK generation and examples;
- Python SDK package shape and examples;
- webhook endpoint, delivery, and signature APIs;
- public developer docs;
- sandbox or seeded example data;
- evidence export package verification;
- AI dataset provenance examples and terminology.

## Recommended Build Order

1. Define V6 API compatibility, error, idempotency, rate-limit, and pagination
   policies.
2. Harden API key scopes, audit events, rotation, last-used metadata, and
   credential-level analytics.
3. Refresh OpenAPI and contract tests around V5-final semantics.
4. Build webhook endpoints, signatures, retries, logs, health, and test sender.
5. Stabilize the CLI as the reference implementation for API workflows.
6. Build or regenerate the TypeScript SDK with package verification and webhook
   helpers.
7. Build the Python SDK narrow slice for dataset provenance workflows.
8. Create sandbox/seeded developer examples and public API quickstarts.
9. Shape the AI dataset provenance model and implement manifest/folder
   inventory, revision, export, and verification examples.
10. Run a full developer acceptance pass using only API, CLI, SDKs, webhooks,
    docs, and seeded data.

## Open Decisions

- Is the V6 developer docs site public during V6 development, or published only
  after the API contract stabilizes?
- Should API keys support browser-side use at all, or are all browser workflows
  delegated to signed verifier/public flows?
- Which idempotent operations are required for V6 launch versus documented as
  follow-up?
- Should webhook payloads contain denormalized summaries or only ids and fetch
  links?
- Should the Python SDK be a first-class package in V6 or a narrow dataset
  provenance preview?
- What is the minimum dataset manifest format for the AI flagship workflow?
- Should dataset revisions be modeled as attestations with metadata, a new
  domain object, or an export/package convention built on existing records?
- How much licensed-content or rights-holder language belongs in the product
  versus examples/docs?
- Which API usage analytics are necessary for commercial plans at launch?
