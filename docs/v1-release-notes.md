# V1 Release Notes

This document summarizes the first desktop-first evaluatable Proveria build.
Use it as the release-review companion to `docs/v1-completion-checklist.md` and
`docs/human-qa-checklist.md`.

## Supported Workflows

- Admins and producers sign in to the Electron desktop app.
- Desktop sign-in mints a local Ed25519 device key and uses signed API requests.
- Admins manage workspace members, pending invitations, trusted devices, project
  archive/restore, and audit review.
- Producers create projects and submit whole-file attestations.
- Producers can hash a local file in the desktop renderer or paste an external
  SHA-256 digest.
- Producers inspect attestation status, receipt availability, public receipt
  verification links, verifier lookup links, access grants, and recent local
  attestations.
- Verifiers sign in to the web client and access only attestations explicitly
  shared with them.
- Verifiers can hash a local file in the browser or paste an external SHA-256.
- Lookup results produce match or no-match packages with public verification
  links, JSON artifacts, and PDF artifacts when rendering is available.

## Security And Privacy Posture

- Producer file bytes stay local during whole-file hashing.
- The API receives cryptographic metadata, signed manifests, receipts, and
  verifier result packages.
- Device-signed desktop requests create an auditable link between workspace
  actions and trusted devices.
- Verifier access is scoped to individual attestations.
- No-match result language is intentionally scoped to the selected attestation.
- The implemented security model and expected-error matrix are reviewed in
  `docs/v1-security-and-error-review.md`.

## QA Gates

Before calling this version shippable:

- Run `pnpm v1:release-check` and the desktop visual smoke listed in
  `docs/getting-started.md`.
- Complete `docs/human-qa-checklist.md` across admin, producer, verifier, and
  cross-role scenarios.
- Fill in `docs/v1-qa-signoff.md` with reviewer, environment, defects, and
  release acceptance.
- Review and accept `docs/v1-known-limitations.md`.
- Record blocking defects and explicitly accept non-blocking limitations.

## Known Limitations

See `docs/v1-known-limitations.md`.
