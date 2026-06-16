import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { verifyWebhookSignature, verifyWebhookSignatureDetailed } from './webhooks.js';

const sign = (secret: string, timestamp: string, body: string): string =>
  createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');

describe('verifyWebhookSignature', () => {
  it('accepts valid signatures inside tolerance', () => {
    const body = JSON.stringify({ ok: true });
    const timestamp = '2026-05-25T18:00:00.000Z';
    const signature = sign('whsec_test', timestamp, body);

    expect(
      verifyWebhookSignature({
        signingSecret: 'whsec_test',
        signatureHeader: `t=${timestamp},v1=${signature}`,
        body,
        now: new Date('2026-05-25T18:01:00.000Z'),
      }),
    ).toBe(true);
  });

  it('accepts valid signatures for raw buffer bodies', () => {
    const body = Buffer.from(JSON.stringify({ type: 'receipt.issued' }), 'utf8');
    const timestamp = '2026-05-25T18:00:00.000Z';
    const signature = sign('whsec_test', timestamp, body.toString('utf8'));

    expect(
      verifyWebhookSignatureDetailed({
        signingSecret: 'whsec_test',
        signatureHeader: ` t=${timestamp}, v1=${signature} `,
        body,
        now: new Date('2026-05-25T18:00:30.000Z'),
      }),
    ).toMatchObject({
      valid: true,
      timestamp,
    });
  });

  it('rejects stale signatures', () => {
    const body = '{}';
    const timestamp = '2026-05-25T18:00:00.000Z';
    const signature = sign('whsec_test', timestamp, body);

    const result = verifyWebhookSignatureDetailed({
      signingSecret: 'whsec_test',
      signatureHeader: `t=${timestamp},v1=${signature}`,
      body,
      now: new Date('2026-05-25T19:00:00.000Z'),
    });

    expect(result).toMatchObject({
      valid: false,
      reason: 'timestamp_out_of_tolerance',
      timestamp,
    });
  });

  it('rejects bad signatures', () => {
    const body = '{}';
    const timestamp = '2026-05-25T18:00:00.000Z';

    expect(
      verifyWebhookSignatureDetailed({
        signingSecret: 'whsec_test',
        signatureHeader: `t=${timestamp},v1=${'0'.repeat(64)}`,
        body,
        now: new Date('2026-05-25T18:00:30.000Z'),
      }),
    ).toMatchObject({
      valid: false,
      reason: 'invalid_signature',
    });
  });

  it('rejects malformed signature headers', () => {
    expect(
      verifyWebhookSignatureDetailed({
        signingSecret: 'whsec_test',
        signatureHeader: 't=2026-05-25T18:00:00.000Z,not-a-pair',
        body: '{}',
        now: new Date('2026-05-25T18:00:30.000Z'),
      }),
    ).toEqual({
      valid: false,
      reason: 'malformed_signature_header',
    });
  });

  it('rejects invalid timestamps', () => {
    expect(
      verifyWebhookSignatureDetailed({
        signingSecret: 'whsec_test',
        signatureHeader: `t=not-a-date,v1=${'0'.repeat(64)}`,
        body: '{}',
        now: new Date('2026-05-25T18:00:30.000Z'),
      }),
    ).toEqual({
      valid: false,
      reason: 'invalid_timestamp',
      timestamp: 'not-a-date',
    });
  });

  it('rejects missing signature headers', () => {
    expect(
      verifyWebhookSignatureDetailed({
        signingSecret: 'whsec_test',
        signatureHeader: '',
        body: '{}',
      }),
    ).toEqual({
      valid: false,
      reason: 'missing_signature_header',
    });
  });
});
