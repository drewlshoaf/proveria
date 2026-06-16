# Proveria V4 Roadmap

V4 is the developer and commercial platform release. V1 through V3 proved the
desktop-first provenance workflow, verifier handoff, text content proof, OCR,
and exact image proof. V4 should make those capabilities usable outside the
desktop app through stable APIs, automation hooks, and developer tooling.

## Recommendation

Make V4 the Commercial API Foundation release.

Do not try to ship every SDK, plugin, and enterprise driver in one pass. The
API contract has to come first because webhooks, CLI, SDKs, browser extensions,
CMS plugins, and enterprise integrations all depend on stable public semantics.

## Product Goal

A customer should be able to integrate Proveria into an existing system without
touching the desktop app for every workflow.

V4 should support:

- server-side producer integrations that create attestations and fetch receipts;
- verifier integrations that run lookups and retrieve result artifacts;
- admin integrations for projects, access, requests, and events;
- signed webhook notifications for important lifecycle events;
- a documented API contract that SDKs and integrations can rely on.

## Non-Goals

These should stay out of the first V4 release unless a customer deal forces a
specific exception:

- perceptual image similarity;
- full marketplace of CMS plugins;
- every enterprise integration driver;
- offline-first CLI artifact verification;
- customer-managed signing keys;
- multi-language OCR expansion;
- semantic similarity.

## Release Shape

### 1. Public API Contract

- Introduce explicit public API versioning, likely `/api/v1` or `/v1`.
- Define a stable commercial error model:
  - code;
  - message;
  - retryable;
  - field errors where applicable;
  - support correlation id.
- Generate an OpenAPI document from the live route contract.
- Add API reference examples for:
  - projects;
  - attestations;
  - attempts and receipt status;
  - verifier access grants;
  - access requests;
  - lookup results;
  - receipt/result artifact retrieval;
  - events.
- Add compatibility tests that fail when public response shapes drift.

### 2. API Credentials

- Add tenant-scoped API keys separate from desktop device keys.
- Store only hashed API key secrets.
- Support key creation, naming, last-used timestamps, revocation, and audit
  events.
- Add scoped permissions for:
  - producer automation;
  - verifier automation;
  - admin automation;
  - read-only reporting.
- Decide whether API keys can create attestations directly or must create
  server-side signing identities. Recommendation: allow API-key creation for
  V4, but record the credential id clearly in audit and receipt-adjacent
  metadata.

### 3. Idempotent Attestation API

- Add idempotency keys for attestation creation and manifest submission.
- Support whole-file hash attestations through the API.
- Support external SHA-256 attestations through the API.
- Support content-proof manifests where the client derives local proof hashes.
- Preserve the privacy boundary: API clients submit hashes/proof leaves, not
  source text or source files unless a future hosted-ingestion product is
  explicitly designed.
- Return stable status objects suitable for polling and webhooks.

### 4. Webhooks

- Add tenant webhook endpoints.
- Sign webhook deliveries with timestamp and replay protection.
- Implement retries with exponential backoff.
- Add delivery logs and status visibility.
- Start with these events:
  - `attestation.created`;
  - `attestation.confirmed`;
  - `attestation.failed`;
  - `receipt.issued`;
  - `verifier_access.granted`;
  - `verifier_access.revoked`;
  - `lookup.match_issued`;
  - `lookup.no_match_issued`.
- Add a test event sender.

### 5. CLI Alpha

- Build a thin CLI on top of the public API instead of private routes.
- Initial commands:
  - `proveria login`;
  - `proveria projects list`;
  - `proveria attest hash`;
  - `proveria attest file`;
  - `proveria verify hash`;
  - `proveria receipt get`;
  - `proveria access grant`;
  - `proveria access revoke`.
- Include JSON output mode from day one.

### 6. TypeScript SDK Alpha

- Generate or hand-wrap a typed client from the OpenAPI contract.
- Include helpers for:
  - file SHA-256 hashing;
  - passage proof hashing;
  - webhook signature verification;
  - pagination;
  - retries and idempotency keys.
- Ship examples for Node and browser verifier hashing.

### 7. Python SDK Spike

- Start with a narrow Python client for enterprise evaluation:
  - projects;
  - hash attestations;
  - receipt retrieval;
  - lookup;
  - webhook verification.
- Use Pydantic models if they do not slow the first SDK down.

### 8. Public Developer Distribution

Use the company GitHub organization as the public trust surface. Keep the
private `proveria` monorepo as the internal product source of truth while the
API, desktop, verifier, worker, and migrations are still changing together.

Publish developer-facing artifacts into focused public repositories once each
surface has a distinct audience and a stable enough contract:

- `proveria-api-spec`
  - public OpenAPI document;
  - changelog;
  - request/response examples;
  - error model and compatibility policy.
- `proveria-js`
  - TypeScript/JavaScript SDK;
  - npm package: `@proveria/sdk`;
  - browser and Node helpers for hashing, proof generation, pagination, and
    webhook verification.
- `proveria-examples`
  - copy-paste working examples;
  - API-only attestation;
  - verifier lookup;
  - webhook receiver;
  - Node and browser examples.
- `proveria-python`
  - Python SDK;
  - PyPI package: `proveria`;
  - enterprise/data/AI workflow examples.
- `proveria-cli`
  - command-line interface;
  - package options later: Homebrew, `@proveria/cli`, direct binaries, or
    `pipx install proveria-cli`.

Recommended launch order:

1. `proveria-api-spec`
2. `proveria-js`
3. `proveria-examples`
4. `proveria-python`
5. `proveria-cli`

Do not publish installable packages until the API auth, error, idempotency, and
OpenAPI contract are reasonably stable. Public repos can exist earlier with
developer-preview language.

## Suggested Build Order

1. Public API inventory and route boundary decision.
2. API key schema, auth middleware, and audit events.
3. OpenAPI generation and response contract tests.
4. Idempotent attestation and receipt API.
5. Webhook data model and signed delivery worker.
6. Public developer repo scaffolds for API spec, TypeScript SDK, and examples.
7. CLI alpha backed by public API.
8. TypeScript SDK alpha.
9. Python SDK spike.
10. Human and automated V4 QA checklist.

## V4 Acceptance Criteria

- A machine client can create an API key and use it without a desktop session.
- API docs describe the supported V4 public contract.
- At least one end-to-end API-only attestation flow works.
- Webhooks notify attestation confirmation and lookup result issuance.
- CLI can run a basic producer and verifier workflow.
- TypeScript SDK can run the same basic workflow.
- Audit events distinguish user, desktop device, and API credential actors.
- Existing desktop and verifier workflows remain unaffected.

## Open Decisions

- Should V4 API clients be allowed to create attestations with only API-key
  authentication, or should high-assurance submissions require a signing
  identity?
- Should public API routes reuse current tenant slugs or move to tenant ids?
- Should webhook delivery logs live under Events or a dedicated Integrations
  page?
- Should the CLI authenticate with API keys only, or also support desktop-style
  device pairing?
- Which SDK should be production-grade first: TypeScript or Python?

## Recommended First Slice

Start with API keys plus a read-only public API surface:

- list projects;
- list attestations;
- fetch attestation detail;
- fetch receipt metadata;
- list events.

That slice is small, commercially meaningful, and gives us the auth, docs,
audit, and compatibility-test foundation before we add mutation workflows.
