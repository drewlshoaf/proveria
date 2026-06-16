// BullMQ queue names. Real queue processors land milestone-by-milestone.
// See docs/v1 §20.1.

export const QUEUE_NAMES = {
  attestationValidation: 'attestation-validation',
  receiptGeneration: 'receipt-generation',
  proofPackageGeneration: 'proof-package-generation',
  pdfRendering: 'pdf-rendering',
  evidenceExport: 'evidence-export',
  webhookDelivery: 'webhook-delivery',
  auditEvents: 'audit-events',
  objectFinalization: 'object-finalization',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

export const ALL_QUEUE_NAMES: readonly QueueName[] = Object.values(QUEUE_NAMES);
