# Proveria Shingling V1

> Cross-reference: [docs/v1](../../v1) §12.3 (shingling), §13 (manifest), §26.3 (spec process). Builds on [protocol-v1.md](protocol-v1.md).

## Status

Draft v0.1 — internal sign-off pending; external cryptographic review pending. Implementation under M10 must hold to the byte-level definitions in this document; any deviation requires a spec amendment.

## Owner

Engineering

## Reviewers

Product / Architecture
External cryptographic reviewer (per docs/v1 §26.3)

## Purpose

Define how text content is normalized, tokenized, shingled, hashed, and represented in Proveria V1 attestations.

This spec gates Milestone 10.

## Goals

- Define text normalization (deterministic, byte-level).
- Define tokenization (deterministic).
- Define shingle presets (concrete window/stride values).
- Define paragraph behavior.
- Define PDF text extraction ordering assumptions.
- Define shingle hash construction (binary, length-prefixed).
- Provide structured reference test vectors.

## Non-Goals

- Define OCR engine behavior — see [ocr-v1.md](ocr-v1.md).
- Define semantic similarity.
- Define perceptual hashing.
- Define browser-based shingling.

---

## 1. Version identifiers

| Field | Meaning | V1 value |
| ----- | ------- | -------- |
| `shingling_version` | This document's version. | `"1.0"` |
| `normalization_version` | Normalization rules (§3). | `"1.0"` |
| `tokenizer_version` | Tokenization rules (§4). | `"1.0"` |
| `preset` | Shingle preset slug (§5). | `"standard" \| "broad" \| "sensitive"` |
| `source_extraction_method` | How the text was obtained from the source (§7). | `"plain-text/v1" \| "pdf-text-layer/v1" \| "ocr-tesseract/v1"` |

All values are strings. No floats. No nulls.

---

## 2. Supported Inputs

V1 supports shingling for:

- plain text (UTF-8)
- native text extracted from PDFs (text-layer)
- OCR-derived text from scanned PDFs (M11)

Shingling is a Team/Enterprise feature. Free tenants MUST NOT generate shingle leaves.

Plaintext (raw, normalized, or windowed) never leaves the desktop. Only the binary canonical-shingle-payload hash crosses the network.

---

## 3. Normalization (`normalization_version = "1.0"`)

Apply in the listed order. The output is a single UTF-8 string with paragraph markers preserved as `"\n\n"` and intra-paragraph runs of whitespace collapsed to a single space.

1. **Unicode NFC** — normalize to NFC canonical composition. Do NOT use NFKC — preserves visually-distinct codepoints (NFKC mutates legible text).
2. **Lowercase** — `String.prototype.toLowerCase()` after NFC. Locale-independent (no Turkish-i edge case in V1 since we're English-first; future amendment may extend).
3. **Smart punctuation → ASCII equivalents**:
   - `’ ‘` (U+2019, U+2018) → `'`
   - `“ ”` (U+201C, U+201D) → `"`
   - `– —` (U+2013, U+2014) → `-`
   - `…` (U+2026) → `...`
4. **Ligature decomposition**: `ﬁ ﬂ ﬀ ﬃ ﬄ` (U+FB00..U+FB04) → `fi`, `fl`, `ff`, `ffi`, `ffl`. (Same set NFKC would expand but applied independently of the NFC choice above.)
5. **Soft hyphen removal**: `­` (U+00AD) → removed (zero-width).
6. **De-hyphenate line-broken words**: any occurrence of `-\n` (hyphen + newline, possibly with trailing spaces) → joined to nothing, then continue normalizing.
7. **Form feed / page break** (`\f`, U+000C) → treated as a paragraph boundary (becomes `\n\n`).
8. **Paragraph boundaries**: any sequence of two-or-more line breaks (after step 6) → collapse to exactly `"\n\n"`.
9. **Whitespace collapse within paragraphs**: within a paragraph, any run of whitespace characters (space, tab, single newline, other Unicode whitespace) → single space ` `.
10. **Punctuation → space**: every ASCII punctuation character `[!"#$%&'()*+,./:;<=>?@\[\\\]^_\`{|}~]` (i.e. printable ASCII excluding letters / digits / hyphen and excluding paragraph marker) is replaced with a single space. The hyphen `-` is preserved so compound words ("well-known") survive.
11. **Whitespace collapse pass 2**: re-collapse runs of spaces produced by step 10. Trim leading + trailing spaces inside each paragraph.
12. **Trim leading + trailing paragraph boundaries** from the whole document.

Result: a UTF-8 string of one-or-more paragraphs separated by `"\n\n"`, each paragraph being non-empty lowercase tokens separated by single spaces.

---

## 4. Tokenization (`tokenizer_version = "1.0"`)

After normalization:

- Split each paragraph on the single ASCII space ` `.
- A token is a non-empty substring.
- Minimum token length: 1 (no filtering on length).
- Numeric tokens are kept as-is.
- Tokens may contain hyphens (compound words).
- Language assumption: English-first.

---

## 5. Shingle Presets

A shingle is an ordered list of `window` consecutive tokens drawn from a single paragraph. Window position advances by `stride`. The shingle's text representation is the tokens joined with a single ASCII space.

| Preset      | Window | Stride | Intended use            |
| ----------- | -----: | -----: | ----------------------- |
| `standard`  |      7 |      1 | balanced default        |
| `broad`     |     12 |      3 | looser matching         |
| `sensitive` |      4 |      1 | more granular detection |

Paragraph boundary behavior: **shingles do not cross paragraphs**. Each paragraph is shingled independently. A paragraph with fewer than `window` tokens contributes no shingles for that preset.

Minimum document length: if no paragraph in the document has ≥ `window` tokens, the document contributes zero shingle leaves for that preset. (A file leaf may still be emitted independently.)

Duplicate shingles: the spec does NOT deduplicate at the shingle layer. The Merkle tree layer (Protocol V1 §6.4) rejects duplicate leaf hashes — so two paragraphs that yield identical shingle text + context will collide at tree construction and the manifest will be rejected. Producers SHOULD dedupe identical shingles before building leaves, but the canonical algorithm does not.

---

## 6. Canonical Shingle Payload (binary)

For each shingle, the canonical payload is constructed as:

```
shingle_payload =
    0x02                                     (1 byte, domain separator for shingles)
 || length_prefix(shingling_version_utf8)
 || shingling_version_utf8
 || length_prefix(preset_utf8)
 || preset_utf8
 || length_prefix(normalization_version_utf8)
 || normalization_version_utf8
 || length_prefix(tokenizer_version_utf8)
 || tokenizer_version_utf8
 || length_prefix(source_extraction_method_utf8)
 || source_extraction_method_utf8
 || length_prefix(window_text_utf8)
 || window_text_utf8
```

Where:

- `0x02` is the shingle domain separator (distinct from leaves' `0x00` and internal nodes' `0x01` from Protocol V1 §4.1, §6.3).
- `length_prefix(x)` is a 4-byte big-endian unsigned integer giving the byte length of `x`.
- `window_text_utf8` is the UTF-8 encoding of the `window` normalized tokens joined by a single ASCII space (`" "`).

Then:

```
canonical_payload_hash = SHA-256(shingle_payload)        (32 bytes)
```

This is the value that feeds into the standard Protocol V1 §4.1 leaf hash input as `canonical_payload_hash_bytes` with `leaf_type = "shingle/sha256/v1"`:

```
leaf_hash_input =
    0x00
 || lp("1.0")              (protocol_version)
 || lp("shingle/sha256/v1") (leaf_type)
 || lp("sha256")             (hash_algorithm)
 || lp(canonical_payload_hash_bytes)
 || canonical_payload_hash_bytes

leaf_hash = SHA-256(leaf_hash_input)
```

The domain separator `0x02` inside the shingle payload is independent of the `0x00` outside — a leaf hash input always starts with `0x00`. The `0x02` only ensures the shingle payload structure cannot collide with raw file bytes.

---

## 7. Source extraction methods

| `source_extraction_method` | Source | Notes |
| -------------------------- | ------ | ----- |
| `plain-text/v1` | A plain UTF-8 text file. | Whole file is the input string. |
| `pdf-text-layer/v1` | Native text layer of a PDF, extracted via `pdfjs-dist` (Mozilla). | Pages concatenated in page-number order, separated by `\f` (form feed → paragraph boundary in §3 step 7). Column ordering follows pdf.js's natural text-extraction order — multi-column layouts may produce surprising shingles; see §8. |
| `ocr-tesseract/v1` | OCR-derived text from a scanned PDF (M11). The `v1` covers a pinned Tesseract engine + language-pack combination — see `ocr-v1.md`. | Engine-pinned tag so the canonical shingle bytes change if the OCR engine changes (different OCR → different output text → matches would break anyway; the tag makes the contract explicit). |

---

## 8. PDF Text Extraction Rules

- Library: `pdfjs-dist` (Mozilla).
- Page ordering: ascending page number, no skipping.
- Inter-page separator: form feed `\f` (becomes a paragraph boundary per §3 step 7).
- Column ordering: pdf.js's default text-content order. V1 does NOT attempt column detection.
- Tables: extracted as flattened text rows; cell ordering follows pdf.js's order. Tables are an explicit ambiguity case.
- Layout warnings: extraction metadata SHOULD record `{"pdfjs_version": "...", "extraction_warnings": []}` so verifiers can interpret edge cases.

**Required caveat**: PDF layout ambiguity can affect shingle generation. Producers and verifiers MUST use the same extraction library and version for compatible matching.

---

## 9. Manifest representation

Shingle leaves appear in `manifest.leaf_set` with the same shape as file leaves (Protocol V1 §7.2):

```json
{
  "leaf_type": "shingle/sha256/v1",
  "leaf_hash": "<64-char hex>",
  "canonical_payload_hash": "<64-char hex>",
  "metadata": {
    "preset": "standard",
    "source_extraction_method": "pdf-text-layer/v1",
    "source_index": 0
  }
}
```

`source_index` is the 0-indexed position of the shingle within its source document (after normalization + tokenization + windowing). It is **plaintext-safe**: it leaks no content, only position.

The manifest's `shingling_version` (§1) field MUST equal `"1.0"` when any leaf is `shingle/sha256/v1`; null otherwise.

The manifest's `extraction_metadata` SHOULD include per-source records like:

```json
{
  "<source-id>": {
    "method": "pdf-text-layer/v1",
    "pdfjs_version": "5.x.x",
    "page_count": 14,
    "token_count": 4283,
    "extraction_warnings": []
  }
}
```

Plaintext shingle content MUST NOT appear anywhere in the manifest or in object storage.

---

## 10. Consumer hash utility compatibility

The Hash CLI (Milestone 14) MUST implement §3–§6 verbatim and emit identical `canonical_payload_hash` bytes for the same input text + preset + extraction method. The CLI is the consumer-side reference implementation.

---

## 11. Test vectors

Reference vectors live under [test-vectors/](test-vectors/). The implementation in `@proveria/shingling` (M10 / C37) generates them; the spec defines the algorithms precisely enough that a second implementation can derive identical bytes.

| Vector file | Covers |
| ----------- | ------ |
| `test-vectors/shingling-normalize.json` | raw input → normalized output (§3). |
| `test-vectors/shingling-tokenize.json` | normalized text → token list (§4). |
| `test-vectors/shingling-windows.json` | token list + preset → ordered window text list (§5). |
| `test-vectors/shingling-hash.json` | window text + context → canonical_payload_hash → leaf_hash (§6). |

Each vector file follows the same `{ spec, vectorCategory, version, specSection, description, vectors[] }` shape as the protocol-v1 vectors.

### 11.1 Worked example — a one-paragraph plain-text input

Input (UTF-8, raw):

```
The quick brown fox jumps over the lazy dog. The dog barks.
```

§3 normalization, in order:

- NFC: no change.
- Lowercase: `the quick brown fox jumps over the lazy dog. the dog barks.`
- Smart punctuation: no change.
- Ligatures, soft hyphens, de-hyphenation, form feeds: no change.
- Paragraph boundaries: only one paragraph (no `\n\n`).
- Whitespace collapse: no change.
- Punctuation → space: `.` → ` `, then collapse, then trim → `the quick brown fox jumps over the lazy dog the dog barks`

§4 tokenization: `["the","quick","brown","fox","jumps","over","the","lazy","dog","the","dog","barks"]` (12 tokens).

§5 with preset `standard` (window=7, stride=1) → 6 windows:

```
window 0: "the quick brown fox jumps over the"
window 1: "quick brown fox jumps over the lazy"
window 2: "brown fox jumps over the lazy dog"
window 3: "fox jumps over the lazy dog the"
window 4: "jumps over the lazy dog the dog"
window 5: "over the lazy dog the dog barks"
```

§6 canonical_payload_hash for window 0, with `source_extraction_method = "plain-text/v1"`:

```
shingle_payload =
   02
   00000003 312e30                          (shingling_version "1.0")
   00000008 7374616e64617264                (preset "standard")
   00000003 312e30                          (normalization_version "1.0")
   00000003 312e30                          (tokenizer_version "1.0")
   0000000d 706c61696e2d746578742f7631     (source_extraction_method "plain-text/v1", 13 bytes)
   00000022 "the quick brown fox jumps over the"   (window_text, 34 bytes)

canonical_payload_hash = SHA-256(shingle_payload)
```

Concrete bytes for this example land in `test-vectors/shingling-hash.json` (committed alongside the implementation).

---

## 12. Open questions deferred

- Multi-language tokenization (Chinese / Japanese / etc.) — V1 is English-first.
- Column detection / table parsing in PDFs — V1 accepts pdf.js order with caveats.
- Browser-based shingling — out of scope for V1.

---

## 13. Approval checklist

- [ ] Engineering review complete
- [ ] Product / Architecture review complete
- [ ] Reference implementation in `@proveria/shingling` produces matching test vectors
- [ ] Test vectors committed under [test-vectors/](test-vectors/)
- [ ] External cryptographic review complete
- [ ] Review findings resolved
- [ ] Approved for Milestone 10
