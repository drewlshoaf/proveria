# CLI/API-First Restart

This is the new product center of gravity for Proveria.

The desktop-first build taught us the right concepts: workspace boundaries,
project grouping, attestations, receipts, verifier access, content proofs,
events, exports, API keys, and OpenAPI docs. The restart keeps those concepts,
but promotes the API and CLI to the primary product surface.

## Recommendation

Build the next Proveria version around:

1. A commercial-grade public API.
2. A Rust CLI as the primary local client.
3. API docs served from the API and rendered by the corporate site.
4. Thin web experiences only where they are clearly needed.

The desktop app should pause as a primary development target. It remains a
reference for workflows and UX lessons, but it should not drive the architecture.

## Why This Pivot Makes Sense

- The core value is portable proof infrastructure, not a heavy desktop UI.
- Developers and operators need repeatable command-line workflows.
- CI/CD, data, AI, CMS, and enterprise integrations all start from API + CLI.
- A Rust CLI is easier to distribute as a trusted binary.
- Local hashing remains local without requiring Electron.
- API keys, OpenAPI, SDKs, and webhooks become first-class instead of secondary.

## What We Keep

- Workspace-scoped API keys.
- Public V1 API contract and OpenAPI service.
- Project and attestation model.
- Whole-file SHA-256 attestations.
- Receipt and verification-result packages.
- Content proof research and V2/V3 lessons.
- Events/audit and export concepts.
- Existing SDK/CLI examples as compatibility references.

## What We Defer

- Desktop-first UX polish.
- Complex role-management UI.
- Google Drive and OIDC UI surfaces beyond API essentials.
- Heavy verifier/admin web flows.
- Perceptual hashes until the core API/CLI is stable.

## First CLI Commands

```text
proveria config set --api-url <url> --workspace <slug> --api-key <key>
proveria config show
proveria completions zsh
proveria hash <file>
proveria projects list
proveria projects create <slug> --name <name>
proveria attestations
proveria attestations --project <slug>
proveria attestations --project <slug> --status confirmed --limit 25
proveria prove <sha256> --project <slug> --name <name>
proveria prove <file> --project <slug>
proveria records get <attestation-id>
proveria receipt <attestation-id>
proveria receipt <attestation-id> --json --pdf --output ./receipts
proveria access grant <attestation-id> --email <email>
proveria access revoke <attestation-id> --grant <grant-id>
proveria result <verification-link-id>
proveria result <verification-link-id> --json --pdf --output ./results
proveria verify <sha256> --attestation <id>
proveria verify <file> --attestation <id>
proveria verify passage <text> --attestation <id>
proveria events
proveria events --category verification_lookup --limit 25
proveria events --output json
proveria export
proveria export --output ./evidence-export.json
proveria export jobs
proveria export create --limit 100 --output ./evidence-export.json
proveria webhooks create --url <url> --event receipt.issued
proveria webhooks list
proveria webhooks test <endpoint-id>
proveria webhooks deliveries
proveria webhooks disable <endpoint-id>
```

## Near-Term CLI Backlog

The near-term CLI backlog is complete. Release packaging lives in
`docs/cli-release-packaging.md`.

## API Priorities

- Keep `/v1/openapi.json` canonical.
- Keep API keys workspace-bound.
- Make idempotency standard for write commands.
- Make request/response errors consistent and CLI-friendly.
- Stabilize project, attestation, receipt, verification, event, and export
  endpoints before expanding integrations.

## Current CLI Shape

The CLI now favors direct commands for the common producer and verifier flows:

```text
proveria projects create evaluation-evidence --name "Evaluation Evidence"
proveria prove ./invoice.pdf --project evaluation-evidence
proveria prove <sha256> --project evaluation-evidence --name invoice-2026-05
proveria access grant <attestation-id> --email verifier@example.com
proveria verify ./invoice.pdf --attestation <attestation-id>
proveria verify <sha256> --attestation <attestation-id>
proveria verify passage "source passage text" --attestation <attestation-id>
proveria webhooks create --url https://example.com/proveria/webhooks --event receipt.issued
```

Explicit subcommands such as `proveria prove file ...`, `proveria prove hash
...`, `proveria verify file ...`, and `proveria verify hash ...` remain
accepted for clarity in scripts, but the direct forms are the preferred public
examples.

## Product Direction

The first shippable version should prove:

1. A developer can create a workspace API key.
2. A developer can configure the CLI.
3. A developer can hash a file locally.
4. A developer can submit an attestation through the API.
5. A developer can retrieve a receipt.
6. A developer can verify a hash/file/passage.
7. A developer can automate the flow in CI.

That is the trust story in its simplest form.
