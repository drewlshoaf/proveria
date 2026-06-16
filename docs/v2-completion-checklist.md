# V2 Completion Checklist

This is the working definition of "complete enough to evaluate V2 content
proofs." V2 builds on the V1 desktop/verifier loop and adds deterministic text
content verification without uploading plaintext.

## Content Proof Foundation

- [x] Producer desktop generates content proof hashes for plain text files.
- [x] Producer desktop generates native PDF text-layer content proof hashes.
- [x] Content proof generation preserves the local privacy boundary.
- [x] Content proof manifests include whole-file and `shingle/sha256/v1` leaves.
- [x] Desktop shows content proof coverage before submission.
- [x] Attestation Detail shows content proof availability, methods, and presets.
- [x] Receipt metadata includes shingle counts and extraction methods.
- [x] Native PDF extraction metadata is preserved as `pdf-text-layer/v1`.

## Verifier Content Lookup

- [x] Verifier can hash a passage locally in the browser.
- [x] Verifier can submit content candidate hashes without sending plaintext.
- [x] Content match results identify text-content proof matches.
- [x] Content no-match results use scoped, non-overbroad language.
- [x] Public verification pages work for content match and no-match packages.
- [x] Existing whole-file verifier flows still work.

## Access Requests

- [x] Verifier can request access when they have a lookup link but no grant.
- [x] Producer/admin can review pending requests from a dedicated Requests area.
- [x] Producer/admin can approve a request and create a verifier grant.
- [x] Producer/admin can deny a request with a reason.
- [x] Denied requests are final and cannot be reconsidered.
- [x] Dashboard surfaces pending verifier request status.

## Release Hardening

- [x] `pnpm smoke:pdf-text-layer` covers native PDF text, receipt metadata,
  content match, content no-match, and public verification links.
- [x] V2 known limitations are documented in `docs/v2-known-limitations.md`.
- [x] Human QA checklist includes V2 content-proof scenarios.
- [ ] Human QA checklist completed for V2 content-proof scenarios.
- [ ] V2 QA sign-off record completed with reviewer, date, environment, and
  accepted limitations.

## Out Of Scope For V2

- [x] Image and perceptual hashes deferred to V3.
- [x] Semantic similarity, paraphrase, authorship, AI-detection, and originality
  claims excluded from V2.
- [x] OCR-derived shingles excluded from the current V2 QA gate.
