// Tests for the device-signed /me/* routes used by the desktop's
// Account view.

import cookie from '@fastify/cookie';
import sensible from '@fastify/sensible';
import {
  generateEd25519Keypair,
  signEd25519,
} from '@proveria/crypto-core';
import { createClient, type ClientHandle } from '@proveria/db';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';

import { authPlugin } from '../auth/routes.js';
import { buildDeviceSignatureHeaders } from '../auth/device-signature.js';
import { config } from '../config.js';
import { devicePlugin } from '../devices/routes.js';
import { LogNotificationProvider } from '../notifications/provider.js';
import { tenantPlugin } from '../tenants/routes.js';

import { mePlugin } from './routes.js';

const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgres://proveria:proveria_dev@localhost:5432/proveria_test';

let dbHandle: ClientHandle;
let app: FastifyInstance;

const truncateAll = async (): Promise<void> => {
  await dbHandle.sql.unsafe(`
    TRUNCATE TABLE
      audit.audit_events,
      public.external_identities,
      public.oidc_identity_providers,
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

interface Owner {
  cookies: string;
  tenantId: string;
  tenantSlug: string;
}

const registerOwner = async (email: string): Promise<Owner> => {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { email, password: 'me-test-pw' },
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
  return {
    cookies: extractCookies(res),
    tenantId: body.tenant.id,
    tenantSlug: body.tenant.slug,
  };
};

interface PairedDevice {
  deviceId: string;
  privateKey: string;
}

const pairDevice = async (
  owner: Owner,
  name = 'Test Device',
): Promise<PairedDevice> => {
  const kp = await generateEd25519Keypair();
  const init = await app.inject({
    method: 'POST',
    url: '/devices/pairing/initiate',
    payload: {
      publicKey: kp.publicKey,
      name,
      platform: 'darwin',
      appVersion: '0.0.0',
    },
  });
  const { code } = init.json() as { code: string };
  const approve = await app.inject({
    method: 'POST',
    url: `/tenants/${owner.tenantSlug}/devices/pairing/approve`,
    headers: { cookie: owner.cookies },
    payload: { code, name },
  });
  const deviceId = (approve.json() as { device: { id: string } }).device.id;
  return { deviceId, privateKey: kp.privateKey };
};

const signedRequest = async (
  device: PairedDevice,
  method: 'GET' | 'POST',
  url: string,
  body?: object,
): Promise<{
  method: 'GET' | 'POST';
  url: string;
  headers: Record<string, string>;
  payload?: object;
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
    ? { method, url, headers: { 'content-type': 'application/json', ...headers }, payload: body }
    : { method, url, headers };
};

beforeAll(async () => {
  dbHandle = createClient({ url: DATABASE_URL, max: 5 });
  app = Fastify({ logger: false });
  await app.register(sensible);
  await app.register(cookie, { secret: config.sessionSecret });
  const notifications = new LogNotificationProvider(() => {});
  await app.register(authPlugin, { db: dbHandle.db, notifications });
  await app.register(tenantPlugin, { db: dbHandle.db, notifications });
  await app.register(devicePlugin, { db: dbHandle.db });
  await app.register(mePlugin, { db: dbHandle.db });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await dbHandle.close();
});

beforeEach(async () => {
  await truncateAll();
});

describe('GET /me/session', () => {
  it('returns the current user and workspace context for a paired desktop device', async () => {
    const owner = await registerOwner('owner@example.com');
    const device = await pairDevice(owner, 'Desktop Session Device');

    const res = await app.inject(
      await signedRequest(device, 'GET', '/me/session'),
    );

    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      user: { email: string };
      workspaces: Array<{
        id: string;
        slug: string;
        role: string;
        organizationId: string;
      }>;
      organizations: Array<{ id: string; role: string }>;
    };
    expect(body.user.email).toBe('owner@example.com');
    expect(body.workspaces).toEqual([
      expect.objectContaining({
        id: owner.tenantId,
        slug: owner.tenantSlug,
        role: 'tenant_admin',
      }),
    ]);
    expect(body.organizations).toEqual([
      expect.objectContaining({ role: 'organization_admin' }),
    ]);
  });

  it('returns 401 when the paired desktop device is revoked', async () => {
    const owner = await registerOwner('owner@example.com');
    const device = await pairDevice(owner, 'Revoked Desktop Device');
    await dbHandle.sql`
      UPDATE public.devices SET revoked_at = now() WHERE id = ${device.deviceId}`;

    const res = await app.inject(
      await signedRequest(device, 'GET', '/me/session'),
    );

    expect(res.statusCode).toBe(401);
  });
});

describe('GET /me/external-identities', () => {
  it('lists linked OIDC identities for the current user only', async () => {
    const owner = await registerOwner('owner@example.com');
    const stranger = await registerOwner('stranger@example.com');
    const a = await pairDevice(owner, 'Mac');
    const ownerUser = await dbHandle.sql<{ id: string }[]>`
      SELECT id FROM public.users WHERE email = 'owner@example.com' LIMIT 1`;
    const strangerUser = await dbHandle.sql<{ id: string }[]>`
      SELECT id FROM public.users WHERE email = 'stranger@example.com' LIMIT 1`;
    const provider = await dbHandle.sql<{ id: string }[]>`
      INSERT INTO public.oidc_identity_providers
        (
          slug,
          display_name,
          issuer_url,
          authorization_endpoint,
          token_endpoint,
          jwks_uri,
          client_id
        )
      VALUES
        (
          'entra',
          'Microsoft Entra ID',
          'https://login.microsoftonline.com/common/v2.0',
          'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
          'https://login.microsoftonline.com/common/oauth2/v2.0/token',
          'https://login.microsoftonline.com/common/discovery/v2.0/keys',
          'client-id'
        )
      RETURNING id`;
    await dbHandle.sql`
      INSERT INTO public.external_identities
        (user_id, provider_id, provider_subject, email, email_verified)
      VALUES
        (${ownerUser[0]!.id}, ${provider[0]!.id}, 'owner-sub',
         'owner@example.com', true),
        (${strangerUser[0]!.id}, ${provider[0]!.id}, 'stranger-sub',
         'stranger@example.com', true)`;

    const res = await app.inject(
      await signedRequest(a, 'GET', '/me/external-identities'),
    );

    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      identities: Array<{
        providerSlug: string;
        providerDisplayName: string;
        email: string;
        emailVerified: boolean;
      }>;
    };
    expect(body.identities).toEqual([
      expect.objectContaining({
        providerSlug: 'entra',
        providerDisplayName: 'Microsoft Entra ID',
        email: 'owner@example.com',
        emailVerified: true,
      }),
    ]);
  });
});

describe('GET /me/external-identities/:provider/connect/start', () => {
  it('creates an OIDC connect state scoped to the current user', async () => {
    const owner = await registerOwner('owner@example.com');
    const a = await pairDevice(owner, 'Mac');
    const ownerUser = await dbHandle.sql<{ id: string }[]>`
      SELECT id FROM public.users WHERE email = 'owner@example.com' LIMIT 1`;
    await dbHandle.sql`
      INSERT INTO public.oidc_identity_providers
        (
          slug,
          display_name,
          issuer_url,
          authorization_endpoint,
          token_endpoint,
          jwks_uri,
          client_id
        )
      VALUES
        (
          'entra',
          'Microsoft Entra ID',
          'https://login.microsoftonline.com/common/v2.0',
          'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
          'https://login.microsoftonline.com/common/oauth2/v2.0/token',
          'https://login.microsoftonline.com/common/discovery/v2.0/keys',
          'client-id'
        )`;

    const res = await app.inject(
      await signedRequest(
        a,
        'GET',
        '/me/external-identities/entra/connect/start',
      ),
    );

    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      provider: { slug: string };
      authorizationUrl: string;
    };
    expect(body.provider.slug).toBe('entra');
    const url = new URL(body.authorizationUrl);
    expect(url.searchParams.get('client_id')).toBe('client-id');
    expect(url.searchParams.get('state')).toBeTruthy();

    const states = await dbHandle.sql<
      { flow: string; connect_user_id: string }[]
    >`SELECT flow, connect_user_id FROM public.oidc_auth_states`;
    expect(states).toEqual([
      {
        flow: 'connect',
        connect_user_id: ownerUser[0]!.id,
      },
    ]);
  });
});

describe('POST /me/external-identities/:id/disconnect', () => {
  it('disconnects a linked identity when another active identity remains', async () => {
    const owner = await registerOwner('owner@example.com');
    const a = await pairDevice(owner, 'Mac');
    const ownerUser = await dbHandle.sql<{ id: string }[]>`
      SELECT id FROM public.users WHERE email = 'owner@example.com' LIMIT 1`;
    const provider = await dbHandle.sql<{ id: string }[]>`
      INSERT INTO public.oidc_identity_providers
        (
          slug,
          display_name,
          issuer_url,
          authorization_endpoint,
          token_endpoint,
          jwks_uri,
          client_id
        )
      VALUES
        (
          'entra',
          'Microsoft Entra ID',
          'https://login.microsoftonline.com/common/v2.0',
          'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
          'https://login.microsoftonline.com/common/oauth2/v2.0/token',
          'https://login.microsoftonline.com/common/discovery/v2.0/keys',
          'client-id'
        )
      RETURNING id`;
    const identities = await dbHandle.sql<{ id: string }[]>`
      INSERT INTO public.external_identities
        (user_id, provider_id, provider_subject, email, email_verified)
      VALUES
        (${ownerUser[0]!.id}, ${provider[0]!.id}, 'owner-sub-1',
         'owner@example.com', true),
        (${ownerUser[0]!.id}, ${provider[0]!.id}, 'owner-sub-2',
         'owner@example.com', true)
      RETURNING id`;

    const res = await app.inject(
      await signedRequest(
        a,
        'POST',
        `/me/external-identities/${identities[0]!.id}/disconnect`,
        {},
      ),
    );

    expect(res.statusCode).toBe(204);
    const rows = await dbHandle.sql<{ disconnected_at: Date | null }[]>`
      SELECT disconnected_at FROM public.external_identities
      WHERE id = ${identities[0]!.id}`;
    expect(rows[0]!.disconnected_at).not.toBeNull();

    const auditRows = await dbHandle.sql<
      {
        tenant_id: string | null;
        actor_user_id: string | null;
        actor_device_id: string | null;
        action: string;
        target_id: string | null;
        payload: unknown;
      }[]
    >`
      SELECT tenant_id, actor_user_id, actor_device_id, action, target_id, payload
      FROM audit.audit_events
      WHERE action = 'external_identity.disconnected'`;
    expect(auditRows).toEqual([
      expect.objectContaining({
        tenant_id: owner.tenantId,
        actor_user_id: ownerUser[0]!.id,
        actor_device_id: a.deviceId,
        action: 'external_identity.disconnected',
        target_id: identities[0]!.id,
        payload: expect.objectContaining({
          provider: 'entra',
          providerDisplayName: 'Microsoft Entra ID',
          email: 'owner@example.com',
        }),
      }),
    ]);
  });

  it('blocks disconnecting the last active external identity', async () => {
    const owner = await registerOwner('owner@example.com');
    const a = await pairDevice(owner, 'Mac');
    const ownerUser = await dbHandle.sql<{ id: string }[]>`
      SELECT id FROM public.users WHERE email = 'owner@example.com' LIMIT 1`;
    const provider = await dbHandle.sql<{ id: string }[]>`
      INSERT INTO public.oidc_identity_providers
        (
          slug,
          display_name,
          issuer_url,
          authorization_endpoint,
          token_endpoint,
          jwks_uri,
          client_id
        )
      VALUES
        (
          'entra',
          'Microsoft Entra ID',
          'https://login.microsoftonline.com/common/v2.0',
          'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',
          'https://login.microsoftonline.com/common/oauth2/v2.0/token',
          'https://login.microsoftonline.com/common/discovery/v2.0/keys',
          'client-id'
        )
      RETURNING id`;
    const identities = await dbHandle.sql<{ id: string }[]>`
      INSERT INTO public.external_identities
        (user_id, provider_id, provider_subject, email, email_verified)
      VALUES
        (${ownerUser[0]!.id}, ${provider[0]!.id}, 'owner-sub',
         'owner@example.com', true)
      RETURNING id`;

    const res = await app.inject(
      await signedRequest(
        a,
        'POST',
        `/me/external-identities/${identities[0]!.id}/disconnect`,
        {},
      ),
    );

    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'last_external_identity' });
  });
});

describe('GET /me/devices', () => {
  it('lists every device for the caller user; marks the caller', async () => {
    const owner = await registerOwner('owner@example.com');
    const a = await pairDevice(owner, 'Mac');
    const b = await pairDevice(owner, 'iPad');

    const res = await app.inject(
      await signedRequest(a, 'GET', '/me/devices'),
    );
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      devices: Array<{
        id: string;
        isCurrent: boolean;
        name: string;
        revokedAt: string | null;
      }>;
    };
    expect(body.devices).toHaveLength(2);
    const current = body.devices.find((d) => d.id === a.deviceId);
    const other = body.devices.find((d) => d.id === b.deviceId);
    expect(current?.isCurrent).toBe(true);
    expect(other?.isCurrent).toBe(false);
    expect(body.devices.every((d) => d.revokedAt === null)).toBe(true);
  });
});

describe('POST /me/devices/:id/revoke', () => {
  it('revokes another device the same user owns', async () => {
    const owner = await registerOwner('owner@example.com');
    const a = await pairDevice(owner, 'Mac');
    const b = await pairDevice(owner, 'Lost Laptop');

    const revoke = await app.inject(
      await signedRequest(a, 'POST', `/me/devices/${b.deviceId}/revoke`, {}),
    );
    expect(revoke.statusCode).toBe(204);

    // Listing reflects the revocation.
    const list = await app.inject(
      await signedRequest(a, 'GET', '/me/devices'),
    );
    const body = list.json() as {
      devices: Array<{ id: string; revokedAt: string | null }>;
    };
    expect(body.devices.find((d) => d.id === b.deviceId)?.revokedAt).not.toBe(
      null,
    );
  });

  it('the revoked device cannot sign subsequent requests (401)', async () => {
    const owner = await registerOwner('owner@example.com');
    const a = await pairDevice(owner, 'Mac');
    const b = await pairDevice(owner, 'Other');

    await app.inject(
      await signedRequest(a, 'POST', `/me/devices/${b.deviceId}/revoke`, {}),
    );

    // b tries to call /me/devices — middleware should reject.
    const bAttempt = await app.inject(
      await signedRequest(b, 'GET', '/me/devices'),
    );
    expect(bAttempt.statusCode).toBe(401);
  });

  it('rejects revoking a device that belongs to a different user (404)', async () => {
    const owner = await registerOwner('owner@example.com');
    const stranger = await registerOwner('stranger@example.com');
    const a = await pairDevice(owner, 'Mac');
    const s = await pairDevice(stranger, 'Stranger Mac');

    const revoke = await app.inject(
      await signedRequest(a, 'POST', `/me/devices/${s.deviceId}/revoke`, {}),
    );
    expect(revoke.statusCode).toBe(404);
  });

  it('returns 409 when revoking an already-revoked device', async () => {
    const owner = await registerOwner('owner@example.com');
    const a = await pairDevice(owner, 'Mac');
    const b = await pairDevice(owner, 'Other');

    await app.inject(
      await signedRequest(a, 'POST', `/me/devices/${b.deviceId}/revoke`, {}),
    );
    const second = await app.inject(
      await signedRequest(a, 'POST', `/me/devices/${b.deviceId}/revoke`, {}),
    );
    expect(second.statusCode).toBe(409);
  });
});

describe('GET /me/attestations/recent', () => {
  it('returns only attestations created by this device, newest-first', async () => {
    const owner = await registerOwner('owner@example.com');
    const a = await pairDevice(owner, 'Mac');
    const b = await pairDevice(owner, 'Other Mac');

    // Seed a project + a few attestations from each device via direct SQL
    // so we don't need the full submit flow here.
    await dbHandle.sql`
      INSERT INTO public.projects (tenant_id, slug, name, template_slug, visibility, created_by_user_id)
      VALUES (${owner.tenantId}, 'p1', 'P1', 'general_provenance', 'public',
              (SELECT id FROM public.users WHERE email = 'owner@example.com'))`;
    const project = await dbHandle.sql<{ id: string }[]>`
      SELECT id FROM public.projects WHERE tenant_id = ${owner.tenantId} LIMIT 1`;
    const userId = (
      await dbHandle.sql<{ id: string }[]>`
        SELECT id FROM public.users WHERE email = 'owner@example.com' LIMIT 1`
    )[0]!.id;

    const insertAtt = async (
      label: string,
      deviceId: string,
      state: string,
    ): Promise<void> => {
      await dbHandle.sql`
        INSERT INTO public.attestations
          (tenant_id, project_id, label, created_by_user_id,
           created_by_device_id, state)
        VALUES (${owner.tenantId}, ${project[0]!.id}, ${label}, ${userId},
                ${deviceId}, ${state})`;
    };
    await insertAtt('mine-1', a.deviceId, 'pending');
    await new Promise((r) => setTimeout(r, 30));
    await insertAtt('not-mine', b.deviceId, 'pending');
    await new Promise((r) => setTimeout(r, 30));
    await insertAtt('mine-2', a.deviceId, 'confirmed');

    const res = await app.inject(
      await signedRequest(a, 'GET', '/me/attestations/recent?limit=5'),
    );
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      attestations: Array<{ label: string; state: string }>;
    };
    expect(body.attestations.map((a) => a.label)).toEqual([
      'mine-2',
      'mine-1',
    ]);
    expect(body.attestations[0]?.state).toBe('confirmed');

    const limited = await app.inject(
      await signedRequest(a, 'GET', '/me/attestations/recent?limit=1'),
    );
    expect(limited.statusCode).toBe(200);
    const limitedBody = limited.json() as {
      attestations: Array<{ label: string; projectName: string }>;
    };
    expect(limitedBody.attestations).toHaveLength(1);
    expect(limitedBody.attestations[0]).toMatchObject({
      label: 'mine-2',
      projectName: 'P1',
    });
  });
});
