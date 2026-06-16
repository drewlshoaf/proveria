// Device-signature preHandler. Per docs/v1 §15.2, desktop submissions are
// authenticated by an Ed25519 signature from the paired device, not by the
// session cookie.
//
// Wire format: three headers.
//   X-Proveria-Device-Id    — uuid of the paired device row
//   X-Proveria-Timestamp    — integer ms since epoch
//   X-Proveria-Signature    — base64url Ed25519 signature
//
// Canonical signed bytes (UTF-8, no trailing newline):
//   proveria-device-v1\n
//   {timestamp}\n
//   {METHOD}\n
//   {path-and-query}\n
//   {sha256_hex(body)}
//
// The server reconstructs that string, hashes the actual body, verifies via
// the device's stored public key, and rejects if the timestamp is outside a
// ±60s window. On success: req.currentDevice / currentTenantId / currentUser
// are populated.

import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { preHandlerAsyncHookHandler } from 'fastify';
import { verifyEd25519 } from '@proveria/crypto-core';
import {
  devices,
  tenants,
  users,
  type Device,
  type DrizzleClient,
  type Tenant,
  type User,
} from '@proveria/db';
import { resolveTenantContext } from '../tenants/resolver.js';

declare module 'fastify' {
  interface FastifyRequest {
    currentDevice?: Device;
    currentDeviceTenant?: Tenant;
    currentDeviceUser?: User;
  }
}

export const SIGNATURE_PROTOCOL = 'proveria-device-v1';
export const SIGNATURE_WINDOW_MS = 60 * 1000;

export const canonicalSignedBytes = (
  timestampMs: number,
  method: string,
  pathWithQuery: string,
  bodyBytes: Uint8Array,
): Uint8Array => {
  const bodyHash = createHash('sha256').update(bodyBytes).digest('hex');
  const canonical = [
    SIGNATURE_PROTOCOL,
    String(timestampMs),
    method.toUpperCase(),
    pathWithQuery,
    bodyHash,
  ].join('\n');
  return new TextEncoder().encode(canonical);
};

const unauthorized = (
  reply: import('fastify').FastifyReply,
  reason: string,
): void => {
  // Single response shape regardless of reason — no enumeration.
  reply.code(401).send({ error: 'unauthorized' });
  // Info-level so operators can diagnose 401s without bumping LOG_LEVEL.
  // The reason is a short fixed enum (no caller data), so it's safe to log.
  reply.log.info({ reason }, 'device-signature rejected');
};

export const requireDeviceSignatureFactory = (
  db: DrizzleClient,
): preHandlerAsyncHookHandler => {
  return async (req, reply) => {
    const deviceId = req.headers['x-proveria-device-id'];
    const tsHeader = req.headers['x-proveria-timestamp'];
    const sigHeader = req.headers['x-proveria-signature'];

    if (
      typeof deviceId !== 'string' ||
      typeof tsHeader !== 'string' ||
      typeof sigHeader !== 'string'
    ) {
      unauthorized(reply, 'missing-headers');
      return;
    }

    const timestampMs = Number(tsHeader);
    if (!Number.isFinite(timestampMs)) {
      unauthorized(reply, 'bad-timestamp');
      return;
    }
    if (Math.abs(Date.now() - timestampMs) > SIGNATURE_WINDOW_MS) {
      unauthorized(reply, 'timestamp-out-of-window');
      return;
    }

    const deviceRows = await db
      .select()
      .from(devices)
      .where(eq(devices.id, deviceId))
      .limit(1);
    const device = deviceRows[0];
    if (!device || device.revokedAt) {
      unauthorized(reply, 'device-missing-or-revoked');
      return;
    }

    // Fastify exposes the raw body when bodyLimit/parsers don't shred it.
    // For JSON routes Fastify parses the body before preHandler — we
    // re-serialize using JSON.stringify for hashing, with a consistent key
    // order. Empty bodies hash zero bytes.
    let bodyBytes: Uint8Array;
    if (req.body === undefined || req.body === null) {
      bodyBytes = new Uint8Array(0);
    } else if (typeof req.body === 'string') {
      bodyBytes = new TextEncoder().encode(req.body);
    } else if (req.body instanceof Buffer) {
      bodyBytes = new Uint8Array(req.body);
    } else {
      bodyBytes = new TextEncoder().encode(JSON.stringify(req.body));
    }

    const canonical = canonicalSignedBytes(
      timestampMs,
      req.method,
      req.url,
      bodyBytes,
    );
    const ok = await verifyEd25519(canonical, sigHeader, device.publicKey);
    if (!ok) {
      unauthorized(reply, 'signature-invalid');
      return;
    }

    const deviceTenantRows = await db
      .select()
      .from(tenants)
      .where(eq(tenants.id, device.tenantId))
      .limit(1);
    const deviceTenant = deviceTenantRows[0];
    const userRows = await db
      .select()
      .from(users)
      .where(eq(users.id, device.userId))
      .limit(1);
    const user = userRows[0];
    if (!deviceTenant || !user || deviceTenant.archivedAt || user.deactivatedAt) {
      unauthorized(reply, 'tenant-or-user-disabled');
      return;
    }

    const slugMatch = req.url.match(/^\/tenants\/([^/?]+)/);
    let requestTenant = deviceTenant;
    if (slugMatch?.[1]) {
      const ctx = await resolveTenantContext(
        db,
        user,
        decodeURIComponent(slugMatch[1]),
      );
      if (!ctx) {
        unauthorized(reply, 'workspace-not-available');
        return;
      }
      requestTenant = ctx.tenant;
    }

    req.currentDevice = device;
    req.currentDeviceTenant = requestTenant;
    req.currentDeviceUser = user;
  };
};

/**
 * Helper that returns the three headers a client should send. Used by tests
 * and the smoke script.
 */
export const buildDeviceSignatureHeaders = async (
  signer: (payload: Uint8Array) => Promise<string>,
  deviceId: string,
  method: string,
  pathWithQuery: string,
  bodyBytes: Uint8Array,
  timestampMs: number = Date.now(),
): Promise<{
  'X-Proveria-Device-Id': string;
  'X-Proveria-Timestamp': string;
  'X-Proveria-Signature': string;
}> => {
  const canonical = canonicalSignedBytes(
    timestampMs,
    method,
    pathWithQuery,
    bodyBytes,
  );
  const signature = await signer(canonical);
  return {
    'X-Proveria-Device-Id': deviceId,
    'X-Proveria-Timestamp': String(timestampMs),
    'X-Proveria-Signature': signature,
  };
};
