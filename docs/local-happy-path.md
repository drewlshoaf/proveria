# Local Happy Path

Run the desktop-signed end-to-end flow against local infrastructure:

```sh
pnpm smoke:happy-path
```

The runner starts Postgres, Redis, and MinIO with Docker Compose, applies DB
migrations, starts the API and worker locally, then runs a smoke client that:

1. registers a user,
2. creates a workspace,
3. mints a desktop device key,
4. creates a project with a signed request,
5. creates a whole-file attestation,
6. uploads a device-signed manifest,
7. finalizes the attempt,
8. waits for worker confirmation and receipt generation,
9. fetches and verifies the receipt.

This is the fastest local confidence check for the desktop-first architecture:
it exercises API auth, device-signed requests, object storage, the worker, and
receipt verification without launching the Electron UI.

API and worker logs are written to:

```sh
$TMPDIR/proveria-happy-path-api.log
$TMPDIR/proveria-happy-path-worker.log
```

After this passes, run the UI smoke separately:

```sh
pnpm --filter @proveria/desktop test
pnpm --filter @proveria/verifier build
```

For live verifier QA, start the API, worker, and verifier locally, then run:

```sh
pnpm --filter @proveria/verifier smoke:live
```

For focused V3 exact-image coverage, run:

```sh
pnpm smoke:exact-image
```

For focused V3 scanned PDF OCR coverage, run:

```sh
pnpm smoke:ocr-pdf
```

By default, the verifier smoke self-seeds by running the desktop happy-path
client first, then logs into the verifier web app with the generated account.
It opens the generated attestation, verifies the pasted external SHA-256 path,
then uploads an in-browser text fixture to verify browser-side file hashing.

To reuse a specific already-created attestation instead, pass the values
explicitly:

```sh
PROVERIA_VERIFIER_EMAIL="happy-<run>@example.com" \
PROVERIA_VERIFIER_PASSWORD="happy-path-password-123" \
PROVERIA_VERIFIER_ATTESTATION_ID="<attestation-id>" \
PROVERIA_VERIFIER_SUBMITTED_HASH="<submitted-hash>" \
PROVERIA_VERIFIER_FILE_TEXT=$'Proveria happy path <run>\n' \
pnpm --filter @proveria/verifier smoke:live
```

Set `PROVERIA_VERIFIER_SEED=0` to require explicit values and fail fast when
any of them are missing.
