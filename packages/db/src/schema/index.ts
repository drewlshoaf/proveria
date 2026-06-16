// Drizzle schema for Proveria V1, M2 scope.
//
// public.* tables: identity (tenants, users, memberships, sessions), devices,
// pairing attempts, one-time tokens.
// audit.* table: audit_events.
//
// All cross-table references live in this single file because drizzle-kit's
// CJS loader doesn't follow NodeNext's `.js` → `.ts` rewrite for inter-file
// imports. Keep additions to this file as the schema grows; we can split when
// drizzle-kit catches up.
//
// See docs/v1 §7, §8, §9, §15, §19.1 and docs/protocol/v1/*.md.

import {
  pgEnum,
  pgSchema,
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  jsonb,
  integer,
  index,
  uniqueIndex,
  primaryKey,
} from 'drizzle-orm/pg-core';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const planEnum = pgEnum('plan', [
  'free',
  'team_starter',
  'team_pro',
  'enterprise',
]);

export const roleEnum = pgEnum('role', [
  'tenant_admin',
  'producer',
  'consumer',
]);

export const organizationRoleEnum = pgEnum('organization_role', [
  'organization_admin',
  'member',
]);

export const workspaceAccessModeEnum = pgEnum('workspace_access_mode', [
  'all_workspaces',
  'selected_workspaces',
  'none',
]);

export const platformEnum = pgEnum('platform', ['darwin', 'win32']);

export const projectVisibilityEnum = pgEnum('project_visibility', [
  'public',
  'private',
]);

export type Plan = (typeof planEnum.enumValues)[number];
export type Role = (typeof roleEnum.enumValues)[number];
export type OrganizationRole = (typeof organizationRoleEnum.enumValues)[number];
export type WorkspaceAccessMode =
  (typeof workspaceAccessModeEnum.enumValues)[number];
export type Platform = (typeof platformEnum.enumValues)[number];
export type ProjectVisibility =
  (typeof projectVisibilityEnum.enumValues)[number];

// ---------------------------------------------------------------------------
// Identity — tenants, users, memberships, sessions
// ---------------------------------------------------------------------------

export const organizations = pgTable(
  'organizations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    projectNoun: text('project_noun').notNull().default('Project'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (table) => ({
    nameIdx: index('organizations_name_idx').on(table.name),
  }),
);

export const tenants = pgTable(
  'tenants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id').references(() => organizations.id, {
      onDelete: 'cascade',
    }),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    plan: planEnum('plan').notNull().default('free'),
    projectNoun: text('project_noun').notNull().default('Project'),
    isPersonal: boolean('is_personal').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (table) => ({
    slugIdx: uniqueIndex('tenants_slug_idx').on(table.slug),
    organizationIdx: index('tenants_organization_idx').on(table.organizationId),
    planIdx: index('tenants_plan_idx').on(table.plan),
  }),
);

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // Normalized to lowercase in app code before insert.
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    displayName: text('display_name'),
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    deactivatedAt: timestamp('deactivated_at', { withTimezone: true }),
  },
  (table) => ({
    emailIdx: uniqueIndex('users_email_idx').on(table.email),
  }),
);

export const tenantMemberships = pgTable(
  'tenant_memberships',
  {
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: roleEnum('role').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.tenantId, table.userId] }),
    userIdx: index('tenant_memberships_user_idx').on(table.userId),
  }),
);

export const organizationMemberships = pgTable(
  'organization_memberships',
  {
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    orgRole: organizationRoleEnum('org_role').notNull().default('member'),
    workspaceAccessMode: workspaceAccessModeEnum('workspace_access_mode')
      .notNull()
      .default('selected_workspaces'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.organizationId, table.userId] }),
    userIdx: index('organization_memberships_user_idx').on(table.userId),
    accessIdx: index('organization_memberships_access_idx').on(
      table.organizationId,
      table.workspaceAccessMode,
      table.revokedAt,
    ),
  }),
);

export const sessions = pgTable(
  'sessions',
  {
    // The session id is the secret bearer token, signed into an HTTP-only
    // cookie. Rotated on revoke. See docs/v1 §8.1.
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    ip: text('ip'),
    userAgent: text('user_agent'),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (table) => ({
    activeIdx: index('sessions_active_idx').on(
      table.userId,
      table.revokedAt,
      table.expiresAt,
    ),
    expiresIdx: index('sessions_expires_idx').on(table.expiresAt),
  }),
);

export const oidcIdentityProviders = pgTable(
  'oidc_identity_providers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: text('slug').notNull(),
    displayName: text('display_name').notNull(),
    issuerUrl: text('issuer_url').notNull(),
    authorizationEndpoint: text('authorization_endpoint').notNull(),
    tokenEndpoint: text('token_endpoint').notNull(),
    jwksUri: text('jwks_uri').notNull(),
    clientId: text('client_id').notNull(),
    clientSecretRef: text('client_secret_ref'),
    scopes: jsonb('scopes').$type<string[]>().notNull().default([
      'openid',
      'email',
      'profile',
    ]),
    claimMapping: jsonb('claim_mapping')
      .$type<Record<string, string>>()
      .notNull()
      .default({}),
    allowedDomains: jsonb('allowed_domains')
      .$type<string[]>()
      .notNull()
      .default([]),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    slugIdx: uniqueIndex('oidc_identity_providers_slug_idx').on(table.slug),
    enabledIdx: index('oidc_identity_providers_enabled_idx').on(table.enabled),
  }),
);

export const externalIdentities = pgTable(
  'external_identities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    providerId: uuid('provider_id')
      .notNull()
      .references(() => oidcIdentityProviders.id, { onDelete: 'cascade' }),
    providerSubject: text('provider_subject').notNull(),
    email: text('email').notNull(),
    emailVerified: boolean('email_verified').notNull().default(false),
    displayName: text('display_name'),
    avatarUrl: text('avatar_url'),
    claims: jsonb('claims').notNull().default({}),
    linkedAt: timestamp('linked_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    disconnectedAt: timestamp('disconnected_at', { withTimezone: true }),
  },
  (table) => ({
    providerSubjectIdx: uniqueIndex('external_identities_provider_subject_idx')
      .on(table.providerId, table.providerSubject),
    userProviderIdx: index('external_identities_user_provider_idx').on(
      table.userId,
      table.providerId,
      table.disconnectedAt,
    ),
    emailIdx: index('external_identities_email_idx').on(table.email),
  }),
);

export const oidcAuthStates = pgTable(
  'oidc_auth_states',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    providerId: uuid('provider_id')
      .notNull()
      .references(() => oidcIdentityProviders.id, { onDelete: 'cascade' }),
    stateHash: text('state_hash').notNull(),
    nonceHash: text('nonce_hash').notNull(),
    codeVerifier: text('code_verifier').notNull(),
    codeChallenge: text('code_challenge').notNull(),
    flow: text('flow').notNull().default('sign_in'),
    connectUserId: uuid('connect_user_id').references(() => users.id, {
      onDelete: 'cascade',
    }),
    redirectTo: text('redirect_to'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
  },
  (table) => ({
    stateHashIdx: uniqueIndex('oidc_auth_states_state_hash_idx').on(
      table.stateHash,
    ),
    providerActiveIdx: index('oidc_auth_states_provider_active_idx').on(
      table.providerId,
      table.expiresAt,
      table.consumedAt,
    ),
  }),
);

// ---------------------------------------------------------------------------
// Devices + device pairing
// ---------------------------------------------------------------------------

export const devices = pgTable(
  'devices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    // Local profile namespace per docs/v1 §9.3. Generated on the desktop.
    profileId: uuid('profile_id').notNull(),
    // Ed25519 public key, base64url-encoded (43 chars). See docs/v1 §15.1.1.
    publicKey: text('public_key').notNull(),
    name: text('name').notNull(),
    platform: platformEnum('platform').notNull(),
    appVersion: text('app_version').notNull(),
    // Supported protocol version range, e.g. { min: "1.0", max: "1.0" }.
    protocolCompatibility: jsonb('protocol_compatibility'),
    pairedAt: timestamp('paired_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (table) => ({
    identityKey: uniqueIndex('devices_identity_key').on(
      table.tenantId,
      table.userId,
      table.profileId,
      table.publicKey,
    ),
    publicKeyIdx: uniqueIndex('devices_public_key_idx').on(table.publicKey),
    tenantUserIdx: index('devices_tenant_user_idx').on(
      table.tenantId,
      table.userId,
    ),
  }),
);

export const devicePairingAttempts = pgTable(
  'device_pairing_attempts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // User-facing short code (8-char alphanumeric).
    code: text('code').notNull(),
    tenantId: uuid('tenant_id').references(() => tenants.id, {
      onDelete: 'set null',
    }),
    userId: uuid('user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    deviceId: uuid('device_id').references(() => devices.id, {
      onDelete: 'set null',
    }),
    ephemeralPublicKey: text('ephemeral_public_key').notNull(),
    platform: platformEnum('platform').notNull(),
    appVersion: text('app_version').notNull(),
    ip: text('ip'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    deniedAt: timestamp('denied_at', { withTimezone: true }),
  },
  (table) => ({
    codeIdx: uniqueIndex('device_pairing_attempts_code_idx').on(table.code),
    activeIdx: index('device_pairing_attempts_active_idx').on(
      table.expiresAt,
      table.consumedAt,
    ),
  }),
);

// ---------------------------------------------------------------------------
// One-time tokens — email verification and password reset
// ---------------------------------------------------------------------------
// Tokens are generated as opaque random strings and stored hashed (SHA-256,
// base64url). Plaintext tokens never persist server-side.

export const emailVerificationTokens = pgTable(
  'email_verification_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
  },
  (table) => ({
    tokenHashIdx: uniqueIndex('email_verification_tokens_hash_idx').on(
      table.tokenHash,
    ),
    activeIdx: index('email_verification_tokens_active_idx').on(
      table.userId,
      table.consumedAt,
      table.expiresAt,
    ),
  }),
);

export const passwordResetTokens = pgTable(
  'password_reset_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
  },
  (table) => ({
    tokenHashIdx: uniqueIndex('password_reset_tokens_hash_idx').on(
      table.tokenHash,
    ),
    activeIdx: index('password_reset_tokens_active_idx').on(
      table.userId,
      table.consumedAt,
      table.expiresAt,
    ),
  }),
);

// ---------------------------------------------------------------------------
// API keys — V4 commercial API credentials
// ---------------------------------------------------------------------------
// Workspace-bound bearer credentials for machine clients. The current data
// model stores workspaces in the tenants table; plaintext API keys are returned
// only once on creation, and the database stores a stable display prefix plus
// SHA-256(key) base64url.

export const apiKeys = pgTable(
  'api_keys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    keyPrefix: text('key_prefix').notNull(),
    keyHash: text('key_hash').notNull(),
    scopes: jsonb('scopes').$type<string[]>().notNull().default([]),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    usageCount: integer('usage_count').notNull().default(0),
    lastUsedMethod: text('last_used_method'),
    lastUsedPath: text('last_used_path'),
    lastUsedStatusCode: integer('last_used_status_code'),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (table) => ({
    tenantIdx: index('api_keys_tenant_idx').on(table.tenantId),
    keyHashIdx: uniqueIndex('api_keys_hash_idx').on(table.keyHash),
    prefixIdx: index('api_keys_prefix_idx').on(table.keyPrefix),
  }),
);

export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    apiKeyId: uuid('api_key_id')
      .notNull()
      .references(() => apiKeys.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    method: text('method').notNull(),
    path: text('path').notNull(),
    requestHash: text('request_hash').notNull(),
    statusCode: integer('status_code').notNull(),
    responseBody: jsonb('response_body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    identityIdx: uniqueIndex('idempotency_keys_identity_idx').on(
      table.tenantId,
      table.apiKeyId,
      table.method,
      table.path,
      table.key,
    ),
    tenantTimeIdx: index('idempotency_keys_tenant_time_idx').on(
      table.tenantId,
      table.createdAt,
    ),
  }),
);

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------
// Tenant-scoped containers for attestations. Slug is unique within a tenant
// (the same slug can be reused across tenants). template_slug references one
// of the six fixed system templates in @proveria/shared-types — not an FK
// because templates aren't a DB-managed resource in V1 (docs/v1 §10.2).
// Archive via archived_at; no hard deletion in V1 (docs/v1 §10.1).

export const projects = pgTable(
  'projects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    templateSlug: text('template_slug').notNull(),
    classification: text('classification'),
    tags: jsonb('tags').notNull().default([]),
    visibility: projectVisibilityEnum('visibility').notNull(),
    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (table) => ({
    tenantSlugIdx: uniqueIndex('projects_tenant_slug_idx').on(
      table.tenantId,
      table.slug,
    ),
    tenantIdx: index('projects_tenant_idx').on(table.tenantId),
    templateIdx: index('projects_template_idx').on(table.templateSlug),
  }),
);

// ---------------------------------------------------------------------------
// Attestations + submission attempts
// ---------------------------------------------------------------------------
// docs/v1 §11. Label is unique per project (UNIQUE constraint enforced via
// composite index below). state is text (not enum) so adding lifecycle states
// (e.g. queued_for_publication / publishing) in M4+ doesn't require a
// migration. Object keys live directly on the attestation row per §7.3 once
// confirmed; the leaves / receipt fields are reserved for M4–M8 work and
// land null in C10.
//
// submission_attempts captures the per-upload state; an attestation can have
// multiple failed/canceled attempts. confirmed_attempt_id on attestations
// points at the single canonical attempt (set on confirmation).

export const attestations = pgTable(
  'attestations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    description: text('description'),
    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => users.id),
    // Null for public API-created attestations, where the manifest is signed
    // by Proveria's platform key instead of a paired desktop device.
    createdByDeviceId: uuid('created_by_device_id').references(() => devices.id),
    state: text('state').notNull().default('pending'),
    confirmedAttemptId: uuid('confirmed_attempt_id'),
    // Merkle root of the confirmed attempt, lowercase hex. Set by the worker
    // on confirmation; the manifest in object storage is authoritative but a
    // queryable copy here saves an S3 fetch for client + proof-package reads.
    merkleRoot: text('merkle_root'),
    manifestObjectKey: text('manifest_object_key'),
    leavesObjectKey: text('leaves_object_key'),
    receiptJsonObjectKey: text('receipt_json_object_key'),
    receiptPdfObjectKey: text('receipt_pdf_object_key'),
    // Stable id for the confirmed attestation's signed receipt package — the
    // PDF + consumer verification URL key off it. Set by the receipt-generation
    // worker job (docs/v1 §18).
    packageId: text('package_id'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    canceledAt: timestamp('canceled_at', { withTimezone: true }),
    failedAt: timestamp('failed_at', { withTimezone: true }),
  },
  (table) => ({
    projectLabelIdx: uniqueIndex('attestations_project_label_idx').on(
      table.projectId,
      table.label,
    ),
    tenantStateIdx: index('attestations_tenant_state_idx').on(
      table.tenantId,
      table.state,
    ),
    projectIdx: index('attestations_project_idx').on(table.projectId),
  }),
);

export const submissionAttempts = pgTable(
  'submission_attempts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    attestationId: uuid('attestation_id')
      .notNull()
      .references(() => attestations.id, { onDelete: 'cascade' }),
    state: text('state').notNull().default('pending'),
    manifestObjectKey: text('manifest_object_key'),
    // Per-attempt artifact keys (docs/v1 §7.3). Each attempt owns an immutable
    // prefix; leaves.jsonl + validation-result.json are written by the worker
    // alongside the uploaded manifest.json — on success *and* failure, so
    // failed attempts retain their evidence.
    leavesObjectKey: text('leaves_object_key'),
    validationResultObjectKey: text('validation_result_object_key'),
    sourceMetadata: jsonb('source_metadata')
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    validationError: text('validation_error'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    uploadedAt: timestamp('uploaded_at', { withTimezone: true }),
    validatedAt: timestamp('validated_at', { withTimezone: true }),
    failedAt: timestamp('failed_at', { withTimezone: true }),
  },
  (table) => ({
    attestationIdx: index('submission_attempts_attestation_idx').on(
      table.attestationId,
    ),
    attestationStateIdx: index('submission_attempts_attestation_state_idx').on(
      table.attestationId,
      table.state,
    ),
  }),
);

// ---------------------------------------------------------------------------
// Attestation access grants (M7 / C24)
// ---------------------------------------------------------------------------
// Authorization for a specific email/user to perform scoped lookup against a
// private attestation. Per docs/v1 §16.2, Team/Enterprise private lookup
// requires consumer login + explicit attestation-specific grant. Tenant admins
// manage these; producers can't.
//
// Two states:
//   - pending: granted_to_user_id is NULL, token_hash is set. The recipient
//     hasn't registered yet; they'll claim the grant by registering with
//     ?grant=<token>, which fills in granted_to_user_id + claimed_at.
//   - claimed: granted_to_user_id is set (token_hash may still be present
//     as audit trail but is no longer redeemable once claimed_at is set).
//
// granted_to_email is always set so admins can list pending invites by who
// they were sent to, even before the recipient has an account.
//
// Revocation is soft (revoked_at). Re-granting a previously-revoked email is
// a new row — the table is its own audit trail.

export const attestationAccessGrants = pgTable(
  'attestation_access_grants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    attestationId: uuid('attestation_id')
      .notNull()
      .references(() => attestations.id, { onDelete: 'cascade' }),
    // Denormalized so tenant-scoped queries don't need to join attestations.
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    grantedToEmail: text('granted_to_email').notNull(),
    grantedToUserId: uuid('granted_to_user_id').references(() => users.id, {
      onDelete: 'cascade',
    }),
    // SHA-256(token) base64url. Only meaningful while pending — once
    // claimed_at is set, the token is single-use spent.
    tokenHash: text('token_hash'),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    grantedByUserId: uuid('granted_by_user_id')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (table) => ({
    attestationIdx: index('grants_attestation_idx').on(table.attestationId),
    userActiveIdx: index('grants_user_active_idx').on(
      table.grantedToUserId,
      table.revokedAt,
    ),
    tokenHashIdx: index('grants_token_hash_idx').on(table.tokenHash),
  }),
);

// ---------------------------------------------------------------------------
// Attestation access requests (V2)
// ---------------------------------------------------------------------------
// A verifier who opens a lookup link without an active grant can request access.
// Producers/admins resolve the request; approval creates/reuses an active
// attestation_access_grant, while denial leaves no grant behind.

export const attestationAccessRequests = pgTable(
  'attestation_access_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    attestationId: uuid('attestation_id')
      .notNull()
      .references(() => attestations.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    requestedByUserId: uuid('requested_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    requestedByEmail: text('requested_by_email').notNull(),
    message: text('message'),
    status: text('status').notNull().default('pending'),
    resolutionReason: text('resolution_reason'),
    resolvedByUserId: uuid('resolved_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    attestationStatusIdx: index('access_requests_attestation_status_idx').on(
      table.attestationId,
      table.status,
    ),
    tenantStatusIdx: index('access_requests_tenant_status_idx').on(
      table.tenantId,
      table.status,
      table.createdAt,
    ),
    requesterStatusIdx: index('access_requests_requester_status_idx').on(
      table.requestedByUserId,
      table.status,
    ),
  }),
);

// ---------------------------------------------------------------------------
// Verification results (M7 / C26)
// ---------------------------------------------------------------------------
// One row per consumer lookup. The signed result package itself lives in
// object storage at result_object_key; this row indexes it by package_id and
// records who looked up what. Per docs/v1 §19.1.

export const verificationResults = pgTable(
  'verification_results',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Stable id used in URLs + embedded in the package's `package_id` field. */
    packageId: text('package_id').notNull().unique(),
    attestationId: uuid('attestation_id')
      .notNull()
      .references(() => attestations.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** Nullable in case unauthenticated public lookups land later. */
    lookedUpByUserId: uuid('looked_up_by_user_id').references(
      () => users.id,
      { onDelete: 'set null' },
    ),
    resultType: text('result_type').notNull(),
    submittedHash: text('submitted_hash').notNull(),
    resultObjectKey: text('result_object_key').notNull(),
    signed: text('signed').notNull(), // 'true' | 'false' — paid tier signs.
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    attestationIdx: index('verification_results_attestation_idx').on(
      table.attestationId,
    ),
    userTimeIdx: index('verification_results_user_time_idx').on(
      table.lookedUpByUserId,
      table.createdAt,
    ),
  }),
);

// ---------------------------------------------------------------------------
// Verification links (M8 / C28)
// ---------------------------------------------------------------------------
// A verification_link is the shareable URL token embedded in a PDF's QR +
// verification URL (docs/v1 §18.4). It points at either a receipt
// (target_type='receipt', target_ref=attestation_id) or a lookup result
// (target_type='lookup_result', target_ref=package_id).
//
// Per §18.4, tenant admins can expire / revoke / rotate links. Revoking a
// link does NOT invalidate the underlying signed package — it just makes
// the share URL stop resolving.

export const verificationLinks = pgTable(
  'verification_links',
  {
    /** Short prefixed id used in URLs (e.g. 'vrf_<24hex>'). */
    id: text('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    targetType: text('target_type').notNull(), // 'receipt' | 'lookup_result'
    /** attestation_id for 'receipt'; package_id for 'lookup_result'. */
    targetRef: text('target_ref').notNull(),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (table) => ({
    targetIdx: index('verification_links_target_idx').on(
      table.targetType,
      table.targetRef,
    ),
    tenantTimeIdx: index('verification_links_tenant_time_idx').on(
      table.tenantId,
      table.createdAt,
    ),
  }),
);

export const exportJobs = pgTable(
  'export_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    kind: text('kind').notNull(),
    status: text('status').notNull().default('completed'),
    filters: jsonb('filters').notNull().default({}),
    manifest: jsonb('manifest'),
    artifactCount: integer('artifact_count').notNull().default(0),
    rowCount: integer('row_count').notNull().default(0),
    resultObjectKey: text('result_object_key'),
    error: text('error'),
    progressPercent: integer('progress_percent').notNull().default(100),
    retryCount: integer('retry_count').notNull().default(0),
    maxRetries: integer('max_retries').notNull().default(3),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    retentionPolicy: jsonb('retention_policy').notNull().default({
      retention_days: 30,
      delete_after_expiration: false,
    }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => ({
    tenantCreatedIdx: index('export_jobs_tenant_created_idx').on(
      table.tenantId,
      table.createdAt,
    ),
    createdByIdx: index('export_jobs_created_by_idx').on(
      table.createdByUserId,
    ),
    statusIdx: index('export_jobs_status_idx').on(table.status),
  }),
);

// ---------------------------------------------------------------------------
// Webhook endpoints + deliveries (V4)
// ---------------------------------------------------------------------------
// Tenant-scoped outbound integrations. Endpoint secrets are generated by
// Proveria and used to HMAC-sign delivery payloads. Delivery rows are the
// durable log/retry substrate; the sender worker advances status.

export const webhookEndpoints = pgTable(
  'webhook_endpoints',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    url: text('url').notNull(),
    description: text('description'),
    events: jsonb('events').$type<string[]>().notNull().default([]),
    signingSecret: text('signing_secret').notNull(),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    disabledAt: timestamp('disabled_at', { withTimezone: true }),
  },
  (table) => ({
    tenantTimeIdx: index('webhook_endpoints_tenant_time_idx').on(
      table.tenantId,
      table.createdAt,
    ),
    tenantActiveIdx: index('webhook_endpoints_tenant_active_idx').on(
      table.tenantId,
      table.disabledAt,
    ),
  }),
);

export const webhookDeliveries = pgTable(
  'webhook_deliveries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    endpointId: uuid('endpoint_id')
      .notNull()
      .references(() => webhookEndpoints.id, { onDelete: 'cascade' }),
    eventType: text('event_type').notNull(),
    payload: jsonb('payload').notNull(),
    signature: text('signature').notNull(),
    status: text('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }),
    lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }),
    responseStatus: integer('response_status'),
    responseBody: text('response_body'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    endpointTimeIdx: index('webhook_deliveries_endpoint_time_idx').on(
      table.endpointId,
      table.createdAt,
    ),
    tenantStatusIdx: index('webhook_deliveries_tenant_status_idx').on(
      table.tenantId,
      table.status,
      table.createdAt,
    ),
  }),
);

// ---------------------------------------------------------------------------
// Tenant invitations
// ---------------------------------------------------------------------------
// Used to invite a teammate to an existing tenant. Token stored hashed; the
// plaintext token is delivered via the notification provider. The invited
// email is normalized to lowercase before insert and must match the accepting
// user's email at acceptance time.

export const tenantInvitations = pgTable(
  'tenant_invitations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    invitedByUserId: uuid('invited_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    role: roleEnum('role').notNull(),
    tokenHash: text('token_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    acceptedByUserId: uuid('accepted_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (table) => ({
    tokenHashIdx: uniqueIndex('tenant_invitations_token_hash_idx').on(
      table.tokenHash,
    ),
    tenantEmailIdx: index('tenant_invitations_tenant_email_idx').on(
      table.tenantId,
      table.email,
    ),
    activeIdx: index('tenant_invitations_active_idx').on(
      table.expiresAt,
      table.acceptedAt,
      table.revokedAt,
    ),
  }),
);

// ---------------------------------------------------------------------------
// Audit schema — audit.audit_events
// ---------------------------------------------------------------------------
// Hash-chain rows, checkpoints, and exports are Enterprise-only and arrive in
// M9 — V1 ships only the flat events table. See docs/v1 §19.

export const auditSchema = pgSchema('audit');

export const auditEvents = auditSchema.table(
  'audit_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id').references(() => tenants.id, {
      onDelete: 'set null',
    }),
    actorUserId: uuid('actor_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    actorDeviceId: uuid('actor_device_id').references(() => devices.id, {
      onDelete: 'set null',
    }),
    // Category aligns with the rows in docs/v1 §19.3. Kept as text (not enum)
    // so adding categories doesn't require a migration.
    category: text('category').notNull(),
    action: text('action').notNull(),
    targetType: text('target_type'),
    targetId: text('target_id'),
    payload: jsonb('payload').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    tenantTimeIdx: index('audit_events_tenant_time_idx').on(
      table.tenantId,
      table.createdAt,
    ),
    actorUserTimeIdx: index('audit_events_actor_user_time_idx').on(
      table.actorUserId,
      table.createdAt,
    ),
    categoryActionIdx: index('audit_events_category_action_idx').on(
      table.category,
      table.action,
    ),
  }),
);

// ---------------------------------------------------------------------------
// audit.audit_event_hash_chain  (M9 / C32) — Enterprise hash-chained audit
// ---------------------------------------------------------------------------
// One row per audit_event for Enterprise tenants. Each row's this_hash is
// SHA-256(prev_hash || RFC 8785 canonical bytes of the event). Genesis row
// for a tenant uses prev_hash = 32 zero bytes. Together with the per-tenant
// monotonic sequence number, this gives tamper-evident append-only audit.
// Spec is provisional pending the audit-v1 amendment (docs/protocol/v1).

export const auditEventHashChain = auditSchema.table(
  'audit_event_hash_chain',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    eventId: uuid('event_id')
      .notNull()
      .references(() => auditEvents.id, { onDelete: 'cascade' }),
    /** 1-indexed, monotonic per tenant. */
    sequenceNum: integer('sequence_num').notNull(),
    /** Previous row's this_hash; 32 zero bytes for the tenant's first entry. */
    prevHash: text('prev_hash').notNull(),
    /** SHA-256(prev_hash || canonical(event)) — lowercase hex. */
    thisHash: text('this_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    tenantSeqIdx: uniqueIndex('audit_chain_tenant_seq_idx').on(
      table.tenantId,
      table.sequenceNum,
    ),
    eventIdx: uniqueIndex('audit_chain_event_idx').on(table.eventId),
  }),
);

// ---------------------------------------------------------------------------
// audit.audit_checkpoints  (M9 / C33) — Enterprise checkpoints
// ---------------------------------------------------------------------------
// Periodic Merkle root over a contiguous window of chain entries
// [first_seq, last_seq]. Future: Arbitrum anchoring (M14+) records the root
// on-chain. Computed via the Protocol V1 Merkle helpers (same rules as
// attestations).

export const auditCheckpoints = auditSchema.table(
  'audit_checkpoints',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    firstSeq: integer('first_seq').notNull(),
    lastSeq: integer('last_seq').notNull(),
    /** Merkle root (hex) over chain entries' this_hash values in [first_seq, last_seq]. */
    merkleRoot: text('merkle_root').notNull(),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    tenantTimeIdx: index('audit_checkpoints_tenant_time_idx').on(
      table.tenantId,
      table.createdAt,
    ),
  }),
);

// ---------------------------------------------------------------------------
// Drizzle-inferred row types
// ---------------------------------------------------------------------------

export type Tenant = typeof tenants.$inferSelect;
export type NewTenant = typeof tenants.$inferInsert;
export type Organization = typeof organizations.$inferSelect;
export type NewOrganization = typeof organizations.$inferInsert;
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type TenantMembership = typeof tenantMemberships.$inferSelect;
export type NewTenantMembership = typeof tenantMemberships.$inferInsert;
export type OrganizationMembership =
  typeof organizationMemberships.$inferSelect;
export type NewOrganizationMembership =
  typeof organizationMemberships.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
export type OidcIdentityProvider =
  typeof oidcIdentityProviders.$inferSelect;
export type NewOidcIdentityProvider =
  typeof oidcIdentityProviders.$inferInsert;
export type ExternalIdentity = typeof externalIdentities.$inferSelect;
export type NewExternalIdentity = typeof externalIdentities.$inferInsert;
export type OidcAuthState = typeof oidcAuthStates.$inferSelect;
export type NewOidcAuthState = typeof oidcAuthStates.$inferInsert;
export type Device = typeof devices.$inferSelect;
export type NewDevice = typeof devices.$inferInsert;
export type DevicePairingAttempt = typeof devicePairingAttempts.$inferSelect;
export type NewDevicePairingAttempt =
  typeof devicePairingAttempts.$inferInsert;
export type EmailVerificationToken =
  typeof emailVerificationTokens.$inferSelect;
export type NewEmailVerificationToken =
  typeof emailVerificationTokens.$inferInsert;
export type PasswordResetToken = typeof passwordResetTokens.$inferSelect;
export type NewPasswordResetToken = typeof passwordResetTokens.$inferInsert;
export type ApiKey = typeof apiKeys.$inferSelect;
export type NewApiKey = typeof apiKeys.$inferInsert;
export type IdempotencyKey = typeof idempotencyKeys.$inferSelect;
export type NewIdempotencyKey = typeof idempotencyKeys.$inferInsert;
export type WebhookEndpoint = typeof webhookEndpoints.$inferSelect;
export type NewWebhookEndpoint = typeof webhookEndpoints.$inferInsert;
export type WebhookDelivery = typeof webhookDeliveries.$inferSelect;
export type NewWebhookDelivery = typeof webhookDeliveries.$inferInsert;
export type ExportJob = typeof exportJobs.$inferSelect;
export type NewExportJob = typeof exportJobs.$inferInsert;
export type TenantInvitation = typeof tenantInvitations.$inferSelect;
export type NewTenantInvitation = typeof tenantInvitations.$inferInsert;
export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
export type Attestation = typeof attestations.$inferSelect;
export type NewAttestation = typeof attestations.$inferInsert;
export type SubmissionAttempt = typeof submissionAttempts.$inferSelect;
export type NewSubmissionAttempt = typeof submissionAttempts.$inferInsert;
export type AuditEvent = typeof auditEvents.$inferSelect;
export type NewAuditEvent = typeof auditEvents.$inferInsert;
export type AuditEventHashChain = typeof auditEventHashChain.$inferSelect;
export type NewAuditEventHashChain = typeof auditEventHashChain.$inferInsert;
export type AuditCheckpoint = typeof auditCheckpoints.$inferSelect;
export type NewAuditCheckpoint = typeof auditCheckpoints.$inferInsert;
export type AttestationAccessRequest =
  typeof attestationAccessRequests.$inferSelect;
export type NewAttestationAccessRequest =
  typeof attestationAccessRequests.$inferInsert;
