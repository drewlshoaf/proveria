import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LogNotificationProvider } from './provider.js';

describe('LogNotificationProvider', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    process.env.NODE_ENV = 'development';
  });

  afterEach(() => {
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
  });

  it('writes a verification line containing the token to its log sink', async () => {
    const lines: string[] = [];
    const provider = new LogNotificationProvider((line) => lines.push(line));
    await provider.sendEmailVerification({
      to: 'alice@example.com',
      userId: 'u_123',
      token: 'TOKEN_ABC',
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('email_verification');
    expect(lines[0]).toContain('alice@example.com');
    expect(lines[0]).toContain('TOKEN_ABC');
  });

  it('writes a password reset line containing the token to its log sink', async () => {
    const lines: string[] = [];
    const provider = new LogNotificationProvider((line) => lines.push(line));
    await provider.sendPasswordReset({
      to: 'bob@example.com',
      userId: 'u_456',
      token: 'RESET_XYZ',
    });
    expect(lines[0]).toContain('password_reset');
    expect(lines[0]).toContain('bob@example.com');
    expect(lines[0]).toContain('RESET_XYZ');
  });

  it('writes a tenant invitation line with tenant + role + token', async () => {
    const lines: string[] = [];
    const provider = new LogNotificationProvider((line) => lines.push(line));
    await provider.sendTenantInvitation({
      to: 'invitee@example.com',
      tenantName: 'Acme',
      tenantSlug: 'acme',
      invitedByEmail: 'admin@example.com',
      role: 'producer',
      token: 'INVITE_QRS',
    });
    expect(lines[0]).toContain('tenant_invitation');
    expect(lines[0]).toContain('invitee@example.com');
    expect(lines[0]).toContain('tenant=acme');
    expect(lines[0]).toContain('role=producer');
    expect(lines[0]).toContain('INVITE_QRS');
  });

  it('writes an attestation access grant line with token when pending', async () => {
    const lines: string[] = [];
    const provider = new LogNotificationProvider((line) => lines.push(line));
    await provider.sendAttestationAccessGrant({
      to: 'consumer@example.com',
      tenantName: 'Acme',
      attestationLabel: 'invoice-42',
      grantedByEmail: 'admin@example.com',
      token: 'GRANT_ABC',
    });
    expect(lines[0]).toContain('attestation_access_grant');
    expect(lines[0]).toContain('consumer@example.com');
    expect(lines[0]).toContain('attestation=invoice-42');
    expect(lines[0]).toContain('GRANT_ABC');
  });

  it('marks the access grant as existing-account when no token is minted', async () => {
    const lines: string[] = [];
    const provider = new LogNotificationProvider((line) => lines.push(line));
    await provider.sendAttestationAccessGrant({
      to: 'consumer@example.com',
      tenantName: 'Acme',
      attestationLabel: 'invoice-42',
      grantedByEmail: 'admin@example.com',
      token: null,
    });
    expect(lines[0]).toContain('attestation_access_grant');
    expect(lines[0]).toContain('(existing-account)');
  });

  it('refuses to construct in production', () => {
    process.env.NODE_ENV = 'production';
    expect(() => new LogNotificationProvider()).toThrow(
      /must not be used in production/,
    );
  });
});
