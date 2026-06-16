# Proveria Protocol Specifications

This directory is the in-repo home for Proveria's cryptographic protocol specifications and their reference test vectors. Specs live here so implementation, documentation, and tests version-lock together — see [docs/v1](../v1) §26.3 for the spec-authoring process.

## Versioning

Each protocol version lives in its own directory:

```
docs/protocol/
  v1/
    protocol-v1.md
    shingling-v1.md
    ocr-v1.md
    desktop-trust-v1.md
    notification-invitation-v1.md
    retention-deletion-v1.md
    test-vectors/
```

Confirmed attestations remain valid under the protocol version they were created with. Verifiers must support all non-revoked historical protocol versions for as long as artifacts under those versions remain valid (see docs/v1 §14.2).

## Spec lifecycle

Every spec goes through:

1. **Draft** — initial proposal, open for feedback.
2. **Engineering review** — implementability, performance, ambiguity check.
3. **Product / Architecture review** — scope, trust model alignment.
4. **Test vectors** — added where applicable (canonicalization, leaf/node hashes, signatures, etc.).
5. **External cryptographic review** — required for Protocol V1 and any crypto-touching spec.
6. **Signed-off and committed** — version frozen; subsequent changes require a new minor or major version.

## Implementation lock-step

Each spec gates implementation work:

| Spec | Gates milestone(s) |
| ---- | ------------------ |
| Protocol V1 | M4, M5, M7, M8 |
| Shingling V1 | M10 |
| OCR V1 | M11 |
| Desktop Trust V1 | M2, M15 |
| Notification / Invitation V1 | M2, M7, M15 |
| Retention / Deletion V1 | M15 |
