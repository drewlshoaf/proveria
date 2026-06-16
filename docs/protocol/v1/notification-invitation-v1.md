# Proveria Notification and Invitation V1

> Cross-reference: [docs/v1](../../v1) §8.1 (auth/notifications), §16.2 (consumer access).

## Status

Draft

## Owner

Product / Architecture

## Reviewers

Engineering

## Purpose

Define V1 notification, invite, verification-code, and password-reset behavior across local development, internal demo, pilot, staging, and production.

This spec gates Milestones 2, 7, and 15.

## Goals

- Define notification provider abstraction.
- Define local logged-code mode.
- Define pilot/prod email delivery.
- Define consumer invite flow.
- Define email verification flow.
- Define password reset flow.
- Define production logging restrictions.

## Non-Goals

- Build marketing email.
- Build notification preferences.
- Build SMS.
- Build full transactional messaging analytics.

## Providers

Required providers:

- `LogNotificationProvider`
- `EmailNotificationProvider`

Pilot default:

- Resend

Alternatives:

- AWS SES
- Postmark

Provider selected by environment config.

## Environment Behavior

| Environment       | Provider                  | Code logging |
| ----------------- | ------------------------- | ------------ |
| Local development | LogNotificationProvider   | Allowed      |
| Internal demo     | LogNotificationProvider   | Allowed      |
| Staging           | EmailNotificationProvider | Not allowed  |
| Pilot/production  | EmailNotificationProvider | Not allowed  |

Codes must not be logged in production.

## Email Types

V1 requires:

- email verification
- password reset
- consumer invitation
- device pairing confirmation if needed

## Consumer Invitation Flow

1. Tenant Admin grants consumer access to specific attestation.
2. System creates invitation record.
3. Email notification sent.
4. Consumer accepts invite.
5. Consumer creates account or logs in.
6. Consumer gets scoped access to attestation.

Rules:

- producers cannot invite consumers in V1
- access is attestation-specific
- invite expiration required
- invite revocation required
- invite acceptance audit-logged

## Email Verification

Define:

- code/token lifetime
- resend behavior
- rate limits
- lockouts
- audit events

## Password Reset

Define:

- token lifetime
- rate limits
- one-time use
- audit events
- production logging restrictions

## Device Pairing Notification

Optional V1 behavior:

- send email when a device is paired
- send email when device is revoked

Decision required:

- include in V1 pilot or defer?

## Security Rules

- no codes in production logs
- no plaintext secrets in email beyond one-time tokens/links
- tokens stored hashed where practical
- all acceptance/reset events audit-logged
- generic responses for unknown emails where appropriate

## Templates

Define basic templates for:

- verify email
- reset password
- consumer invitation
- device paired
- device revoked

## Approval Checklist

- [ ] Product / Architecture review complete
- [ ] Engineering review complete
- [ ] Provider abstraction approved
- [ ] Pilot provider selected
- [ ] Approved for Milestones 2, 7, and 15
