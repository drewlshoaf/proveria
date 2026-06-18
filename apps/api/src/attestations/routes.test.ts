// Integration tests for attestation routes — full pairing + create + upload +
// finalize roundtrip, plus the validation handler tested directly so we don't
// need a live BullMQ worker in tests.

import cookie from '@fastify/cookie';
import sensible from '@fastify/sensible';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import { eq } from 'drizzle-orm';
import {
  buildSigningDigest,
  generateEd25519Keypair,
  LEAF_TYPES,
  signEd25519,
} from '@proveria/crypto-core';
import {
  attestations,
  createClient,
  verificationLinks,
  type ClientHandle,
} from '@proveria/db';
import { buildManifest, type Manifest } from '@proveria/manifest';
import { verifyMatchProof, type ResultPackage } from '@proveria/proofs';
import { buildAttestationReceipt, signReceipt } from '@proveria/receipt';

import { authPlugin } from '../auth/routes.js';
import {
  buildDeviceSignatureHeaders,
} from '../auth/device-signature.js';
import { config } from '../config.js';
import { devicePlugin } from '../devices/routes.js';
import { linkPlugin } from '../links/routes.js';
import { LogNotificationProvider } from '../notifications/provider.js';
import { projectPlugin } from '../projects/routes.js';
import { putJson } from '../objects/client.js';
import { tenantPlugin } from '../tenants/routes.js';
import { attestationPlugin } from './routes.js';

// The dev-default Proveria platform keypair the api verifies receipts against
// (config.proveriaSigningPublicKey). Tests sign with the private half so a
// genuine receipt verifies.
const PROVERIA_PRIVATE_KEY =
  'MC4CAQAwBQYDK2VwBCIEIJTQIRy9pxIpswsyB6XJtmvEBnONjtDyaUeZurNxgISf';

const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgres://proveria:proveria_dev@localhost:5432/proveria_test';

let dbHandle: ClientHandle;
let app: FastifyInstance;
let notificationLines: string[];

const truncateAll = async (): Promise<void> => {
  await dbHandle.sql.unsafe(`
    TRUNCATE TABLE
      audit.audit_events,
      public.attestation_access_requests,
      public.submission_attempts,
      public.attestations,
      public.projects,
      public.tenant_invitations,
      public.password_reset_tokens,
      public.email_verification_tokens,
      public.device_pairing_attempts,
      public.devices,
      public.sessions,
      public.tenant_memberships,
      public.tenants,
      public.users
    RESTART IDENTITY CASCADE
  `);
};

const extractCookies = (response: {
  headers: { 'set-cookie'?: string | string[] };
}): string => {
  const raw = response.headers['set-cookie'];
  if (!raw) throw new Error('expected Set-Cookie');
  const arr = Array.isArray(raw) ? raw : [raw];
  return arr
    .map((c) => c.split(';')[0])
    .filter((c): c is string => Boolean(c))
    .join('; ');
};

interface Owner {
  cookies: string;
  tenant: { id: string; slug: string };
  userId: string;
}

const registerOwner = async (email: string): Promise<Owner> => {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { email, password: 'attestations-test-pw' },
  });
  if (res.statusCode !== 201) throw new Error('register failed');
  const body = res.json() as {
    user: { id: string };
  };
  const workspace = await app.inject({
    method: 'POST',
    url: '/tenants',
    headers: { cookie: extractCookies(res) },
    payload: { name: email },
  });
  if (workspace.statusCode !== 201) throw new Error('workspace failed');
  const workspaceBody = workspace.json() as {
    tenant: { id: string; slug: string };
  };
  return {
    cookies: extractCookies(res),
    tenant: workspaceBody.tenant,
    userId: body.user.id,
  };
};

interface PairedDevice {
  deviceId: string;
  publicKey: string;
  privateKey: string;
}

const pairDevice = async (
  owner: Owner,
  deviceName = 'Test Mac',
): Promise<PairedDevice> => {
  const kp = await generateEd25519Keypair();
  const init = await app.inject({
    method: 'POST',
    url: '/devices/pairing/initiate',
    payload: {
      publicKey: kp.publicKey,
      name: deviceName,
      platform: 'darwin',
      appVersion: '0.0.0',
    },
  });
  const { code } = init.json() as { code: string };
  const approve = await app.inject({
    method: 'POST',
    url: `/tenants/${owner.tenant.slug}/devices/pairing/approve`,
    headers: { cookie: owner.cookies },
    payload: { code, name: deviceName },
  });
  const deviceId = (approve.json() as { device: { id: string } }).device.id;
  return { deviceId, publicKey: kp.publicKey, privateKey: kp.privateKey };
};

const createProject = async (owner: Owner, slug: string): Promise<void> => {
  await app.inject({
    method: 'POST',
    url: `/tenants/${owner.tenant.slug}/projects`,
    headers: { cookie: owner.cookies },
    payload: {
      slug,
      name: slug,
      templateSlug: 'general_provenance',
    },
  });
};

interface SignedRequestOptions {
  method: 'POST' | 'GET' | 'DELETE';
  url: string;
  payload: Record<string, unknown> | undefined;
  headers: Record<string, string>;
}

const signedRequest = async (
  device: PairedDevice,
  method: 'POST' | 'GET' | 'DELETE',
  url: string,
  body: Record<string, unknown> | undefined,
): Promise<SignedRequestOptions> => {
  const bodyBytes =
    body === undefined
      ? new Uint8Array(0)
      : new TextEncoder().encode(JSON.stringify(body));
  const headers = await buildDeviceSignatureHeaders(
    (payload) => signEd25519(payload, device.privateKey),
    device.deviceId,
    method,
    url,
    bodyBytes,
  );
  return {
    method,
    url,
    payload: body,
    headers:
      body === undefined
        ? headers
        : {
            'content-type': 'application/json',
            ...headers,
          },
  };
};

beforeAll(async () => {
  dbHandle = createClient({ url: DATABASE_URL, max: 5 });
  app = Fastify({ logger: false });
  await app.register(sensible);
  await app.register(cookie, { secret: config.sessionSecret });
  notificationLines = [];
  const notifications = new LogNotificationProvider((line) =>
    notificationLines.push(line),
  );
  await app.register(authPlugin, { db: dbHandle.db, notifications });
  await app.register(tenantPlugin, { db: dbHandle.db, notifications });
  await app.register(devicePlugin, { db: dbHandle.db });
  await app.register(projectPlugin, { db: dbHandle.db });
  await app.register(attestationPlugin, {
    db: dbHandle.db,
    rateLimitRedis: fakeRedis,
    notifications,
  });
  await app.register(linkPlugin, { db: dbHandle.db });
  await app.ready();
});

// Map-backed in-process stand-in for ioredis. Sufficient for the lookup
// rate-limit path (only INCR + EXPIRE) and avoids requiring a real Redis
// in the test environment.
const fakeRedisStore = new Map<string, number>();
const fakeRedis = {
  async incr(key: string): Promise<number> {
    const next = (fakeRedisStore.get(key) ?? 0) + 1;
    fakeRedisStore.set(key, next);
    return next;
  },
  async expire(_key: string, _seconds: number): Promise<unknown> {
    // No-op: tests don't depend on TTL behavior since beforeEach() clears
    // the store between tests anyway.
    return 1;
  },
};

afterAll(async () => {
  await app.close();
  await dbHandle.close();
});

beforeEach(async () => {
  notificationLines.length = 0;
  fakeRedisStore.clear();
  await truncateAll();
});

describe('attestation lifecycle (device-signed)', () => {
  it('create → upload-manifest → finalize transitions states correctly', async () => {
    const owner = await registerOwner('owner@example.com');
    await createProject(owner, 'p1');
    const device = await pairDevice(owner);

    const createReq = await signedRequest(
      device,
      'POST',
      `/tenants/${owner.tenant.slug}/projects/p1/attestations`,
      { label: 'first-attempt' },
    );
    const create = await app.inject(createReq);
    expect(create.statusCode).toBe(201);
    const created = create.json() as {
      attestation: { id: string; state: string };
      attempt: { id: string; state: string };
    };
    expect(created.attestation.state).toBe('pending');
    expect(created.attempt.state).toBe('pending');

    const manifest = {
      schema_version: '1.0',
      protocol_version: '1.0',
      placeholder: true,
    };
    const uploadReq = await signedRequest(
      device,
      'POST',
      `/attestations/${created.attestation.id}/attempts/${created.attempt.id}/upload-manifest`,
      manifest,
    );
    const upload = await app.inject(uploadReq);
    expect(upload.statusCode).toBe(200);
    const uploaded = upload.json() as {
      attempt: { state: string; manifestObjectKey: string };
    };
    expect(uploaded.attempt.state).toBe('uploaded');
    expect(uploaded.attempt.manifestObjectKey).toMatch(/^tenants\//);

    const finalizeReq = await signedRequest(
      device,
      'POST',
      `/attestations/${created.attestation.id}/attempts/${created.attempt.id}/finalize`,
      {},
    );
    const finalize = await app.inject(finalizeReq);
    expect(finalize.statusCode).toBe(202);
    const fb = finalize.json() as { attestation: { state: string } };
    expect(fb.attestation.state).toBe('validating');
  });

  it('stores Google Drive source metadata on the submission attempt and audits it', async () => {
    const owner = await registerOwner('owner@example.com');
    await createProject(owner, 'p1');
    const device = await pairDevice(owner);

    const createReq = await signedRequest(
      device,
      'POST',
      `/tenants/${owner.tenant.slug}/projects/p1/attestations`,
      {
        label: 'drive-source',
        sourceMetadata: {
          provider: 'google_drive',
          fileId: 'drive-file-1',
          fileName: 'Board Minutes.pdf',
          mimeType: 'application/pdf',
          size: 12345,
          modifiedTime: '2026-05-20T12:00:00Z',
          googleAccountEmail: 'Owner@Example.com',
        },
      },
    );

    const create = await app.inject(createReq);
    expect(create.statusCode).toBe(201);
    const created = create.json() as {
      attestation: { id: string };
      attempt: { id: string };
    };

    const attempts = await dbHandle.sql<
      { source_metadata: Record<string, unknown> }[]
    >`
      SELECT source_metadata FROM public.submission_attempts
      WHERE id = ${created.attempt.id}`;
    expect(attempts[0]!.source_metadata).toEqual(
      expect.objectContaining({
        provider: 'google_drive',
        fileId: 'drive-file-1',
        fileName: 'Board Minutes.pdf',
        mimeType: 'application/pdf',
        size: 12345,
        modifiedTime: '2026-05-20T12:00:00Z',
        selectedByUserId: owner.userId,
        googleAccountEmail: 'owner@example.com',
      }),
    );

    const detail = await app.inject(
      await signedRequest(
        device,
        'GET',
        `/attestations/${created.attestation.id}`,
        undefined,
      ),
    );
    expect(detail.statusCode).toBe(200);
    const body = detail.json() as {
      attempts: Array<{ sourceMetadata: Record<string, unknown> | null }>;
    };
    expect(body.attempts[0]?.sourceMetadata).toEqual(
      expect.objectContaining({
        provider: 'google_drive',
        fileId: 'drive-file-1',
        fileName: 'Board Minutes.pdf',
      }),
    );

    const auditRows = await dbHandle.sql<
      { action: string; payload: Record<string, unknown> }[]
    >`
      SELECT action, payload FROM audit.audit_events
      WHERE target_id = ${created.attestation.id}
      ORDER BY created_at`;
    expect(auditRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'attestation.source_google_drive_submitted',
          payload: expect.objectContaining({
            projectSlug: 'p1',
            fileId: 'drive-file-1',
            fileName: 'Board Minutes.pdf',
            mimeType: 'application/pdf',
            googleAccountEmail: 'owner@example.com',
          }),
        }),
      ]),
    );
  });

  it('stores model release provenance metadata on the submission attempt', async () => {
    const owner = await registerOwner('owner@example.com');
    await createProject(owner, 'p1');
    const device = await pairDevice(owner);
    const hash = 'a'.repeat(64);

    const createReq = await signedRequest(
      device,
      'POST',
      `/tenants/${owner.tenant.slug}/projects/p1/attestations`,
      {
        label: 'model-release',
        sourceMetadata: {
          provider: 'model_release',
          recordType: 'model_provenance_record',
          schemaVersion: '0.1',
          canonicalHash: hash,
          modelName: 'Graduation Model',
          modelVersion: '2026.06.17',
          modelType: 'Classifier',
          releaseStage: 'production',
          claimType: 'model_release_approved',
          claimText: 'This model version was approved for production release.',
          claimScope: 'full_release_package',
          subjectType: 'model_artifact',
          subjectIdentifier: 'registry://models/graduation/2026.06.17',
          subjectHash: hash,
          artifactManifestHash: hash,
          modelCardHash: hash,
          datasetManifestHash: hash,
          evaluationReportHash: hash,
          riskReviewHash: hash,
          policyId: 'AI-GOV-001',
          policyVersion: '2026.1',
          policyDecision: 'approved',
          finalApprover: 'Model Risk Committee',
          finalApprovalTimestamp: '2026-06-17T14:30:00Z',
          disclosureMode: 'public_receipt_private_evidence',
          verificationPolicy: 'verify_model_release_claim',
          retentionPeriod: '7 years',
          knownLimitations: 'Requires monitoring for drift.',
        },
      },
    );

    const create = await app.inject(createReq);
    expect(create.statusCode).toBe(201);
    const created = create.json() as {
      attestation: { id: string };
      attempt: { id: string };
    };

    const attempts = await dbHandle.sql<
      { source_metadata: Record<string, unknown> }[]
    >`
      SELECT source_metadata FROM public.submission_attempts
      WHERE id = ${created.attempt.id}`;
    expect(attempts[0]!.source_metadata).toEqual(
      expect.objectContaining({
        provider: 'model_release',
        recordType: 'model_provenance_record',
        canonicalHash: hash,
        modelName: 'Graduation Model',
        modelVersion: '2026.06.17',
        claimType: 'model_release_approved',
        policyId: 'AI-GOV-001',
        createdByUserId: owner.userId,
      }),
    );

    const detail = await app.inject(
      await signedRequest(
        device,
        'GET',
        `/attestations/${created.attestation.id}`,
        undefined,
      ),
    );
    expect(detail.statusCode).toBe(200);
    const body = detail.json() as {
      attempts: Array<{ sourceMetadata: Record<string, unknown> | null }>;
    };
    expect(body.attempts[0]?.sourceMetadata).toEqual(
      expect.objectContaining({
        provider: 'model_release',
        modelName: 'Graduation Model',
        canonicalHash: hash,
        subjectHash: hash,
      }),
    );
  });

  it('rejects unsigned request to create-attestation with 401', async () => {
    const owner = await registerOwner('owner@example.com');
    await createProject(owner, 'p1');
    const res = await app.inject({
      method: 'POST',
      url: `/tenants/${owner.tenant.slug}/projects/p1/attestations`,
      payload: { label: 'x' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects when device signs against a workspace the user cannot access', async () => {
    const owner = await registerOwner('owner@example.com');
    const stranger = await registerOwner('stranger@example.com');
    await createProject(stranger, 'p1');
    const device = await pairDevice(owner);

    const req = await signedRequest(
      device,
      'POST',
      `/tenants/${stranger.tenant.slug}/projects/p1/attestations`,
      { label: 'mismatch' },
    );
    const res = await app.inject(req);
    expect(res.statusCode).toBe(401);
  });

  it('duplicate label within project returns 409', async () => {
    const owner = await registerOwner('owner@example.com');
    await createProject(owner, 'p1');
    const device = await pairDevice(owner);

    const url = `/tenants/${owner.tenant.slug}/projects/p1/attestations`;
    const a = await app.inject(
      await signedRequest(device, 'POST', url, { label: 'dup' }),
    );
    expect(a.statusCode).toBe(201);

    const b = await app.inject(
      await signedRequest(device, 'POST', url, { label: 'dup' }),
    );
    expect(b.statusCode).toBe(409);
  });

  it('rejects a tampered body (signature no longer matches)', async () => {
    const owner = await registerOwner('owner@example.com');
    await createProject(owner, 'p1');
    const device = await pairDevice(owner);

    const url = `/tenants/${owner.tenant.slug}/projects/p1/attestations`;
    const signed = await signedRequest(device, 'POST', url, {
      label: 'original',
    });
    // Same headers, different body.
    const tamper = await app.inject({
      ...signed,
      payload: { label: 'tampered' },
    });
    expect(tamper.statusCode).toBe(401);
  });

  // -------------------------------------------------------------------
  // M13/C48 — Free tier per-project attestation cap (1)
  // -------------------------------------------------------------------
  it('Free tenant cannot create a 2nd attestation in the same project (409)', async () => {
    const owner = await registerOwner('owner@example.com');
    await createProject(owner, 'p1');
    const device = await pairDevice(owner);

    const url = `/tenants/${owner.tenant.slug}/projects/p1/attestations`;
    const first = await app.inject(
      await signedRequest(device, 'POST', url, { label: 'first' }),
    );
    expect(first.statusCode).toBe(201);

    const second = await app.inject(
      await signedRequest(device, 'POST', url, { label: 'second' }),
    );
    expect(second.statusCode).toBe(409);
    const body = second.json() as { error: string; limit: number; current: number };
    expect(body.error).toBe('attestations_per_project_limit_reached');
    expect(body.limit).toBe(1);
    expect(body.current).toBe(1);
  });

  it('Team Pro tenant can create many attestations in one project', async () => {
    const owner = await registerOwner('owner@example.com');
    await createProject(owner, 'p1');
    const device = await pairDevice(owner);
    // Upgrade to team_pro so the per-project cap goes away.
    await dbHandle.sql`
      UPDATE public.tenants SET plan = 'team_pro' WHERE id = ${owner.tenant.id}`;

    const url = `/tenants/${owner.tenant.slug}/projects/p1/attestations`;
    for (const label of ['a', 'b', 'c']) {
      const res = await app.inject(
        await signedRequest(device, 'POST', url, { label }),
      );
      expect(res.statusCode).toBe(201);
    }
  });

  // -------------------------------------------------------------------
  // M13/C49 — monthly attestation allowance (Team Starter = 50)
  // -------------------------------------------------------------------
  it('Team Starter rejects a new attestation when the monthly cap is exhausted', async () => {
    const owner = await registerOwner('owner@example.com');
    await dbHandle.sql`
      UPDATE public.tenants SET plan = 'team_starter' WHERE id = ${owner.tenant.id}`;
    await createProject(owner, 'p1');
    const device = await pairDevice(owner);

    // Seed 50 attestations directly via SQL within the current UTC month,
    // each on its own project so the per-project cap doesn't apply.
    const projectIds: string[] = [];
    for (let i = 0; i < 50; i += 1) {
      const slug = `seeded-${i}`;
      await app.inject({
        method: 'POST',
        url: `/tenants/${owner.tenant.slug}/projects`,
        headers: { cookie: owner.cookies },
        payload: {
          slug,
          name: slug,
          templateSlug: 'general_provenance',
        },
      });
      const rows = await dbHandle.sql<{ id: string }[]>`
        SELECT id FROM public.projects
         WHERE tenant_id = ${owner.tenant.id} AND slug = ${slug}`;
      projectIds.push(rows[0]!.id);
    }
    // Insert 50 attestation rows under the seeded projects (all in current
    // UTC month via NOW()).
    for (let i = 0; i < 50; i += 1) {
      await dbHandle.sql`
        INSERT INTO public.attestations
          (tenant_id, project_id, label, created_by_user_id, created_by_device_id, state)
        VALUES (
          ${owner.tenant.id},
          ${projectIds[i]!},
          ${'seeded-' + i},
          ${owner.userId},
          ${device.deviceId},
          'pending'
        )`;
    }

    // 51st create via the real route — should be rejected by the monthly cap.
    const url = `/tenants/${owner.tenant.slug}/projects/p1/attestations`;
    const res = await app.inject(
      await signedRequest(device, 'POST', url, { label: 'over-cap' }),
    );
    expect(res.statusCode).toBe(409);
    const body = res.json() as { error: string; limit: number; current: number };
    expect(body.error).toBe('monthly_attestation_limit_reached');
    expect(body.limit).toBe(50);
    expect(body.current).toBe(50);
  });

  // -------------------------------------------------------------------
  // Cancel endpoint — producer reclaims the label after a local failure
  // -------------------------------------------------------------------
  it('POST /attestations/:id/cancel transitions a pending attestation to canceled and frees the label', async () => {
    const owner = await registerOwner('owner@example.com');
    await dbHandle.sql`
      UPDATE public.tenants SET plan = 'team_pro' WHERE id = ${owner.tenant.id}`;
    await createProject(owner, 'p1');
    const device = await pairDevice(owner);

    const url = `/tenants/${owner.tenant.slug}/projects/p1/attestations`;
    const first = await app.inject(
      await signedRequest(device, 'POST', url, { label: 'demo-1' }),
    );
    expect(first.statusCode).toBe(201);
    const firstId = (first.json() as { attestation: { id: string } })
      .attestation.id;

    // Without cancel: reusing the label is rejected.
    const taken = await app.inject(
      await signedRequest(device, 'POST', url, { label: 'demo-1' }),
    );
    expect(taken.statusCode).toBe(409);

    // Cancel succeeds.
    const cancel = await app.inject(
      await signedRequest(device, 'POST', `/attestations/${firstId}/cancel`, {}),
    );
    expect(cancel.statusCode).toBe(200);
    expect(
      (cancel.json() as { attestation: { state: string } }).attestation.state,
    ).toBe('canceled');

    // Now the label is reusable on a fresh attestation.
    const second = await app.inject(
      await signedRequest(device, 'POST', url, { label: 'demo-1' }),
    );
    expect(second.statusCode).toBe(201);
  });

  it('cancel rejects a confirmed attestation (409)', async () => {
    const owner = await registerOwner('owner@example.com');
    await createProject(owner, 'p1');
    const device = await pairDevice(owner);

    // Seed a confirmed attestation directly.
    const userId = (
      await dbHandle.sql<{ id: string }[]>`
        SELECT id FROM public.users WHERE email = 'owner@example.com' LIMIT 1`
    )[0]!.id;
    const projectId = (
      await dbHandle.sql<{ id: string }[]>`
        SELECT id FROM public.projects WHERE slug = 'p1' LIMIT 1`
    )[0]!.id;
    const attRow = await dbHandle.sql<{ id: string }[]>`
      INSERT INTO public.attestations
        (tenant_id, project_id, label, created_by_user_id,
         created_by_device_id, state)
      VALUES (${owner.tenant.id}, ${projectId}, 'already-confirmed',
              ${userId}, ${device.deviceId}, 'confirmed')
      RETURNING id`;

    const res = await app.inject(
      await signedRequest(device, 'POST', `/attestations/${attRow[0]!.id}/cancel`, {}),
    );
    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: string }).error).toBe(
      'attestation_not_cancellable',
    );
  });

  it('cancel from a different device returns 403 wrong_device', async () => {
    const owner = await registerOwner('owner@example.com');
    await createProject(owner, 'p1');
    const a = await pairDevice(owner, 'Mac A');
    const b = await pairDevice(owner, 'Mac B');

    const url = `/tenants/${owner.tenant.slug}/projects/p1/attestations`;
    const created = await app.inject(
      await signedRequest(a, 'POST', url, { label: 'from-a' }),
    );
    const id = (created.json() as { attestation: { id: string } })
      .attestation.id;

    const cancel = await app.inject(
      await signedRequest(b, 'POST', `/attestations/${id}/cancel`, {}),
    );
    expect(cancel.statusCode).toBe(403);
  });

  // -------------------------------------------------------------------
  // M13/C49 — storage cap on the upload-manifest route
  // -------------------------------------------------------------------
  it('upload-manifest rejects a single submission that exceeds plan storage cap (413)', async () => {
    const owner = await registerOwner('owner@example.com');
    await dbHandle.sql`
      UPDATE public.tenants SET plan = 'team_starter' WHERE id = ${owner.tenant.id}`;
    await createProject(owner, 'p1');
    const device = await pairDevice(owner);

    const createUrl = `/tenants/${owner.tenant.slug}/projects/p1/attestations`;
    const created = await app.inject(
      await signedRequest(device, 'POST', createUrl, { label: 'huge' }),
    );
    expect(created.statusCode).toBe(201);
    const body = created.json() as {
      attestation: { id: string };
      attempt: { id: string };
    };

    // 30 GB on a 25 GB Team Starter cap.
    const oversizedBytes = 30 * 1024 * 1024 * 1024;
    const uploadUrl =
      `/attestations/${body.attestation.id}/attempts/${body.attempt.id}/upload-manifest`;
    const res = await app.inject(
      await signedRequest(device, 'POST', uploadUrl, {
        leaf_set: [
          {
            leaf_type: 'file/sha256/v1',
            canonical_payload_hash: 'a'.repeat(64),
            leaf_hash: 'b'.repeat(64),
            metadata: { byte_size: oversizedBytes },
          },
        ],
      }),
    );
    expect(res.statusCode).toBe(413);
    const err = res.json() as { error: string; limit: number };
    expect(err.error).toBe('storage_limit_exceeded');
    expect(err.limit).toBe(25 * 1024 * 1024 * 1024);
  });

  it('upload-manifest accepts V2 shingle manifests above the default body limit', async () => {
    const owner = await registerOwner('owner@example.com');
    await createProject(owner, 'p1');
    const device = await pairDevice(owner);

    const createUrl = `/tenants/${owner.tenant.slug}/projects/p1/attestations`;
    const created = await app.inject(
      await signedRequest(device, 'POST', createUrl, { label: 'v2-pdf' }),
    );
    expect(created.statusCode).toBe(201);
    const body = created.json() as {
      attestation: { id: string };
      attempt: { id: string };
    };

    const leafSet = [
      {
        leaf_type: 'file/sha256/v1',
        canonical_payload_hash: 'a'.repeat(64),
        leaf_hash: 'b'.repeat(64),
        metadata: {
          file_name: 'whitepaper.pdf',
          byte_size: 94 * 1024,
          hash_source: 'desktop_renderer',
        },
      },
      ...Array.from({ length: 22000 }, (_, index) => ({
        leaf_type: 'shingle/sha256/v1',
        canonical_payload_hash: index.toString(16).padStart(64, '0'),
        leaf_hash: (index + 1).toString(16).padStart(64, '0'),
        metadata: {
          preset: 'standard',
          source_extraction_method: 'pdf-text-layer/v1',
          normalized_window: 'content-proof-window '.repeat(25),
          source_index: index,
        },
      })),
    ];
    const manifest = {
      schema_version: '1.0',
      leaf_set: leafSet,
      leaf_counts: { file: 1, shingle: 22000, component: 0 },
      source_summary: { file_count: 1, shingle_count: 22000 },
    };
    expect(JSON.stringify(manifest).length).toBeGreaterThan(16 * 1024 * 1024);

    const uploadUrl =
      `/attestations/${body.attestation.id}/attempts/${body.attempt.id}/upload-manifest`;
    const res = await app.inject(
      await signedRequest(device, 'POST', uploadUrl, manifest),
    );

    expect(res.statusCode).toBe(200);
  });
});

describe('session-auth read routes', () => {
  it('lists attestations for a member and exposes single-record details', async () => {
    const owner = await registerOwner('owner@example.com');
    await createProject(owner, 'p1');
    const device = await pairDevice(owner);

    const create = await app.inject(
      await signedRequest(
        device,
        'POST',
        `/tenants/${owner.tenant.slug}/projects/p1/attestations`,
        { label: 'listed' },
      ),
    );
    const attestationId = (
      create.json() as { attestation: { id: string } }
    ).attestation.id;

    const list = await app.inject({
      method: 'GET',
      url: `/tenants/${owner.tenant.slug}/projects/p1/attestations`,
      headers: { cookie: owner.cookies },
    });
    expect(list.statusCode).toBe(200);
    const body = list.json() as { attestations: { id: string }[] };
    expect(body.attestations.map((a) => a.id)).toContain(attestationId);

    const single = await app.inject({
      method: 'GET',
      url: `/attestations/${attestationId}`,
      headers: { cookie: owner.cookies },
    });
    expect(single.statusCode).toBe(200);
    const single_body = single.json() as {
      attestation: {
        tenantSlug: string;
        merkleRoot: string | null;
        packageId: string | null;
        receiptAvailable: boolean;
      };
    };
    expect(single_body.attestation.tenantSlug).toBe(owner.tenant.slug);
    // merkle_root + package_id are populated by the worker on confirmation /
    // receipt generation; the detail route must surface the keys so the
    // clients can render them.
    expect(single_body.attestation).toHaveProperty('merkleRoot');
    expect(single_body.attestation.merkleRoot).toBeNull();
    expect(single_body.attestation.packageId).toBeNull();
    expect(single_body.attestation.receiptAvailable).toBe(false);
  });

  it('desktop device signature can list and read attestation status', async () => {
    const owner = await registerOwner('owner@example.com');
    await createProject(owner, 'p1');
    const device = await pairDevice(owner);

    const create = await app.inject(
      await signedRequest(
        device,
        'POST',
        `/tenants/${owner.tenant.slug}/projects/p1/attestations`,
        { label: 'desktop-status' },
      ),
    );
    const attestationId = (
      create.json() as { attestation: { id: string } }
    ).attestation.id;

    const list = await app.inject(
      await signedRequest(
        device,
        'GET',
        `/tenants/${owner.tenant.slug}/projects/p1/attestations`,
        undefined,
      ),
    );
    expect(list.statusCode).toBe(200);
    expect(
      (list.json() as { attestations: { id: string }[] }).attestations.map(
        (a) => a.id,
      ),
    ).toContain(attestationId);

    const single = await app.inject(
      await signedRequest(device, 'GET', `/attestations/${attestationId}`, undefined),
    );
    expect(single.statusCode).toBe(200);
    const body = single.json() as {
      attestation: { id: string; state: string; receiptAvailable: boolean };
      attempts: { id: string; state: string }[];
    };
    expect(body.attestation.id).toBe(attestationId);
    expect(body.attestation.state).toBe('pending');
    expect(body.attestation.receiptAvailable).toBe(false);
    expect(body.attempts).toHaveLength(1);
  });

  it('GET /attestations/:id/receipt is 404 until a receipt is issued', async () => {
    const owner = await registerOwner('owner@example.com');
    await createProject(owner, 'p1');
    const device = await pairDevice(owner);
    const create = await app.inject(
      await signedRequest(
        device,
        'POST',
        `/tenants/${owner.tenant.slug}/projects/p1/attestations`,
        { label: 'no-receipt-yet' },
      ),
    );
    const attestationId = (
      create.json() as { attestation: { id: string } }
    ).attestation.id;

    const res = await app.inject({
      method: 'GET',
      url: `/attestations/${attestationId}/receipt`,
      headers: { cookie: owner.cookies },
    });
    expect(res.statusCode).toBe(404);
    expect((res.json() as { error: string }).error).toBe(
      'receipt_not_available',
    );
  });

  // Seed an attestation, write a (optionally tampered) signed receipt to the
  // object store, and point the attestation row at it.
  const seedReceipt = async (
    owner: Owner,
    device: PairedDevice,
    label: string,
    opts: { tamper?: boolean } = {},
  ): Promise<string> => {
    const create = await app.inject(
      await signedRequest(
        device,
        'POST',
        `/tenants/${owner.tenant.slug}/projects/p1/attestations`,
        { label },
      ),
    );
    const attestationId = (
      create.json() as { attestation: { id: string } }
    ).attestation.id;

    const receipt = buildAttestationReceipt({
      packageId: 'pkg_test',
      tenantId: owner.tenant.id,
      projectId: '00000000-0000-0000-0000-000000000000',
      attestationId,
      attestationLabel: label,
      confirmedAttemptId: '11111111-1111-1111-1111-111111111111',
      manifestObjectKey: 'tenants/x/manifest.json',
      manifestCanonicalSha256: 'a'.repeat(64),
      merkleRoot: 'b'.repeat(64),
      leafCounts: { file: 1, shingle: 0, component: 0 },
      hashAlgorithm: 'sha256',
      protocolVersion: '1.0',
      deviceSignature: {
        key_id: device.deviceId,
        algorithm: 'ed25519',
        verified: true,
      },
      confirmedAt: '2026-05-14T12:00:00.000Z',
      issuedAt: '2026-05-14T12:00:01.000Z',
    });
    const signed = await signReceipt(
      receipt,
      config.proveriaSigningKeyId,
      PROVERIA_PRIVATE_KEY,
    );
    // Tamper *after* signing — the body no longer matches the signature.
    const stored = opts.tamper
      ? { ...signed, leaf_counts: { file: 1, shingle: 1, component: 0 } }
      : signed;

    const key = `tenants/${owner.tenant.id}/receipts/${attestationId}.json`;
    await putJson(key, JSON.stringify(stored));
    await dbHandle.db
      .update(attestations)
      .set({ receiptJsonObjectKey: key })
      .where(eq(attestations.id, attestationId));
    return attestationId;
  };

  it('GET /attestations/:id/receipt serves a genuine receipt', async () => {
    const owner = await registerOwner('owner@example.com');
    await createProject(owner, 'p1');
    const device = await pairDevice(owner);
    const attestationId = await seedReceipt(owner, device, 'genuine');

    const res = await app.inject({
      method: 'GET',
      url: `/attestations/${attestationId}/receipt`,
      headers: { cookie: owner.cookies },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      signatureValid: boolean | null;
      receipt: { attestation_id: string };
    };
    expect(body.signatureValid).toBeNull();
    expect(body.receipt.attestation_id).toBe(attestationId);
  });

  it('GET /attestations/:id issues a receipt verification link when the receipt exists', async () => {
    const owner = await registerOwner('owner@example.com');
    await createProject(owner, 'p1');
    const device = await pairDevice(owner);
    const attestationId = await seedReceipt(owner, device, 'receipt-link-detail');

    const before = await dbHandle.db
      .select()
      .from(verificationLinks)
      .where(eq(verificationLinks.targetRef, attestationId));
    expect(before).toHaveLength(0);

    const detail = await app.inject({
      method: 'GET',
      url: `/attestations/${attestationId}`,
      headers: { cookie: owner.cookies },
    });
    expect(detail.statusCode).toBe(200);
    const body = detail.json() as {
      attestation: { verificationLinkId: string | null };
    };
    expect(body.attestation.verificationLinkId).toMatch(/^vrf_/);

    const after = await dbHandle.db
      .select()
      .from(verificationLinks)
      .where(eq(verificationLinks.targetRef, attestationId));
    expect(after).toHaveLength(1);
    expect(after[0]?.targetType).toBe('receipt');
  });

  it('desktop device signature can read a receipt', async () => {
    const owner = await registerOwner('owner@example.com');
    await createProject(owner, 'p1');
    const device = await pairDevice(owner);
    const attestationId = await seedReceipt(owner, device, 'desktop-receipt');

    const res = await app.inject(
      await signedRequest(device, 'GET', `/attestations/${attestationId}/receipt`, undefined),
    );
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      signatureValid: boolean | null;
      receipt: { attestation_id: string };
    };
    expect(body.signatureValid).toBeNull();
    expect(body.receipt.attestation_id).toBe(attestationId);
  });

  it('GET /attestations/:id/receipt serves receipts without platform validation metadata', async () => {
    const owner = await registerOwner('owner@example.com');
    await createProject(owner, 'p1');
    const device = await pairDevice(owner);
    const attestationId = await seedReceipt(owner, device, 'tampered', {
      tamper: true,
    });

    const res = await app.inject({
      method: 'GET',
      url: `/attestations/${attestationId}/receipt`,
      headers: { cookie: owner.cookies },
    });
    // The route still serves the receipt body. Platform signature validation is
    // no longer part of the attestation model.
    expect(res.statusCode).toBe(200);
    expect(
      (res.json() as { signatureValid: boolean | null }).signatureValid,
    ).toBeNull();
  });

  it('non-member sees 404 on GET /attestations/:id', async () => {
    const owner = await registerOwner('owner@example.com');
    await createProject(owner, 'p1');
    const device = await pairDevice(owner);
    const create = await app.inject(
      await signedRequest(
        device,
        'POST',
        `/tenants/${owner.tenant.slug}/projects/p1/attestations`,
        { label: 'private' },
      ),
    );
    const attestationId = (
      create.json() as { attestation: { id: string } }
    ).attestation.id;

    const stranger = await registerOwner('stranger@example.com');
    const res = await app.inject({
      method: 'GET',
      url: `/attestations/${attestationId}`,
      headers: { cookie: stranger.cookies },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('attestation access grants (M7 / C24)', () => {
  // Helper: owner creates a project + attestation, returns the attestation id.
  const seedAttestation = async (owner: Owner): Promise<string> => {
    await createProject(owner, 'p1');
    const device = await pairDevice(owner);
    const create = await app.inject(
      await signedRequest(
        device,
        'POST',
        `/tenants/${owner.tenant.slug}/projects/p1/attestations`,
        { label: 'grant-test' },
      ),
    );
    return (create.json() as { attestation: { id: string } }).attestation.id;
  };

  it('admin grants access; the consumer sees it in /me/attestation-access', async () => {
    const owner = await registerOwner('owner@example.com');
    const stranger = await registerOwner('stranger@example.com');
    const attestationId = await seedAttestation(owner);

    const grant = await app.inject({
      method: 'POST',
      url: `/tenants/${owner.tenant.slug}/attestations/${attestationId}/access-grants`,
      headers: { cookie: owner.cookies },
      payload: { email: 'stranger@example.com' },
    });
    expect(grant.statusCode).toBe(201);
    const grantBody = grant.json() as {
      grant: { id: string; grantedToEmail: string };
    };
    expect(grantBody.grant.grantedToEmail).toBe('stranger@example.com');

    // Admin's grant list now includes it.
    const adminList = await app.inject({
      method: 'GET',
      url: `/tenants/${owner.tenant.slug}/attestations/${attestationId}/access-grants`,
      headers: { cookie: owner.cookies },
    });
    expect(
      (adminList.json() as { grants: unknown[] }).grants,
    ).toHaveLength(1);

    // Stranger sees the attestation in their access listing.
    const mine = await app.inject({
      method: 'GET',
      url: '/me/attestation-access',
      headers: { cookie: stranger.cookies },
    });
    expect(mine.statusCode).toBe(200);
    const mineBody = mine.json() as {
      grants: Array<{ attestation: { id: string } }>;
    };
    expect(mineBody.grants).toHaveLength(1);
    expect(mineBody.grants[0]?.attestation.id).toBe(attestationId);
  });

  it('producer desktop can grant, list, and revoke access for their own attestation', async () => {
    const owner = await registerOwner('desktop-owner@example.com');
    const attestationId = await seedAttestation(owner);
    await dbHandle.sql`
      UPDATE public.tenant_memberships
      SET role = 'producer'
      WHERE tenant_id = ${owner.tenant.id} AND user_id = ${owner.userId}`;
    const device = await pairDevice(owner, 'Producer Desktop');
    const url = `/tenants/${owner.tenant.slug}/attestations/${attestationId}/access-grants`;

    const grant = await app.inject(
      await signedRequest(device, 'POST', url, {
        email: 'desktop-verifier@example.com',
      }),
    );
    expect(grant.statusCode).toBe(201);
    const grantId = (grant.json() as { grant: { id: string } }).grant.id;

    const list = await app.inject(
      await signedRequest(device, 'GET', url, undefined),
    );
    expect(list.statusCode).toBe(200);
    expect(
      (list.json() as { grants: { grantedToEmail: string }[] }).grants.map(
        (row) => row.grantedToEmail,
      ),
    ).toContain('desktop-verifier@example.com');

    const revoke = await app.inject(
      await signedRequest(device, 'DELETE', `${url}/${grantId}`, undefined),
    );
    expect(revoke.statusCode).toBe(204);
  });

  it('granting an unknown email creates a pending grant and emits a token notification', async () => {
    const owner = await registerOwner('owner@example.com');
    const attestationId = await seedAttestation(owner);
    notificationLines = [];
    const res = await app.inject({
      method: 'POST',
      url: `/tenants/${owner.tenant.slug}/attestations/${attestationId}/access-grants`,
      headers: { cookie: owner.cookies },
      payload: { email: 'nobody@example.com' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as {
      grant: { id: string; grantedToEmail: string; pending: boolean };
    };
    expect(body.grant.grantedToEmail).toBe('nobody@example.com');
    expect(body.grant.pending).toBe(true);

    // The dev notification sink received a grant token line.
    const grantNotices = notificationLines.filter((l) =>
      l.includes('attestation_access_grant'),
    );
    expect(grantNotices).toHaveLength(1);
    expect(grantNotices[0]).toContain('nobody@example.com');
    expect(grantNotices[0]).not.toContain('(existing-account)');
  });

  it('granting an existing-user email creates a claimed (non-pending) grant', async () => {
    const owner = await registerOwner('owner@example.com');
    await registerOwner('stranger@example.com');
    const attestationId = await seedAttestation(owner);
    notificationLines = [];
    const res = await app.inject({
      method: 'POST',
      url: `/tenants/${owner.tenant.slug}/attestations/${attestationId}/access-grants`,
      headers: { cookie: owner.cookies },
      payload: { email: 'stranger@example.com' },
    });
    expect(res.statusCode).toBe(201);
    expect(
      (res.json() as { grant: { pending: boolean } }).grant.pending,
    ).toBe(false);
    const grantNotices = notificationLines.filter((l) =>
      l.includes('attestation_access_grant'),
    );
    expect(grantNotices[0]).toContain('(existing-account)');
  });

  it('re-granting an already-granted user is idempotent (returns the same grant)', async () => {
    const owner = await registerOwner('owner@example.com');
    const stranger = await registerOwner('stranger@example.com');
    void stranger;
    const attestationId = await seedAttestation(owner);
    const url = `/tenants/${owner.tenant.slug}/attestations/${attestationId}/access-grants`;
    const a = await app.inject({
      method: 'POST',
      url,
      headers: { cookie: owner.cookies },
      payload: { email: 'stranger@example.com' },
    });
    const b = await app.inject({
      method: 'POST',
      url,
      headers: { cookie: owner.cookies },
      payload: { email: 'stranger@example.com' },
    });
    expect(a.statusCode).toBe(201);
    expect(b.statusCode).toBe(200);
    const idA = (a.json() as { grant: { id: string } }).grant.id;
    const idB = (b.json() as { grant: { id: string } }).grant.id;
    expect(idB).toBe(idA);
  });

  it('revoking a grant removes it from the consumer listing; re-granting creates a new row', async () => {
    const owner = await registerOwner('owner@example.com');
    const stranger = await registerOwner('stranger@example.com');
    const attestationId = await seedAttestation(owner);
    const grant = await app.inject({
      method: 'POST',
      url: `/tenants/${owner.tenant.slug}/attestations/${attestationId}/access-grants`,
      headers: { cookie: owner.cookies },
      payload: { email: 'stranger@example.com' },
    });
    const grantId = (grant.json() as { grant: { id: string } }).grant.id;

    const revoke = await app.inject({
      method: 'DELETE',
      url: `/tenants/${owner.tenant.slug}/attestations/${attestationId}/access-grants/${grantId}`,
      headers: { cookie: owner.cookies },
    });
    expect(revoke.statusCode).toBe(204);

    const empty = await app.inject({
      method: 'GET',
      url: '/me/attestation-access',
      headers: { cookie: stranger.cookies },
    });
    expect(
      (empty.json() as { grants: unknown[] }).grants,
    ).toHaveLength(0);

    // Re-granting after revoke makes a new grant row (different id).
    const regrant = await app.inject({
      method: 'POST',
      url: `/tenants/${owner.tenant.slug}/attestations/${attestationId}/access-grants`,
      headers: { cookie: owner.cookies },
      payload: { email: 'stranger@example.com' },
    });
    expect(regrant.statusCode).toBe(201);
    const newId = (regrant.json() as { grant: { id: string } }).grant.id;
    expect(newId).not.toBe(grantId);
  });

  it('a non-member cannot grant access to an attestation (404, no enumeration)', async () => {
    const owner = await registerOwner('owner@example.com');
    const stranger = await registerOwner('stranger@example.com');
    const attestationId = await seedAttestation(owner);
    const res = await app.inject({
      method: 'POST',
      url: `/tenants/${owner.tenant.slug}/attestations/${attestationId}/access-grants`,
      headers: { cookie: stranger.cookies },
      payload: { email: 'stranger@example.com' },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('consumer lookup (M7 / C26)', () => {
  // Seed a confirmed attestation by walking the real create → upload-manifest
  // → finalize flow, then directly transitioning to confirmed (the worker
  // doesn't run in api tests). Returns the attestation id and the per-leaf
  // canonical payload hashes that a consumer might submit for matching.
  const seedConfirmedAttestation = async (
    owner: Owner,
    opts: {
      label?: string;
      plan?: 'free' | 'team_pro';
      leafPayloadHashes: Uint8Array[];
      leafTypes?: Array<typeof LEAF_TYPES[keyof typeof LEAF_TYPES]>;
      leafMetadata?: Array<Record<string, unknown> | undefined>;
    },
  ): Promise<{ attestationId: string; payloadHashesHex: string[] }> => {
    if (opts.plan === 'team_pro') {
      await dbHandle.sql`
        UPDATE public.tenants SET plan = 'team_pro' WHERE id = ${owner.tenant.id}`;
    }
    const leafTypes =
      opts.leafTypes ??
      opts.leafPayloadHashes.map(() => LEAF_TYPES.fileSha256V1);
    await createProject(owner, 'p1');
    const device = await pairDevice(owner);
    const create = await app.inject(
      await signedRequest(
        device,
        'POST',
        `/tenants/${owner.tenant.slug}/projects/p1/attestations`,
        { label: opts.label ?? 'lookup-test' },
      ),
    );
    const created = create.json() as {
      attestation: { id: string };
      attempt: { id: string };
      project: { id: string };
      tenant: { id: string };
    };

    const manifest: Manifest = buildManifest({
      tenantId: created.tenant.id,
      projectId: created.project.id,
      attestationId: created.attestation.id,
      attemptId: created.attempt.id,
      createdByUserId: owner.userId,
      createdByDeviceId: device.deviceId,
      createdByProfileId: '66666666-6666-6666-6666-666666666666',
      leaves: opts.leafPayloadHashes.map((p, index) => ({
        leafType: leafTypes[index] ?? LEAF_TYPES.fileSha256V1,
        canonicalPayloadHash: p,
        ...(opts.leafMetadata?.[index]
          ? { metadata: opts.leafMetadata[index] }
          : {}),
      })),
      sourceSummary: {
        file_count: leafTypes.filter(
          (leafType) => leafType === LEAF_TYPES.fileSha256V1,
        ).length,
        shingle_count: leafTypes.filter(
          (leafType) => leafType === LEAF_TYPES.shingleSha256V1,
        ).length,
        ocr_page_count: 0,
      },
    });
    const { digest } = buildSigningDigest(
      manifest as unknown as Record<string, unknown>,
    );
    const signature = await signEd25519(digest, device.privateKey);
    const signedManifest: Manifest = {
      ...manifest,
      signatures: [
        {
          signer_kind: 'device',
          key_id: device.deviceId,
          algorithm: 'ed25519',
          signature,
        },
      ],
    };

    await app.inject(
      await signedRequest(
        device,
        'POST',
        `/attestations/${created.attestation.id}/attempts/${created.attempt.id}/upload-manifest`,
        signedManifest as unknown as Record<string, unknown>,
      ),
    );
    await app.inject(
      await signedRequest(
        device,
        'POST',
        `/attestations/${created.attestation.id}/attempts/${created.attempt.id}/finalize`,
        {},
      ),
    );

    // Bypass the worker — flip the rows to confirmed directly so the lookup
    // surface has something to query.
    const manifestObjectKey = `tenants/${created.tenant.id}/projects/${created.project.id}/attestations/${created.attestation.id}/attempts/${created.attempt.id}/manifest.json`;
    await dbHandle.sql`
      UPDATE public.attestations
      SET state = 'confirmed',
          confirmed_attempt_id = ${created.attempt.id},
          confirmed_at = now(),
          merkle_root = ${manifest.merkle_root},
          manifest_object_key = ${manifestObjectKey}
      WHERE id = ${created.attestation.id}`;
    await dbHandle.sql`
      UPDATE public.submission_attempts
      SET state = 'validated', validated_at = now()
      WHERE id = ${created.attempt.id}`;

    return {
      attestationId: created.attestation.id,
      payloadHashesHex: opts.leafPayloadHashes.map((p) =>
        Buffer.from(p).toString('hex'),
      ),
    };
  };

  const payload = (n: number): Uint8Array => {
    const b = new Uint8Array(32);
    b[31] = n;
    return b;
  };

  it('attestation creator can open and use the private lookup without a verifier grant', async () => {
    const owner = await registerOwner('owner@example.com');
    const { attestationId, payloadHashesHex } = await seedConfirmedAttestation(
      owner,
      {
        plan: 'team_pro',
        leafPayloadHashes: [payload(1)],
      },
    );

    const metadata = await app.inject({
      method: 'GET',
      url: `/attestations/${attestationId}/lookup`,
      headers: { cookie: owner.cookies },
    });
    expect(metadata.statusCode).toBe(200);

    const lookup = await app.inject({
      method: 'POST',
      url: `/attestations/${attestationId}/lookup`,
      headers: { cookie: owner.cookies },
      payload: { submittedHash: payloadHashesHex[0] },
    });
    expect(lookup.statusCode).toBe(201);
    expect((lookup.json() as { package: { result_type: string } }).package)
      .toMatchObject({ result_type: 'match' });
  });

  it('verifier requests access; owner approves; lookup becomes available', async () => {
    const owner = await registerOwner('owner@example.com');
    const verifier = await registerOwner('verifier@example.com');
    const { attestationId } = await seedConfirmedAttestation(owner, {
      plan: 'team_pro',
      leafPayloadHashes: [payload(1)],
    });

    const missing = await app.inject({
      method: 'GET',
      url: `/attestations/${attestationId}/lookup`,
      headers: { cookie: verifier.cookies },
    });
    expect(missing.statusCode).toBe(404);

    const request = await app.inject({
      method: 'POST',
      url: `/attestations/${attestationId}/access-request`,
      headers: { cookie: verifier.cookies },
      payload: { message: 'Please approve QA access.' },
    });
    expect(request.statusCode).toBe(201);
    const requestId = (request.json() as { request: { id: string } }).request
      .id;
    expect(requestId).toBeTruthy();

    const duplicate = await app.inject({
      method: 'POST',
      url: `/attestations/${attestationId}/access-request`,
      headers: { cookie: verifier.cookies },
      payload: { message: 'Following up with a second note.' },
    });
    expect(duplicate.statusCode).toBe(200);
    expect(
      (duplicate.json() as { request: { id: string } }).request.id,
    ).toBe(requestId);

    const status = await app.inject({
      method: 'GET',
      url: `/attestations/${attestationId}/access-request`,
      headers: { cookie: verifier.cookies },
    });
    expect(status.statusCode).toBe(200);
    expect(
      (status.json() as { request: { id: string; status: string } }).request,
    ).toMatchObject({ id: requestId, status: 'pending' });

    const list = await app.inject({
      method: 'GET',
      url: `/tenants/${owner.tenant.slug}/attestation-access-requests`,
      headers: { cookie: owner.cookies },
    });
    expect(list.statusCode).toBe(200);
    const listed = list.json() as {
      requests: Array<{
        id: string;
        requestedByEmail: string;
        message: string;
        attestation: { id: string };
      }>;
    };
    expect(listed.requests).toHaveLength(1);
    expect(listed.requests[0]).toMatchObject({
      id: requestId,
      requestedByEmail: 'verifier@example.com',
      message: 'Please approve QA access.',
      attestation: { id: attestationId },
    });

    const approve = await app.inject({
      method: 'POST',
      url: `/tenants/${owner.tenant.slug}/attestation-access-requests/${requestId}/approve`,
      headers: { cookie: owner.cookies },
      payload: { reason: 'Verified QA reviewer.' },
    });
    expect(approve.statusCode).toBe(200);
    expect(
      (approve.json() as { request: { status: string } }).request.status,
    ).toBe('approved');

    const lookup = await app.inject({
      method: 'GET',
      url: `/attestations/${attestationId}/lookup`,
      headers: { cookie: verifier.cookies },
    });
    expect(lookup.statusCode).toBe(200);

    const approvedStatus = await app.inject({
      method: 'GET',
      url: `/attestations/${attestationId}/access-request`,
      headers: { cookie: verifier.cookies },
    });
    expect(
      (approvedStatus.json() as { request: { status: string } }).request.status,
    ).toBe('granted');

    const events = await app.inject({
      method: 'GET',
      url: `/tenants/${owner.tenant.slug}/audit?limit=20`,
      headers: { cookie: owner.cookies },
    });
    const actions = (events.json() as { events: Array<{ action: string }> })
      .events.map((event) => event.action);
    expect(actions).toContain('attestation_access.requested');
    expect(actions).toContain('attestation_access_request.approved');
  });

  it('owner can deny a verifier access request without creating a grant', async () => {
    const owner = await registerOwner('owner@example.com');
    const verifier = await registerOwner('denied@example.com');
    const { attestationId } = await seedConfirmedAttestation(owner, {
      plan: 'team_pro',
      leafPayloadHashes: [payload(1)],
    });

    const request = await app.inject({
      method: 'POST',
      url: `/attestations/${attestationId}/access-request`,
      headers: { cookie: verifier.cookies },
      payload: { message: 'Need access to review this evidence.' },
    });
    expect(request.statusCode).toBe(201);
    const requestId = (request.json() as { request: { id: string } }).request
      .id;

    const deny = await app.inject({
      method: 'POST',
      url: `/tenants/${owner.tenant.slug}/attestation-access-requests/${requestId}/deny`,
      headers: { cookie: owner.cookies },
      payload: { reason: 'Reviewer is not authorized for this record.' },
    });
    expect(deny.statusCode).toBe(200);
    expect((deny.json() as { request: { status: string } }).request.status).toBe(
      'denied',
    );

    const status = await app.inject({
      method: 'GET',
      url: `/attestations/${attestationId}/access-request`,
      headers: { cookie: verifier.cookies },
    });
    expect(
      (
        status.json() as {
          request: { status: string; resolutionReason: string };
        }
      ).request,
    ).toMatchObject({
      status: 'denied',
      resolutionReason: 'Reviewer is not authorized for this record.',
    });

    const retry = await app.inject({
      method: 'POST',
      url: `/attestations/${attestationId}/access-request`,
      headers: { cookie: verifier.cookies },
      payload: { message: 'Please reconsider.' },
    });
    expect(retry.statusCode).toBe(409);
    expect((retry.json() as { error: string }).error).toBe(
      'access_request_denied_final',
    );

    const lookup = await app.inject({
      method: 'GET',
      url: `/attestations/${attestationId}/lookup`,
      headers: { cookie: verifier.cookies },
    });
    expect(lookup.statusCode).toBe(404);
  });

  it('GET /attestations/:id/lookup returns the §16.3 pre-lookup metadata only', async () => {
    const owner = await registerOwner('owner@example.com');
    const { attestationId } = await seedConfirmedAttestation(owner, {
      leafPayloadHashes: [payload(1), payload(2)],
    });
    const res = await app.inject({
      method: 'GET',
      url: `/attestations/${attestationId}/lookup`,
      headers: { cookie: owner.cookies },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      attestation: { coverageType: string; hashAlgorithm: string };
      project: { slug: string };
      tenant: { slug: string };
    };
    expect(body.attestation.coverageType).toBe('whole-file');
    expect(body.attestation.hashAlgorithm).toBe('sha256');
    // No leaf counts / artifact counts exposed (§16.3 conservative subset).
    expect(JSON.stringify(body)).not.toContain('file_count');
    expect(JSON.stringify(body)).not.toContain('leaf_counts');
  });

  it('GET /attestations/:id/lookup labels exact image proof coverage', async () => {
    const owner = await registerOwner('owner@example.com');
    const { attestationId } = await seedConfirmedAttestation(owner, {
      leafPayloadHashes: [payload(1), payload(1)],
      leafTypes: [LEAF_TYPES.fileSha256V1, LEAF_TYPES.componentSha256V1],
      leafMetadata: [
        undefined,
        { component_method: 'exact-image-sha256/v1', media_type: 'image/png' },
      ],
    });
    const res = await app.inject({
      method: 'GET',
      url: `/attestations/${attestationId}/lookup`,
      headers: { cookie: owner.cookies },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      attestation: { coverageType: string; hashAlgorithm: string };
    };
    expect(body.attestation.coverageType).toBe(
      'whole-file + exact image proof',
    );
  });

  it('POST /lookup on a paid tenant: matching hash → self-verifiable match package; proof verifies', async () => {
    const owner = await registerOwner('owner@example.com');
    const { attestationId, payloadHashesHex } = await seedConfirmedAttestation(
      owner,
      { plan: 'team_pro', leafPayloadHashes: [payload(1), payload(2), payload(3)] },
    );

    const res = await app.inject({
      method: 'POST',
      url: `/attestations/${attestationId}/lookup`,
      headers: { cookie: owner.cookies },
      payload: { submittedHash: payloadHashesHex[1] },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as {
      packageId: string;
      signed: boolean;
      package: ResultPackage;
      retrieveUrl: string;
    };
    expect(body.signed).toBe(false);
    expect(body.package.result_type).toBe('match');
    expect(body.package.match).not.toBeNull();
    expect(verifyMatchProof(body.package)).toBe(true);
    expect(body.retrieveUrl).toBe(`/lookup-results/${body.packageId}`);
  });

  it('POST /lookup with content candidates matches committed shingle leaves', async () => {
    const owner = await registerOwner('owner@example.com');
    const { attestationId, payloadHashesHex } = await seedConfirmedAttestation(
      owner,
      {
        plan: 'team_pro',
        leafPayloadHashes: [payload(1), payload(2), payload(3)],
        leafTypes: [
          LEAF_TYPES.fileSha256V1,
          LEAF_TYPES.shingleSha256V1,
          LEAF_TYPES.shingleSha256V1,
        ],
        leafMetadata: [
          undefined,
          { preset: 'standard', source_extraction_method: 'pdf-text-layer/v1', source_index: 0 },
          { preset: 'standard', source_extraction_method: 'ocr-tesseract/v1', source_index: 1 },
        ],
      },
    );

    const res = await app.inject({
      method: 'POST',
      url: `/attestations/${attestationId}/lookup`,
      headers: { cookie: owner.cookies },
      payload: {
        submittedHash: 'e'.repeat(64),
        candidateHashes: ['f'.repeat(64), payloadHashesHex[2]],
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json() as {
      package: ResultPackage;
      signed: boolean;
    };
    expect(body.signed).toBe(false);
    expect(body.package.result_type).toBe('match');
    expect(body.package.submitted_hash).toBe(payloadHashesHex[2]);
    expect(body.package.match?.leaf_type).toBe(LEAF_TYPES.shingleSha256V1);
    expect(body.package.match?.source_extraction_method).toBe(
      'ocr-tesseract/v1',
    );
    expect(body.package.match?.preset).toBe('standard');
    expect(body.package.match?.source_index).toBe(1);
    expect(verifyMatchProof(body.package)).toBe(true);
  });

  it('POST /lookup with exact_image matches committed image component leaves', async () => {
    const owner = await registerOwner('owner@example.com');
    const { attestationId, payloadHashesHex } = await seedConfirmedAttestation(
      owner,
      {
        plan: 'team_pro',
        leafPayloadHashes: [payload(1), payload(1)],
        leafTypes: [LEAF_TYPES.fileSha256V1, LEAF_TYPES.componentSha256V1],
        leafMetadata: [
          undefined,
          {
            component_method: 'exact-image-sha256/v1',
            media_type: 'image/png',
          },
        ],
      },
    );

    const res = await app.inject({
      method: 'POST',
      url: `/attestations/${attestationId}/lookup`,
      headers: { cookie: owner.cookies },
      payload: {
        submittedHash: payloadHashesHex[0],
        lookupKind: 'exact_image',
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json() as {
      package: ResultPackage;
      signed: boolean;
    };
    expect(body.signed).toBe(false);
    expect(body.package.result_type).toBe('match');
    expect(body.package.match?.leaf_type).toBe(LEAF_TYPES.componentSha256V1);
    expect(body.package.match?.component_method).toBe(
      'exact-image-sha256/v1',
    );
    expect(body.package.match?.media_type).toBe('image/png');
    expect(verifyMatchProof(body.package)).toBe(true);
  });

  it('POST /lookup with content candidates does not match whole-file leaves', async () => {
    const owner = await registerOwner('owner@example.com');
    const { attestationId, payloadHashesHex } = await seedConfirmedAttestation(
      owner,
      {
        plan: 'team_pro',
        leafPayloadHashes: [payload(1), payload(2)],
        leafTypes: [LEAF_TYPES.fileSha256V1, LEAF_TYPES.shingleSha256V1],
      },
    );

    const res = await app.inject({
      method: 'POST',
      url: `/attestations/${attestationId}/lookup`,
      headers: { cookie: owner.cookies },
      payload: {
        submittedHash: payloadHashesHex[0],
        candidateHashes: [payloadHashesHex[0]],
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json() as { package: ResultPackage };
    expect(body.package.result_type).toBe('no_match');
    expect(body.package.match).toBeNull();
  });

  it('POST /lookup with a non-matching hash returns a no-match package', async () => {
    const owner = await registerOwner('owner@example.com');
    const { attestationId } = await seedConfirmedAttestation(owner, {
      plan: 'team_pro',
      leafPayloadHashes: [payload(1), payload(2)],
    });
    const res = await app.inject({
      method: 'POST',
      url: `/attestations/${attestationId}/lookup`,
      headers: { cookie: owner.cookies },
      payload: { submittedHash: 'f'.repeat(64) },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as {
      package: ResultPackage;
      signed: boolean;
    };
    expect(body.package.result_type).toBe('no_match');
    expect(body.package.match).toBeNull();
    expect(body.package.no_match_statement).toMatch(/not present/);
    expect(body.signed).toBe(false);
  });

  it('GET /lookup-results/:packageId retrieves the stored self-verifiable package', async () => {
    const owner = await registerOwner('owner@example.com');
    const { attestationId, payloadHashesHex } = await seedConfirmedAttestation(
      owner,
      { plan: 'team_pro', leafPayloadHashes: [payload(1)] },
    );
    const lookup = await app.inject({
      method: 'POST',
      url: `/attestations/${attestationId}/lookup`,
      headers: { cookie: owner.cookies },
      payload: { submittedHash: payloadHashesHex[0] },
    });
    const packageId = (lookup.json() as { packageId: string }).packageId;

    // Retrieval is unauthenticated by design (§16.1 direct URL / QR / id).
    const res = await app.inject({
      method: 'GET',
      url: `/lookup-results/${packageId}`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      signed: boolean;
      signatureValid: boolean | null;
      package: ResultPackage;
    };
    expect(body.signed).toBe(false);
    expect(body.signatureValid).toBeNull();
    expect(body.package.package_id).toBe(packageId);
  });

  it('POST /lookup on a Free tenant produces an unsigned but self-verifiable match', async () => {
    const owner = await registerOwner('owner@example.com');
    const { attestationId, payloadHashesHex } = await seedConfirmedAttestation(
      owner,
      // Default plan is 'free'.
      { leafPayloadHashes: [payload(7), payload(11)] },
    );
    const res = await app.inject({
      method: 'POST',
      url: `/attestations/${attestationId}/lookup`,
      headers: { cookie: owner.cookies },
      payload: { submittedHash: payloadHashesHex[0] },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { signed: boolean; package: ResultPackage };
    expect(body.signed).toBe(false);
    expect(body.package.signatures).toEqual([]);
    // Math alone still verifies the match (Free-tier "self-verifiable").
    expect(verifyMatchProof(body.package)).toBe(true);
  });

  // -------------------------------------------------------------------
  // M13/C51 — verification fair-use rate limit
  // -------------------------------------------------------------------
  it('Free tenant lookup is throttled after 6 requests/minute (429)', async () => {
    const owner = await registerOwner('owner@example.com');
    const { attestationId, payloadHashesHex } = await seedConfirmedAttestation(
      owner,
      { leafPayloadHashes: [payload(7)] },
    );
    // First 6 succeed (Free cap).
    for (let i = 0; i < 6; i += 1) {
      const r = await app.inject({
        method: 'POST',
        url: `/attestations/${attestationId}/lookup`,
        headers: { cookie: owner.cookies },
        payload: { submittedHash: payloadHashesHex[0] },
      });
      expect(r.statusCode).toBe(201);
    }
    // 7th in the same minute returns 429.
    const over = await app.inject({
      method: 'POST',
      url: `/attestations/${attestationId}/lookup`,
      headers: { cookie: owner.cookies },
      payload: { submittedHash: payloadHashesHex[0] },
    });
    expect(over.statusCode).toBe(429);
    const body = over.json() as {
      error: string;
      limit: number;
      windowSeconds: number;
    };
    expect(body.error).toBe('verification_rate_limit_exceeded');
    expect(body.limit).toBe(6);
    expect(body.windowSeconds).toBe(60);
    expect(over.headers['retry-after']).toBe('60');
  });

  it('a non-member without a grant cannot lookup a private attestation (404)', async () => {
    const owner = await registerOwner('owner@example.com');
    const { attestationId } = await seedConfirmedAttestation(owner, {
      plan: 'team_pro',
      leafPayloadHashes: [payload(1)],
    });
    const stranger = await registerOwner('stranger@example.com');
    const res = await app.inject({
      method: 'POST',
      url: `/attestations/${attestationId}/lookup`,
      headers: { cookie: stranger.cookies },
      payload: { submittedHash: 'a'.repeat(64) },
    });
    expect(res.statusCode).toBe(404);
  });

  it('POST /lookup auto-issues a verification link that GET /v/:linkId resolves to the same package', async () => {
    const owner = await registerOwner('owner@example.com');
    const { attestationId, payloadHashesHex } = await seedConfirmedAttestation(
      owner,
      { plan: 'team_pro', leafPayloadHashes: [payload(1)] },
    );
    const lookup = await app.inject({
      method: 'POST',
      url: `/attestations/${attestationId}/lookup`,
      headers: { cookie: owner.cookies },
      payload: { submittedHash: payloadHashesHex[0] },
    });
    const lookupBody = lookup.json() as {
      packageId: string;
      linkId: string;
      verificationUrl: string;
    };
    expect(lookupBody.linkId).toMatch(/^vrf_[0-9a-f]{24}$/);
    expect(lookupBody.verificationUrl).toBe(`/v/${lookupBody.linkId}`);

    // Resolver is unauthenticated by design (§18.4) — anyone with the
    // unguessable link id can see the underlying self-verifiable evidence.
    const resolve = await app.inject({
      method: 'GET',
      url: `/v/${lookupBody.linkId}`,
    });
    expect(resolve.statusCode).toBe(200);
    const body = resolve.json() as {
      targetType: string;
      signed: boolean;
      signatureValid: boolean | null;
      payload: { package_id: string };
    };
    expect(body.targetType).toBe('lookup_result');
    expect(body.signed).toBe(false);
    expect(body.signatureValid).toBeNull();
    expect(body.payload.package_id).toBe(lookupBody.packageId);
  });

  it('POST /lookup auto-issues a verification link for no-match packages', async () => {
    const owner = await registerOwner('owner@example.com');
    const { attestationId } = await seedConfirmedAttestation(owner, {
      plan: 'team_pro',
      leafPayloadHashes: [payload(1)],
    });
    const lookup = await app.inject({
      method: 'POST',
      url: `/attestations/${attestationId}/lookup`,
      headers: { cookie: owner.cookies },
      payload: { submittedHash: 'f'.repeat(64) },
    });
    expect(lookup.statusCode).toBe(201);
    const lookupBody = lookup.json() as {
      packageId: string;
      linkId: string;
      verificationUrl: string;
      package: ResultPackage;
    };
    expect(lookupBody.package.result_type).toBe('no_match');
    expect(lookupBody.linkId).toMatch(/^vrf_[0-9a-f]{24}$/);
    expect(lookupBody.verificationUrl).toBe(`/v/${lookupBody.linkId}`);

    const resolve = await app.inject({
      method: 'GET',
      url: `/v/${lookupBody.linkId}`,
    });
    expect(resolve.statusCode).toBe(200);
    const body = resolve.json() as {
      targetType: string;
      signed: boolean;
      signatureValid: boolean | null;
      payload: ResultPackage;
    };
    expect(body.targetType).toBe('lookup_result');
    expect(body.signed).toBe(false);
    expect(body.signatureValid).toBeNull();
    expect(body.payload.package_id).toBe(lookupBody.packageId);
    expect(body.payload.result_type).toBe('no_match');
    expect(body.payload.no_match_statement).toMatch(/not present/);
  });

  it('GET /v/:linkId returns 404 unavailable for a nonexistent link', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v/vrf_doesnotexist0000000000000',
    });
    expect(res.statusCode).toBe(404);
    expect((res.json() as { error: string }).error).toBe('unavailable');
  });

  // Helper: do a lookup, return the linkId.
  const doLookupReturnLinkId = async (
    owner: Owner,
    attestationId: string,
    submittedHash: string,
  ): Promise<string> => {
    const res = await app.inject({
      method: 'POST',
      url: `/attestations/${attestationId}/lookup`,
      headers: { cookie: owner.cookies },
      payload: { submittedHash },
    });
    return (res.json() as { linkId: string }).linkId;
  };

  it('admin can list, revoke, and rotate verification links (C29)', async () => {
    const owner = await registerOwner('owner@example.com');
    const { attestationId, payloadHashesHex } = await seedConfirmedAttestation(
      owner,
      { plan: 'team_pro', leafPayloadHashes: [payload(1)] },
    );
    const linkA = await doLookupReturnLinkId(
      owner,
      attestationId,
      payloadHashesHex[0]!,
    );

    // List should include this active link.
    const list = await app.inject({
      method: 'GET',
      url: `/tenants/${owner.tenant.slug}/attestations/${attestationId}/verification-links`,
      headers: { cookie: owner.cookies },
    });
    const listed = (
      list.json() as { links: Array<{ id: string; state: string }> }
    ).links;
    expect(listed.some((l) => l.id === linkA && l.state === 'active')).toBe(
      true,
    );

    // Revoke linkA. After revoke, /v/linkA → 404 unavailable.
    const revoke = await app.inject({
      method: 'POST',
      url: `/tenants/${owner.tenant.slug}/verification-links/${linkA}/revoke`,
      headers: { cookie: owner.cookies },
    });
    expect(revoke.statusCode).toBe(204);
    const afterRevoke = await app.inject({
      method: 'GET',
      url: `/v/${linkA}`,
    });
    expect(afterRevoke.statusCode).toBe(404);

    // Re-revoking is a 409.
    const reRevoke = await app.inject({
      method: 'POST',
      url: `/tenants/${owner.tenant.slug}/verification-links/${linkA}/revoke`,
      headers: { cookie: owner.cookies },
    });
    expect(reRevoke.statusCode).toBe(409);

    // Do a fresh lookup → new linkB, then rotate it → linkC.
    const linkB = await doLookupReturnLinkId(
      owner,
      attestationId,
      payloadHashesHex[0]!,
    );
    const rotate = await app.inject({
      method: 'POST',
      url: `/tenants/${owner.tenant.slug}/verification-links/${linkB}/rotate`,
      headers: { cookie: owner.cookies },
    });
    expect(rotate.statusCode).toBe(201);
    const linkC = (rotate.json() as { newLinkId: string }).newLinkId;
    expect(linkC).not.toBe(linkB);
    // Old one is now 404, new one resolves.
    expect(
      (await app.inject({ method: 'GET', url: `/v/${linkB}` })).statusCode,
    ).toBe(404);
    expect(
      (await app.inject({ method: 'GET', url: `/v/${linkC}` })).statusCode,
    ).toBe(200);

    const audit = await app.inject({
      method: 'GET',
      url: `/tenants/${owner.tenant.slug}/audit?limit=25`,
      headers: { cookie: owner.cookies },
    });
    expect(audit.statusCode).toBe(200);
    const events = (
      audit.json() as {
        events: Array<{
          action: string;
          targetId: string | null;
          payload: Record<string, unknown>;
        }>;
      }
    ).events;
    const revoked = events.find(
      (event) =>
        event.action === 'verification_link.revoked' &&
        event.targetId === linkA,
    );
    expect(revoked?.payload).toMatchObject({
      linkId: linkA,
      targetType: 'lookup_result',
    });
    expect(revoked?.payload.targetRef).toMatch(/^pkg_/);
    expect(revoked?.payload.revokedAt).toEqual(expect.any(String));

    const rotated = events.find(
      (event) =>
        event.action === 'verification_link.rotated' &&
        event.targetId === linkB,
    );
    expect(rotated?.payload).toMatchObject({
      linkId: linkB,
      rotatedToLinkId: linkC,
      targetType: 'lookup_result',
    });
    expect(rotated?.payload.targetRef).toMatch(/^pkg_/);
  });

  it('expiring a link in the past returns 410 expired from the resolver', async () => {
    const owner = await registerOwner('owner@example.com');
    const { attestationId, payloadHashesHex } = await seedConfirmedAttestation(
      owner,
      { plan: 'team_pro', leafPayloadHashes: [payload(1)] },
    );
    const link = await doLookupReturnLinkId(
      owner,
      attestationId,
      payloadHashesHex[0]!,
    );
    const past = new Date(Date.now() - 60_000).toISOString();
    const setExp = await app.inject({
      method: 'POST',
      url: `/tenants/${owner.tenant.slug}/verification-links/${link}/expire`,
      headers: { cookie: owner.cookies },
      payload: { expiresAt: past },
    });
    expect(setExp.statusCode).toBe(200);
    const res = await app.inject({ method: 'GET', url: `/v/${link}` });
    expect(res.statusCode).toBe(410);
    expect((res.json() as { error: string }).error).toBe('expired');

    const audit = await app.inject({
      method: 'GET',
      url: `/tenants/${owner.tenant.slug}/audit?limit=10`,
      headers: { cookie: owner.cookies },
    });
    expect(audit.statusCode).toBe(200);
    const expired = (
      audit.json() as {
        events: Array<{
          action: string;
          targetId: string | null;
          payload: Record<string, unknown>;
        }>;
      }
    ).events.find(
      (event) =>
        event.action === 'verification_link.expired' &&
        event.targetId === link,
    );
    expect(expired?.payload).toMatchObject({
      linkId: link,
      targetType: 'lookup_result',
      previousExpiresAt: null,
      expiresAt: past,
    });
    expect(expired?.payload.targetRef).toMatch(/^pkg_/);
  });

  it('a non-admin cannot manage verification links (403)', async () => {
    const owner = await registerOwner('owner@example.com');
    const { attestationId, payloadHashesHex } = await seedConfirmedAttestation(
      owner,
      { plan: 'team_pro', leafPayloadHashes: [payload(1)] },
    );
    const link = await doLookupReturnLinkId(
      owner,
      attestationId,
      payloadHashesHex[0]!,
    );
    const stranger = await registerOwner('stranger@example.com');
    // Stranger is an admin of their OWN tenant — not owner's. tenant scope
    // path uses owner's slug so the resolver context check 404s.
    const res = await app.inject({
      method: 'POST',
      url: `/tenants/${owner.tenant.slug}/verification-links/${link}/revoke`,
      headers: { cookie: stranger.cookies },
    });
    expect(res.statusCode).toBe(404);
  });
});
