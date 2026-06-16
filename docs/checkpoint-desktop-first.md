# Desktop-first checkpoint

Current implementation checkpoint after the desktop-first pivot.

## Product shape

- `apps/desktop` is the primary authenticated working app for admins and
  producers.
- `apps/verifier` is the thin verifier web client for scoped verification.
- The corporate marketing site now lives in the separate `proveria-corp`
  repository.
- `apps/app` is an untracked reference scaffold and is excluded from the pnpm
  workspace so it does not affect installs or lockfile generation.

## Desktop

- Email/password sign-in mints a tenant-scoped Ed25519 desktop device key.
- Device keys are stored locally through the Electron main process and all
  workspace API calls use signed requests.
- Sign-out revokes the current device and removes the local key. Ordinary quit
  or crash leaves the device active so users do not strand their account.
- The renderer has Overview, Projects, Attestations, Account, and Audit views.
- Producers can create projects, create whole-file attestations, hash files in
  the renderer, paste external SHA-256 hashes, inspect status detail, and verify
  receipts.
- Tenant admins can manage trusted devices, members, invitations, attestation
  access grants, and read the workspace audit log.

## Verifier

- Verifier users authenticate with session cookies.
- The verifier lists shared attestations and opens scoped lookup pages.
- Lookup pages show conservative pre-lookup metadata only.
- Verifiers can compute SHA-256 in the browser from a local file or paste an
  externally computed hash.
- A successful lookup returns a durable result package and renders match or
  no-match state.
- Verification-link revoke, expiry, and rotation actions are tenant
  audit-visible with the affected link id, target type, and target reference.

## Repeatable checks

```sh
pnpm --filter @proveria/api test
pnpm --filter @proveria/worker test
pnpm --filter @proveria/desktop test
pnpm --filter @proveria/desktop smoke:visual
pnpm --filter @proveria/verifier build
pnpm smoke:happy-path
pnpm eval:smoke
```

For live verifier UI QA against an already-created attestation:

```sh
PROVERIA_VERIFIER_EMAIL="happy-<run>@example.com" \
PROVERIA_VERIFIER_PASSWORD="happy-path-password-123" \
PROVERIA_VERIFIER_ATTESTATION_ID="<attestation-id>" \
PROVERIA_VERIFIER_SUBMITTED_HASH="<submitted-hash>" \
PROVERIA_VERIFIER_FILE_TEXT=$'Proveria happy path <run>\n' \
pnpm eval:smoke
```

## Next build slice

- Keep tightening desktop/verifier QA around real local stack runs.
- Decide when to remove the legacy portal/reference app directories from the
  repository history and workspace layout.
