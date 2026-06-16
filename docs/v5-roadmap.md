# Proveria V5 Roadmap

V5 is the product-led workflow and enterprise administration release. The goal
is to make the core app easier for producers, verifiers, and admins before
expanding the developer platform further.

## Product Goal

Make Proveria feel simple for everyday users while adding the administration
and export controls needed by organizations.

V5 should make it obvious:

- how a producer submits evidence;
- how a verifier checks evidence;
- how admins control workspace access;
- how records, receipts, verification results, and events differ;
- how an organization can export its evidence and logs.

## Primary Pillars

### 1. Verifier Experience Polish

- Simplify lookup pages and result pages.
- Reduce crypto-first language in favor of clear result meaning.
- Clarify match, no-match, content proof, exact image proof, and receipt/result
  artifact language.
- Make missing access, revoked access, and request-access states feel like a
  coherent workflow.
- Preserve the privacy boundary: verifier-side file/passage hashing remains
  local unless a future hosted-ingestion product is explicitly designed.

### 2. Producer Attestation Workflow Polish

- Add drag-and-drop file submission.
- Improve multi-file progress and completion behavior.
- Make successful submissions automatically transition into the relevant
  attestation detail state.
- Keep the new attestation form cleared when users return to create another
  attestation.
- Remove project/file templates from the user-facing workflow unless a future
  product decision reintroduces them with a clear purpose.

### 3. Requests And Access Workflow

- Continue improving verifier handoff language, request status, approval,
  denial, and revocation.
- Treat access grants and access requests as first-class managed records.
- Ensure access request decisions include clear reasons and finality when
  denied.
- Make verifier access tables searchable, sortable, filterable, and paginated.

### 4. Projects, Workspaces, And Navigation

- Add real workspace management.
- Allow admins to restrict internal users to all workspaces, one workspace, or
  selected workspaces.
- Allow admins to revoke workspace access.
- Keep projects scoped within workspaces.
- Ensure workspace membership scope applies consistently to projects,
  attestations, events, receipts, verification results, access grants, and API
  credentials.
- Make workspace switching explicit and predictable.

### 5. Records, Receipts, Verifications, And Events Language

- Continue simplifying attestation detail around:
  - Records;
  - Verifications;
  - Events.
- Distinguish public receipt verification from private verifier lookup.
- Standardize user-facing names before SDK/API/CLI docs expand.
- Make receipt/result/download/export language consistent across desktop,
  verifier web, PDFs, JSON artifacts, and future developer docs.

## New Product Features

### OIDC Identity And Google Drive

- Add generic OIDC authentication as an optional sign-in method.
- Wire Microsoft Entra ID/Azure AD as the first concrete OIDC provider.
- Wire Google as the next OIDC provider for Drive import.
- Add Google Drive file selection/import.
- Decide whether Google files are downloaded locally for browser/desktop-side
  hashing or processed through a hosted ingestion flow.
- Preserve user trust: make it clear what file metadata or bytes Proveria can
  access, what stays local, and what is stored.
- Add audit events for OIDC sign-in, external identity connection, Drive file
  selection, and attestation submission source.

### Admin Log Export

Admins need exportable logs for audit, legal, and security review.

Supported export scopes should include:

- organization;
- workspace;
- project;
- actor;
- date range;
- event category/action.

Export formats should start with JSON and CSV. Exports must be audited.

Current implementation: admins can export workspace-scoped logs from desktop
and the API, and organization admins can export logs across all organization
workspaces. Exports support workspace, project, actor, category, and date range
filters where applicable.

### Evidence And Artifact Export

Admins need a way to export complete evidence packages.

Supported export scopes should include:

- actor;
- project;
- workspace;
- organization.

Exports should include relevant receipts, receipt JSON, public verification
metadata, lookup/result packages, and event history. Large exports should run as
jobs with progress, retry, and downloadable bundles.

Current implementation: tenant admins can download a workspace-scoped evidence
export manifest from desktop and the API, and desktop can create completed
evidence export job records with manifest data through the API. Admins can view
recent export jobs in desktop. Full bundled artifact exports and background job
processing remain open.

## Explicit Non-Goals For V5

- Freeform attestation tags are out of scope for now.
- Perceptual image hashes remain in the future backlog.
- Public developer repositories and package publishing remain paused unless V5
  product work needs them.
- Customer-managed signing keys remain out of scope unless a customer deal
  forces the decision.
- Hosted ingestion of arbitrary file bytes is not assumed; Google Drive design
  must choose the privacy model first.

## Developer Surface Impact

V5 product decisions will require API, CLI, SDK, webhook, and OpenAPI updates.
Do not finalize new public developer contracts until these user-facing semantics
are settled.

Expected impacts:

- workspace-scoped membership and permissions;
- OIDC auth and Google Drive source metadata;
- drag-and-drop and batch submission progress;
- log export APIs;
- evidence export job APIs;
- updated event catalog;
- clearer receipt/result/verification naming;
- possible breaking changes to project/template fields if templates are
  removed.

## Recommended Build Order

1. Remove project/file templates from the UI and document replacement semantics.
2. Add drag-and-drop and improved progress for attestation submission.
3. Rework workspace management and workspace-scoped membership.
4. Rework requests/access tables and verifier handoff states.
5. Add admin log export.
6. Add evidence/artifact export jobs.
7. Add generic OIDC auth with Microsoft Entra ID/Azure AD as the first
   provider.
8. Add Google OIDC auth and Google Drive file selection/import.
9. Update public API, CLI, TypeScript SDK, and docs to match V5 semantics.

## Open Decisions

- Should Google Drive files always be hashed locally after download to the
  desktop/browser, or can hosted ingestion be introduced for enterprise plans?
- Workspace restrictions should be modeled as organization membership access
  modes plus per-workspace role grants. See
  `docs/v5-workspace-membership-design.md`.
- Who can export evidence bundles: tenant admins only, workspace admins, or
  project owners?
- Should evidence export bundles include public verification PDFs, raw JSON
  packages, or both by default?
- How long should completed export bundles remain downloadable?
- Should log exports redact anything for producers versus tenant admins?
- What replaces template-driven project creation in the UI and API?
