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
import { createClient, type ClientHandle } from '@proveria/db';

import { authPlugin } from '../auth/routes.js';
import { config } from '../config.js';
import { LogNotificationProvider } from '../notifications/provider.js';
import { publicV1Plugin } from '../public-v1/routes.js';
import { tenantPlugin } from '../tenants/routes.js';
import { apiKeyPlugin } from './routes.js';

const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgres://proveria:proveria_dev@localhost:5432/proveria_test';

let dbHandle: ClientHandle;
let app: FastifyInstance;
let notificationLines: string[];

const truncateAll = async (): Promise<void> => {
  await dbHandle.sql.unsafe(`
    TRUNCATE TABLE
      audit.audit_event_hash_chain,
      audit.audit_checkpoints,
      audit.audit_events,
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
      public.organization_memberships,
      public.tenant_memberships,
      public.tenants,
      public.organizations,
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
  user: { id: string; email: string };
  tenant: { id: string; slug: string; name: string };
}

const registerOwner = async (email: string): Promise<Owner> => {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { email, password: 'api-key-test-pw' },
  });
  if (res.statusCode !== 201) throw new Error('register failed');
  const reg = res.json() as { user: { id: string; email: string } };
  const workspace = await app.inject({
    method: 'POST',
    url: '/tenants',
    headers: { cookie: extractCookies(res) },
    payload: { name: email },
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

const createApiKey = async (
  owner: Owner,
  scopes: string[] = ['read'],
  options: { expiresAt?: string } = {},
): Promise<{
  id: string;
  token: string;
  apiKey: {
    id: string;
    keyPrefix: string;
    scopes: string[];
    expiresAt: string | null;
    usageCount: number;
    lastUsedAt: string | null;
    lastUsedMethod: string | null;
    lastUsedPath: string | null;
    lastUsedStatusCode: number | null;
    workspace: { id: string; slug: string; name: string };
  };
}> => {
  const res = await app.inject({
    method: 'POST',
    url: `/tenants/${owner.tenant.slug}/api-keys`,
    headers: { cookie: owner.cookies },
    payload: { name: 'CI read key', scopes, ...options },
  });
  expect(res.statusCode).toBe(201);
  const body = res.json() as {
    apiKey: {
      id: string;
      keyPrefix: string;
      scopes: string[];
      expiresAt: string | null;
      usageCount: number;
      lastUsedAt: string | null;
      lastUsedMethod: string | null;
      lastUsedPath: string | null;
      lastUsedStatusCode: number | null;
      workspace: { id: string; slug: string; name: string };
    };
    token: string;
  };
  expect(body.apiKey.scopes).toEqual(scopes);
  expect(body.apiKey.usageCount).toBe(0);
  expect(body.apiKey.lastUsedAt).toBeNull();
  expect(body.apiKey.lastUsedMethod).toBeNull();
  expect(body.apiKey.lastUsedPath).toBeNull();
  expect(body.apiKey.lastUsedStatusCode).toBeNull();
  expect(body.token.startsWith('prv_v1_')).toBe(true);
  expect(body.token.startsWith(body.apiKey.keyPrefix)).toBe(true);
  return { id: body.apiKey.id, token: body.token, apiKey: body.apiKey };
};

interface ApiKeyUsageRow {
  last_used_at: string | null;
  usage_count: number;
  last_used_method: string | null;
  last_used_path: string | null;
  last_used_status_code: number | null;
}

const waitForApiKeyUsage = async (
  id: string,
): Promise<ApiKeyUsageRow | null> => {
  for (let i = 0; i < 10; i++) {
    const rows = await dbHandle.sql<ApiKeyUsageRow[]>`
      SELECT
        last_used_at,
        usage_count,
        last_used_method,
        last_used_path,
        last_used_status_code
      FROM public.api_keys
      WHERE id = ${id}`;
    if (rows[0]?.last_used_at) return rows[0];
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return null;
};

const seedProjectAndAttestation = async (
  owner: Owner,
): Promise<{ projectId: string; attestationId: string }> => {
  const [project] = await dbHandle.sql<{ id: string }[]>`
    INSERT INTO public.projects
      (tenant_id, slug, name, template_slug, visibility, created_by_user_id)
    VALUES
      (${owner.tenant.id}, 'api-project', 'API Project',
       'general_provenance', 'private', ${owner.user.id})
    RETURNING id`;
  const [device] = await dbHandle.sql<{ id: string }[]>`
    INSERT INTO public.devices
      (tenant_id, user_id, profile_id, name, platform, app_version, public_key)
    VALUES
      (${owner.tenant.id}, ${owner.user.id}, gen_random_uuid(), 'API Test',
       'darwin', 'test', ${`pub-${owner.user.id}`})
    RETURNING id`;
  const [attestation] = await dbHandle.sql<{ id: string }[]>`
    INSERT INTO public.attestations
      (tenant_id, project_id, label, created_by_user_id, created_by_device_id,
       state, merkle_root, package_id, receipt_json_object_key, confirmed_at)
    VALUES
      (${owner.tenant.id}, ${project!.id}, 'api-attestation', ${owner.user.id},
       ${device!.id}, 'confirmed', ${'a'.repeat(64)}, 'pkg_api_test',
       'tenants/test/receipt.json', NOW())
    RETURNING id`;
  await dbHandle.sql`
    INSERT INTO audit.audit_events
      (tenant_id, actor_user_id, category, action, target_type, target_id, payload)
    VALUES
      (${owner.tenant.id}, ${owner.user.id}, 'api_sdk_webhook',
       'api_key.created', 'api_key', 'seed', '{}'::jsonb)`;
  return { projectId: project!.id, attestationId: attestation!.id };
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
  await app.register(apiKeyPlugin, { db: dbHandle.db });
  await app.register(publicV1Plugin, { db: dbHandle.db });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await dbHandle.close();
});

beforeEach(async () => {
  notificationLines.length = 0;
  await truncateAll();
});

describe('workspace API keys', () => {
  it('tenant admin creates, lists, and revokes an API key', async () => {
    const owner = await registerOwner('owner@example.com');
    const key = await createApiKey(owner);

    const list = await app.inject({
      method: 'GET',
      url: `/tenants/${owner.tenant.slug}/api-keys`,
      headers: { cookie: owner.cookies },
    });
    expect(list.statusCode).toBe(200);
    const listBody = list.json() as {
      apiKeys: Array<{
        id: string;
        token?: string;
        keyHash?: string;
        expiresAt: string | null;
        usageCount: number;
        lastUsedAt: string | null;
        lastUsedMethod: string | null;
        lastUsedPath: string | null;
        lastUsedStatusCode: number | null;
        workspace: { id: string; slug: string; name: string };
      }>;
    };
    expect(listBody.apiKeys.map((apiKey) => apiKey.id)).toContain(key.id);
    expect(listBody.apiKeys[0]?.token).toBeUndefined();
    expect(listBody.apiKeys[0]?.keyHash).toBeUndefined();
    expect(listBody.apiKeys[0]?.expiresAt).toBeNull();
    expect(listBody.apiKeys[0]?.usageCount).toBe(0);
    expect(listBody.apiKeys[0]?.lastUsedAt).toBeNull();
    expect(listBody.apiKeys[0]?.lastUsedMethod).toBeNull();
    expect(listBody.apiKeys[0]?.lastUsedPath).toBeNull();
    expect(listBody.apiKeys[0]?.lastUsedStatusCode).toBeNull();
    expect(listBody.apiKeys[0]?.workspace).toEqual({
      id: owner.tenant.id,
      slug: owner.tenant.slug,
      name: owner.tenant.name,
    });

    const auditRows = await dbHandle.sql<{ action: string }[]>`
      SELECT action FROM audit.audit_events
      WHERE target_type = 'api_key' AND target_id = ${key.id}`;
    expect(auditRows.map((row) => row.action)).toContain('api_key.created');

    const revoked = await app.inject({
      method: 'DELETE',
      url: `/tenants/${owner.tenant.slug}/api-keys/${key.id}`,
      headers: { cookie: owner.cookies },
    });
    expect(revoked.statusCode).toBe(204);

    const afterRevoke = await app.inject({
      method: 'GET',
      url: `/v1/tenants/${owner.tenant.slug}/projects`,
      headers: { authorization: `Bearer ${key.token}` },
    });
    expect(afterRevoke.statusCode).toBe(401);
  });

  it('rejects non-admin API key creation', async () => {
    const owner = await registerOwner('owner@example.com');
    const producer = await registerOwner('producer@example.com');
    await dbHandle.sql`
      DELETE FROM public.tenant_memberships WHERE user_id = ${producer.user.id}`;
    await dbHandle.sql`
      INSERT INTO public.tenant_memberships (tenant_id, user_id, role)
      VALUES (${owner.tenant.id}, ${producer.user.id}, 'producer')`;
    await dbHandle.sql`
      INSERT INTO public.organization_memberships
        (organization_id, user_id, org_role, workspace_access_mode)
      SELECT organization_id, ${producer.user.id}, 'member', 'selected_workspaces'
      FROM public.tenants
      WHERE id = ${owner.tenant.id}`;

    const res = await app.inject({
      method: 'POST',
      url: `/tenants/${owner.tenant.slug}/api-keys`,
      headers: { cookie: producer.cookies },
      payload: { name: 'Producer key' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('creates and lists an API key with an expiration', async () => {
    const owner = await registerOwner('owner@example.com');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const key = await createApiKey(owner, ['read', 'write'], { expiresAt });

    expect(key.apiKey.expiresAt).toBe(expiresAt);

    const list = await app.inject({
      method: 'GET',
      url: `/tenants/${owner.tenant.slug}/api-keys`,
      headers: { cookie: owner.cookies },
    });
    expect(list.statusCode).toBe(200);
    expect(
      (list.json() as { apiKeys: Array<{ id: string; expiresAt: string | null }> })
        .apiKeys[0],
    ).toMatchObject({ id: key.id, expiresAt });
  });

  it('rejects invalid or past API key expirations', async () => {
    const owner = await registerOwner('owner@example.com');

    const invalid = await app.inject({
      method: 'POST',
      url: `/tenants/${owner.tenant.slug}/api-keys`,
      headers: { cookie: owner.cookies },
      payload: { name: 'Invalid key', expiresAt: 'not-a-date' },
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toEqual({ error: 'invalid_expires_at' });

    const past = await app.inject({
      method: 'POST',
      url: `/tenants/${owner.tenant.slug}/api-keys`,
      headers: { cookie: owner.cookies },
      payload: {
        name: 'Past key',
        expiresAt: new Date(Date.now() - 60_000).toISOString(),
      },
    });
    expect(past.statusCode).toBe(400);
    expect(past.json()).toEqual({ error: 'invalid_expires_at' });
  });
});

describe('public V1 read API', () => {
  it('allows read-scoped API keys to read projects, attestations, and events', async () => {
    const owner = await registerOwner('owner@example.com');
    const key = await createApiKey(owner);
    const seeded = await seedProjectAndAttestation(owner);
    const auth = { authorization: `Bearer ${key.token}` };

    const projects = await app.inject({
      method: 'GET',
      url: `/v1/tenants/${owner.tenant.slug}/projects`,
      headers: auth,
    });
    expect(projects.statusCode).toBe(200);
    expect((projects.json() as { data: Array<{ id: string }> }).data[0]?.id).toBe(
      seeded.projectId,
    );
    const usage = await waitForApiKeyUsage(key.id);
    expect(usage).toMatchObject({
      usage_count: 1,
      last_used_method: 'GET',
      last_used_path: '/v1/tenants/:slug/projects',
      last_used_status_code: 200,
    });
    expect(usage?.last_used_at).not.toBeNull();

    const attestations = await app.inject({
      method: 'GET',
      url: `/v1/tenants/${owner.tenant.slug}/attestations`,
      headers: auth,
    });
    expect(attestations.statusCode).toBe(200);
    const attestationRows = attestations.json() as {
      data: Array<{ id: string; project: { slug: string }; receiptAvailable: boolean }>;
    };
    expect(attestationRows.data[0]?.id).toBe(seeded.attestationId);
    expect(attestationRows.data[0]?.project.slug).toBe('api-project');
    expect(attestationRows.data[0]?.receiptAvailable).toBe(true);

    const detail = await app.inject({
      method: 'GET',
      url: `/v1/tenants/${owner.tenant.slug}/attestations/${seeded.attestationId}`,
      headers: auth,
    });
    expect(detail.statusCode).toBe(200);
    expect((detail.json() as { data: { packageId: string } }).data.packageId).toBe(
      'pkg_api_test',
    );

    const receipt = await app.inject({
      method: 'GET',
      url: `/v1/tenants/${owner.tenant.slug}/attestations/${seeded.attestationId}/receipt`,
      headers: auth,
    });
    expect(receipt.statusCode).toBe(200);
    const receiptBody = receipt.json() as {
      data: {
        packageId: string;
        receiptAvailable: boolean;
        receiptPdfAvailable: boolean;
      };
    };
    expect(receiptBody.data.packageId).toBe('pkg_api_test');
    expect(receiptBody.data.receiptAvailable).toBe(true);
    expect(receiptBody.data.receiptPdfAvailable).toBe(false);

    const events = await app.inject({
      method: 'GET',
      url: `/v1/tenants/${owner.tenant.slug}/events`,
      headers: auth,
    });
    expect(events.statusCode).toBe(200);
    expect((events.json() as { data: Array<{ action: string }> }).data.length).toBeGreaterThan(
      0,
    );
  });

  it('does not allow an API key to read another tenant slug', async () => {
    const owner = await registerOwner('owner@example.com');
    const other = await registerOwner('other@example.com');
    const key = await createApiKey(owner);

    const res = await app.inject({
      method: 'GET',
      url: `/v1/tenants/${other.tenant.slug}/projects`,
      headers: { authorization: `Bearer ${key.token}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it('rejects expired API keys without updating last-used metadata', async () => {
    const owner = await registerOwner('owner@example.com');
    const key = await createApiKey(owner);
    await dbHandle.sql`
      UPDATE public.api_keys
      SET expires_at = NOW() - INTERVAL '1 minute'
      WHERE id = ${key.id}`;

    const res = await app.inject({
      method: 'GET',
      url: `/v1/tenants/${owner.tenant.slug}/projects`,
      headers: { authorization: `Bearer ${key.token}` },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({
      error: { code: 'invalid_api_key', retryable: false },
    });

    const rows = await dbHandle.sql<
      Array<{ last_used_at: string | null; usage_count: number }>
    >`
      SELECT last_used_at, usage_count
      FROM public.api_keys
      WHERE id = ${key.id}`;
    expect(rows[0]?.last_used_at).toBeNull();
    expect(rows[0]?.usage_count).toBe(0);
  });

  it('returns workspace metadata when a workspace API key is created', async () => {
    const owner = await registerOwner('owner@example.com');
    const key = await createApiKey(owner);

    expect(key.apiKey.workspace).toEqual({
      id: owner.tenant.id,
      slug: owner.tenant.slug,
      name: owner.tenant.name,
    });
  });
});
