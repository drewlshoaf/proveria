# V5 Webhook Catalog

V5 keeps the webhook surface intentionally small. Webhooks are for durable
workspace events that customer systems can react to without polling.

Public API paths still use `/v1/tenants/{slug}` for compatibility. In V5
product language, `{slug}` is the workspace slug.

## Delivery Envelope

Each webhook delivery posts a signed JSON body to the configured endpoint:

```json
{
  "id": "evt_...",
  "type": "receipt.issued",
  "tenantId": "workspace uuid",
  "createdAt": "2026-05-28T00:00:00.000Z",
  "data": {}
}
```

Headers include:

- `proveria-webhook-id`
- `proveria-webhook-event`
- `proveria-webhook-timestamp`
- `proveria-webhook-signature`

The signature uses HMAC-SHA256 over `<timestamp>.<json body>` and is formatted
as `t=<timestamp>,v1=<hex>`.

## Receiver Verification

Webhook receivers should verify the delivery before parsing or trusting the
payload. HTTP header names are case-insensitive; Proveria sends these lowercase
header names.

1. Read the exact raw request body bytes. Do not parse and re-stringify JSON
   before verification.
2. Read `proveria-webhook-signature`.
3. Parse the signature header as `t=<timestamp>,v1=<hex>`.
4. Reject the request if the header is missing, malformed, uses an invalid
   timestamp, is outside the receiver tolerance, or has a bad signature.
5. Compute `HMAC-SHA256(signing_secret, "<timestamp>.<raw body>")` and compare
   it to the `v1` signature using a timing-safe comparison.
6. Store processed `proveria-webhook-id` values when handlers cause external
   side effects. Delivery retries can resend the same event.

The TypeScript SDK exports `verifyWebhookSignature` for boolean checks and
`verifyWebhookSignatureDetailed` for receiver error handling. The default
timestamp tolerance is 300 seconds. See
`packages/sdk/examples/webhook.ts` for a minimal Node receiver that preserves
the raw body, verifies the signature, and switches on event type.

Endpoint signing secrets are returned once when an endpoint is created. Keep
the current secret in the receiver environment. When secret rotation is added,
receivers should accept both old and new secrets during a short cutover window,
then remove the old secret after delivery has settled.

## Supported Events

### `attestation.confirmed`

Emitted after a submitted attestation validates and its committed hash set is
available for receipt generation and verification.

Payload data includes:

- attestation id;
- project id;
- package id when available;
- Merkle root;
- confirmation timestamp;
- receipt availability state.

### `attestation.failed`

Emitted when attestation validation fails and the record needs review or
resubmission.

Payload data includes:

- attestation id;
- project id;
- attempt id;
- failure state;
- validation error when available.

### `receipt.issued`

Emitted after a confirmed attestation receipt is generated.

Payload data includes:

- attestation id;
- project id;
- package id;
- receipt link id;
- receipt JSON/PDF artifact availability;
- issued timestamp.

### `webhook.test`

Generated only by the public API test endpoint. It is used to validate receiver
configuration, signing, and delivery handling.

## Deferred Events

The following useful events are intentionally not part of the V5 supported
catalog yet:

- verifier access granted or revoked;
- verifier access request approved or denied;
- lookup match or no-match result issued;
- public verification link created, rotated, revoked, or expired;
- evidence export job created or completed;
- Google Drive source import completed.

These remain in the future product backlog until payload schemas and customer
use cases are stable.
