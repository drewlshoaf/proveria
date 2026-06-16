import { and, eq, isNotNull, lte } from 'drizzle-orm';
import {
  AUDIT_ACTIONS,
  AUDIT_CATEGORIES,
} from '@proveria/audit';
import {
  exportJobs,
  type DrizzleClient,
  type ExportJob,
} from '@proveria/db';

import { writeAuditEvent } from '../audit/writer.js';

interface RetentionPolicy {
  delete_after_expiration?: unknown;
}

export interface CleanupExpiredEvidenceExportsInput {
  db: DrizzleClient;
  tenantId: string;
  actorUserId?: string | null;
  deleteObject: (key: string) => Promise<void>;
  now?: Date;
  limit?: number;
}

export interface CleanupExpiredEvidenceExportsResult {
  scanned: number;
  deleted: number;
  skipped: number;
  deletedObjectKeys: string[];
}

const retentionDeletesAfterExpiration = (job: ExportJob): boolean => {
  const policy = job.retentionPolicy;
  return (
    typeof policy === 'object' &&
    policy !== null &&
    'delete_after_expiration' in policy &&
    (policy as RetentionPolicy).delete_after_expiration === true
  );
};

export const cleanupExpiredEvidenceExports = async ({
  db,
  tenantId,
  actorUserId,
  deleteObject,
  now = new Date(),
  limit = 100,
}: CleanupExpiredEvidenceExportsInput): Promise<CleanupExpiredEvidenceExportsResult> => {
  const candidates = await db
    .select()
    .from(exportJobs)
    .where(
      and(
        eq(exportJobs.tenantId, tenantId),
        lte(exportJobs.expiresAt, now),
        isNotNull(exportJobs.resultObjectKey),
      ),
    )
    .limit(limit);

  const deletedObjectKeys: string[] = [];
  let skipped = 0;

  for (const job of candidates) {
    if (!job.resultObjectKey || !retentionDeletesAfterExpiration(job)) {
      skipped += 1;
      continue;
    }

    const objectKey = job.resultObjectKey;
    await deleteObject(objectKey);
    await db
      .update(exportJobs)
      .set({
        status: 'expired',
        resultObjectKey: null,
        progressPercent: 100,
        error: null,
      })
      .where(and(eq(exportJobs.id, job.id), eq(exportJobs.resultObjectKey, objectKey)));
    deletedObjectKeys.push(objectKey);

    await writeAuditEvent(db, {
      tenantId,
      actorUserId: actorUserId ?? null,
      category: AUDIT_CATEGORIES.retentionDeletion,
      action: AUDIT_ACTIONS.evidenceExportExpired,
      targetType: 'evidence_export_job',
      targetId: job.id,
      payload: {
        objectKey,
        expiresAt: job.expiresAt?.toISOString() ?? null,
      },
    });
  }

  return {
    scanned: candidates.length,
    deleted: deletedObjectKeys.length,
    skipped,
    deletedObjectKeys,
  };
};
