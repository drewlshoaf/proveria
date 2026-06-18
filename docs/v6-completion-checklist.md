# V6 Completion Checklist

Use this as the working gate for the API-first developer platform release with
AI dataset provenance as the flagship use case.

## Scope

- [ ] V6 product goal is accepted.
- [ ] V6 non-goals are accepted.
- [ ] API-first developers are accepted as the primary release audience.
- [ ] AI dataset builders are accepted as the flagship vertical use case.
- [ ] Google Drive, CMS plugins, browser extensions, anchoring, SCIM/SAML, and
      perceptual similarity are explicitly out of scope unless reprioritized.

## Commercial API Platform

- [ ] `/v1` compatibility policy is documented.
- [*] Public API error model has stable codes, retryability, field errors where
      applicable, and support correlation ids.
- [*] Pagination conventions are documented and tested.
- [ ] Idempotency-key conventions are documented and implemented for launch
      operations.
- [ ] Rate-limit semantics are documented by tenant, credential, endpoint, and
      plan.
- [ ] API key model is separate from desktop device keys.
- [ ] API keys support scoped producer, verifier, admin, and integration
      workflows.
- [ ] API key creation, rotation, revocation, expiration, last-used metadata,
      and audit events are implemented.
- [ ] API usage analytics exist by tenant and credential.
- [ ] Public API contract tests fail on response-shape drift.

## Developer Docs And Sandbox

- [*] Public API integration policy documents authentication, response
      envelopes, error envelopes, idempotency, retry guidance, pagination,
      credential telemetry, SDK idempotency behavior, and compatibility notes in
      `docs/public-api-integration-policy.md`.
- [*] Authenticated public API responses expose `RateLimit-Limit`,
      `RateLimit-Remaining`, and `RateLimit-Reset` policy headers.
- [ ] Public developer docs cover authentication, errors, pagination,
      idempotency, rate limits, webhooks, exports, and troubleshooting.
- [*] Quickstart exists for API-only producer integration.
- [ ] Quickstart exists for verifier lookup integration.
- [*] Quickstart exists for webhook receiver integration.
- [ ] Quickstart exists for evidence export and package verification.
- [*] Quickstart exists for AI dataset provenance.
- [ ] Sandbox tenant mode or deterministic seeded examples are available.
- [ ] Postman or Insomnia collection exists for core workflows.
- [ ] curl, TypeScript, Python, and CLI examples are aligned with the live API.

## TypeScript SDK

- [ ] SDK aligns with the OpenAPI contract.
- [ ] API-key client works for server-side integrations.
- [ ] Browser-safe hashing helpers are available for verifier-side workflows.
- [ ] Node-safe helpers are available for server-side automation.
- [ ] Pagination, retry, and idempotency helpers are available.
- [*] Webhook signature verification helper is available.
- [ ] Receipt/result package verification helpers are available.
- [ ] Examples exist for Next.js, Express/Fastify, Electron, and worker queues
      where appropriate.

## Python SDK

- [*] Python client supports API-key authentication.
- [*] Python package metadata and local install/build path are available.
- [ ] Pydantic models or equivalent typed request/response helpers are
      available.
- [ ] File hashing and passage hashing helpers are available.
- [ ] Receipt/result package verification helpers are available.
- [*] Webhook signature verification helper is available.
- [ ] Notebook example exists for dataset inventory review.
- [ ] Scheduled provenance example exists for Airflow, Dagster, or a plain
      script runner.

## Webhooks

- [ ] Tenant admins can configure webhook endpoints.
- [ ] Deliveries are signed with timestamp and replay protection.
- [ ] Delivery retries use exponential backoff.
- [ ] Delivery logs are visible to admins or developers.
- [ ] Endpoint health status is visible.
- [ ] Test event sender is available.
- [ ] Webhook secret rotation is available.
- [ ] Event payload schemas and examples are documented.
- [ ] V6 launch event catalog is implemented and tested.

## CLI Reference Implementation

- [ ] CLI uses public API surfaces for V6 workflows.
- [ ] CLI supports API-key or login configuration appropriate for automation.
- [ ] Project list/create commands work.
- [ ] File, text, and batch attestation commands work.
- [ ] File and passage verification commands work.
- [ ] Receipt get/open/export commands work.
- [ ] Access grant/revoke/list commands work.
- [ ] Access request approve/deny/list commands work.
- [ ] Evidence export collect/check/inspect/unpack/zip/tar commands work.
- [ ] JSON output mode and CI-friendly exit codes are documented and tested.

## AI Dataset Provenance

- [*] Dataset provenance product model is documented.
- [*] Minimum dataset manifest format is accepted.
- [*] Dataset inventory attestation workflow is implemented.
- [ ] Dataset revision receipt workflow distinguishes new, changed, removed,
      and unchanged files or records.
- [ ] Licensed-content audit package example exists.
- [ ] Model-card provenance attachment example exists.
- [ ] Python example creates a dataset inventory attestation.
- [ ] Python example creates or verifies a dataset revision receipt.
- [*] CLI example creates a dataset inventory package.
- [ ] Evidence export package can be generated for a dataset workflow.
- [ ] Sample file or passage verification against a dataset record is
      documented and tested.
- [*] Privacy language clearly states what is hashed locally, submitted,
      stored, exported, and never stored.

## Regression

- [ ] Desktop producer workflow still passes.
- [ ] Desktop admin workflow still passes.
- [ ] Verifier web workflow still passes.
- [ ] V5 workspace and export workflows still pass.
- [ ] V4 public API contract tests still pass.
- [ ] CLI tests pass.
- [ ] TypeScript SDK tests pass.
- [ ] Python SDK tests pass if the Python package ships in V6.
- [ ] Webhook delivery and signature tests pass.

## Sign-Off

- [ ] V6 known limitations are documented.
- [ ] V6 human QA checklist is complete.
- [ ] Developer acceptance path is complete using API, CLI, SDKs, webhooks,
      docs, and seeded/sandbox data.
- [ ] AI dataset provenance acceptance path is complete.
- [ ] All blocking failures are fixed or accepted.
- [ ] Release notes are written.
