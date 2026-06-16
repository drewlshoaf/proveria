// BullMQ queue producers used by the api. Workers consume; this side just
// enqueues. The Redis connection is lazy so importing this module never
// touches Redis until a Queue is actually used.

import { Queue } from 'bullmq';
import { Redis } from 'ioredis';

import { config } from '../config.js';

let connection: Redis | undefined;
const queueCache = new Map<string, Queue>();

const conn = (): Redis => {
  if (!connection) {
    connection = new Redis(config.redisUrl, { maxRetriesPerRequest: null });
  }
  return connection;
};

export const getQueue = (name: string): Queue => {
  const cached = queueCache.get(name);
  if (cached) return cached;
  const q = new Queue(name, { connection: conn() });
  queueCache.set(name, q);
  return q;
};

export const closeQueues = async (): Promise<void> => {
  await Promise.all([...queueCache.values()].map((q) => q.close()));
  queueCache.clear();
  if (connection) {
    await connection.quit();
    connection = undefined;
  }
};

/**
 * Optional request_id carried into every enqueued job (M15/C55). Route
 * handlers pass req.id; the worker child-logs against this so a single
 * incident can be traced across api → queue → worker without a join.
 */
export interface JobOriginContext {
  requestId?: string;
}

// Default retry policy for transient infra failures (db down, S3 down,
// Redis hiccup). BullMQ only retries when the handler THROWS — permanent
// validation failures return { ok: false } from validateAttempt and
// generateReceipt and so move straight to "completed with ok:false"
// without burning retries. M15/C56.
const TRANSIENT_RETRY = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 2_000 },
};

// PDF rendering is flakier (Playwright timeouts, browser crashes) so it
// gets more attempts; each retry is still bounded by the exponential
// backoff so we don't pummel the renderer.
const PDF_RETRY = {
  attempts: 5,
  backoff: { type: 'exponential' as const, delay: 2_000 },
};

const WEBHOOK_RETRY = {
  attempts: 5,
  backoff: { type: 'exponential' as const, delay: 5_000 },
};

export interface AttestationValidationJob extends JobOriginContext {
  attestationId: string;
  attemptId: string;
}

export const enqueueAttestationValidation = async (
  job: AttestationValidationJob,
): Promise<void> => {
  await getQueue('attestation-validation').add('validate', job, {
    removeOnComplete: 100,
    removeOnFail: 200,
    ...TRANSIENT_RETRY,
  });
};

export interface PdfRenderingJob extends JobOriginContext {
  linkId: string;
}

export const enqueuePdfRendering = async (
  job: PdfRenderingJob,
): Promise<void> => {
  await getQueue('pdf-rendering').add('render', job, {
    removeOnComplete: 100,
    removeOnFail: 200,
    ...PDF_RETRY,
  });
};

export interface EvidenceExportJob extends JobOriginContext {
  jobId: string;
}

export const enqueueEvidenceExport = async (
  job: EvidenceExportJob,
): Promise<void> => {
  await getQueue('evidence-export').add('build', job, {
    removeOnComplete: 100,
    removeOnFail: 500,
    ...TRANSIENT_RETRY,
  });
};

export interface WebhookDeliveryJob extends JobOriginContext {
  deliveryId: string;
}

export const enqueueWebhookDelivery = async (
  job: WebhookDeliveryJob,
): Promise<void> => {
  await getQueue('webhook-delivery').add('send', job, {
    removeOnComplete: 100,
    removeOnFail: 500,
    ...WEBHOOK_RETRY,
  });
};
