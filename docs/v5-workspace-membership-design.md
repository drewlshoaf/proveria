# V5 Workspace Membership Design

V5 introduces real workspace administration while keeping the current product
language simple:

- an organization owns users, billing, identity policy, and global exports;
- workspaces are the operational boundary for projects, attestations,
  verifier access, events, receipts, API keys, and Google Drive imports;
- projects remain inside exactly one workspace;
- admins grant a user access to selected workspaces, then revoke that access
  later. Org admin is the only all-workspace authority.

## Recommendation

Model workspace access explicitly rather than overloading project membership.

The current `tenants` table is already acting as a workspace. For V5, keep that
behavior but introduce an organization layer above it. This avoids a destructive
rename during product iteration while making the conceptual model clear:

```text
Organization
  Workspace
    Project
      Attestation
      Receipt
      Verification result
      Event
```

The UI should use `Workspace` for the current `tenant` concept. The API can keep
tenant path names internally until the public contract is updated.

## Access Modes

Workspace access should be represented as explicit selected-workspace grants:

- users receive access to one or more selected workspaces;
- removing the final workspace grant removes their workspace access;
- org admins are the only users who implicitly operate across all workspaces.

V5 should present roles as a flat product model, even while internal enum names
continue to migrate:

- `org_admin`: can do anything across all organization workspaces and can create
  new workspaces.
- `workspace_admin`: can manage one or more workspaces, including projects,
  attestations, verifier access, workspace users, events, and exports.
- `workspace_member`: can create attestations in assigned workspaces.
- `verifier`: can verify only through project- or attestation-scoped private
  lookup access. Verifiers are not general workspace members.

A user may hold any of these roles in any workspace. Organization admin is the
only role that implies all-workspace administrative access by default.

Current internal mappings during migration:

- `organization_admin` maps to `org_admin`.
- `tenant_admin` maps to `workspace_admin`.
- `producer` maps to `workspace_member`.
- `consumer` maps to `verifier`.

## Data Model Direction

Add the organization layer first, then migrate membership semantics without
breaking existing workspace-scoped records.

Recommended V5 tables/columns:

- `organizations`
  - `id`
  - `name`
  - `created_at`
- `tenants.organization_id`
  - existing tenant rows become workspaces under an organization
- `organization_memberships`
  - `organization_id`
  - `user_id`
  - `org_role`
  - `workspace_access_mode`
  - `created_at`
  - `revoked_at`
- `tenant_memberships`
  - remains the per-workspace role grant
  - source of truth for selected workspace access

For V5, avoid changing the proof-bearing tables unless needed. Projects,
attestations, receipts, verification results, access grants, API credentials,
and audit events should continue to carry their workspace id.

## Permission Rules

Access checks should follow this order:

1. Resolve the requested workspace.
2. Resolve the authenticated user.
3. Check organization membership is active.
4. If the user is an org admin, allow org-admin operations across workspaces.
5. Require an active selected-workspace grant for the workspace unless the user
   is an org admin.
6. For verifier operations, require project- or attestation-scoped verification
   access instead of workspace membership.

For device-signed desktop requests, a device should be bound to a user and
machine, not permanently to one workspace. The active workspace is selected by
the desktop session and each signed request must still pass the workspace access
check.

## API Impact

Private/internal API can keep existing `/tenants/:slug/...` paths during V5, but
responses should expose workspace language to the desktop.

Add or update endpoints in phases:

- `GET /me`
  - include organizations, available workspaces, active workspace candidates,
    and roles.
- `POST /auth/device/mint`
  - no longer rejects multiple workspace memberships;
  - returns selectable workspaces and a default active workspace.
- `GET /organizations/:id/workspaces`
  - list workspaces the current user can access.
- `POST /organizations/:id/members`
  - invite/add a user to selected workspaces.
- `PATCH /organizations/:id/members/:userId`
  - change selected workspaces, workspace role, and org admin flag.
- `DELETE /organizations/:id/members/:userId`
  - revoke organization/workspace access.

All changes must emit audit events.

## Desktop UX

Workspace selection should be explicit and boring:

- show the active workspace in the shell header as a dropdown;
- list only workspaces the signed-in user can access;
- switching workspace refreshes projects, attestations, requests, account,
  events, API credentials, and exports;
- account/admin pages show a `Workspace access` section;
- each member row shows:
  - email;
  - role;
  - selected workspace access;
  - org admin status;
  - revoke/edit controls.

Do not expose internal tenant ids or slugs unless needed for a developer/admin
debug view.

## Audit And Export Impact

Events should keep workspace scope and gain organization scope where useful:

- organization member added;
- organization member access changed;
- organization member revoked;
- workspace access granted;
- workspace access revoked;
- active workspace switched from desktop;
- export job created/downloaded.

Exports must enforce the same workspace access model:

- org-wide exports require an org-admin level permission;
- workspace exports require access to that workspace;
- project/actor filters cannot leak records outside accessible workspaces.

## Build Plan

1. Add organization model and backfill existing workspaces into one
   organization per current tenant/workspace owner.
2. Update `/me` and desktop session shape to return multiple available
   workspaces.
3. Add active workspace switching in desktop.
4. Remove the desktop device mint single-workspace restriction.
5. Add admin member access controls for selected workspaces.
6. Apply the access resolver to projects, attestations, events, receipts,
   verification results, access grants, API keys, and export jobs.
7. Update OpenAPI, CLI, SDK, webhooks, and docs after the product behavior is
   stable.

## Current Implementation Status

- Organization tables, organization memberships, and tenant organization ids
  exist.
- Existing workspace rows are backfilled into organizations.
- First-workspace creation creates an organization and organization membership.
- Org admins can create additional workspaces inside the current organization.
- Invitation acceptance creates the invited user's organization membership for
  the invited workspace.
- `/auth/me` and desktop device mint responses include organization and
  workspace choices.
- The desktop stores workspace choices and exposes an explicit workspace
  selector.
- The selector can switch the active workspace stored in the desktop session and
  refresh workspace-scoped views.
- Desktop device signing now represents the user/machine session. Each signed
  workspace request resolves and authorizes the requested workspace slug
  against the user's current organization/workspace access.

## Non-Goals

- Project-level user membership.
- Freeform attestation tags.
- Customer-managed signing keys.
- Renaming every internal `tenant` symbol in V5.
