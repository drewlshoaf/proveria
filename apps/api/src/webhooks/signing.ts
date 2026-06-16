import { createHmac, randomBytes } from 'node:crypto';

export const WEBHOOK_SUPPORTED_EVENTS = [
  'attestation.confirmed',
  'attestation.failed',
  'receipt.issued',
] as const;

export type WebhookEventType = (typeof WEBHOOK_SUPPORTED_EVENTS)[number];

export const generateWebhookSecret = (): string =>
  `whsec_${randomBytes(32).toString('base64url')}`;

export const signWebhookPayload = (
  secret: string,
  timestamp: string,
  body: string,
): string => {
  const digest = createHmac('sha256', secret)
    .update(`${timestamp}.${body}`, 'utf8')
    .digest('hex');
  return `t=${timestamp},v1=${digest}`;
};

export const isWebhookEventType = (value: string): value is WebhookEventType =>
  WEBHOOK_SUPPORTED_EVENTS.includes(value as WebhookEventType);
