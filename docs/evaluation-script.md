# Proveria Evaluation Script

Use this script for local producer-to-verifier evaluation. It follows the
desktop-first product path: producer signs in to the desktop app, submits a
whole-file hash, grants verifier access, then the verifier checks the hash in
the web client.

## Start Local Services

Run each long-running app command in its own terminal tab:

```sh
pnpm dev:infra
pnpm eval:seed
pnpm --filter @proveria/api dev
pnpm --filter @proveria/worker dev
pnpm --filter @proveria/desktop dev
pnpm --filter @proveria/verifier dev
```

Expected local URLs:

- API: `http://127.0.0.1:3001`
- Verifier: `http://127.0.0.1:3003`
- Desktop: Electron window launched by `pnpm --filter @proveria/desktop dev`

## Producer Walkthrough

1. In the desktop app, click **Use local evaluation account**.
2. Sign in as `producer-eval@example.com`.
3. Open **Attestations**.
4. Confirm the project is `Evaluation Evidence`.
5. Choose a local file, or switch to **Paste SHA-256** and enter a 64-character
   SHA-256 digest.
6. Enter a unique label such as `eval-001`.
7. Click **Submit attestation**.
8. Wait for the attestation list to show the new row as `confirmed`.
9. Select the confirmed row and click **Check receipt**.
10. Confirm receipt signature status, package id, Merkle root, and JSON preview.

## Verifier Handoff

1. In the selected attestation detail panel, confirm **Verifier hash lookup** is
   visible.
2. In **Access grants**, use `verifier-eval@example.com`.
3. Click **Grant access**.
4. Open the verifier lookup link.
5. If prompted to sign in, click **Use local verifier account** and sign in.
6. Confirm the verifier returns to the original lookup page after sign-in.
7. Verify the same file through **Choose file**.
8. Verify the same hash through **Paste SHA-256**.
9. Confirm the result card shows `Match found`, a package id, submitted hash,
   matched leaf, proof depth, Merkle root, and public verification link.
10. Paste a different 64-character SHA-256 digest and confirm the result card
   shows `No match` plus the signed no-match statement.
11. Click **Open verification page** from either result card.
12. Confirm the public page loads the signed result package and exposes PDF and
   JSON downloads.

## Expected Outcomes

- Producer file bytes never upload; only SHA-256, manifest, signatures, and
  receipt artifacts reach the API.
- Producer can manage verifier access for attestations they created.
- Verifier cannot see file names or full leaf details before lookup.
- Verifier can use browser-side file hashing or an external pasted hash.
- Verifier sees a clear match or no-match result without producer file access.
- Signed receipt and lookup result packages expose durable verification links.

## Quick Checks

```sh
pnpm --filter @proveria/api test
pnpm --filter @proveria/desktop test
pnpm eval:smoke
```
