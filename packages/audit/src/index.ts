// Audit event categories and action strings.
//
// Categories align with the rows in docs/v1 §19.3. Actions are dotted strings
// scoped to their category (e.g. `user.registered`, `session.revoked`).
//
// The category list is the full V1 surface; not every category emits events
// in M2 — projects, attestations, OCR, etc. arrive in later milestones.

export const AUDIT_CATEGORIES = {
  minimalRegistryHistory: 'minimal_registry_history',
  identitySession: 'identity_session',
  devicePairing: 'device_pairing',
  project: 'project',
  attestationLifecycle: 'attestation_lifecycle',
  validation: 'validation',
  verificationLookup: 'verification_lookup',
  proofResultPackage: 'proof_result_package',
  accessControl: 'access_control',
  basicAdmin: 'basic_admin',
  templatePolicy: 'template_policy',
  cryptographic: 'cryptographic',
  customerManagedSigning: 'customer_managed_signing',
  blockchainAnchoring: 'blockchain_anchoring',
  auditIntegrity: 'audit_integrity',
  evidenceExport: 'evidence_export',
  securitySensitiveAdmin: 'security_sensitive_admin',
  systemWorker: 'system_worker',
  rateLimitAbuse: 'rate_limit_abuse',
  retentionDeletion: 'retention_deletion',
  supportAdminTooling: 'support_admin_tooling',
  apiSdkWebhook: 'api_sdk_webhook',
} as const;

export type AuditCategory =
  (typeof AUDIT_CATEGORIES)[keyof typeof AUDIT_CATEGORIES];

/** Action strings emitted by the M2 identity / session / device flows. */
export const AUDIT_ACTIONS = {
  userRegistered: 'user.registered',
  userEmailVerified: 'user.email_verified',
  userEmailVerificationRequested: 'user.email_verification_requested',
  loginSucceeded: 'login.succeeded',
  loginFailed: 'login.failed',
  oidcSignInSucceeded: 'oidc.sign_in_succeeded',
  oidcSignInFailed: 'oidc.sign_in_failed',
  externalIdentityConnected: 'external_identity.connected',
  externalIdentityDisconnected: 'external_identity.disconnected',
  sessionCreated: 'session.created',
  sessionRevoked: 'session.revoked',
  passwordResetRequested: 'password_reset.requested',
  passwordResetCompleted: 'password_reset.completed',
  // Tenancy / membership / invitation events (M2 / C7)
  tenantCreated: 'tenant.created',
  tenantArchived: 'tenant.archived',
  tenantRestored: 'tenant.restored',
  tenantSettingsUpdated: 'tenant.settings_updated',
  tenantInvitationCreated: 'tenant_invitation.created',
  tenantInvitationAccepted: 'tenant_invitation.accepted',
  tenantInvitationRevoked: 'tenant_invitation.revoked',
  tenantMemberAdded: 'tenant_member.added',
  tenantMemberAccessChanged: 'tenant_member.access_changed',
  tenantMemberRemoved: 'tenant_member.removed',
  // Device events (M2 / C8)
  devicePairingInitiated: 'device_pairing.initiated',
  devicePairingApproved: 'device_pairing.approved',
  devicePairingCompleted: 'device_pairing.completed',
  deviceMinted: 'device.minted',
  deviceRevoked: 'device.revoked',
  // Project events (M3 / C9)
  projectCreated: 'project.created',
  projectArchived: 'project.archived',
  projectRestored: 'project.restored',
  // Attestation lifecycle events (M3 / C10+)
  attestationCreated: 'attestation.created',
  attestationSourceGoogleDriveSubmitted:
    'attestation.source_google_drive_submitted',
  attestationManifestUploaded: 'attestation.manifest_uploaded',
  attestationFinalized: 'attestation.finalized',
  attestationValidated: 'attestation.validated',
  attestationValidationFailed: 'attestation.validation_failed',
  attestationConfirmed: 'attestation.confirmed',
  attestationCanceled: 'attestation.canceled',
  // Receipt lifecycle events (M5 / C18+)
  receiptIssued: 'receipt.issued',
  // Consumer access grants (M7 / C24+)
  attestationAccessGranted: 'attestation_access.granted',
  attestationAccessRevoked: 'attestation_access.revoked',
  attestationAccessRequested: 'attestation_access.requested',
  attestationAccessRequestApproved: 'attestation_access_request.approved',
  attestationAccessRequestDenied: 'attestation_access_request.denied',
  // Verification lookups (M7 / C26+)
  verificationLookupPerformed: 'verification.lookup_performed',
  // Verification link lifecycle (M8 / C29+)
  verificationLinkRevoked: 'verification_link.revoked',
  verificationLinkExpired: 'verification_link.expired',
  verificationLinkRotated: 'verification_link.rotated',
  // Enterprise audit checkpoints (M9 / C33+)
  auditCheckpointCreated: 'audit_checkpoint.created',
  auditExportCreated: 'audit_export.created',
  evidenceExportCreated: 'evidence_export.created',
  evidenceExportExpired: 'evidence_export.expired',
  // V4 API platform credentials
  apiKeyCreated: 'api_key.created',
  apiKeyRevoked: 'api_key.revoked',
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

export {
  CHAIN_GENESIS_HEX,
  appendChainEntryIfEnterprise,
  canonicalAuditEventBytes,
  computeChainHash,
  writeAuditEvent,
  type WriteAuditEventInput,
} from './chain.js';

export const AUDIT_PACKAGE_VERSION = '0.0.0';
