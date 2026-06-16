// Notification provider abstraction.
// V1 ships LogNotificationProvider (codes printed to stdout); a real
// EmailNotificationProvider lands at M15 per docs/v1 §8.1 and
// docs/protocol/v1/notification-invitation-v1.md.

import { isProduction } from '../config.js';

export interface EmailVerificationMessage {
  to: string;
  userId: string;
  token: string;
}

export interface PasswordResetMessage {
  to: string;
  userId: string;
  token: string;
}

export interface TenantInvitationMessage {
  to: string;
  tenantName: string;
  tenantSlug: string;
  invitedByEmail: string;
  role: string;
  token: string;
}

export interface AttestationAccessGrantMessage {
  to: string;
  tenantName: string;
  attestationLabel: string;
  grantedByEmail: string;
  message?: string | null;
  // Only set when the recipient doesn't yet have an account — they use this
  // to register and auto-claim the grant. If the recipient already has an
  // account, no token is minted (the grant is claimed immediately) and
  // they're pointed at /login.
  token: string | null;
}

export interface NotificationProvider {
  sendEmailVerification(message: EmailVerificationMessage): Promise<void>;
  sendPasswordReset(message: PasswordResetMessage): Promise<void>;
  sendTenantInvitation(message: TenantInvitationMessage): Promise<void>;
  sendAttestationAccessGrant(
    message: AttestationAccessGrantMessage,
  ): Promise<void>;
}

/**
 * Dev-mode provider that writes notifications to a sink. Refuses to run in
 * production because plaintext tokens must never appear in production logs.
 *
 * Two sink shapes are accepted so both production code (pino-style logger)
 * and tests (array-of-strings collector) can use the same provider without
 * adapter layers:
 *   - `(message: string) => void` — legacy plain sink; tests and dev console
 *   - `{ info: (...) => void }` — pino-shaped sink; the api wires its
 *     Fastify logger here so notifications inherit the structured fields
 *     (service, requestId, env) every other log line carries.
 */
export type NotificationSink =
  | ((message: string) => void)
  | { info: (obj: Record<string, unknown>, message: string) => void };

const isPinoShaped = (
  sink: NotificationSink,
): sink is { info: (obj: Record<string, unknown>, message: string) => void } =>
  typeof sink !== 'function';

export class LogNotificationProvider implements NotificationProvider {
  constructor(private readonly sink: NotificationSink = console.log) {
    if (isProduction()) {
      throw new Error(
        'LogNotificationProvider must not be used in production — ' +
          'set NODE_ENV != production or wire EmailNotificationProvider.',
      );
    }
  }

  private emit(
    kind:
      | 'email_verification'
      | 'password_reset'
      | 'tenant_invitation'
      | 'attestation_access_grant',
    fields: Record<string, unknown>,
    plain: string,
  ): void {
    if (isPinoShaped(this.sink)) {
      this.sink.info({ notification: kind, ...fields }, '[notify] ' + kind);
    } else {
      this.sink(plain);
    }
  }

  async sendEmailVerification(
    message: EmailVerificationMessage,
  ): Promise<void> {
    this.emit(
      'email_verification',
      { to: message.to, userId: message.userId, token: message.token },
      `[notify] email_verification to=${message.to} userId=${message.userId} token=${message.token}`,
    );
  }

  async sendPasswordReset(message: PasswordResetMessage): Promise<void> {
    this.emit(
      'password_reset',
      { to: message.to, userId: message.userId, token: message.token },
      `[notify] password_reset to=${message.to} userId=${message.userId} token=${message.token}`,
    );
  }

  async sendTenantInvitation(
    message: TenantInvitationMessage,
  ): Promise<void> {
    this.emit(
      'tenant_invitation',
      {
        to: message.to,
        tenant: message.tenantSlug,
        role: message.role,
        invitedBy: message.invitedByEmail,
        token: message.token,
      },
      `[notify] tenant_invitation to=${message.to} tenant=${message.tenantSlug} role=${message.role} invitedBy=${message.invitedByEmail} token=${message.token}`,
    );
  }

  async sendAttestationAccessGrant(
    message: AttestationAccessGrantMessage,
  ): Promise<void> {
    this.emit(
      'attestation_access_grant',
      {
        to: message.to,
        tenant: message.tenantName,
        attestation: message.attestationLabel,
        grantedBy: message.grantedByEmail,
        message: message.message ?? null,
        token: message.token,
      },
      `[notify] attestation_access_grant to=${message.to} tenant=${message.tenantName} attestation=${message.attestationLabel} grantedBy=${message.grantedByEmail} token=${message.token ?? '(existing-account)'} message=${JSON.stringify(message.message ?? '')}`,
    );
  }
}
