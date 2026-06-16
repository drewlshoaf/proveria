// Integration tests for /devices/* + /tenants/:slug/devices.
// Same harness pattern as auth + tenants: real Postgres, truncate per test.

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
  type Ed25519Keypair,
} from '@proveria/crypto-core';
import { createClient, type ClientHandle } from '@proveria/db';

import { authPlugin } from '../auth/routes.js';
import { buildDeviceSignatureHeaders } from '../auth/device-signature.js';
import { config } from '../config.js';
import { LogNotificationProvider } from '../notifications/provider.js';
import { tenantPlugin } from '../tenants/routes.js';
import { devicePlugin } from './routes.js';

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

interface OwnerRegistration {
  cookies: string;
  user: { id: string };
  tenant: { id: string; slug: string };
}

const registerOwner = async (email: string): Promise<OwnerRegistration> => {
  const res = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { email, password: 'devices-test-pw' },
  });
  if (res.statusCode !== 201) {
    throw new Error(`register ${email} failed: ${res.statusCode}`);
  }
  const body = res.json() as {
    user: { id: string };
  };
  const workspace = await app.inject({
    method: 'POST',
    url: '/tenants',
    headers: { cookie: extractCookies(res) },
    payload: { name: email },
  });
  if (workspace.statusCode !== 201) {
    throw new Error(`workspace ${email} failed: ${workspace.statusCode}`);
  }
  const workspaceBody = workspace.json() as {
    tenant: { id: string; slug: string };
  };
  return {
    cookies: extractCookies(res),
    user: body.user,
    tenant: workspaceBody.tenant,
  };
};

const signedRequest = async (
  device: { deviceId: string; privateKey: string },
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
  await app.register(devicePlugin, { db: dbHandle.db });
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

// ---------------------------------------------------------------------------
// pairing roundtrip
// ---------------------------------------------------------------------------

describe('device pairing', () => {
  it('initiate → approve → status returns the device record', async () => {
    const owner = await registerOwner('owner@example.com');
    const kp: Ed25519Keypair = await generateEd25519Keypair();

    const initiate = await app.inject({
      method: 'POST',
      url: '/devices/pairing/initiate',
      payload: {
        publicKey: kp.publicKey,
        name: 'Test Mac',
        platform: 'darwin',
        appVersion: '0.0.0',
      },
    });
    expect(initiate.statusCode).toBe(201);
    const { code } = initiate.json() as { code: string };
    expect(code).toMatch(/^[A-Z2-9]{8}$/);

    // Pre-approval: status reads pending.
    const pending = await app.inject({
      method: 'GET',
      url: `/devices/pairing/status?code=${code}`,
    });
    expect(pending.statusCode).toBe(200);
    expect((pending.json() as { state: string }).state).toBe('pending');

    // Owner approves.
    const approve = await app.inject({
      method: 'POST',
      url: `/tenants/${owner.tenant.slug}/devices/pairing/approve`,
      headers: { cookie: owner.cookies },
      payload: { code, name: 'Test Mac' },
    });
    expect(approve.statusCode).toBe(200);
    const approvedDevice = (approve.json() as {
      device: { id: string; tenantId: string; platform: string };
    }).device;
    expect(approvedDevice.tenantId).toBe(owner.tenant.id);
    expect(approvedDevice.platform).toBe('darwin');

    // Status now reads approved and includes the device.
    const status = await app.inject({
      method: 'GET',
      url: `/devices/pairing/status?code=${code}`,
    });
    const body = status.json() as {
      state: string;
      device?: { id: string; name: string };
    };
    expect(body.state).toBe('approved');
    expect(body.device?.id).toBe(approvedDevice.id);
    expect(body.device?.name).toBe('Test Mac');
  });

  it('approve fails 404 from outside the tenant; 403 for consumer role', async () => {
    const owner = await registerOwner('owner@example.com');
    const stranger = await registerOwner('stranger@example.com');
    const kp = await generateEd25519Keypair();
    const init = await app.inject({
      method: 'POST',
      url: '/devices/pairing/initiate',
      payload: {
        publicKey: kp.publicKey,
        name: 'X',
        platform: 'darwin',
        appVersion: '0.0.0',
      },
    });
    const { code } = init.json() as { code: string };

    const stranger404 = await app.inject({
      method: 'POST',
      url: `/tenants/${owner.tenant.slug}/devices/pairing/approve`,
      headers: { cookie: stranger.cookies },
      payload: { code, name: 'X' },
    });
    expect(stranger404.statusCode).toBe(404);
  });

  it('approving twice fails 409 with state=approved', async () => {
    const owner = await registerOwner('owner@example.com');
    const kp = await generateEd25519Keypair();
    const init = await app.inject({
      method: 'POST',
      url: '/devices/pairing/initiate',
      payload: {
        publicKey: kp.publicKey,
        name: 'X',
        platform: 'darwin',
        appVersion: '0.0.0',
      },
    });
    const { code } = init.json() as { code: string };

    await app.inject({
      method: 'POST',
      url: `/tenants/${owner.tenant.slug}/devices/pairing/approve`,
      headers: { cookie: owner.cookies },
      payload: { code, name: 'X' },
    });

    const second = await app.inject({
      method: 'POST',
      url: `/tenants/${owner.tenant.slug}/devices/pairing/approve`,
      headers: { cookie: owner.cookies },
      payload: { code, name: 'X' },
    });
    expect(second.statusCode).toBe(409);
  });
});

// ---------------------------------------------------------------------------
// verify-signature — proves the whole crypto chain end-to-end
// ---------------------------------------------------------------------------

describe('POST /devices/:id/verify-signature', () => {
  it('verifies a signature produced with the paired private key', async () => {
    const owner = await registerOwner('owner@example.com');
    const kp = await generateEd25519Keypair();
    const init = await app.inject({
      method: 'POST',
      url: '/devices/pairing/initiate',
      payload: {
        publicKey: kp.publicKey,
        name: 'X',
        platform: 'darwin',
        appVersion: '0.0.0',
      },
    });
    const { code } = init.json() as { code: string };
    const approve = await app.inject({
      method: 'POST',
      url: `/tenants/${owner.tenant.slug}/devices/pairing/approve`,
      headers: { cookie: owner.cookies },
      payload: { code, name: 'X' },
    });
    const deviceId = (approve.json() as { device: { id: string } }).device.id;

    const payloadStr = JSON.stringify({ nonce: 'abc', ts: 12345 });
    const payloadBytes = new TextEncoder().encode(payloadStr);
    const signature = await signEd25519(payloadBytes, kp.privateKey);

    const verify = await app.inject({
      method: 'POST',
      url: `/devices/${deviceId}/verify-signature`,
      payload: {
        payload: Buffer.from(payloadBytes).toString('base64url'),
        signature,
      },
    });
    expect(verify.statusCode).toBe(200);
    const body = verify.json() as { valid: boolean; revoked: boolean };
    expect(body.valid).toBe(true);
    expect(body.revoked).toBe(false);
  });

  it('returns valid:false when the signature is for a different payload', async () => {
    const owner = await registerOwner('owner@example.com');
    const kp = await generateEd25519Keypair();
    const init = await app.inject({
      method: 'POST',
      url: '/devices/pairing/initiate',
      payload: {
        publicKey: kp.publicKey,
        name: 'X',
        platform: 'darwin',
        appVersion: '0.0.0',
      },
    });
    const { code } = init.json() as { code: string };
    const approve = await app.inject({
      method: 'POST',
      url: `/tenants/${owner.tenant.slug}/devices/pairing/approve`,
      headers: { cookie: owner.cookies },
      payload: { code, name: 'X' },
    });
    const deviceId = (approve.json() as { device: { id: string } }).device.id;

    const real = new TextEncoder().encode('original');
    const sig = await signEd25519(real, kp.privateKey);
    const verify = await app.inject({
      method: 'POST',
      url: `/devices/${deviceId}/verify-signature`,
      payload: {
        payload: Buffer.from(
          new TextEncoder().encode('tampered'),
        ).toString('base64url'),
        signature: sig,
      },
    });
    expect(verify.statusCode).toBe(200);
    expect((verify.json() as { valid: boolean }).valid).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// list + revoke
// ---------------------------------------------------------------------------

describe('GET /tenants/:slug/devices + revoke', () => {
  it('allows a paired admin desktop device to list workspace devices', async () => {
    const owner = await registerOwner('owner@example.com');
    const kp = await generateEd25519Keypair();
    const init = await app.inject({
      method: 'POST',
      url: '/devices/pairing/initiate',
      payload: {
        publicKey: kp.publicKey,
        name: 'Admin Mac',
        platform: 'darwin',
        appVersion: '0.0.0',
      },
    });
    const { code } = init.json() as { code: string };
    const approve = await app.inject({
      method: 'POST',
      url: `/tenants/${owner.tenant.slug}/devices/pairing/approve`,
      headers: { cookie: owner.cookies },
      payload: { code, name: 'Admin Mac' },
    });
    const deviceId = (approve.json() as { device: { id: string } }).device.id;

    const list = await app.inject(
      await signedRequest(
        { deviceId, privateKey: kp.privateKey },
        'GET',
        `/tenants/${owner.tenant.slug}/devices`,
      ),
    );

    expect(list.statusCode).toBe(200);
    const body = list.json() as {
      devices: Array<{ id: string; name: string; revokedAt: string | null }>;
    };
    expect(body.devices).toEqual([
      expect.objectContaining({
        id: deviceId,
        name: 'Admin Mac',
        revokedAt: null,
      }),
    ]);
  });

  it('lists the paired device and returns 204 on revoke; revoked flag flips', async () => {
    const owner = await registerOwner('owner@example.com');
    const kp = await generateEd25519Keypair();
    const init = await app.inject({
      method: 'POST',
      url: '/devices/pairing/initiate',
      payload: {
        publicKey: kp.publicKey,
        name: 'Mac',
        platform: 'darwin',
        appVersion: '0.0.0',
      },
    });
    const { code } = init.json() as { code: string };
    const approve = await app.inject({
      method: 'POST',
      url: `/tenants/${owner.tenant.slug}/devices/pairing/approve`,
      headers: { cookie: owner.cookies },
      payload: { code, name: 'Mac' },
    });
    const deviceId = (approve.json() as { device: { id: string } }).device.id;

    const list = await app.inject({
      method: 'GET',
      url: `/tenants/${owner.tenant.slug}/devices`,
      headers: { cookie: owner.cookies },
    });
    expect(list.statusCode).toBe(200);
    const body = list.json() as {
      devices: { id: string; revokedAt: string | null }[];
    };
    expect(body.devices).toHaveLength(1);
    expect(body.devices[0]?.revokedAt).toBeNull();

    const revoke = await app.inject({
      method: 'POST',
      url: `/tenants/${owner.tenant.slug}/devices/${deviceId}/revoke`,
      headers: { cookie: owner.cookies },
    });
    expect(revoke.statusCode).toBe(204);

    const list2 = await app.inject({
      method: 'GET',
      url: `/tenants/${owner.tenant.slug}/devices`,
      headers: { cookie: owner.cookies },
    });
    const body2 = list2.json() as {
      devices: { revokedAt: string | null }[];
    };
    expect(body2.devices[0]?.revokedAt).not.toBeNull();
  });
});
