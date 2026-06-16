# Security Policy

Proveria is a cryptographic provenance platform. Plaintext never leaves
producer machines; the service only ever handles signed cryptographic
metadata. See [docs/v1](./docs/v1) §23 for the architectural posture.

## Reporting a Vulnerability

Please report security issues privately by emailing **security@proveria.com**
(TBD — pilot inbox to be confirmed by the business owner before pilot
launch). Do not file a public GitHub issue for security-impacting reports.

Expect:
- Acknowledgement within 3 business days.
- A coordinated disclosure timeline (default 90 days, negotiable for
  serious issues).
- Credit in the eventual advisory unless you ask to remain anonymous.

## V1 Security Posture (Pilot)

This is a non-exhaustive summary. See `docs/v1` for the full spec.

### Trust spine
- Every attestation manifest is signed by the producer device's Ed25519
  key (Protocol V1 §15). The server verifies the signature on
  upload-manifest BEFORE persisting any state derived from it.
- Confirmed attestations are additionally signed by the Proveria
  platform key for Team / Enterprise tiers (docs/v1 §15.3, §17.2).
- Verification packages can be re-verified offline by anyone using
  `proveria-hash verify` (Hash CLI, M14). Math-only verification
  requires no trust in Proveria; signature verification requires the
  Proveria public key.

### Plaintext discipline
- Files, shingles, and OCR text never cross the network. Only
  canonical payload hashes (32-byte SHA-256) plus plaintext-safe
  metadata (byte size, page counts, confidence scores) leave the
  producer machine.
- The dev-mode `LogNotificationProvider` refuses to start in
  production (`NODE_ENV=production`), so plaintext invitation /
  password-reset tokens cannot reach production logs. A real email
  provider (Resend) lands in M15.

### Session + cookie
- Sessions are stored in Postgres, keyed by a signed cookie:
  `httpOnly: true`, `secure: true` in production, `sameSite: 'lax'`,
  signed via `@fastify/cookie` HMAC with `SESSION_SECRET`.
- SameSite=Lax blocks the canonical CSRF vector (cross-site POSTs).
  All state-mutating endpoints are POST / PUT / DELETE; no GET routes
  mutate state.
- Device-authenticated endpoints don't use cookies — they take a
  per-request Ed25519 signature with a timestamp + body-hash payload
  (apps/api/src/auth/device-signature.ts). CSRF doesn't apply.

### Entitlement enforcement (M13)
- Hard caps per plan tier (docs/v1 §22.2) are enforced server-side:
  project count, per-project attestation count, monthly attestation
  allowance, user count, single-submission storage cap, verification
  rate limit. See `apps/api/src/entitlements/limits.ts`.

### Audit + observability
- Every privileged action writes an audit event. Enterprise tenants
  get a hash-chained audit log + signed Merkle checkpoints (M9).
- Structured logs across api + worker (M15/C55) — every line carries
  `service`, `version`, `env`, and the originating `requestId` that
  threads from api request → queue job → worker handler.

### Dependency hygiene
- `pnpm audit --prod` runs clean as of the M15/C57 checkpoint.
- Security-driven version pins live in `pnpm-workspace.yaml` under
  `overrides:` with the originating advisory linked in a comment.

### Known V1 limitations
- Customer-managed signing and Arbitrum anchoring are deferred per
  docs/v1 §3.4 (Enterprise-optional, post-V1).
- Cumulative cross-attestation storage tracking is a §15 follow-up;
  V1 only catches single-submission overruns at upload-manifest.
- Desktop forced-version-check (signed policy, offline TTL) is
  spec'd (§26.1.1) but not implemented in V1; deferred from M15.
- AWS deployment, Terraform / IaC, and real email provider were
  deferred from M15 to focus on local-iteration walkthroughs.
