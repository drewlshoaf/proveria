# V5 Completion Checklist

Use this as the working gate for the product-led workflow and enterprise
administration release.

## Scope

- [*] V5 product goal is accepted.
- [*] V5 non-goals are accepted.
- [*] V4 developer-feature expansion is paused.
- [*] Freeform attestation tags are explicitly out of scope.
- [*] Developer surface updates are treated as follow-on work driven by V5
      product semantics.

## Verifier Experience

- [*] Lookup pages use clear non-crypto-first language.
- [*] Result pages clearly distinguish match, no-match, content proof, exact
      image proof, and whole-file proof.
- [*] Missing access, revoked access, and request-access states are coherent.
- [*] Public result and public receipt language is distinct.
- [*] Verifier privacy language is clear.

## Producer Attestation Workflow

- [*] File submission supports drag and drop.
- [*] Multi-file submission has clear progress.
- [*] Completed submissions automatically reveal the relevant attestation
      detail.
- [*] Returning to new attestation clears prior submitted state.
- [*] Project/file templates are removed from user-facing creation flows.

## Requests And Access

- [*] Verifier access grants are managed in a searchable, sortable, filterable,
      paginated table.
- [*] Access requests are managed in a searchable, sortable, filterable,
      paginated table.
- [*] Approval and denial reasons are clear.
- [*] Denied requests cannot be reconsidered unless a new request is created.
- [*] Handoff language and private verifier lookup naming are consistent.

## Workspaces And Membership

- [*] Admins can grant a user access to all workspaces.
- [*] Admins can grant a user access to one workspace.
- [*] Admins can grant a user access to selected workspaces.
- [*] Admins can revoke workspace access.
- [*] Projects remain scoped within workspaces.
- [*] Workspace scope applies to projects, attestations, events, receipts,
      verification results, access grants, and API credentials.
- [*] Workspace switching is explicit and predictable.

## OIDC And Google Drive

- [*] Generic OIDC authentication is available as an optional sign-in method.
- [*] Microsoft Entra ID/Azure AD is configured as the first concrete OIDC
      provider.
- [*] External identity connection and disconnection works from Profile.
- [*] Google sign-in, Google external identity connection, and Google Drive
      local import surfaces are hidden for the V5 desktop build.
- [ ] Google surfaces are re-enabled after the follow-up product decision.
- [*] OIDC sign-in and external identity connection/disconnection emit audit
      events.
- [*] Entra-first OIDC authentication and Google Drive intake design is documented in
      `docs/v5-oidc-and-drive-design.md`.
- [*] Entra local setup and QA is documented in
      `docs/v5-entra-oidc-local-setup.md`.
- [*] Google OIDC setup notes are retained in
      `docs/v5-google-oidc-local-setup.md`.

## Exports

- [*] Admins can export event/log data for an organization.
- [*] Admins can export event/log data by workspace.
- [*] Admins can export event/log data by project.
- [*] Admins can export event/log data by actor.
- [*] Admin log exports support date range and event filters.
- [*] Admin log exports are audited.
- [*] Admins can export evidence/artifact bundles by actor.
- [*] Admins can export evidence/artifact bundles by project.
- [*] Admins can export evidence/artifact bundles by workspace.
- [*] Admins can export evidence/artifact bundles by organization.
- [*] Evidence exports include receipts, JSON artifacts, relevant verification
      results, and event history.
- [*] Evidence export manifests can be created as durable jobs.
- [*] Recent evidence export jobs can be listed and refreshed in desktop.
- [*] Saved evidence export job manifests can be downloaded later from
      desktop, CLI, API, and SDK surfaces.
- [*] Evidence export jobs produce downloadable JSON artifact bundles.
- [*] Evidence export jobs expose progress, retry, expiration, and retention
      metadata.
- [*] Large exports run as background jobs with progress, retries, expiration,
      and retention policy.
- [*] Expired evidence export bundle objects can be physically deleted through
      explicit cleanup endpoints when their retention policy opts in.

Current evidence export progress: tenant admins can download a workspace-scoped
evidence export manifest from desktop, create queued evidence export job records
with manifest data, view recent export jobs, and retrieve saved job manifests
and JSON artifact bundles later from desktop, CLI, API, and SDK surfaces. CLI
packaging supports collected directories, ZIP archives, tar archives, and local
consistency checks. Organization admins can now request organization-scoped
evidence export manifests and bundle jobs across active workspaces. Export jobs
now run through the worker with progress, retries, expiration, and retention
metadata. Tenant-admin and public V1 cleanup endpoints delete expired bundle
objects for jobs with `delete_after_expiration: true`, mark those jobs expired,
clear their object keys, and audit each deletion.

## Developer Surface Follow-Up

- [*] OpenAPI reflects V5 workspace membership semantics.
- [*] API supports V5 log export.
- [*] API supports V5 evidence export jobs.
- [*] API reflects template removal.
- [*] CLI supports V5 workspace, export, OIDC, and Google Drive flows where
      appropriate.
- [*] TypeScript SDK supports V5 workspace and export APIs.
- [*] Webhook catalog is updated for V5 events.
- [*] Public docs use finalized V5 receipt/result/verification language.

## Regression

- [ ] Desktop producer workflow still passes.
- [ ] Desktop admin workflow still passes.
- [ ] Verifier web workflow still passes.
- [ ] V3 content proof workflows still pass.
- [ ] V3 OCR workflows still pass.
- [ ] V3 exact image workflows still pass.
- [ ] V4 API auth tests still pass.
- [ ] V4 public API contract tests still pass.

## Sign-Off

- [*] V5 known limitations are documented.
- [ ] V5 human QA checklist is complete.
- [ ] All blocking failures are fixed or accepted.
- [*] Release notes are written.
