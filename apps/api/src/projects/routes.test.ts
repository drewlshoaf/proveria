// Integration tests for /tenants/:slug/projects.

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
import {
  generateEd25519Keypair,
  signEd25519,
} from '@proveria/crypto-core';
import { createClient, type ClientHandle } from '@proveria/db';

import { buildDeviceSignatureHeaders } from '../auth/device-signature.js';
import { authPlugin } from '../auth/routes.js';
import { config } from '../config.js';
import { LogNotificationProvider } from '../notifications/provider.js';
import { tenantPlugin } from '../tenants/routes.js';
import { projectPlugin } from './routes.js';

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
}

const registerOwner = async (email: string): Promise<Owner> => {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { email, password: 'projects-test-pw' },
  });
  if (res.statusCode !== 201) throw new Error('register failed');
  const workspace = await app.inject({
    method: 'POST',
    url: '/tenants',
    headers: { cookie: extractCookies(res) },
    payload: { name: email },
  });
  if (workspace.statusCode !== 201) throw new Error('workspace failed');
  const body = workspace.json() as { tenant: { id: string; slug: string } };
  return { cookies: extractCookies(res), tenant: body.tenant };
};

interface DesktopDevice {
  deviceId: string;
  privateKey: string;
}

const mintDesktopDevice = async (email: string): Promise<DesktopDevice> => {
  const kp = await generateEd25519Keypair();
  const res = await app.inject({
    method: 'POST',
    url: '/auth/device/mint',
    payload: {
      email,
      password: 'projects-test-pw',
      publicKey: kp.publicKey,
      deviceName: 'Desktop Test',
      platform: 'darwin',
      appVersion: '0.0.0',
    },
  });
  if (res.statusCode !== 201) throw new Error('device mint failed');
  const body = res.json() as { device: { id: string } };
  return { deviceId: body.device.id, privateKey: kp.privateKey };
};

const signedDesktopRequest = async (
  device: DesktopDevice,
  method: 'GET' | 'POST',
  url: string,
  body?: Record<string, unknown>,
): Promise<{
  method: 'GET' | 'POST';
  url: string;
  headers: Record<string, string>;
  payload?: Record<string, unknown>;
}> => {
  const bodyBytes = body
    ? new TextEncoder().encode(JSON.stringify(body))
    : new Uint8Array(0);
  const headers = await buildDeviceSignatureHeaders(
    (payload) => signEd25519(payload, device.privateKey),
    device.deviceId,
    method,
    url,
    bodyBytes,
  );
  return body
    ? {
        method,
        url,
        headers: { 'content-type': 'application/json', ...headers },
        payload: body,
      }
    : { method, url, headers };
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
  await app.register(projectPlugin, { db: dbHandle.db });
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

describe('POST /tenants/:slug/projects', () => {
  it('admin creates a project without choosing a template; Free defaults to public', async () => {
    const owner = await registerOwner('owner@example.com');
    const res = await app.inject({
      method: 'POST',
      url: `/tenants/${owner.tenant.slug}/projects`,
      headers: { cookie: owner.cookies },
      payload: {
        slug: 'my-archive',
        name: 'My Archive',
      },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as {
      project: {
        slug: string;
        visibility: string;
      };
    };
    expect(body.project.slug).toBe('my-archive');
    expect(body.project.visibility).toBe('public');
  });

  it('rejects invalid template_slug with 400', async () => {
    const owner = await registerOwner('owner@example.com');
    const res = await app.inject({
      method: 'POST',
      url: `/tenants/${owner.tenant.slug}/projects`,
      headers: { cookie: owner.cookies },
      payload: {
        slug: 'p1',
        name: 'P1',
        templateSlug: 'not_a_template',
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects invalid slug with 400', async () => {
    const owner = await registerOwner('owner@example.com');
    const res = await app.inject({
      method: 'POST',
      url: `/tenants/${owner.tenant.slug}/projects`,
      headers: { cookie: owner.cookies },
      payload: {
        slug: 'Has Spaces',
        name: 'X',
        templateSlug: 'general_provenance',
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects duplicate slug within a tenant with 409', async () => {
    const owner = await registerOwner('owner@example.com');
    const payload = {
      slug: 'dup',
      name: 'Dup',
      templateSlug: 'general_provenance',
    };
    const a = await app.inject({
      method: 'POST',
      url: `/tenants/${owner.tenant.slug}/projects`,
      headers: { cookie: owner.cookies },
      payload,
    });
    expect(a.statusCode).toBe(201);
    const b = await app.inject({
      method: 'POST',
      url: `/tenants/${owner.tenant.slug}/projects`,
      headers: { cookie: owner.cookies },
      payload,
    });
    expect(b.statusCode).toBe(409);
  });

  it('Free tenant cannot create a private project (400)', async () => {
    const owner = await registerOwner('owner@example.com');
    const res = await app.inject({
      method: 'POST',
      url: `/tenants/${owner.tenant.slug}/projects`,
      headers: { cookie: owner.cookies },
      payload: {
        slug: 'p1',
        name: 'P1',
        templateSlug: 'general_provenance',
        visibility: 'private',
      },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toBe(
      'private_projects_require_paid_plan',
    );
  });

  it('consumer cannot create a project (403)', async () => {
    const owner = await registerOwner('owner@example.com');
    // Upgrade so the M13/C50 user cap (Free = 1) doesn't reject the invite.
    await dbHandle.sql`
      UPDATE public.tenants SET plan = 'team_pro' WHERE id = ${owner.tenant.id}`;
    notificationLines.length = 0;
    // Invite a consumer.
    await app.inject({
      method: 'POST',
      url: `/tenants/${owner.tenant.slug}/invitations`,
      headers: { cookie: owner.cookies },
      payload: { email: 'consumer@example.com', role: 'consumer' },
    });
    const tokenMatch = /token=(\S+)/.exec(notificationLines[0] ?? '');
    if (!tokenMatch) throw new Error('no invite token');
    const token = tokenMatch[1];

    const invitee = await registerOwner('consumer@example.com');
    await app.inject({
      method: 'POST',
      url: '/invitations/accept',
      headers: { cookie: invitee.cookies },
      payload: { token },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/tenants/${owner.tenant.slug}/projects`,
      headers: { cookie: invitee.cookies },
      payload: {
        slug: 'sneaky',
        name: 'X',
        templateSlug: 'general_provenance',
      },
    });
    expect(res.statusCode).toBe(403);
  });

  it('non-member sees 404 (no enumeration)', async () => {
    const owner = await registerOwner('owner@example.com');
    const stranger = await registerOwner('stranger@example.com');
    const res = await app.inject({
      method: 'POST',
      url: `/tenants/${owner.tenant.slug}/projects`,
      headers: { cookie: stranger.cookies },
      payload: {
        slug: 'x',
        name: 'X',
        templateSlug: 'general_provenance',
      },
    });
    expect(res.statusCode).toBe(404);
  });

  // -------------------------------------------------------------------
  // M13/C48 — Free tier project count cap (5)
  // -------------------------------------------------------------------
  it('Free tenant cannot create a 6th project (409 project_count_limit_reached)', async () => {
    const owner = await registerOwner('owner@example.com');
    for (let i = 0; i < 5; i += 1) {
      const ok = await app.inject({
        method: 'POST',
        url: `/tenants/${owner.tenant.slug}/projects`,
        headers: { cookie: owner.cookies },
        payload: {
          slug: `p${i}`,
          name: `P${i}`,
          templateSlug: 'general_provenance',
        },
      });
      expect(ok.statusCode).toBe(201);
    }
    const sixth = await app.inject({
      method: 'POST',
      url: `/tenants/${owner.tenant.slug}/projects`,
      headers: { cookie: owner.cookies },
      payload: {
        slug: 'sixth',
        name: 'Sixth',
        templateSlug: 'general_provenance',
      },
    });
    expect(sixth.statusCode).toBe(409);
    const body = sixth.json() as { error: string; limit: number; current: number };
    expect(body.error).toBe('project_count_limit_reached');
    expect(body.limit).toBe(5);
    expect(body.current).toBe(5);
  });
});

describe('GET /tenants/:slug/projects + /tenants/:slug/projects/:projectSlug', () => {
  it('list returns the project; single-project route returns details', async () => {
    const owner = await registerOwner('owner@example.com');
    await app.inject({
      method: 'POST',
      url: `/tenants/${owner.tenant.slug}/projects`,
      headers: { cookie: owner.cookies },
      payload: {
        slug: 'alpha',
        name: 'Alpha',
        templateSlug: 'research_dataset',
      },
    });

    const list = await app.inject({
      method: 'GET',
      url: `/tenants/${owner.tenant.slug}/projects`,
      headers: { cookie: owner.cookies },
    });
    expect(list.statusCode).toBe(200);
    const body = list.json() as { projects: { slug: string }[] };
    expect(body.projects).toHaveLength(1);
    expect(body.projects[0]?.slug).toBe('alpha');

    const single = await app.inject({
      method: 'GET',
      url: `/tenants/${owner.tenant.slug}/projects/alpha`,
      headers: { cookie: owner.cookies },
    });
    expect(single.statusCode).toBe(200);
    expect(
      (single.json() as { project: Record<string, unknown> }).project
        .templateSlug,
    ).toBe(undefined);
  });

  it('desktop device signature can create and list projects', async () => {
    const email = 'desktop-owner@example.com';
    const owner = await registerOwner(email);
    const device = await mintDesktopDevice(email);
    const createPayload = {
      slug: 'desktop-project',
      name: 'Desktop Project',
      templateSlug: 'general_provenance',
    };

    const create = await app.inject(
      await signedDesktopRequest(
        device,
        'POST',
        `/tenants/${owner.tenant.slug}/projects`,
        createPayload,
      ),
    );
    expect(create.statusCode).toBe(201);
    expect(
      (create.json() as { project: { slug: string; name: string } }).project,
    ).toMatchObject({
      slug: 'desktop-project',
      name: 'Desktop Project',
    });

    const list = await app.inject(
      await signedDesktopRequest(
        device,
        'GET',
        `/tenants/${owner.tenant.slug}/projects`,
      ),
    );
    expect(list.statusCode).toBe(200);
    const body = list.json() as { projects: { slug: string }[] };
    expect(body.projects.map((project) => project.slug)).toContain(
      'desktop-project',
    );
  });

  it('GET missing project returns 404', async () => {
    const owner = await registerOwner('owner@example.com');
    const res = await app.inject({
      method: 'GET',
      url: `/tenants/${owner.tenant.slug}/projects/nope`,
      headers: { cookie: owner.cookies },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('POST /tenants/:slug/projects/:projectSlug/archive + /restore', () => {
  const seedProject = async (owner: Owner, slug: string): Promise<void> => {
    await app.inject({
      method: 'POST',
      url: `/tenants/${owner.tenant.slug}/projects`,
      headers: { cookie: owner.cookies },
      payload: { slug, name: slug, templateSlug: 'general_provenance' },
    });
  };

  it('admin archives a project; it hides from the default list, shows with includeArchived, then restores', async () => {
    const owner = await registerOwner('owner@example.com');
    await seedProject(owner, 'alpha');

    const archive = await app.inject({
      method: 'POST',
      url: `/tenants/${owner.tenant.slug}/projects/alpha/archive`,
      headers: { cookie: owner.cookies },
    });
    expect(archive.statusCode).toBe(200);
    expect(
      (archive.json() as { project: { archivedAt: string | null } }).project
        .archivedAt,
    ).not.toBeNull();

    // Hidden from the default list.
    const defaultList = await app.inject({
      method: 'GET',
      url: `/tenants/${owner.tenant.slug}/projects`,
      headers: { cookie: owner.cookies },
    });
    expect(
      (defaultList.json() as { projects: unknown[] }).projects,
    ).toHaveLength(0);

    // Visible to an admin with ?includeArchived=true.
    const withArchived = await app.inject({
      method: 'GET',
      url: `/tenants/${owner.tenant.slug}/projects?includeArchived=true`,
      headers: { cookie: owner.cookies },
    });
    expect(
      (withArchived.json() as { projects: unknown[] }).projects,
    ).toHaveLength(1);

    // Re-archiving is a 409.
    const reArchive = await app.inject({
      method: 'POST',
      url: `/tenants/${owner.tenant.slug}/projects/alpha/archive`,
      headers: { cookie: owner.cookies },
    });
    expect(reArchive.statusCode).toBe(409);

    // Restore brings it back into the default list.
    const restore = await app.inject({
      method: 'POST',
      url: `/tenants/${owner.tenant.slug}/projects/alpha/restore`,
      headers: { cookie: owner.cookies },
    });
    expect(restore.statusCode).toBe(200);
    expect(
      (restore.json() as { project: { archivedAt: string | null } }).project
        .archivedAt,
    ).toBeNull();
  });

  it('admin desktop can archive and restore with device signatures', async () => {
    const owner = await registerOwner('owner@example.com');
    await seedProject(owner, 'desktop-alpha');
    const device = await mintDesktopDevice('owner@example.com');

    const archive = await app.inject(
      await signedDesktopRequest(
        device,
        'POST',
        `/tenants/${owner.tenant.slug}/projects/desktop-alpha/archive`,
        {},
      ),
    );
    expect(archive.statusCode).toBe(200);
    expect(
      (archive.json() as { project: { archivedAt: string | null } }).project
        .archivedAt,
    ).not.toBeNull();

    const restore = await app.inject(
      await signedDesktopRequest(
        device,
        'POST',
        `/tenants/${owner.tenant.slug}/projects/desktop-alpha/restore`,
        {},
      ),
    );
    expect(restore.statusCode).toBe(200);
    expect(
      (restore.json() as { project: { archivedAt: string | null } }).project
        .archivedAt,
    ).toBeNull();
  });

  it('non-member cannot archive (404, no enumeration)', async () => {
    const owner = await registerOwner('owner@example.com');
    await seedProject(owner, 'alpha');
    const stranger = await registerOwner('stranger@example.com');
    const res = await app.inject({
      method: 'POST',
      url: `/tenants/${owner.tenant.slug}/projects/alpha/archive`,
      headers: { cookie: stranger.cookies },
    });
    expect(res.statusCode).toBe(404);
  });
});
