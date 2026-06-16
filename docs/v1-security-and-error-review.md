# V1 Security And Expected-Error Review

This is the final release-facing review of the implemented desktop-first V1
security model and user-facing expected errors. It is a companion to
`docs/v1-completion-checklist.md`, `docs/v1-known-limitations.md`, and
`docs/human-qa-checklist.md`.

## Review Scope

Reviewed implementation areas:

- Desktop credential login and local device-key minting.
- Device-signed desktop API requests.
- Tenant roles: `tenant_admin`, `producer`, and verifier/consumer accounts.
- Project, attestation, receipt, verifier-access, invitation, member, device,
  audit, lookup, and public verification-link routes.
- Desktop and verifier client handling for expected auth, access, validation,
  revoked, expired, and rate-limit failures.
- Automated negative-path coverage in API, desktop, and verifier smoke tests.

## Security Model Review

### Local Device Trust

- Desktop sign-in uses account credentials to mint a tenant-scoped device record.
- The server stores the device public key and metadata. The private key stays on
  the local machine and is used to sign desktop API requests.
- Device-signed requests bind method, path, body, timestamp, and device id.
- Revoked devices are rejected for future signed API requests.
- Sign-out revokes the current desktop device and removes local access.
- Unclean desktop shutdown does not revoke the device. This is intentional and
  documented in `docs/v1-known-limitations.md` so users are not locked out by a
  crash or forced quit.

Accepted V1 boundary: one active tenant membership is supported for desktop key
minting. Multi-workspace switching is a follow-up.

### Role And Tenant Isolation

- Tenant admins can manage members, invitations, trusted devices, project
  archive/restore, and full audit review.
- Producers can create projects, submit attestations, manage verifier access for
  their attestations, and see limited workflow audit events.
- Verifier/consumer accounts use the thin web client and cannot mint desktop
  devices without a producer/admin tenant membership.
- Non-members receive 404s on tenant-scoped resources where enumeration would be
  risky.
- Producers receive 403s for known admin-only actions when the tenant context is
  already established.

### Verification And Public Artifacts

- Producer file bytes are not uploaded in V1 whole-file flows. Desktop and
  verifier clients hash files locally.
- Verifier access is granted at the attestation level.
- Revoking verifier access blocks new scoped lookups.
- Previously issued public verification links can remain valid historical
  artifacts. This is documented as an accepted V1 limitation.
- No-match language is scoped to the specific attestation and lookup time.

### Audit Trail

- Security-sensitive admin actions, device lifecycle events, verifier access
  changes, verification-link lifecycle changes, and attestation workflow events
  are written to the workspace audit log.
- Admins see the full workspace audit log.
- Producers see a limited workflow-scoped audit log.

## Expected-Error Matrix

| Surface | Scenario | Status / Code | User-facing expectation |
| --- | --- | --- | --- |
| Desktop sign-in | Wrong email or password | `401 invalid_credentials` | Show clear sign-in failure, no account enumeration. |
| Desktop sign-in | Verifier-only account tries to mint a device | `403 no_tenant_membership` | Explain that desktop requires a producer/admin workspace. |
| Desktop sign-in | Multi-tenant account mints a desktop key | `403 multiple_tenants_not_supported` | Treat as V1 unsupported workspace switching. |
| Device-signed API | Missing or invalid signature | `401` | Desktop shows load/action error with retry where applicable. |
| Device-signed API | Revoked device signs a request | `401` | User must sign in again to mint a fresh trusted device. |
| Projects | Invalid slug or template | `400` | Show validation failure. |
| Projects | Duplicate slug | `409 duplicate_project_slug` | Ask for a different slug. |
| Projects | Free project limit | `409 project_count_limit_reached` | Explain the plan limit. |
| Projects | Non-member tenant access | `404` | Do not reveal tenant/resource existence. |
| Projects | Producer/admin role mismatch | `403` | Hide or reject admin-only action. |
| Attestations | Duplicate label in project | `409 duplicate_attestation_label` | Ask for a different label. |
| Attestations | Wrong creating device tries to cancel | `403 wrong_device` | Explain only the creating desktop can cancel. |
| Attestations | Storage or monthly limit | `409 storage_limit_exceeded` / `monthly_attestation_limit_reached` | Explain the limit and avoid partial success. |
| Receipts | Receipt requested before issued | `404` | Show “not available yet” or retry status. |
| Verifier access | Non-member tries to grant access | `404` | Do not reveal attestation existence. |
| Verifier lookup | Not signed in | `401` | Redirect to sign-in and preserve `next`. |
| Verifier lookup | Missing/revoked/unshared attestation | `404` | Explain unavailable or no access. |
| Verifier lookup | Invalid SHA-256 | `400` | Tell verifier to submit a 64-character SHA-256. |
| Verifier lookup | Fair-use rate limit | `429 verification_rate_limit_exceeded` | Ask verifier to wait about a minute. |
| Public verification | Missing or revoked link | `404 unavailable` | Explain link is no longer available. |
| Public verification | Expired link | `410 expired` | Explain link expired and ask producer for a fresh link. |
| Invitations | Expired/invalid invitation token | `400 invalid_or_expired_invitation` | Ask for a fresh invite. |
| Invitations | Invitation email mismatch | `403 invitation_email_mismatch` | Ask user to use the invited email or request a new invite. |
| Grant registration | Expired/invalid grant token | `400 invalid_or_expired_grant` | Ask producer for a fresh share. |
| Grant registration | Grant email mismatch | `403 grant_email_mismatch` | Ask user to use the shared email or request a new share. |

## Automated Coverage Reviewed

- `apps/api/src/auth/routes.test.ts`
- `apps/api/src/devices/routes.test.ts`
- `apps/api/src/projects/routes.test.ts`
- `apps/api/src/attestations/routes.test.ts`
- `apps/api/src/tenants/routes.test.ts`
- `apps/api/src/me/routes.test.ts`
- `apps/desktop/src/smoke.ts`
- `apps/verifier/scripts/smoke-live.mjs`
- `apps/verifier/scripts/responsive-qa.mjs`

## Release Notes

- No new blocker was found in this review.
- The remaining risk is human QA breadth: role-by-role manual validation,
  fresh-machine setup, and final eval-account pass still need sign-off before
  tagging V1.
