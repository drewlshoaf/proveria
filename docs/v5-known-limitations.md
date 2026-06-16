# V5 Known Limitations

Use this companion note while V5 workspace administration and export workflows
are still hardening.

## Workspace Administration

- Workspace access is explicit and predictable, but current local evaluation is
  still centered on the seeded organization and workspace.
- Organization-wide workspace administration remains a policy area to harden
  before broad customer rollout.
- Workspace scoping must continue to be regression-tested across projects,
  attestations, events, receipts, verification results, access grants, and API
  credentials whenever new APIs are added.

## OIDC And Google Drive

- Generic OIDC authentication is implemented for configured providers.
- Microsoft Entra ID/Azure AD is wired as the first concrete OIDC provider and
  is configured through environment variables for the current local build.
- Additional generic OIDC provider administration UI is not implemented.
- Google OIDC, Google external identity connection, and Google Drive local
  import support are hidden in the V5 desktop UI. Implementation and setup notes
  are retained so the surfaces can be re-enabled after the product decision.
- Google Drive Picker-based browsing, automatic Drive download, and Drive
  access-token handling are not implemented in this V5 build.
- Historical Drive-sourced attestations can still show recorded source metadata
  on attestation detail.

## Exports

- Event export is available for workspace-scoped and organization-wide admin
  workflows, with workspace, project, actor, category, and date filters where
  applicable.
- Evidence export currently produces durable queued job records, manifest data,
  and worker-built JSON artifact bundles. Workspace admins can export within a
  workspace, and organization admins can create organization-scoped evidence
  exports across active workspaces. Export job responses include progress,
  retry, expiration, and retention metadata. Saved job manifests and completed
  bundles can be retrieved later from desktop, CLI, API, and SDK surfaces. The
  CLI can package evidence bundles as ZIP and tar archives.
- Evidence export manifests list receipt, manifest, leaf, validation result,
  lookup result, verification link, and event references where available.
  Downloadable JSON bundles include available referenced artifact payloads and
  explicitly list missing artifacts. The CLI can inspect JSON bundle contents
  and either unpack bundles into local manifest and artifact files or collect a
  fresh export package into one local directory with optional ZIP and tar
  archives. The CLI can also check standalone bundle JSON files and collected
  evidence directories for local consistency.
- Physical cleanup of expired evidence export bundle objects is implemented as
  an explicit tenant-admin/API operation. Jobs with
  `delete_after_expiration: true` have their stored bundle object deleted, are
  marked `expired`, have `result_object_key` cleared, and write a retention
  deletion audit event. Automatic scheduling remains an operational follow-up.

## Developer Surface

- The API supports V5 log export and worker-backed evidence export jobs.
- OpenAPI, CLI, TypeScript SDK, webhook catalog, and public language guidance
  now reflect V5 workspace and export semantics.
- Webhook event coverage remains intentionally narrow in V5. Lookup-result,
  verifier-access, Google Drive, and evidence-export lifecycle webhooks remain
  backlog items.

## Operational Notes

- Run migrations before testing V5 export jobs locally; V5 adds the
  `export_jobs` table.
- Local QA should restart API, worker, desktop, and verifier after pulling V5
  changes, especially when switching branches.
- The worker must be running before testing attestation confirmation, receipts,
  public PDFs, OCR, exact image proof, or verifier result PDFs.
