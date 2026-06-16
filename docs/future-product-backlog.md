# Future Product Backlog

This backlog is intentionally not slotted to versions. Use it to collect major
commercial, developer-platform, and enterprise-integration tracks before they
are shaped into release plans.

## Shaped Release Tracks

- V6 is now shaped as the API-first developer platform release with AI dataset
  provenance as the flagship commercial use case. See `docs/v6-roadmap.md` and
  `docs/v6-completion-checklist.md`.

## Product Workflow And Usability

Goal: make the core user workflows simple enough that product semantics can
drive the developer platform, not the other way around.

- Verifier experience polish:
  - simplify lookup and result pages;
  - reduce crypto-first language;
  - clarify match, no-match, content proof, exact image proof, receipt, and
    result package language;
  - make missing access, revoked access, and request-access states coherent.
- Producer attestation workflow polish:
  - add drag-and-drop file submission;
  - improve multi-file progress;
  - automatically reveal attestation detail when submission confirms;
  - clear the new attestation form when users return to create another record.
- Requests and access workflow:
  - manage verifier grants in a searchable/sortable/filterable table;
  - manage access requests in a searchable/sortable/filterable table;
  - keep request reasons, approval reasons, denial reasons, and final denial
    behavior clear.
- Projects and navigation:
  - simplify project detail views;
  - make workspace switching explicit;
  - remove project/file templates from user-facing flows unless a future
    decision reintroduces them with a clear purpose.
- Records, receipts, verifications, and events language:
  - standardize names across desktop, verifier web, public pages, PDFs, JSON,
    CLI, SDKs, and API docs;
  - distinguish public receipt verification from private verifier lookup;
  - keep Events as the user-facing name for audit history.
- Freeform attestation tags are intentionally not being pursued right now.

## Organization Terminology And Industry Language Templates

Goal: let Proveria adapt to the language of larger organizations and regulated
industries without forking the product or hard-coding vertical-specific copy.

- Tenant-configurable terminology for core product concepts, starting with
  user-facing labels such as Projects and other nouns that vary by industry.
- A terminology dictionary model that stores canonical product keys with
  customer-specific singular, plural, title-case, lowercase, and possessive
  display values where needed.
- Admin controls for selecting, previewing, editing, and resetting organization
  terminology.
- Industry language templates that load predefined terminology sets, such as
  Banking, Legal, Healthcare, Insurance, Government, and Media/Publishing.
- Template versioning so future terminology updates can be reviewed, diffed,
  applied, or ignored by existing organizations.
- Clear fallback behavior when a configured term is missing, invalid, or
  incompatible with a particular UI context.
- Full app audit of hard-coded user-facing nouns across desktop, verifier web,
  public verification pages, emails/notifications, PDFs, JSON artifacts, API
  docs, SDK examples, CLI help text, exports, and support copy.
- Shared terminology rendering helpers for product surfaces so teams do not
  manually interpolate configured language in scattered components.
- Guardrails for grammar, capitalization, length, and accessibility so custom
  terms do not break layouts or make the product confusing.
- Permission model: decide whether only tenant admins, workspace admins, or a
  new brand/settings role can change terminology.
- Audit events for template selection, terminology edits, resets, and version
  upgrades.
- Import/export for terminology sets so enterprise customers and implementation
  teams can review language outside the app.
- Open decision: whether terminology is organization-wide only or can vary by
  workspace for multi-division enterprises.
- Open decision: whether the terminology system should also support full UI
  localization by natural language, or stay focused on customer/industry
  vocabulary inside English-first copy.

## Timelines

Goal: give organizations a traceable, evidence-rich history for important
objects and actors, turning raw audit events into lineage views that are easy
to inspect, export, and explain.

- Attestation timelines that show the full lineage of an attestation from
  creation through confirmation, receipt issuance, access changes,
  verification attempts, public-link activity, revocation/expiration events,
  exports, and related administrative changes.
- User timelines that show a user's lifecycle and activity history, including
  invitation, acceptance, role changes, workspace/project access changes,
  attestations created, verification actions, access requests, approvals,
  denials, exports, API-key actions, and other auditable events.
- Milestone-based timeline UI with dates, actors, event labels, status,
  evidence, proofs, receipts, verification results, links, and downloadable
  artifacts attached to the relevant points in time.
- Filtering and grouping by event type, actor, workspace, project, proof type,
  date range, and risk/status so long histories remain usable.
- Deep links from attestation detail, user/admin screens, records, receipts,
  verification results, access requests, events, and export manifests into the
  relevant timeline point.
- Exportable timeline packages for legal, compliance, customer support, and
  incident-review workflows, starting with PDF and JSON.
- API support for fetching timeline data with stable event ordering,
  pagination, and permission-aware redaction.
- Permission model that decides who can view full user timelines, who can view
  attestation timelines, and which events should be hidden or redacted from
  non-admin users.
- Data model review to ensure every timeline milestone can point back to the
  underlying canonical event, proof, receipt, result package, export, or access
  decision.
- Open decision: whether timelines should be generated entirely from immutable
  event history or allow curated milestone annotations by admins.
- Open decision: whether "user timeline" should be named "actor timeline" in
  the product model so future API keys, service accounts, and integrations can
  share the same lineage surface.

## Blockchain And External Anchoring

Goal: let customers add an external timestamp and integrity anchor for
high-assurance attestations and audit histories without making blockchain
infrastructure mandatory for every workflow.

- Tenant-configurable anchoring providers, starting with Arbitrum and Optimism,
  with an extension point for additional L2s or external timestamp authorities.
- Admin controls for choosing the default anchoring provider, enabling or
  disabling anchoring by workspace/project, and deciding which workflows require
  anchoring.
- Attestation anchoring that records a commitment for selected attestations or
  attestation batches on the configured chain/provider.
- Audit checkpoint anchoring that records Merkle roots for tenant audit
  hash-chain checkpoints on the configured chain/provider.
- Provider abstraction for transaction creation, submission, confirmation,
  retry, failure handling, finality policy, gas/fee reporting, and explorer
  links.
- Receipt, result package, timeline, export, and verifier UI updates that show
  anchoring status, provider, transaction id, block/time, confirmation state,
  committed root/hash, and verification instructions.
- Public and private verification flows that can independently check an
  anchored commitment against the relevant chain/provider.
- Anchoring policy options for immediate anchoring, scheduled batch anchoring,
  manual admin-triggered anchoring, and anchoring only for selected
  high-assurance records.
- Cost controls and billing model for per-transaction fees, batching strategy,
  customer-funded wallets, Proveria-managed wallets, or bring-your-own-wallet
  setups.
- Key and wallet custody review covering Proveria-managed keys,
  customer-managed wallets, KMS/HSM integration, rotation, revocation, and
  disaster recovery.
- Audit events for provider configuration, anchoring requests, transaction
  submissions, confirmations, failures, retries, and policy changes.
- API, CLI, SDK, webhook, and OpenAPI updates for anchoring configuration,
  status, receipts, verification, and export metadata.
- Testnet/sandbox support so enterprise customers can validate integrations
  before enabling production anchoring.
- Open decision: whether anchoring should commit every attestation separately,
  batch multiple attestations into Merkle roots, anchor audit checkpoints only,
  or support all three modes.
- Open decision: whether the product language should say "blockchain
  anchoring", "external anchoring", or provider-specific names in user-facing
  surfaces.

## OIDC Identity And Google Drive

Goal: let users sign in through a generic OIDC provider and attest Google Drive
files without muddying the privacy model.

- Generic OIDC authentication provider driver for Microsoft Entra ID/Azure AD,
  Okta, Google, and compatible OIDC providers.
- Microsoft Entra ID/Azure AD configured as the first concrete OIDC provider.
- Google configured next through the same provider driver so Drive import can
  use the linked Google identity.
- External identity connection and disconnection from Profile.
- Google Drive file picker/import.
- Drive-sourced attestation metadata that records source provider without
  weakening the proof boundary.
- Recommended first implementation: Drive files are downloaded by the desktop
  for local hashing and content proof generation. Hosted ingestion is a later
  enterprise integration option, not the V5 default.
- Clear in-product privacy language for what Proveria reads, hashes, stores,
  and never stores.
- Audit events for OIDC sign-in, external identity connection, Drive file
  selection, and Drive-sourced attestation submission.
- API, CLI, SDK, and webhook updates once the product model is settled.
- See `docs/v5-oidc-and-drive-design.md`.

## Commercial API Platform

Goal: make Proveria usable as a commercial API, not only as the desktop app.

- Public API versioning strategy, starting with `/v1` or equivalent explicit
  compatibility policy.
- API key model for machine clients, separate from desktop device keys.
- Scoped API credentials for producer, verifier, admin, and integration roles.
- OpenAPI spec generated from the live API contract.
- API reference docs with examples for attestation creation, lookup, receipts,
  verifier access, access requests, audit export, and public verification links.
- Rate-limit model by tenant, credential, endpoint, and plan.
- Idempotency keys for submission, access-grant, and webhook-retry workflows.
- Request signing guidance for high-assurance producer integrations.
- Sandbox tenant mode with sample data and deterministic examples.
- Commercial API error model with stable codes, remediation text, retryability,
  and support correlation ids.
- API usage analytics by tenant and credential.
- API key rotation workflows and audit trails for scheduled expiration changes.
- Internal API compatibility tests before releases.
- Future V5-driven updates for workspace-scoped membership, Google-sourced
  attestations, log export, evidence export jobs, and template removal.

## Webhooks

Goal: let customers connect Proveria events into their own systems without
polling.

- Tenant-configured webhook endpoints.
- Event catalog:
  - attestation created
  - attestation confirmed
  - attestation failed
  - receipt issued
  - verifier access granted
  - verifier access revoked
  - access requested
  - access request approved
  - access request denied
  - lookup match issued
  - lookup no-match issued
  - public verification link created
  - public verification link revoked/expired/rotated
- Signed webhook deliveries with timestamp and replay protection.
- Delivery retries with exponential backoff and dead-letter visibility.
- Webhook delivery logs in the desktop/admin surface.
- Test event sender.
- Webhook endpoint health status.
- Per-event payload schemas and examples.
- Webhook secret rotation.
- Optional customer-managed event retention policy.

## CLI

Goal: provide scriptable producer and verifier workflows for developers,
records teams, and enterprise automation.

- `proveria login` / device or API-key authentication.
- `proveria projects list/create/archive/restore`.
- `proveria attest file <path>` for whole-file attestations.
- `proveria attest text <path>` for text/PDF content proof attestations.
- `proveria attest batch <folder>` with progress, resumability, and summary
  output.
- `proveria verify file <path> --attestation <id>`.
- `proveria verify passage --attestation <id>`.
- `proveria receipt get/open/export`.
- `proveria access grant/revoke/list`.
- `proveria requests approve/deny/list`.
- JSON output mode for CI and enterprise scripts.
- Local-only hash/shingle mode for offline compatibility checks.
- Exit codes suitable for CI pipelines.
- Signed artifact verification offline where possible.
- Homebrew tap support so macOS/Linux users can run
  `brew install proveria` or `brew install proveria/tap/proveria`.
- npm, direct binary, and other package distribution paths after the CLI
  release shape stabilizes.

## TypeScript SDK

Goal: make Proveria easy to integrate into Node, browser, Electron, and CMS
ecosystems.

- Typed API client generated from the OpenAPI contract.
- First-class helpers for file hashing, passage hashing, and PDF text extraction
  where browser/runtime support allows.
- Device-signed request helpers for desktop-like producer integrations.
- API-key client for server-side integrations.
- Webhook signature verification helper.
- Receipt/result package verification helpers.
- Retry, idempotency, and pagination helpers.
- Browser-safe bundle for verifier-side hashing.
- Node-only bundle for server-side automation.
- Examples for Next.js, Express/Fastify, Electron, and worker queues.

## Python SDK

Goal: support enterprise data, legal, compliance, and ML workflows where Python
is the default integration language.

- Typed-ish Python client with Pydantic models.
- File hashing and passage hashing helpers.
- PDF text extraction compatibility path, if deterministic enough.
- API-key workflows for server-side integrations.
- Webhook signature verification helper.
- Receipt/result package verification helpers.
- CLI wrapper or shared core with the standalone CLI where practical.
- Jupyter/notebook examples for audit and dataset-review workflows.
- Airflow/Dagster examples for scheduled provenance jobs.

## Browser Extensions

Goal: let verifiers and producers work from the web surfaces where evidence is
actually reviewed.

- Chrome extension for hashing the current page, selected text, downloaded
  files, or user-selected local files.
- Browser-side passage proof generation from selected text.
- "Verify with Proveria" context menu action.
- Receipt/result package viewer in-extension.
- Lookup-link handoff from extension to verifier web client.
- Enterprise-managed extension configuration.
- Privacy review: clearly state what page content is read, hashed, or never
  transmitted.
- Future: source-site capture metadata if legally and technically appropriate.

## Perceptual Image Similarity

Goal: let producers and verifiers make conservative visual-similarity claims
for images that are not byte-for-byte identical, without confusing similarity
with exact proof.

- Product decision: keep perceptual hashing out of the active V3.0.0 scope
  until threshold policy, false-positive handling, and result language are
  reviewed.
- Select a first perceptual hash algorithm:
  - dHash
  - pHash
  - aHash
  - block mean hash
  - library-backed combination
- Define distance thresholds for:
  - match
  - borderline or low-confidence result
  - no-match
- Decide which transformations are supported:
  - resized images
  - recompressed JPEGs
  - metadata-stripped files
  - format conversion
  - cropped images
  - color-shifted images
- Build a fixture corpus with known expected outcomes for resized,
  recompressed, cropped, color-shifted, and unrelated images.
- Define result language that avoids claiming pixel identity, authorship,
  originality, or copyright ownership.
- Define receipt/result metadata for perceptual method/version, threshold, and
  observed distance.
- Decide whether public artifacts should expose distances, threshold bands, or
  only conservative labels.
- Add producer-side perceptual hash generation only after policy is documented.
- Add verifier-side perceptual lookup only after no-match and borderline
  language is accepted.

## CMS Plugins

Goal: support publishers and content-heavy teams at their system of record.

- WordPress plugin for attesting posts, pages, media, and revisions.
- Drupal plugin for nodes, media, and revision history.
- Contentful app for entries/assets and release workflows.
- Sanity plugin for documents and published revisions.
- Strapi plugin for collections and media.
- Ghost plugin for articles/newsletters.
- Webflow integration for page snapshots and published states.
- Plugin UX:
  - attest selected content
  - attest on publish
  - attest scheduled snapshots
  - show receipt links in admin
  - grant verifier access from CMS context
  - export evidence package for a content item
- Content model mapping from CMS revisions to Proveria projects/attestations.
- Support for canonical URLs and publication timestamps as metadata, without
  weakening the hash/proof boundary.

## Industry-Specific CMS And Enterprise Plugins

Goal: meet buyers inside their existing workflows.

### Media And Publishing

- newsroom CMS integrations
- article revision attestation
- syndication/licensing proof packages
- takedown/dispute evidence exports
- contributor/source-document intake attestations

### Legal

- document management system integrations
- matter-level project mapping
- litigation hold export packages
- privileged document boundary attestations
- expert/witness verifier access workflows

### Financial Services

- model-risk documentation attestations
- policy and approval workflow evidence
- regulatory exam response packages
- audit-workpaper references
- retention and supervision integrations

### Healthcare And Life Sciences

- protocol/report/version attestation
- clinical evidence package provenance
- regulated-data exclusion proofs
- IRB/research packet attestations
- privacy-preserving verifier workflows

### Government And Defense

- controlled-unclassified-information provenance workflows
- procurement package attestations
- authority-to-operate evidence exports
- isolated/self-hosted deployment drivers
- strict audit and key-management integration

### AI Labs And Dataset Builders

- training-data inventory attestations
- licensed-content audit workflows
- publisher/verifier access packages
- dataset revision receipts
- model-card provenance attachments

## Enterprise Integration Drivers

Goal: make Proveria fit large-organization procurement, security, compliance,
and operations.

- Enterprise SSO:
  - OIDC-based single sign-on for Okta, Google Workspace, and Microsoft Entra
    ID/Azure AD;
  - SAML 2.0 single sign-on for enterprise identity providers that require it;
  - tenant-level identity provider configuration, metadata upload/import, and
    test connection workflow;
  - domain verification and optional domain-based SSO discovery;
  - just-in-time user creation with safe defaults for role and workspace access;
  - admin controls for requiring SSO, allowing password/device fallback, and
    managing break-glass admin access;
  - role, group, and workspace mapping from identity provider claims where
    supported;
  - sign-in, sign-out, session duration, reauthentication, and account-linking
    behavior across desktop, verifier web, public pages, CLI, SDKs, and API
    key administration;
  - audit events for SSO configuration changes, sign-in attempts, successful
    sign-ins, failures, account linking, and provider disablement;
  - documentation and setup guides for Okta, Google Workspace, Microsoft Entra
    ID/Azure AD, and generic SAML/OIDC providers.
- SCIM user and group provisioning.
- Admin-only account member management separated from personal account settings.
- Workspace-scoped memberships for internal users.
- Admin-managed workspace restrictions:
  - selected workspaces;
  - org-admin all-workspace authority;
  - revocation of workspace access.
- Org-admin workspace creation and archive/restore management.
- Project scope within workspaces.
- Workspace scope enforcement across projects, attestations, events, receipts,
  verification results, access grants, API credentials, CLI, SDKs, and webhooks.
- System-wide verifier management with revocation across workspaces,
  attestations, and projects.
- Verifier lookup history for admins and permitted producers, including who
  checked what, when, and whether the result was a match or no-match.
- Customer-managed signing keys.
- KMS/HSM integration.
- Tenant-level retention policies.
- Evidence export bundles for legal/audit systems.
- Admin log export by organization, workspace, project, actor, date range,
  category, and action.
- Full evidence/artifact dump by actor, project, workspace, or organization,
  including receipts, receipt JSON, result packages, verification metadata, and
  event history.
- Export jobs with progress, retry, expiration, and audit events.
- SIEM export for audit and security events.
- Data residency controls.
- Private cloud / self-host deployment path.
- Admin API for tenant provisioning and policy management.
- Support/admin tooling with read-only investigation surfaces.
- Backup/restore and disaster-recovery runbooks.
- Enterprise observability: queues, failed jobs, webhook health, API usage.
- Contractual controls: DPA, subprocessor list, security questionnaire package.

## V3 Admin, Membership, And Verifier Governance

Goal: make organization-scale administration clear enough that admins can manage
internal users, external verifiers, workspace scope, and lookup history without
digging through individual attestations.

### Account Members

- Pull members out of account settings into a dedicated top-level Members area.
- Make the Members area visible to admins only.
- Keep account settings focused on the signed-in user's own profile, session,
  and device state.
- Let admins invite, remove, and review internal users from the dedicated
  Members area.
- Preserve current role boundaries: producers should not be able to manage
  account members unless they are also admins.

### Membership Verifiers

- Add Verifiers under Membership so admins can see every verifier across the
  system.
- Show verifier identity, grant status, related workspaces, projects,
  attestations, last lookup time, and revocation state.
- Let admins revoke verifier access from one system-wide list instead of
  hunting through individual attestations.
- Distinguish internal account members from external verifiers in navigation,
  copy, and audit language.
- Support search and filters by email, workspace, project, attestation, status,
  and recent activity.

### Workspace-Scoped Membership

- Allow admins to restrict a member's access to one or more workspaces.
- Make unrestricted account-wide membership explicit, not implicit.
- Ensure producers only see and act within workspaces they are assigned to.
- Ensure workspace-scoped membership applies consistently to projects,
  attestations, verifier grants, access requests, audit views, and receipts.
- Record membership scope changes in audit history.

### Verifier Lookup History And Results

- Let admins see when a verifier checked an attestation and what the result was.
- Let producers see verifier lookup history and results for attestations they
  own or workspaces they are allowed to access.
- Show lookup timestamp, verifier identity, attestation/project/workspace,
  lookup type, match/no-match result, receipt/result package id, and revocation
  context.
- Keep plaintext out of admin and producer views; show submitted hashes and
  result metadata only.
- Add filters for verifier, attestation, workspace, result type, lookup type,
  and date range.
- Audit lookup visibility so sensitive verifier activity access is itself
  reviewable.

### Open Product Questions

- Should Membership contain both Members and Verifiers as tabs, or should
  Members be a top-level item and Verifiers live under Membership?
- Do workspace restrictions apply only to internal members, or should verifier
  grants also support workspace-level defaults?
- Should producer lookup visibility be limited to attestations they created, or
  all attestations in assigned workspaces?
- What revocation action should be available from the system-wide Verifiers
  list: revoke one grant, all grants in a workspace, or all verifier access?
- How long should verifier lookup history be retained by plan?

## Developer Experience And Go-To-Market Enablement

- Public docs site with API, CLI, SDK, webhook, and integration guides.
- Quickstarts for producer, verifier, API-only, and CMS/plugin workflows.
- Sample apps:
  - publisher proof portal
  - legal evidence-room demo
  - AI training-data audit demo
  - CMS publish-and-attest demo
- Postman/Insomnia collections.
- Reference Terraform or Docker Compose deployments.
- Integration certification checklist.
- Partner/plugin marketplace concept.
- Changelog and deprecation policy.

## Product Questions To Resolve Before Prioritizing

- Which customer motion comes first: API-first developers, CMS-heavy publishers,
  legal/compliance enterprises, or AI dataset builders?
- Should the CLI be a reference implementation, a commercial product surface, or
  both?
- Should CMS plugins attest content automatically on publish, or require explicit
  human action?
- Which API credentials are safe for browser-side use, if any?
- How much verifier identity should receipts expose by default?
- Should webhook payloads include only ids and fetch links, or denormalized
  event summaries?
- Which integrations require customer-managed signing before they are credible?
- What is the minimum "commercial grade" API bar for pilot customers?
