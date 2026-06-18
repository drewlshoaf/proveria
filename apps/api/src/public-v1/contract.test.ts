import cookie from '@fastify/cookie';
import sensible from '@fastify/sensible';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createClient, type ClientHandle } from '@proveria/db';

import { apiKeyPlugin } from '../api-keys/routes.js';
import { authPlugin } from '../auth/routes.js';
import { config } from '../config.js';
import { LogNotificationProvider } from '../notifications/provider.js';
import { tenantPlugin } from '../tenants/routes.js';
import { publicV1OpenApi } from './openapi.js';
import { publicV1Plugin } from './routes.js';

const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgres://proveria:proveria_dev@localhost:5432/proveria_test';

let dbHandle: ClientHandle;
let app: FastifyInstance;
let notificationLines: string[];
const storedObjects = new Map<string, string>();
const storedBytes = new Map<string, Buffer>();
const validationJobs: Array<{ attestationId: string; attemptId: string }> = [];
const webhookJobs: Array<{ deliveryId: string }> = [];
const pdfJobs: Array<{ linkId: string }> = [];
const evidenceExportJobs: Array<{ jobId: string }> = [];
const deletedObjectKeys: string[] = [];

const truncateAll = async (): Promise<void> => {
  await dbHandle.sql.unsafe(`
    TRUNCATE TABLE
      audit.audit_event_hash_chain,
      audit.audit_checkpoints,
      audit.audit_events,
      public.webhook_deliveries,
      public.webhook_endpoints,
      public.idempotency_keys,
      public.api_keys,
      public.verification_links,
      public.verification_results,
      public.attestation_access_requests,
      public.attestation_access_grants,
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

const extractCookies = (response: { headers: { 'set-cookie'?: string | string[] } }): string => {
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
  user: { id: string; email: string };
  tenant: { id: string; slug: string; name: string };
}

const registerOwner = async (): Promise<Owner> => {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { email: 'contract-owner@example.com', password: 'contract-pw' },
  });
  if (res.statusCode !== 201) throw new Error('register failed');
  const reg = res.json() as { user: { id: string; email: string } };
  const workspace = await app.inject({
    method: 'POST',
    url: '/tenants',
    headers: { cookie: extractCookies(res) },
    payload: { name: 'Contract Workspace' },
  });
  if (workspace.statusCode !== 201) throw new Error('workspace failed');
  const body = workspace.json() as {
    tenant: { id: string; slug: string; name: string };
  };
  return {
    cookies: extractCookies(res),
    user: reg.user,
    tenant: body.tenant,
  };
};

const createApiKey = async (owner: Owner, scopes: string[] = ['read']): Promise<string> => {
  const res = await app.inject({
    method: 'POST',
    url: `/tenants/${owner.tenant.slug}/api-keys`,
    headers: { cookie: owner.cookies },
    payload: { name: 'Contract key', scopes },
  });
  expect(res.statusCode).toBe(201);
  return (res.json() as { token: string }).token;
};

const seedProjectAndAttestation = async (
  owner: Owner,
): Promise<{ attestationId: string; projectId: string; deviceId: string }> => {
  const [project] = await dbHandle.sql<{ id: string }[]>`
    INSERT INTO public.projects
      (tenant_id, slug, name, template_slug, visibility, created_by_user_id)
    VALUES
      (${owner.tenant.id}, 'contract-project', 'Contract Project',
       'general_provenance', 'private', ${owner.user.id})
    RETURNING id`;
  const [device] = await dbHandle.sql<{ id: string }[]>`
    INSERT INTO public.devices
      (tenant_id, user_id, profile_id, name, platform, app_version, public_key)
    VALUES
      (${owner.tenant.id}, ${owner.user.id}, gen_random_uuid(), 'Contract',
       'darwin', 'test', ${`pub-${owner.user.id}`})
    RETURNING id`;
  const [attestation] = await dbHandle.sql<{ id: string }[]>`
    INSERT INTO public.attestations
      (tenant_id, project_id, label, created_by_user_id, created_by_device_id,
       state, merkle_root, package_id, receipt_json_object_key, receipt_pdf_object_key,
       confirmed_at)
    VALUES
      (${owner.tenant.id}, ${project!.id}, 'contract-attestation',
       ${owner.user.id}, ${device!.id}, 'confirmed', ${'a'.repeat(64)},
       'pkg_contract_test', 'tenants/test/receipt.json', 'tenants/test/receipt.pdf', NOW())
    RETURNING id`;
  storedObjects.set(
    'tenants/test/receipt.json',
    JSON.stringify({ package_id: 'pkg_contract_test', attestation_id: attestation!.id }),
  );
  storedBytes.set(
    'tenants/test/receipt.json',
    Buffer.from(
      JSON.stringify({
        package_id: 'pkg_contract_test',
        attestation_id: attestation!.id,
      }),
    ),
  );
  storedBytes.set('tenants/test/receipt.pdf', Buffer.from('%PDF-1.4\ncontract receipt\n'));
  await dbHandle.sql`
    INSERT INTO audit.audit_events
      (tenant_id, actor_user_id, category, action, target_type, target_id, payload)
    VALUES
      (${owner.tenant.id}, ${owner.user.id}, 'api_sdk_webhook',
       'contract.seeded', 'attestation', ${attestation!.id}, '{}'::jsonb)`;
  return { attestationId: attestation!.id, projectId: project!.id, deviceId: device!.id };
};

const expectDataEnvelope = (body: unknown): void => {
  expect(body).toEqual(
    expect.objectContaining({
      data: expect.anything(),
      meta: expect.objectContaining({
        requestId: expect.any(String),
        apiKeyId: expect.any(String),
      }),
    }),
  );
};

const expectErrorEnvelope = (body: unknown, code: string): void => {
  expect(body).toEqual({
    error: expect.objectContaining({
      code,
      message: expect.any(String),
      retryable: expect.any(Boolean),
      requestId: expect.any(String),
    }),
  });
};

const expectFieldError = (body: unknown, field: string, code?: string): void => {
  expect(body).toEqual({
    error: expect.objectContaining({
      fieldErrors: expect.arrayContaining([
        expect.objectContaining({
          field,
          ...(code ? { code } : {}),
        }),
      ]),
    }),
  });
};

const expectRateLimitHeaders = (headers: Record<string, unknown>): void => {
  expect(headers['ratelimit-limit']).toEqual(expect.stringMatching(/^\d+$/));
  expect(headers['ratelimit-remaining']).toEqual(expect.stringMatching(/^\d+$/));
  expect(headers['ratelimit-reset']).toEqual(expect.stringMatching(/^\d+$/));
};

const expectPagination = (
  body: unknown,
  expected: { limit: number; offset: number; returned: number; hasMore: boolean },
): void => {
  expect(body).toEqual(
    expect.objectContaining({
      meta: expect.objectContaining({
        pagination: expected,
      }),
    }),
  );
};

beforeAll(async () => {
  dbHandle = createClient({ url: DATABASE_URL, max: 5 });
  app = Fastify({ logger: false });
  await app.register(sensible);
  await app.register(cookie, { secret: config.sessionSecret });
  notificationLines = [];
  const notifications = new LogNotificationProvider((line) => notificationLines.push(line));
  await app.register(authPlugin, { db: dbHandle.db, notifications });
  await app.register(tenantPlugin, { db: dbHandle.db, notifications });
  await app.register(apiKeyPlugin, { db: dbHandle.db });
  await app.register(publicV1Plugin, {
    db: dbHandle.db,
    putJson: async (key, body) => {
      storedObjects.set(key, body.toString());
    },
    putObject: async (key, body) => {
      storedBytes.set(key, Buffer.isBuffer(body) ? body : Buffer.from(body));
      if (!Buffer.isBuffer(body)) storedObjects.set(key, body);
    },
    getJsonText: async (key) => {
      const body = storedObjects.get(key);
      if (!body) throw new Error(`missing object ${key}`);
      return body;
    },
    getObjectBytes: async (key) => storedBytes.get(key) ?? null,
    deleteObject: async (key) => {
      deletedObjectKeys.push(key);
      storedBytes.delete(key);
      storedObjects.delete(key);
    },
    enqueueAttestationValidation: async (job) => {
      validationJobs.push({
        attestationId: job.attestationId,
        attemptId: job.attemptId,
      });
    },
    enqueuePdfRendering: async (job) => {
      pdfJobs.push({ linkId: job.linkId });
    },
    enqueueEvidenceExport: async (job) => {
      evidenceExportJobs.push({ jobId: job.jobId });
    },
    enqueueWebhookDelivery: async (job) => {
      webhookJobs.push({ deliveryId: job.deliveryId });
    },
  });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await dbHandle.close();
});

beforeEach(async () => {
  notificationLines.length = 0;
  storedObjects.clear();
  storedBytes.clear();
  validationJobs.length = 0;
  webhookJobs.length = 0;
  pdfJobs.length = 0;
  evidenceExportJobs.length = 0;
  deletedObjectKeys.length = 0;
  await truncateAll();
});

describe('public V1 OpenAPI contract', () => {
  it('serves the current public V1 OpenAPI document', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/openapi.json' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual(publicV1OpenApi);
  });

  it('serves a public API docs page backed by the OpenAPI document', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/docs' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.body).toContain('Proveria Public API');
    expect(res.body).toContain('/v1/openapi.json');
    expect(res.body).toContain('Filter routes');
    expect(res.body).toContain('Generated curl');
    expect(res.body).toContain('Send request');
  });

  it('serves API docs config for external renderers', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/docs/config.json' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      title: 'Proveria Public API',
      openapiUrl: '/v1/openapi.json',
      docsUrl: '/v1/docs',
      version: publicV1OpenApi.info.version,
    });
  });

  it('documents every currently supported public V1 path', () => {
    expect(Object.keys(publicV1OpenApi.paths).sort()).toEqual(
      [
        '/v1/docs',
        '/v1/docs/config.json',
        '/v1/openapi.json',
        '/v1/tenants/{slug}/api-key',
        '/v1/tenants/{slug}/attestations',
        '/v1/tenants/{slug}/attestations/{id}',
        '/v1/tenants/{slug}/attestations/{id}/lookup',
        '/v1/tenants/{slug}/attestations/{id}/receipt',
        '/v1/tenants/{slug}/attestations/{id}/receipt.json',
        '/v1/tenants/{slug}/attestations/{id}/receipt.pdf',
        '/v1/tenants/{slug}/attestations/{id}/verifier-access',
        '/v1/tenants/{slug}/attestations/{id}/verifier-access/{grantId}',
        '/v1/tenants/{slug}/evidence-export/jobs',
        '/v1/tenants/{slug}/evidence-export/jobs/cleanup-expired',
        '/v1/tenants/{slug}/evidence-export/jobs/{jobId}',
        '/v1/tenants/{slug}/evidence-export/jobs/{jobId}/bundle',
        '/v1/tenants/{slug}/evidence-export/manifest',
        '/v1/tenants/{slug}/events',
        '/v1/tenants/{slug}/projects',
        '/v1/tenants/{slug}/projects/{projectSlug}/attestations',
        '/v1/tenants/{slug}/webhook-deliveries',
        '/v1/tenants/{slug}/webhook-endpoints',
        '/v1/tenants/{slug}/webhook-endpoints/{endpointId}',
        '/v1/tenants/{slug}/webhook-endpoints/{endpointId}/test',
      ].sort(),
    );
  });
});

describe('public V1 response contract', () => {
  it('returns stable error envelopes for missing and invalid API keys', async () => {
    const missing = await app.inject({
      method: 'GET',
      url: '/v1/tenants/anything/projects',
    });
    expect(missing.statusCode).toBe(401);
    expectErrorEnvelope(missing.json(), 'unauthorized');
    expect(missing.headers['ratelimit-limit']).toBeUndefined();

    const invalid = await app.inject({
      method: 'GET',
      url: '/v1/tenants/anything/projects',
      headers: { authorization: 'Bearer prv_v1_invalid' },
    });
    expect(invalid.statusCode).toBe(401);
    expectErrorEnvelope(invalid.json(), 'invalid_api_key');
    expect(invalid.headers['ratelimit-limit']).toBeUndefined();
  });

  it('returns stable data envelopes for the read-only V1 surface', async () => {
    const owner = await registerOwner();
    const token = await createApiKey(owner);
    const seeded = await seedProjectAndAttestation(owner);
    const auth = { authorization: `Bearer ${token}` };
    const urls = [
      `/v1/tenants/${owner.tenant.slug}/projects`,
      `/v1/tenants/${owner.tenant.slug}/attestations`,
      `/v1/tenants/${owner.tenant.slug}/attestations/${seeded.attestationId}`,
      `/v1/tenants/${owner.tenant.slug}/attestations/${seeded.attestationId}/receipt`,
      `/v1/tenants/${owner.tenant.slug}/events`,
    ];

    for (const url of urls) {
      const res = await app.inject({ method: 'GET', url, headers: auth });
      expect(res.statusCode, url).toBe(200);
      expectRateLimitHeaders(res.headers);
      expectDataEnvelope(res.json());
    }
  });

  it('returns display-safe current API key metadata', async () => {
    const owner = await registerOwner();
    const token = await createApiKey(owner, ['read', 'write']);

    const res = await app.inject({
      method: 'GET',
      url: `/v1/tenants/${owner.tenant.slug}/api-key`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: {
        id: string;
        keyPrefix: string;
        scopes: string[];
        workspace: { id: string; slug: string; name: string };
        createdAt: string;
        expiresAt: string | null;
        lastUsedAt: string | null;
        usageCount: number;
        lastUsedMethod: string | null;
        lastUsedPath: string | null;
        lastUsedStatusCode: number | null;
        token?: string;
        keyHash?: string;
      };
      meta: { requestId: string; apiKeyId: string };
    };

    expect(body.data).toMatchObject({
      scopes: ['read', 'write'],
      workspace: {
        id: owner.tenant.id,
        slug: owner.tenant.slug,
        name: owner.tenant.name,
      },
      expiresAt: null,
      usageCount: 0,
      lastUsedAt: null,
      lastUsedMethod: null,
      lastUsedPath: null,
      lastUsedStatusCode: null,
    });
    expect(body.data.createdAt).toEqual(expect.any(String));
    expect(body.data.keyPrefix).toBe(token.slice(0, 16));
    expect(body.data.token).toBeUndefined();
    expect(body.data.keyHash).toBeUndefined();
    expect(body.meta.apiKeyId).toBe(body.data.id);
  });

  it('pages project lists through public V1', async () => {
    const owner = await registerOwner();
    const token = await createApiKey(owner);
    await dbHandle.sql`
      INSERT INTO public.projects
        (tenant_id, slug, name, template_slug, visibility, created_by_user_id, created_at)
      VALUES
        (${owner.tenant.id}, 'project-a', 'Project A', 'general_provenance', 'private',
         ${owner.user.id}, NOW() - INTERVAL '1 minute'),
        (${owner.tenant.id}, 'project-b', 'Project B', 'general_provenance', 'private',
         ${owner.user.id}, NOW())`;

    const firstPage = await app.inject({
      method: 'GET',
      url: `/v1/tenants/${owner.tenant.slug}/projects?limit=1&offset=0`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(firstPage.statusCode).toBe(200);
    const firstBody = firstPage.json() as { data: Array<{ slug: string }> };
    expect(firstBody.data).toHaveLength(1);
    expect(firstBody.data[0]?.slug).toBe('project-b');
    expectPagination(firstBody, { limit: 1, offset: 0, returned: 1, hasMore: true });

    const secondPage = await app.inject({
      method: 'GET',
      url: `/v1/tenants/${owner.tenant.slug}/projects?limit=1&offset=1`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(secondPage.statusCode).toBe(200);
    const secondBody = secondPage.json() as { data: Array<{ slug: string }> };
    expect(secondBody.data).toHaveLength(1);
    expect(secondBody.data[0]?.slug).toBe('project-a');
    expectPagination(secondBody, { limit: 1, offset: 1, returned: 1, hasMore: false });
  });

  it('filters and pages attestation lists through public V1', async () => {
    const owner = await registerOwner();
    const token = await createApiKey(owner);
    const seeded = await seedProjectAndAttestation(owner);
    await dbHandle.sql`
      INSERT INTO public.attestations
        (tenant_id, project_id, label, created_by_user_id, created_by_device_id, state)
      VALUES
        (${owner.tenant.id}, ${seeded.projectId}, 'validating-attestation',
         ${owner.user.id}, ${seeded.deviceId}, 'validating')`;

    const res = await app.inject({
      method: 'GET',
      url: `/v1/tenants/${owner.tenant.slug}/attestations?project=contract-project&status=confirmed&limit=1&offset=0`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: Array<{ id: string; state: string; project?: { slug: string } }>;
      meta: { limit: number; offset: number };
    };
    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.id).toBe(seeded.attestationId);
    expect(body.data[0]?.state).toBe('confirmed');
    expect(body.data[0]?.project?.slug).toBe('contract-project');
    expect(body.meta.limit).toBe(1);
    expect(body.meta.offset).toBe(0);
    expectPagination(body, { limit: 1, offset: 0, returned: 1, hasMore: false });
  });

  it('filters and pages event lists through public V1', async () => {
    const owner = await registerOwner();
    const token = await createApiKey(owner);
    const seeded = await seedProjectAndAttestation(owner);

    const res = await app.inject({
      method: 'GET',
      url: `/v1/tenants/${owner.tenant.slug}/events?category=api_sdk_webhook&action=contract.seeded&targetType=attestation&targetId=${seeded.attestationId}&limit=1&offset=0`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      data: Array<{
        category: string;
        action: string;
        targetType: string | null;
        targetId: string | null;
      }>;
      meta: { limit: number; offset: number };
    };
    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.category).toBe('api_sdk_webhook');
    expect(body.data[0]?.action).toBe('contract.seeded');
    expect(body.data[0]?.targetType).toBe('attestation');
    expect(body.data[0]?.targetId).toBe(seeded.attestationId);
    expect(body.meta.limit).toBe(1);
    expect(body.meta.offset).toBe(0);
    expectPagination(body, { limit: 1, offset: 0, returned: 1, hasMore: false });
  });

  it('downloads receipt JSON and PDF artifacts through public V1', async () => {
    const owner = await registerOwner();
    const token = await createApiKey(owner);
    const seeded = await seedProjectAndAttestation(owner);
    const auth = { authorization: `Bearer ${token}` };

    const receiptJson = await app.inject({
      method: 'GET',
      url: `/v1/tenants/${owner.tenant.slug}/attestations/${seeded.attestationId}/receipt.json`,
      headers: auth,
    });
    expect(receiptJson.statusCode).toBe(200);
    expect(receiptJson.headers['content-type']).toContain('application/json');
    expect(receiptJson.headers['content-disposition']).toContain('.receipt.json');
    expect((receiptJson.json() as { package_id: string }).package_id).toBe('pkg_contract_test');

    const receiptPdf = await app.inject({
      method: 'GET',
      url: `/v1/tenants/${owner.tenant.slug}/attestations/${seeded.attestationId}/receipt.pdf`,
      headers: auth,
    });
    expect(receiptPdf.statusCode).toBe(200);
    expect(receiptPdf.headers['content-type']).toContain('application/pdf');
    expect(receiptPdf.headers['content-disposition']).toContain('.receipt.pdf');
    expect(receiptPdf.body).toContain('%PDF-1.4');
  });

  it('requires write scope and idempotency for project creation', async () => {
    const owner = await registerOwner();
    const readToken = await createApiKey(owner);
    const writeToken = await createApiKey(owner, ['read', 'write']);
    const url = `/v1/tenants/${owner.tenant.slug}/projects`;
    const payload = {
      slug: 'contract-created',
      name: 'Contract Created',
    };

    const readOnly = await app.inject({
      method: 'POST',
      url,
      headers: {
        authorization: `Bearer ${readToken}`,
        'idempotency-key': 'project-create-1',
      },
      payload,
    });
    expect(readOnly.statusCode).toBe(403);
    expectRateLimitHeaders(readOnly.headers);
    expectErrorEnvelope(readOnly.json(), 'insufficient_scope');

    const missingKey = await app.inject({
      method: 'POST',
      url,
      headers: { authorization: `Bearer ${writeToken}` },
      payload,
    });
    expect(missingKey.statusCode).toBe(400);
    expectErrorEnvelope(missingKey.json(), 'idempotency_key_required');
    expectFieldError(missingKey.json(), 'Idempotency-Key', 'required');

    const longKey = await app.inject({
      method: 'POST',
      url,
      headers: {
        authorization: `Bearer ${writeToken}`,
        'idempotency-key': 'x'.repeat(201),
      },
      payload,
    });
    expect(longKey.statusCode).toBe(400);
    expectErrorEnvelope(longKey.json(), 'invalid_idempotency_key');
    expectFieldError(longKey.json(), 'Idempotency-Key', 'maxLength');
    expect(longKey.json()).toEqual({
      error: expect.objectContaining({
        details: expect.objectContaining({ maxLength: 200 }),
      }),
    });

    const missingRequiredField = await app.inject({
      method: 'POST',
      url,
      headers: {
        authorization: `Bearer ${writeToken}`,
        'idempotency-key': 'project-create-missing-name',
      },
      payload: { slug: 'missing-name' },
    });
    expect(missingRequiredField.statusCode).toBe(400);
    expectErrorEnvelope(missingRequiredField.json(), 'invalid_request');
    expectFieldError(missingRequiredField.json(), 'name', 'required');

    const created = await app.inject({
      method: 'POST',
      url,
      headers: {
        authorization: `Bearer ${writeToken}`,
        'idempotency-key': 'project-create-1',
      },
      payload,
    });
    expect(created.statusCode).toBe(201);
    expectRateLimitHeaders(created.headers);
    expectDataEnvelope(created.json());
    const createdBody = created.json() as {
      data: {
        id: string;
        slug: string;
        workspace: { id: string; slug: string; name: string };
      };
    };
    expect(createdBody.data.slug).toBe('contract-created');
    expect(createdBody.data.workspace).toEqual({
      id: owner.tenant.id,
      slug: owner.tenant.slug,
      name: owner.tenant.name,
    });

    const replay = await app.inject({
      method: 'POST',
      url,
      headers: {
        authorization: `Bearer ${writeToken}`,
        'idempotency-key': 'project-create-1',
      },
      payload,
    });
    expect(replay.statusCode).toBe(201);
    expect((replay.json() as { data: { id: string } }).data.id).toBe(createdBody.data.id);

    const conflict = await app.inject({
      method: 'POST',
      url,
      headers: {
        authorization: `Bearer ${writeToken}`,
        'idempotency-key': 'project-create-1',
      },
      payload: { ...payload, name: 'Different Name' },
    });
    expect(conflict.statusCode).toBe(409);
    expectErrorEnvelope(conflict.json(), 'idempotency_key_conflict');
    expect(conflict.json()).toEqual({
      error: expect.objectContaining({
        details: expect.objectContaining({
          idempotencyKey: 'project-create-1',
          method: 'POST',
          path: `/v1/tenants/${owner.tenant.slug}/projects`,
        }),
      }),
    });
  });

  it('accepts an idempotent whole-file SHA-256 attestation with compliance JSON through the public API', async () => {
    const owner = await registerOwner();
    const writeToken = await createApiKey(owner, ['read', 'write']);
    const projectRes = await app.inject({
      method: 'POST',
      url: `/v1/tenants/${owner.tenant.slug}/projects`,
      headers: {
        authorization: `Bearer ${writeToken}`,
        'idempotency-key': 'hash-attestation-project',
      },
      payload: {
        slug: 'hash-project',
        name: 'Hash Project',
      },
    });
    expect(projectRes.statusCode).toBe(201);

    const url = `/v1/tenants/${owner.tenant.slug}/projects/hash-project/attestations`;
    const payload = {
      label: 'api-hash-1',
      sha256: 'b'.repeat(64),
      fileName: 'external.pdf',
      byteSize: 1234,
      compliance: {
        sha256: 'c'.repeat(64),
        fileName: 'controls.json',
        byteSize: 42,
        mediaType: 'application/json',
        canonicalization: 'json-stable-v1',
      },
    };
    const invalidHash = await app.inject({
      method: 'POST',
      url,
      headers: {
        authorization: `Bearer ${writeToken}`,
        'idempotency-key': 'hash-attestation-invalid-sha',
      },
      payload: {
        ...payload,
        sha256: 'g'.repeat(64),
      },
    });
    expect(invalidHash.statusCode).toBe(400);
    expectErrorEnvelope(invalidHash.json(), 'invalid_sha256');
    expectFieldError(invalidHash.json(), 'sha256', 'pattern');

    const created = await app.inject({
      method: 'POST',
      url,
      headers: {
        authorization: `Bearer ${writeToken}`,
        'idempotency-key': 'hash-attestation-1',
      },
      payload,
    });
    expect(created.statusCode).toBe(202);
    expectDataEnvelope(created.json());
    const body = created.json() as {
      data: {
        id: string;
        label: string;
        state: string;
        workspace: { id: string; slug: string; name: string };
      };
    };
    expect(body.data.label).toBe('api-hash-1');
    expect(body.data.state).toBe('validating');
    expect(body.data.workspace.slug).toBe(owner.tenant.slug);
    expect(storedObjects.size).toBe(1);
    expect(validationJobs).toHaveLength(1);
    expect(validationJobs[0]!.attestationId).toBe(body.data.id);

    const manifest = JSON.parse([...storedObjects.values()][0]!) as {
      created_by_device_id: string;
      leaf_counts: { file: number; shingle: number; component: number };
      source_summary: { file_count: number; compliance_document_count?: number };
      policy_context: { compliance_json_attached?: boolean };
      leaf_set: Array<{
        canonical_payload_hash: string;
        metadata: Record<string, unknown>;
      }>;
      signatures: Array<{ signer_kind: string; key_id: string }>;
    };
    expect(manifest.created_by_device_id).toBe('proveria-public-api');
    expect(manifest.leaf_counts).toEqual({ file: 2, shingle: 0, component: 0 });
    expect(manifest.source_summary).toMatchObject({
      file_count: 2,
      compliance_document_count: 1,
    });
    expect(manifest.policy_context.compliance_json_attached).toBe(true);
    expect(
      manifest.leaf_set.find((leaf) => leaf.metadata.source === 'compliance_json'),
    ).toMatchObject({
      canonical_payload_hash: 'c'.repeat(64),
      metadata: {
        source: 'compliance_json',
        file_name: 'controls.json',
        byte_size: 42,
        media_type: 'application/json',
        canonicalization: 'json-stable-v1',
      },
    });
    expect(manifest.signatures).toEqual([]);

    const replay = await app.inject({
      method: 'POST',
      url,
      headers: {
        authorization: `Bearer ${writeToken}`,
        'idempotency-key': 'hash-attestation-1',
      },
      payload,
    });
    expect(replay.statusCode).toBe(202);
    expect((replay.json() as { data: { id: string } }).data.id).toBe(body.data.id);
    expect(storedObjects.size).toBe(1);
    expect(validationJobs).toHaveLength(1);
  });

  it('accepts a model release record hash through the public API', async () => {
    const owner = await registerOwner();
    const writeToken = await createApiKey(owner, ['read', 'write']);
    const projectRes = await app.inject({
      method: 'POST',
      url: `/v1/tenants/${owner.tenant.slug}/projects`,
      headers: {
        authorization: `Bearer ${writeToken}`,
        'idempotency-key': 'model-release-project',
      },
      payload: {
        slug: 'model-release-project',
        name: 'Model Release Project',
      },
    });
    expect(projectRes.statusCode).toBe(201);

    const hash = 'a'.repeat(64);
    const payload = {
      label: 'graduation-model-release',
      sha256: hash,
      fileName: 'model-release.json',
      byteSize: 2048,
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
    };

    const mismatch = await app.inject({
      method: 'POST',
      url: `/v1/tenants/${owner.tenant.slug}/projects/model-release-project/attestations`,
      headers: {
        authorization: `Bearer ${writeToken}`,
        'idempotency-key': 'model-release-mismatch',
      },
      payload: {
        ...payload,
        sourceMetadata: {
          ...payload.sourceMetadata,
          canonicalHash: 'b'.repeat(64),
        },
      },
    });
    expect(mismatch.statusCode).toBe(400);
    expectErrorEnvelope(mismatch.json(), 'source_metadata_hash_mismatch');

    const created = await app.inject({
      method: 'POST',
      url: `/v1/tenants/${owner.tenant.slug}/projects/model-release-project/attestations`,
      headers: {
        authorization: `Bearer ${writeToken}`,
        'idempotency-key': 'model-release-1',
      },
      payload,
    });
    expect(created.statusCode).toBe(202);
    const body = created.json() as { data: { id: string; state: string } };
    expect(body.data.state).toBe('validating');
    expect(validationJobs[0]!.attestationId).toBe(body.data.id);

    const attempts = await dbHandle.sql<
      { source_metadata: Record<string, unknown> }[]
    >`
      SELECT sa.source_metadata
      FROM public.submission_attempts sa
      INNER JOIN public.attestations a ON a.id = sa.attestation_id
      WHERE a.id = ${body.data.id}`;
    expect(attempts[0]!.source_metadata).toEqual(
      expect.objectContaining({
        provider: 'model_release',
        recordType: 'model_provenance_record',
        canonicalHash: hash,
        modelName: 'Graduation Model',
        modelVersion: '2026.06.17',
        claimType: 'model_release_approved',
        policyId: 'AI-GOV-001',
        createdByUserId: owner.user.id,
      }),
    );

    const manifest = JSON.parse([...storedObjects.values()][0]!) as {
      source_summary: { model_release_record_count?: number };
      policy_context: { source_provider?: string };
      leaf_set: Array<{
        canonical_payload_hash: string;
        metadata: Record<string, unknown>;
      }>;
    };
    expect(manifest.source_summary.model_release_record_count).toBe(1);
    expect(manifest.policy_context.source_provider).toBe('model_release');
    expect(manifest.leaf_set[0]).toMatchObject({
      canonical_payload_hash: hash,
      metadata: {
        source: 'model_release',
        file_name: 'model-release.json',
        model_release: expect.objectContaining({
          record_type: 'model_provenance_record',
          canonical_hash: hash,
          model_name: 'Graduation Model',
          claim_type: 'model_release_approved',
        }),
      },
    });
  });

  it('verifies a hash through the public API and issues a result link', async () => {
    const owner = await registerOwner();
    const writeToken = await createApiKey(owner, ['read', 'write']);
    const projectRes = await app.inject({
      method: 'POST',
      url: `/v1/tenants/${owner.tenant.slug}/projects`,
      headers: {
        authorization: `Bearer ${writeToken}`,
        'idempotency-key': 'lookup-project',
      },
      payload: {
        slug: 'lookup-project',
        name: 'Lookup Project',
      },
    });
    expect(projectRes.statusCode).toBe(201);

    const submittedHash = 'c'.repeat(64);
    const created = await app.inject({
      method: 'POST',
      url: `/v1/tenants/${owner.tenant.slug}/projects/lookup-project/attestations`,
      headers: {
        authorization: `Bearer ${writeToken}`,
        'idempotency-key': 'lookup-attestation',
      },
      payload: {
        label: 'lookup-attestation',
        sha256: submittedHash,
      },
    });
    expect(created.statusCode).toBe(202);
    const attestationId = (created.json() as { data: { id: string } }).data.id;
    const manifestObjectKey = [...storedObjects.keys()].find((key) => key.includes(attestationId));
    expect(manifestObjectKey).toEqual(expect.any(String));
    const manifest = JSON.parse(storedObjects.get(manifestObjectKey!)!) as {
      merkle_root: string;
    };
    await dbHandle.sql`
      UPDATE public.attestations
      SET
        state = 'confirmed',
        confirmed_attempt_id = ${validationJobs[0]!.attemptId},
        manifest_object_key = ${manifestObjectKey!},
        merkle_root = ${manifest.merkle_root},
        confirmed_at = NOW()
      WHERE id = ${attestationId}`;

    const lookup = await app.inject({
      method: 'POST',
      url: `/v1/tenants/${owner.tenant.slug}/attestations/${attestationId}/lookup`,
      headers: { authorization: `Bearer ${writeToken}` },
      payload: {
        submittedHash,
        lookupKind: 'whole_file',
      },
    });
    expect(lookup.statusCode).toBe(201);
    expectDataEnvelope(lookup.json());
    const body = lookup.json() as {
      data: {
        packageId: string;
        linkId: string;
        verificationUrl: string;
        package: { result_type: string; submitted_hash: string };
      };
    };
    expect(body.data.package.result_type).toBe('match');
    expect(body.data.package.submitted_hash).toBe(submittedHash);
    expect(body.data.packageId).toMatch(/^pkg_/);
    expect(body.data.linkId).toMatch(/^vrf_/);
    expect(body.data.verificationUrl).toBe(`/v/${body.data.linkId}`);
    expect(pdfJobs).toEqual([{ linkId: body.data.linkId }]);
  });

  it('grants and revokes verifier access through the public API', async () => {
    const owner = await registerOwner();
    const writeToken = await createApiKey(owner, ['read', 'write']);
    const seeded = await seedProjectAndAttestation(owner);
    const url = `/v1/tenants/${owner.tenant.slug}/attestations/${seeded.attestationId}/verifier-access`;
    const payload = {
      email: 'new-verifier@example.com',
      message: 'Please verify this package.',
    };

    const granted = await app.inject({
      method: 'POST',
      url,
      headers: {
        authorization: `Bearer ${writeToken}`,
        'idempotency-key': 'grant-verifier-1',
      },
      payload,
    });
    expect(granted.statusCode).toBe(201);
    expectDataEnvelope(granted.json());
    const grantedBody = granted.json() as {
      data: {
        id: string;
        grantedToEmail: string;
        status: string;
        claimToken?: string;
      };
    };
    expect(grantedBody.data.grantedToEmail).toBe('new-verifier@example.com');
    expect(grantedBody.data.status).toBe('pending');
    expect(grantedBody.data.claimToken).toEqual(expect.any(String));

    const replay = await app.inject({
      method: 'POST',
      url,
      headers: {
        authorization: `Bearer ${writeToken}`,
        'idempotency-key': 'grant-verifier-1',
      },
      payload,
    });
    expect(replay.statusCode).toBe(201);
    expect((replay.json() as { data: { id: string } }).data.id).toBe(grantedBody.data.id);

    const revoked = await app.inject({
      method: 'DELETE',
      url: `${url}/${grantedBody.data.id}`,
      headers: { authorization: `Bearer ${writeToken}` },
    });
    expect(revoked.statusCode).toBe(204);

    const revokedAgain = await app.inject({
      method: 'DELETE',
      url: `${url}/${grantedBody.data.id}`,
      headers: { authorization: `Bearer ${writeToken}` },
    });
    expect(revokedAgain.statusCode).toBe(409);
    expectErrorEnvelope(revokedAgain.json(), 'already_revoked');
  });

  it('creates, lists, disables, and lists deliveries for webhook endpoints', async () => {
    const owner = await registerOwner();
    const writeToken = await createApiKey(owner, ['read', 'write']);
    const auth = { authorization: `Bearer ${writeToken}` };
    const url = `/v1/tenants/${owner.tenant.slug}/webhook-endpoints`;

    const created = await app.inject({
      method: 'POST',
      url,
      headers: { ...auth, 'idempotency-key': 'webhook-create-1' },
      payload: {
        url: 'https://example.com/proveria/webhooks',
        description: 'Contract receiver',
        events: ['receipt.issued'],
      },
    });
    expect(created.statusCode).toBe(201);
    expectDataEnvelope(created.json());
    const createdBody = created.json() as {
      data: { id: string; signingSecret?: string; events: string[] };
    };
    expect(createdBody.data.signingSecret).toMatch(/^whsec_/);
    expect(createdBody.data.events).toEqual(['receipt.issued']);

    const replay = await app.inject({
      method: 'POST',
      url,
      headers: { ...auth, 'idempotency-key': 'webhook-create-1' },
      payload: {
        url: 'https://example.com/proveria/webhooks',
        description: 'Contract receiver',
        events: ['receipt.issued'],
      },
    });
    expect(replay.statusCode).toBe(201);
    expect((replay.json() as { data: { id: string } }).data.id).toBe(createdBody.data.id);

    const conflict = await app.inject({
      method: 'POST',
      url,
      headers: { ...auth, 'idempotency-key': 'webhook-create-1' },
      payload: {
        url: 'https://example.com/proveria/other',
        description: 'Contract receiver',
        events: ['receipt.issued'],
      },
    });
    expect(conflict.statusCode).toBe(409);
    expectErrorEnvelope(conflict.json(), 'idempotency_key_conflict');

    const list = await app.inject({ method: 'GET', url: `${url}?limit=1&offset=0`, headers: auth });
    expect(list.statusCode).toBe(200);
    const listBody = list.json() as { data: Array<{ id: string; signingSecret?: string }> };
    expect(listBody.data[0]?.id).toBe(createdBody.data.id);
    expect(listBody.data[0]?.signingSecret).toBeUndefined();
    expectPagination(listBody, { limit: 1, offset: 0, returned: 1, hasMore: false });

    await dbHandle.sql`
      INSERT INTO public.webhook_deliveries
        (tenant_id, endpoint_id, event_type, payload, signature)
      VALUES
        (${owner.tenant.id}, ${createdBody.data.id}, 'receipt.issued',
         ${JSON.stringify({ ok: true })}::jsonb, 't=test,v1=abc')`;
    const deliveries = await app.inject({
      method: 'GET',
      url: `/v1/tenants/${owner.tenant.slug}/webhook-deliveries?limit=1&offset=0`,
      headers: auth,
    });
    expect(deliveries.statusCode).toBe(200);
    const deliveriesBody = deliveries.json() as { data: unknown[] };
    expect(deliveriesBody.data).toHaveLength(1);
    expectPagination(deliveriesBody, { limit: 1, offset: 0, returned: 1, hasMore: false });

    const test = await app.inject({
      method: 'POST',
      url: `${url}/${createdBody.data.id}/test`,
      headers: { ...auth, 'idempotency-key': 'webhook-test-1' },
    });
    expect(test.statusCode).toBe(202);
    const testBody = test.json() as { data: { id: string; eventType: string } };
    expect(testBody.data.eventType).toBe('webhook.test');
    expect(webhookJobs).toEqual([{ deliveryId: testBody.data.id }]);

    const testReplay = await app.inject({
      method: 'POST',
      url: `${url}/${createdBody.data.id}/test`,
      headers: { ...auth, 'idempotency-key': 'webhook-test-1' },
    });
    expect(testReplay.statusCode).toBe(202);
    expect((testReplay.json() as { data: { id: string } }).data.id).toBe(testBody.data.id);
    expect(webhookJobs).toEqual([{ deliveryId: testBody.data.id }]);

    const disabled = await app.inject({
      method: 'DELETE',
      url: `${url}/${createdBody.data.id}`,
      headers: auth,
    });
    expect(disabled.statusCode).toBe(204);
  });

  it('creates evidence export jobs idempotently through public V1', async () => {
    const owner = await registerOwner();
    const writeToken = await createApiKey(owner, ['read', 'write']);
    await seedProjectAndAttestation(owner);
    const auth = { authorization: `Bearer ${writeToken}` };
    const url = `/v1/tenants/${owner.tenant.slug}/evidence-export/jobs`;
    const payload = { includeEvents: true, limit: 25 };

    const missingKey = await app.inject({
      method: 'POST',
      url,
      headers: auth,
      payload,
    });
    expect(missingKey.statusCode).toBe(400);
    expectErrorEnvelope(missingKey.json(), 'idempotency_key_required');

    const created = await app.inject({
      method: 'POST',
      url,
      headers: { ...auth, 'idempotency-key': 'export-job-1' },
      payload,
    });
    expect(created.statusCode).toBe(201);
    expectDataEnvelope(created.json());
    const createdBody = created.json() as {
      data: {
        job: { id: string; status: string; resultObjectKey: string | null };
        manifest: { export: { counts: unknown } };
      };
    };
    expect(createdBody.data.job.status).toBe('queued');
    expect(createdBody.data.job.resultObjectKey).toBeNull();
    expect(evidenceExportJobs).toEqual([{ jobId: createdBody.data.job.id }]);
    expect(createdBody.data.manifest.export.counts).toEqual(expect.any(Object));

    const list = await app.inject({
      method: 'GET',
      url: `${url}?limit=1&offset=0`,
      headers: auth,
    });
    expect(list.statusCode).toBe(200);
    const listBody = list.json() as { data: Array<{ id: string }> };
    expect(listBody.data).toHaveLength(1);
    expect(listBody.data[0]?.id).toBe(createdBody.data.job.id);
    expectPagination(listBody, { limit: 1, offset: 0, returned: 1, hasMore: false });

    const fetched = await app.inject({
      method: 'GET',
      url: `${url}/${createdBody.data.job.id}`,
      headers: auth,
    });
    expect(fetched.statusCode).toBe(200);
    const fetchedBody = fetched.json() as {
      data: { job: { id: string; status: string }; manifest: { export: { counts: unknown } } };
    };
    expect(fetchedBody.data.job.id).toBe(createdBody.data.job.id);
    expect(fetchedBody.data.job.status).toBe('queued');
    expect(fetchedBody.data.manifest.export.counts).toEqual(expect.any(Object));

    const bundle = await app.inject({
      method: 'GET',
      url: `${url}/${createdBody.data.job.id}/bundle`,
      headers: auth,
    });
    expect(bundle.statusCode).toBe(404);
    expectErrorEnvelope(bundle.json(), 'bundle_not_available');

    const missing = await app.inject({
      method: 'GET',
      url: `${url}/00000000-0000-4000-8000-000000000000`,
      headers: auth,
    });
    expect(missing.statusCode).toBe(404);
    expectErrorEnvelope(missing.json(), 'not_found');

    const replay = await app.inject({
      method: 'POST',
      url,
      headers: { ...auth, 'idempotency-key': 'export-job-1' },
      payload,
    });
    expect(replay.statusCode).toBe(201);
    expect((replay.json() as { data: { job: { id: string } } }).data.job.id).toBe(
      createdBody.data.job.id,
    );

    const conflict = await app.inject({
      method: 'POST',
      url,
      headers: { ...auth, 'idempotency-key': 'export-job-1' },
      payload: { includeEvents: false, limit: 25 },
    });
    expect(conflict.statusCode).toBe(409);
    expectErrorEnvelope(conflict.json(), 'idempotency_key_conflict');
  });

  it('cleans up expired evidence export bundles through public V1', async () => {
    const owner = await registerOwner();
    const writeToken = await createApiKey(owner, ['read', 'write']);
    storedBytes.set('tenants/public-export/delete-me.json', Buffer.from('{}'));
    storedBytes.set('tenants/public-export/keep-me.json', Buffer.from('{}'));
    storedObjects.set('tenants/public-export/delete-me.json', '{}');
    storedObjects.set('tenants/public-export/keep-me.json', '{}');
    const [expired] = await dbHandle.sql<{ id: string }[]>`
      INSERT INTO public.export_jobs
        (
          tenant_id,
          created_by_user_id,
          kind,
          status,
          filters,
          manifest,
          artifact_count,
          row_count,
          result_object_key,
          expires_at,
          retention_policy,
          completed_at
        )
      VALUES (
        ${owner.tenant.id},
        ${owner.user.id},
        'evidence_bundle',
        'completed',
        '{}'::jsonb,
        '{"export":{"counts":{"attestations":0}}}'::jsonb,
        1,
        1,
        'tenants/public-export/delete-me.json',
        now() - interval '1 day',
        '{"retention_days":30,"delete_after_expiration":true}'::jsonb,
        now() - interval '2 days'
      )
      RETURNING id`;
    await dbHandle.sql`
      INSERT INTO public.export_jobs
        (
          tenant_id,
          created_by_user_id,
          kind,
          status,
          filters,
          manifest,
          artifact_count,
          row_count,
          result_object_key,
          expires_at,
          retention_policy,
          completed_at
        )
      VALUES (
        ${owner.tenant.id},
        ${owner.user.id},
        'evidence_bundle',
        'completed',
        '{}'::jsonb,
        '{"export":{"counts":{"attestations":0}}}'::jsonb,
        1,
        1,
        'tenants/public-export/keep-me.json',
        now() - interval '1 day',
        '{"retention_days":30,"delete_after_expiration":false}'::jsonb,
        now() - interval '2 days'
      )`;

    const res = await app.inject({
      method: 'POST',
      url: `/v1/tenants/${owner.tenant.slug}/evidence-export/jobs/cleanup-expired`,
      headers: { authorization: `Bearer ${writeToken}` },
    });
    expect(res.statusCode).toBe(200);
    expectDataEnvelope(res.json());
    expect((res.json() as { data: unknown }).data).toEqual({
      scanned: 2,
      deleted: 1,
      skipped: 1,
      deletedObjectKeys: ['tenants/public-export/delete-me.json'],
    });
    expect(deletedObjectKeys).toEqual(['tenants/public-export/delete-me.json']);
    expect(storedBytes.has('tenants/public-export/delete-me.json')).toBe(false);
    expect(storedObjects.has('tenants/public-export/delete-me.json')).toBe(false);
    expect(storedBytes.has('tenants/public-export/keep-me.json')).toBe(true);

    const [job] = await dbHandle.sql<
      Array<{ status: string; result_object_key: string | null }>
    >`
      SELECT status, result_object_key
      FROM public.export_jobs
      WHERE id = ${expired!.id}`;
    expect(job).toEqual({
      status: 'expired',
      result_object_key: null,
    });

    const auditRows = await dbHandle.sql<Array<{ target_id: string }>>`
      SELECT target_id
      FROM audit.audit_events
      WHERE tenant_id = ${owner.tenant.id}
        AND action = 'evidence_export.expired'
        AND category = 'retention_deletion'`;
    expect(auditRows).toEqual([{ target_id: expired!.id }]);

    const replay = await app.inject({
      method: 'POST',
      url: `/v1/tenants/${owner.tenant.slug}/evidence-export/jobs/cleanup-expired`,
      headers: { authorization: `Bearer ${writeToken}` },
    });
    expect(replay.statusCode).toBe(200);
    expect((replay.json() as { data: { scanned: number; deleted: number; skipped: number } }).data)
      .toMatchObject({ scanned: 1, deleted: 0, skipped: 1 });
    expect(deletedObjectKeys).toEqual(['tenants/public-export/delete-me.json']);
  });

  it('returns stable not_found envelopes for cross-tenant access', async () => {
    const owner = await registerOwner();
    const token = await createApiKey(owner);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/tenants/not-your-tenant/projects',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(404);
    expectErrorEnvelope(res.json(), 'not_found');
  });
});
