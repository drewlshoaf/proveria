# Corporate API Docs Consumption

The API publishes its canonical contract at:

```text
GET /v1/openapi.json
```

It also serves a lightweight built-in reference page and renderer config:

```text
GET /v1/docs
GET /v1/docs/config.json
```

The corporate site should treat that endpoint as the source of truth for public
API reference pages. The site can render it with a docs component such as Scalar,
Redoc, Stoplight Elements, or a custom OpenAPI renderer.

## Recommended Integration

1. Fetch `/v1/openapi.json` from the API environment the site is documenting.
2. Render the OpenAPI paths, schemas, request examples, response examples, and
   auth scheme directly from the document.
3. Keep hand-written marketing copy separate from reference content.
4. Link to `docs/public-api-examples.md` style examples or mirror them as
   copy-paste guides.
5. Link to `docs/public-api-integration-policy.md` for operational guidance on
   authentication, idempotency, retries, errors, pagination, and credential
   telemetry.

The fastest integration path is to link to `/v1/docs` from the corporate site
while the public docs design is still evolving. The higher-control path is to
fetch `/v1/docs/config.json`, read `openapiUrl`, and render the OpenAPI document
inside the corporate site's own docs layout.

## Contract Expectations

- `components.securitySchemes.bearerApiKey` describes API-key auth.
- Mutation operations document the required `Idempotency-Key` header.
- Response envelopes use `{ data, meta }`.
- Public list responses include `meta.pagination` with `limit`, `offset`,
  `returned`, and `hasMore`.
- Error envelopes use `{ error: { code, message, retryable, requestId } }`.
- Error envelopes may include `fieldErrors` and `details` for
  machine-readable validation context.
- Authenticated responses expose `RateLimit-Limit`, `RateLimit-Remaining`, and
  `RateLimit-Reset` policy headers.
- Examples are included under `components.examples` and attached to the most
  important path responses.
- Operational retry/idempotency behavior is documented in
  `docs/public-api-integration-policy.md`.

## Local Contract Test

Run the public API contract suite against the dedicated test database:

```text
pnpm test:public-api
```

That command migrates `proveria_test` before running the contract tests. Do not
run destructive API integration tests against the normal `proveria` development
database unless you intentionally want test setup to truncate local data.

## Corp Dev Notes

The corp site should not hard-code the public API path list. If the OpenAPI
document changes, the reference UI should update from the fetched contract.

For local development, point the docs page at:

```text
http://127.0.0.1:3001/v1/openapi.json
http://127.0.0.1:3001/v1/docs
http://127.0.0.1:3001/v1/docs/config.json
```

For deployed environments, configure the docs source URL per environment so
staging and production can document their own API contracts.
