# V4 Completion Checklist

Use this as the working gate for the V4 developer and commercial platform
release.

## Scope

- [ ] Public API versioning decision is recorded.
- [ ] Public route inventory is documented.
- [ ] V4 non-goals are accepted.
- [ ] API credential model is accepted.
- [ ] Webhook signing model is accepted.
- [ ] Webhook retry model is accepted.
- [ ] CLI alpha scope is accepted.
- [ ] TypeScript SDK alpha scope is accepted.
- [ ] Python SDK spike scope is accepted.
- [ ] Public developer repository plan is accepted.

## API Foundation

- [*] Tenant-scoped API keys can be created.
- [*] API keys are stored hashed, not plaintext.
- [*] API keys can be revoked.
- [*] API key last-used metadata is recorded.
- [*] API key audit events are emitted.
- [*] Scoped API permissions are enforced.
- [*] Public API errors use stable codes.
- [*] Public API responses include correlation ids.
- [*] OpenAPI document is generated.
- [*] Public response contract tests are in place.

## Read-Only API Slice

- [*] API key can list projects.
- [*] API key can list attestations.
- [*] API key can fetch attestation detail.
- [*] API key can fetch receipt metadata.
- [*] API key can list events within its scope.
- [ ] Producer/admin/verifier scopes are tested separately.

## Mutation API Slice

- [*] API key can create a project when scoped for producer/admin automation.
- [*] API key can create a whole-file hash attestation.
- [*] API key can create an external SHA-256 attestation.
- [ ] API key can submit a manifest with content-proof leaves.
- [*] Idempotency keys prevent duplicate submissions.
- [*] API key can grant verifier access when scoped.
- [*] API key can revoke verifier access when scoped.

## Webhooks

- [*] Tenant webhook endpoints can be configured.
- [*] Webhook deliveries are signed.
- [*] Webhook timestamp replay protection is documented.
- [*] Delivery retries use backoff.
- [*] Delivery logs are visible.
- [*] Test event sender works.
- [*] `attestation.confirmed` event is delivered.
- [*] `attestation.failed` event is delivered.
- [*] `receipt.issued` delivery is recorded.
- [*] `receipt.issued` event is sent over HTTP.
- [ ] `lookup.match_issued` event is delivered.
- [ ] `lookup.no_match_issued` event is delivered.

## CLI Alpha

- [*] CLI authenticates against the V4 API.
- [*] CLI can list projects.
- [*] CLI can create a hash attestation.
- [*] CLI can verify a hash.
- [*] CLI can fetch a receipt.
- [*] CLI supports JSON output.
- [*] CLI has clear exit codes.

## TypeScript SDK Alpha

- [*] SDK exposes a typed API client.
- [*] SDK supports API-key authentication.
- [*] SDK includes file SHA-256 helper.
- [*] SDK includes passage proof hashing helper.
- [*] SDK includes webhook signature verification helper.
- [*] SDK examples cover producer and verifier flows.

## Python SDK Spike

- [*] Python client can authenticate with API key.
- [*] Python client can list projects.
- [*] Python client can create a hash attestation.
- [*] Python client can fetch receipt metadata.
- [*] Python client can run lookup.
- [*] Python webhook verification spike is documented.

## Public Developer Repositories

- [ ] `proveria-api-spec` public repo is created.
- [ ] `proveria-js` public repo is created.
- [ ] `proveria-examples` public repo is created.
- [ ] `proveria-python` public repo is created when Python SDK scope starts.
- [ ] `proveria-cli` public repo is created when CLI scope starts.
- [ ] Public repos use developer-preview language until packages are stable.
- [ ] npm package plan for `@proveria/sdk` is documented.
- [ ] npm package plan for `@proveria/cli` is documented.
- [ ] PyPI package plan for `proveria` is documented.

## Regression

- [ ] Desktop producer workflow still passes.
- [ ] Desktop admin workflow still passes.
- [ ] Verifier web workflow still passes.
- [ ] `pnpm smoke:pdf-text-layer` passes.
- [ ] `pnpm smoke:exact-image` passes.
- [ ] `pnpm smoke:ocr-pdf` passes.
- [ ] API auth tests pass.
- [ ] API public contract tests pass.

## Sign-Off

- [ ] V4 known limitations are documented.
- [ ] V4 human QA checklist is complete.
- [ ] All blocking failures are fixed or accepted.
- [ ] Release notes are written.
- [ ] Tag and GitHub release are created.
