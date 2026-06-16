# V3 Remaining Human QA Checklist

Use this for the final manual V3 OCR and exact-image pass. Record tester name,
date, environment, browser, desktop OS, branch or commit, and issue links for
failed items.

## Setup

- [*] Pull latest V3 branch or `main` after merge.
- [*] Start local infra, API, worker, desktop, and verifier from `docs/getting-started.md`.
- [*] Run `pnpm eval:seed`.
- [*] Confirm desktop opens.
- [*] Confirm verifier loads at `http://127.0.0.1:3003`.
- [*] Confirm API health is available at `http://127.0.0.1:3001/healthz`.
- [*] Confirm the worker is running before testing confirmation, receipts, or PDFs.

## Producer OCR

- [*] Sign in to desktop as `producer-eval@example.com`.
- [*] Submit a scanned or unselectable-text PDF.
- [*] Confirm desktop preview shows OCR content coverage before submission.
- [*] Confirm OCR confidence and any low-confidence warnings are understandable.
- [*] Submit the OCR attestation.
- [*] Confirm the attestation status updates until confirmed.
- [*] Open Attestation Detail.
- [*] Confirm the summary distinguishes OCR content coverage from whole-file coverage.
- [*] Open Records and confirm OCR extraction metadata appears without source OCR text.
- [*] Open the public receipt page and confirm OCR coverage language is clear.
- [*] Open/download the receipt PDF and confirm OCR coverage language is clear.

## Verifier OCR

- [*] Grant `verifier-eval@example.com` access to the OCR attestation.
- [*] Open the private verifier lookup link.
- [*] Sign in as `verifier-eval@example.com` if prompted.
- [*] Choose `Hash passage`.
- [*] Paste a matching passage from the scanned PDF and verify it matches.
- [*] Confirm the result says `OCR content match found`.
- [*] Confirm the result explains the source passage itself is not included.
- [*] Paste a clearly unrelated passage and confirm no-match language is scoped and understandable.
- [*] Paste fewer than 7 words and confirm the verifier explains that more text is needed.
- [*] Open the public result page for the OCR match and confirm it says `OCR content match`.
- [*] Download/open the OCR result PDF and confirm it says `OCR content match` and `OCR text content proof`.

## Producer Exact Image

- [*] Submit a PNG file.
- [*] Confirm desktop preview shows `Exact image proof`, `Exact image SHA-256`, and `PNG`.
- [*] Submit the PNG attestation and wait for confirmation.
- [*] Open Attestation Detail and confirm coverage says exact image proof.
- [*] Open the public receipt page and confirm coverage says `exact image proof hash`.
- [*] Download/open the receipt PDF and confirm it says `Exact image SHA-256`.
- [*] Repeat the same producer flow with a JPG or JPEG file and confirm `JPEG` appears where expected.

## Verifier Exact Image

- [*] Grant `verifier-eval@example.com` access to the confirmed PNG/JPEG attestation.
- [*] Open the private verifier lookup link.
- [*] Sign in as `verifier-eval@example.com` if prompted.
- [*] Choose `Choose image`.
- [*] Upload the same PNG/JPEG and verify it matches.
- [*] Confirm the result says `Exact image match found`.
- [*] Confirm the result labels the proof as `Exact image proof`.
- [*] Open the public result page and confirm it says `Exact image match`.
- [*] Download/open the result PDF and confirm it says `Exact image match`, `Matched exact image proof hash`, and `Exact image SHA-256`.
- [*] Upload a different PNG/JPEG and confirm no-match language is understandable and scoped to this attestation.
- [*] Try a non-image file in `Choose image` and confirm the verifier asks for PNG or JPEG.

## Access And Historical Behavior

- [*] Revoke verifier access from an OCR attestation.
- [*] Confirm the verifier can no longer perform a new OCR lookup.
- [*] Confirm a previously issued OCR public result page still opens.
- [*] Revoke verifier access from an exact-image attestation.
- [*] Confirm the verifier can no longer perform a new exact-image lookup.
- [*] Confirm a previously issued exact-image public result page still opens.

## Known Limitations

- [*] Confirm `docs/v3-known-limitations.md` is accepted.
- [*] Confirm exact image proof is understood as byte-for-byte matching, not visual similarity.
- [*] Confirm OCR proof is understood as deterministic OCR text matching, not semantic similarity.
- [*] Confirm perceptual image similarity remains out of scope until threshold policy and wording are finalized.

## Sign-Off

- [*] All blocking failures are linked to issues or PRs.
- [*] Non-blocking known limitations are documented.
- [*] Tester signs off: Drew Shoaf, May 25, 2026.
