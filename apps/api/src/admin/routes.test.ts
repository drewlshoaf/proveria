// Tests for the platform-admin surface (M15/C56). Queue inspection
// requires a live Redis so we exercise it sparingly; the
// platform-admin gate + the failed-attestations listing are exercised
// end-to-end via the existing api test stack.

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

import { adminPlugin } from './routes.js';
import { authPlugin } from '../auth/routes.js';
import { config } from '../config.js';
import { LogNotificationProvider } from '../notifications/provider.js';

const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgres://proveria:proveria_dev@localhost:5432/proveria_test';

let dbHandle: ClientHandle;
let app: FastifyInstance;

const truncateAll = async (): Promise<void> => {
  await dbHandle.sql.unsafe(`
    TRUNCATE TABLE
      audit.audit_events,
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

const extractCookies = (res: {
  headers: { 'set-cookie'?: string | string[] };
}): string => {
  const raw = res.headers['set-cookie'];
  if (!raw) throw new Error('expected Set-Cookie');
  const arr = Array.isArray(raw) ? raw : [raw];
  return arr
    .map((c) => c.split(';')[0])
    .filter((c): c is string => Boolean(c))
    .join('; ');
};

const registerOwner = async (
  email: string,
): Promise<{ cookies: string; tenantId: string }> => {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { email, password: 'admin-test-pw' },
  });
  if (res.statusCode !== 201) throw new Error('register failed');
  const body = res.json() as { user: { id: string } };
  const slug = email.split('@')[0] ?? 'user';
  const [tenant] = await dbHandle.sql<{ id: string }[]>`
    INSERT INTO public.tenants (name, slug, plan, is_personal)
    VALUES (${email}, ${slug}, 'free', false)
    RETURNING id`;
  await dbHandle.sql`
    INSERT INTO public.tenant_memberships (tenant_id, user_id, role)
    VALUES (${tenant!.id}, ${body.user.id}, 'tenant_admin')`;
  return { cookies: extractCookies(res), tenantId: tenant!.id };
};

beforeAll(async () => {
  // Inject a platform-admin email allowlist for the test process.
  // config.platformAdminEmails is computed at module import time, so we
  // assign through the readonly cast — vitest's `vi.stubEnv` won't work
  // since the array is already frozen via `as const`.
  (config as { platformAdminEmails: string[] }).platformAdminEmails = [
    'admin@example.com',
  ];

  dbHandle = createClient({ url: DATABASE_URL, max: 5 });
  app = Fastify({ logger: false });
  await app.register(sensible);
  await app.register(cookie, { secret: config.sessionSecret });
  const notifications = new LogNotificationProvider(() => {});
  await app.register(authPlugin, { db: dbHandle.db, notifications });
  // No redis in the test rig — admin queue routes will 503; that's fine,
  // we're testing the auth gate + the cross-tenant attestation listing.
  await app.register(adminPlugin, { db: dbHandle.db, redis: null });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await dbHandle.close();
});

beforeEach(async () => {
  await truncateAll();
});

describe('admin gate', () => {
  it('rejects an authenticated non-admin with 403', async () => {
    const other = await registerOwner('other@example.com');
    const res = await app.inject({
      method: 'GET',
      url: '/admin/queues',
      headers: { cookie: other.cookies },
    });
    expect(res.statusCode).toBe(403);
  });

  it('rejects an unauthenticated request with 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/admin/queues' });
    expect(res.statusCode).toBe(401);
  });

  it('returns 503 (no_redis) when redis is unavailable, even for admins', async () => {
    const admin = await registerOwner('admin@example.com');
    const res = await app.inject({
      method: 'GET',
      url: '/admin/queues',
      headers: { cookie: admin.cookies },
    });
    expect(res.statusCode).toBe(503);
    expect((res.json() as { error: string }).error).toBe('no_redis');
  });
});

describe('GET /admin/attestations/failed', () => {
  it('returns failed_needs_review attestations newest-first with last validation_error', async () => {
    const admin = await registerOwner('admin@example.com');

    // Insert two failed attestations directly so we don't need the whole
    // device-signed submission flow to seed the test rig.
    await dbHandle.sql`
      INSERT INTO public.projects (tenant_id, slug, name, template_slug, visibility, created_by_user_id)
      VALUES (${admin.tenantId}, 'p1', 'p1', 'general_provenance', 'public',
              (SELECT id FROM public.users WHERE email = 'admin@example.com'))`;
    const projectRow = await dbHandle.sql<{ id: string }[]>`
      SELECT id FROM public.projects WHERE tenant_id = ${admin.tenantId} LIMIT 1`;
    const projectId = projectRow[0]!.id;
    const adminUserRow = await dbHandle.sql<{ id: string }[]>`
      SELECT id FROM public.users WHERE email = 'admin@example.com' LIMIT 1`;
    const userId = adminUserRow[0]!.id;

    // We need a device row so created_by_device_id satisfies its FK.
    const deviceRow = await dbHandle.sql<{ id: string }[]>`
      INSERT INTO public.devices
        (tenant_id, user_id, profile_id, name, platform, app_version, public_key)
      VALUES (${admin.tenantId}, ${userId}, gen_random_uuid(), 'test', 'darwin',
              '0.0.0', 'fake-public-key')
      RETURNING id`;
    const deviceId = deviceRow[0]!.id;

    const insertFailed = async (label: string, error: string): Promise<void> => {
      const attRow = await dbHandle.sql<{ id: string }[]>`
        INSERT INTO public.attestations
          (tenant_id, project_id, label, created_by_user_id,
           created_by_device_id, state, failed_at)
        VALUES (${admin.tenantId}, ${projectId}, ${label}, ${userId},
                ${deviceId}, 'failed_needs_review', NOW())
        RETURNING id`;
      await dbHandle.sql`
        INSERT INTO public.submission_attempts
          (attestation_id, state, validation_error, failed_at)
        VALUES (${attRow[0]!.id}, 'failed', ${error}, NOW())`;
    };
    await insertFailed('first', 'manifest_tenant_id_mismatch');
    await new Promise((r) => setTimeout(r, 50)); // ensure ordering
    await insertFailed('second', 'device_signature_invalid');

    const res = await app.inject({
      method: 'GET',
      url: '/admin/attestations/failed',
      headers: { cookie: admin.cookies },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      attestations: Array<{
        label: string;
        lastFailedAttempt: { validationError: string } | null;
      }>;
    };
    expect(body.attestations).toHaveLength(2);
    expect(body.attestations[0]?.label).toBe('second');
    expect(body.attestations[0]?.lastFailedAttempt?.validationError).toBe(
      'device_signature_invalid',
    );
    expect(body.attestations[1]?.label).toBe('first');
  });
});
