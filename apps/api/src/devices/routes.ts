// Device pairing + management routes.
//
// Flow (docs/v1 §9.3, option-A "server-side create on approve"):
//   1. POST /devices/pairing/initiate         desktop → server (no auth)
//        sends ephemeral_public_key + name + platform + app_version
//        server inserts device_pairing_attempts, returns code + expires_at
//   2. (out-of-band) user types code into the desktop app approval surface
//   3. POST /tenants/:slug/devices/pairing/approve  admin/producer → server
//        sends code; server creates devices row, marks attempt consumed,
//        returns device id
//   4. GET /devices/pairing/status?code=...   desktop polls
//        once state === 'approved', desktop receives the device record
//
// Plus device management:
//   GET /tenants/:slug/devices                 admin: list devices in tenant
//   POST /tenants/:slug/devices/:id/revoke     admin: mark device revoked
//   POST /devices/:id/verify-signature         verifies a signature with the
//                                              device's stored public key

import { and, eq, isNull } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import {
  AUDIT_ACTIONS,
  AUDIT_CATEGORIES,
} from '@proveria/audit';
import { verifyEd25519 } from '@proveria/crypto-core';
import {
  devicePairingAttempts,
  devices,
  tenants,
  type DrizzleClient,
  type Platform,
  type User,
} from '@proveria/db';

import { writeAuditEvent } from '../audit/writer.js';
import { requireDeviceSignatureFactory } from '../auth/device-signature.js';
import { requireSessionFactory } from '../auth/session-hook.js';
import { resolveTenantContext } from '../tenants/resolver.js';
import {
  generatePairingCode,
  PAIRING_TTL_MINUTES,
  resolvePairingState,
} from './pairing.js';

const ensureAdminOrProducer = (
  app: import('fastify').FastifyInstance,
  role: string,
): void => {
  if (role !== 'tenant_admin' && role !== 'producer') {
    throw app.httpErrors.forbidden();
  }
};

const ensureAdmin = (
  app: import('fastify').FastifyInstance,
  role: string,
): void => {
  if (role !== 'tenant_admin') {
    throw app.httpErrors.forbidden();
  }
};

const minutesFromNow = (m: number): Date => new Date(Date.now() + m * 60 * 1000);

const PLATFORM_VALUES: readonly Platform[] = ['darwin', 'win32'];

export interface DevicePluginOptions {
  db: DrizzleClient;
}

export const devicePlugin: FastifyPluginAsync<DevicePluginOptions> = async (
  app,
  opts,
) => {
  const { db } = opts;
  const requireSession = requireSessionFactory(db);
  const requireDeviceSignature = requireDeviceSignatureFactory(db);
  const requireSessionOrDevice: import('fastify').preHandlerAsyncHookHandler =
    async (req, reply) => {
      if (typeof req.headers['x-proveria-device-id'] === 'string') {
        await requireDeviceSignature.call(app, req, reply);
        return;
      }
      await requireSession.call(app, req, reply);
    };

  const resolveRequestTenantContext = async (
    req: import('fastify').FastifyRequest,
    slug: string,
  ) => {
    if (req.currentDevice) {
      const ctx = await resolveTenantContext(db, req.currentDeviceUser!, slug);
      return ctx ? { ...ctx, user: req.currentDeviceUser! } : null;
    }
    const user = req.currentUser as User;
    const ctx = await resolveTenantContext(db, user, slug);
    return ctx ? { ...ctx, user } : null;
  };

  // -----------------------------------------------------------------------
  // POST /devices/pairing/initiate  (no auth — the desktop is unpaired)
  // -----------------------------------------------------------------------
  app.post(
    '/devices/pairing/initiate',
    {
      schema: {
        body: {
          type: 'object',
          required: ['publicKey', 'name', 'platform', 'appVersion'],
          additionalProperties: false,
          properties: {
            publicKey: { type: 'string', minLength: 32, maxLength: 200 },
            name: { type: 'string', minLength: 1, maxLength: 200 },
            platform: {
              type: 'string',
              enum: PLATFORM_VALUES as unknown as string[],
            },
            appVersion: { type: 'string', minLength: 1, maxLength: 64 },
          },
        },
      },
    },
    async (req, reply) => {
      const { publicKey, name, platform, appVersion } = req.body as {
        publicKey: string;
        name: string;
        platform: Platform;
        appVersion: string;
      };

      const code = generatePairingCode();
      const expiresAt = minutesFromNow(PAIRING_TTL_MINUTES);
      const ip = req.ip ?? null;

      const rows = await db
        .insert(devicePairingAttempts)
        .values({
          code,
          ephemeralPublicKey: publicKey,
          platform,
          appVersion,
          expiresAt,
          ip,
        })
        .returning();
      const attempt = rows[0];
      if (!attempt) throw new Error('failed to insert pairing attempt');

      await writeAuditEvent(db, {
        category: AUDIT_CATEGORIES.devicePairing,
        action: AUDIT_ACTIONS.devicePairingInitiated,
        targetType: 'device_pairing_attempt',
        targetId: attempt.id,
        payload: { platform, appVersion, name },
      });

      reply.code(201).send({
        attemptId: attempt.id,
        code: attempt.code,
        expiresAt: attempt.expiresAt.toISOString(),
      });
    },
  );

  // -----------------------------------------------------------------------
  // POST /tenants/:slug/devices/pairing/approve
  // -----------------------------------------------------------------------
  app.post<{ Params: { slug: string } }>(
    '/tenants/:slug/devices/pairing/approve',
    {
      preHandler: requireSession,
      schema: {
        body: {
          type: 'object',
          required: ['code', 'name'],
          additionalProperties: false,
          properties: {
            code: { type: 'string', minLength: 4, maxLength: 32 },
            name: { type: 'string', minLength: 1, maxLength: 200 },
            profileId: { type: 'string', minLength: 1, maxLength: 64 },
          },
        },
      },
    },
    async (req, reply) => {
      const user = req.currentUser as User;
      const ctx = await resolveTenantContext(db, user, req.params.slug);
      if (!ctx) return reply.code(404).send({ error: 'not_found' });
      ensureAdminOrProducer(app, ctx.membership.role);

      const { code, name, profileId } = req.body as {
        code: string;
        name: string;
        profileId?: string;
      };

      const rows = await db
        .select()
        .from(devicePairingAttempts)
        .where(eq(devicePairingAttempts.code, code))
        .limit(1);
      const attempt = rows[0];
      if (!attempt) return reply.code(404).send({ error: 'not_found' });

      const state = resolvePairingState(attempt);
      if (state !== 'pending') {
        return reply.code(409).send({ error: 'attempt_not_pending', state });
      }

      // Use the caller-supplied profile id if given (desktop generates one
      // locally); otherwise allocate a fresh uuid via the random_uuid default.
      const finalProfileId = profileId ?? crypto.randomUUID();

      const result = await db.transaction(async (tx) => {
        const inserted = await tx
          .insert(devices)
          .values({
            tenantId: ctx.tenant.id,
            userId: user.id,
            profileId: finalProfileId,
            publicKey: attempt.ephemeralPublicKey,
            name,
            platform: attempt.platform,
            appVersion: attempt.appVersion,
          })
          .returning();
        const device = inserted[0];
        if (!device) throw new Error('failed to insert device');

        await tx
          .update(devicePairingAttempts)
          .set({
            tenantId: ctx.tenant.id,
            userId: user.id,
            deviceId: device.id,
            approvedAt: new Date(),
            consumedAt: new Date(),
          })
          .where(eq(devicePairingAttempts.id, attempt.id));

        return device;
      });

      await writeAuditEvent(db, {
        tenantId: ctx.tenant.id,
        actorUserId: user.id,
        actorDeviceId: result.id,
        category: AUDIT_CATEGORIES.devicePairing,
        action: AUDIT_ACTIONS.devicePairingApproved,
        targetType: 'device',
        targetId: result.id,
      });
      await writeAuditEvent(db, {
        tenantId: ctx.tenant.id,
        actorUserId: user.id,
        actorDeviceId: result.id,
        category: AUDIT_CATEGORIES.devicePairing,
        action: AUDIT_ACTIONS.devicePairingCompleted,
        targetType: 'device',
        targetId: result.id,
      });

      reply.code(200).send({
        device: {
          id: result.id,
          tenantId: result.tenantId,
          tenantSlug: ctx.tenant.slug,
          tenantName: ctx.tenant.name,
          userId: result.userId,
          profileId: result.profileId,
          name: result.name,
          platform: result.platform,
          appVersion: result.appVersion,
          pairedAt: result.pairedAt.toISOString(),
        },
      });
    },
  );

  // -----------------------------------------------------------------------
  // GET /devices/pairing/status?code=...  (no auth — polled by desktop)
  // -----------------------------------------------------------------------
  app.get<{ Querystring: { code: string } }>(
    '/devices/pairing/status',
    {
      schema: {
        querystring: {
          type: 'object',
          required: ['code'],
          properties: {
            code: { type: 'string', minLength: 4, maxLength: 32 },
          },
        },
      },
    },
    async (req, reply) => {
      const { code } = req.query;
      const rows = await db
        .select()
        .from(devicePairingAttempts)
        .where(eq(devicePairingAttempts.code, code))
        .limit(1);
      const attempt = rows[0];
      if (!attempt) return reply.code(404).send({ error: 'not_found' });

      const state = resolvePairingState(attempt);
      if (state !== 'approved' || !attempt.deviceId) {
        return { state, expiresAt: attempt.expiresAt.toISOString() };
      }

      const deviceRows = await db
        .select({
          device: devices,
          tenantSlug: tenants.slug,
          tenantName: tenants.name,
        })
        .from(devices)
        .innerJoin(tenants, eq(tenants.id, devices.tenantId))
        .where(eq(devices.id, attempt.deviceId))
        .limit(1);
      const row = deviceRows[0];
      if (!row) return { state: 'approved' as const };
      const { device } = row;

      return {
        state,
        device: {
          id: device.id,
          tenantId: device.tenantId,
          tenantSlug: row.tenantSlug,
          tenantName: row.tenantName,
          userId: device.userId,
          profileId: device.profileId,
          name: device.name,
          platform: device.platform,
          appVersion: device.appVersion,
          pairedAt: device.pairedAt.toISOString(),
        },
      };
    },
  );

  // -----------------------------------------------------------------------
  // GET /tenants/:slug/devices  (admin only)
  // -----------------------------------------------------------------------
  app.get<{ Params: { slug: string } }>(
    '/tenants/:slug/devices',
    { preHandler: requireSessionOrDevice },
    async (req, reply) => {
      const ctx = await resolveRequestTenantContext(req, req.params.slug);
      if (!ctx) return reply.code(404).send({ error: 'not_found' });
      ensureAdmin(app, ctx.membership.role);

      const rows = await db
        .select()
        .from(devices)
        .where(eq(devices.tenantId, ctx.tenant.id));

      return {
        devices: rows.map((d) => ({
          id: d.id,
          userId: d.userId,
          profileId: d.profileId,
          name: d.name,
          platform: d.platform,
          appVersion: d.appVersion,
          pairedAt: d.pairedAt.toISOString(),
          lastSeenAt: d.lastSeenAt ? d.lastSeenAt.toISOString() : null,
          revokedAt: d.revokedAt ? d.revokedAt.toISOString() : null,
        })),
      };
    },
  );

  // -----------------------------------------------------------------------
  // POST /tenants/:slug/devices/:id/revoke  (admin only)
  // -----------------------------------------------------------------------
  app.post<{ Params: { slug: string; id: string } }>(
    '/tenants/:slug/devices/:id/revoke',
    { preHandler: requireSessionOrDevice },
    async (req, reply) => {
      const ctx = await resolveRequestTenantContext(req, req.params.slug);
      if (!ctx) return reply.code(404).send({ error: 'not_found' });
      ensureAdmin(app, ctx.membership.role);

      const rows = await db
        .select()
        .from(devices)
        .where(
          and(eq(devices.id, req.params.id), eq(devices.tenantId, ctx.tenant.id)),
        )
        .limit(1);
      const device = rows[0];
      if (!device) return reply.code(404).send({ error: 'not_found' });
      if (device.revokedAt) {
        return reply.code(409).send({ error: 'already_revoked' });
      }

      await db
        .update(devices)
        .set({ revokedAt: new Date() })
        .where(eq(devices.id, device.id));

      await writeAuditEvent(db, {
        tenantId: ctx.tenant.id,
        actorUserId: ctx.user.id,
        actorDeviceId: req.currentDevice?.id,
        category: AUDIT_CATEGORIES.devicePairing,
        action: AUDIT_ACTIONS.deviceRevoked,
        targetType: 'device',
        targetId: device.id,
      });

      reply.code(204).send();
    },
  );

  // -----------------------------------------------------------------------
  // POST /devices/:id/verify-signature  (no auth)
  // -----------------------------------------------------------------------
  // Test/utility endpoint. Verifies a base64url-encoded payload + signature
  // against a device's stored public key. Returns {valid: bool, revoked: bool}.
  // In M4 this becomes implicit in the manifest submission flow.
  app.post<{ Params: { id: string } }>(
    '/devices/:id/verify-signature',
    {
      schema: {
        body: {
          type: 'object',
          required: ['payload', 'signature'],
          additionalProperties: false,
          properties: {
            payload: { type: 'string', minLength: 1, maxLength: 4096 },
            signature: { type: 'string', minLength: 4, maxLength: 200 },
          },
        },
      },
    },
    async (req, reply) => {
      const { payload, signature } = req.body as {
        payload: string;
        signature: string;
      };
      const rows = await db
        .select()
        .from(devices)
        .where(eq(devices.id, req.params.id))
        .limit(1);
      const device = rows[0];
      if (!device) return reply.code(404).send({ error: 'not_found' });

      const payloadBytes = Buffer.from(payload, 'base64url');
      const valid = await verifyEd25519(
        payloadBytes,
        signature,
        device.publicKey,
      );

      // Quiet the unused-import warning if Postgres' isNull becomes used later.
      void isNull;

      return {
        valid,
        revoked: device.revokedAt !== null,
        deviceId: device.id,
      };
    },
  );
};
