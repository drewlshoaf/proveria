import { eq } from 'drizzle-orm';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import {
  createClient,
  exportJobs,
  type ClientHandle,
} from '@proveria/db';

import { processEvidenceExportJob } from './evidence-export.js';

const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgres://proveria:proveria_dev@localhost:5432/proveria_test';

let handle: ClientHandle;
const storedBytes = new Map<string, Buffer>();

const truncateAll = async (): Promise<void> => {
  await handle.sql.unsafe(`
    TRUNCATE TABLE
      public.export_jobs,
      public.tenant_memberships,
      public.tenants,
      public.users
    RESTART IDENTITY CASCADE
  `);
};

const seedExportJob = async (): Promise<{
  tenantId: string;
  jobId: string;
}> => {
  const [tenant] = await handle.sql<{ id: string }[]>`
    INSERT INTO public.tenants (name, slug, plan, is_personal)
    VALUES ('Export Tenant', 'export-tenant', 'team_pro', true)
    RETURNING id`;
  const [user] = await handle.sql<{ id: string }[]>`
    INSERT INTO public.users (email, password_hash)
    VALUES ('exporter@example.com', 'hash')
    RETURNING id`;
  const manifest = {
    export: { type: 'evidence_export_job_manifest' },
    attestations: [
      {
        id: 'att_1',
        artifacts: {
          manifest: 'tenants/export-worker/manifest.json',
          receiptPdf: 'tenants/export-worker/receipt.pdf',
        },
      },
    ],
    attempts: [],
    verificationResults: [],
  };
  const [job] = await handle
    .db
    .insert(exportJobs)
    .values({
      tenantId: tenant!.id,
      createdByUserId: user!.id,
      kind: 'evidence_bundle',
      status: 'queued',
      filters: {},
      manifest,
      artifactCount: 2,
      rowCount: 1,
      progressPercent: 0,
      maxRetries: 3,
    })
    .returning();
  return { tenantId: tenant!.id, jobId: job!.id };
};

beforeAll(async () => {
  handle = createClient({ url: DATABASE_URL, max: 3 });
});

afterAll(async () => {
  await handle.close();
});

beforeEach(async () => {
  storedBytes.clear();
  await truncateAll();
});

describe('processEvidenceExportJob', () => {
  it('builds the bundle and marks the job completed', async () => {
    const seeded = await seedExportJob();
    storedBytes.set(
      'tenants/export-worker/manifest.json',
      Buffer.from('{"schema_version":"1.0"}'),
    );
    storedBytes.set(
      'tenants/export-worker/receipt.pdf',
      Buffer.from('%PDF-1.4\nreceipt\n'),
    );

    const result = await processEvidenceExportJob(
      {
        db: handle.db,
        getObjectBytes: async (key) => storedBytes.get(key) ?? null,
        putObject: async (key, body) => {
          storedBytes.set(key, Buffer.isBuffer(body) ? body : Buffer.from(body));
        },
      },
      seeded.jobId,
      { attemptNumber: 1, maxAttempts: 3 },
    );

    expect(result).toMatchObject({
      ok: true,
      status: 'completed',
      jobId: seeded.jobId,
    });
    const [job] = await handle.db
      .select()
      .from(exportJobs)
      .where(eq(exportJobs.id, seeded.jobId));
    expect(job).toMatchObject({
      status: 'completed',
      progressPercent: 100,
      artifactCount: 2,
      retryCount: 0,
      error: null,
    });
    expect(job?.resultObjectKey).toContain(
      `tenants/${seeded.tenantId}/evidence-exports/${seeded.jobId}/bundle.json`,
    );
    const bundle = JSON.parse(
      storedBytes.get(job!.resultObjectKey!)!.toString(),
    ) as { counts: { artifacts: number; missingArtifacts: number } };
    expect(bundle.counts).toEqual({ artifacts: 2, missingArtifacts: 0 });
  });

  it('marks the job failed on the final attempt', async () => {
    const seeded = await seedExportJob();

    const result = await processEvidenceExportJob(
      {
        db: handle.db,
        getObjectBytes: async () => {
          throw new Error('object store unavailable');
        },
        putObject: async () => undefined,
      },
      seeded.jobId,
      { attemptNumber: 3, maxAttempts: 3 },
    );

    expect(result).toMatchObject({
      ok: false,
      status: 'failed',
      error: 'object store unavailable',
    });
    const [job] = await handle.db
      .select()
      .from(exportJobs)
      .where(eq(exportJobs.id, seeded.jobId));
    expect(job).toMatchObject({
      status: 'failed',
      progressPercent: 0,
      retryCount: 3,
      error: 'object store unavailable',
    });
  });
});
