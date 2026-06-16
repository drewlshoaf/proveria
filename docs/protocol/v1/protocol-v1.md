# Proveria Protocol V1

> Cross-reference: [docs/v1](../../v1) §13 (manifest), §14 (server validation), §17 (proof packages), §26.3 (spec process).

## Status

Draft v0.1 — internal sign-off pending; external cryptographic review pending. Implementation under M4 must hold to the byte-level definitions in this document; any deviation requires a spec amendment.

**2026-05-14 — internal review conformance pass.** Clarified §2 (UTF-16 code-unit key ordering; canonicalizer rejects non-safe-integer numbers) and §7.2 (`filename_redacted` deferred; V1 emits `byte_size` only). These pin behavior the prior draft left implicit; they are not breaking changes. The reference implementation in `@proveria/crypto-core` was corrected to match. Receipt and result-package signing vectors are committed; external cryptographic review remains pending.

## Owner

Engineering

## Reviewers

Product / Architecture
External cryptographic reviewer (per docs/v1 §26.3)

## Purpose

Define the canonical cryptographic protocol for Proveria V1 attestations: manifest serialization, Merkle leaf and tree encoding, signature payloads, proof packages, verifier dispatch, and the rules for advancing the version.

This spec gates Milestone 4. Implementation produces test vectors that match the algorithms defined here; the vectors are committed alongside the implementation under `test-vectors/`.

## Goals

- Define canonical JSON serialization (RFC 8785).
- Define hash encoding (lowercase hex on the wire; raw bytes in cryptographic input).
- Define Merkle leaf encoding with domain separation, length-prefixed components, and explicit byte order.
- Define deterministic Merkle tree construction with explicit odd-leaf handling.
- Define what the desktop and Proveria signing keys cover.
- Define the proof / result package structure.
- Define the verifier's version-dispatch behavior.
- Provide structured reference test vectors.

## Non-Goals

- Shingling algorithm details — see [shingling-v1.md](shingling-v1.md).
- OCR engine behavior — see [ocr-v1.md](ocr-v1.md).
- Audit hash-chain construction (Enterprise / M9) — covered in a future audit-v1 amendment.
- UI workflow concerns.
- Billing or entitlement enforcement.

---

## 1. Version identifiers

Every manifest, leaf, and proof package carries a small set of version strings. Mismatches are surfaced explicitly rather than silently coerced.

| Field | Meaning | V1 value |
| ----- | ------- | -------- |
| `protocol_version` | This document's version. Drives verifier dispatch. | `"1.0"` |
| `schema_version` | Top-level manifest / proof-package schema version. | `"1.0"` |
| `canonicalization_version` | Canonical JSON serialization version. | `"1.0"` (RFC 8785) |
| `merkle_version` | Merkle leaf + tree encoding version. | `"1.0"` |
| `hash_algorithm` | Algorithm identifier for content hashes. | `"sha256"` |
| `hash_algorithm_version` | Hash algorithm version tag. | `"1.0"` |
| `verifier_version` | Verifier implementation version (informational, set by the verifier writing a result package). | `"1.0"` at V1 implementation time |

All values are strings, not numbers. No float versions.

---

## 2. Canonical JSON serialization

**Decision: RFC 8785 (JCS).** Every JSON value that crosses a trust boundary — manifests, result packages, signed audit payloads — is serialized with RFC 8785 canonicalization before hashing or signing.

### Rules layered on top of RFC 8785

1. **No floats in cryptographic payloads.** Integers and strings only. Counts and byte sizes are integers. Timestamps are ISO 8601 strings (`"2026-05-13T23:00:00Z"`); where machine comparison is required, an integer milliseconds-since-epoch field may be added alongside, never replacing the ISO string. The canonicalizer enforces this directly — it MUST reject any number that is not a safe integer (non-integer values, and integers outside `[-(2^53-1), 2^53-1]`) rather than emit a serialization whose RFC 8785 conformance is not guaranteed.
2. **Hashes in JSON are lowercase hex strings.** `"3e23e8160039594a33894f6564e1b1348bbd7a0088d42c4acb73eeaed59c009d"`. The raw bytes appear only inside binary cryptographic inputs (leaf hash input, node hash input).
3. **IDs are strings.** UUIDs are lowercase, hyphenated.
4. **Versions are strings.** As listed in §1.
5. **All required fields must be present.** Omitting a required field produces an invalid manifest, not one with default values.
6. **No `null` for required fields.** Optional fields may be `null` or omitted; the spec for each field states which form is canonical.

RFC 8785 already pins: UTF-8 byte stream output, key ordering at every object level, no insignificant whitespace, ECMAScript number serialization for integers within the safe integer range. Numbers outside `[-(2^53-1), 2^53-1]` MUST NOT appear in cryptographic payloads — use strings.

**Key ordering is by UTF-16 code units** (RFC 8785 §3.2.3), not Unicode code points. The two orderings agree for all Basic Multilingual Plane characters and diverge only for non-BMP characters (surrogate pairs) relative to characters in `U+E000..U+FFFF`. Implementations MUST use code-unit ordering — this is JavaScript's native string comparison; do not substitute code-point ordering.

---

## 3. Hash algorithm

**Decision: SHA-256.** All content hashes, leaf hashes, internal node hashes, and signature payload pre-hashes use SHA-256. A SHA-256 digest is 32 bytes (256 bits).

### Encoding boundary

| Context | Encoding |
| ------- | -------- |
| Inside a leaf hash input (binary) | Raw 32 bytes |
| Inside a node hash input (binary) | Raw 32 bytes |
| Inside JSON (manifest, result package, etc.) | Lowercase hex, 64 chars |

A leaf's `canonical_payload_hash` field, when included in the **binary leaf hash input** (§4), is the raw 32 bytes. The **same hash, when serialized into the manifest JSON's `leaf_set` entry**, is the 64-character lowercase hex string. Both representations encode the same 32 bytes; they differ only in serialization. Implementations MUST NOT mix them up.

---

## 4. Merkle leaf encoding

Every leaf in the attestation Merkle tree is hashed via the following algorithm.

### 4.1 Leaf hash input (binary)

```
leaf_hash_input =
    0x00
  || length_prefix(protocol_version_utf8)
  || protocol_version_utf8
  || length_prefix(leaf_type_utf8)
  || leaf_type_utf8
  || length_prefix(hash_algorithm_utf8)
  || hash_algorithm_utf8
  || length_prefix(canonical_payload_hash_bytes)
  || canonical_payload_hash_bytes
```

Where:

- `0x00` is a single byte (domain separator distinguishing leaves from internal nodes).
- `length_prefix(x)` is a **4-byte big-endian unsigned integer** (`uint32`) holding the number of bytes in `x`. Maximum representable length: `2^32 − 1 = 4_294_967_295` bytes. Practical lengths are well under 1 KB.
- `protocol_version_utf8` is the UTF-8 byte encoding of the version string (e.g. `"1.0"` → 3 bytes `0x31 0x2e 0x30`).
- `leaf_type_utf8` is the UTF-8 byte encoding of the leaf type identifier (§5).
- `hash_algorithm_utf8` is the UTF-8 byte encoding of the hash algorithm identifier (e.g. `"sha256"` → 6 bytes).
- `canonical_payload_hash_bytes` is the **raw 32-byte SHA-256 digest** of the canonical payload (§6). Length prefix is always `0x00000020` (32).

### 4.2 Leaf hash

```
leaf_hash = SHA-256(leaf_hash_input)
```

The leaf hash is a 32-byte digest. It is the value referenced by the tree's internal nodes and by Merkle proofs.

### 4.3 Why these choices

- **Domain separator (`0x00`)** ensures a leaf hash can never collide with an internal node hash, even given a maliciously chosen tree shape. This is the standard defense against second-preimage attacks on Merkle trees.
- **Length-prefixed components** prevent ambiguity when concatenating variable-length fields. Without prefixes, `"file" + "sha256"` and `"filesha" + "256"` would hash identically.
- **`uint32` big-endian length prefixes** are network byte order, trivially implemented in any language, and provide more than enough range for our values. Chosen over varints (LEB128, etc.) to avoid encoding ambiguity at the binary layer.
- **Raw payload hash bytes** keep the input compact and avoid an "is this hex or bytes?" ambiguity. The length prefix is always 32 for SHA-256, so a parser can sanity-check the field.

---

## 5. Leaf type registry

`leaf_type` is a stable string identifier of the form `<class>/<hash-algorithm>/<version>`. The full V1 registry:

| `leaf_type` | Class | Hash | Version | Purpose |
| ----------- | ----- | ---- | ------- | ------- |
| `file/sha256/v1` | Whole file | SHA-256 | v1 | One leaf per file; payload hash is SHA-256 of the raw file bytes. |
| `shingle/sha256/v1` | Text shingle | SHA-256 | v1 | One leaf per shingle; payload hash defined by [shingling-v1.md](shingling-v1.md). |
| `component/sha256/v1` | Sub-file component | SHA-256 | v1 | Reserved for component-level coverage (e.g. PDF pages, archive members). |

Future versions introduce `…/v2` entries; v1 verifiers MUST reject unknown leaf types as invalid rather than treat them as v1.

### 5.1 Canonical payload (per leaf type)

| `leaf_type` | Canonical payload | `canonical_payload_hash` |
| ----------- | ----------------- | ------------------------ |
| `file/sha256/v1` | The raw bytes of the file. | `SHA-256(file_bytes)` |
| `shingle/sha256/v1` | The canonical shingle bytes per shingling-v1. | `SHA-256(canonical_shingle_bytes)` |
| `component/sha256/v1` | Implementation-defined per component class; documented when introduced. | `SHA-256(canonical_component_bytes)` |

---

## 6. Merkle tree construction

### 6.1 Inputs

The tree is constructed over a **leaf set** — an ordered list of leaf hashes. The manifest's `leaf_set` field carries this list (as hex strings).

### 6.2 Leaf ordering

**Decision: lexicographic sort by `leaf_hash` (raw 32 bytes).**

Concretely: sort the 32-byte leaf hash byte arrays in big-endian (left-to-right) lexicographic order. Equivalently, sort their hex representations ASCII-ascending.

Rationale: deterministic, requires no extra metadata, and duplicates (§6.4) are forbidden so the ordering is unique.

### 6.3 Internal node hash input

```
node_hash_input = 0x01 || left_child_hash || right_child_hash
```

Where:

- `0x01` is a single byte (domain separator distinguishing internal nodes from leaves).
- `left_child_hash`, `right_child_hash` are each 32 raw bytes — either leaf hashes (at the bottom level) or other node hashes (higher levels).

```
node_hash = SHA-256(node_hash_input)
```

The fixed 32-byte child size means no length prefix is needed here; the input is exactly 65 bytes.

### 6.4 Duplicate detection

Two leaves with identical `leaf_hash` are **forbidden**. The server rejects manifests where any leaf hash repeats. This is enforced after leaf-hash construction (so two different file paths that happen to have identical contents are correctly identified as duplicates; one is included, the other rejected at submission time).

The duplicate rule is what makes the leaf ordering unique.

### 6.5 Odd-leaf handling

**Decision: promote the final unpaired hash upward unchanged.**

When a level has an odd number of nodes, the last node is **carried up** to the next level without being paired with anything and without being duplicated.

Example with 3 leaves `L0, L1, L2`:

```
Level 0:   L0    L1    L2
Level 1:   N(L0, L1)   L2          ← L2 promoted unchanged
Level 2:   N(N(L0, L1), L2)        ← root
```

Rationale: Bitcoin's "duplicate the last node" scheme creates an ambiguity where a tree of N leaves can be confused with a tree of N+1 where the last leaf is a duplicate. Promotion-without-duplication is collision-free given the duplicate-leaf rule above.

### 6.6 Empty and single-leaf trees

| Leaf count | Root |
| ---------- | ---- |
| 0 | **Forbidden.** Attestations MUST have at least one leaf. |
| 1 | The single leaf hash is the Merkle root. No internal-node hashing. |
| ≥ 2 | Construct levels as above. |

### 6.7 Proof path encoding

A Merkle proof for a leaf is an ordered array of steps from the leaf up to the root. Each step is an object:

```json
{
  "sibling": "<64-char lowercase hex>",
  "position": "left" | "right"
}
```

`position` indicates where the sibling sits relative to the current node when computing the parent. If `position` is `"left"`, the next-level hash is `SHA-256(0x01 || sibling || current)`. If `"right"`, it is `SHA-256(0x01 || current || sibling)`.

**Proofs are sparse.** A promoted node (the unpaired final node at a level with odd count, §6.5) carries up to the next level unchanged — there is no internal-node hash at that level, so the proof contains **no step** for it. The proof's length therefore equals the number of internal-node hashes between the leaf and the root, which may be fewer than the tree's depth. A verifier walks the proof emitting exactly one hashing step per entry; promoted-through levels are simply absent from the proof and require no special handling.

A single-leaf tree has an empty proof path (the leaf is the root).

**Worked example — 3-leaf tree.** Sorted leaves `L0, L1, L2`. Tree: level 1 is `[N(L0,L1), L2]` (L2 promoted), level 2 is `[N(N(L0,L1), L2)]` = root.

- Proof for `L0`: `[{sibling: L1, position: right}, {sibling: L2, position: right}]` — two steps.
- Proof for `L2`: `[{sibling: N(L0,L1), position: left}]` — one step. L2's level-0 promotion contributes no step; the single step is at level 1, where L2 pairs with `N(L0,L1)`.

---

## 7. Manifest

The manifest is the canonical JSON document a producer uploads (alongside the leaf set) when submitting an attestation. It carries enough metadata for the server to recompute the Merkle root and verify the signature.

### 7.1 Required fields

| Field | Type | Notes |
| ----- | ---- | ----- |
| `schema_version` | string | `"1.0"` |
| `protocol_version` | string | `"1.0"` |
| `canonicalization_version` | string | `"1.0"` |
| `merkle_version` | string | `"1.0"` |
| `hash_algorithm` | string | `"sha256"` |
| `hash_algorithm_version` | string | `"1.0"` |
| `shingling_version` | string \| null | Present when shingling leaves are included; null otherwise. |
| `ocr_extraction_version` | string \| null | Present when any leaf was derived from OCR text; null otherwise. |
| `tenant_id` | string (uuid) | Server-issued. |
| `project_id` | string (uuid) | Server-issued. |
| `attestation_id` | string (uuid) | Server-issued. |
| `attempt_id` | string (uuid) | Server-issued. |
| `created_by_user_id` | string (uuid) | The acting user. |
| `created_by_device_id` | string (uuid) | The paired desktop device. |
| `created_by_profile_id` | string (uuid) | Profile namespace (docs/v1 §9.3). |
| `template_id` | string \| null | Template slug; null for "no template chosen". |
| `policy_context` | object | Tier / preset / classification flags. Schema layered into shingling-v1 and project policy. May be `{}`. |
| `source_summary` | object | Counts only (no plaintext): `{ "file_count": int, "shingle_count": int, "ocr_page_count": int }`. Other fields permitted but counts are required. |
| `extraction_metadata` | object | OCR engine versions, language packs, confidence summary (per ocr-v1). May be `{}` when no extraction occurred. |
| `leaf_set` | array of objects | One entry per leaf (see §7.2). Order matches the canonical sort (§6.2). |
| `leaf_counts` | object | `{ "file": int, "shingle": int, "component": int }`. Sums match `leaf_set` length. |
| `merkle_root` | string (64-char lowercase hex) | The Merkle root computed per §6. |
| `signatures` | array of objects | One or more signatures (see §8). |
| `created_at` | string (ISO 8601, UTC) | Manifest creation timestamp. |

### 7.2 Leaf set entries

Each `leaf_set` entry:

```json
{
  "leaf_type": "file/sha256/v1",
  "leaf_hash": "<64-char hex>",
  "canonical_payload_hash": "<64-char hex>",
  "metadata": { /* leaf-type-specific, no plaintext */ }
}
```

`leaf_hash` is the SHA-256 of the binary leaf hash input (§4). `canonical_payload_hash` is the SHA-256 of the canonical payload (§5.1). For `file/sha256/v1`, `metadata` carries `{ "byte_size": int }` in V1. **No plaintext fields under `metadata`, and never the raw filename.** A redacted-form filename (`filename_redacted`, a salted HMAC of the original) is intended but deferred — the salt-derivation scheme is a future spec amendment, and until it lands the V1 desktop MUST emit `byte_size` only.

### 7.3 Encoding

The wire-format manifest is the result of applying RFC 8785 canonicalization to the JSON value above. The server validates by re-canonicalizing the manifest payload it received and comparing byte-for-byte. Implementations MAY transport non-canonical JSON over the network but MUST canonicalize before validation, hashing, and signing.

---

## 8. Signatures

### 8.1 Signed payload

**Decision: the desktop signs `SHA-256(canonical_manifest_bytes_without_signatures_field)`.**

Concretely: produce the manifest JSON value, set `signatures` to `[]`, RFC 8785 canonicalize, SHA-256 the resulting bytes, sign that 32-byte digest with the device's Ed25519 private key. Then populate `signatures` with the resulting signature entry and re-canonicalize for transport.

This binds the signature to every other field in the manifest (Merkle root, tenant/project/attestation IDs, timestamps, leaf set, policy context) without recursion (signing `signatures` while computing `signatures` is impossible).

### 8.2 Signature entry

Each `signatures` array entry:

```json
{
  "signer_kind": "device" | "proveria" | "customer",
  "key_id": "<string>",
  "algorithm": "ed25519",
  "signature": "<base64url-encoded raw 64-byte Ed25519 signature>"
}
```

Where:

- `signer_kind`: `"device"` for the desktop pairing key (always present), `"proveria"` for the Proveria platform signature on Team/Enterprise receipts (per docs/v1 §15.3), `"customer"` for customer-managed signing (Enterprise, per docs/v1 §15.4).
- `key_id`: stable identifier resolvable to a public key. For `"device"`: the `created_by_device_id` UUID. For `"proveria"`: a versioned key identifier (e.g. `"proveria-platform-v1-2026q2"`). For `"customer"`: tenant-configured.
- `algorithm`: `"ed25519"` in V1. Future versions may add others.
- `signature`: 64-byte raw Ed25519 signature, base64url-encoded.

### 8.3 Verification

The verifier:

1. Reads the manifest's `signatures` array.
2. Constructs the canonical-without-signatures byte stream (§8.1).
3. SHA-256s it.
4. For each signature entry, resolves the public key by `signer_kind` + `key_id` and verifies the Ed25519 signature against the SHA-256 digest.
5. Rejects the manifest if a signature's `key_id` does not match the resolved key being used for verification.
6. Rejects the manifest if any signature fails.

---

## 9. Proof / result packages

A result package is the canonical JSON document Proveria emits when a consumer performs a scoped hash lookup (docs/v1 §17). It binds the consumer's submitted hash to a specific attestation and either includes a Merkle proof (match) or a signed no-match statement.

### 9.1 Required fields

| Field | Type | Notes |
| ----- | ---- | ----- |
| `schema_version` | string | `"1.0"` |
| `protocol_version` | string | `"1.0"` |
| `canonicalization_version` | string | `"1.0"` |
| `merkle_version` | string | `"1.0"` |
| `verifier_version` | string | The version of the verifier that produced this result. |
| `package_id` | string (uuid) | Unique result-package identifier. |
| `result_type` | `"match"` \| `"no_match"` | Discriminator. |
| `submitted_hash` | string (64-char hex) | The hash the consumer submitted. |
| `hash_algorithm` | string | `"sha256"` |
| `hash_algorithm_version` | string | `"1.0"` |
| `lookup_scope` | object | `{ "tenant_id": uuid, "project_id": uuid, "attestation_id": uuid }`. |
| `attestation` | object | `{ "label": string, "confirmed_at": iso8601, "merkle_root": hex, "protocol_version": "1.0" }`. |
| `match` | object \| null | Present only when `result_type` is `"match"`. See §9.2. |
| `no_match_statement` | string \| null | Present only when `result_type` is `"no_match"`. See §9.3. |
| `signatures` | array | Same shape as §8.2. Free tier: empty (self-verifiable via Merkle math). Team/Enterprise: Proveria-signed; optional customer signature. |
| `created_at` | string (ISO 8601, UTC) | Result-package creation timestamp. |

### 9.2 Match payload

```json
{
  "leaf_id": "<canonical leaf id — the leaf_hash hex>",
  "leaf_type": "file/sha256/v1",
  "proof_path": [
    { "sibling": "<hex>", "position": "left" | "right" }
  ]
}
```

`leaf_id` is the leaf hash (hex); this is the value the proof verifies against the manifest's Merkle root. `proof_path` is the array of sibling-position steps from leaf to root (§6.7).

### 9.3 No-match statement

A short signed string asserting non-membership in the scoped attestation:

> `"This hash was not present in this specific attestation's committed hash set."`

Verbatim wording (the brand voice in docs/brand/style-guide.md applies — precision over flourish). The string is part of the canonical signed bytes; tampering breaks the Proveria signature.

The package MUST NOT claim universal absence — only absence from the specific committed set.

### 9.4 Result-package signing

Team/Enterprise result packages use the same signing construction as manifests: set `signatures` to `[]`, RFC 8785-canonicalize the package, SHA-256 the canonical bytes, then sign the 32-byte digest with the Proveria platform Ed25519 key. Verification resolves the Proveria public key by the signature entry's `key_id`, checks that the resolved key identifier matches the entry, and verifies the signature over the digest.

Free-tier packages MAY leave `signatures` empty when they are self-verifiable by Merkle proof math alone. Signed no-match packages require the Proveria signature because non-membership is an assertion by the scoped service, not a proof carried by the tree.

### 9.5 Receipt signing

Attestation receipts use the same signing construction: set `signatures` to `[]`, RFC 8785-canonicalize the receipt, SHA-256 the canonical bytes, then sign the 32-byte digest with the Proveria platform Ed25519 key. Verification resolves the Proveria public key by the signature entry's `key_id`, checks that the resolved key identifier matches the entry, and verifies the signature over the digest.

The receipt schema itself is defined in `@proveria/receipt` and docs/v1 §18. Protocol V1 pins the canonical signing bytes and test vectors because receipts are durable evidence artifacts.

---

## 10. Verifier version dispatch

Confirmed attestations remain valid under the protocol version they were created with. Verifiers MUST:

- Support every non-revoked historical protocol version for as long as attestations under those versions remain valid.
- Dispatch by the manifest's `protocol_version` field, not by the verifier's own version.
- Refuse to validate when the `protocol_version` is unknown — fail loudly rather than coerce.

### 10.1 Behavior matrix

| Scenario | Behavior |
| -------- | -------- |
| Protocol V1.0 ships | V1.0 attestations remain valid under V1.0 rules. |
| V1.1 adds a non-breaking feature | New attestations may use V1.1; old V1.0 remains valid; verifier serves both. |
| V1.1 fixes a minor ambiguity without security impact | Keep V1.0 verifier; mark V1.1 preferred. |
| V1.0 has a security-impacting flaw | Mark V1.0 as legacy / risk-qualified; verifier emits an explicit warning in result packages. |
| Catastrophic V1.0 flaw | Disable new V1.0 attestations; preserve historical records with `result_type` annotations marking them risk-qualified. |

---

## 11. Deprecation rules

A non-breaking spec amendment lands as a minor version bump (1.0 → 1.1). Adding a new leaf type, adding optional manifest fields, or adding new signature `algorithm` values are non-breaking — verifiers default to the old behavior for absent fields and reject unknown values for required fields.

A breaking amendment lands as a major bump (1.0 → 2.0). Breaking changes include any of:

- Modifying the byte layout of `leaf_hash_input` or `node_hash_input`.
- Changing the canonical JSON serialization rules.
- Changing the signed-payload construction in §8.1.
- Changing the meaning of an existing field type.

A breaking amendment requires external cryptographic re-review.

---

## 12. Test vectors

Reference vectors live under [test-vectors/](test-vectors/). The implementation in `@proveria/crypto-core` (M4 / C12) generates them; the spec defines the algorithms precisely enough that a second implementation can independently derive identical bytes.

| Vector file | Covers |
| ----------- | ------ |
| `test-vectors/canonical-json.json` | JSON value → canonical UTF-8 bytes (RFC 8785). |
| `test-vectors/leaf-hash.json` | Leaf payload → binary `leaf_hash_input` → SHA-256 → `leaf_hash`. |
| `test-vectors/merkle-tree.json` | Leaf sets → ordered leaves → Merkle root, for leaf counts 1, 2, 3, 4, 8. |
| `test-vectors/merkle-proof.json` | Leaf + tree → proof path → recomputed root equals tree root. |
| `test-vectors/manifest-signing.json` | Manifest with `signatures: []` → canonical bytes → SHA-256 → signature digest. |
| `test-vectors/receipt-signing.json` | Receipt with `signatures: []` → canonical bytes → SHA-256 → Proveria signature. |
| `test-vectors/result-package-signing.json` | Result package with `signatures: []` → canonical bytes → SHA-256 → Proveria signature. |
| `test-vectors/signature-roundtrip.json` | Fixed Ed25519 keypair + signed digest → signature; verification result. |

Each vector file is a JSON document with a `version` field, a `vectors` array of named cases, and `input` / `expected` payloads. Implementations MUST pass every committed vector. Adding a vector requires updating this list.

### 12.1 Worked example: leaf hash for a 1-byte file

For a file containing the single byte `0x41` (ASCII `"A"`):

```
canonical_payload         = 0x41                                      (1 byte)
canonical_payload_hash    = SHA-256(0x41)
                          = 559aead08264d5795d3909718cdd05abd49572e84fe55590eef31a88a08fdffd
                            (32 bytes)

leaf_hash_input fields:
  0x00                                                                (1  byte, domain sep)
  0x00 00 00 03  || "1.0"                                             (4 + 3 bytes)
  0x00 00 00 0e  || "file/sha256/v1"                                  (4 + 14 bytes)
  0x00 00 00 06  || "sha256"                                          (4 + 6 bytes)
  0x00 00 00 20  || canonical_payload_hash (32 raw bytes)             (4 + 32 bytes)

Total input bytes: 1 + 4 + 3 + 4 + 14 + 4 + 6 + 4 + 32 = 72 bytes.

Full hex (72 bytes, wrapped):
  00 00000003 312e30 0000000e 66696c652f7368613235362f7631
  00000006 736861323536 00000020
  559aead08264d5795d3909718cdd05abd49572e84fe55590eef31a88a08fdffd

leaf_hash = SHA-256(leaf_hash_input)
          = c0a9acf68a3b0a044bdc477d1e66048d458f4a42482418831dbdcdb2106a90fd
```

The reference implementation MUST compute identical bytes to this layout; deviations are spec violations.

---

## 13. Approval checklist

- [ ] Engineering review complete
- [ ] Product / Architecture review complete
- [ ] Reference implementation in `@proveria/crypto-core` produces matching test vectors
- [ ] Test vectors committed under [test-vectors/](test-vectors/)
- [ ] External cryptographic review complete
- [ ] Review findings resolved
- [ ] Approved for Milestone 4
- [ ] Approved for pilot
