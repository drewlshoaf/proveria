import { describe, it, expect } from 'vitest';
import { ALL_QUEUE_NAMES, QUEUE_NAMES } from './queues.js';

describe('worker queue names', () => {
  it('matches the six queues defined in docs/v1 §20.1', () => {
    expect(ALL_QUEUE_NAMES).toEqual([
      'attestation-validation',
      'receipt-generation',
      'proof-package-generation',
      'pdf-rendering',
      'webhook-delivery',
      'audit-events',
      'object-finalization',
    ]);
  });

  it('exposes named accessors for each queue', () => {
    expect(QUEUE_NAMES.attestationValidation).toBe('attestation-validation');
    expect(QUEUE_NAMES.auditEvents).toBe('audit-events');
    expect(QUEUE_NAMES.pdfRendering).toBe('pdf-rendering');
    expect(QUEUE_NAMES.webhookDelivery).toBe('webhook-delivery');
  });

  it('declares all queue names as kebab-case strings', () => {
    for (const name of ALL_QUEUE_NAMES) {
      expect(name).toMatch(/^[a-z]+(-[a-z]+)*$/);
    }
  });
});
