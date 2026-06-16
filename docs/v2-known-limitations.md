# V2 Known Limitations

Use this companion note while V2 content proof work is still hardening. V2 keeps
the V1 privacy boundary: source text stays local, and only whole-file hashes,
content-proof hashes, and plaintext-safe metadata are submitted.

## Content Proof Scope

- V2 content proof is deterministic text matching, not semantic similarity.
- Native PDF text matching depends on browser/pdf.js text extraction order.
  Multi-column layouts, headers, footers, and copied fragments can change the
  exact shingle boundaries.
- Short passages can fail to generate a content proof hash. Use at least seven
  words from one continuous passage; a full sentence or paragraph is better.
- Scanned PDFs and OCR-derived shingles remain outside the current V2 QA gate.
- Images, visual similarity, and perceptual hashes are V3.

## Verification Semantics

- A content match means at least one locally generated passage shingle hash was
  present in the committed attestation leaf set.
- A content no-match is scoped to the specific attestation and lookup time. It
  does not claim the text is absent from other projects, other attestations, or
  material the producer never committed.
- Public verification links remain historical artifacts. Revoking verifier
  access blocks new lookups, but already issued public verification pages may
  continue to verify.

## Operational Notes

- Producers should restart desktop/API/worker/verifier after pulling V2 changes
  during local QA, especially when switching branches.
- `pnpm smoke:pdf-text-layer` is the focused local smoke for native PDF text
  coverage, receipt metadata, verifier content match, verifier content no-match,
  and public verification links.
