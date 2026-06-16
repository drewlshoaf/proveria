# Proveria V3 Roadmap

V2 proved deterministic text content without uploading plaintext. V3 expands
evidence coverage to scanned documents and exact image hashes while preserving
the same careful claim language: Proveria proves committed evidence-derived
hashes, not broad truth, authorship, visual similarity, or semantic meaning.

## Product Thesis

V3 is the image and OCR evidence release.

Producers should be able to attest scanned PDFs, image files, and screenshots
with useful local proof coverage. Verifiers should be able to check OCR-derived
text passages and exact PNG/JPEG image hashes without sending source content to
the server. Receipts and result packages must explain exactly which proof type
was used and how narrow the claim is.

## In Scope

### 1. OCR-Derived Text Proofs

- Add producer-side OCR extraction for scanned PDFs.
- Feed OCR text into the existing text-content proof pipeline.
- Preserve the V2 privacy boundary: extracted text stays local.
- Submit only whole-file hashes, OCR-derived content proof hashes, confidence
  metadata, and plaintext-safe extraction metadata.
- Surface OCR coverage before submission and on Attestation Detail.
- Distinguish native text extraction from OCR extraction in receipts, PDFs,
  public pages, verifier lookup, and audit/event language.

Recommended starting point: implement the existing protocol direction in
`docs/protocol/v1/ocr-v1.md`, but review it before coding because the current
desktop app and V2 content-proof UX have moved forward since that spec was
written.

### 2. Image Proofs

- Add local whole-image SHA-256 coverage for image files.
- Support exact image proof for common image formats:
  - PNG
  - JPEG
- Store image proof hashes as committed leaves with explicit method/version
  metadata.
- Clearly label image proof results as exact image matches, not visual
  similarity claims.

### 3. Verifier Image Lookup

- Let verifiers choose an image file locally in the browser.
- Compute exact image SHA-256 locally.
- Submit only generated hashes/candidates to the lookup endpoint.
- Return one of:
  - exact image match
  - no image match
  - unsupported image
- Keep result language conservative and explain that exact image proof is
  byte-for-byte matching, not visual similarity.

### 4. Receipt And Result Artifacts

- Extend receipt JSON/PDF coverage language:
  - whole-file hash
  - native text content proof
  - OCR text content proof
  - exact image hash
- Extend public result pages and PDFs for OCR/image lookup outcomes.
- Include method/version labels for OCR and image proof algorithms.
- Include OCR confidence metadata where available.
- Avoid including extracted text, image previews, thumbnails, or source pixels
  in public artifacts unless explicitly reviewed later.

### 5. Desktop UX

- Show coverage preview per selected file:
  - whole-file hash
  - native text coverage
  - OCR text coverage
  - exact image coverage
  - warnings and unsupported reasons
- Make low-confidence OCR visible without blocking submission.
- Keep the attestation detail layout simple:
  - summary says what coverage exists
  - Records carries proof/receipt metadata
  - Verifications carries grants/lookups
  - Events carries audit history

## Out Of Scope

### Commercial API Platform

Commercial APIs, webhooks, SDKs, CLI, browser extensions, CMS plugins, and
enterprise integration drivers remain in `docs/future-product-backlog.md`.

Reasoning: those are platform expansion tracks. V3 should stay focused on
evidence coverage so its proof semantics can be reviewed and QA'd without
dragging in a second product launch.

### Semantic Similarity

V3 does not prove paraphrase, meaning, authorship, AI generation, originality,
or copyright ownership.

Semantic similarity may become a later research/product track, but it should
not be mixed with deterministic OCR and image proof claims.

### Perceptual Image Similarity

Perceptual hashes and visual similarity are deferred to
`docs/future-product-backlog.md`.

Reasoning: exact image proof is deterministic and QA-passed. Visual similarity
requires separate threshold policy, fixture testing, and careful public result
language before it should appear in the product.

### Manual Text Or OCR Editing

V3 should not let producers manually edit extracted OCR text before proof
generation. If editable OCR is ever allowed, the receipt must identify it as
producer-provided text, not re-derived OCR text.

## Recommended Delivery Order

### Slice 1: OCR Foundation

- Review and update `docs/protocol/v1/ocr-v1.md` for current V3 naming.
- Choose OCR engine/package path for desktop.
- Add a local OCR extraction module with deterministic method/version metadata.
- Generate OCR-derived text content proof hashes for scanned PDFs.
- Show OCR preview metadata before submission.
- Add receipt/result coverage labels for OCR.

### Slice 2: OCR Verification

- Let verifier passage hashing match OCR-derived content proof leaves.
- Make match/no-match language distinguish native text from OCR-derived text.
- Add public result and PDF artifact wording for OCR-derived content matches.
- Add focused smoke tests with a small scanned PDF fixture.

### Slice 3: Exact Image Proof

- Add image file support for local SHA-256 and image metadata extraction.
- Commit exact image proof leaves with method/version labels.
- Show exact image coverage in desktop and receipts.
- Let verifier image upload check exact image hash matches.

### Slice 4: Release Hardening

- Build V3 human QA checklist. Current focused checklist:
  `docs/human_qa_v3.md`.
- Build focused smoke tests for OCR, exact image match, and no-match scenarios.
- Document known limitations in `docs/v3-known-limitations.md`.
- Record release acceptance in `docs/v3-qa-signoff.md`.
- Update release notes and protocol docs.

## First Product Decisions

- V3 is OCR plus image evidence, not the commercial API/platform release.
- OCR text stays local and feeds the existing content-proof model.
- Use the existing `@proveria/ocr` Tesseract.js/WASM path for the first OCR
  implementation slice, unless packaging tests expose a blocker.
- OCR should run automatically as a fallback when native PDF text is
  insufficient, not as a producer-facing mode switch in the first slice.
- Build scanned PDF OCR before standalone image proof so V3 extends the V2
  text-content proof model.
- Image proof language must describe exact hash matches only.
- Perceptual image similarity is backlogged until threshold policy and public
  language are ready.

## Open Product Questions

- How should result packages phrase low-confidence OCR?
- What additional OCR languages should be supported after English?
- Which exact image formats should be added after PNG/JPEG?

## First Code Slice

The first implementation slice should be deliberately narrow: scanned PDF OCR
content proof in desktop submissions.

Expected code path:

1. Extend the renderer content-proof type to allow `ocr-tesseract/v1`.
2. Detect PDFs with insufficient native text using the token threshold in
   `@proveria/ocr`.
3. Render PDF pages locally and run OCR through `@proveria/ocr`.
4. Generate text-content proof hashes from OCR text with
   `source_extraction_method = "ocr-tesseract/v1"`.
5. Pass OCR confidence/page metadata through the desktop RPC payload.
6. Let the desktop RPC validator accept `ocr-tesseract/v1`.
7. Set `source_summary.ocr_page_count` and extraction metadata in the manifest.
8. Update desktop preview and Attestation Detail labels for OCR coverage.

This first slice intentionally did not include verifier image lookup,
perceptual hashes, or standalone image proof.
