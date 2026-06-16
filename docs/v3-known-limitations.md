# V3 Known Limitations

Use this companion note while V3 image and OCR evidence is still hardening.
V3 keeps the established privacy boundary: source text, source images, source
pixels, and OCR text stay local. Proveria stores cryptographic hashes,
manifests, signatures, receipts, and metadata safe for public verification.

## OCR Scope

- OCR content proof is deterministic text matching after local OCR extraction,
  not semantic similarity.
- OCR quality depends on scan quality, page orientation, contrast, language,
  and Tesseract extraction behavior. Low-confidence OCR can reduce match
  reliability.
- OCR text is not uploaded, stored in receipts, or exposed in public artifacts.
  Public artifacts may identify OCR coverage and method metadata only.
- Short passages can fail to generate content proof hashes. Use at least seven
  words from one continuous passage; a full sentence or paragraph is better.
- OCR no-match is scoped to the specific attestation and lookup time. It does
  not prove that text is absent from other attestations, other projects, or
  material the producer never committed.

## Exact Image Scope

- Exact image proof is byte-for-byte SHA-256 matching for PNG and JPEG files.
- An exact image match means the verifier's locally hashed image bytes matched
  an exact image proof hash committed by the producer.
- Exact image proof does not mean visual similarity. Resized, recompressed,
  cropped, color-adjusted, metadata-stripped, or format-converted images can
  fail exact matching even when they look the same to a human.
- Exact image no-match is scoped to the specific attestation and lookup time.
  It does not claim the image is absent from other attestations, other projects,
  or material the producer never committed.
- Perceptual image similarity is intentionally separate from exact image proof
  and is tracked in `docs/future-product-backlog.md` until threshold policy,
  fixture testing, and wording are ready.

## Public Artifacts

- Public verification links are historical result artifacts. Revoking verifier
  access blocks new private lookups, but previously issued public verification
  pages and PDFs may continue to verify.
- Receipt pages describe attestation coverage. Result pages describe a specific
  verifier lookup result. These are intentionally different artifacts.
- Receipts and result packages include proof metadata and hashes, but never
  include source passages, OCR text, or source image bytes.

## Operational Notes

- Producers should restart desktop, API, worker, and verifier after pulling V3
  changes during local QA, especially when switching branches.
- The worker must be running before testing confirmation, receipts, public PDFs,
  or result PDFs.
- OCR can take longer than native text extraction. A progress pause during OCR
  or worker confirmation is expected as long as the job completes.
