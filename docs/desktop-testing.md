# Desktop Testing

Run the desktop smoke test with:

```sh
pnpm --filter @proveria/desktop test
```

The test builds the Electron main/preload bundles and renderer, then launches
Electron twice:

1. signed out, verifying the preload bridge and register/sign-in screen,
2. authenticated with an in-process RPC fixture, verifying the workspace home,
   trusted device list/revoke, member and invitation management, project
   list/create flow, local file hashing UI, pasted SHA-256 submission,
   attestation submit state, status detail panel, access grant management,
   receipt check, structured receipt evidence summary, public receipt
   verification links, and read-only audit visibility.

Because it launches Electron, the test needs permission to open a GUI process in
sandboxed environments.

For visual QA, run:

```sh
pnpm --filter @proveria/desktop smoke:visual
```

The visual smoke builds the app, launches Electron with the authenticated smoke
fixture, captures Overview, Projects, Attestations, Account, and Audit, then
runs the same authenticated renderer assertions. Screenshots are written to:

```sh
apps/desktop/dist/visual-qa
```

## Admin QA pass

Use this as the current desktop-first admin checklist. It is intentionally
shorter than the legacy portal walkthrough.

- [x] Signed-out screen renders and exposes the preload RPC bridge.
- [x] Authenticated shell renders workspace identity, plan, and sidebar tabs:
  Overview, Projects, Attestations, Account, Audit.
- [x] Account tab shows trusted devices and can revoke a non-current device.
- [x] Account tab shows tenant members, pending invitations, invite creation,
  and invite revocation.
- [x] Projects tab lists projects and creates a new project.
- [x] Attestations tab lists attestations, loads status detail, verifies a
  receipt, shows the receipt evidence summary and public receipt
  verification/PDF links, creates/revokes access grants, hashes a browser-side
  file, and submits a pasted external SHA-256 hash.
- [x] Audit tab loads tenant audit events through the signed desktop RPC path
  and displays actor, actor device, target, category, action, and timestamp.

Manual follow-up before demo:

- [ ] Run a local stack happy path with `pnpm smoke:happy-path`.
- [ ] Open the verifier web client and verify one confirmed attestation using
  both browser-side file hashing and pasted external hash modes.
