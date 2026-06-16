# V1 Known Limitations

These limitations are accepted for the first desktop-first evaluatable build.
They should be visible during human QA and release review so testers do not
mistake expected V1 boundaries for regressions.

## Product Scope

- V1 supports whole-file SHA-256 attestations. Passage, shingle, OCR, image,
  audio, video, and perceptual matching remain protocol/product follow-up work.
- Producers and admins use the desktop app. There is no full producer web
  portal in this version.
- Verifiers use the thin web client only for scoped lookup workflows.
- The corporate marketing site is maintained in the separate `proveria-corp`
  repository.

## Desktop And Device Keys

- Desktop sign-in supports accounts with one tenant membership. Multi-workspace
  switching is not part of V1.
- Sign-out revokes the current desktop device. Closing or crashing the app does
  not revoke the device, by design, so users are not locked out by an unclean
  shutdown.
- Device keys are local to the machine/app profile. A database reset or local
  keychain reset can require signing in again.
- Desktop distribution/signing is not finalized in this repo; local evaluation
  runs through Electron development scripts.

## Verification And Receipts

- No-match results are scoped to the specific attestation and lookup time. They
  do not prove the submitted file exists nowhere else.
- Previously issued public verification pages may remain valid historical
  artifacts after verifier access is revoked. Revocation blocks new lookups; it
  does not rewrite history.
- PDF rendering is asynchronous. A verification page may need a retry before the
  PDF artifact is ready.
- Free-tier lookup result packages can be self-verifiable by Merkle math, while
  paid-tier result packages are platform-signed.

## Auth, Roles, And Admin

- V1 has tenant admins, producers, and verifiers/consumers. There is no broader
  platform-admin product surface for customers.
- Producers can create projects and attestations but cannot manage members,
  invitations, or archived projects.
- Admin archive/restore is project-level only. V1 does not support hard deletion.
- Email delivery in local development is log-based through the notification
  provider; production email delivery is outside the local QA path.

## QA And Operations

- Local QA assumes Docker-backed Postgres, Redis, and MinIO.
- Seeded evaluation credentials are intended for local development only.
- Human QA remains required before shippability sign-off; automated smoke tests
  cover happy paths but not all role, browser, or copy-quality checks.
