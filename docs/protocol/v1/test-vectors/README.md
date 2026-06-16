# Protocol V1 — Test Vectors

These vectors pin the byte-level outputs the Protocol V1 spec describes. They are the verification mechanism for any implementation: a second implementation, independently derived from the spec, MUST produce identical bytes for every input.

## File layout

Each vector file is a JSON document with:

```json
{
  "spec": "proveria-protocol-v1",
  "vectorCategory": "<category>",
  "version": "1.0",
  "vectors": [
    {
      "name": "<short stable id>",
      "input": { /* category-specific input */ },
      "expected": { /* category-specific output */ },
      "note": "<optional human-readable explanation>"
    }
  ]
}
```

| File | Spec section | Status |
| ---- | ------------ | ------ |
| `leaf-hash.json` | §4 | Values committed and pinned. |
| `canonical-json.json` | §2 | Values committed and pinned. |
| `merkle-tree.json` | §6 | Values committed and pinned. |
| `merkle-proof.json` | §6.7 | Values committed and pinned. |
| `manifest-signing.json` | §8.1 | Values committed and pinned. |
| `receipt-signing.json` | §9.5 | Fixed test keypair and values committed and pinned. |
| `result-package-signing.json` | §9.4 | Fixed test keypair and values committed and pinned. |
| `signature-roundtrip.json` | §8 | Fixed test keypair and values committed and pinned. |

## How implementations consume them

The reference implementation in `@proveria/crypto-core` (C12) loads each vector file from a test harness, runs the algorithm under test against `input`, and asserts byte-equality with `expected`. Any failure is a spec violation — either the implementation is wrong or the spec is wrong; both block M4 sign-off.

## How an external reviewer uses them

Without reading any code, derive the expected outputs by hand or with an independent toolchain from the algorithms in [protocol-v1.md](../protocol-v1.md). Compare against the `expected` field. Discrepancies indicate either a spec ambiguity or an implementation bug; either way, surface as a review finding.

## Updating vectors

Vectors are append-only for a given protocol version. To change an existing vector's `expected` field is equivalent to changing the spec — only permissible under a major-version bump (1.0 → 2.0). Adding new vectors is fine. Renaming or removing them is a breaking change.
