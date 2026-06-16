# Proveria V2 Roadmap

V1 established the desktop-first trust loop: producers submit whole-file
attestations from the desktop app, verifiers use a thin web client, receipts and
public verification artifacts are generated, and workspace audit/member controls
are in place.

V2 should make the next product leap: from exact whole-file proof to
content-level proof, with a cleaner access-request workflow for verifiers.

## Product Thesis

V2 is about proving meaningful document content without uploading plaintext.
The producer desktop app should locally derive content proof material, submit
only hashes and plaintext-safe metadata, and let verifiers check exact files,
external hashes, or known content passages through a scoped access flow.

## In Scope

### 1. Content-Level Verification

- Add producer-side content proof generation for supported document types.
- Start with deterministic text shingling for plain text and native PDF text
  layers.
- Preserve the V1 privacy boundary: source text stays local; only shingle
  payload hashes and plaintext-safe metadata leave the desktop.
- Surface coverage clearly in the desktop app, receipt JSON, receipt PDF, and
  verifier lookup UI.
- Let verifiers check:
  - a whole-file SHA-256
  - an externally supplied whole-file SHA-256
  - a content/passage proof hash

### 2. Verifier Request Workflow

- Allow a verifier to request access to a private attestation.
- Let producers/admins approve or deny requests from the desktop app.
- Record request, approval, denial, grant, revoke, and lookup activity in audit.
- Keep public verification pages as historical artifacts, consistent with V1.

### 3. Evidence Package Improvements

- Make receipt/proof bundle language more explicit about coverage:
  - whole-file only
  - whole-file plus native text shingles
  - whole-file plus OCR-derived shingles, when OCR later ships
- Add exportable verification package affordances where useful.
- Keep JSON and PDF artifacts stable enough for customer review.

### 4. Operational Scale

- Add clearer validation/worker states for content proof generation.
- Add retry visibility for failed validation, receipt, and PDF rendering paths.
- Improve bulk attestation workflows only where they support content-proof use.

## Out Of Scope

### Image And Perceptual Hashing

Image similarity and perceptual hashes are deferred to V3.

Reasoning:

- Whole-file hashes and text shingles make deterministic claims.
- Perceptual hashes make similarity claims that require thresholds, confidence
  language, false-positive handling, and a separate UX model.
- Shipping perceptual matching too early would blur Proveria's trust language.

V3 should revisit images with a dedicated discovery track covering pHash/dHash,
resize/crop/compression behavior, threshold calibration, and result language
such as "visually similar" rather than "verified identical."

### Broad Producer Portal

V2 remains desktop-first for producers/admins. The verifier stays a thin web
client unless a specific workflow requires otherwise.

### Semantic Similarity

V2 does not make semantic, paraphrase, authorship, AI-detection, or originality
claims. It proves deterministic content-derived hashes.

## Recommended Delivery Order

### Slice 1: V2 Content Proof Foundation

- Wire the existing shingling package into a desktop submission path.
- Support text files first, then native PDF text layers.
- Submit manifests containing one whole-file leaf plus many
  `shingle/sha256/v1` leaves.
- Show coverage counts before submission and after confirmation.
- Add focused desktop/API/worker tests for paid-plan shingle acceptance and
  free-plan rejection.

### Slice 2: Verifier Content Lookup

- Let the verifier submit a content proof hash in the existing lookup flow.
- Make match/no-match language distinguish whole-file and content-proof checks.
- Ensure receipt and public verification artifacts show the matched leaf type.

### Slice 3: Verifier Access Requests

- Add request-access UI for verifiers who can see an attestation target but do
  not yet have lookup access.
- Add desktop queue for pending access requests.
- Add approve/deny/revoke audit events and notifications.

### Slice 4: Native PDF Text Coverage

- Extract native PDF text locally.
- Generate text shingles with extraction metadata.
- Display extraction warnings and coverage counts.

### Slice 5: Release Hardening

- Build a V2 human QA checklist.
- Expand smoke tests for shingled attestations and verifier content lookups.
- Document known limitations and operational runbooks.
- Track V2 caveats in `docs/v2-known-limitations.md`.

## First Decision Already Made

Images and perceptual hashes are V3, not V2.

## Open Product Questions

- Should V2 call these "content proofs," "passage proofs," or "text coverage" in
  the UI?
- Should content proof generation be automatic for all supported files, or a
  producer-controlled option per attestation?
- Should verifiers paste a raw content proof hash first, or should we provide a
  local browser-side passage hasher in the thin web client?
- Should V2 include OCR-derived shingles, or keep OCR as a post-V2 enhancement
  after native text-layer coverage is stable?
