# V5 Remaining Human QA Checklist

Use this as the final manual gate before calling V5 shippable. Record tester
name, date, environment, browser, desktop OS, branch or commit, and issue links
for failed or accepted items.

## Setup

- [ ] Pull latest `main`.
- [ ] Run database migrations.
- [ ] Start local infra, API, worker, desktop, and verifier from
      `docs/getting-started.md`.
- [ ] Run `pnpm eval:seed`.
- [ ] Confirm desktop opens and signs in.
- [ ] Confirm verifier loads at `http://127.0.0.1:3003`.
- [ ] Confirm API health is available at `http://127.0.0.1:3001/healthz`.

## Automation Shortcut

Run this once the local API, worker, database, verifier, and seeded admin CLI
config are ready:

```bash
pnpm qa:v5:tail
```

This automates the non-visual portions of the full checklist:

- Setup probes for `pnpm eval:seed`, API health, and verifier page load.
- Events export JSON, CSV, category/project/actor/date filters, and log export
  audit events.
- Evidence export collect/check/get/list/filter/bundle packaging, evidence
  export audit events, and explicit expired bundle cleanup.
- Developer surface smoke for `/v1/openapi.json`, `pnpm cli:test`,
  `pnpm --filter @proveria/sdk test`, webhook catalog wording, and public
  developer language.
- Accepted-limitation wording for known limitations, Entra setup, generic OIDC,
  hidden Google surfaces, explicit cleanup, and broader webhook coverage
  deferral.

It writes artifacts under `.qa/` and prints the remaining manual/visual items
at the end. Use `V5_QA_SKIP_SEED=1 pnpm qa:v5:tail` to skip reseeding during
repeat runs.

## Core Regression Pass

- [ ] As `producer-eval@example.com`, submit a local file attestation with drag
      and drop.
- [ ] Submit multiple files and confirm progress is understandable.
- [ ] Confirm completed submissions reveal Attestation Detail.
- [ ] Return to New attestation and confirm prior submitted state is cleared.
- [ ] Confirm project/file templates are not shown in creation flows.
- [ ] Confirm verifier grants are searchable, sortable, filterable, and
      paginated.
- [ ] Confirm verifier access requests are searchable, sortable, filterable,
      and paginated.
- [ ] Approve and deny verifier requests with reasons.
- [ ] Confirm denied requests cannot be reconsidered unless a new request is
      created.
- [ ] Confirm handoff language uses private verifier lookup naming.

## Workspace And Admin Pass

- [ ] Sign in as `admin-producer-eval@example.com`.
- [ ] Confirm workspace switching is explicit and predictable.
- [ ] Create a new workspace as an org admin.
- [ ] Switch to the new workspace and confirm projects/attestations start empty.
- [ ] Create a project in the new workspace and confirm it does not appear when
      switching back to another workspace.
- [ ] Confirm Users shows members, invitations, trusted devices, and workspace
      access controls.
- [ ] Open a user from Users and confirm User Detail shows access controls and
      the user's current trusted device when one exists.
- [ ] Grant a member access to selected workspaces.
- [ ] Confirm the Users table shows each member's selected workspaces.
- [ ] Confirm selecting Admin shows an organization-wide power warning.
- [ ] Revoke a member from the current workspace.
- [ ] Confirm the current admin cannot accidentally remove their own remaining
      workspace access.
- [ ] Confirm projects remain scoped to the selected workspace.
- [ ] Confirm receipt/result artifacts do not present Proveria as an attestor or
      platform signer.

## Events And Exports

- [ ] Open Events as an admin.
- [ ] Confirm Events table search, category filter, sort, refresh, paging, and
      expandable detail rows work.
- [ ] Export Events as JSON with no filters.
- [ ] Export Events as CSV with no filters.
- [ ] Export Events filtered by category, project, actor, and date range.
- [ ] Confirm log export actions appear in Events.
- [ ] Create an evidence export with no filters.
- [ ] Confirm the manifest downloads.
- [ ] As an organization admin, create an organization-scoped evidence export
      and confirm the manifest includes attestations from multiple workspaces.
- [ ] Confirm Recent evidence exports shows the created job.
- [ ] Confirm Recent evidence exports shows job status/progress, retry count,
      and expiration/retention information clearly.
- [ ] Download the saved manifest from the Recent evidence exports row.
- [ ] Download the artifact bundle from the Recent evidence exports row.
- [ ] Run `proveria export jobs` and confirm the created job appears.
- [ ] Run `proveria export get <job-id> --output ./tmp-evidence-export.json`
      and confirm the saved manifest downloads.
- [ ] Run `proveria export bundle <job-id> --output ./tmp-evidence-bundle.json`
      and confirm the saved bundle includes the export manifest and artifact
      payloads or explicit missing artifact entries.
- [ ] Run `proveria export inspect ./tmp-evidence-bundle.json` and confirm it
      summarizes manifest counts, artifact paths, artifact byte sizes, and
      missing artifacts clearly.
- [ ] Run `proveria export unpack ./tmp-evidence-bundle.json --output ./tmp-evidence`
      and confirm it writes `manifest.json`, bundled artifact files, and
      `missing-artifacts.json` when any bundle entries are unavailable.
- [ ] Run `proveria export zip ./tmp-evidence-bundle.json --output ./tmp-evidence.zip`
      and confirm the archive contains `bundle.json`, `manifest.json`, artifact
      files, and `missing-artifacts.json` when needed.
- [ ] Run `proveria export tar ./tmp-evidence-bundle.json --output ./tmp-evidence.tar`
      and confirm the archive contains `bundle.json`, `manifest.json`, artifact
      files, and `missing-artifacts.json` when needed.
- [ ] Run `proveria export collect --limit 100 --output ./tmp-evidence-collect --zip ./tmp-evidence-collect.zip --tar ./tmp-evidence-collect.tar`
      and confirm it creates a job, downloads `bundle.json`, writes
      `manifest.json`, unpacks artifact files, writes `summary.json`, and
      creates ZIP and tar archives.
- [ ] Run `proveria export check ./tmp-evidence-collect` and confirm it reports
      the collected evidence package as valid and lists the checked files.
- [ ] Run `proveria export check ./tmp-evidence-bundle.json` and confirm it
      reports the standalone bundle as valid.
- [ ] Create evidence exports filtered by project and by actor.
- [ ] Confirm Recent evidence exports refresh works.
- [ ] Confirm evidence export actions appear in Events.
- [ ] Trigger explicit expired evidence export cleanup and confirm opted-in
      expired bundle objects are deleted, jobs are marked expired, object keys
      are cleared, and retention deletion audit events appear.

## Verifier Regression

- [ ] Open a private verifier lookup link while signed out.
- [ ] Sign in as `verifier-eval@example.com`.
- [ ] Confirm sign-in returns to the original lookup link.
- [ ] Verify a matching file hash.
- [ ] Verify a non-matching hash.
- [ ] Verify a matching content passage if the attestation has content proof.
- [ ] Open public result and receipt pages without sign-in.
- [ ] Confirm result PDF and receipt PDF load where expected.

## Developer Surface Smoke

- [ ] Confirm `/v1/openapi.json` loads.
- [ ] Run `pnpm cli:test`.
- [ ] Run `pnpm --filter @proveria/sdk test`.
- [ ] Confirm `docs/v5-webhook-catalog.md` lists supported and deferred V5
      webhook events clearly.
- [ ] Confirm `docs/v5-public-developer-language.md` uses finalized
      receipt/result/verification language.

## Accepted Limitations

- [ ] `docs/v5-known-limitations.md` is accepted.
- [ ] Microsoft Entra ID/Azure AD local setup is accepted from
      `docs/v5-entra-oidc-local-setup.md`.
- [ ] Generic OIDC sign-in is accepted as implemented for configured providers.
- [ ] Google sign-in, Google external identity connection, and Google Drive
      local import are accepted as hidden in this V5 build.
- [ ] Explicit cleanup of expired evidence export bundle objects is accepted;
      automatic cleanup scheduling remains an operational follow-up.
- [ ] Broader webhook event coverage is accepted as intentionally deferred.

## Sign-Off

- [ ] All blocking failures are linked to issues or PRs.
- [ ] Non-blocking limitations are accepted.
- [ ] Tester signs off with name and date.
