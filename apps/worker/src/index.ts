// Proveria worker — BullMQ async job processor.
// V1 queues per docs/v1 §20.1. C10 wires up attestation-validation; the
// remaining four queues (receipt-generation, proof-package-generation,
// pdf-rendering, object-finalization) land in M5–M8.

import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import pino from 'pino';
import { createClient, type ClientHandle } from '@proveria/db';

import { validateAttempt } from './handlers/attestation-validation.js';
import { processEvidenceExportJob } from './handlers/evidence-export.js';
import { renderPdfForLink } from './handlers/pdf-rendering.js';
import { generateReceipt } from './handlers/receipt-generation.js';
import { sendWebhookDelivery } from './handlers/webhook-delivery.js';
import { closeBrowser, renderHtmlToPdf } from './pdf/browser.js';
import { qrDataUrl } from './pdf/qr.js';
import { renderReceiptHtml } from './pdf/templates/receipt.js';
import { renderResultHtml } from './pdf/templates/result.js';
import { QUEUE_NAMES } from './queues.js';
import {
  verificationBaseUrlFromEnv,
  verificationUrlForLink,
} from './verification-url.js';

// Aligned with apps/api/src/logging.ts — same base fields on every line
// so api + worker logs can be grep'd together by tenant_id / request_id.
const log = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  base: {
    service: 'worker',
    version: '0.0.0',
    env: process.env.NODE_ENV ?? 'development',
  },
});

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgres://proveria:proveria_dev@localhost:5432/proveria';
const S3_ENDPOINT = process.env.S3_ENDPOINT || undefined;
const S3_REGION = process.env.S3_REGION ?? 'us-east-1';
const S3_ACCESS_KEY = process.env.S3_ACCESS_KEY;
const S3_SECRET_KEY = process.env.S3_SECRET_KEY;
const S3_FORCE_PATH_STYLE =
  (
    process.env.S3_FORCE_PATH_STYLE ?? (S3_ENDPOINT ? 'true' : 'false')
  ).toLowerCase() === 'true';
const S3_ARTIFACTS_BUCKET =
  process.env.S3_ARTIFACTS_BUCKET ?? 'proveria-artifacts';
const s3Credentials =
  S3_ACCESS_KEY && S3_SECRET_KEY
    ? { accessKeyId: S3_ACCESS_KEY, secretAccessKey: S3_SECRET_KEY }
    : undefined;

// Public origin embedded in PDF QR + verification URL (docs/v1 §18.4).
const VERIFICATION_BASE_URL = verificationBaseUrlFromEnv();

const connection = new Redis(REDIS_URL, { maxRetriesPerRequest: null });
connection.on('connect', () =>
  log.info({ url: REDIS_URL }, 'worker connected to redis'),
);
connection.on('error', (err: Error) =>
  log.error({ err }, 'redis connection error'),
);

const dbHandle: ClientHandle = createClient({ url: DATABASE_URL, max: 5 });

const s3 = new S3Client({
  endpoint: S3_ENDPOINT,
  region: S3_REGION,
  forcePathStyle: S3_FORCE_PATH_STYLE,
  credentials: s3Credentials,
});

const fetchManifest = async (objectKey: string): Promise<string> => {
  const res = await s3.send(
    new GetObjectCommand({ Bucket: S3_ARTIFACTS_BUCKET, Key: objectKey }),
  );
  if (!res.Body) throw new Error(`empty body for ${objectKey}`);
  return await res.Body.transformToString('utf-8');
};

const getObjectBytes = async (objectKey: string): Promise<Buffer | null> => {
  try {
    const res = await s3.send(
      new GetObjectCommand({ Bucket: S3_ARTIFACTS_BUCKET, Key: objectKey }),
    );
    if (!res.Body) return null;
    return Buffer.from(await res.Body.transformToByteArray());
  } catch (err) {
    if (
      err &&
      typeof err === 'object' &&
      'name' in err &&
      (err as { name?: string }).name === 'NoSuchKey'
    ) {
      return null;
    }
    throw err;
  }
};

// Artifacts are immutable once written (docs/v1 §7.3). Each attempt prefix is
// unique, so the worker never overwrites — a re-run would PUT identical bytes.
const putObject = async (
  objectKey: string,
  body: string | Buffer | Uint8Array,
  contentType: string,
): Promise<void> => {
  await s3.send(
    new PutObjectCommand({
      Bucket: S3_ARTIFACTS_BUCKET,
      Key: objectKey,
      Body: body,
      ContentType: contentType,
    }),
  );
};

// Shared PDF renderers, used by both the receipt-generation handler (at
// issuance) and the pdf-rendering handler (on demand). The closures embed
// the public verification URL origin so the QR + footer point at the right
// verifier client.
const renderReceiptPdfBuf = async (
  receipt: import('@proveria/receipt').AttestationReceipt,
  linkId: string,
): Promise<Buffer> => {
  const verificationUrl = verificationUrlForLink(VERIFICATION_BASE_URL, linkId);
  const qr = await qrDataUrl(verificationUrl);
  const html = renderReceiptHtml({
    receipt,
    verificationBaseUrl: VERIFICATION_BASE_URL,
    linkId,
    qrDataUrl: qr,
  });
  return renderHtmlToPdf(html);
};
const renderResultPdfBuf = async (
  pkg: import('@proveria/proofs').ResultPackage,
  linkId: string,
): Promise<Buffer> => {
  const verificationUrl = verificationUrlForLink(VERIFICATION_BASE_URL, linkId);
  const qr = await qrDataUrl(verificationUrl);
  const html = renderResultHtml({
    pkg,
    verificationBaseUrl: VERIFICATION_BASE_URL,
    linkId,
    qrDataUrl: qr,
  });
  return renderHtmlToPdf(html);
};

// Per-job pino child logger. Inherits `service` + `env` from the parent;
// stamps the job id and (when provided) the originating api request_id
// so a single incident threads from api log → queue log → worker log.
const jobLog = (
  job: { id?: string; name: string; data: unknown },
  extra: Record<string, unknown> = {},
): pino.Logger => {
  const requestId = (job.data as { requestId?: string })?.requestId;
  return log.child({
    jobId: job.id,
    jobName: job.name,
    ...(requestId ? { requestId } : {}),
    ...extra,
  });
};

const auditEventsWorker = new Worker(
  QUEUE_NAMES.auditEvents,
  async (job) => {
    jobLog(job).info('audit-events: job received (no-op skeleton)');
    return { ok: true };
  },
  { connection },
);

// Producer side: confirming an attempt enqueues its receipt generation.
const receiptGenerationQueue = new Queue(QUEUE_NAMES.receiptGeneration, {
  connection,
});
const webhookDeliveryQueue = new Queue(QUEUE_NAMES.webhookDelivery, {
  connection,
});
const WEBHOOK_DELIVERY_ATTEMPTS = 5;

const enqueueWebhookDeliveryJob = async (deliveryId: string): Promise<void> => {
  await webhookDeliveryQueue.add(
    'send',
    { deliveryId },
    {
      removeOnComplete: 100,
      removeOnFail: 500,
      attempts: WEBHOOK_DELIVERY_ATTEMPTS,
      backoff: { type: 'exponential', delay: 5_000 },
    },
  );
};

const attestationValidationWorker = new Worker(
  QUEUE_NAMES.attestationValidation,
  async (job) => {
    const { attestationId, attemptId, requestId } = job.data as {
      attestationId: string;
      attemptId: string;
      requestId?: string;
    };
    const childLog = jobLog(job, { attestationId, attemptId });
    childLog.info('validating attempt');
    const result = await validateAttempt(
      {
        db: dbHandle.db,
        fetchManifest,
        putObject,
        enqueueWebhookDelivery: enqueueWebhookDeliveryJob,
      },
      attemptId,
    );
    if (result.ok) {
      await receiptGenerationQueue.add(
        'generate',
        { attestationId, attemptId, requestId },
        {
          removeOnComplete: 100,
          removeOnFail: 200,
          attempts: 3,
          backoff: { type: 'exponential', delay: 2_000 },
        },
      );
    } else {
      childLog.warn({ error: result.error }, 'validation failed');
    }
    return result;
  },
  { connection },
);

const receiptGenerationWorker = new Worker(
  QUEUE_NAMES.receiptGeneration,
  async (job) => {
    const { attestationId, attemptId } = job.data as {
      attestationId: string;
      attemptId: string;
      requestId?: string;
    };
    const childLog = jobLog(job, { attestationId, attemptId });
    childLog.info('generating receipt');
    const result = await generateReceipt(
      {
        db: dbHandle.db,
        fetchManifest,
        putObject,
        renderReceiptPdf: renderReceiptPdfBuf,
        enqueueWebhookDelivery: enqueueWebhookDeliveryJob,
      },
      attestationId,
      attemptId,
    );
    if (!result.ok) {
      childLog.warn({ error: result.error }, 'receipt generation failed');
    }
    return result;
  },
  { connection },
);

const webhookDeliveryWorker = new Worker(
  QUEUE_NAMES.webhookDelivery,
  async (job) => {
    const { deliveryId } = job.data as {
      deliveryId: string;
      requestId?: string;
    };
    const childLog = jobLog(job, { deliveryId });
    childLog.info('sending webhook delivery');
    const result = await sendWebhookDelivery(
      { db: dbHandle.db },
      deliveryId,
      {
        attemptNumber: job.attemptsMade + 1,
        maxAttempts: WEBHOOK_DELIVERY_ATTEMPTS,
      },
    );
    if (!result.ok && result.status === 'retrying') {
      throw new Error(result.error ?? 'webhook_delivery_retrying');
    }
    if (!result.ok) {
      childLog.warn({ error: result.error }, 'webhook delivery failed');
    }
    return result;
  },
  { connection },
);

const pdfRenderingWorker = new Worker(
  QUEUE_NAMES.pdfRendering,
  async (job) => {
    const { linkId } = job.data as { linkId: string; requestId?: string };
    const childLog = jobLog(job, { linkId });
    childLog.info('rendering pdf');
    const result = await renderPdfForLink(
      {
        db: dbHandle.db,
        fetchJson: fetchManifest, // same S3 client, name is historical
        putObject,
        renderReceiptPdf: renderReceiptPdfBuf,
        renderResultPdf: renderResultPdfBuf,
      },
      linkId,
    );
    if (!result.ok) {
      childLog.warn({ error: result.error }, 'pdf rendering failed');
    }
    return result;
  },
  { connection },
);

const evidenceExportWorker = new Worker(
  QUEUE_NAMES.evidenceExport,
  async (job) => {
    const { jobId } = job.data as { jobId: string; requestId?: string };
    const childLog = jobLog(job, { exportJobId: jobId });
    childLog.info('building evidence export bundle');
    const result = await processEvidenceExportJob(
      {
        db: dbHandle.db,
        getObjectBytes,
        putObject,
      },
      jobId,
      {
        attemptNumber: job.attemptsMade + 1,
        maxAttempts: job.opts.attempts ?? 1,
      },
    );
    if (!result.ok) {
      childLog.warn({ error: result.error }, 'evidence export failed');
    }
    return result;
  },
  { connection },
);

for (const w of [
  auditEventsWorker,
  attestationValidationWorker,
  receiptGenerationWorker,
  webhookDeliveryWorker,
  pdfRenderingWorker,
  evidenceExportWorker,
]) {
  w.on('failed', (job, err) => {
    const requestId = (job?.data as { requestId?: string })?.requestId;
    log.error(
      {
        jobId: job?.id,
        jobName: w.name,
        ...(requestId ? { requestId } : {}),
        err,
      },
      'job failed',
    );
  });
}

log.info(
  {
    registered: [
      QUEUE_NAMES.auditEvents,
      QUEUE_NAMES.attestationValidation,
      QUEUE_NAMES.receiptGeneration,
      QUEUE_NAMES.webhookDelivery,
      QUEUE_NAMES.pdfRendering,
      QUEUE_NAMES.evidenceExport,
    ],
  },
  'worker started',
);

const shutdown = async (signal: string): Promise<void> => {
  log.info({ signal }, 'shutting down');
  await Promise.all([
    auditEventsWorker.close(),
    attestationValidationWorker.close(),
    receiptGenerationWorker.close(),
    webhookDeliveryWorker.close(),
    pdfRenderingWorker.close(),
    evidenceExportWorker.close(),
    receiptGenerationQueue.close(),
    webhookDeliveryQueue.close(),
    closeBrowser(),
  ]);
  await connection.quit();
  await dbHandle.close();
  process.exit(0);
};

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
