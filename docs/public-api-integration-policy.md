# Public API Integration Policy

This document defines the client-facing behavior that API-first integrations
should rely on for V6 planning and public API hardening.

The canonical API contract remains `GET /v1/openapi.json`. This document
explains operational behavior that is easier to read as policy than as route
schemas.

For a runnable API-only producer path, see
`docs/v6-api-producer-quickstart.md`.

## Authentication

Public API requests use workspace-bound bearer API keys:

```http
Authorization: Bearer prv_v1_...
```

API keys are separate from desktop device keys. A public API key can only act
against the workspace slug it was created for, even if the user who created the
key has access to multiple workspaces.

Revoked, expired, missing, or invalid keys return `401 invalid_api_key` or
`401 unauthorized` before protected route handlers run. Failed authentication
does not update API-key usage telemetry.

Use `GET /v1/tenants/{slug}/api-key` to inspect display-safe metadata for the
current bearer key. The response includes key id, prefix, scopes, workspace,
expiration, and usage telemetry. It never returns the token or stored key hash.

## Response Envelopes

Successful JSON responses use:

```json
{
  "data": {},
  "meta": {
    "requestId": "req_...",
    "apiKeyId": "..."
  }
}
```

`meta.requestId` should be logged by clients and included in support requests.
`meta.apiKeyId` identifies the authenticated machine credential without
exposing the token.

Binary and artifact endpoints may return the artifact body directly instead of
the JSON envelope.

## Error Envelopes

Public API errors use:

```json
{
  "error": {
    "code": "not_found",
    "message": "The requested resource was not found.",
    "retryable": false,
    "requestId": "req_...",
    "fieldErrors": [
      {
        "field": "sha256",
        "message": "sha256 must be 64 lowercase hex characters.",
        "code": "pattern"
      }
    ],
    "details": {
      "maxLength": 200
    }
  }
}
```

Client logic should branch on `error.code`, not on the human-readable
`error.message`. The message is intended for logs and developer-facing display.

`error.fieldErrors` is present for request validation failures where a specific
header or JSON field can be identified. Nested JSON fields use dot notation,
such as `compliance.sha256`. Header errors use the header name, such as
`Idempotency-Key`.

`error.details` is present only when extra machine-readable context is useful,
such as the allowed max length or the idempotency key involved in a conflict.

`error.retryable` indicates whether the same request may be retried safely from
the API perspective. Clients should still consider their own timeout, queue,
and idempotency behavior before retrying.

Common public API error codes:

| Code | HTTP status | Meaning |
| --- | ---: | --- |
| `unauthorized` | 401 | Missing bearer API key. |
| `invalid_api_key` | 401 | API key is invalid, revoked, or expired. |
| `insufficient_scope` | 403 | API key is valid but lacks the required scope. |
| `not_found` | 404 | Resource is missing or outside the authenticated workspace. |
| `invalid_request` | 400 | Request body, query, params, or headers failed schema validation. |
| `idempotency_key_required` | 400 | Mutating request omitted `Idempotency-Key`. |
| `invalid_idempotency_key` | 400 | `Idempotency-Key` is not acceptable. |
| `idempotency_key_conflict` | 409 | Same key was reused with a different request body. |
| `invalid_slug` | 400 | Project slug format is invalid. |
| `invalid_name` | 400 | Required name field is blank or invalid. |
| `invalid_label` | 400 | Required attestation label is blank or invalid. |
| `invalid_sha256` | 400 | Hash input is not a 64-character lowercase hex SHA-256. |
| `invalid_compliance_sha256` | 400 | Compliance hash is not a 64-character lowercase hex SHA-256. |
| `duplicate_compliance_sha256` | 400 | Compliance hash matches the primary file hash. |
| `invalid_compliance_media_type` | 400 | Compliance media type is not supported. |
| `invalid_email` | 400 | Verifier email is not valid. |
| `api_key_actor_unavailable` | 409 | API key can no longer resolve the user actor needed for the mutation. |

## Idempotency

Mutating public API requests require an `Idempotency-Key` header:

```http
Idempotency-Key: upstream-job-123
```

The maximum supported key length is 200 characters.

For the same workspace, API key, HTTP method, route, and idempotency key:

- same request body: the API replays the original stored response;
- different request body: the API returns `409 idempotency_key_conflict`;
- missing key on a mutating request: the API returns
  `400 idempotency_key_required`;
- overly long key: the API returns `400 invalid_idempotency_key`.

Use durable upstream identifiers when retry stability matters, such as a queue
job id, source record id, dataset revision id, or webhook-delivery id. Random
keys are acceptable for one-off commands, but they prevent intentional replay
after a client restart.

## Retry Guidance

Retry only when either:

- the API returns `error.retryable: true`; or
- the client never received a response because of a network timeout or
  connection failure.

When retrying a mutating request, preserve the same `Idempotency-Key` and body.
Do not generate a fresh idempotency key for a retry of the same upstream
operation; doing so asks the API to create a second operation.

Suggested client behavior:

- log `requestId` for every response;
- use bounded exponential backoff with jitter for retryable failures;
- cap retry attempts and surface the final error with `requestId`;
- treat `409 idempotency_key_conflict` as a client bug or upstream job-key
  collision;
- treat `401 invalid_api_key` as an operator action item, not a transient
  failure.

## Rate-Limit Headers

Authenticated public API responses include standard policy headers:

```http
RateLimit-Limit: 600
RateLimit-Remaining: 600
RateLimit-Reset: 1780689660
```

`RateLimit-Limit` is the maximum request count for the current policy window.
`RateLimit-Remaining` is the request count still available in that window.
`RateLimit-Reset` is the Unix timestamp, in seconds, when the window resets.

The initial V6 contract publishes these headers before strict request blocking
is enabled, so `RateLimit-Remaining` may equal `RateLimit-Limit`. Future
enforced limits should return `429 rate_limited` with a `Retry-After` header.

Missing, invalid, revoked, or expired credentials may fail before rate-limit
headers are attached. Valid credentials with insufficient scope still receive
the headers because authentication succeeded.

## SDK Behavior

The TypeScript SDK auto-generates idempotency keys for helper methods that
create durable server-side records. Callers can pass `idempotencyKey` when
replay stability needs to survive process restarts or align with an upstream
job id.

Prefer caller-provided idempotency keys for:

- background jobs;
- CI pipelines;
- scheduled exports;
- dataset inventory or revision workflows;
- webhook-driven sync jobs;
- any operation where the same upstream action may be retried later.

## Pagination

Public list endpoints use offset pagination:

```http
GET /v1/tenants/{slug}/attestations?limit=100&offset=0
```

Paginated responses include `meta.pagination`:

```json
{
  "data": [],
  "meta": {
    "requestId": "req_...",
    "apiKeyId": "...",
    "pagination": {
      "limit": 100,
      "offset": 0,
      "returned": 25,
      "hasMore": false
    }
  }
}
```

`limit` is bounded per endpoint. Most list endpoints default to 100 and allow
up to 500. Evidence export jobs default to 25 and allow up to 100. `offset`
defaults to 0 and is capped at 10000.

List responses are ordered newest first unless an endpoint documents a
different order. To fetch the next page, request `offset + returned` while
`hasMore` is true. Clients should pass an explicit `limit` for automation and
must not assume that a missing page means no records were created concurrently.

## API Key Usage Telemetry

Successful authenticated requests update aggregate API key usage telemetry after
the response finishes. Usage telemetry includes:

- `usageCount`;
- `lastUsedAt`;
- `lastUsedMethod`;
- `lastUsedPath`;
- `lastUsedStatusCode`.

Telemetry is operational metadata for admins and developers. It is not a full
per-request audit log and should not replace Events for immutable audit
history.

## Compatibility

Public V1 paths are intended to remain stable. Additive response fields may be
introduced over time. Clients should ignore unknown fields and treat documented
required fields as the compatibility boundary.

Breaking changes require a new explicit API version or a documented migration
path.
