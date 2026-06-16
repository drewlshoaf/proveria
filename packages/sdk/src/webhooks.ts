import { createHmac, timingSafeEqual } from 'node:crypto';

export interface WebhookVerificationInput {
  signingSecret: string;
  signatureHeader: string;
  body: string | Buffer;
  toleranceSeconds?: number;
  now?: Date;
}

export type WebhookVerificationFailureReason =
  | 'missing_signature_header'
  | 'malformed_signature_header'
  | 'missing_timestamp'
  | 'missing_signature'
  | 'invalid_timestamp'
  | 'timestamp_out_of_tolerance'
  | 'invalid_signature';

export interface WebhookVerificationResult {
  valid: boolean;
  reason?: WebhookVerificationFailureReason;
  timestamp?: string;
  ageSeconds?: number;
}

export const verifyWebhookSignature = (input: WebhookVerificationInput): boolean => {
  return verifyWebhookSignatureDetailed(input).valid;
};

export const verifyWebhookSignatureDetailed = (
  input: WebhookVerificationInput,
): WebhookVerificationResult => {
  const parts = parseSignatureHeader(input.signatureHeader);
  if (!parts.ok) return { valid: false, reason: parts.reason };
  if (!parts.timestamp) return { valid: false, reason: 'missing_timestamp' };
  if (!parts.signature) return { valid: false, reason: 'missing_signature' };

  const timestampMs = Date.parse(parts.timestamp);
  if (!Number.isFinite(timestampMs)) {
    return { valid: false, reason: 'invalid_timestamp', timestamp: parts.timestamp };
  }
  const now = input.now ?? new Date();
  const toleranceSeconds = input.toleranceSeconds ?? 300;
  const ageSeconds = Math.abs(now.getTime() / 1000 - timestampMs / 1000);
  if (ageSeconds > toleranceSeconds) {
    return {
      valid: false,
      reason: 'timestamp_out_of_tolerance',
      timestamp: parts.timestamp,
      ageSeconds,
    };
  }

  const expected = createHmac('sha256', input.signingSecret)
    .update(`${parts.timestamp}.`, 'utf8')
    .update(input.body)
    .digest('hex');
  if (!safeEqualHex(expected, parts.signature)) {
    return {
      valid: false,
      reason: 'invalid_signature',
      timestamp: parts.timestamp,
      ageSeconds,
    };
  }

  return { valid: true, timestamp: parts.timestamp, ageSeconds };
};

type ParsedSignatureHeader =
  | { ok: true; timestamp?: string; signature?: string }
  | { ok: false; reason: WebhookVerificationFailureReason };

const parseSignatureHeader = (header: string): ParsedSignatureHeader => {
  if (!header.trim()) return { ok: false, reason: 'missing_signature_header' };

  const parsed: { ok: true; timestamp?: string; signature?: string } = { ok: true };
  for (const part of header.split(',')) {
    const [rawKey, rawValue] = part.split('=', 2) as [string, string?];
    const key = rawKey.trim();
    const value = rawValue?.trim();
    if (!key || !value) return { ok: false, reason: 'malformed_signature_header' };
    if (key === 't') parsed.timestamp = value;
    if (key === 'v1') parsed.signature = value;
  }
  return parsed;
};

const safeEqualHex = (a: string, b: string): boolean => {
  if (!/^[0-9a-f]+$/i.test(a) || !/^[0-9a-f]+$/i.test(b)) return false;
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
};
