import { eq } from 'drizzle-orm';
import { exportJobs, type DrizzleClient } from '@proveria/db';

import {
  buildEvidenceExportBundle,
  evidenceExportBundleKey,
} from '@proveria/evidence-export';

export interface EvidenceExportDeps {
  db: DrizzleClient;
  getObjectBytes: (key: string) => Promise<Buffer | null>;
  putObject: (
    key: string,
    body: string | Buffer | Uint8Array,
    contentType: string,
  ) => Promise<void>;
}

export interface EvidenceExportOptions {
  attemptNumber: number;
  maxAttempts: number;
}

export interface EvidenceExportResult {
  ok: boolean;
  jobId: string;
  status: 'completed' | 'retrying' | 'failed';
  bundleObjectKey?: string;
  error?: string;
}

const errorMessage = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

export const processEvidenceExportJob = async (
  deps: EvidenceExportDeps,
  jobId: string,
  options: EvidenceExportOptions,
): Promise<EvidenceExportResult> => {
  const [job] = await deps.db
    .select()
    .from(exportJobs)
    .where(eq(exportJobs.id, jobId))
    .limit(1);

  if (!job) {
    return {
      ok: false,
      jobId,
      status: 'failed',
      error: 'evidence_export_job_not_found',
    };
  }

  await deps.db
    .update(exportJobs)
    .set({
      status: 'processing',
      progressPercent: 10,
      retryCount: options.attemptNumber - 1,
      startedAt: job.startedAt ?? new Date(),
      error: null,
    })
    .where(eq(exportJobs.id, jobId));

  try {
    if (!job.manifest) {
      throw new Error('evidence_export_manifest_missing');
    }

    await deps.db
      .update(exportJobs)
      .set({ progressPercent: 50 })
      .where(eq(exportJobs.id, jobId));

    const bundle = await buildEvidenceExportBundle({
      manifest: job.manifest,
      getObjectBytes: deps.getObjectBytes,
    });
    const bundleKey = evidenceExportBundleKey(job.tenantId, job.id);
    await deps.putObject(
      bundleKey,
      JSON.stringify(bundle, null, 2),
      'application/json',
    );

    await deps.db
      .update(exportJobs)
      .set({
        status: 'completed',
        progressPercent: 100,
        resultObjectKey: bundleKey,
        artifactCount: bundle.counts.artifacts + bundle.counts.missingArtifacts,
        error: null,
        completedAt: new Date(),
      })
      .where(eq(exportJobs.id, jobId));

    return {
      ok: true,
      jobId,
      status: 'completed',
      bundleObjectKey: bundleKey,
    };
  } catch (err) {
    const message = errorMessage(err);
    const finalAttempt = options.attemptNumber >= options.maxAttempts;
    await deps.db
      .update(exportJobs)
      .set({
        status: finalAttempt ? 'failed' : 'queued',
        progressPercent: 0,
        retryCount: options.attemptNumber,
        error: message,
        completedAt: finalAttempt ? new Date() : null,
      })
      .where(eq(exportJobs.id, jobId));

    if (!finalAttempt) {
      throw err;
    }

    return {
      ok: false,
      jobId,
      status: 'failed',
      error: message,
    };
  }
};
