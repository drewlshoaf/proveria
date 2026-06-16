# Proveria OCR V1

> Cross-reference: [docs/v1](../../v1) §12.4 (OCR). Builds on [shingling-v1.md](shingling-v1.md).

## Status

**Locked for V1.** Engineering implements against this spec for Milestone 11.

## Owner

Joint: Engineering + Product / Architecture

## Purpose

Define the OCR engine, packaging, metadata, confidence handling, and failure semantics that produce shingleable text from scanned PDFs on the producer machine. Plaintext never leaves the desktop; only canonical shingle payload hashes (per `shingling-v1.md` §6) cross the network.

This spec gates Milestone 11.

## Goals

- Lock the V1 engine and packaging path so M11 ships without a separate spike.
- Define the exact `source_extraction_method` tag for OCR shingles so canonical bytes are deterministic.
- Define manifest-level OCR extraction metadata.
- Define confidence handling, failure behavior, and the receipt-side language that distinguishes OCR-derived coverage from native-text coverage.

## Non-Goals

- Define the shingling algorithm. That is `shingling-v1.md`; OCR feeds plaintext into that pipeline unchanged.
- Define semantic interpretation of OCR output.
- Guarantee handwritten OCR accuracy (Tesseract handles handwriting poorly; treat as low-confidence).
- Support non-English languages in V1. Additional language packs are post-V1.
- Allow manual OCR text editing in V1 — the consumer must be able to re-derive identical text from the same scan.

## 1. Engine

V1 engine: **Tesseract**, via the `tesseract.js` npm package (Tesseract compiled to WebAssembly).

Rationale for WASM over a native binary:
- No per-platform binary to ship (macOS universal / Windows x64 / Windows arm64) → no impact on code signing or notarization.
- No installer-size regression — the WASM core and language pack are fetched once and cached locally.
- Distribution risk is the load-bearing concern in `docs/v1` §12.4; WASM removes it entirely for V1.
- Performance is acceptable for V1 corpora (single-document submissions, not gigabyte archives).

If native packaging becomes attractive post-V1 (e.g., for very large corpora), it is an additive `source_extraction_method` value, not a replacement — older OCR shingles remain `ocr-tesseract/v1`.

## 2. Version pinning

| Field | V1 value | Notes |
| ----- | -------- | ----- |
| `ocr_extraction_version` | `"1.0"` | Manifest top-level field (`docs/v1` §13). Bumped only when this spec changes. |
| `ocr_engine` | `"tesseract"` | Manifest extraction metadata. |
| `ocr_engine_version` | The `tesseract.js` package version actually loaded at extraction time, e.g. `"5.1.1"`. | Pinned per desktop release. Recorded verbatim. |
| `ocr_language_pack` | `"eng"` | V1 default. |
| `ocr_language_pack_version` | The traineddata file's identifier from `tessdata_fast` (e.g. `"4.1.0"`), recorded verbatim. | Bundled, not downloaded at extraction time. |
| `source_extraction_method` | `"ocr-tesseract/v1"` | The string baked into every OCR-derived shingle's canonical payload (see `shingling-v1.md` §6). The `v1` covers the engine + language-pack combination above. |

## 3. When OCR runs

OCR is the fallback for PDFs whose native text layer is empty or unusable. The producer pipeline for a PDF is:

1. Attempt `pdfjs-dist` text-layer extraction (current `pdf-text-layer/v1` path).
2. If the extracted text after normalization (`shingling-v1.md` §3) contains **fewer than 50 tokens total across all pages**, treat the PDF as scanned and run OCR.
3. OCR runs page-by-page. For each page:
   - Render the page to a raster image via `pdfjs-dist` (`getViewport({ scale: 2 })` for ~144 DPI equivalent).
   - Pass the image bitmap to `tesseract.js` with `lang: 'eng'`.
   - Collect extracted text and per-word confidence scores.
4. Concatenate page text in page-number order, separated by `\f` (form feed → paragraph boundary per `shingling-v1.md` §3 step 7).
5. Feed the concatenated text into the normal shingling pipeline with `source_extraction_method = "ocr-tesseract/v1"`.

A PDF can produce both `pdf-text-layer/v1` shingles (from one set of pages with native text) and `ocr-tesseract/v1` shingles (from scanned pages) in V1 only if Engineering opts into mixed-mode extraction. For M11, the choice is **all-or-nothing per PDF** to keep the metadata simple — either every page goes through OCR or none do.

## 4. Confidence handling

For each page, compute `page_confidence = mean(word_confidence)` over all detected words on that page. Tesseract emits per-word confidences in `0..100`.

- A page is **low-confidence** if `page_confidence < 80`.
- A document is **low-confidence** if any page is low-confidence.
- A page with zero detected words yields `page_confidence = 0` and is treated as low-confidence.

Low confidence does NOT block submission. The desktop surfaces a warning to the producer; the manifest records the count of low-confidence pages so the receipt can disclose it.

## 5. Manifest metadata

OCR-extracted PDFs add fields to `extraction_metadata[src_<8-byte file hash hex>]`:

```json
{
  "method": "ocr-tesseract/v1",
  "engine": "tesseract",
  "engine_version": "5.1.1",
  "language_pack": "eng",
  "language_pack_version": "4.1.0",
  "page_count": 7,
  "ocr_page_count": 7,
  "native_text_page_count": 0,
  "low_confidence_page_count": 1,
  "failed_page_count": 0,
  "mean_confidence": 87.4,
  "paragraph_count": 7,
  "token_count": 412,
  "shingle_count": 406,
  "warnings": []
}
```

And the manifest's top-level `source_summary.ocr_page_count` (already in the schema, `docs/v1` §13) is the document-wide sum.

`mean_confidence` is the unweighted arithmetic mean of page confidences, rounded to one decimal place. It is plaintext-safe (no source content leakage).

## 6. Failure behavior

| Scenario | Producer-side behavior | Manifest |
| -------- | --------------------- | -------- |
| Native text layer is sufficient (≥50 tokens) | OCR not invoked. | `pdf-text-layer/v1` shingles only. |
| OCR succeeds on every page | Shingles generated normally. | `ocr-tesseract/v1` shingles, `failed_page_count = 0`. |
| OCR fails on some pages | Skip those pages; continue. | `failed_page_count > 0`; failed pages are NOT shingled. Whole-file leaf still included. |
| OCR fails on every page | No shingle leaves emitted for this file. | Whole-file leaf only. `extraction_metadata` records the failure with `shingle_count = 0`. |
| Whole-file hash fails | File excluded from the attestation. | N/A. |
| Low confidence | Producer is warned but may continue. | `low_confidence_page_count > 0`; no other behavioral change. |
| Tesseract.js initialization fails (e.g., WASM load) | OCR not invoked. | Whole-file leaf only. `extraction_metadata` records `{"method": "ocr-tesseract/v1", "warnings": ["engine_init_failed"]}`. |

## 7. Local preview

The desktop submit UI MUST surface, before the producer confirms submission:

- the extraction method actually used (`pdf-text-layer/v1` vs `ocr-tesseract/v1`)
- the `mean_confidence` if OCR ran
- the count of low-confidence pages, if any
- the per-file shingle count

The extracted text itself is NOT shown in V1 (avoids encouraging manual edits). M14+ may add a read-only preview.

## 8. Receipt language

The attestation receipt (`docs/v1` §18, `packages/receipt`) MUST distinguish the three shingle coverage modes:

| Receipt label | Source extraction methods present |
| ------------- | --------------------------------- |
| "Whole-file only" | No shingle leaves. |
| "Native text shingles" | At least one `pdf-text-layer/v1` or `plain-text/v1` shingle; no OCR shingles. |
| "OCR-derived shingles" | At least one `ocr-tesseract/v1` shingle. (May coexist with native-text shingles in mixed corpora.) |

The portal pre-lookup metadata (`apps/portal/app/lookups/[attestationId]/page.tsx`) surfaces the same distinction via the existing `coverageType` field — extending its vocabulary, not adding a new field.

## 9. Plaintext discipline

- Extracted OCR text is treated identically to native text: it lives in process memory long enough to be normalized, tokenized, and hashed, and is then dropped.
- Extracted text is **never** written to disk on the producer machine.
- Extracted text is **never** included in the manifest, in `extraction_metadata`, or in any network payload.
- The page-level confidence numbers are the only OCR-derived signals that leave the desktop, and they are plaintext-safe.

## 10. Server / validator changes

None. The server treats `ocr-tesseract/v1` exactly like `pdf-text-layer/v1`:

- `packages/manifest`'s validator does not enumerate `source_extraction_method` values; it carries the field through as part of the canonical leaf metadata.
- The shingling plan-gate (`apps/worker/src/handlers/attestation-validation.ts` §3b) continues to reject any shingle leaves from Free tenants regardless of extraction method.
- `extraction_metadata` is a free-form `Record<string, unknown>`, so the new OCR fields fit without a schema bump.

## 11. Test vectors

OCR output itself is not deterministic across image-rendering implementations and is not pinned by a test vector. What IS pinned:

- The `source_extraction_method = "ocr-tesseract/v1"` string is 16 UTF-8 bytes, contributing the length prefix `0x00000010` followed by the byte sequence `6f 63 72 2d 74 65 73 73 65 72 61 63 74 2f 76 31` to the canonical shingle payload (`shingling-v1.md` §6). A unit test in `@proveria/shingling` MUST verify this byte layout end-to-end against a hand-computed expected hash so future drift in the string fails the test rather than silently changing the wire format.
- Sample manifest `extraction_metadata` payloads (success, low-confidence, partial failure, total failure) live as fixtures in `packages/ocr/src/__fixtures__/`.

## 12. Test corpus

Engineering assembles a public, non-sensitive corpus per `docs/v1` §12.4:

- legal (scanned contracts)
- research (scanned papers)
- business docs (invoices, memos)
- media/archive (mixed-layout, image-heavy)
- low quality (skewed, low contrast, rotated)
- native text (text-layer PDFs — extraction comparison baseline)

No customer or private documents enter the corpus unless explicitly approved and sanitized.

## Approval Checklist

- [x] Spike complete — Tesseract.js / WASM selected for V1 (avoids native packaging spike)
- [x] Engine/package decision made
- [x] Metadata schema approved
- [x] Failure behavior approved
- [x] Product / Architecture review complete
- [x] Approved for Milestone 11
