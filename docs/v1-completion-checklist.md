# V1 Completion Checklist

This is the working definition of “complete enough to ship an evaluatable
desktop-first V1.” Keep this checklist current as implementation lands.

## Producer Desktop App

- [x] Desktop-first sign-in with local device key minting.
- [x] Device-signed API requests from the desktop app.
- [x] Trusted-device listing and revocation.
- [x] Project creation.
- [x] Admin project archive/restore.
- [x] Whole-file attestation submission from browser-side SHA-256 hashing.
- [x] Whole-file attestation submission from pasted external SHA-256.
- [x] Attestation status detail with receipt and verifier lookup links.
- [x] Verifier access grant and revoke controls.
- [x] Role-aware account surfaces for admins and producers.
- [x] Workspace members and invitation management for admins.
- [x] Workspace audit view with full admin and limited producer scope.
- [x] Recent local attestations surfaced in desktop overview.
- [x] Final desktop attestation/status UX polish pass.
- [x] Final desktop empty/error/loading state pass.

## Verifier Web Client

- [x] Verifier sign-in/register flow.
- [x] Lookup-link redirect preserved through sign-in.
- [x] Browser-side file hashing.
- [x] Pasted external SHA-256 lookup.
- [x] Match result package display.
- [x] No-match result package display.
- [x] Public verification links for signed result packages.
- [x] Final verifier result-language polish pass.
- [x] Final verifier revoked/missing/expired access state pass.
- [x] Final verifier mobile/responsive QA pass.

## Backend And Security

- [x] Credential login plus local desktop signing key.
- [x] Device-signed auth middleware.
- [x] Role enforcement for admin, producer, and verifier workflows.
- [x] Project, attestation, receipt, verifier-access, member, invite, and device APIs.
- [x] Receipt generation and public verification path.
- [x] Match and no-match verification package paths.
- [x] Audit logging for key workspace actions.
- [x] Device revocation and abandoned-device recovery path.
- [x] Final expected-error review for user-facing API failures.
- [x] Final security model doc review against implemented behavior.

## QA And Evaluation

- [x] Seeded producer evaluation account.
- [x] Seeded verifier evaluation account.
- [x] Desktop smoke tests.
- [x] Verifier live smoke path.
- [x] Local happy-path API/worker/object-store smoke.
- [x] Manual producer-to-verifier evaluation script.
- [x] Repeatable V1 automated release gate.
- [ ] Human QA checklist completed across roles and workflows.
- [ ] Fresh-machine local setup pass from `docs/getting-started.md`.
- [ ] Final end-to-end eval account pass.
- [x] Known limitations accepted and documented.

## Shippability Gate

- [x] All required local checks pass via `pnpm v1:release-check`.
- [ ] Human QA checklist has a named reviewer and date.
- [ ] Blocking defects are fixed or explicitly accepted.
- [x] Release notes summarize supported workflows and known limitations.
- [ ] Version is tagged as the first desktop-first evaluatable build.
