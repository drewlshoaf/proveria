# Getting started with Proveria

Proveria is a desktop-first provenance app. Producers and workspace admins use
the Electron desktop app to create projects, seal whole-file hashes, sign API
requests with a local Ed25519 device key, and manage workspace access. External
verifiers use the thin web client to check whether a file hash was included in a
shared attestation.

Your files stay local. The desktop app computes SHA-256 in the renderer, builds
and signs a manifest locally, and sends only cryptographic records to the API.

## Local stack

Install dependencies once:

```sh
pnpm install
```

Run the fastest end-to-end confidence check:

```sh
pnpm smoke:happy-path
```

That command starts local infrastructure, applies migrations, runs the API and
worker, mints a desktop device key, creates a project, submits a signed
whole-file attestation, waits for worker confirmation, and verifies the
generated receipt.

Run the full V1 release gate:

```sh
pnpm v1:release-check
```

That command runs the automated checks required before human sign-off. It starts
local infrastructure, API, worker, and verifier processes as needed, then cleans
up the local app processes when it exits.

Run the focused V2 native PDF content-proof smoke:

```sh
pnpm smoke:pdf-text-layer
```

Run the focused V3 exact image smoke:

```sh
pnpm smoke:exact-image
```

Run the focused V3 scanned PDF OCR smoke:

```sh
pnpm smoke:ocr-pdf
```

These focused smoke commands create their own attestations, confirm receipt
metadata, perform verifier match and no-match lookups, and verify public
verification links for issued result packages.

For UI work, run the apps separately:

```sh
pnpm dev:infra
pnpm eval:seed
pnpm --filter @proveria/api dev
pnpm --filter @proveria/worker dev
pnpm --filter @proveria/desktop dev
pnpm --filter @proveria/verifier dev
```

You can also run the API and worker from Docker Compose. This is useful when
you want backend behavior to match the containerized runtime while still
launching the desktop app and verifier web client natively:

```sh
pnpm dev:infra
DATABASE_URL=postgres://proveria:proveria_dev@127.0.0.1:5432/proveria pnpm --filter @proveria/db db:migrate
docker compose --profile app up -d --build api worker
pnpm eval:seed
pnpm --filter @proveria/desktop dev
```

To run the API, worker, and verifier web client from Docker Compose:

```sh
pnpm dev:infra
DATABASE_URL=postgres://proveria:proveria_dev@127.0.0.1:5432/proveria pnpm --filter @proveria/db db:migrate
docker compose --profile app up -d --build api worker verifier
pnpm eval:seed
pnpm --filter @proveria/desktop dev
```

To start every Compose service, including Postgres, Redis, MinIO, API, worker,
and verifier:

```sh
docker compose --profile app up -d --build
DATABASE_URL=postgres://proveria:proveria_dev@127.0.0.1:5432/proveria pnpm --filter @proveria/db db:migrate
pnpm eval:seed
pnpm --filter @proveria/desktop dev
```

Use these Docker helpers while testing the containerized services:

```sh
docker compose ps api worker verifier
docker compose logs -f api worker
docker compose stop api worker verifier
```

The Docker API binds host port `3001`, and the Docker verifier binds host port
`3003`. Stop any local `pnpm --filter @proveria/api dev` or
`pnpm --filter @proveria/verifier dev` process before starting the matching
container, or override the published ports with `API_PORT` / `VERIFIER_PORT`.

Default local URLs:

- API health: `http://127.0.0.1:3001/healthz`
- Verifier web client: `http://127.0.0.1:3003`
- Desktop app: launched by Electron through `pnpm --filter @proveria/desktop dev`

The evaluation seed command is idempotent. It creates a Team Pro workspace and
admin producer, producer, and verifier accounts for local testing. It also
creates an `Evaluation Evidence` project so the desktop app can submit an
attestation immediately after sign-in:

- Admin producer email: `admin-producer-eval@example.com`
- Admin producer password: `admin-producer-eval-password-123`
- Producer email: `producer-eval@example.com`
- Producer password: `producer-eval-password-123`
- API URL: `http://127.0.0.1:3001`
- Workspace: `Evaluation Workspace`
- Project slug: `evaluation-evidence`
- Verifier email: `verifier-eval@example.com`
- Verifier password: `verifier-eval-password-123`

In desktop dev mode, the sign-in screen includes a **Use local evaluation
account** button that fills the producer values. After submitting an
attestation, grant access to the seeded verifier email and open the verifier
lookup link from the attestation detail panel.

For a step-by-step manual pass, use `docs/evaluation-script.md`.

Optional Microsoft Entra ID/Azure AD OIDC setup for V5 sign-in testing is in
`docs/v5-entra-oidc-local-setup.md`.
Google OIDC and Google Drive local import implementation notes are retained in
`docs/v5-google-oidc-local-setup.md`, but Google surfaces are hidden in the V5
desktop build.

## Desktop flow

Create or sign in to a workspace from the desktop app. Sign-in mints a
tenant-scoped device key on this machine. The server stores only the public key;
the private key remains local and is used to sign workspace API requests.

The desktop app has five primary views:

- **Overview** shows workspace identity, plan, device trust, and the recommended
  first steps.
- **Projects** lists evidence containers and creates new projects.
- **Attestations** creates whole-file attestations, hashes local files in the
  renderer, accepts pasted external SHA-256 values, shows status detail, checks
  receipts, summarizes receipt evidence fields, exposes public receipt
  verification/PDF links, and manages verifier access grants.
- **Account** lists trusted devices, members, and pending invitations.
- **Audit** shows workspace audit events for admin review.

Sign-out revokes the current desktop device and deletes the local signing key.
Quitting or crashing the app does not revoke the device, so users are not locked
out by an unclean close.

## Verifier flow

A verifier signs in to the web client, sees attestations shared with them, and
opens a scoped lookup page. The page shows conservative pre-lookup metadata
before the verifier submits anything.

The verifier can check a file two ways:

- choose a local file and let the browser compute SHA-256 client-side,
- paste an externally computed SHA-256 hash.
- paste an exact source-text passage and let the browser generate content-proof
  hashes locally when the attestation includes text coverage.

The lookup returns a match or no-match state plus a durable result package. The
web client does not need access to producer files.

Verification-link lifecycle changes such as revoke, expire, and rotate are
recorded in the workspace audit log with the affected link and evidence target.

## Repeatable checks

Desktop UI smoke:

```sh
pnpm --filter @proveria/desktop test
```

Desktop visual screenshots:

```sh
pnpm --filter @proveria/desktop smoke:visual
```

The visual smoke writes screenshots to:

```sh
apps/desktop/dist/visual-qa
```

Verifier build and live smoke:

```sh
pnpm --filter @proveria/verifier build
pnpm eval:smoke
```

By default, the verifier live smoke self-seeds by running the desktop happy-path
client, then verifies both pasted external hash and browser-side file hashing
paths against the generated attestation.

Verifier responsive smoke:

```sh
pnpm --filter @proveria/verifier build
pnpm --filter @proveria/verifier start
```

In another terminal:

```sh
pnpm --filter @proveria/verifier smoke:responsive
```

The responsive smoke uses mocked API responses against the running verifier app
and checks mobile and desktop overflow across home, auth, lookup, and public
verification pages.

V5 remaining-QA automation:

```sh
pnpm qa:v5:tail
```

Run this after local infra, API, worker, verifier, database migrations, and
seeded admin CLI config are ready. It covers the non-visual V5 checklist items:
setup probes, Events export JSON/CSV/filter checks, evidence export
collect/check/filter/cleanup checks, OpenAPI loading, CLI tests, SDK tests, and
V5 developer/limitations document wording. Artifacts are written under `.qa/`.
Use `V5_QA_SKIP_SEED=1 pnpm qa:v5:tail` for repeat runs when you do not want to
rerun `pnpm eval:seed`.

Full local confidence pass:

```sh
pnpm v1:release-check
pnpm --filter @proveria/desktop smoke:visual
```

Run `pnpm --filter @proveria/desktop smoke:visual` as an additional desktop
visual gate when a machine can launch Electron screenshots.

## Troubleshooting

If Electron tests fail in a sandboxed environment with a process-launch or
`SIGABRT` error, rerun the same command with permission to launch Electron.

If the local happy path fails, inspect:

```sh
$TMPDIR/proveria-happy-path-api.log
$TMPDIR/proveria-happy-path-worker.log
```

If the database was reset, rerun the happy path or whichever seed command the
specific QA scenario requires. Desktop local signing keys are tied to device rows
in the database, so a database reset can require signing in again.
