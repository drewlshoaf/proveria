# QA Walkthrough

Proveria is now desktop-first. The legacy portal persona walkthrough was
removed from this file because it described pre-pivot screens and scripts that
are no longer part of the active local evaluation path.

Use these current desktop-first QA entry points instead:

- `docs/v1-completion-checklist.md` for the version-level completion gate.
- `docs/v2-completion-checklist.md` for the V2 content-proof completion gate.
- `docs/v3-completion-checklist.md` for the V3 OCR and image evidence gate.
- `docs/human-qa-checklist.md` for final role/workflow manual QA before
  shippability sign-off.
- `docs/human_qa_v3.md` for focused V3 OCR and exact-image manual QA.
- `docs/v1-release-notes.md` and `docs/v1-known-limitations.md` for release
  review scope and accepted V1 boundaries.
- `docs/v2-known-limitations.md` for accepted V2 content-proof boundaries.
- `docs/v3-known-limitations.md` for accepted V3 OCR and exact-image
  boundaries.
- `docs/v1-security-and-error-review.md` for the final security model and
  expected-error review.
- `docs/v1-qa-signoff.md` for recording the final reviewer, environment,
  automated gate result, defects, and release acceptance.
- `docs/v2-qa-signoff.md` for recording V2 content-proof QA acceptance.
- `docs/v3-qa-signoff.md` for recording V3 OCR and exact-image QA acceptance.
- `docs/evaluation-script.md` for the manual producer-to-verifier click path.
- `docs/getting-started.md` for local startup, seeded evaluation credentials,
  and repeatable checks.
- `docs/desktop-testing.md` for Electron smoke and visual QA details.
- `docs/local-happy-path.md` for the fastest API/worker/object-store confidence
  check without launching the desktop UI.

## Current Confidence Pass

```sh
pnpm v1:release-check
pnpm smoke:pdf-text-layer
pnpm smoke:exact-image
pnpm smoke:ocr-pdf
pnpm --filter @proveria/desktop smoke:visual
```

## Manual Evaluation

Follow `docs/evaluation-script.md` to verify:

- producer sign-in through the desktop app,
- whole-file browser-side hashing and pasted external SHA-256 submission,
- receipt checking and public receipt verification links,
- verifier access grants managed from the desktop app,
- verifier sign-in returning to the original lookup link,
- verifier match and no-match result packages,
- public verification pages exposing JSON and PDF artifacts.
- native PDF text content-proof matching and no-match behavior.
- OCR scanned-PDF passage matching and no-match behavior.
- PNG/JPEG exact-image matching and no-match behavior.

## Legacy Note

Historical portal QA details can be recovered from git history if needed, but
new QA work should extend the desktop/verifier docs above.
