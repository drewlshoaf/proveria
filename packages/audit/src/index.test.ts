import { describe, it, expect } from 'vitest';
import {
  AUDIT_PACKAGE_VERSION,
  AUDIT_CATEGORIES,
  AUDIT_ACTIONS,
} from './index.js';

describe('@proveria/audit', () => {
  it('exports a semver version string', () => {
    expect(AUDIT_PACKAGE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('exposes every audit category from docs/v1 §19.3 (22 total)', () => {
    expect(Object.keys(AUDIT_CATEGORIES)).toHaveLength(22);
    expect(AUDIT_CATEGORIES.identitySession).toBe('identity_session');
    expect(AUDIT_CATEGORIES.devicePairing).toBe('device_pairing');
  });

  it('exposes M2 actions for identity/session/device flows', () => {
    expect(AUDIT_ACTIONS.userRegistered).toBe('user.registered');
    expect(AUDIT_ACTIONS.sessionRevoked).toBe('session.revoked');
    expect(AUDIT_ACTIONS.devicePairingCompleted).toBe(
      'device_pairing.completed',
    );
  });

  it('exposes M2/C7 actions for tenant + invitation flows', () => {
    expect(AUDIT_ACTIONS.tenantInvitationCreated).toBe(
      'tenant_invitation.created',
    );
    expect(AUDIT_ACTIONS.tenantInvitationAccepted).toBe(
      'tenant_invitation.accepted',
    );
    expect(AUDIT_ACTIONS.tenantMemberAdded).toBe('tenant_member.added');
    expect(AUDIT_ACTIONS.tenantMemberAccessChanged).toBe(
      'tenant_member.access_changed',
    );
    expect(AUDIT_ACTIONS.tenantMemberRemoved).toBe('tenant_member.removed');
  });

  it('exposes V5 audit export actions', () => {
    expect(AUDIT_ACTIONS.auditExportCreated).toBe('audit_export.created');
    expect(AUDIT_ACTIONS.evidenceExportCreated).toBe(
      'evidence_export.created',
    );
    expect(AUDIT_ACTIONS.evidenceExportExpired).toBe(
      'evidence_export.expired',
    );
  });
});
