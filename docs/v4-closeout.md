# V4 Closeout

V4 is now treated as a developer-platform foundation milestone rather than the
next active product direction.

## Completed In V4

- Public V1 API foundation with tenant-scoped API keys.
- Stable public error and data envelopes.
- OpenAPI document.
- API-created hash attestations.
- API verifier access grant and revoke.
- Webhook endpoint configuration, signed delivery, retry, delivery logs, and
  lifecycle events for attestation/receipt flows.
- CLI alpha for API-key project listing, hash attestation creation, hash
  verification, attestation fetch, and receipt fetch.
- TypeScript SDK alpha with typed client, SHA-256 helper, passage proof hashing
  helper, webhook signature verification helper, and examples.

## Paused Or Deferred

- Python SDK spike is paused in draft PR form and should not drive product
  direction until the user-facing workflows settle.
- Lookup-result webhook events remain deferred.
- Public developer repositories and package publishing remain deferred.
- More advanced API/CLI/SDK surfaces should wait for V5 workspace, access,
  export, and Google Drive decisions.

## Closure Decision

Close V4 as the internal commercial API foundation. Do not keep expanding V4
with developer features while the product model is changing.

The next active version is V5: a product-led workflow and enterprise
administration release. V5 user semantics will determine the next API, CLI, SDK,
webhook, and public documentation updates.
