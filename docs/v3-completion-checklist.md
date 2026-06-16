# V3 Completion Checklist

This is the working definition of "complete enough to evaluate V3 image and OCR
evidence." V3 builds on the V2 desktop/verifier loop and adds scanned-document
and image proof coverage without uploading plaintext, source images, or source
pixels.

## OCR Foundation

- [ ] Existing OCR protocol reviewed against current V3 naming and desktop UX.
- [*] OCR engine/package decision recorded: start with existing
  `@proveria/ocr` Tesseract.js/WASM path unless packaging tests expose a
  blocker.
- [*] First OCR scope decision recorded: scanned PDF fallback before standalone
  image proof.
- [*] Desktop can identify scanned PDFs with insufficient native text.
- [*] Desktop can run OCR locally for scanned PDFs.
- [*] OCR-derived text is never sent to the API, written to receipts, or stored
  in artifacts.
- [*] OCR output feeds the existing text-content proof pipeline.
- [*] OCR content proof leaves include explicit method/version metadata.
- [*] Desktop preview shows OCR coverage before submission.
- [*] Desktop preview shows OCR confidence and low-confidence warnings.
- [*] Attestation Detail distinguishes native text coverage from OCR coverage.

## OCR Verification

- [*] Verifier passage lookup can match OCR-derived content proof leaves.
- [*] OCR content match language is understandable and conservative.
- [*] OCR no-match language is scoped to the attestation and lookup time.
- [*] Public result page identifies OCR-derived content matches.
- [*] Result PDF identifies OCR-derived content matches.
- [*] Receipt JSON/PDF identifies OCR coverage and confidence metadata.

## Exact Image Proof

- [*] Desktop can generate exact image SHA-256 coverage for PNG.
- [*] Desktop can generate exact image SHA-256 coverage for JPEG.
- [*] Desktop records image proof method/version metadata.
- [*] Desktop preview shows exact image coverage before submission.
- [*] Attestation Detail shows exact image proof coverage.
- [*] Receipt JSON/PDF identifies exact image hash coverage.
- [*] Verifier image upload can produce an exact image match.
- [*] Verifier image upload can produce an exact image no-match.

## Desktop UX

- [ ] New attestation preview groups coverage by file and proof type.
- [ ] Unsupported file reasons are clear.
- [ ] Low-confidence OCR warnings are visible but do not block submission.
- [ ] Image/OCR coverage appears in the compact attestation detail summary.
- [ ] Records tab exposes technical OCR/image proof metadata.
- [ ] Verifications tab supports image lookup handoff language.
- [ ] Events tab records OCR/image submission and lookup activity clearly.

## API, Worker, And Protocol

- [*] API accepts OCR/image proof leaves without accepting source content.
- [*] Worker validation accepts the new OCR proof leaf metadata.
- [ ] Worker rejects malformed OCR/image proof manifests.
- [*] Receipt rendering supports OCR proof coverage.
- [*] Result package rendering supports OCR/image match/no-match outcomes.
- [ ] Protocol docs cover OCR/image leaf metadata and result semantics.

## Automated QA

- [*] Smoke test covers scanned PDF OCR content match.
- [*] Smoke test covers scanned PDF OCR content no-match.
- [*] Smoke test covers exact image match.
- [*] Smoke test covers exact image no-match.
- [*] Unit tests cover OCR metadata formatting.
- [*] Unit tests cover image hash method/version labeling.

## Human QA

- [*] Human QA checklist created for V3.
- [*] Native text PDF still works after OCR changes.
- [*] Scanned PDF with clean text produces OCR coverage.
- [*] Scanned PDF with low-quality text shows confidence warning.
- [*] Scanned PDF passage match works.
- [*] Scanned PDF unrelated passage no-match works.
- [*] PNG exact image match works.
- [*] JPEG exact image match works.
- [*] Unrelated image no-match works.
- [*] Public result page and PDF language are clear for OCR/image outcomes.
- [*] Revoked verifier access blocks new OCR/image lookups.
- [*] Previously issued public verification artifacts behave as documented.

## Release Hardening

- [*] `docs/v3-known-limitations.md` created.
- [*] V3 known limitations accepted before release.
- [*] V3 human QA checklist completed.
- [*] V3 release notes created.
- [*] V3 tag and GitHub release created.

## Out Of Scope For V3

- [x] Commercial API platform deferred to future product backlog.
- [x] Webhooks deferred to future product backlog.
- [x] SDKs and CLI deferred to future product backlog.
- [x] Browser extensions and CMS plugins deferred to future product backlog.
- [x] Semantic similarity and paraphrase claims excluded from V3.
- [x] Authorship, originality, copyright, and AI-generation claims excluded from
  V3.
- [x] Perceptual image similarity deferred to `docs/future-product-backlog.md`.
